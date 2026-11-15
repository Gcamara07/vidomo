/**
 * Preço público conforme price_display (PRD 6.3), resolvido no banco:
 *   hidden → sem preço; from → menor preço disponível do mesmo tipo (sem disponíveis → sem
 *   preço); exact → preço da unidade; vendida → nunca.
 * Roda no Supabase local (pnpm db:reset). Restaura price_display e status no fim.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const { url, anonKey, serviceKey } = inject('supabase');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(url, anonKey, opts);
const service = createClient(url, serviceKey, opts);
const SLUG = 'residencial-vista';

interface Row {
  object_key: string;
  unit_type_name: string;
  status: string;
  price: number | null;
  price_kind: 'from' | 'exact' | null;
}
interface DbUnit {
  id: string;
  object_key: string;
  status: string;
  price: number;
  unit_types: { name: string };
}

let devId: string;
let originalDisplay: string;
let dbUnits: DbUnit[];

async function setDisplay(mode: string) {
  const { error } = await service
    .from('developments')
    .update({ price_display: mode })
    .eq('id', devId);
  if (error) throw error;
}
async function publicRows(): Promise<Row[]> {
  const { data, error } = await anon.rpc('public_development_units', { p_slug: SLUG });
  if (error) throw error;
  return (data as Row[]).map((r) => ({ ...r, price: r.price === null ? null : Number(r.price) }));
}

beforeAll(async () => {
  const { data: dev } = await service
    .from('developments')
    .select('id, price_display')
    .eq('slug', SLUG)
    .single();
  devId = dev!.id;
  originalDisplay = dev!.price_display;
  const { data } = await service
    .from('units')
    .select('id, object_key, status, price, unit_types(name)')
    .eq('development_id', devId);
  dbUnits = (data as unknown as DbUnit[]).map((u) => ({ ...u, price: Number(u.price) }));
});

afterAll(async () => {
  await setDisplay(originalDisplay);
});

describe('public_development_units: preço por price_display', () => {
  it('hidden (padrão): nenhuma unidade mostra preço', async () => {
    await setDisplay('hidden');
    for (const r of await publicRows()) {
      expect(r.price, r.object_key).toBeNull();
      expect(r.price_kind).toBeNull();
    }
  });

  it('exact: preço da própria unidade, inclusive reservada e em negociação; vendida nunca', async () => {
    await setDisplay('exact');
    const rows = await publicRows();
    const statuses = new Set(rows.map((r) => r.status));
    expect(statuses).toContain('reserved');
    expect(statuses).toContain('negotiating');
    for (const r of rows) {
      const u = dbUnits.find((d) => d.object_key === r.object_key)!;
      if (r.status === 'sold') {
        expect(r.price, r.object_key).toBeNull();
        expect(r.price_kind).toBeNull();
      } else {
        expect(r.price, r.object_key).toBe(u.price);
        expect(r.price_kind).toBe('exact');
      }
    }
  });

  it('from: menor preço entre as DISPONÍVEIS do mesmo tipo; vendida nunca', async () => {
    await setDisplay('from');
    const rows = await publicRows();
    const minAvailable = (type: string) =>
      Math.min(
        ...dbUnits
          .filter((u) => u.unit_types.name === type && u.status === 'available')
          .map((u) => u.price),
      );
    for (const r of rows) {
      if (r.status === 'sold') {
        expect(r.price, r.object_key).toBeNull();
      } else {
        expect(r.price, r.object_key).toBe(minAvailable(r.unit_type_name));
        expect(r.price_kind).toBe('from');
      }
    }
    // O "a partir de" ignora unidades não disponíveis mais baratas.
    const cheapestTipoA = Math.min(
      ...dbUnits.filter((u) => u.unit_types.name === 'Tipo A').map((u) => u.price),
    );
    expect(minAvailable('Tipo A')).toBeGreaterThanOrEqual(cheapestTipoA);
  });

  it('from: sem unidade disponível do tipo → "Consulte condições" (sem preço)', async () => {
    await setDisplay('from');
    const tipoBAvailable = dbUnits.filter(
      (u) => u.unit_types.name === 'Tipo B' && u.status === 'available',
    );
    expect(tipoBAvailable.length).toBeGreaterThan(0);
    try {
      // Tira todas as Tipo B de "disponível" (service_role; o trigger grava histórico).
      for (const u of tipoBAvailable) {
        await service.from('units').update({ status: 'reserved' }).eq('id', u.id);
      }
      const rows = await publicRows();
      for (const r of rows.filter((r) => r.unit_type_name === 'Tipo B')) {
        expect(r.price, r.object_key).toBeNull();
        expect(r.price_kind).toBeNull();
      }
      // Tipo A segue com "a partir de".
      expect(rows.some((r) => r.unit_type_name === 'Tipo A' && r.price_kind === 'from')).toBe(true);
    } finally {
      for (const u of tipoBAvailable) {
        await service.from('units').update({ status: 'available' }).eq('id', u.id);
      }
    }
  });

  it('o preço da tabela nunca sai por outro caminho (campos públicos)', async () => {
    await setDisplay('hidden');
    const [row] = await publicRows();
    expect(Object.keys(row!).sort()).toEqual(
      [
        'area_m2',
        'bedrooms',
        'code',
        'facade',
        'floor_number',
        'frontage',
        'object_key',
        'plan_image_path',
        'price',
        'price_kind',
        'status',
        'suites',
        'tower_code',
        'unit_type_name',
      ].sort(),
    );
  });
});
