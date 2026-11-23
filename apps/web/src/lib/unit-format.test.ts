import { describe, expect, it } from 'vitest';
import { apartmentHeading, areaText } from './unit-format';

const unit = {
  code: '802',
  tower_name: 'Torre A',
  bedrooms: 2,
  suites: 1,
  area_m2: 58,
};

// Entre o número e "m²" vai um espaço que não quebra.
const NB = String.fromCharCode(160);

describe('Ver apartamento: textos', () => {
  it('título com dormitórios, suíte e área', () => {
    expect(apartmentHeading(unit)).toBe(`Unidade 802 · 2 dormitórios (1 suíte) · 58${NB}m²`);
    expect(apartmentHeading({ ...unit, bedrooms: 3, suites: 2, area_m2: 75.5 })).toBe(
      `Unidade 802 · 3 dormitórios (2 suítes) · 75,5${NB}m²`,
    );
    expect(apartmentHeading({ ...unit, bedrooms: 1, suites: 0 })).toBe(
      `Unidade 802 · 1 dormitório · 58${NB}m²`,
    );
  });

  it('com vários blocos, o bloco entra no título; sem dados, só o código', () => {
    expect(apartmentHeading({ ...unit, tower_name: 'Bloco 09' }, true)).toBe(
      `Unidade 802 do Bloco 09 · 2 dormitórios (1 suíte) · 58${NB}m²`,
    );
    expect(apartmentHeading({ ...unit, bedrooms: null, suites: null, area_m2: null })).toBe(
      'Unidade 802',
    );
  });

  it('área sem casas desnecessárias', () => {
    expect(areaText(20.9)).toBe(`20,9${NB}m²`);
    expect(areaText(12)).toBe(`12${NB}m²`);
  });
});
