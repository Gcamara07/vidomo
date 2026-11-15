-- Ficha completa da unidade (Bloco 1, etapa 3):
--   * unit_types.suites e unit_types.plan_image_path (planta 2D no bucket público "plans")
--   * units.facade (face da fachada) e units.frontage (frente/fundos)
--   * public_development_units passa a devolver esses campos e o PREÇO JÁ RESOLVIDO pela
--     regra do empreendimento (price_display, PRD 6.3). A regra fica aqui, nunca no front:
--       hidden → nenhum preço ("Consulte condições")
--       from   → menor preço entre as unidades DISPONÍVEIS do mesmo tipo de planta;
--                sem disponíveis do tipo → nenhum preço
--       exact  → preço da própria unidade (inclusive reservada / em negociação)
--       unidade vendida → nunca mostra preço

alter table public.unit_types
  add column suites smallint check (suites >= 0),
  add column plan_image_path text;

comment on column public.unit_types.plan_image_path is
  'Caminho da planta 2D no bucket público "plans" (servida via getAssetUrl).';

alter table public.units
  add column facade text check (facade in ('norte', 'sul', 'leste', 'oeste')),
  add column frontage text check (frontage in ('frente', 'fundos'));

comment on column public.units.facade is 'Face da fachada da unidade (norte, sul, leste, oeste).';
comment on column public.units.frontage is 'Frente (lado da rua) ou fundos.';

-- Colunas novas entram nos GRANTs de escrita do admin (status continua de fora).
grant insert (facade, frontage) on public.units to authenticated;
grant update (facade, frontage) on public.units to authenticated;

-- Preço público de uma unidade, conforme a regra do empreendimento. Interna (private).
create function private.public_unit_price(p_unit_id uuid)
returns table (price numeric, price_kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when u.status = 'sold' then null
      when d.price_display = 'exact' then u.price
      when d.price_display = 'from' then (
        select min(o.price)
        from public.units o
        where o.development_id = u.development_id
          and o.unit_type_id is not distinct from u.unit_type_id
          and o.status = 'available'
          and o.price is not null
      )
      else null
    end,
    case
      when u.status = 'sold' then null
      when d.price_display = 'exact' and u.price is not null then 'exact'
      when d.price_display = 'from' and exists (
        select 1
        from public.units o
        where o.development_id = u.development_id
          and o.unit_type_id is not distinct from u.unit_type_id
          and o.status = 'available'
          and o.price is not null
      ) then 'from'
      else null
    end
  from public.units u
  join public.developments d on d.id = u.development_id
  where u.id = p_unit_id;
$$;

revoke all on function private.public_unit_price(uuid) from public;

-- O tipo de retorno mudou: recria a função pública.
drop function public.public_development_units(text);

create function public.public_development_units(p_slug text)
returns table (
  object_key text,
  code text,
  tower_code text,
  floor_number integer,
  unit_type_name text,
  area_m2 numeric,
  bedrooms smallint,
  suites smallint,
  plan_image_path text,
  facade text,
  frontage text,
  status public.unit_status,
  price numeric,
  price_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.object_key, u.code, t.code, f.number,
    ut.name, ut.area_m2, ut.bedrooms, ut.suites, ut.plan_image_path,
    u.facade, u.frontage, u.status,
    p.price, p.price_kind
  from public.developments d
  join public.units u on u.development_id = d.id
  join public.towers t on t.id = u.tower_id
  join public.floors f on f.id = u.floor_id
  left join public.unit_types ut on ut.id = u.unit_type_id
  cross join lateral private.public_unit_price(u.id) p
  where d.slug = p_slug
    and d.status = 'published'
  order by t.code, f.number, u.code;
$$;

revoke all on function public.public_development_units(text) from public;
grant execute on function public.public_development_units(text) to anon, authenticated;

-- Plantas 2D: bucket público, como o de modelos. Upload só com service_role.
-- TODO(sigilo pré-lançamento): URLs assinadas para empreendimentos em rascunho.
insert into storage.buckets (id, name, public)
values ('plans', 'plans', true)
on conflict (id) do nothing;
