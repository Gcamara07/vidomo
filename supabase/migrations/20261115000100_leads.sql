-- Vidomo — Bloco 2, Etapa 1: leads.
--
-- Princípios:
--   * Um lead nunca se perde: é gravado primeiro; e-mail e webhook viram linhas em
--     notification_deliveries (fila com tentativas), enviadas depois pelo servidor.
--   * anon não lê nem altera leads. O comprador só cria, por create_lead, que exige a
--     chave de ingestão do servidor do Next (o navegador não a tem).
--   * Leads seguem organization_id + RLS (regra 1). Escrita só por RPC.
--   * LGPD: consentimento obrigatório e registrado (versão do texto aceito); o admin
--     exclui a pedido do titular, deixando um registro sem dado pessoal.
--
-- Configuração por ORGANIZAÇÃO (organization_settings): quem recebe os leads (e-mails,
-- webhook/CRM) é a equipe comercial da incorporadora, não um empreendimento. O segredo
-- de assinatura do webhook fica no Vault, fora de qualquer tabela legível pela API.
-- TODO(WhatsApp por empreendimento): sobrescrever o número quando houver estandes distintos.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.lead_status as enum ('new', 'in_progress', 'won', 'lost');
-- 'stand' fica reservado para o quiosque (fora deste bloco).
create type public.lead_source as enum ('portal', 'unit_link', 'stand', 'manual');
create type public.notification_channel as enum ('email', 'webhook');
create type public.notification_status as enum ('pending', 'sending', 'delivered', 'failed');

