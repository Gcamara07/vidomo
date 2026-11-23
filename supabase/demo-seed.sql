-- Vidomo — dados do AMBIENTE DE DEMONSTRAÇÃO (Supabase remoto).
--
-- Diferente de supabase/seed.sql (desenvolvimento local):
--   * só a Construtora Exemplo e o Residencial Vista publicado (40 unidades);
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
