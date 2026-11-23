/**
 * Testes do AMBIENTE DE DEMONSTRAÇÃO (Supabase remoto). Só leitura, exceto o teste de
 * Broadcast, que troca o status de UMA unidade e o restaura em seguida (o histórico é
 * imutável: cada execução deixa 2 linhas em unit_status_history, sem usuário).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable> \
 *   SUPABASE_SERVICE_ROLE_KEY=<secret>   # opcional: só para o teste de Broadcast
 *   pnpm test:remote
 *
 * Os testes que criam e apagam dados (isolamento entre organizações, histórico) ficam
 * só no ambiente local (pnpm test:db). Os que deixam dados permanentes (ex.: a org C de
 * supabase/tests/towers.test.ts) nunca entram aqui: esta pasta só tem testes que leem ou
 * que restauram o que mudam.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey) {
  throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY do remoto.');
}

const SLUG = 'residencial-vista';
const ZERO = '00000000-0000-0000-0000-000000000000';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(url, anonKey, opts);
const clients: SupabaseClient[] = [anon];
const newAnon = () => {
  const c = createClient(url, anonKey, opts);
  clients.push(c);
  return c;
};

afterAll(async () => {
  await Promise.all(clients.map((c) => c.removeAllChannels()));
});

describe('leitura anônima pela função pública', () => {
  it('public_development devolve o Residencial Vista com as duas camadas', async () => {
    const { data, error } = await anon.rpc('public_development', { p_slug: SLUG });
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        slug: SLUG,
        name: 'Residencial Vista',
        // Bloco 3, etapa 1b: fachada nova (demo-seed troca para os v2).
        model_path: 'residencial-vista/residencial-vista-leve-v2.glb',
        detail_model_path: 'residencial-vista/residencial-vista-detalhes-v2.glb',
        viewer_cameras: null,
      },
    ]);
  });

  it('public_development_units devolve as 40 unidades, só campos públicos; vendida sem preço', async () => {
    const { data, error } = await anon.rpc('public_development_units', { p_slug: SLUG });
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
          // Bloco M (migration 20261122000100): o remoto precisa dela antes do deploy do front.
          'tower_name',
          'tower_short_name',
          'tower_sort_order',
          'unit_type_name',
        ].sort(),
      );
      if (row.status === 'sold') expect(row.price).toBeNull();
    }
  });

  it('slug inexistente não devolve nada', async () => {
    const { data } = await anon.rpc('public_development_units', { p_slug: 'nao-existe' });
    expect(data).toEqual([]);
  });

  it('public_development_unit_types devolve os tipos com interior e cômodos', async () => {
    // Bloco 3 (migration 20261123000100): o remoto precisa dela antes do deploy do front.
    const { data, error } = await anon.rpc('public_development_unit_types', { p_slug: SLUG });
    expect(error).toBeNull();
    const types = data as { name: string; interior_reference_unit: string; rooms: unknown[] }[];
    expect(types.map((t) => [t.name, t.interior_reference_unit, t.rooms.length])).toEqual([
      ['Tipo A', 'TA__F02__U201', 7],
      ['Tipo B', 'TA__F02__U202', 8],
    ]);
  });

  it('os GLBs do prédio e dos interiores estão no bucket público', async () => {
    for (const f of [
      'residencial-vista-leve-v2.glb',
      'residencial-vista-detalhes-v2.glb',
      'interior-tipo-a-simples.glb',
      'interior-tipo-a.glb',
      'interior-tipo-b-simples.glb',
      'interior-tipo-b.glb',
    ]) {
      const res = await fetch(`${url}/storage/v1/object/public/models/residencial-vista/${f}`, {
        method: 'HEAD',
      });
      expect(res.status, f).toBe(200);
    }
  });
});

describe('anônimo sem acesso direto', () => {
  it.each([
    'units',
    'developments',
    'towers',
    'floors',
    'unit_types',
    'unit_type_rooms',
    'unit_status_history',
    'organizations',
    'organization_members',
    'profiles',
    'leads',
    'notification_deliveries',
    'notification_attempts',
    'organization_settings',
    'lead_deletions',
    'unit_whatsapp_clicks',
    'consent_texts',
  ])('não lê %s', async (table) => {
    const { data, error } = await anon.from(table).select('*').limit(1);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('não chama set_unit_status', async () => {
    const { data: units } = await anon.rpc('public_development_units', { p_slug: SLUG });
    const { error } = await anon.rpc('set_unit_status', {
      p_unit_id: '00000000-0000-0000-0000-000000000000',
      p_new_status: 'sold',
    });
    expect(error).not.toBeNull();
    expect(units).toHaveLength(40);
  });

  // Argumentos inofensivos: mesmo que a permissão falhasse, nada mudaria na fila.
  it.each([
    ['check_notifications_dispatch_key', { p_key: 'x' }],
    [
      'claim_notification_deliveries',
      { p_channels: ['webhook'], p_limit: 1, p_delivery_ids: [ZERO] },
    ],
    ['complete_notification_delivery', { p_delivery_id: ZERO, p_attempt: 1, p_ok: false }],
    ['set_notifications_paused', { p_paused: false }],
  ])('não chama %s (API de envio)', async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error?.code).toBe('42501');
  });
});

describe('Edge Function de notificações', () => {
  it('está publicada e recusa chamada sem a chave de acionamento', async () => {
    const res = await fetch(`${url}/functions/v1/notifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    await res.body?.cancel();
    expect(res.status).toBe(401);
  });
});

describe('Realtime Broadcast development:<slug>', () => {
  type Msg = { object_key: string; status: string };

  function listen(client: SupabaseClient, isPrivate = true) {
    const received: Msg[] = [];
    const channel = client.channel(`development:${SLUG}`, { config: { private: isPrivate } });
    channel.on('broadcast', { event: 'unit_status' }, ({ payload }) =>
      received.push(payload as Msg),
    );
    const ready = new Promise<string>((resolve) =>
      channel.subscribe((s) => {
        if (s !== 'CLOSED') resolve(s);
      }),
    );
    return { channel, received, ready };
  }

  it('cliente não publica no tópico (nem pelo canal público de mesmo nome)', async () => {
    const listener = listen(newAnon());
    expect(await listener.ready).toBe('SUBSCRIBED');
    await new Promise((r) => setTimeout(r, 1500));

    const intruder = listen(newAnon());
    await intruder.ready;
    await intruder.channel.send({
      type: 'broadcast',
      event: 'unit_status',
      payload: { object_key: 'TA__F01__U101', status: 'sold' },
    });
    const pub = listen(newAnon(), false);
    await pub.ready;
    await pub.channel.send({
      type: 'broadcast',
      event: 'unit_status',
      payload: { object_key: 'TA__F01__U101', status: 'sold' },
    });
    await new Promise((r) => setTimeout(r, 2000));
    expect(listener.received).toEqual([]);
  });

  it.skipIf(!serviceKey)(
    'anônimo recebe {object_key, status} em até 3 s quando o status muda (e é restaurado)',
    async () => {
      const service = createClient(url, serviceKey!, opts);
      clients.push(service);
      const KEY = 'TA__F10__U1004';
      const { data: unit, error } = await service
        .from('units')
        .select('id, status')
        .eq('object_key', KEY)
        .single();
      expect(error).toBeNull();
      const original = unit!.status as string;
      const target = original === 'negotiating' ? 'reserved' : 'negotiating';

      const listener = listen(newAnon());
      expect(await listener.ready).toBe('SUBSCRIBED');
      // Replicação do Broadcast liga na 1ª assinatura privada.
      await new Promise((r) => setTimeout(r, 1500));

      try {
        const start = Date.now();
        // service_role: o trigger publica o Broadcast como em set_unit_status.
        await service.from('units').update({ status: target }).eq('id', unit!.id);
        while (
          !listener.received.some((m) => m.object_key === KEY && m.status === target) &&
          Date.now() - start < 3000
        ) {
          await new Promise((r) => setTimeout(r, 50));
        }
        const elapsed = Date.now() - start;
        expect(
          listener.received.some((m) => m.object_key === KEY && m.status === target),
          `mensagem não chegou em 3 s (${elapsed} ms)`,
        ).toBe(true);
        for (const m of listener.received) {
          expect(Object.keys(m).sort()).toEqual(['id', 'object_key', 'status']);
        }
      } finally {
        await service.from('units').update({ status: original }).eq('id', unit!.id);
      }
      const { data: after } = await anon.rpc('public_development_units', { p_slug: SLUG });
      expect((after as Msg[]).find((u) => u.object_key === KEY)?.status).toBe(original);
    },
  );
});
