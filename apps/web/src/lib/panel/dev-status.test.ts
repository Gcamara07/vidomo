import { describe, expect, it } from 'vitest';
import {
  defaultFilters,
  developmentOptions,
  filterUnits,
  floorColumn,
  floorOptions,
  groupByTower,
  groupTitle,
  manyTowers,
  sortUnits,
  towerColumn,
  towerOptions,
  type DevStatusUnit,
} from './dev-status';

const pad = (n: number) => String(n).padStart(2, '0');

function unit(p: Partial<DevStatusUnit> & { code: string; floor: number }): DevStatusUnit {
  return {
    id: `${p.developmentSlug ?? 'x'}-${p.towerCode ?? 'TA'}-${p.code}`,
    objectKey: `${p.towerCode ?? 'TA'}__F${pad(p.floor)}__U${p.code}`,
    status: 'available',
    updatedAt: '2026-11-22T12:00:00Z',
    floorLabel: null,
    typeName: 'Tipo',
    development: 'Residencial Vista',
    developmentSlug: 'residencial-vista',
    published: true,
    towerCode: 'TA',
    towerName: 'Torre A',
    towerShort: null,
    towerOrder: 0,
    ...p,
  };
}

// Condomínio de blocos com ordem de exibição diferente do código (B10 antes de B02).
const blocos = (tower: number, order: number, floor: number, pos: number, status = 'available') =>
  unit({
    code: `${floor}0${pos}`,
    floor,
    floorLabel: floor === 1 ? 'Térreo' : null,
    status: status as DevStatusUnit['status'],
    development: 'Condomínio de teste',
    developmentSlug: 'condominio-de-teste',
    towerCode: `B${pad(tower)}`,
    towerName: `Bloco ${pad(tower)}`,
    towerShort: pad(tower),
    towerOrder: order,
  });

const units = [
  unit({ code: '802', floor: 8 }),
  unit({ code: '101', floor: 1, status: 'sold' }),
  blocos(2, 2, 2, 1),
  blocos(10, 1, 1, 2, 'sold'),
  blocos(10, 1, 2, 1),
  blocos(2, 2, 1, 1),
  blocos(10, 1, 1, 1),
];

describe('ordem', () => {
  it('empreendimento → bloco (ordem do cadastro) → andar → unidade', () => {
    expect(sortUnits(units).map((u) => `${u.developmentSlug[0]}${u.towerCode}-${u.code}`)).toEqual([
      'cB10-101',
      'cB10-102',
      'cB10-201',
      'cB02-101',
      'cB02-201',
      'rTA-101',
      'rTA-802',
    ]);
  });
});

describe('filtros', () => {
  it('abre no primeiro empreendimento da lista, com o resto em "todos"', () => {
    expect(developmentOptions(units).map((d) => d.slug)).toEqual([
      'condominio-de-teste',
      'residencial-vista',
    ]);
    expect(defaultFilters(units)).toEqual({
      development: 'condominio-de-teste',
      tower: '',
      floor: null,
      status: '',
    });
    expect(defaultFilters([]).development).toBe('');
  });

  it('empreendimento, bloco, andar e status', () => {
    const base = defaultFilters(units);
    expect(filterUnits(units, base)).toHaveLength(5);
    expect(filterUnits(units, { ...base, tower: 'B02' }).map((u) => u.code)).toEqual([
      '101',
      '201',
    ]);
    expect(filterUnits(units, { ...base, floor: 1 })).toHaveLength(3);
    expect(filterUnits(units, { ...base, status: 'sold' }).map((u) => u.objectKey)).toEqual([
      'B10__F01__U102',
    ]);
    expect(
      filterUnits(units, { development: 'residencial-vista', tower: '', floor: 8, status: '' }),
    ).toHaveLength(1);
  });

  it('opções de bloco e andar do empreendimento (andar com rótulo do cadastro)', () => {
    expect(towerOptions(units, 'condominio-de-teste')).toEqual([
      { code: 'B10', name: 'Bloco 10' },
      { code: 'B02', name: 'Bloco 02' },
    ]);
    expect(floorOptions(units, 'condominio-de-teste', '')).toEqual([
      { number: 1, label: 'Térreo' },
      { number: 2, label: '2º' },
    ]);
    expect(floorOptions(units, 'residencial-vista', '')).toEqual([
      { number: 1, label: '1º' },
      { number: 8, label: '8º' },
    ]);
  });
});

describe('bloco', () => {
  it('coluna e grupos só com mais de um bloco', () => {
    expect(manyTowers(units, 'condominio-de-teste')).toBe(true);
    expect(manyTowers(units, 'residencial-vista')).toBe(false);
  });

  it('coluna: nome curto, ou o nome; andar: rótulo, ou o número', () => {
    expect(towerColumn(blocos(9, 9, 2, 1))).toBe('09');
    expect(towerColumn(unit({ code: '802', floor: 8 }))).toBe('Torre A');
    expect(floorColumn(blocos(9, 9, 1, 1))).toBe('Térreo');
    expect(floorColumn(unit({ code: '802', floor: 8 }))).toBe('8');
  });

  it('grupos com cabeçalho "Bloco 10 · 3 unidades · 2 disponíveis"', () => {
    const groups = groupByTower(filterUnits(units, defaultFilters(units)));
    expect(groups.map((g) => g.code)).toEqual(['B10', 'B02']);
    expect(groupTitle(groups[0]!)).toBe('Bloco 10 · 3 unidades · 2 disponíveis');
    expect(groupTitle({ name: 'Bloco 02', units: [units[0]!], available: 1 })).toBe(
      'Bloco 02 · 1 unidade · 1 disponível',
    );
  });
});
