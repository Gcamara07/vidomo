import { describe, expect, it } from 'vitest';
import { blockUnit, vistaUnit } from '@/test/units';
import {
  floorShort,
  floorText,
  hasManyTowers,
  linkCodes,
  matchesTower,
  towerShort,
  unitPhrase,
} from './unit-ref';

describe('código da unidade nos links (mesma regra de private.unit_link_code)', () => {
  it('único no empreendimento: o próprio código', () => {
    const codes = linkCodes([vistaUnit(8, 2), vistaUnit(1, 1)]);
    expect([...codes.values()]).toEqual(['802', '101']);
  });

  it('repetido entre blocos: "<bloco>-<código>"; único continua só o código', () => {
    const codes = linkCodes([
      blockUnit(9, 2, 1),
      blockUnit(10, 2, 1),
      blockUnit(10, 3, 4, { code: '304X' }),
    ]);
    expect([...codes.values()]).toEqual(['B09-201', 'B10-201', '304X']);
  });
});

describe('nomes de bloco e andar', () => {
  it('nome curto do cadastro, ou o código', () => {
    expect(towerShort(blockUnit(9, 1, 1))).toBe('09');
    expect(towerShort(vistaUnit(1, 1))).toBe('TA');
  });

  it('andar: rótulo do cadastro ("Térreo") ou "<n>º andar" / "<n>º"', () => {
    expect(floorText(blockUnit(9, 1, 1))).toBe('Térreo');
    expect(floorText(vistaUnit(8, 1))).toBe('8º andar');
    expect(floorShort(blockUnit(9, 1, 1))).toBe('Térreo');
    expect(floorShort(vistaUnit(8, 1))).toBe('8º');
  });

  it('frase: com vários blocos leva o bloco; com um só, só o código', () => {
    expect(unitPhrase(blockUnit(9, 2, 1), true)).toBe('201 do Bloco 09');
    expect(unitPhrase(vistaUnit(8, 2), false)).toBe('802');
  });

  it('vários blocos?', () => {
    expect(hasManyTowers([vistaUnit(1, 1), vistaUnit(2, 1)])).toBe(false);
    expect(hasManyTowers([blockUnit(1, 1, 1), blockUnit(2, 1, 1)])).toBe(true);
    expect(hasManyTowers([])).toBe(false);
  });

  it('bloco do link: código, nome curto ou número', () => {
    const u = blockUnit(9, 1, 1);
    for (const v of ['B09', 'b09', '09', '9', ' 09 ']) expect(matchesTower(u, v)).toBe(true);
    for (const v of ['B10', '10', '', 'Bloco 09']) expect(matchesTower(u, v)).toBe(false);
  });
});