-- ---------------------------------------------------------------------------
-- Validadores (puros; usados em CHECKs e nas funções)
-- ---------------------------------------------------------------------------
create function private.is_valid_email(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and char_length(p) <= 254
     and p = lower(p)
     and p ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
$$;

create function private.all_valid_emails(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(private.is_valid_email(e)), true) from unnest(p) as e;
$$;

-- Telefone brasileiro só com dígitos, com DDI: 55 + DDD + 8 ou 9 dígitos.
-- Aceita com ou sem 55, com máscara ou não. Retorna null se inválido.
create function private.normalize_br_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^[1-9][1-9][0-9]{8,9}$' then '55' || d
    when d ~ '^55[1-9][1-9][0-9]{8,9}$' then d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s;
$$;

-- Imutabilidade genérica (textos de consentimento, registro de exclusões).
create function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% é imutável (% bloqueado)', tg_table_name, tg_op using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- Configuração comercial por organização
-- ---------------------------------------------------------------------------
create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- WhatsApp comercial (wa.me), só dígitos com DDI 55.
  whatsapp_number text check (whatsapp_number ~ '^55[1-9][1-9][0-9]{8,9}$'),
  -- Quem recebe o e-mail de lead novo.
  notification_emails text[] not null default '{}'
    check (cardinality(notification_emails) <= 10 and private.all_valid_emails(notification_emails)),
  webhook_url text check (char_length(webhook_url) <= 500 and webhook_url ~ '^https?://[^\s]+$'),
  -- Política de privacidade da incorporadora; null = página padrão /privacidade.
  privacy_policy_url text
    check (char_length(privacy_policy_url) <= 500 and privacy_policy_url ~ '^(https?://|/)[^\s]*$'),
  -- O segredo em si fica no Vault (vault.secrets 'webhook_secret:<organization_id>').
  webhook_secret_set_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organization_settings_touch_updated_at
  before update on public.organization_settings
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Textos de consentimento (LGPD): versionados e imutáveis. Texto da plataforma,
-- não dado de cliente; {organizacao} é trocado pelo nome da incorporadora.
-- ---------------------------------------------------------------------------
create table public.consent_texts (
  version text primary key check (version ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null check (kind in ('online', 'in_person')),
  body text not null,
  created_at timestamptz not null default now()
);

create trigger consent_texts_immutable
  before update or delete on public.consent_texts
  for each row execute function private.forbid_mutation();

insert into public.consent_texts (version, kind, body) values
  ('online-v1', 'online',
   'Autorizo a {organizacao} a usar meu nome, telefone, e-mail e mensagem para entrar em '
   'contato comigo sobre este empreendimento, conforme a Política de Privacidade. Posso '
   'pedir a exclusão dos meus dados a qualquer momento.'),
  ('presencial-v1', 'in_person',
   'Consentimento obtido presencialmente pela equipe comercial, que informou a finalidade '
   '(contato sobre o empreendimento) e o direito de pedir a exclusão dos dados.');

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
-- Para a FK composta unidade × empreendimento.
alter table public.units add constraint units_id_development_id_key unique (id, development_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  development_id uuid not null,
  unit_id uuid,
  name text not null check (char_length(name) between 2 and 120 and name !~ '[[:cntrl:]]'),
  phone text check (phone ~ '^55[1-9][1-9][0-9]{8,9}$'),
  email text check (email is null or private.is_valid_email(email)),
  message text check (char_length(message) between 1 and 1000),
  source public.lead_source not null,
  status public.lead_status not null default 'new',
  assigned_to uuid,
  consent_at timestamptz not null,
  consent_text_version text not null references public.consent_texts (version),
  -- Quem cadastrou (lead manual); null quando veio da página pública.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  unique (id, organization_id),
  -- restrict: um empreendimento com leads não some levando os leads junto.
  foreign key (development_id, organization_id)
    references public.developments (id, organization_id) on delete restrict,
  foreign key (unit_id, development_id)
    references public.units (id, development_id) on delete set null (unit_id),
  -- Só um membro da MESMA organização pode assumir; se sair da organização, o lead volta a ficar sem dono.
  foreign key (organization_id, assigned_to)
    references public.organization_members (organization_id, user_id) on delete set null (assigned_to)
);
create index leads_organization_created_idx on public.leads (organization_id, created_at desc);
create index leads_development_id_idx on public.leads (development_id);
create index leads_unit_id_idx on public.leads (unit_id);
create index leads_assigned_to_idx on public.leads (assigned_to);

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Fila de notificações (e-mail e webhook), com tentativas e próximo envio.
-- lead.created aponta para o lead (os dados são lidos na hora do envio; se o lead for
-- excluído, a entrega vai junto). lead.deleted e test não têm lead: levam só o payload.
-- ---------------------------------------------------------------------------
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(), -- também é o X-Vidomo-Delivery
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid,
  channel public.notification_channel not null,
  event text not null check (event in ('lead.created', 'lead.deleted', 'test')),
  -- Destino no momento em que a entrega nasceu: e-mails separados por vírgula ou a URL.
  target text not null,
  payload jsonb,
  status public.notification_status not null default 'pending',
  attempts smallint not null default 0,
  last_error text,
  last_status_code smallint,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event <> 'lead.created' or lead_id is not null),
  foreign key (lead_id, organization_id)
    references public.leads (id, organization_id) on delete cascade
);
create index notification_deliveries_due_idx
  on public.notification_deliveries (next_attempt_at)
  where status in ('pending', 'sending');
create index notification_deliveries_lead_id_idx on public.notification_deliveries (lead_id);
create index notification_deliveries_organization_id_idx
  on public.notification_deliveries (organization_id, created_at desc);

create trigger notification_deliveries_touch_updated_at
  before update on public.notification_deliveries
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Exclusões a pedido do titular (LGPD): só metadados, sem dado pessoal. Imutável.
-- ---------------------------------------------------------------------------
create table public.lead_deletions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  development_id uuid,
  source public.lead_source,
  lead_created_at timestamptz,
  -- Motivo livre e curto (ex.: "pedido do titular por e-mail"); a tela orienta a não pôr nome.
  reason text check (char_length(reason) <= 300),
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz not null default now()
);
create index lead_deletions_organization_id_idx on public.lead_deletions (organization_id);

create trigger lead_deletions_immutable
  before update or delete on public.lead_deletions
  for each row execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Cliques no WhatsApp por unidade e dia (sem dado pessoal).
