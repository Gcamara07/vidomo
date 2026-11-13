-- Vidomo — dados de desenvolvimento (aplicados por `supabase db reset`).
-- Credenciais SOMENTE para o ambiente local; documentadas no README.
--
--   Construtora Exemplo (org A): admin@exemplo.test / vidomo-dev-123
--   Construtora Teste   (org B): admin@teste.test   / vidomo-dev-123

-- ---------------------------------------------------------------------------
-- Usuários do Auth
-- ---------------------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select *
    from (values
      ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@exemplo.test', 'Admin Exemplo'),
      ('b0000000-0000-4000-8000-000000000001'::uuid, 'admin@teste.test', 'Admin Teste')
    ) as t(id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('vidomo-dev-123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', u.full_name), now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizações e membros
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('a0000000-0000-4000-8000-0000000000a0', 'Construtora Exemplo', 'construtora-exemplo'),
  ('b0000000-0000-4000-8000-0000000000b0', 'Construtora Teste', 'construtora-teste');

insert into public.organization_members (organization_id, user_id, role) values
  ('a0000000-0000-4000-8000-0000000000a0', 'a0000000-0000-4000-8000-000000000001', 'admin'),
  ('b0000000-0000-4000-8000-0000000000b0', 'b0000000-0000-4000-8000-000000000001', 'admin');

-- ---------------------------------------------------------------------------
-- Empreendimentos
-- ---------------------------------------------------------------------------
-- Org A: Residencial Vista — publicado, 1 torre (TA), 10 andares x 4 unidades.
-- Org B: Residencial Teste — rascunho, 1 torre (TB), 2 andares x 2 unidades.
do $$
declare
  v_org uuid;
  v_dev uuid;
  v_tower uuid;
  v_floor uuid;
  v_type_a uuid;
  v_type_b uuid;
  v_type uuid;
  v_floors int;
  v_per_floor int;
  v_tower_code text;
  v_status public.unit_status;
  v_code int;
  f int;
  p int;
  -- Distribuição determinística dos 5 status (maioria disponível).
  v_cycle public.unit_status[] := array[
    'available', 'reserved', 'available', 'sold', 'negotiating',
    'available', 'unavailable', 'available', 'sold', 'available', 'reserved'
  ]::public.unit_status[];
  d record;
begin
  for d in
    select *
    from (values
      ('a0000000-0000-4000-8000-0000000000a0'::uuid, 'residencial-vista', 'Residencial Vista',
       'published'::public.development_status, 'from'::public.price_display,
       'residencial-vista/residencial-vista-leve.glb', 'TA', 'Torre A', 10, 4),
      ('b0000000-0000-4000-8000-0000000000b0'::uuid, 'residencial-teste', 'Residencial Teste',
       'draft'::public.development_status, 'hidden'::public.price_display,
       null, 'TB', 'Torre B', 2, 2)
    ) as t(org, slug, name, status, price_display, model_path, tower_code, tower_name, floors, per_floor)
  loop
    v_org := d.org;
    v_tower_code := d.tower_code;
    v_floors := d.floors;
    v_per_floor := d.per_floor;

    insert into public.developments (organization_id, slug, name, status, price_display, model_path)
    values (v_org, d.slug, d.name, d.status, d.price_display, d.model_path)
    returning id into v_dev;

    insert into public.towers (organization_id, development_id, code, name)
    values (v_org, v_dev, v_tower_code, d.tower_name)
    returning id into v_tower;

    insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms)
    values (v_org, v_dev, 'Tipo A', 58.00, 2)
    returning id into v_type_a;

    insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms)
    values (v_org, v_dev, 'Tipo B', 75.00, 3)
    returning id into v_type_b;

    for f in 1..v_floors loop
      insert into public.floors (organization_id, development_id, tower_id, number, object_key)
      values (v_org, v_dev, v_tower, f, format('%s__F%s', v_tower_code, lpad(f::text, 2, '0')))
      returning id into v_floor;

      for p in 1..v_per_floor loop
        v_code := f * 100 + p;
        -- Plantas alternadas: posições ímpares Tipo A, pares Tipo B.
        v_type := case when p % 2 = 1 then v_type_a else v_type_b end;
        v_status := v_cycle[1 + ((f - 1) * v_per_floor + (p - 1)) % array_length(v_cycle, 1)];

        insert into public.units (
          organization_id, development_id, tower_id, floor_id, unit_type_id,
          code, object_key, status, price
        ) values (
          v_org, v_dev, v_tower, v_floor, v_type,
          v_code::text,
          format('%s__F%s__U%s', v_tower_code, lpad(f::text, 2, '0'), v_code),
          v_status,
          (case when p % 2 = 1 then 420000 else 530000 end) + f * 8000
        );
      end loop;
    end loop;
  end loop;
end;
$$;
