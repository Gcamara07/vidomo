-- Vidomo — Realtime.
--
-- 1) postgres_changes em units: para o painel (authenticated). O Realtime aplica a
--    RLS de units, então cada membro só recebe linhas da própria organização.
--
-- 2) Broadcast privado para o comprador anônimo: o anon não lê units, então um
--    trigger publica só {object_key, status} no tópico development:<slug>, e só
--    quando o empreendimento está publicado.
--    * Receber: anon/authenticated podem assinar development:<slug> de
--      empreendimento publicado (política SELECT em realtime.messages).
--    * Publicar: não há política INSERT em realtime.messages para anon/authenticated;
--      só o trigger (security definer, dono do banco) publica.
--    * O Broadcast não reenvia mensagens perdidas: o cliente refaz a leitura pela
--      função pública ao reconectar (implementado na página pública).

alter publication supabase_realtime add table public.units;

-- ---------------------------------------------------------------------------
-- Publicação pelo trigger
-- ---------------------------------------------------------------------------
create function private.broadcast_unit_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  select d.slug into v_slug
  from public.developments d
  where d.id = new.development_id
    and d.status = 'published';

  if v_slug is null then
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object('object_key', new.object_key, 'status', new.status),
    'unit_status',
    'development:' || v_slug,
    true -- canal privado: passa pela autorização de realtime.messages
  );
  return null;
end;
$$;

revoke all on function private.broadcast_unit_status() from public;

create trigger units_broadcast_status
  after insert or update of status on public.units
  for each row execute function private.broadcast_unit_status();

-- ---------------------------------------------------------------------------
-- Autorização de leitura do tópico
-- ---------------------------------------------------------------------------
create function private.is_public_development_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_topic like 'development:%'
     and exists (
       select 1
       from public.developments d
       where d.slug = substr(p_topic, length('development:') + 1)
         and d.status = 'published'
     );
$$;

revoke all on function private.is_public_development_topic(text) from public;
grant execute on function private.is_public_development_topic(text) to anon, authenticated;

create policy development_topic_receive on realtime.messages
  for select to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.is_public_development_topic((select realtime.topic()))
  );

-- Intencionalmente sem política INSERT: clientes não publicam em canais privados.