-- ---------------------------------------------------------------------------
create table public.unit_whatsapp_clicks (
  organization_id uuid not null,
  development_id uuid not null,
  unit_id uuid not null,
  day date not null,
  clicks integer not null default 0 check (clicks >= 0),
  primary key (unit_id, day),
  foreign key (unit_id, organization_id)
    references public.units (id, organization_id) on delete cascade,
  foreign key (development_id, organization_id)
    references public.developments (id, organization_id) on delete cascade
);
create index unit_whatsapp_clicks_organization_id_idx on public.unit_whatsapp_clicks (organization_id);

-- ---------------------------------------------------------------------------
-- Privado: chaves de ingestão (só o hash) e tentativas para o limite antispam.
-- ---------------------------------------------------------------------------
create table private.ingest_keys (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'), -- sha256 em hex
  label text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Baldes: 'ip:<hmac do IP feito no servidor>', 'phone:<hmac>', 'email:<hmac>'.
-- Nada em claro; linhas com mais de 1 dia são apagadas a cada criação.
create table private.lead_attempts (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index lead_attempts_bucket_idx on private.lead_attempts (bucket, created_at);
create index lead_attempts_created_at_idx on private.lead_attempts (created_at);

-- ---------------------------------------------------------------------------
-- Funções auxiliares privadas
-- ---------------------------------------------------------------------------
-- Valida a chave de ingestão e devolve o hash dela (usado como chave dos HMACs).
create function private.require_ingest_key(p_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_key is null or char_length(p_key) < 32 then
    raise exception 'invalid_ingest_key' using errcode = '42501';
  end if;
  v_hash := encode(extensions.digest(p_key, 'sha256'), 'hex');
  if not exists (
    select 1 from private.ingest_keys k where k.key_hash = v_hash and k.revoked_at is null
  ) then
    raise exception 'invalid_ingest_key' using errcode = '42501';
  end if;
  return v_hash;
end;
$$;

-- Limite antispam: no máximo p_limit criações por balde na janela. Trava por balde
-- (advisory lock da transação) para duas requisições simultâneas não passarem juntas.
create function private.consume_rate_limit(p_buckets text[], p_limit integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b text;
begin
  delete from private.lead_attempts a where a.created_at < now() - interval '1 day';

  foreach b in array p_buckets loop
    perform pg_advisory_xact_lock(hashtextextended(b, 0));
    if (select count(*) from private.lead_attempts a
        where a.bucket = b and a.created_at > now() - p_window) >= p_limit then
      raise exception 'rate_limited' using errcode = 'VD429';
    end if;
  end loop;

  insert into private.lead_attempts (bucket) select unnest(p_buckets);
end;
$$;

-- Limpa e valida os campos de contato. Erros com códigos estáveis (o Next traduz).
create function private.clean_lead_fields(
  p_name text,
  p_phone text,
  p_email text,
  p_message text,
  out name text,
  out phone text,
  out email text,
  out message text
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if char_length(name) not between 2 and 120 or name ~ '[[:cntrl:]]' then
    raise exception 'invalid_name' using errcode = 'VD422';
  end if;

  phone := nullif(btrim(coalesce(p_phone, '')), '');
  if phone is not null then
    phone := private.normalize_br_phone(phone);
    if phone is null then
      raise exception 'invalid_phone' using errcode = 'VD422';
    end if;
  end if;

  email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if email is not null and not private.is_valid_email(email) then
    raise exception 'invalid_email' using errcode = 'VD422';
  end if;

  if phone is null and email is null then
    raise exception 'contact_required' using errcode = 'VD422';
  end if;

  message := nullif(btrim(coalesce(p_message, '')), '');
  if char_length(message) > 1000 then
    raise exception 'message_too_long' using errcode = 'VD422';
  end if;
end;
$$;

-- Segredo de assinatura do webhook (Vault). Sem GRANT: só o dono e o envio (Etapa 4).
create function private.webhook_secret(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = 'webhook_secret:' || p_organization_id::text;
$$;

-- Ao criar um lead, enfileira e-mail e webhook conforme a configuração da organização.
create function private.enqueue_lead_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.organization_settings;
begin
  select * into s from public.organization_settings where organization_id = new.organization_id;
  if not found then
    return null;
  end if;

  if cardinality(s.notification_emails) > 0 then
    insert into public.notification_deliveries (organization_id, lead_id, channel, event, target)
    values (new.organization_id, new.id, 'email', 'lead.created',
            array_to_string(s.notification_emails, ','));
  end if;

  if s.webhook_url is not null then
    insert into public.notification_deliveries (organization_id, lead_id, channel, event, target)
    values (new.organization_id, new.id, 'webhook', 'lead.created', s.webhook_url);
  end if;

  return null;
end;
$$;

create trigger leads_enqueue_created
  after insert on public.leads
  for each row execute function private.enqueue_lead_created();

-- ---------------------------------------------------------------------------
-- RPC pública: create_lead (só o servidor do Next, que tem a chave de ingestão)
-- ---------------------------------------------------------------------------
create function public.create_lead(
  p_ingest_key text,
  p_client_key text,
  p_slug text,
  p_object_key text,
  p_name text,
  p_phone text,
  p_email text,
  p_message text,
  p_source public.lead_source,
  p_consent boolean,
  p_consent_version text
)
returns table (lead_id uuid, unit_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_key_hash text;
  v_fields record;
  v_org uuid;
  v_dev uuid;
  v_unit uuid;
  v_unit_code text;
  v_buckets text[];
  v_id uuid;
begin
  v_key_hash := private.require_ingest_key(p_ingest_key);

  -- Pela página pública só entram portal e unit_link; manual tem a própria função.
  if p_source is null or p_source not in ('portal', 'unit_link') then
    raise exception 'invalid_source' using errcode = 'VD422';
  end if;
  if p_consent is not true then
    raise exception 'consent_required' using errcode = 'VD422';
  end if;
  if not exists (
    select 1 from public.consent_texts c where c.version = p_consent_version and c.kind = 'online'
  ) then
    raise exception 'invalid_consent_version' using errcode = 'VD422';
  end if;
  if p_client_key is null or char_length(p_client_key) not between 16 and 128 then
    raise exception 'invalid_client_key' using errcode = 'VD422';
  end if;

  select * into v_fields from private.clean_lead_fields(p_name, p_phone, p_email, p_message);

  select d.id, d.organization_id into v_dev, v_org
  from public.developments d
  where d.slug = p_slug and d.status = 'published';
  if v_dev is null then
    raise exception 'development_not_found' using errcode = 'VD404';
  end if;

  if p_object_key is not null then
    select u.id, u.code into v_unit, v_unit_code
    from public.units u
    where u.development_id = v_dev and u.object_key = p_object_key;
    if v_unit is null then
      raise exception 'unit_not_found' using errcode = 'VD404';
    end if;
  end if;

  -- 5 por hora por IP e por contato (telefone e e-mail separados).
  v_buckets := array['ip:' || p_client_key];
  if v_fields.phone is not null then
    v_buckets := v_buckets
      || ('phone:' || encode(extensions.hmac(v_fields.phone, v_key_hash, 'sha256'), 'hex'));
  end if;
  if v_fields.email is not null then
    v_buckets := v_buckets
      || ('email:' || encode(extensions.hmac(v_fields.email, v_key_hash, 'sha256'), 'hex'));
  end if;
  perform private.consume_rate_limit(v_buckets, 5, interval '1 hour');

  insert into public.leads (
    organization_id, development_id, unit_id, name, phone, email, message, source,
    consent_at, consent_text_version
  ) values (
    v_org, v_dev, v_unit, v_fields.name, v_fields.phone, v_fields.email, v_fields.message,
    p_source, now(), p_consent_version
  )
  returning id into v_id;

  return query select v_id, v_unit_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs do painel (authenticated). Lead de outra organização é indistinguível de
-- lead inexistente (P0002), como em set_unit_status.
-- ---------------------------------------------------------------------------
-- Trava o lead e devolve o papel de quem chama na organização dele.
create function private.lock_lead_for_member(
  p_lead_id uuid,
  out o_lead public.leads,
  out o_role public.member_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  -- Só trava se quem chama for membro da organização dona do lead.
  select m.role into o_role
  from public.leads l
  join public.organization_members m
    on m.organization_id = l.organization_id and m.user_id = v_uid
  where l.id = p_lead_id
  for update of l;

  if o_role is null then
    raise exception 'lead_not_found' using errcode = 'P0002';
  end if;

  select * into o_lead from public.leads l where l.id = p_lead_id;
end;
$$;

-- "Assumir": o lead sem dono passa a ser de quem chamou (vendedor ou admin).
create function public.claim_lead(p_lead_id uuid)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_lead public.leads;
begin
  select * into v from private.lock_lead_for_member(p_lead_id);
  if (v.o_lead).assigned_to is not null and (v.o_lead).assigned_to <> auth.uid() then
    raise exception 'already_assigned' using errcode = 'VD409';
  end if;

  update public.leads l set assigned_to = auth.uid() where l.id = p_lead_id
  returning * into v_lead;
  return v_lead;
end;
$$;

-- Admin atribui a qualquer membro da organização (ou tira o dono, com null).
create function public.assign_lead(p_lead_id uuid, p_user_id uuid)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_lead public.leads;
begin
  select * into v from private.lock_lead_for_member(p_lead_id);
  if v.o_role <> 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = (v.o_lead).organization_id and m.user_id = p_user_id
  ) then
    raise exception 'not_a_member' using errcode = 'VD422';
  end if;

  update public.leads l set assigned_to = p_user_id where l.id = p_lead_id
  returning * into v_lead;
  return v_lead;
end;
$$;

-- Vendedor muda status só dos leads dele; admin de qualquer um.
create function public.set_lead_status(p_lead_id uuid, p_status public.lead_status)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_lead public.leads;
begin
  select * into v from private.lock_lead_for_member(p_lead_id);
  if v.o_role <> 'admin' and (v.o_lead).assigned_to is distinct from auth.uid() then
    raise exception 'not_assigned_to_you' using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'invalid_status' using errcode = 'VD422';
  end if;

  update public.leads l set status = p_status where l.id = p_lead_id
  returning * into v_lead;
  return v_lead;
end;
$$;

-- Exclusão a pedido do titular (só admin): registro sem dado pessoal, aviso lead.deleted
-- ao webhook (só o id) e remoção do lead e das entregas pendentes dele.
create function public.delete_lead(p_lead_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_webhook text;
begin
  select * into v from private.lock_lead_for_member(p_lead_id);
  if v.o_role <> 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if char_length(p_reason) > 300 then
    raise exception 'reason_too_long' using errcode = 'VD422';
  end if;

  insert into public.lead_deletions
    (organization_id, lead_id, development_id, source, lead_created_at, reason, deleted_by)
  values (
    (v.o_lead).organization_id, (v.o_lead).id, (v.o_lead).development_id, (v.o_lead).source,
    (v.o_lead).created_at, nullif(btrim(p_reason), ''), auth.uid()
  );

  select s.webhook_url into v_webhook
  from public.organization_settings s
  where s.organization_id = (v.o_lead).organization_id;
  if v_webhook is not null then
    insert into public.notification_deliveries (organization_id, channel, event, target, payload)
    values ((v.o_lead).organization_id, 'webhook', 'lead.deleted', v_webhook,
            jsonb_build_object('lead', jsonb_build_object('id', (v.o_lead).id)));
  end if;

  delete from public.leads l where l.id = p_lead_id;
end;
$$;

-- Lead manual (painel): telefone ou e-mail, consentimento presencial obrigatório.
-- Fica com quem cadastrou.
create function public.create_manual_lead(
  p_development_id uuid,
  p_unit_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_message text,
  p_consent_in_person boolean
)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_fields record;
  v_version text;
  v_lead public.leads;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select d.organization_id into v_org
  from public.developments d
  join public.organization_members m
    on m.organization_id = d.organization_id and m.user_id = v_uid
  where d.id = p_development_id;
  if v_org is null then
    raise exception 'development_not_found' using errcode = 'VD404';
  end if;

  if p_unit_id is not null and not exists (
    select 1 from public.units u where u.id = p_unit_id and u.development_id = p_development_id
  ) then
    raise exception 'unit_not_found' using errcode = 'VD404';
  end if;

  if p_consent_in_person is not true then
    raise exception 'consent_required' using errcode = 'VD422';
  end if;

  select * into v_fields from private.clean_lead_fields(p_name, p_phone, p_email, p_message);

  select c.version into v_version
  from public.consent_texts c
  where c.kind = 'in_person'
  order by c.created_at desc, c.version desc
  limit 1;

  insert into public.leads (
    organization_id, development_id, unit_id, name, phone, email, message, source,
    assigned_to, consent_at, consent_text_version, created_by
  ) values (
    v_org, p_development_id, p_unit_id, v_fields.name, v_fields.phone, v_fields.email,
    v_fields.message, 'manual', v_uid, now(), v_version, v_uid
  )
  returning * into v_lead;
  return v_lead;
end;
$$;

-- Gera (ou troca) o segredo de assinatura do webhook da organização e o devolve UMA vez.
-- Depois disso ninguém o lê pela API: fica no Vault.
create function public.rotate_webhook_secret(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'webhook_secret:' || p_organization_id::text;
  v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  if not private.has_org_role(p_organization_id, array['admin']::public.member_role[]) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select s.id into v_id from vault.secrets s where s.name = v_name;
  if v_id is null then
    perform vault.create_secret(v_secret, v_name, 'Assinatura HMAC do webhook de leads');
  else
    perform vault.update_secret(v_id, v_secret);
  end if;

  insert into public.organization_settings (organization_id, webhook_secret_set_at)
  values (p_organization_id, now())
  on conflict (organization_id) do update set webhook_secret_set_at = excluded.webhook_secret_set_at;

  return v_secret;
end;
$$;

-- ---------------------------------------------------------------------------
-- Leitura pública para a ficha: contato comercial e texto de consentimento atual.
-- ---------------------------------------------------------------------------
create function public.public_contact(p_slug text)
returns table (
  organization_name text,
  whatsapp_number text,
  privacy_policy_url text,
  consent_version text,
  consent_text text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, s.whatsapp_number, s.privacy_policy_url, c.version,
         replace(c.body, '{organizacao}', o.name)
  from public.developments d
  join public.organizations o on o.id = d.organization_id
  left join public.organization_settings s on s.organization_id = d.organization_id
  cross join lateral (
    select ct.version, ct.body
    from public.consent_texts ct
    where ct.kind = 'online'
    order by ct.created_at desc, ct.version desc
    limit 1
  ) c
  where d.slug = p_slug and d.status = 'published';
$$;

-- Conta um clique no WhatsApp da ficha (sem dado pessoal). false se não existe.
create function public.register_whatsapp_click(p_slug text, p_object_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit record;
begin
  select u.id, u.organization_id, u.development_id into v_unit
  from public.developments d
  join public.units u on u.development_id = d.id
  where d.slug = p_slug and d.status = 'published' and u.object_key = p_object_key;
  if v_unit.id is null then
    return false;
  end if;

  insert into public.unit_whatsapp_clicks (organization_id, development_id, unit_id, day, clicks)
  values (v_unit.organization_id, v_unit.development_id, v_unit.id,
          (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (unit_id, day) do update set clicks = public.unit_whatsapp_clicks.clicks + 1;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilégios: nada para anon nas tabelas; authenticated lê pela RLS e escreve por RPC
-- (exceto a configuração, que o admin edita direto, protegida por RLS).
-- ---------------------------------------------------------------------------
revoke all on
  public.organization_settings, public.consent_texts, public.leads,
  public.notification_deliveries, public.lead_deletions, public.unit_whatsapp_clicks
from anon, authenticated;

grant select on
  public.organization_settings, public.consent_texts, public.leads,
  public.notification_deliveries, public.lead_deletions, public.unit_whatsapp_clicks
to authenticated;

-- webhook_secret_set_at fica de fora: só rotate_webhook_secret escreve.
grant insert (organization_id, whatsapp_number, notification_emails, webhook_url, privacy_policy_url)
  on public.organization_settings to authenticated;
grant update (whatsapp_number, notification_emails, webhook_url, privacy_policy_url)
  on public.organization_settings to authenticated;

revoke all on private.ingest_keys, private.lead_attempts from public, anon, authenticated;
revoke all on sequence private.lead_attempts_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organization_settings enable row level security;
alter table public.consent_texts enable row level security;
alter table public.leads enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.lead_deletions enable row level security;
alter table public.unit_whatsapp_clicks enable row level security;
alter table private.ingest_keys enable row level security;
alter table private.lead_attempts enable row level security;

create policy organization_settings_select_member on public.organization_settings
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy organization_settings_insert_admin on public.organization_settings
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['admin']::public.member_role[]));
create policy organization_settings_update_admin on public.organization_settings
  for update to authenticated
  using (private.has_org_role(organization_id, array['admin']::public.member_role[]))
  with check (private.has_org_role(organization_id, array['admin']::public.member_role[]));

create policy consent_texts_select_authenticated on public.consent_texts
  for select to authenticated
  using (true);

create policy leads_select_member on public.leads
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy notification_deliveries_select_member on public.notification_deliveries
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy lead_deletions_select_admin on public.lead_deletions
  for select to authenticated
  using (private.has_org_role(organization_id, array['admin']::public.member_role[]));

create policy unit_whatsapp_clicks_select_member on public.unit_whatsapp_clicks
  for select to authenticated
  using (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Funções: ninguém executa por padrão; libera só o necessário.
-- ---------------------------------------------------------------------------
revoke all on function
  private.is_valid_email(text),
  private.all_valid_emails(text[]),
  private.normalize_br_phone(text),
  private.forbid_mutation(),
  private.require_ingest_key(text),
  private.consume_rate_limit(text[], integer, interval),
  private.clean_lead_fields(text, text, text, text),
  private.webhook_secret(uuid),
  private.enqueue_lead_created(),
  private.lock_lead_for_member(uuid)
from public, anon, authenticated;

-- Validadores puros usados nos CHECKs (o Postgres confere EXECUTE de quem escreve):
-- admin pela API e a service_role (scripts e envio).
grant execute on function private.is_valid_email(text), private.all_valid_emails(text[])
  to authenticated, service_role;
-- A service_role precisa enxergar o schema para avaliar esses CHECKs (o schema segue fora
-- da API: o PostgREST só expõe public).
grant usage on schema private to service_role;

revoke all on function
  public.create_lead(text, text, text, text, text, text, text, text, public.lead_source, boolean, text),
  public.claim_lead(uuid),
  public.assign_lead(uuid, uuid),
  public.set_lead_status(uuid, public.lead_status),
  public.delete_lead(uuid, text),
  public.create_manual_lead(uuid, uuid, text, text, text, text, boolean),
  public.rotate_webhook_secret(uuid),
  public.public_contact(text),
  public.register_whatsapp_click(text, text)
from public, anon, authenticated;

-- create_lead fica exposta ao anon porque o servidor do Next chama com a chave
-- publishable; sem a chave de ingestão (só no servidor) ela recusa tudo.
grant execute on function
  public.create_lead(text, text, text, text, text, text, text, text, public.lead_source, boolean, text)
  to anon;
grant execute on function
  public.claim_lead(uuid),
  public.assign_lead(uuid, uuid),
  public.set_lead_status(uuid, public.lead_status),
  public.delete_lead(uuid, text),
  public.create_manual_lead(uuid, uuid, text, text, text, text, boolean),
  public.rotate_webhook_secret(uuid)
  to authenticated;
grant execute on function public.public_contact(text), public.register_whatsapp_click(text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: lead novo aparece no painel (postgres_changes aplica a RLS de leads).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.leads;
