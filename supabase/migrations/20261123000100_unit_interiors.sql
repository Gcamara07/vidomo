-- Bloco 3, etapa 2: interior da unidade (maquete) por tipo de planta.
--
--   * unit_types.interior_model_path         GLB simples (modo andar), bucket "models"
--   * unit_types.interior_detail_model_path  GLB detalhado ("Ver apartamento"), bucket "models"
--   * unit_types.interior_reference_unit     object_key da unidade de referência
--   * unit_type_rooms                        cômodos do tipo (nome, área, etiqueta, ordem)
--   * public_development_unit_types          função pública: tipos, interiores e cômodos
--
-- Envoltória de referência: guardamos só a chave da unidade sobre a qual o interior foi
-- modelado (ex.: TA__F02__U201). A envoltória sai da caixa UNIT__ dela no GLB do prédio,
-- que é a mesma fonte de verdade das outras unidades: se a caixa mudar no Blender, o
-- encaixe acompanha, sem números duplicados no banco. A chave precisa ser de uma unidade
-- do mesmo empreendimento (conferido por trigger; o tipo dela, pelo validador).
--
-- Por que trigger e não chave estrangeira: uma FK de unit_types para units criaria uma
-- segunda relação entre as duas tabelas, e as consultas que embutem unit_types(name) a
-- partir de units (painel) passariam a ser ambíguas no PostgREST, inclusive na versão do
-- app já publicada, que roda contra o banco novo até o próximo deploy.

alter table public.unit_types
  add column interior_model_path text check (char_length(interior_model_path) between 1 and 300),
  add column interior_detail_model_path text
    check (char_length(interior_detail_model_path) between 1 and 300),
  add column interior_reference_unit text,
  -- Sem modelo simples, não há interior: os outros campos não fazem sentido sozinhos.
  add constraint unit_types_interior_complete check (
    (interior_model_path is null
      and interior_detail_model_path is null
      and interior_reference_unit is null)
    or (interior_model_path is not null and interior_reference_unit is not null)
  );

-- Unidade de referência do mesmo empreendimento (ao gravar o tipo). Apagar a unidade depois
-- não é bloqueado: o validador do modelo e o viewer avisam a referência que sumiu.
create function private.check_interior_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.interior_reference_unit is not null and not exists (
    select 1
    from public.units u
    where u.development_id = new.development_id
      and u.object_key = new.interior_reference_unit
  ) then
    raise exception 'unidade de referência % não existe neste empreendimento',
      new.interior_reference_unit
      using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function private.check_interior_reference() from public, anon, authenticated;

create trigger unit_types_check_interior_reference
  before insert or update of interior_reference_unit, development_id on public.unit_types
  for each row execute function private.check_interior_reference();

comment on column public.unit_types.interior_model_path is
  'GLB simples do interior (maquete no modo andar), bucket "models", servido via getAssetUrl.';
comment on column public.unit_types.interior_detail_model_path is
  'GLB detalhado do interior ("Ver apartamento"), bucket "models".';
comment on column public.unit_types.interior_reference_unit is
  'object_key da unidade sobre a qual o interior foi modelado (envoltória de referência).';

-- ---------------------------------------------------------------------------
-- Cômodos do tipo de planta
-- ---------------------------------------------------------------------------
create table public.unit_type_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_type_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  area_m2 numeric(6, 2) not null check (area_m2 > 0),
  -- Posição da etiqueta nas coordenadas do interior (Blender: x, y; z para cima).
  label_x numeric(8, 3) not null,
  label_y numeric(8, 3) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (unit_type_id, name),
  foreign key (unit_type_id, organization_id)
    references public.unit_types (id, organization_id) on delete cascade
);
create index unit_type_rooms_organization_id_idx on public.unit_type_rooms (organization_id);
create index unit_type_rooms_unit_type_id_idx on public.unit_type_rooms (unit_type_id, sort_order);

comment on table public.unit_type_rooms is
  'Cômodos de um tipo de planta: nome, área e posição da etiqueta no "Ver apartamento".';

-- Privilégios e RLS: como as outras tabelas do empreendimento (membros leem, admin escreve).
revoke all on public.unit_type_rooms from anon, authenticated;
grant select, insert, update, delete on public.unit_type_rooms to authenticated;

alter table public.unit_type_rooms enable row level security;

create policy unit_type_rooms_select_member on public.unit_type_rooms
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy unit_type_rooms_insert_admin on public.unit_type_rooms
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['admin']::public.member_role[]));
create policy unit_type_rooms_update_admin on public.unit_type_rooms
  for update to authenticated
  using (private.has_org_role(organization_id, array['admin']::public.member_role[]))
  with check (private.has_org_role(organization_id, array['admin']::public.member_role[]));
create policy unit_type_rooms_delete_admin on public.unit_type_rooms
  for delete to authenticated
  using (private.has_org_role(organization_id, array['admin']::public.member_role[]));

-- ---------------------------------------------------------------------------
-- Função pública (regra 4): tipos de planta do empreendimento publicado, com o interior e
-- os cômodos. Só campos públicos; rascunho não devolve nada.
-- ---------------------------------------------------------------------------
create function public.public_development_unit_types(p_slug text)
returns table (
  name text,
  area_m2 numeric,
  bedrooms smallint,
  suites smallint,
  interior_model_path text,
  interior_detail_model_path text,
  interior_reference_unit text,
  rooms jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ut.name, ut.area_m2, ut.bedrooms, ut.suites,
    ut.interior_model_path, ut.interior_detail_model_path, ut.interior_reference_unit,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('name', r.name, 'area_m2', r.area_m2, 'x', r.label_x, 'y', r.label_y)
          order by r.sort_order, r.name
        )
        from public.unit_type_rooms r
        where r.unit_type_id = ut.id
      ),
      '[]'::jsonb
    )
  from public.developments d
  join public.unit_types ut on ut.development_id = d.id
  where d.slug = p_slug
    and d.status = 'published'
  order by ut.name;
$$;

revoke all on function public.public_development_unit_types(text) from public;
grant execute on function public.public_development_unit_types(text) to anon, authenticated;
