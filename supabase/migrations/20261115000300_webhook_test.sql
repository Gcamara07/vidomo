-- Painel de configuração: "Enviar teste" do webhook.
-- Enfileira uma entrega 'test' (dados fictícios montados no envio, Etapa 4) para o webhook
-- ativo da organização. Só admin; exige webhook ativo (URL + segredo), como as demais.

create function public.enqueue_webhook_test(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_id uuid;
begin
  if not private.has_org_role(p_organization_id, array['admin']::public.member_role[]) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  v_url := private.active_webhook_url(p_organization_id);
  if v_url is null then
    raise exception 'webhook_inactive' using errcode = 'VD409';
  end if;

  insert into public.notification_deliveries (organization_id, channel, event, target)
  values (p_organization_id, 'webhook', 'test', v_url)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.enqueue_webhook_test(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_webhook_test(uuid) to authenticated;
