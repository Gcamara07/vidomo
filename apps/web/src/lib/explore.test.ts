import { describe, expect, it } from 'vitest';
import {
  bedroomOptions,
  defaultFilters,
  dimmedUnitKeys,
  floorLabel,
  floorsFromUnits,
  isDefaultFilters,
  legendCounts,
  toggleIn,
  towerLabel,
  towersFromUnits,
} from './explore';
import { toStatusMap, type PublicUnit } from './public-development';
import { blockUnit, vistaUnit, withLinks } from '@/test/units';

const unit = (floor: number, pos: number, status: PublicUnit['status']): PublicUnit =>
  withLinks([
    vistaUnit(floor, pos, {
      status,
      unit_type_name: pos % 2 ? 'Tipo A' : 'Tipo B',
      area_m2: pos % 2 ? 58 : 75,
      bedrooms: pos % 2 ? 2 : 3,
      facade: null,
      frontage: null,
      price: null,
      price_kind: null,
    }),
  ])[0]!;

const units = [
  unit(1, 1, 'available'),
  unit(1, 2, 'sold'),
  unit(2, 1, 'available'),
  unit(2, 2, 'available'),
  unit(10, 1, 'reserved'),
  unit(10, 2, 'negotiating'),
];
const status = toStatusMap(units);

describe('andares', () => {
  it('lista do mais alto para o mais baixo com as livres sem filtro', () => {
    const floors = floorsFromUnits(units, status);
    expect(floors.map((f) => [f.key, f.available])).toEqual([
      ['TA__F10', 0],
      ['TA__F02', 2],
      ['TA__F01', 1],
    ]);
    expect(floors.map(floorLabel)).toEqual(['10º · 0 livres', '2º · 2 livres', '1º · 1 livre']);
  });

  it('acompanha o tempo real (mapa de status novo)', () => {
    const live = { ...status, TA__F10__U1001: 'available' as const };
    expect(floorsFromUnits(units, live)[0]!.available).toBe(1);
  });
});

describe('filtros', () => {
  const all = defaultFilters(units);

  it('padrão: todos os status e todos os dormitórios; nada esmaecido', () => {
    expect(bedroomOptions(units)).toEqual([2, 3]);
    expect(isDefaultFilters(all, units)).toBe(true);
    expect(dimmedUnitKeys(units, status, all).size).toBe(0);
  });

  it('esmaece quem não atende a status e dormitórios', () => {
    const f = { statuses: new Set(['available'] as const), bedrooms: new Set([3]) };
    expect([...dimmedUnitKeys(units, status, f)].sort()).toEqual([
      'TA__F01__U101',
      'TA__F01__U102',
      'TA__F02__U201',
      'TA__F10__U1001',
      'TA__F10__U1002',
    ]);
    expect(isDefaultFilters(f, units)).toBe(false);
  });

  it('legenda: contagens por status dentro do filtro de dormitórios', () => {
    const f = { statuses: new Set(['available'] as const), bedrooms: new Set([2]) };
    const c = legendCounts(units, status, f);
    expect(c.byStatus).toEqual({
      available: 2,
      reserved: 1,
      negotiating: 0,
      sold: 0,
      unavailable: 0,
    });
    expect(c.matching).toBe(2);
    expect(c.total).toBe(6);
  });

  it('toggleIn liga e desliga sem mutar o original', () => {
    const s = new Set([2, 3]);
    expect([...toggleIn(s, 3)]).toEqual([2]);
    expect([...toggleIn(s, 4)]).toEqual([2, 3, 4]);
    expect([...s]).toEqual([2, 3]);
  });
});

describe('vários blocos', () => {
  const blocks = withLinks(
    [2, 9, 1].flatMap((t) =>
      [1, 2].flatMap((f) =>
        [1, 2].map((p) => blockUnit(t, f, p, { status: p === 1 ? 'available' : 'sold' })),
      ),
    ),
  );
  const map = toStatusMap(blocks);

  it('blocos na ordem de exibição, com livres e rótulo "Bloco 09 · 2 livres"', () => {
    const towers = towersFromUnits(blocks, map);
    expect(towers.map((t) => t.key)).toEqual(['B01', 'B02', 'B09']);
    expect(towers[2]).toMatchObject({ name: 'Bloco 09', short: '09', available: 2 });
    expect(towerLabel(towers[2]!)).toBe('Bloco 09 · 2 livres');
  });

  it('andares de um bloco, com o rótulo do térreo', () => {
    const floors = floorsFromUnits(blocks, map, 'B09');
    expect(floors.map((f) => f.key)).toEqual(['B09__F02', 'B09__F01']);
    expect(floors.map(floorLabel)).toEqual(['2º · 1 livre', 'Térreo · 1 livre']);
  });
});
