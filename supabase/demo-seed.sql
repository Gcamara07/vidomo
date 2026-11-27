-- Vidomo — dados do AMBIENTE DE DEMONSTRAÇÃO (Supabase remoto).
--
-- Diferente de supabase/seed.sql (desenvolvimento local):
--   * só a Construtora Exemplo, o Residencial Vista (40 unidades) e o Residencial Jardim das
--     Águas (96 unidades), publicados;
--   * sem a Construtora Teste e SEM usuários/senhas — o admin da demo é criado à parte por
--     scripts/demo-admin.ts, com senha forte gerada na hora e nunca gravada em arquivo.
--
-- Aplicar (pede confirmação; é escrita no remoto):
--   pnpm exec supabase db query --remote -f supabase/demo-seed.sql
--
-- Idempotente: se o Residencial Vista já existir, não recria nada; só completa os atributos
-- que vieram depois (suítes, face, frente/fundos) onde ainda estiverem vazios.
-- ATENÇÃO: nunca rode `supabase db reset --remote` — ele aplicaria o seed.sql de dev.

do $$
declare
  v_org uuid := 'a0000000-0000-4000-8000-0000000000a0';
  v_dev uuid;
  v_tower uuid;
  v_floor uuid;
  v_type_a uuid;
  v_type_b uuid;
  v_status public.unit_status;
  v_code int;
  f int;
  p int;
  -- Mesma distribuição determinística dos 5 status do ambiente local.
  v_cycle public.unit_status[] := array[
    'available', 'reserved', 'available', 'sold', 'negotiating',
    'available', 'unavailable', 'available', 'sold', 'available', 'reserved'
  ]::public.unit_status[];
begin
  if exists (select 1 from public.developments where slug = 'residencial-vista') then
    raise notice 'Residencial Vista já existe: nada a fazer.';
    return;
  end if;

  insert into public.organizations (id, name, slug)
  values (v_org, 'Construtora Exemplo', 'construtora-exemplo')
  on conflict (id) do nothing;

  insert into public.developments
    (organization_id, slug, name, status, price_display, model_path, detail_model_path)
  values (
    v_org, 'residencial-vista', 'Residencial Vista', 'published', 'from',
    'residencial-vista/residencial-vista-leve.glb',
    'residencial-vista/residencial-vista-detalhes.glb'
  )
  returning id into v_dev;

  insert into public.towers (organization_id, development_id, code, name)
  values (v_org, v_dev, 'TA', 'Torre A')
  returning id into v_tower;

  -- Conforme o modelo do Blender: finais 1 e 3 Tipo A, finais 2 e 4 Tipo B.
  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)
  values (v_org, v_dev, 'Tipo A', 58.00, 2, 1)
  returning id into v_type_a;

  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)
  values (v_org, v_dev, 'Tipo B', 75.00, 3, 1)
  returning id into v_type_b;

  for f in 1..10 loop
    insert into public.floors (organization_id, development_id, tower_id, number, object_key)
    values (v_org, v_dev, v_tower, f, format('TA__F%s', lpad(f::text, 2, '0')))
    returning id into v_floor;

    for p in 1..4 loop
      v_code := f * 100 + p;
      v_status := v_cycle[1 + ((f - 1) * 4 + (p - 1)) % array_length(v_cycle, 1)];
      insert into public.units (
        organization_id, development_id, tower_id, floor_id, unit_type_id,
        code, object_key, status, price, facade, frontage
      ) values (
        v_org, v_dev, v_tower, v_floor,
        case when p % 2 = 1 then v_type_a else v_type_b end,
        v_code::text,
        format('TA__F%s__U%s', lpad(f::text, 2, '0'), v_code),
        v_status,
        (case when p % 2 = 1 then 420000 else 530000 end) + f * 8000,
        -- Modelo do Blender (+Y = norte): finais 1 e 2 na face norte, lado da rua (frente);
        -- 3 e 4 na face sul, lado da piscina e do lazer (fundos).
        case when p <= 2 then 'norte' else 'sul' end,
        case when p <= 2 then 'frente' else 'fundos' end
      );
    end loop;
  end loop;

  raise notice 'Residencial Vista criado com 40 unidades.';
end;
$$;

-- Atributos da ficha completa (Bloco 1): completa dados já existentes, sem sobrescrever.
update public.unit_types ut
   set suites = 1
  from public.developments d
 where d.id = ut.development_id
   and d.slug = 'residencial-vista'
   and ut.name in ('Tipo A', 'Tipo B')
   and ut.suites is null;

