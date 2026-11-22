/**
 * Empreendimento com vários blocos (Bloco M): ordem e nome curto do bloco, rótulo do andar e
 * os campos públicos de public_development_units.
 * Usa um empreendimento de 2 blocos numa organização só de teste (org C), criado na primeira
 * execução e reaproveitado nas seguintes: unidades não podem ser apagadas (o histórico de
 * status é imutável, regra 3), e as orgs A e B do seed ficam intactas. Não depende do seed
 * local do condomínio de teste (fora do git). Some no próximo `pnpm db:reset`.
 * Roda SÓ no Supabase local (pnpm test:db); nunca no remoto (pnpm test:remote só lê
 * supabase/remote-tests/).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const { url, anonKey, serviceKey } = inject('supabase');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(url, anonKey, opts);
const service = createClient(url, serviceKey, opts);
const ORG_C = 'c0000000-0000-4000-8000-0000000000c0';
const SLUG = 'teste-blocos';

let devId: string;
let adminA: SupabaseClient;

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

interface PublicRow {
  object_key: string;
  code: string;
  tower_code: string;
  tower_name: string;
  tower_short_name: string | null;
  tower_sort_order: number;
  floor_number: number;
  floor_label: string | null;
}

/** Cria a org C e o empreendimento de 2 blocos (só na primeira execução). */
async function ensureFixture(): Promise<string> {
  const existing = await must(service.from('developments').select('id').eq('slug', SLUG));
  if (existing.length) return existing[0]!.id as string;
  await must(
    service
      .from('organizations')
      .upsert({ id: ORG_C, name: 'Construtora Blocos (teste)', slug: 'construtora-blocos-teste' }),
  );
  const dev = await must(
    service
      .from('developments')
      .insert({ organization_id: ORG_C, slug: SLUG, name: 'Teste blocos', status: 'published' })
      .select('id')
      .single(),
  );
  const id = dev.id as string;
  // Ordem de exibição diferente da ordem dos códigos: B02 vem antes de B01.
  for (const [code, sort] of [
    ['B01', 2],
    ['B02', 1],
  ] as const) {
    const tower = await must(
      service
        .from('towers')
        .insert({
          organization_id: ORG_C,
          development_id: id,
          code,
          name: `Bloco ${code.slice(1)}`,
          short_name: code.slice(1),
          sort_order: sort,
        })
        .select('id')
        .single(),
    );
    for (const n of [1, 2]) {
      const floor = await must(
        service
          .from('floors')
          .insert({
            organization_id: ORG_C,
            development_id: id,
            tower_id: tower.id,
            number: n,
            object_key: `${code}__F0${n}`,
            label: n === 1 ? 'Térreo' : null,
          })
          .select('id')
          .single(),
      );
      // Mesmo código de unidade nos dois blocos: único por bloco, não por empreendimento.
      await must(
        service.from('units').insert({
          organization_id: ORG_C,
          development_id: id,
          tower_id: tower.id,
          floor_id: floor.id,
          code: `${n}01`,
          object_key: `${code}__F0${n}__U${n}01`,
        }),
      );
    }
  }
  return id;
}

beforeAll(async () => {
  devId = await ensureFixture();
  const client = createClient(url, anonKey, opts);
  const { error } = await client.auth.signInWithPassword({
    email: 'admin@exemplo.test',
    password: 'vidomo-dev-123',
  });
  if (error) throw error;
  adminA = client;
});

afterAll(async () => {
  await adminA?.auth.signOut();
});

describe('public_development_units com vários blocos', () => {
  it('devolve bloco (nome, nome curto, ordem) e rótulo do andar, na ordem de exibição', async () => {
    const { data, error } = await anon.rpc('public_development_units', { p_slug: SLUG });
    expect(error).toBeNull();
    const rows = data as PublicRow[];
    expect(rows.map((r) => r.object_key)).toEqual([
      'B02__F01__U101',
      'B02__F02__U201',
      'B01__F01__U101',
      'B01__F02__U201',
    ]);
    expect(rows[0]).toMatchObject({
      code: '101',
      tower_code: 'B02',
      tower_name: 'Bloco 02',
      tower_short_name: '02',
      tower_sort_order: 1,
      floor_number: 1,
      floor_label: 'Térreo',
    });
    expect(rows[1]!.floor_label).toBeNull();
  });

  it('Residencial Vista: uma torre, sem nome curto nem rótulo (comportamento de antes)', async () => {
    const { data } = await anon.rpc('public_development_units', { p_slug: 'residencial-vista' });
    const rows = data as PublicRow[];
    expect(new Set(rows.map((r) => r.tower_code))).toEqual(new Set(['TA']));
    expect(rows[0]).toMatchObject({
      tower_name: 'Torre A',
      tower_short_name: null,
      tower_sort_order: 0,
      floor_label: null,
    });
  });
});

describe('restrições e isolamento', () => {
  it('nome curto e rótulo do andar validados no banco', async () => {
    const bad = await service
      .from('towers')
      .update({ short_name: 'Bloco 09' })
      .eq('development_id', devId)
      .eq('code', 'B01');
    expect(bad.error?.code).toBe('23514');
    const empty = await service
      .from('floors')
      .update({ label: '' })
      .eq('development_id', devId)
      .eq('number', 1);
    expect(empty.error?.code).toBe('23514');
  });

  it('admin de outra organização não vê nem altera os blocos', async () => {
    const seen = await adminA.from('towers').select('id').eq('development_id', devId);
    expect(seen.data).toEqual([]);
    const upd = await adminA
      .from('towers')
      .update({ sort_order: 99 })
      .eq('development_id', devId)
      .select('id');
    expect(upd.data ?? []).toEqual([]);
    const orders = await must(
      service.from('towers').select('sort_order').eq('development_id', devId).order('code'),
    );
    expect(orders.map((o) => o.sort_order)).toEqual([2, 1]);
  });
});
