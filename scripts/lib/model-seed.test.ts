import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_WEIGHTS,
  buildSeedSql,
  facadeOf,
  seedUnits,
  statusFor,
  unitTypeFor,
  type ModelTower,
  type SeedConfig,
} from './model-seed';

// Centros reais do teste-flora (bloco B09, 2º andar), em planta x/z do glTF.
const B09: ModelTower = {
  code: 'B09',
  center: [18.14, -6.24],
  floors: [1, 2],
  units: [
    { objectKey: 'B09__F01__U101', code: '101', floor: 1, center: [24.35, -5.65] },
    { objectKey: 'B09__F02__U201', code: '201', floor: 2, center: [24.35, -5.65] },
    { objectKey: 'B09__F02__U202', code: '202', floor: 2, center: [21.12, -11.45] },
    { objectKey: 'B09__F02__U203', code: '203', floor: 2, center: [14.81, -0.95] },
    { objectKey: 'B09__F02__U204', code: '204', floor: 2, center: [11.92, -6.83] },
  ],
};

const config: SeedConfig = {
  organizationId: 'a0000000-0000-4000-8000-0000000000a0',
  slug: 'teste-blocos',
  name: "Residencial D'Teste",
  modelPath: 'teste-blocos/leve.glb',
  tower: { name: 'Bloco {num}', shortName: '{num}' },
  floorLabels: { '1': 'Térreo' },
  unitTypes: [
    { name: 'Térreo', area_m2: 39.2, bedrooms: 2, floors: [1], basePrice: 248000 },
    { name: 'Tipo', area_m2: 39.2, bedrooms: 2, basePrice: 229000, pricePerFloor: 3000 },
  ],
};

describe('facadeOf (norte = −Z do glTF, leste = +X)', () => {
  it('ponto cardeal mais próximo do centro do bloco ao centro da unidade', () => {
    expect(facadeOf([24.35, -5.65], B09.center)).toBe('leste');
    expect(facadeOf([21.12, -11.45], B09.center)).toBe('norte');
    expect(facadeOf([14.81, -0.95], B09.center)).toBe('sul');
    expect(facadeOf([11.92, -6.83], B09.center)).toBe('oeste');
  });
});

describe('statusFor', () => {
  it('é determinístico e cobre todos os status, com maioria disponível', () => {
    const keys = Array.from({ length: 400 }, (_, i) => `B${i % 20}__F0${i % 4}__U${i}`);
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(statusFor(k), (counts.get(statusFor(k)) ?? 0) + 1);
    expect(statusFor('B09__F02__U201')).toBe(statusFor('B09__F02__U201'));
    expect([...counts.keys()].sort()).toEqual(Object.keys(DEFAULT_STATUS_WEIGHTS).sort());
    expect(Math.max(...counts.values())).toBe(counts.get('available'));
  });

  it('respeita os pesos (só disponível)', () => {
    expect(statusFor('qualquer', { available: 1 })).toBe('available');
  });
});

describe('tipos de planta e preços', () => {
  it('térreo pelo andar; os demais andares no tipo sem lista', () => {
    expect(unitTypeFor(config.unitTypes, 1).name).toBe('Térreo');
    expect(unitTypeFor(config.unitTypes, 4).name).toBe('Tipo');
    expect(() => unitTypeFor([config.unitTypes[0]!], 3)).toThrow(/andar 3/);
  });

  it('preço sobe por andar a partir do primeiro andar do tipo', () => {
    const rows = seedUnits(B09, config);
    const u101 = rows.find((r) => r.code === '101')!;
    const u201 = rows.find((r) => r.code === '201')!;
    expect(u101.typeIndex).toBe(0);
    expect(u101.price).toBeGreaterThanOrEqual(248000);
    expect(u101.price).toBeLessThan(252001);
    // 2º andar é o primeiro do Tipo: sem acréscimo por andar.
    expect(u201.price).toBeGreaterThanOrEqual(229000);
    expect(u201.price).toBeLessThan(233001);
    expect(rows.map((r) => r.facade)).toEqual(['leste', 'leste', 'norte', 'sul', 'oeste']);
  });
});

describe('buildSeedSql', () => {
  const sql = buildSeedSql([B09], config, 'modelos/x.glb');

  it('bloco com nome, nome curto e ordem; andar com rótulo', () => {
    expect(sql).toContain("'B09', 'Bloco 09', '09', 1)");
    expect(sql).toContain("1, 'B09__F01', 'Térreo')");
    expect(sql).toContain("2, 'B09__F02', null)");
  });

  it('escapa aspas e não roda de novo se o slug existir', () => {
    expect(sql).toContain("'Residencial D''Teste'");
    expect(sql).toContain("where slug = 'teste-blocos') then");
  });

  it('uma linha por unidade, com fachada e sem frente/fundos', () => {
    expect(sql.match(/'B09__F0\d__U\d+'/g)).toHaveLength(5);
    expect(sql).toMatch(/'204', 'B09__F02__U204', '\w+', \d+, 'oeste', null\);/);
  });
});