update public.units u
   set facade = case when right(u.code, 1) in ('1', '2') then 'norte' else 'sul' end,
       frontage = case when right(u.code, 1) in ('1', '2') then 'frente' else 'fundos' end
  from public.developments d
 where d.id = u.development_id
   and d.slug = 'residencial-vista'
   and (u.facade is null or u.frontage is null);

-- Configuração comercial da demo (Bloco 2). Não sobrescreve o que o admin já mudou
-- pelo /painel/config. A chave de ingestão NÃO fica aqui: o hash é gravado à parte
-- (ver README, "Leads e notificações").
insert into public.organization_settings (organization_id, whatsapp_number, notification_emails)
values ('a0000000-0000-4000-8000-0000000000a0', '5516997694880', array['gabriel@vidomo.com.br'])
on conflict (organization_id) do nothing;

-- Fachada nova (Bloco 3, etapa 1b): modelos v2 do Vista. Só troca se ainda estiver no v1.
-- Na publicação, os GLBs v2 e os interiores sobem ao Storage ANTES deste seed.
update public.developments
   set model_path = 'residencial-vista/residencial-vista-leve-v2.glb',
       detail_model_path = 'residencial-vista/residencial-vista-detalhes-v2.glb'
 where slug = 'residencial-vista'
   and model_path = 'residencial-vista/residencial-vista-leve.glb';

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
-- Residencial Jardim das Águas (segundo demo): cópia de supabase/seeds/jardim-das-aguas.sql,
-- gerado por `pnpm model:seed` a partir de supabase/seeds/jardim-das-aguas.json.
-- Idempotente pelo slug. Na publicação, os GLBs sobem ao Storage ANTES deste seed.
-- ---------------------------------------------------------------------------
-- Gerado por scripts/seed-from-model.ts a partir de modelos/jardim-das-aguas-leve.glb.
-- Versionado. Carregado pelo `supabase db reset` (local) e copiado no fim do supabase/demo-seed.sql (remoto). Não edite à mão: mude supabase/seeds/jardim-das-aguas.json e gere de novo.
--
-- Dados ainda sem campo no banco (não aparecem na página; ficam aqui para um bloco futuro):
--   Cidade: Araraquara/SP
--   Endereço: Rua Exemplo de Demonstração, 100 — Jardim Fictício, Araraquara/SP
--             (empreendimento demonstrativo, endereço fictício)
--   Chamada: 6 blocos · 96 apartamentos · lazer completo
--   Áreas comuns (AMENITY__ no modelo, só no 3D):
--     PORTARIA       Portaria 24 h, com controle de acesso de pedestres e veículos
--     SALAO          Salão de festas envidraçado
--     CHURRASQUEIRA  Espaço gourmet com churrasqueira
--     PISCINA        Piscina adulto e infantil, com deck e solário
--     PLAYGROUND     Playground
--     PET            Pet place
--     QUADRA         Quadra poliesportiva
--
-- Preços fictícios e exatos (4º andar R$ 3.000 a menos: sem elevador). Portaria e rua ao sul:
-- finais 3 e 4 = frente, finais 1 e 2 = fundos.
do $$
declare
  v_org uuid := 'a0000000-0000-4000-8000-0000000000a0';
  v_dev uuid;
  v_tower uuid;
  v_floor uuid;
  v_type_0 uuid;
  v_type_1 uuid;
  v_type_2 uuid;
  v_type_3 uuid;
