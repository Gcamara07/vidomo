/**
 * Teste de isolamento multiempresa (regra 1) e de acesso anônimo (regra 4).
 * Roda contra o Supabase local com o seed aplicado (`pnpm db:reset`).
 *
 * Org A = Construtora Exemplo (Residencial Vista, publicado, 40 unidades)
 * Org B = Construtora Teste   (Residencial Teste, rascunho, 4 unidades)
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const { url, anonKey, serviceKey } = inject('supabase');
const PASSWORD = 'vidomo-dev-123';
const SLUG_A = 'residencial-vista';
const SLUG_B = 'residencial-teste';

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

function newClient(key = anonKey) {
  return createClient(url, key, clientOptions);
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login de ${email} falhou: ${error.message}`);
  return client;
}

const service = newClient(serviceKey);
let adminA: SupabaseClient;
let adminB: SupabaseClient;
const anon = newClient();

let devA: { id: string; organization_id: string };
let devB: { id: string; organization_id: string };
let unitA: { id: string; status: string; price: number; object_key: string };

async function statusOf(unitId: string) {
  const { data, error } = await service
    .from('units')
    .select('status, price')
    .eq('id', unitId)
    .single();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  adminA = await signIn('admin@exemplo.test');
  adminB = await signIn('admin@teste.test');

  const { data: devs, error } = await service
    .from('developments')
    .select('id, slug, organization_id');
  if (error) throw error;
  devA = devs.find((d) => d.slug === SLUG_A)!;
  devB = devs.find((d) => d.slug === SLUG_B)!;

  const { data: ua } = await service
    .from('units')
    .select('id, status, price, object_key')
    .eq('development_id', devA.id)
    .eq('code', '101')
    .single();
  unitA = ua!;
});

afterAll(async () => {
  // Restaura o status da unidade usada nos testes de escrita (via RPC, como admin A).
  await adminA.rpc('set_unit_status', {
    p_unit_id: unitA.id,
    p_new_status: unitA.status,
    p_reason: 'restauração pós-teste',
  });
  await Promise.all([adminA.auth.signOut(), adminB.auth.signOut()]);
  await Promise.all([adminA, adminB, anon, service].map((c) => c.removeAllChannels()));
});

describe('admin da org B contra dados da org A', () => {
  it('SELECT direto em units só retorna unidades da própria organização', async () => {
    const { data, error } = await adminB.from('units').select('id, organization_id');
    expect(error).toBeNull();
    expect(data!.length).toBe(4);
    expect(data!.every((u) => u.organization_id === devB.organization_id)).toBe(true);
  });

  it('SELECT direto por id/empreendimento da org A retorna vazio', async () => {
    const byId = await adminB.from('units').select('*').eq('id', unitA.id);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);

    const byDev = await adminB.from('units').select('*').eq('development_id', devA.id);
    expect(byDev.data).toEqual([]);
  });

  it.each([
    'organizations',
    'organization_members',
    'developments',
    'towers',
    'floors',
    'unit_types',
    'unit_status_history',
  ])('não enxerga nenhuma linha da org A em %s', async (table) => {
    // organizations identifica a organização pelo próprio id.
    const column = table === 'organizations' ? 'id' : 'organization_id';
    const { data, error } = await adminB.from(table).select(column);
    expect(error).toBeNull();
    const orgIds = (data as unknown as Record<string, string>[]).map((r) => r[column]);
    expect(orgIds.length).toBeGreaterThan(0);
    expect(new Set(orgIds)).toEqual(new Set([devB.organization_id]));
  });

  it('UPDATE direto de status em unidade da org A falha (sem GRANT na coluna)', async () => {
    const { error } = await adminB.from('units').update({ status: 'sold' }).eq('id', unitA.id);
    expect(error).not.toBeNull();
    expect((await statusOf(unitA.id)).status).toBe(unitA.status);
  });

  it('UPDATE direto de outra coluna em unidade da org A não afeta nada (RLS)', async () => {
    const { data, error } = await adminB
      .from('units')
      .update({ price: 1 })
      .eq('id', unitA.id)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(Number((await statusOf(unitA.id)).price)).toBe(Number(unitA.price));
  });

  it('DELETE direto em unidade da org A não afeta nada', async () => {
    const { data } = await adminB.from('units').delete().eq('id', unitA.id).select();
    expect(data ?? []).toEqual([]);
    expect(await statusOf(unitA.id)).toBeTruthy();
  });

  it('INSERT de unidade no empreendimento da org A falha', async () => {
    const { data: floor } = await service
      .from('floors')
      .select('id, tower_id')
      .eq('development_id', devA.id)
      .limit(1)
      .single();
    const { error } = await adminB.from('units').insert({
      organization_id: devA.organization_id,
      development_id: devA.id,
      tower_id: floor!.tower_id,
      floor_id: floor!.id,
      code: '9999',
      object_key: 'TA__F99__U9999',
    });
    expect(error).not.toBeNull();
  });

  it('INSERT de unidade da própria org apontando para empreendimento da org A falha', async () => {
    const { data: floor } = await service
      .from('floors')
      .select('id, tower_id')
      .eq('development_id', devA.id)
      .limit(1)
      .single();
    const { error } = await adminB.from('units').insert({
      organization_id: devB.organization_id,
      development_id: devA.id,
      tower_id: floor!.tower_id,
      floor_id: floor!.id,
      code: '9998',
      object_key: 'TA__F99__U9998',
    });
    expect(error).not.toBeNull();
  });

  it('RPC set_unit_status em unidade da org A falha e não altera nada', async () => {
    const { data, error } = await adminB.rpc('set_unit_status', {
      p_unit_id: unitA.id,
      p_new_status: 'sold',
      p_reason: 'tentativa cruzada',
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0002');
    expect((await statusOf(unitA.id)).status).toBe(unitA.status);
  });
});

describe('cômodos e interiores (unit_type_rooms, unit_types): org B contra a org A', () => {
  let roomA: { id: string; unit_type_id: string; name: string };
  let typeB: { id: string; organization_id: string };

  beforeAll(async () => {
    const { data, error } = await service
      .from('unit_type_rooms')
      .select('id, unit_type_id, name')
      .eq('organization_id', devA.organization_id)
      .eq('name', 'Varanda')
      .limit(1)
      .single();
    if (error) throw error;
    roomA = data;
    const { data: t } = await service
      .from('unit_types')
      .select('id, organization_id')
      .eq('development_id', devB.id)
      .limit(1)
      .single();
    typeB = t!;
  });

  afterAll(async () => {
    await service.from('unit_type_rooms').delete().eq('unit_type_id', typeB.id);
  });

  it('admin A lê os 15 cômodos da própria organização', async () => {
    const { data, error } = await adminA.from('unit_type_rooms').select('organization_id');
    expect(error).toBeNull();
    expect(data).toHaveLength(15);
  });

  it('admin B não enxerga cômodos da org A, nem pelo id', async () => {
    const all = await adminB.from('unit_type_rooms').select('organization_id');
    expect(all.error).toBeNull();
    expect(all.data!.every((r) => r.organization_id === devB.organization_id)).toBe(true);
    const byId = await adminB.from('unit_type_rooms').select('*').eq('id', roomA.id);
    expect(byId.data).toEqual([]);
  });

  it('admin B não cria cômodo em tipo da org A (com a org de A ou com a própria)', async () => {
    const row = {
      unit_type_id: roomA.unit_type_id,
      name: 'Intruso',
      area_m2: 1,
      label_x: 0,
      label_y: 0,
    };
    const asA = await adminB
      .from('unit_type_rooms')
      .insert({ ...row, organization_id: devA.organization_id });
    expect(asA.error).not.toBeNull();
    const asB = await adminB
      .from('unit_type_rooms')
      .insert({ ...row, organization_id: devB.organization_id });
    expect(asB.error).not.toBeNull();
  });

  it('UPDATE e DELETE de cômodo da org A não afetam nada', async () => {
    const upd = await adminB
      .from('unit_type_rooms')
      .update({ name: 'Trocado' })
      .eq('id', roomA.id)
      .select();
    expect(upd.data ?? []).toEqual([]);
    const del = await adminB.from('unit_type_rooms').delete().eq('id', roomA.id).select();
    expect(del.data ?? []).toEqual([]);
    const { data } = await service
      .from('unit_type_rooms')
      .select('name')
      .eq('id', roomA.id)
      .single();
    expect(data!.name).toBe(roomA.name);
  });

  it('não troca o interior de um tipo da org A', async () => {
    const { data } = await adminB
      .from('unit_types')
      .update({
        interior_model_path: null,
        interior_detail_model_path: null,
        interior_reference_unit: null,
      })
      .eq('id', roomA.unit_type_id)
      .select();
    expect(data ?? []).toEqual([]);
    const { data: t } = await service
      .from('unit_types')
      .select('interior_model_path')
      .eq('id', roomA.unit_type_id)
      .single();
    expect(t!.interior_model_path).not.toBeNull();
  });

  it('vendedor da org A não cadastra cômodo (só admin)', async () => {
    const sales = await signIn('vendas@exemplo.test');
    const { error } = await sales.from('unit_type_rooms').insert({
      organization_id: devA.organization_id,
      unit_type_id: roomA.unit_type_id,
      name: 'Do vendedor',
      area_m2: 1,
      label_x: 0,
      label_y: 0,
    });
    expect(error).not.toBeNull();
    await sales.auth.signOut();
  });

  it('admin B cadastra e lê cômodo no próprio tipo', async () => {
    const { error } = await adminB.from('unit_type_rooms').insert({
      organization_id: devB.organization_id,
      unit_type_id: typeB.id,
      name: 'Sala',
      area_m2: 12.5,
      label_x: 1,
      label_y: 2,
    });
    expect(error).toBeNull();
    const { data } = await adminB
      .from('unit_type_rooms')
      .select('name')
      .eq('unit_type_id', typeB.id);
    expect(data).toEqual([{ name: 'Sala' }]);
  });

  it('a unidade de referência precisa ser do mesmo empreendimento', async () => {
    const { error } = await service
      .from('unit_types')
      .update({ interior_model_path: 'x/y.glb', interior_reference_unit: 'TA__F02__U201' })
      .eq('id', typeB.id);
    expect(error).not.toBeNull();
    // Interior incompleto (modelo sem unidade de referência) também é recusado.
    const incompleto = await service
      .from('unit_types')
      .update({ interior_model_path: 'x/y.glb' })
      .eq('id', typeB.id);
    expect(incompleto.error).not.toBeNull();
  });
});

describe('admin da org A na própria organização', () => {
  it('vê as 40 unidades do Residencial Vista', async () => {
    const { data } = await adminA.from('units').select('id').eq('development_id', devA.id);
    expect(data!.length).toBe(40);
  });

  it('não altera status por UPDATE direto (regra 2)', async () => {
    const { error } = await adminA.from('units').update({ status: 'sold' }).eq('id', unitA.id);
    expect(error).not.toBeNull();
    expect((await statusOf(unitA.id)).status).toBe(unitA.status);
  });

  it('altera status pela RPC e o histórico registra quem, de onde, para onde e por quê', async () => {
    const target = unitA.status === 'negotiating' ? 'reserved' : 'negotiating';
    const { data, error } = await adminA.rpc('set_unit_status', {
      p_unit_id: unitA.id,
      p_new_status: target,
      p_reason: 'teste automatizado',
    });
    expect(error).toBeNull();
    expect(data).toEqual([
      expect.objectContaining({
        unit_id: unitA.id,
        object_key: unitA.object_key,
        previous_status: unitA.status,
        status: target,
      }),
    ]);

    const { data: history } = await adminA
      .from('unit_status_history')
      .select('from_status, to_status, reason, changed_by')
      .eq('unit_id', unitA.id)
      .order('id', { ascending: false })
      .limit(1)
      .single();
    const { data: me } = await adminA.auth.getUser();
    expect(history).toEqual({
      from_status: unitA.status,
      to_status: target,
      reason: 'teste automatizado',
      changed_by: me.user!.id,
    });
  });

  it('não consegue alterar nem apagar o histórico', async () => {
    const upd = await adminA
      .from('unit_status_history')
      .update({ reason: 'adulterado' })
      .eq('unit_id', unitA.id);
    expect(upd.error).not.toBeNull();
    const del = await adminA.from('unit_status_history').delete().eq('unit_id', unitA.id);
    expect(del.error).not.toBeNull();
  });

  it('nem a service_role altera ou apaga o histórico (trigger)', async () => {
    const upd = await service
      .from('unit_status_history')
      .update({ reason: 'adulterado' })
      .eq('unit_id', unitA.id);
    expect(upd.error?.message).toMatch(/imutável/);
    const del = await service.from('unit_status_history').delete().eq('unit_id', unitA.id);
    expect(del.error?.message).toMatch(/imutável/);
  });
});

describe('comprador anônimo', () => {
  it.each([
    'units',
    'developments',
    'unit_status_history',
    'organizations',
    'unit_types',
    'unit_type_rooms',
  ])('não lê %s diretamente', async (table) => {
    const { data, error } = await anon.from(table).select('*');
    // Sem GRANT: erro de permissão. Nunca dados.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('lê o empreendimento publicado pela função pública, só campos públicos', async () => {
    const { data, error } = await anon.rpc('public_development_units', { p_slug: SLUG_A });
    expect(error).toBeNull();
    expect(data).toHaveLength(40);
    for (const row of data as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'area_m2',
          'bedrooms',
          'code',
          'facade',
          'floor_label',
          'floor_number',
          'frontage',
          'object_key',
          'plan_image_path',
          'price',
          'price_kind',
          'status',
          'suites',
          'tower_code',
          'tower_name',
          'tower_short_name',
          'tower_sort_order',
          'unit_type_name',
        ].sort(),
      );
      // Preço só resolvido pela regra do empreendimento; vendida nunca mostra (price.test.ts).
      if (row.status === 'sold') expect(row.price).toBeNull();
    }
    const statuses = new Set((data as { status: string }[]).map((u) => u.status));
    expect(statuses).toEqual(
      new Set(['available', 'reserved', 'negotiating', 'sold', 'unavailable']),
    );

    const dev = await anon.rpc('public_development', { p_slug: SLUG_A });
    expect(dev.data).toEqual([
      {
        slug: SLUG_A,
        name: 'Residencial Vista',
        model_path: 'residencial-vista/residencial-vista-leve-v2.glb',
        detail_model_path: 'residencial-vista/residencial-vista-detalhes-v2.glb',
        viewer_cameras: null,
      },
    ]);
  });

  it('lê tipos de planta, interiores e cômodos pela função pública, só campos públicos', async () => {
    const { data, error } = await anon.rpc('public_development_unit_types', { p_slug: SLUG_A });
    expect(error).toBeNull();
    const types = data as Record<string, unknown>[];
    expect(types.map((t) => t.name)).toEqual(['Tipo A', 'Tipo B']);
    for (const t of types) {
      expect(Object.keys(t).sort()).toEqual(
        [
          'area_m2',
          'bedrooms',
          'interior_detail_model_path',
          'interior_model_path',
          'interior_reference_unit',
          'name',
          'rooms',
          'suites',
        ].sort(),
      );
    }
    const a = types[0] as { interior_reference_unit: string; rooms: Record<string, unknown>[] };
    expect(a.interior_reference_unit).toBe('TA__F02__U201');
    expect(a.rooms).toHaveLength(7);
    // Em ordem, só nome, área e posição da etiqueta (sem ids nem organização).
    expect(a.rooms[0]).toEqual({ name: 'Estar · jantar', area_m2: 20.9, x: -3.3, y: 5.0 });
    expect(Object.keys(a.rooms[0]!).sort()).toEqual(['area_m2', 'name', 'x', 'y']);
    expect((types[1] as { rooms: unknown[] }).rooms).toHaveLength(8);
  });

  it('não lê empreendimento em rascunho', async () => {
    const types = await anon.rpc('public_development_unit_types', { p_slug: SLUG_B });
    expect(types.error).toBeNull();
    expect(types.data).toEqual([]);
    const units = await anon.rpc('public_development_units', { p_slug: SLUG_B });
    expect(units.error).toBeNull();
    expect(units.data).toEqual([]);
    const dev = await anon.rpc('public_development', { p_slug: SLUG_B });
    expect(dev.data).toEqual([]);
  });

  it('não chama set_unit_status', async () => {
    const { error } = await anon.rpc('set_unit_status', {
      p_unit_id: unitA.id,
      p_new_status: 'sold',
    });
    expect(error).not.toBeNull();
    expect((await statusOf(unitA.id)).status).not.toBe('sold');
  });
});

describe('Realtime Broadcast do tópico development:<slug>', () => {
  type Msg = { object_key: string; status: string };

  function subscribe(client: SupabaseClient, topic: string, isPrivate: boolean) {
    const received: Msg[] = [];
    const channel = client.channel(topic, { config: { private: isPrivate } });
    channel.on('broadcast', { event: 'unit_status' }, ({ payload }) =>
      received.push(payload as Msg),
    );
    const ready = new Promise<string>((resolve) => {
      channel.subscribe((status) => {
        if (status !== 'CLOSED') resolve(status);
      });
    });
    return { channel, received, ready };
  }

  async function waitFor(cond: () => boolean, ms = 3000) {
    const start = Date.now();
    while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50));
    return cond();
  }

  let listener: { channel: RealtimeChannel; received: Msg[]; ready: Promise<string> };

  beforeAll(async () => {
    listener = subscribe(anon, `development:${SLUG_A}`, true);
    expect(await listener.ready).toBe('SUBSCRIBED');
    // O Realtime liga a replicação de Broadcast na primeira assinatura privada;
    // mensagens dos primeiros instantes podem se perder. Na página pública isso é
    // coberto pela releitura feita após SUBSCRIBED.
    await new Promise((r) => setTimeout(r, 1500));
  });

  it('anônimo recebe {object_key, status} em até 3 s quando o status muda pela RPC', async () => {
    listener.received.length = 0;
    const target = 'reserved';
    await adminA.rpc('set_unit_status', { p_unit_id: unitA.id, p_new_status: 'available' });
    await adminA.rpc('set_unit_status', { p_unit_id: unitA.id, p_new_status: target });
    const ok = await waitFor(() =>
      listener.received.some((m) => m.object_key === unitA.object_key && m.status === target),
    );
    expect(ok).toBe(true);
    // Só object_key e status (o realtime.send acrescenta o id da mensagem).
    for (const m of listener.received)
      expect(Object.keys(m).sort()).toEqual(['id', 'object_key', 'status']);
  });

  it('anônimo não consegue assinar o tópico de empreendimento em rascunho', async () => {
    const draft = subscribe(newClient(), `development:${SLUG_B}`, true);
    expect(await draft.ready).not.toBe('SUBSCRIBED');
  });

  it('cliente não publica no tópico privado (só o trigger publica)', async () => {
    const intruder = subscribe(newClient(), `development:${SLUG_A}`, true);
    expect(await intruder.ready).toBe('SUBSCRIBED');
    listener.received.length = 0;
    await intruder.channel.send({
      type: 'broadcast',
      event: 'unit_status',
      payload: { object_key: unitA.object_key, status: 'sold' },
    });
    // Mesmo tópico como canal público também não chega ao canal privado.
    const publicTopic = subscribe(newClient(), `development:${SLUG_A}`, false);
    await publicTopic.ready;
    await publicTopic.channel.send({
      type: 'broadcast',
      event: 'unit_status',
      payload: { object_key: unitA.object_key, status: 'sold' },
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(listener.received.filter((m) => m.status === 'sold')).toEqual([]);
  });
});

describe('Realtime postgres_changes de units (painel)', () => {
  function listen(client: SupabaseClient, name: string) {
    const changes: { new: { id?: string } }[] = [];
    const channel = client
      .channel(name)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'units' }, (p) =>
        changes.push(p as { new: { id?: string } }),
      );
    // Pronto só quando o servidor confirma a assinatura no Postgres (evento system).
    const ready = new Promise<string>((resolve) => {
      channel.on('system', {}, (msg: { extension?: string; status?: string }) => {
        if (msg.extension === 'postgres_changes') resolve(msg.status ?? 'unknown');
      });
      channel.subscribe((s) => {
        if (s !== 'SUBSCRIBED' && s !== 'CLOSED') resolve(s);
      });
    });
    return { changes, ready };
  }

  it('admin A recebe a mudança da própria unidade; admin B não recebe nada', async () => {
    // O Realtime usa o JWT do usuário para aplicar a RLS de units.
    adminA.realtime.setAuth((await adminA.auth.getSession()).data.session!.access_token);
    adminB.realtime.setAuth((await adminB.auth.getSession()).data.session!.access_token);
    const a = listen(adminA, 'units-a');
    const b = listen(adminB, 'units-b');
    expect(await a.ready).toBe('ok');
    expect(await b.ready).toBe('ok');

    await adminA.rpc('set_unit_status', { p_unit_id: unitA.id, p_new_status: 'unavailable' });

    const start = Date.now();
    while (!a.changes.some((c) => c.new.id === unitA.id) && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(a.changes.some((c) => c.new.id === unitA.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 1000));
    expect(b.changes).toEqual([]);
  });
});

describe('leads: admin da org B contra a org A', () => {
  const INGEST_KEY = 'vidomo-dev-ingest-key-somente-local-0001'; // só local (seed.sql)
  let leadA: string;
  let leadB: string;

  beforeAll(async () => {
    const { data, error } = await anon.rpc('create_lead', {
      p_ingest_key: INGEST_KEY,
      p_client_key: `isolamento-${Date.now()}-${Math.random()}`.slice(0, 64),
      p_slug: SLUG_A,
      p_object_key: unitA.object_key,
      p_name: 'Comprador Isolamento',
      p_phone: `1699${String(Date.now()).slice(-7)}`,
      p_email: null,
      p_message: null,
      p_source: 'unit_link',
      p_consent: true,
      p_consent_version: 'online-v1',
    });
    if (error) throw error;
    leadA = (data as { lead_id: string }[])[0]!.lead_id;
    await service.rpc('register_whatsapp_click', {
      p_slug: SLUG_A,
      p_object_key: unitA.object_key,
    });

    // A org B também tem um lead (manual, empreendimento em rascunho).
    const b = await adminB.rpc('create_manual_lead', {
      p_development_id: devB.id,
      p_unit_id: null,
      p_name: 'Comprador B',
      p_phone: '11987654321',
      p_email: null,
      p_message: null,
      p_consent_in_person: true,
    });
    if (b.error) throw b.error;
    leadB = (b.data as { id: string }).id;
  });

  afterAll(async () => {
    await service.from('leads').delete().in('id', [leadA, leadB]);
  });

  async function leadOf(id: string) {
    const { data } = await service
      .from('leads')
      .select('status, assigned_to')
      .eq('id', id)
      .maybeSingle();
    return data;
  }

  it.each([
    'leads',
    'notification_deliveries',
    'organization_settings',
    'lead_deletions',
    'unit_whatsapp_clicks',
  ])('não enxerga nenhuma linha da org A em %s', async (table) => {
    const { data, error } = await adminB.from(table).select('organization_id');
    expect(error).toBeNull();
    const orgIds = (data as { organization_id: string }[]).map((r) => r.organization_id);
    expect(orgIds).not.toContain(devA.organization_id);
    expect(orgIds.every((o) => o === devB.organization_id)).toBe(true);
  });

  it('enxerga o próprio lead e não o da org A, nem buscando pelo id', async () => {
    const own = await adminB.from('leads').select('id');
    expect(own.data!.map((l) => l.id)).toContain(leadB);
    const byId = await adminB.from('leads').select('*').eq('id', leadA);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);
  });

  it.each([
    ['claim_lead', () => ({ p_lead_id: leadA })],
    ['set_lead_status', () => ({ p_lead_id: leadA, p_status: 'lost' })],
    ['assign_lead', () => ({ p_lead_id: leadA, p_user_id: null })],
    ['delete_lead', () => ({ p_lead_id: leadA, p_reason: 'tentativa cruzada' })],
  ])('%s em lead da org A falha como inexistente e não altera nada', async (fn, args) => {
    const { error } = await adminB.rpc(fn, args());
    expect(error?.code).toBe('P0002');
    expect(await leadOf(leadA)).toEqual({ status: 'new', assigned_to: null });
  });

  it('UPDATE e DELETE diretos em lead da org A falham', async () => {
    const upd = await adminB.from('leads').update({ status: 'lost' }).eq('id', leadA);
    expect(upd.error).not.toBeNull();
    const del = await adminB.from('leads').delete().eq('id', leadA);
    expect(del.error).not.toBeNull();
    expect(await leadOf(leadA)).toEqual({ status: 'new', assigned_to: null });
  });

  it('não cadastra lead manual no empreendimento da org A', async () => {
    const { error } = await adminB.rpc('create_manual_lead', {
      p_development_id: devA.id,
      p_unit_id: unitA.id,
      p_name: 'Intruso',
      p_phone: '11987654321',
      p_email: null,
      p_message: null,
      p_consent_in_person: true,
    });
    expect(error?.message).toBe('development_not_found');
  });

  it('não altera a configuração nem gera o segredo do webhook da org A', async () => {
    const upd = await adminB
      .from('organization_settings')
      .update({ webhook_url: 'https://intruso.test/hook' })
      .eq('organization_id', devA.organization_id)
      .select();
    expect(upd.data ?? []).toEqual([]);
    const ins = await adminB
      .from('organization_settings')
      .upsert({ organization_id: devA.organization_id, webhook_url: 'https://intruso.test/hook' });
    expect(ins.error).not.toBeNull();
    const { data } = await service
      .from('organization_settings')
      .select('webhook_url')
      .eq('organization_id', devA.organization_id)
      .single();
    expect(data!.webhook_url).not.toBe('https://intruso.test/hook');

    const rotate = await adminB.rpc('rotate_webhook_secret', {
      p_organization_id: devA.organization_id,
    });
    expect(rotate.error?.code).toBe('42501');
  });
});
