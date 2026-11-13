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
  it.each(['units', 'developments', 'unit_status_history', 'organizations'])(
    'não lê %s diretamente',
    async (table) => {
      const { data, error } = await anon.from(table).select('*');
      // Sem GRANT: erro de permissão. Nunca dados.
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    },
  );

  it('lê o empreendimento publicado pela função pública, sem preço', async () => {
    const { data, error } = await anon.rpc('public_development_units', { p_slug: SLUG_A });
    expect(error).toBeNull();
    expect(data).toHaveLength(40);
    for (const row of data as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'area_m2',
          'bedrooms',
          'code',
          'floor_number',
          'object_key',
          'status',
          'tower_code',
          'unit_type_name',
        ].sort(),
      );
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
        model_path: 'residencial-vista/residencial-vista-leve.glb',
        detail_model_path: null,
      },
    ]);
  });

  it('não lê empreendimento em rascunho', async () => {
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
