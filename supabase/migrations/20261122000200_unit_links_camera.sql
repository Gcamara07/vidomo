-- Bloco M, etapa 3: links de unidade com bloco, bloco no lead e câmera inicial.
--
--   * private.unit_link_code  código da unidade nos links (?u=): o próprio código quando ele
--                             não se repete no empreendimento ("802"); senão
--                             "<código do bloco>-<código>" ("B09-201"). Mesma regra de
--                             apps/web/src/lib/unit-ref.ts (página pública e painel).
--   * delivery_job            o lead (e-mail e webhook) leva o bloco, o rótulo do andar e o
--                             código do link.
--   * developments.viewer_cameras  câmeras do viewer (manifest.cameras), ex.: a vista
--                             inicial do condomínio. Configuração por dado (regra 6), pública.

create function private.unit_link_code(p_unit_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.units o
      where o.development_id = u.development_id
        and o.code = u.code
        and o.id <> u.id
    ) then t.code || '-' || u.code
    else u.code
  end
  from public.units u
  join public.towers t on t.id = u.tower_id
  where u.id = p_unit_id;
$$;

revoke all on function private.unit_link_code(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Câmeras do viewer
-- ---------------------------------------------------------------------------
alter table public.developments
  add column viewer_cameras jsonb check (viewer_cameras is null or jsonb_typeof(viewer_cameras) = 'object');

comment on column public.developments.viewer_cameras is
  'Câmeras do viewer (manifest.cameras), ex.: {"default": {"position": [x,y,z], "target": [x,y,z]}}. Sem valor: o viewer enquadra sozinho.';

drop function public.public_development(text);

create function public.public_development(p_slug text)
returns table (
  slug text,
  name text,
  model_path text,
  detail_model_path text,
  viewer_cameras jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.slug, d.name, d.model_path, d.detail_model_path, d.viewer_cameras
  from public.developments d
  where d.slug = p_slug
    and d.status = 'published';
$$;

revoke all on function public.public_development(text) from public;
grant execute on function public.public_development(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lead com bloco (e-mail e webhook). Igual à versão de 20261115000400, exceto o objeto
-- "unit": + tower {code, name}, floor_label e link_code.
-- ---------------------------------------------------------------------------
create or replace function private.delivery_job(d public.notification_deliveries)
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
          jsonb_build_object(
            'code', u.code,
            'link_code', private.unit_link_code(u.id),
            'tower', jsonb_build_object('code', t.code, 'name', t.name),
            'floor', f.number,
            'floor_label', f.label,
            'type', ut.name
          )
        end
      )
    )
    into v_data
    from public.leads l
    join public.developments dv on dv.id = l.development_id
    left join public.units u on u.id = l.unit_id
    left join public.towers t on t.id = u.tower_id
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
