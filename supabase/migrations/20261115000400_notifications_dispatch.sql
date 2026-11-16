-- Bloco 2, Etapa 4: envio da fila de notificações.
--
-- Fluxo: uma entrega nova (ou um reenvio vencido) "cutuca" a Edge Function `notifications`
-- por pg_net, depois do COMMIT e sem esperar resposta (o comprador não espera o envio).
-- A função pede um lote (claim_notification_deliveries), envia o e-mail pelo Resend ou o
-- webhook assinado, e devolve o resultado (complete_notification_delivery). O pg_cron
-- cutuca de novo a cada minuto: é ele que faz os reenvios (1 min, 5 min, 30 min e 2 h).
--
-- Regras:
--   * Um lead nunca se perde: o lead já está gravado; se o envio falhar, a falha fica em
--     notification_attempts e a entrega volta para a fila até esgotar as tentativas.
--   * Destino lido NA HORA do envio: o e-mail vai para a lista atual; o webhook, para a URL
--     ativa atual (URL + segredo), assinado com o segredo atual. Webhook desativado ou lista
--     vazia encerram a entrega como falha, sem novas tentativas.
--   * O segredo do webhook só sai do Vault para a Edge Function (service_role).
--   * E-mail sem RESEND_API_KEY configurada: a função não pega e-mails; eles esperam na fila.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Configuração do ambiente (uma linha). Não é dado de cliente.
--   function_url: endereço da Edge Function visto de dentro do banco (null = não envia).
--   site_url: base dos links (unidade no payload, lead no painel no e-mail).
--   paused: pausa o envio (testes automatizados e incidentes).
-- ---------------------------------------------------------------------------
create table private.notification_runtime (
  id boolean primary key default true check (id),
  function_url text check (function_url ~ '^https?://[^\s]+$'),
  site_url text not null check (site_url ~ '^https?://[^/\s]+$'),
  paused boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.notification_runtime (site_url) values ('https://www.vidomo.com.br');
revoke all on private.notification_runtime from public, anon, authenticated;
alter table private.notification_runtime enable row level security;

-- Chave que o banco manda à Edge Function (gerada aqui; só existe no Vault).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notifications_dispatch_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notifications_dispatch_key',
      'Autoriza o banco a acionar a Edge Function notifications'
    );
  end if;
end;
$$;

create function private.notifications_dispatch_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s
  where s.name = 'notifications_dispatch_key';
$$;
revoke all on function private.notifications_dispatch_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registro de cada tentativa (sucesso ou falha). Sem dado pessoal: código, erro e o
-- começo do corpo da resposta do destino (até 500 caracteres, com e-mails e números
-- longos mascarados pela função de envio), para o painel mostrar o motivo da falha.
-- ---------------------------------------------------------------------------
alter table public.notification_deliveries
  add column last_response_body text check (char_length(last_response_body) <= 500);

