-- Webhook ativo = URL configurada E segredo de assinatura gerado.
--
-- Toda entrega de webhook é assinada (X-Vidomo-Signature). Sem segredo, a entrega não tem
-- como ser assinada e o receptor a recusaria (401): então nada é enfileirado. A mesma regra
-- vale para lead.created e lead.deleted (e para o "Enviar teste" do painel).

create function private.active_webhook_url(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.webhook_url
  from public.organization_settings s
  where s.organization_id = p_organization_id
    and s.webhook_url is not null
    and s.webhook_secret_set_at is not null;
$$;

revoke all on function private.active_webhook_url(uuid) from public, anon, authenticated;

create or replace function private.enqueue_lead_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emails text[];
  v_webhook text;
begin
  select s.notification_emails into v_emails
  from public.organization_settings s
  where s.organization_id = new.organization_id;

  if cardinality(v_emails) > 0 then
    insert into public.notification_deliveries (organization_id, lead_id, channel, event, target)
    values (new.organization_id, new.id, 'email', 'lead.created', array_to_string(v_emails, ','));
  end if;

  v_webhook := private.active_webhook_url(new.organization_id);
  if v_webhook is not null then
    insert into public.notification_deliveries (organization_id, lead_id, channel, event, target)
    values (new.organization_id, new.id, 'webhook', 'lead.created', v_webhook);
  end if;

  return null;
end;
$$;

create or replace function public.delete_lead(p_lead_id uuid, p_reason text default null)
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

  v_webhook := private.active_webhook_url((v.o_lead).organization_id);
  if v_webhook is not null then
    insert into public.notification_deliveries (organization_id, channel, event, target, payload)
    values ((v.o_lead).organization_id, 'webhook', 'lead.deleted', v_webhook,
            jsonb_build_object('lead', jsonb_build_object('id', (v.o_lead).id)));
  end if;

  delete from public.leads l where l.id = p_lead_id;
end;
$$;
