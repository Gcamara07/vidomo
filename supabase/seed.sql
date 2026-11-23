-- Vidomo — dados de desenvolvimento (aplicados por `supabase db reset`).
-- Credenciais SOMENTE para o ambiente local; documentadas no README.
--
--   Construtora Exemplo (org A): admin@exemplo.test  / vidomo-dev-123 (admin)
--                                vendas@exemplo.test / vidomo-dev-123 (vendedor)
--   Construtora Teste   (org B): admin@teste.test    / vidomo-dev-123 (admin)
--
-- Chave de ingestão de leads (LEADS_INGEST_KEY) SÓ do ambiente local:
--   vidomo-dev-ingest-key-somente-local-0001

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
      ('a0000000-0000-4000-8000-000000000002'::uuid, 'vendas@exemplo.test', 'Vendedor Exemplo'),
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
  ('a0000000-0000-4000-8000-0000000000a0', 'a0000000-0000-4000-8000-000000000002', 'sales'),
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
       'residencial-vista/residencial-vista-leve-v2.glb',
       'residencial-vista/residencial-vista-detalhes-v2.glb', 'TA', 'Torre A', 10, 4),
      ('b0000000-0000-4000-8000-0000000000b0'::uuid, 'residencial-teste', 'Residencial Teste',
       'draft'::public.development_status, 'hidden'::public.price_display,
       null, null, 'TB', 'Torre B', 2, 2)
    ) as t(org, slug, name, status, price_display, model_path, detail_model_path,
          tower_code, tower_name, floors, per_floor)
  loop
    v_org := d.org;
    v_tower_code := d.tower_code;
    v_floors := d.floors;
    v_per_floor := d.per_floor;

    insert into public.developments
      (organization_id, slug, name, status, price_display, model_path, detail_model_path)
    values (v_org, d.slug, d.name, d.status, d.price_display, d.model_path, d.detail_model_path)
    returning id into v_dev;

    insert into public.towers (organization_id, development_id, code, name)
    values (v_org, v_dev, v_tower_code, d.tower_name)
    returning id into v_tower;

    insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)
    values (v_org, v_dev, 'Tipo A', 58.00, 2, 1)
    returning id into v_type_a;

    insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)
    values (v_org, v_dev, 'Tipo B', 75.00, 3, 1)
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
          code, object_key, status, price, facade, frontage
        ) values (
          v_org, v_dev, v_tower, v_floor, v_type,
          v_code::text,
          format('%s__F%s__U%s', v_tower_code, lpad(f::text, 2, '0'), v_code),
          v_status,
          (case when p % 2 = 1 then 420000 else 530000 end) + f * 8000,
          -- +Y do Blender = norte: posições 1 e 2 na face norte (frente, rua); 3 e 4 na sul (fundos).
          case when p <= 2 then 'norte' else 'sul' end,
          case when p <= 2 then 'frente' else 'fundos' end
        );
      end loop;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Interiores do Residencial Vista (Bloco 3): maquete por tipo de planta e cômodos.
-- Modelados sobre a U201 (Tipo A) e a U202 (Tipo B); etiquetas nas coordenadas do Blender.
-- ---------------------------------------------------------------------------
update public.unit_types ut
   set interior_model_path = i.simple,
       interior_detail_model_path = i.detail,
       interior_reference_unit = i.ref
  from public.developments d,
       (values
         ('Tipo A', 'residencial-vista/interior-tipo-a-simples.glb',
          'residencial-vista/interior-tipo-a.glb', 'TA__F02__U201'),
         ('Tipo B', 'residencial-vista/interior-tipo-b-simples.glb',
          'residencial-vista/interior-tipo-b.glb', 'TA__F02__U202')
       ) as i(type_name, simple, detail, ref)
 where d.id = ut.development_id
   and d.slug = 'residencial-vista'
   and ut.name = i.type_name
   and ut.interior_model_path is null;

insert into public.unit_type_rooms
  (organization_id, unit_type_id, name, area_m2, label_x, label_y, sort_order)
select ut.organization_id, ut.id, r.name, r.area_m2, r.x, r.y, r.sort_order
  from public.developments d
  join public.unit_types ut on ut.development_id = d.id
  join (values
    ('Tipo A', 'Estar · jantar',    20.9, -3.3,  5.0,  1),
    ('Tipo A', 'Varanda',           10.7, -5.2,  9.4,  2),
    ('Tipo A', 'Suíte',              8.8, -8.9,  7.0,  3),
    ('Tipo A', 'Quarto 2',           7.5, -8.0,  2.9,  4),
    ('Tipo A', 'Cozinha · serviço',  6.8, -3.7,  2.9,  5),
    ('Tipo A', 'Banho social',       4.2, -5.8,  3.1,  6),
    ('Tipo A', 'Banho da suíte',     2.7, -7.0,  5.85, 7),
    ('Tipo B', 'Estar · jantar',    21.6,  1.2,  6.0,  1),
    ('Tipo B', 'Varanda',           14.6,  6.6,  9.35, 2),
    ('Tipo B', 'Cozinha · serviço', 12.0,  0.9,  3.0,  3),
    ('Tipo B', 'Suíte',             10.0,  8.3,  5.7,  4),
    ('Tipo B', 'Quarto 2',           9.0,  5.0,  6.6,  5),
    ('Tipo B', 'Quarto 3',           9.0,  8.0,  3.0,  6),
    ('Tipo B', 'Banho social',       3.4,  5.5,  2.6,  7),
    ('Tipo B', 'Banho da suíte',     2.7,  7.2,  7.55, 8)
  ) as r(type_name, name, area_m2, x, y, sort_order) on r.type_name = ut.name
 where d.slug = 'residencial-vista'
on conflict (unit_type_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Leads (Bloco 2): configuração comercial e chave de ingestão de desenvolvimento
-- ---------------------------------------------------------------------------
insert into public.organization_settings (organization_id, whatsapp_number, notification_emails) values
  ('a0000000-0000-4000-8000-0000000000a0', '5516997694880', array['comercial@exemplo.test']),
  ('b0000000-0000-4000-8000-0000000000b0', null, array['comercial@teste.test']);

-- Só o hash vai para o banco; a chave vai em apps/web/.env.local (LEADS_INGEST_KEY).
insert into private.ingest_keys (key_hash, label) values (
  encode(extensions.digest('vidomo-dev-ingest-key-somente-local-0001', 'sha256'), 'hex'),
  'desenvolvimento local'
);

-- Envio de notificações no ambiente local: a Edge Function vista de dentro do banco (rede
-- do Docker) e os links apontando para o Next em desenvolvimento.
update private.notification_runtime
set function_url = 'http://kong:8000/functions/v1/notifications',
    site_url = 'http://localhost:3000';
