import { describe, expect, it } from 'vitest';
import { clipRange, computeFloorLevels, floorPartView, unitView } from './floors';
import { floorKeyOfUnit, parseFloorKey } from './naming';

// Como no modelo real: térreo de 4 m, lajes de 0,20 m a cada 3 m, topo em 34,2 m.
const slab = (n: number) => ({
  objectKey: `TA__F${String(n).padStart(2, '0')}`,
  min: [-9.5, 4 + (n - 1) * 3, -8.5] as [number, number, number],
  max: [9.5, 4 + (n - 1) * 3 + 0.2, 8.5] as [number, number, number],
});
const slabs = Array.from({ length: 10 }, (_, i) => slab(i + 1)).reverse(); // fora de ordem
const levels = computeFloorLevels(slabs, 34.2);
const byKey = new Map(levels.map((l) => [l.key, l]));

describe('computeFloorLevels', () => {
  it('ordena os andares e calcula base e topo pelas lajes', () => {
    expect(levels.map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(byKey.get('TA__F01')).toMatchObject({ tower: 'TA', base: 4, top: 7 });
    expect(byKey.get('TA__F08')).toMatchObject({ base: 25, top: 28 });
    // Último andar vai até o topo do prédio.
    expect(byKey.get('TA__F10')).toMatchObject({ base: 31, top: 34.2 });
  });

  it('ignora nomes fora do padrão', () => {
    expect(computeFloorLevels([{ ...slab(1), objectKey: 'TA__F1' }], 10)).toEqual([]);
  });
});

describe('visibilidade no modo andar', () => {
  const active = byKey.get('TA__F08');

  it('modo edifício: tudo normal', () => {
    expect(floorPartView(byKey.get('TA__F10'), 'building', active)).toBe('normal');
    expect(clipRange('building', active)).toBeNull();
  });

  it('andar ativo normal, acima oculto, abaixo esmaecido', () => {
    expect(unitView('TA__F08__U802', byKey, 'floor', active)).toBe('normal');
    expect(unitView('TA__F09__U901', byKey, 'floor', active)).toBe('hidden');
    expect(unitView('TA__F10__U1004', byKey, 'floor', active)).toBe('hidden');
    expect(unitView('TA__F07__U701', byKey, 'floor', active)).toBe('lower');
    expect(unitView('TA__F01__U101', byKey, 'floor', active)).toBe('lower');
  });

  it('sem andar ativo válido, volta ao normal', () => {
    expect(unitView('TA__F10__U1004', byKey, 'floor', undefined)).toBe('normal');
  });

  it('recorte da camada de detalhes pela cota do andar', () => {
    expect(clipRange('floor', active)).toEqual({ bottom: 24.98, top: 27.98 });
  });
});

describe('chaves de andar', () => {
  it('decompõe e deriva o andar da unidade', () => {
    expect(parseFloorKey('TA__F08')).toEqual({ tower: 'TA', floor: 8 });
    expect(parseFloorKey('TA__F8')).toBeNull();
    expect(floorKeyOfUnit('TA__F10__U1004')).toBe('TA__F10');
    expect(floorKeyOfUnit('lixo')).toBeNull();
  });
});
