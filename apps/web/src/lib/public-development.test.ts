import { describe, expect, it } from 'vitest';
import {
  applyStatusMessage,
  countByStatus,
  interiorRefs,
  toStatusMap,
  unitTypeMap,
  type PublicUnit,
  type PublicUnitType,
} from './public-development';
import { vistaUnit } from '@/test/units';

const unit = (object_key: string, status: PublicUnit['status']): PublicUnit => ({
  ...vistaUnit(1, 1, { object_key, code: object_key.slice(-3), area_m2: 58.4, status }),
  facade: null,
  frontage: null,
  price: null,
  price_kind: null,
  link_code: object_key.slice(-3),
});

describe('mapa de status', () => {
  const map = toStatusMap([unit('TA__F01__U101', 'available'), unit('TA__F01__U102', 'sold')]);

  it('monta o mapa object_key → status e conta por status', () => {
    expect(map).toEqual({ TA__F01__U101: 'available', TA__F01__U102: 'sold' });
    expect(countByStatus(map)).toEqual({
      available: 1,
      reserved: 0,
      negotiating: 0,
      sold: 1,
      unavailable: 0,
    });
  });

  it('aplica a mensagem do Broadcast', () => {
    const next = applyStatusMessage(map, {
      id: 'x',
      object_key: 'TA__F01__U101',
      status: 'reserved',
    });
    expect(next.TA__F01__U101).toBe('reserved');
    expect(map.TA__F01__U101).toBe('available'); // imutável
  });

  it.each([
    null,
    'lixo',
    { object_key: 'TA__F01__U101' },
    { object_key: 'TA__F01__U101', status: 'vendido' },
    { object_key: 'TA__F99__U999', status: 'sold' },
    { object_key: 'TA__F01__U102', status: 'sold' },
  ])('ignora mensagem inválida, desconhecida ou repetida: %j', (payload) => {
    expect(applyStatusMessage(map, payload)).toBe(map);
  });
});

describe('interiores no manifesto', () => {
  const type = (name: string, interior: boolean): PublicUnitType => ({
    name,
    area_m2: 58,
    bedrooms: 2,
    suites: 1,
    interior_model_path: interior ? `vista/${name}-simples.glb` : null,
    interior_detail_model_path: interior ? `vista/${name}.glb` : null,
    interior_reference_unit: interior ? 'TA__F02__U201' : null,
    rooms: [],
  });

  it('só tipos com interior, com as URLs resolvidas por quem chama (getAssetUrl)', () => {
    const refs = interiorRefs(
      [type('Tipo A', true), type('Tipo C', false)],
      (p) => `https://cdn/${p}`,
    );
    expect(refs).toEqual({
      'Tipo A': {
        simpleUrl: 'https://cdn/vista/Tipo A-simples.glb',
        detailUrl: 'https://cdn/vista/Tipo A.glb',
        referenceUnit: 'TA__F02__U201',
      },
    });
  });

  it('tipo de cada unidade (sem tipo fica de fora)', () => {
    expect(
      unitTypeMap([
        { object_key: 'TA__F01__U101', unit_type_name: 'Tipo A' },
        { object_key: 'TA__F01__U102', unit_type_name: null },
      ]),
    ).toEqual({ TA__F01__U101: 'Tipo A' });
  });
});
