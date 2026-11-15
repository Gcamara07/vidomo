import { describe, expect, it } from 'vitest';
import { BUILDING, parseDeepLink, searchFor } from './deep-link';
import type { PublicUnit } from './public-development';
import { positionText, priceText } from './unit-format';

const unit = (floor: number, pos: number): PublicUnit => ({
  object_key: `TA__F${String(floor).padStart(2, '0')}__U${floor * 100 + pos}`,
  code: String(floor * 100 + pos),
  tower_code: 'TA',
  floor_number: floor,
  unit_type_name: 'Tipo A',
  area_m2: 58,
  bedrooms: 2,
  suites: 1,
  plan_image_path: null,
  facade: pos <= 2 ? 'norte' : 'sul',
  frontage: pos <= 2 ? 'frente' : 'fundos',
  status: 'available',
  price: 428000,
  price_kind: 'from',
});
const units = [unit(1, 1), unit(8, 1), unit(8, 2), unit(10, 4)];

describe('parseDeepLink', () => {
  it('?u=802 abre o andar 8 com a ficha da 802', () => {
    expect(parseDeepLink({ u: '802' }, units)).toEqual({
      mode: 'floor',
      activeFloor: 'TA__F08',
      selected: 'TA__F08__U802',
    });
  });

  it('?andar=8 abre o andar', () => {
    expect(parseDeepLink({ andar: '8' }, units)).toEqual({
      mode: 'floor',
      activeFloor: 'TA__F08',
      selected: null,
    });
  });

  it.each([
    [{ u: '999' }],
    [{ u: '<script>' }],
    [{ andar: '99' }],
    [{ andar: '8º' }],
    [{ andar: '-1' }],
    [{}],
  ])('link inválido cai no modo edifício: %j', (params) => {
    expect(parseDeepLink(params, units)).toEqual(BUILDING);
  });

  it('?u= tem prioridade sobre ?andar= e aceita lista (primeiro valor)', () => {
    expect(parseDeepLink({ u: ['1004', '101'], andar: '1' }, units).selected).toBe(
      'TA__F10__U1004',
    );
  });
});

describe('searchFor', () => {
  it('unidade selecionada vira ?u=; andar vira ?andar=; prédio limpa', () => {
    expect(
      searchFor('', { mode: 'floor', activeFloor: 'TA__F08', selected: 'TA__F08__U802' }, units),
    ).toBe('?u=802');
    expect(
      searchFor('?u=802', { mode: 'floor', activeFloor: 'TA__F08', selected: null }, units),
    ).toBe('?andar=8');
    expect(searchFor('?andar=8', BUILDING, units)).toBe('');
  });

  it('mantém outros parâmetros (ex.: debug)', () => {
    expect(
      searchFor('?debug=1&u=101', { mode: 'floor', activeFloor: 'TA__F01', selected: null }, units),
    ).toBe('?debug=1&andar=1');
  });

  it('ida e volta: o link gerado abre o mesmo estado', () => {
    const nav = { mode: 'floor' as const, activeFloor: 'TA__F10', selected: 'TA__F10__U1004' };
    const params = Object.fromEntries(new URLSearchParams(searchFor('', nav, units)));
    expect(parseDeepLink(params, units)).toEqual(nav);
  });
});

describe('textos da ficha', () => {
  it('preço: a partir de / exato / consulte / vendida sem preço', () => {
    expect(priceText({ status: 'available', price: 428000, price_kind: 'from' })).toEqual({
      prefix: 'A partir de',
      value: 'R$ 428.000',
    });
    expect(priceText({ status: 'reserved', price: 488000, price_kind: 'exact' })).toEqual({
      prefix: null,
      value: 'R$ 488.000',
    });
    expect(priceText({ status: 'available', price: null, price_kind: null })).toEqual({
      prefix: null,
      value: 'Consulte condições',
    });
    // Mesmo que algo viesse do banco, vendida nunca mostra preço.
    expect(priceText({ status: 'sold', price: 500000, price_kind: 'exact' })).toBeNull();
  });

  it('posição: "Face norte · frente"', () => {
    expect(positionText({ facade: 'norte', frontage: 'frente' })).toBe('Face norte · frente');
    expect(positionText({ facade: 'sul', frontage: 'fundos' })).toBe('Face sul · fundos');
    expect(positionText({ facade: null, frontage: null })).toBeNull();
  });
});
