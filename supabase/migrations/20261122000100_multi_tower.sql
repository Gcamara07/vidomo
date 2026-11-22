-- Bloco M: empreendimentos com vários blocos (torres).
--
-- O esquema já aceita N torres por empreendimento (towers.unique (development_id, code)).
-- Faltava, para mostrar vários blocos ao comprador:
--   * towers.sort_order  ordem de exibição dos blocos (seletor, links); empate por código
--   * towers.short_name  nome curto ("09"): rótulo no 3D, chips e ?bloco=09 (o nome
--                        completo, "Bloco 09", segue em towers.name)
--   * floors.label       rótulo opcional do andar ("Térreo"); sem rótulo, "<número>º"
-- e a função pública passa a devolver esses campos (regra 4: só campos públicos).

alter table public.towers
  add column sort_order integer not null default 0,
  add column short_name text check (short_name ~ '^[A-Za-z0-9]{1,8}$');

comment on column public.towers.sort_order is
  'Ordem de exibição dos blocos (crescente; empate pelo código).';
comment on column public.towers.short_name is
  'Nome curto do bloco (ex.: 09): rótulo no 3D, chips e links ?bloco=. Sem valor: o código.';

alter table public.floors
  add column label text check (char_length(label) between 1 and 24);

comment on column public.floors.label is
  'Rótulo do andar (ex.: Térreo). Sem valor: "<número>º".';

-- Campos novos entram no retorno: recria a função pública (mesmas regras de acesso).
drop function public.public_development_units(text);

create function public.public_development_units(p_slug text)
returns table (
  object_key text,
  code text,
  tower_code text,
  tower_name text,
  tower_short_name text,
  tower_sort_order integer,
  floor_number integer,
  floor_label text,
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
    u.object_key, u.code,
    t.code, t.name, t.short_name, t.sort_order,
    f.number, f.label,
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
  order by t.sort_order, t.code, f.number, u.code;
$$;

revoke all on function public.public_development_units(text) from public;
grant execute on function public.public_development_units(text) to anon, authenticated;
