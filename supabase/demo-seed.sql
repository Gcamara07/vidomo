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
-- Idempotente: se o Residencial Vista já existir, não faz nada.
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
  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms)
  values (v_org, v_dev, 'Tipo A', 58.00, 2)
  returning id into v_type_a;

  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms)
  values (v_org, v_dev, 'Tipo B', 75.00, 3)
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
        code, object_key, status, price
      ) values (
        v_org, v_dev, v_tower, v_floor,
        case when p % 2 = 1 then v_type_a else v_type_b end,
        v_code::text,
        format('TA__F%s__U%s', lpad(f::text, 2, '0'), v_code),
        v_status,
        (case when p % 2 = 1 then 420000 else 530000 end) + f * 8000
      );
    end loop;
  end loop;

  raise notice 'Residencial Vista criado com 40 unidades.';
end;
$$;
