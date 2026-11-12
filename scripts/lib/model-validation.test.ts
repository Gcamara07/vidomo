import { describe, expect, it } from 'vitest';
import { MAX_MODEL_BYTES, compareModel } from './model-validation';

const db = {
  unitKeys: ['TA__F01__U101', 'TA__F01__U102', 'TA__F02__U201'],
  floorKeys: ['TA__F01', 'TA__F02'],
};

describe('compareModel', () => {
  it('modelo idêntico ao banco passa', () => {
    const r = compareModel(
      [
        'TOWER__TA',
        'FLOOR__TA__F01',
        'FLOOR__TA__F02',
        'UNIT__TA__F01__U101',
        'UNIT__TA__F01__U102',
        'UNIT__TA__F02__U201',
        'VIS__NUCLEO',
      ],
      db,
      1000,
    );
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({ unitObjects: 3, floorObjects: 2, dbUnits: 3, dbFloors: 2 });
  });

  it('lista unidades sem objeto e objetos sem unidade', () => {
    const r = compareModel(
      ['FLOOR__TA__F01', 'FLOOR__TA__F02', 'UNIT__TA__F01__U101', 'UNIT__TA__F09__U999'],
      db,
      1000,
    );
    expect(r.ok).toBe(false);
    expect(r.unitsWithoutObject).toEqual(['TA__F01__U102', 'TA__F02__U201']);
    expect(r.objectsWithoutUnit).toEqual(['TA__F09__U999']);
  });

  it('aponta nomes fora do padrão, duplicados e sem prefixo', () => {
    const r = compareModel(
      [
        ...db.unitKeys.map((k) => `UNIT__${k}`),
        'UNIT__TA__F01__U101.001',
        'FLOOR__TA__F01',
        'FLOOR__TA__F01',
        'Cube',
      ],
      db,
      1000,
    );
    expect(r.invalidNames).toEqual(['UNIT__TA__F01__U101.001']);
    expect(r.duplicateKeys).toEqual(['TA__F01']);
    expect(r.unprefixedNames).toEqual(['Cube']);
    expect(r.floorsWithoutObject).toEqual(['TA__F02']);
    expect(r.ok).toBe(false);
  });

  it('reprova arquivo acima de 10 MB', () => {
    const names = db.unitKeys.map((k) => `UNIT__${k}`);
    expect(compareModel(names, db, MAX_MODEL_BYTES).ok).toBe(true);
    expect(compareModel(names, db, MAX_MODEL_BYTES + 1).overSizeLimit).toBe(true);
  });
});