create table public.notification_attempts (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.notification_deliveries (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  attempt smallint not null check (attempt > 0),
  ok boolean not null,
  status_code smallint,
  error text check (char_length(error) <= 500),
  response_body text check (char_length(response_body) <= 500),
  duration_ms integer check (duration_ms >= 0),
  created_at timestamptz not null default now()
);
create index notification_attempts_delivery_id_idx
  on public.notification_attempts (delivery_id, attempt);
create index notification_attempts_organization_id_idx
  on public.notification_attempts (organization_id, created_at desc);

-- Histórico: não se altera (a exclusão vem só em cascata, com a entrega).
create trigger notification_attempts_no_update
  before update on public.notification_attempts
  for each row execute function private.forbid_mutation();

revoke all on public.notification_attempts from anon, authenticated;
grant select on public.notification_attempts to authenticated;
alter table public.notification_attempts enable row level security;
create policy notification_attempts_select_member on public.notification_attempts
  for select to authenticated
  using (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Política de reenvio
-- ---------------------------------------------------------------------------
-- lead.created e lead.deleted: 5 tentativas (agora, +1 min, +5 min, +30 min, +2 h).
-- test: 1 tentativa (o admin está olhando a tela e quer o resultado já).
create function private.delivery_max_attempts(p_event text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (case when p_event = 'test' then 1 else 5 end)::smallint;
$$;

-- Espera depois da tentativa N que falhou.
create function private.delivery_backoff(p_attempts smallint)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_attempts
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '30 minutes'
    else interval '2 hours'
  end;
$$;

-- Prazo para a Edge Function devolver o resultado de uma entrega pega no lote.
-- Passou disso (a função caiu no meio), a tentativa conta como falha por timeout.
create function private.delivery_lease()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '2 minutes';
$$;

-- Fecha uma tentativa: registra e decide entre entregue, nova tentativa ou falha final.
create function private.finish_delivery(
  p_delivery_id uuid,
  p_ok boolean,
  p_status_code integer,
  p_error text,
  p_duration_ms integer,
  p_final boolean default false,
  p_response_body text default null
)
returns public.notification_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.notification_deliveries;
  v_error text := left(nullif(btrim(p_error), ''), 500);
  v_body text := case when not p_ok then left(nullif(btrim(p_response_body), ''), 500) end;
  v_code smallint := case when p_status_code between 100 and 599 then p_status_code end;
begin
  select * into d from public.notification_deliveries where id = p_delivery_id for update;

  insert into public.notification_attempts
    (delivery_id, organization_id, attempt, ok, status_code, error, response_body, duration_ms)
  values (d.id, d.organization_id, d.attempts, p_ok, v_code,
          case when not p_ok then coalesce(v_error, 'erro desconhecido') end,
          v_body, greatest(p_duration_ms, 0));

  if p_ok then
    update public.notification_deliveries
    set status = 'delivered', delivered_at = now(), last_status_code = v_code, last_error = null,
        last_response_body = null
    where id = d.id
    returning * into d;
  elsif p_final or d.attempts >= private.delivery_max_attempts(d.event) then
    update public.notification_deliveries
    set status = 'failed', last_status_code = v_code, last_error = coalesce(v_error, 'erro desconhecido'),
        last_response_body = v_body
    where id = d.id
    returning * into d;
  else
    update public.notification_deliveries
    set status = 'pending', last_status_code = v_code, last_error = coalesce(v_error, 'erro desconhecido'),
        last_response_body = v_body, next_attempt_at = now() + private.delivery_backoff(d.attempts)
    where id = d.id
    returning * into d;
  end if;
  return d.status;
end;
$$;
revoke all on function private.finish_delivery(uuid, boolean, integer, text, integer, boolean, text)
  from public, anon, authenticated;

-- Monta o que a Edge Function precisa para uma entrega, com o destino ATUAL.
-- Devolve {"skip": "<motivo>"} quando não há mais para onde enviar.
-- Os dados fictícios do evento test são montados na função (formato do lead.created).
create function private.delivery_job(d public.notification_deliveries)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job jsonb;
  v_emails text[];
  v_url text;
  v_secret text;
  v_data jsonb;
begin
  select jsonb_build_object(
    'delivery_id', d.id,
    'channel', d.channel,
    'event', d.event,
    'attempt', d.attempts,
    'organization', jsonb_build_object('id', o.id, 'name', o.name),
    'site_url', (select r.site_url from private.notification_runtime r)
  )
  into v_job
  from public.organizations o
  where o.id = d.organization_id;

  if d.channel = 'email' then
    if d.event <> 'lead.created' then
      return jsonb_build_object('skip', 'evento sem e-mail');
    end if;
    select s.notification_emails into v_emails
    from public.organization_settings s
    where s.organization_id = d.organization_id;
    if coalesce(cardinality(v_emails), 0) = 0 then
      return jsonb_build_object('skip', 'sem e-mails de notificação configurados');
    end if;
    v_job := v_job || jsonb_build_object('to', to_jsonb(v_emails));
  else
    v_url := private.active_webhook_url(d.organization_id);
    v_secret := private.webhook_secret(d.organization_id);
    if v_url is null or v_secret is null then
      return jsonb_build_object('skip', 'webhook desativado');
    end if;
    v_job := v_job || jsonb_build_object('url', v_url, 'secret', v_secret);
  end if;

  if d.event = 'lead.created' then
    select jsonb_build_object(
      'development', jsonb_build_object('slug', dv.slug, 'name', dv.name),
      'lead', jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'phone', l.phone,
        'email', l.email,
        'message', l.message,
        'source', l.source,
        'status', l.status,
        'created_at', l.created_at,
        'unit', case when u.id is not null then
          jsonb_build_object('code', u.code, 'floor', f.number, 'type', ut.name)
        end
      )
    )
    into v_data
    from public.leads l
    join public.developments dv on dv.id = l.development_id
    left join public.units u on u.id = l.unit_id
    left join public.floors f on f.id = u.floor_id
    left join public.unit_types ut on ut.id = u.unit_type_id
    where l.id = d.lead_id;
    if v_data is null then
      return jsonb_build_object('skip', 'lead não encontrado');
    end if;
    v_job := v_job || v_data;
  elsif d.event = 'lead.deleted' then
    v_job := v_job || jsonb_build_object('lead', jsonb_build_object('id', d.payload -> 'lead' ->> 'id'));
  end if;

  return v_job;
end;
$$;
revoke all on function private.delivery_job(public.notification_deliveries)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- API da Edge Function (só service_role)
-- ---------------------------------------------------------------------------

-- Confere a chave que veio no cabeçalho X-Vidomo-Dispatch-Key.
create function public.check_notifications_dispatch_key(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_key is not null and p_key = private.notifications_dispatch_key();
$$;

-- Pega um lote de entregas vencidas (pendentes ou com prazo estourado) dos canais que a
-- função consegue atender. Marca como 'sending', conta a tentativa e devolve os dados.
-- p_delivery_ids restringe às entregas dadas (testes) e ignora a pausa.
create function public.claim_notification_deliveries(
  p_channels public.notification_channel[],
  p_limit integer default 10,
  p_delivery_ids uuid[] default null
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.notification_deliveries;
  v_job jsonb;
begin
  if p_delivery_ids is null and (select r.paused from private.notification_runtime r) then
    return;
  end if;

  -- Prazo estourado (a função caiu no meio do envio): a tentativa conta como falha.
  for d in
    select * from public.notification_deliveries x
    where x.status = 'sending' and x.next_attempt_at <= now()
      and (p_delivery_ids is null or x.id = any (p_delivery_ids))
    for update skip locked
  loop
    perform private.finish_delivery(d.id, false, null, 'timeout: sem resposta da função de envio', null);
  end loop;

  for d in
    select * from public.notification_deliveries x
    where x.status = 'pending' and x.next_attempt_at <= now()
      and x.channel = any (p_channels)
      and (p_delivery_ids is null or x.id = any (p_delivery_ids))
    order by x.next_attempt_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update skip locked
  loop
    update public.notification_deliveries
    set status = 'sending', attempts = attempts + 1,
        next_attempt_at = now() + private.delivery_lease()
    where id = d.id
    returning * into d;

    v_job := private.delivery_job(d);
    if v_job ? 'skip' then
      perform private.finish_delivery(d.id, false, null, v_job ->> 'skip', null, true);
      continue;
    end if;

    -- Guarda o destino efetivamente usado (auditoria).
    update public.notification_deliveries
    set target = coalesce(
      v_job ->> 'url',
      (select string_agg(e, ',') from jsonb_array_elements_text(v_job -> 'to') e)
    )
    where id = d.id;

    return next v_job;
  end loop;
end;
$$;

-- Resultado de uma tentativa. Ignora resultado atrasado (a entrega já foi reaberta pelo
-- prazo estourado ou fechada): devolve 'stale'.
create function public.complete_notification_delivery(
  p_delivery_id uuid,
  p_attempt integer,
  p_ok boolean,
  p_status_code integer default null,
  p_error text default null,
  p_duration_ms integer default null,
  p_response_body text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.notification_deliveries d
  where d.id = p_delivery_id and d.status = 'sending' and d.attempts = p_attempt
  for update;
  if not found then
    return 'stale';
  end if;
  return private.finish_delivery(
    p_delivery_id, p_ok, p_status_code, p_error, p_duration_ms, false, p_response_body
  )::text;
end;
$$;

-- Pausa/retoma o envio (testes automatizados e incidentes). Devolve o valor anterior.
create function public.set_notifications_paused(p_paused boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
begin
  select r.paused into v_old from private.notification_runtime r for update;
  update private.notification_runtime r set paused = p_paused, updated_at = now() where r.id;
  return v_old;
end;
$$;

revoke all on function public.check_notifications_dispatch_key(text) from public, anon, authenticated;
revoke all on function public.claim_notification_deliveries(public.notification_channel[], integer, uuid[])
  from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid, integer, boolean, integer, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.set_notifications_paused(boolean) from public, anon, authenticated;
grant execute on function public.check_notifications_dispatch_key(text) to service_role;
grant execute on function public.claim_notification_deliveries(public.notification_channel[], integer, uuid[])
  to service_role;
grant execute on function public.complete_notification_delivery(uuid, integer, boolean, integer, text, integer, text)
  to service_role;
grant execute on function public.set_notifications_paused(boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Acionamento: logo depois de uma entrega nova e a cada minuto (reenvios).
-- ---------------------------------------------------------------------------
-- Só enfileira o pedido HTTP (pg_net envia depois do COMMIT). Nunca derruba quem chamou:
-- se algo falhar aqui, a entrega continua na fila e o cron tenta no minuto seguinte.
create function private.kick_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.notification_runtime;
begin
  select * into r from private.notification_runtime;
  if r.function_url is null or r.paused then
    return;
  end if;
  if not exists (
    select 1 from public.notification_deliveries d
    where d.status in ('pending', 'sending') and d.next_attempt_at <= now()
  ) then
    return;
  end if;

  perform net.http_post(
    url := r.function_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-vidomo-dispatch-key', private.notifications_dispatch_key()
    ),
    timeout_milliseconds := 60000
  );
exception when others then
  raise warning 'kick_notifications: %', sqlerrm;
end;
$$;
revoke all on function private.kick_notifications() from public, anon, authenticated;

create function private.notification_deliveries_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.kick_notifications();
  return null;
end;
$$;

create trigger notification_deliveries_kick
  after insert on public.notification_deliveries
  for each statement execute function private.notification_deliveries_kick();

select cron.schedule('vidomo-notifications', '* * * * *', 'select private.kick_notifications()');
