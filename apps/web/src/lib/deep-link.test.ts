import { describe, expect, it } from 'vitest';
import { blockUnit, vistaUnit, withLinks } from '@/test/units';
import { BUILDING, parseDeepLink, searchFor, shareUrl, type NavState } from './deep-link';
import { positionText, priceText } from './unit-format';

// Residencial Vista: uma torre (TA), códigos únicos.
const units = withLinks([vistaUnit(1, 1), vistaUnit(8, 1), vistaUnit(8, 2), vistaUnit(10, 4)]);

// Condomínio de blocos: B01, B02 e B09, 2 andares (F01 = Térreo), códigos repetidos.
const blocks = withLinks(
  [1, 2, 9].flatMap((t) => [1, 2].flatMap((f) => [1, 2].map((p) => blockUnit(t, f, p)))),
);

const floorOf = (tower: string | null, floor: string, selected: string | null = null) =>
  ({ mode: 'floor', activeTower: tower, activeFloor: floor, selected }) satisfies NavState;

describe('parseDeepLink: Residencial Vista (links antigos continuam)', () => {
  it('?u=802 abre o andar 8 com a ficha da 802', () => {
    expect(parseDeepLink({ u: '802' }, units)).toEqual(floorOf('TA', 'TA__F08', 'TA__F08__U802'));
  });

  it('?andar=8 abre o andar', () => {
    expect(parseDeepLink({ andar: '8' }, units)).toEqual(floorOf('TA', 'TA__F08'));
  });

  it('?u=TA-802 também funciona; ?bloco= é ignorado com uma torre só', () => {
    expect(parseDeepLink({ u: 'ta-802' }, units).selected).toBe('TA__F08__U802');
    expect(parseDeepLink({ bloco: 'TA', andar: '8' }, units)).toEqual(floorOf('TA', 'TA__F08'));
    expect(parseDeepLink({ bloco: 'TA' }, units)).toEqual(BUILDING);
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

describe('"Ver apartamento" (?ver=1)', () => {
  it('?u=802&ver=1 abre a ficha com o apartamento; ?ver=1 sem unidade é ignorado', () => {
    expect(parseDeepLink({ u: '802', ver: '1' }, units)).toEqual({
      ...floorOf('TA', 'TA__F08', 'TA__F08__U802'),
      apartment: true,
    });
    expect(parseDeepLink({ u: '802', ver: 'sim' }, units).apartment).toBeUndefined();
    expect(parseDeepLink({ andar: '8', ver: '1' }, units)).toEqual(floorOf('TA', 'TA__F08'));
  });

  it('a URL leva ?ver=1 só com o apartamento aberto; compartilhar tira o ?ver', () => {
    const nav = floorOf('TA', 'TA__F08', 'TA__F08__U802');
    expect(searchFor('?debug=1', { ...nav, apartment: true }, units)).toBe('?debug=1&u=802&ver=1');
    expect(searchFor('?u=802&ver=1', nav, units)).toBe('?u=802');
    expect(searchFor('?u=802&ver=1', BUILDING, units)).toBe('');
    expect(shareUrl('https://vidomo.app/e/residencial-vista?u=802&ver=1')).toBe(
      'https://vidomo.app/e/residencial-vista?u=802',
    );
  });
});

describe('parseDeepLink: vários blocos', () => {
  it('código repetido: o link leva o bloco (B09-201)', () => {
    const u = blocks.find((x) => x.object_key === 'B09__F02__U201')!;
    expect(u.link_code).toBe('B09-201');
    expect(parseDeepLink({ u: 'B09-201' }, blocks)).toEqual(
      floorOf('B09', 'B09__F02', 'B09__F02__U201'),
    );
    // Nome curto e minúsculas também.
    expect(parseDeepLink({ u: '09-201' }, blocks).selected).toBe('B09__F02__U201');
    expect(parseDeepLink({ u: 'b09-201' }, blocks).selected).toBe('B09__F02__U201');
  });

  it('?u=201 sozinho é ambíguo: vista geral', () => {
    expect(parseDeepLink({ u: '201' }, blocks)).toEqual(BUILDING);
  });

  it('?bloco=09 abre o bloco (aceita 09, B09 e 9)', () => {
    const tower = { mode: 'tower', activeTower: 'B09', activeFloor: null, selected: null };
    expect(parseDeepLink({ bloco: '09' }, blocks)).toEqual(tower);
    expect(parseDeepLink({ bloco: 'B09' }, blocks)).toEqual(tower);
    expect(parseDeepLink({ bloco: '9' }, blocks)).toEqual(tower);
  });

  it('?bloco=09&andar=2 abre o andar do bloco; ?andar=1 é o térreo', () => {
    expect(parseDeepLink({ bloco: '09', andar: '2' }, blocks)).toEqual(floorOf('B09', 'B09__F02'));
    expect(parseDeepLink({ bloco: '01', andar: '1' }, blocks)).toEqual(floorOf('B01', 'B01__F01'));
  });

  it('andar inexistente no bloco: fica no bloco; bloco inexistente: vista geral', () => {
    expect(parseDeepLink({ bloco: '09', andar: '7' }, blocks).mode).toBe('tower');
    expect(parseDeepLink({ bloco: '33' }, blocks)).toEqual(BUILDING);
    expect(parseDeepLink({ bloco: '<b>' }, blocks)).toEqual(BUILDING);
  });

  it('?andar=2 sem bloco é ambíguo: vista geral', () => {
    expect(parseDeepLink({ andar: '2' }, blocks)).toEqual(BUILDING);
  });
});

describe('searchFor', () => {
  it('Vista: unidade vira ?u=802; andar vira ?andar=8; prédio limpa', () => {
    expect(searchFor('', floorOf('TA', 'TA__F08', 'TA__F08__U802'), units)).toBe('?u=802');
    expect(searchFor('?u=802', floorOf('TA', 'TA__F08'), units)).toBe('?andar=8');
    expect(searchFor('?andar=8', BUILDING, units)).toBe('');
  });

  it('vários blocos: ?u=B09-201, ?bloco=09&andar=2, ?bloco=09', () => {
    expect(searchFor('', floorOf('B09', 'B09__F02', 'B09__F02__U201'), blocks)).toBe('?u=B09-201');
    expect(searchFor('', floorOf('B09', 'B09__F02'), blocks)).toBe('?bloco=09&andar=2');
    expect(
      searchFor(
        '?andar=2',
        { mode: 'tower', activeTower: 'B09', activeFloor: null, selected: null },
        blocks,
      ),
    ).toBe('?bloco=09');
    expect(searchFor('?bloco=09', BUILDING, blocks)).toBe('');
  });

  it('mantém outros parâmetros (ex.: debug)', () => {
    expect(searchFor('?debug=1&u=101', floorOf('TA', 'TA__F01'), units)).toBe('?debug=1&andar=1');
  });

  it.each<[string, NavState, typeof units]>([
    ['Vista, unidade', floorOf('TA', 'TA__F10', 'TA__F10__U1004'), units],
    ['blocos, unidade', floorOf('B02', 'B02__F01', 'B02__F01__U102'), blocks],
    ['blocos, andar', floorOf('B09', 'B09__F01'), blocks],
    [
      'blocos, bloco',
      { mode: 'tower', activeTower: 'B01', activeFloor: null, selected: null },
      blocks,
    ],
  ])('ida e volta (%s): o link gerado abre o mesmo estado', (_name, nav, list) => {
    const params = Object.fromEntries(new URLSearchParams(searchFor('', nav, list)));
    expect(parseDeepLink(params, list)).toEqual(nav);
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
