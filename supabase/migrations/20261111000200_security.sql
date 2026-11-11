-- Vidomo — RLS, privilégios e RPCs de status.
-- Princípios:
--   * Membros só veem e alteram dados da própria organização (regra 1).
--   * anon não tem acesso direto a tabela nenhuma; lê só pelas funções públicas (regra 4).
--   * units.status não tem GRANT de UPDATE: só muda via set_unit_status (regra 2).

-- ---------------------------------------------------------------------------
-- Funções auxiliares de RLS (security definer: consultam organization_members
-- sem recursão de políticas). Ficam no schema private, fora da API.
-- ---------------------------------------------------------------------------
create function private.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create function private.has_org_role(p_organization_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function private.shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

grant usage on schema private to authenticated, anon;
revoke all on all functions in schema private from public;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function private.shares_org_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privilégios de tabela: nada para anon; authenticated só o necessário.
-- ---------------------------------------------------------------------------
revoke all on
  public.organizations, public.profiles, public.organization_members,
  public.developments, public.towers, public.floors, public.unit_types,
  public.units, public.unit_status_history
from anon, authenticated;

grant select on
  public.organizations, public.profiles, public.organization_members,
  public.developments, public.towers, public.floors, public.unit_types,
  public.units, public.unit_status_history
to authenticated;

grant update (full_name) on public.profiles to authenticated;

-- Cadastro do empreendimento (admin). TODO(admin completo): fora desta fatia.
grant insert, update, delete on public.developments, public.towers, public.floors, public.unit_types
to authenticated;

-- units: sem status nos GRANTs de INSERT/UPDATE (unidade nasce 'available').
grant insert (organization_id, development_id, tower_id, floor_id, unit_type_id, code, object_key, price)
  on public.units to authenticated;
grant update (unit_type_id, code, object_key, price) on public.units to authenticated;
grant delete on public.units to authenticated;

-- unit_status_history: somente leitura (o trigger escreve como definer).

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.developments enable row level security;
alter table public.towers enable row level security;
alter table public.floors enable row level security;
alter table public.unit_types enable row level security;
alter table public.units enable row level security;
alter table public.unit_status_history enable row level security;

-- organizations / members: leitura pelos membros. Escrita fica para o admin completo.
create policy organizations_select_member on public.organizations
  for select to authenticated
  using (private.is_org_member(id));

create policy organization_members_select_member on public.organization_members
  for select to authenticated
  using (private.is_org_member(organization_id));

-- profiles: o próprio e os colegas de organização.
create policy profiles_select_self_or_colleague on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Tabelas do empreendimento: membros leem; admin cadastra.
do $$
declare
  t text;
begin
  foreach t in array array['developments', 'towers', 'floors', 'unit_types', 'units'] loop
    execute format(
      'create policy %1$s_select_member on public.%1$s
         for select to authenticated
         using (private.is_org_member(organization_id))', t);
    execute format(
      'create policy %1$s_insert_admin on public.%1$s
         for insert to authenticated
         with check (private.has_org_role(organization_id, array[''admin'']::public.member_role[]))', t);
    execute format(
      'create policy %1$s_update_admin on public.%1$s
         for update to authenticated
         using (private.has_org_role(organization_id, array[''admin'']::public.member_role[]))
         with check (private.has_org_role(organization_id, array[''admin'']::public.member_role[]))', t);
    execute format(
      'create policy %1$s_delete_admin on public.%1$s
         for delete to authenticated
         using (private.has_org_role(organization_id, array[''admin'']::public.member_role[]))', t);
  end loop;
end;
$$;

create policy unit_status_history_select_member on public.unit_status_history
  for select to authenticated
  using (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- RPC: set_unit_status (regra 2)
-- ---------------------------------------------------------------------------
create function public.set_unit_status(
  p_unit_id uuid,
  p_new_status public.unit_status,
  p_reason text default null
)
returns table (
  unit_id uuid,
  object_key text,
  previous_status public.unit_status,
  status public.unit_status,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_object_key text;
  v_previous public.unit_status;
  v_updated_at timestamptz;
  v_role public.member_role;
begin
  if v_uid is null then
    raise exception 'autenticação necessária' using errcode = '42501';
  end if;

  -- Trava a linha apenas se o usuário for membro da organização dona da unidade.
  -- Unidade de outra organização é indistinguível de unidade inexistente.
  select u.object_key, u.status, u.updated_at, m.role
    into v_object_key, v_previous, v_updated_at, v_role
  from public.units u
  join public.organization_members m
    on m.organization_id = u.organization_id
   and m.user_id = v_uid
  where u.id = p_unit_id
  for update of u;

  if not found then
    raise exception 'unidade não encontrada' using errcode = 'P0002';
  end if;

  -- TODO(PRD 6.1): regras finas de transição por papel e por status de origem.
  -- Nesta fatia, admin e vendedor podem levar qualquer status a qualquer outro.
  if v_role not in ('admin', 'sales') then
    raise exception 'papel sem permissão para alterar status' using errcode = '42501';
  end if;

  if v_previous is distinct from p_new_status then
    -- Lido pelo trigger de histórico; vale só para esta transação.
    perform set_config('vidomo.status_reason', coalesce(p_reason, ''), true);

    update public.units u
       set status = p_new_status
     where u.id = p_unit_id
    returning u.updated_at into v_updated_at;

    perform set_config('vidomo.status_reason', '', true);
  end if;

  return query
    select p_unit_id, v_object_key, v_previous, p_new_status, v_updated_at;
end;
$$;

revoke all on function public.set_unit_status(uuid, public.unit_status, text) from public, anon;
grant execute on function public.set_unit_status(uuid, public.unit_status, text) to authenticated;

-- TODO(reserve_unit): reserva com prazo fica fora desta fatia.

-- ---------------------------------------------------------------------------
-- Leitura pública (regra 4): só empreendimentos publicados, só campos públicos.
-- ---------------------------------------------------------------------------
create function public.public_development(p_slug text)
returns table (
  slug text,
  name text,
  model_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.slug, d.name, d.model_path
  from public.developments d
  where d.slug = p_slug
    and d.status = 'published';
$$;

create function public.public_development_units(p_slug text)
returns table (
  object_key text,
  code text,
  tower_code text,
  floor_number integer,
  unit_type_name text,
  area_m2 numeric,
  bedrooms smallint,
  status public.unit_status
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Sem preço nesta fatia. TODO(regra 4): expor preço conforme price_display,
  -- nunca para unidade vendida.
  select u.object_key, u.code, t.code, f.number, ut.name, ut.area_m2, ut.bedrooms, u.status
  from public.developments d
  join public.units u on u.development_id = d.id
  join public.towers t on t.id = u.tower_id
  join public.floors f on f.id = u.floor_id
  left join public.unit_types ut on ut.id = u.unit_type_id
  where d.slug = p_slug
    and d.status = 'published'
  order by t.code, f.number, u.code;
$$;

revoke all on function public.public_development(text) from public;
revoke all on function public.public_development_units(text) from public;
grant execute on function public.public_development(text) to anon, authenticated;
grant execute on function public.public_development_units(text) to anon, authenticated;

-- As funções auxiliares não devem ser chamáveis pela API.
revoke all on function private.touch_updated_at() from public;
revoke all on function private.handle_new_user() from public;
revoke all on function private.record_unit_status_change() from public;
revoke all on function private.forbid_history_mutation() from public;
