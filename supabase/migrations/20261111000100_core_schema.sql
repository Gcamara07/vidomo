-- Vidomo — esquema base da fatia vertical.
-- Toda tabela de dados de cliente carrega organization_id (regra 1). A coerência
-- entre organization_id do filho e do pai é garantida por FKs compostas
-- (id, organization_id), então um registro nunca aponta para outra organização.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'sales');
create type public.development_status as enum ('draft', 'published');
create type public.price_display as enum ('hidden', 'from', 'exact');
create type public.unit_status as enum ('available', 'reserved', 'negotiating', 'sold', 'unavailable');

-- ---------------------------------------------------------------------------
-- Utilitário: updated_at
-- ---------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizações e pessoas
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Regra 6: diferenças entre clientes vêm daqui.
  -- TODO(tema por organização / subdomínios): fora desta fatia.
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_id_idx on public.organization_members (user_id);

-- Cria o profile quando um usuário do Auth nasce.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Empreendimento
-- ---------------------------------------------------------------------------
create table public.developments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Único global porque a rota pública é /e/<slug>.
  -- TODO(subdomínios): passar a único por organização quando houver subdomínio.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  status public.development_status not null default 'draft',
  price_display public.price_display not null default 'hidden',
  -- Caminho do GLB no Storage, resolvido no app por getAssetUrl() (regra 7).
  model_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index developments_organization_id_idx on public.developments (organization_id);

create table public.towers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  development_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9]+$'),
  name text not null,
  created_at timestamptz not null default now(),
  unique (development_id, code),
  unique (id, organization_id),
  unique (id, development_id),
  foreign key (development_id, organization_id)
    references public.developments (id, organization_id) on delete cascade
);
create index towers_organization_id_idx on public.towers (organization_id);

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  development_id uuid not null,
  tower_id uuid not null,
  number integer not null,
  -- Nome do objeto FLOOR__… sem o prefixo (ex.: TA__F08).
  object_key text not null,
  created_at timestamptz not null default now(),
  unique (tower_id, number),
  unique (development_id, object_key),
  unique (id, organization_id),
  unique (id, tower_id),
  foreign key (development_id, organization_id)
    references public.developments (id, organization_id) on delete cascade,
  foreign key (tower_id, development_id)
    references public.towers (id, development_id) on delete cascade
);
create index floors_organization_id_idx on public.floors (organization_id);

create table public.unit_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  development_id uuid not null,
  name text not null,
  area_m2 numeric(8, 2) not null check (area_m2 > 0),
  bedrooms smallint not null check (bedrooms >= 0),
  created_at timestamptz not null default now(),
  unique (development_id, name),
  unique (id, organization_id),
  unique (id, development_id),
  foreign key (development_id, organization_id)
    references public.developments (id, organization_id) on delete cascade
);
create index unit_types_organization_id_idx on public.unit_types (organization_id);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  development_id uuid not null,
  tower_id uuid not null,
  floor_id uuid not null,
  unit_type_id uuid,
  code text not null,
  -- Nome do objeto UNIT__… sem o prefixo (ex.: TA__F08__U802). Único por empreendimento.
  object_key text not null,
  -- Regra 2: só muda por set_unit_status (a coluna não tem GRANT de UPDATE).
  status public.unit_status not null default 'available',
  -- Privado: nunca sai pela função pública. TODO(regra 4): exibição conforme price_display.
  price numeric(14, 2) check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (development_id, object_key),
  unique (tower_id, code),
  unique (id, organization_id),
  foreign key (development_id, organization_id)
    references public.developments (id, organization_id) on delete cascade,
  foreign key (tower_id, development_id)
    references public.towers (id, development_id) on delete cascade,
  foreign key (floor_id, tower_id)
    references public.floors (id, tower_id) on delete cascade,
  foreign key (unit_type_id, development_id)
    references public.unit_types (id, development_id)
);
create index units_organization_id_idx on public.units (organization_id);
create index units_floor_id_idx on public.units (floor_id);
create index units_unit_type_id_idx on public.units (unit_type_id);
create index units_development_status_idx on public.units (development_id, status);

create trigger units_touch_updated_at
  before update on public.units
  for each row execute function private.touch_updated_at();
create trigger developments_touch_updated_at
  before update on public.developments
  for each row execute function private.touch_updated_at();
create trigger organizations_touch_updated_at
  before update on public.organizations
  for each row execute function private.touch_updated_at();
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Histórico de status (regra 3): só o trigger escreve; UPDATE/DELETE bloqueados.
-- ---------------------------------------------------------------------------
create table public.unit_status_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  development_id uuid not null,
  -- restrict: histórico não some junto com a unidade.
  unit_id uuid not null,
  from_status public.unit_status,
  to_status public.unit_status not null,
  reason text,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  foreign key (unit_id, organization_id)
    references public.units (id, organization_id) on delete restrict
);
create index unit_status_history_unit_idx on public.unit_status_history (unit_id, changed_at desc);
create index unit_status_history_organization_id_idx on public.unit_status_history (organization_id);

create function private.record_unit_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  insert into public.unit_status_history
    (organization_id, development_id, unit_id, from_status, to_status, reason, changed_by)
  values (
    new.organization_id,
    new.development_id,
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    nullif(current_setting('vidomo.status_reason', true), ''),
    auth.uid()
  );
  return new;
end;
$$;

create trigger units_record_status_change
  after insert or update of status on public.units
  for each row execute function private.record_unit_status_change();

create function private.forbid_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'unit_status_history é imutável (% bloqueado)', tg_op
    using errcode = '42501';
end;
$$;

create trigger unit_status_history_immutable
  before update or delete on public.unit_status_history
  for each row execute function private.forbid_history_mutation();
create trigger unit_status_history_no_truncate
  before truncate on public.unit_status_history
  for each statement execute function private.forbid_history_mutation();
