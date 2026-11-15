import { describe, expect, it } from 'vitest';
import {
  applyStatusMessage,
  countByStatus,
  toStatusMap,
  type PublicUnit,
} from './public-development';

const unit = (object_key: string, status: PublicUnit['status']): PublicUnit => ({
  object_key,
  code: object_key.slice(-3),
  tower_code: 'TA',
  floor_number: 1,
  unit_type_name: 'Tipo A',
  area_m2: 58.4,
  bedrooms: 2,
  suites: 1,
  plan_image_path: null,
  facade: null,
  frontage: null,
  status,
  price: null,
  price_kind: null,
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
