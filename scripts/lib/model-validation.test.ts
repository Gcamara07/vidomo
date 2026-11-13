import { describe, expect, it } from 'vitest';
import { BASE_MODEL_BUDGET_BYTES, MAX_MODEL_BYTES, compareModel } from './model-validation';

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

  it('modelo leve acima de 2 MB gera aviso, mas não reprova', () => {
    const names = db.unitKeys.map((k) => `UNIT__${k}`);
    const ok = compareModel(names, db, BASE_MODEL_BUDGET_BYTES);
    expect(ok.overBaseBudget).toBe(false);
    expect(ok.warnings).toEqual([]);

    const heavy = compareModel(names, db, BASE_MODEL_BUDGET_BYTES + 1);
    expect(heavy.overBaseBudget).toBe(true);
    expect(heavy.warnings[0]).toMatch(/Modelo leve com 2\.00 MB/);
    expect(heavy.ok).toBe(true);
  });

  it('camada de detalhes: não exige unidades, avisa se tiver, sem orçamento de 2 MB', () => {
    const detail = compareModel(['VIS__VARANDAS', 'VIS__ENTORNO'], db, 5 * 1024 * 1024, 'detail');
    expect(detail.ok).toBe(true);
    expect(detail.unitsWithoutObject).toEqual([]);
    expect(detail.overBaseBudget).toBe(false);
    expect(detail.warnings).toEqual([]);

    const withUnits = compareModel(['UNIT__TA__F01__U101'], db, 1000, 'detail');
    expect(withUnits.warnings[0]).toMatch(/1 objetos UNIT__/);
  });

  it('aceita áreas comuns (AMENITY__) na camada de detalhes e as lista', () => {
    const r = compareModel(
      ['VIS__TERRENO', 'AMENITY__PISCINA', 'AMENITY__GOURMET', 'AMENITY__ACADEMIA'],
      db,
      1000,
      'detail',
    );
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.amenities).toEqual(['ACADEMIA', 'GOURMET', 'PISCINA']);
  });

  it('reprova arquivo acima de 10 MB', () => {
    const names = db.unitKeys.map((k) => `UNIT__${k}`);
    expect(compareModel(names, db, MAX_MODEL_BYTES).ok).toBe(true);
    expect(compareModel(names, db, MAX_MODEL_BYTES + 1).overSizeLimit).toBe(true);
  });
});
