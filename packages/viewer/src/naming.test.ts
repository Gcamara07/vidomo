import { describe, expect, it } from 'vitest';
import { floorObjectKey, parseObjectName, parseUnitKey, unitObjectKey } from './naming';

describe('parseObjectName', () => {
  it.each([
    ['UNIT__TA__F08__U802', 'unit', 'TA__F08__U802'],
    ['UNIT__TA__F10__U1004', 'unit', 'TA__F10__U1004'],
    ['FLOOR__TA__F08', 'floor', 'TA__F08'],
    ['TOWER__TA', 'tower', 'TA'],
    ['AMENITY__PISCINA', 'amenity', 'PISCINA'],
    ['VIS__FACHADA_NORTE', 'visual', 'FACHADA_NORTE'],
  ])('%s → %s %s', (name, kind, objectKey) => {
    expect(parseObjectName(name)).toEqual({ kind, objectKey, valid: true });
  });

  it('ignora objetos sem prefixo conhecido', () => {
    expect(parseObjectName('Cube.001')).toBeNull();
    expect(parseObjectName('Scene')).toBeNull();
  });

  it.each([
    'UNIT__TA__F8__U802',
    'UNIT__TA__F08__U802.001',
    'UNIT__ta__F08__U802',
    'UNIT__TA__U802',
  ])('marca %s como inválido', (name) => {
    expect(parseObjectName(name)).toMatchObject({ kind: 'unit', valid: false });
  });

  it('aceita prefixos configurados no manifesto', () => {
    expect(
      parseObjectName('U-TA__F01__U101', {
        unit: 'U-',
        floor: 'FLOOR__',
        tower: 'TOWER__',
        amenity: 'AMENITY__',
        visual: 'VIS__',
        glass: 'VIDRO__',
      }),
    ).toEqual({ kind: 'unit', objectKey: 'TA__F01__U101', valid: true });
  });
});

describe('VIDRO__ (vidros da unidade na fachada)', () => {
  it('usa o object_key da unidade e não se confunde com VIS__', () => {
    expect(parseObjectName('VIDRO__TA__F06__U601')).toEqual({
      kind: 'glass',
      objectKey: 'TA__F06__U601',
      valid: true,
    });
    expect(parseObjectName('VIDRO__TA__F6__U601')?.valid).toBe(false);
    expect(parseObjectName('VIS__VIDRO_LOBBY')?.kind).toBe('visual');
  });
});

describe('chaves de unidade e andar', () => {
  it('decompõe e recompõe', () => {
    expect(parseUnitKey('TA__F08__U802')).toEqual({ tower: 'TA', floor: 8, code: '802' });
    expect(parseUnitKey('lixo')).toBeNull();
    expect(unitObjectKey('TA', 8, 802)).toBe('TA__F08__U802');
    expect(unitObjectKey('TA', 10, '1004')).toBe('TA__F10__U1004');
    expect(floorObjectKey('TA', 3)).toBe('TA__F03');
  });
});