begin
  if exists (select 1 from public.developments where slug = 'jardim-das-aguas') then
    return;
  end if;

  insert into public.developments
    (organization_id, slug, name, status, price_display, model_path, detail_model_path, viewer_cameras)
  values (v_org, 'jardim-das-aguas', 'Residencial Jardim das Águas', 'published', 'from', 'jardim-das-aguas/jardim-das-aguas-leve.glb', 'jardim-das-aguas/jardim-das-aguas-detalhes.glb', '{"default":{"position":[0,336,250],"target":[0,0,8]}}'::jsonb)
  returning id into v_dev;

  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)
  values (v_org, v_dev, 'Tipo A', 46.00, 2, 0)
  returning id into v_type_0;
  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)
  values (v_org, v_dev, 'Tipo B', 53.00, 2, 1)
  returning id into v_type_1;
  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)
  values (v_org, v_dev, 'Tipo A térreo com quintal', 59.00, 2, 0)
  returning id into v_type_2;
  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)
  values (v_org, v_dev, 'Tipo B térreo com quintal', 68.00, 2, 1)
  returning id into v_type_3;

  -- B01
  insert into public.towers (organization_id, development_id, code, name, short_name, sort_order)
  values (v_org, v_dev, 'B01', 'Bloco 01', '01', 1)
  returning id into v_tower;
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 1, 'B01__F01', 'Térreo')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_2, '101', 'B01__F01__U101', 'sold', 252000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '102', 'B01__F01__U102', 'sold', 295000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_2, '103', 'B01__F01__U103', 'available', 252000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '104', 'B01__F01__U104', 'unavailable', 295000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 2, 'B01__F02', '2º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '201', 'B01__F02__U201', 'available', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '202', 'B01__F02__U202', 'negotiating', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '203', 'B01__F02__U203', 'sold', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '204', 'B01__F02__U204', 'sold', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 3, 'B01__F03', '3º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '301', 'B01__F03__U301', 'sold', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '302', 'B01__F03__U302', 'available', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '303', 'B01__F03__U303', 'available', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '304', 'B01__F03__U304', 'available', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 4, 'B01__F04', '4º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '401', 'B01__F04__U401', 'sold', 232000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '402', 'B01__F04__U402', 'sold', 272000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '403', 'B01__F04__U403', 'available', 232000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '404', 'B01__F04__U404', 'available', 272000, 'sul', 'frente');

  -- B02
  insert into public.towers (organization_id, development_id, code, name, short_name, sort_order)
  values (v_org, v_dev, 'B02', 'Bloco 02', '02', 2)
  returning id into v_tower;
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 1, 'B02__F01', 'Térreo')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_2, '101', 'B02__F01__U101', 'sold', 252000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '102', 'B02__F01__U102', 'available', 295000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_2, '103', 'B02__F01__U103', 'available', 252000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '104', 'B02__F01__U104', 'sold', 295000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 2, 'B02__F02', '2º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '201', 'B02__F02__U201', 'negotiating', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '202', 'B02__F02__U202', 'available', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '203', 'B02__F02__U203', 'reserved', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '204', 'B02__F02__U204', 'available', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 3, 'B02__F03', '3º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '301', 'B02__F03__U301', 'available', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '302', 'B02__F03__U302', 'reserved', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '303', 'B02__F03__U303', 'unavailable', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '304', 'B02__F03__U304', 'sold', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 4, 'B02__F04', '4º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '401', 'B02__F04__U401', 'available', 232000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '402', 'B02__F04__U402', 'available', 272000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '403', 'B02__F04__U403', 'available', 232000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '404', 'B02__F04__U404', 'available', 272000, 'sul', 'frente');

  -- B03
  insert into public.towers (organization_id, development_id, code, name, short_name, sort_order)
  values (v_org, v_dev, 'B03', 'Bloco 03', '03', 3)
  returning id into v_tower;
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 1, 'B03__F01', 'Térreo')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_2, '101', 'B03__F01__U101', 'sold', 252000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '102', 'B03__F01__U102', 'negotiating', 295000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_2, '103', 'B03__F01__U103', 'sold', 252000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '104', 'B03__F01__U104', 'available', 295000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 2, 'B03__F02', '2º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '201', 'B03__F02__U201', 'available', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '202', 'B03__F02__U202', 'reserved', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '203', 'B03__F02__U203', 'sold', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '204', 'B03__F02__U204', 'available', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 3, 'B03__F03', '3º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '301', 'B03__F03__U301', 'sold', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '302', 'B03__F03__U302', 'sold', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '303', 'B03__F03__U303', 'available', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '304', 'B03__F03__U304', 'available', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 4, 'B03__F04', '4º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '401', 'B03__F04__U401', 'sold', 232000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '402', 'B03__F04__U402', 'sold', 272000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '403', 'B03__F04__U403', 'sold', 232000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '404', 'B03__F04__U404', 'unavailable', 272000, 'sul', 'frente');

  -- B04
  insert into public.towers (organization_id, development_id, code, name, short_name, sort_order)
  values (v_org, v_dev, 'B04', 'Bloco 04', '04', 4)
  returning id into v_tower;
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 1, 'B04__F01', 'Térreo')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_2, '101', 'B04__F01__U101', 'available', 252000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '102', 'B04__F01__U102', 'reserved', 295000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_2, '103', 'B04__F01__U103', 'sold', 252000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '104', 'B04__F01__U104', 'sold', 295000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 2, 'B04__F02', '2º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '201', 'B04__F02__U201', 'available', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '202', 'B04__F02__U202', 'available', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '203', 'B04__F02__U203', 'reserved', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '204', 'B04__F02__U204', 'sold', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 3, 'B04__F03', '3º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '301', 'B04__F03__U301', 'available', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '302', 'B04__F03__U302', 'available', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '303', 'B04__F03__U303', 'negotiating', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '304', 'B04__F03__U304', 'sold', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 4, 'B04__F04', '4º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '401', 'B04__F04__U401', 'available', 232000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '402', 'B04__F04__U402', 'negotiating', 272000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '403', 'B04__F04__U403', 'available', 232000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '404', 'B04__F04__U404', 'reserved', 272000, 'sul', 'frente');

  -- B05
  insert into public.towers (organization_id, development_id, code, name, short_name, sort_order)
  values (v_org, v_dev, 'B05', 'Bloco 05', '05', 5)
  returning id into v_tower;
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 1, 'B05__F01', 'Térreo')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_2, '101', 'B05__F01__U101', 'reserved', 252000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '102', 'B05__F01__U102', 'unavailable', 295000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_2, '103', 'B05__F01__U103', 'negotiating', 252000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '104', 'B05__F01__U104', 'available', 295000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 2, 'B05__F02', '2º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '201', 'B05__F02__U201', 'sold', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '202', 'B05__F02__U202', 'sold', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '203', 'B05__F02__U203', 'available', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '204', 'B05__F02__U204', 'negotiating', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 3, 'B05__F03', '3º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '301', 'B05__F03__U301', 'available', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '302', 'B05__F03__U302', 'negotiating', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '303', 'B05__F03__U303', 'available', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '304', 'B05__F03__U304', 'available', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 4, 'B05__F04', '4º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '401', 'B05__F04__U401', 'available', 232000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '402', 'B05__F04__U402', 'reserved', 272000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '403', 'B05__F04__U403', 'available', 232000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '404', 'B05__F04__U404', 'sold', 272000, 'sul', 'frente');

  -- B06
  insert into public.towers (organization_id, development_id, code, name, short_name, sort_order)
  values (v_org, v_dev, 'B06', 'Bloco 06', '06', 6)
  returning id into v_tower;
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 1, 'B06__F01', 'Térreo')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_2, '101', 'B06__F01__U101', 'available', 252000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '102', 'B06__F01__U102', 'sold', 295000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_2, '103', 'B06__F01__U103', 'sold', 252000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_3, '104', 'B06__F01__U104', 'available', 295000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 2, 'B06__F02', '2º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '201', 'B06__F02__U201', 'reserved', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '202', 'B06__F02__U202', 'sold', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '203', 'B06__F02__U203', 'available', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '204', 'B06__F02__U204', 'available', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 3, 'B06__F03', '3º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '301', 'B06__F03__U301', 'available', 235000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '302', 'B06__F03__U302', 'unavailable', 275000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '303', 'B06__F03__U303', 'available', 235000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '304', 'B06__F03__U304', 'available', 275000, 'sul', 'frente');
  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)
  values (v_org, v_dev, v_tower, 4, 'B06__F04', '4º')
  returning id into v_floor;
  insert into public.units (
    organization_id, development_id, tower_id, floor_id, unit_type_id,
    code, object_key, status, price, facade, frontage
  ) values
    (v_org, v_dev, v_tower, v_floor, v_type_0, '401', 'B06__F04__U401', 'available', 232000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '402', 'B06__F04__U402', 'reserved', 272000, 'norte', 'fundos'),
    (v_org, v_dev, v_tower, v_floor, v_type_0, '403', 'B06__F04__U403', 'unavailable', 232000, 'sul', 'frente'),
    (v_org, v_dev, v_tower, v_floor, v_type_1, '404', 'B06__F04__U404', 'sold', 272000, 'sul', 'frente');

  -- Interior: Tipo A
  update public.unit_types
     set interior_model_path = 'jardim-das-aguas/jda-interior-tipo-a-simples.glb',
         interior_detail_model_path = 'jardim-das-aguas/jda-interior-tipo-a.glb',
         interior_reference_unit = 'B01__F02__U201'
   where id = v_type_0;
  insert into public.unit_type_rooms (organization_id, unit_type_id, name, area_m2, label_x, label_y, sort_order)
  values
    (v_org, v_type_0, 'Estar · jantar', 14.3, -43.1, 20.3, 1),
    (v_org, v_type_0, 'Quarto 1', 8.4, -46.6, 20.5, 2),
    (v_org, v_type_0, 'Quarto 2', 8.1, -46.6, 17.5, 3),
    (v_org, v_type_0, 'Cozinha · serviço', 6.8, -42.3, 17.3, 4),
    (v_org, v_type_0, 'Banho', 3.2, -44.4, 17, 5),
    (v_org, v_type_0, 'Varanda', 4.3, -43.3, 22.6, 6);

  -- Interior: Tipo B
  update public.unit_types
     set interior_model_path = 'jardim-das-aguas/jda-interior-tipo-b-simples.glb',
         interior_detail_model_path = 'jardim-das-aguas/jda-interior-tipo-b.glb',
         interior_reference_unit = 'B01__F02__U202'
   where id = v_type_1;
  insert into public.unit_type_rooms (organization_id, unit_type_id, name, area_m2, label_x, label_y, sort_order)
  values
    (v_org, v_type_1, 'Estar · jantar', 15, -38.8, 20.2, 1),
    (v_org, v_type_1, 'Suíte', 8.7, -35.4, 20.8, 2),
    (v_org, v_type_1, 'Quarto 2', 7.2, -34.2, 17.5, 3),
    (v_org, v_type_1, 'Cozinha', 6.8, -39.8, 17.2, 4),
    (v_org, v_type_1, 'Serviço', 3.2, -36.2, 17, 5),
    (v_org, v_type_1, 'Banho', 2.8, -37.7, 17, 6),
    (v_org, v_type_1, 'Banho da suíte', 2.1, -33.75, 19.7, 7),
    (v_org, v_type_1, 'Varanda', 4.8, -38.6, 22.6, 8);

  -- Interior: Tipo A térreo com quintal
  update public.unit_types
     set interior_model_path = 'jardim-das-aguas/jda-interior-tipo-a-terreo-simples.glb',
         interior_detail_model_path = 'jardim-das-aguas/jda-interior-tipo-a-terreo.glb',
         interior_reference_unit = 'B01__F02__U201'
   where id = v_type_2;
  insert into public.unit_type_rooms (organization_id, unit_type_id, name, area_m2, label_x, label_y, sort_order)
  values
    (v_org, v_type_2, 'Estar · jantar', 14.3, -43.1, 20.3, 1),
    (v_org, v_type_2, 'Quarto 1', 8.4, -46.6, 20.5, 2),
    (v_org, v_type_2, 'Quarto 2', 8.1, -46.6, 17.5, 3),
    (v_org, v_type_2, 'Cozinha · serviço', 6.8, -42.3, 17.3, 4),
    (v_org, v_type_2, 'Banho', 3.2, -44.4, 17, 5),
    (v_org, v_type_2, 'Quintal com deck', 17.3, -44.5, 23.25, 6);

  -- Interior: Tipo B térreo com quintal
  update public.unit_types
     set interior_model_path = 'jardim-das-aguas/jda-interior-tipo-b-terreo-simples.glb',
         interior_detail_model_path = 'jardim-das-aguas/jda-interior-tipo-b-terreo.glb',
         interior_reference_unit = 'B01__F02__U202'
   where id = v_type_3;
  insert into public.unit_type_rooms (organization_id, unit_type_id, name, area_m2, label_x, label_y, sort_order)
  values
    (v_org, v_type_3, 'Estar · jantar', 15, -38.8, 20.2, 1),
    (v_org, v_type_3, 'Suíte', 8.7, -35.4, 20.8, 2),
    (v_org, v_type_3, 'Quarto 2', 7.2, -34.2, 17.5, 3),
    (v_org, v_type_3, 'Cozinha', 6.8, -39.8, 17.2, 4),
    (v_org, v_type_3, 'Serviço', 3.2, -36.2, 17, 5),
    (v_org, v_type_3, 'Banho', 2.8, -37.7, 17, 6),
    (v_org, v_type_3, 'Banho da suíte', 2.1, -33.75, 19.7, 7),
    (v_org, v_type_3, 'Quintal com deck', 19.8, -37, 23.25, 8);
end;
$$;
