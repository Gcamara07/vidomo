import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_WEIGHTS,
  allocateStatuses,
  buildSeedSql,
  facadeOf,
  seedUnits,
  statusFor,
  unitTypeFor,
  type ModelTower,
  type SeedConfig,
} from './model-seed';

// Centros reais do condomínio de teste (bloco B09, 2º andar), em planta x/z do glTF.
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

  it('câmeras do viewer como jsonb (ou null)', () => {
    expect(sql).toContain("'teste-blocos/leve.glb', null, null)");
    const withCam = buildSeedSql(
      [B09],
      { ...config, viewerCameras: { default: { position: [1, 2, 3], target: [0, 0, 0] } } },
      'x.glb',
    );
    expect(withCam).toContain(`'{"default":{"position":[1,2,3],"target":[0,0,0]}}'::jsonb)`);
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

// Condomínio no formato do Jardim das Águas: 2 blocos × 4 andares × 4 unidades,
// finais 1 e 2 ao norte, 3 e 4 ao sul.
const blocos: ModelTower[] = ['B01', 'B02'].map((code, i) => ({
  code,
  center: [i * 20, 0],
  floors: [1, 2, 3, 4],
  units: [1, 2, 3, 4].flatMap((floor) =>
    [1, 2, 3, 4].map((p) => ({
      objectKey: `${code}__F0${floor}__U${floor}0${p}`,
      code: `${floor}0${p}`,
      floor,
      center: [i * 20 + (p % 2 ? -4 : 4), p <= 2 ? -4.5 : 4.5] as [number, number],
    })),
  ),
}));

const porFinal: SeedConfig = {
  ...config,
  priceVariation: 0,
  frontageByFacade: { sul: 'frente', norte: 'fundos' },
  unitTypes: [
    {
      name: 'Tipo A',
      area_m2: 46,
      bedrooms: 2,
      floors: [2, 3, 4],
      finals: ['1', '3'],
      basePrice: 235000,
      floorPriceAdjust: { '4': -3000 },
      interior: {
        modelPath: 'x/a-simples.glb',
        detailModelPath: 'x/a.glb',
        referenceUnit: 'B01__F02__U201',
      },
      rooms: [
        { name: 'Estar · jantar', area_m2: 14.3, label: [-43.1, 20.3] },
        { name: 'Quarto 1', area_m2: 8.4, label: [-46.6, 20.5] },
      ],
    },
    {
      name: 'Tipo B',
      area_m2: 53,
      bedrooms: 2,
      suites: 1,
      floors: [2, 3, 4],
      finals: ['2', '4'],
      basePrice: 275000,
    },
    {
      name: 'Tipo A térreo',
      area_m2: 59,
      bedrooms: 2,
      floors: [1],
      finals: ['1', '3'],
      basePrice: 252000,
    },
    {
      name: 'Tipo B térreo',
      area_m2: 68,
      bedrooms: 2,
      floors: [1],
      finals: ['2', '4'],
      basePrice: 295000,
    },
  ],
};

describe('tipo por andar e final, preço exato, frente/fundos', () => {
  it('escolhe o tipo pelo andar e pelo final do código', () => {
    const t = porFinal.unitTypes;
    expect(unitTypeFor(t, 3, '301').name).toBe('Tipo A');
    expect(unitTypeFor(t, 3, '304').name).toBe('Tipo B');
    expect(unitTypeFor(t, 1, '103').name).toBe('Tipo A térreo');
    expect(unitTypeFor(t, 1, '102').name).toBe('Tipo B térreo');
    expect(() => unitTypeFor(t, 5, '501')).toThrow(/andar 5 \(unidade 501\)/);
  });

  it('preço sem variação e com ajuste do 4º andar; frente pela fachada', () => {
    const rows = seedUnits(blocos[0]!, porFinal);
    const by = (code: string) => rows.find((r) => r.code === code)!;
    expect(by('201').price).toBe(235000);
    expect(by('301').price).toBe(235000);
    expect(by('401').price).toBe(232000);
    expect(by('102').price).toBe(295000);
    expect([by('201').facade, by('201').frontage]).toEqual(['norte', 'fundos']);
    expect([by('203').facade, by('203').frontage]).toEqual(['sul', 'frente']);
  });
});

describe('allocateStatuses', () => {
  const counts = {
    total: { available: 14, reserved: 4, negotiating: 3, sold: 9, unavailable: 2 },
    byFloor: { '1': { available: 2, sold: 5, reserved: 1 } },
    minAvailablePerTower: 3,
  };

  it('contagem exata, cota do andar, mínimo livre por bloco e determinismo', () => {
    const a = allocateStatuses(blocos, counts);
    expect(a).toEqual(allocateStatuses(blocos, counts));
    const tally = (keys: string[]) =>
      keys.reduce<Record<string, number>>(
        (m, k) => ({ ...m, [a.get(k)!]: (m[a.get(k)!] ?? 0) + 1 }),
        {},
      );
    const all = blocos.flatMap((b) => b.units.map((u) => u.objectKey));
    expect(tally(all)).toEqual(counts.total);
    expect(tally(all.filter((k) => k.includes('__F01__')))).toEqual({
      available: 2,
      sold: 5,
      reserved: 1,
    });
    for (const b of blocos) {
      expect(
        b.units.filter((u) => a.get(u.objectKey) === 'available').length,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('erra se a soma não bate com o número de unidades', () => {
    expect(() => allocateStatuses(blocos, { total: { ...counts.total, available: 1 } })).toThrow(
      /soma 19, mas o modelo tem 32/,
    );
  });
});

describe('buildSeedSql com interiores, cômodos e notas', () => {
  const sql = buildSeedSql(
    blocos,
    { ...porFinal, headerNote: 'Versionado.', notes: ['Cidade: X'] },
    'x.glb',
  );

  it('cabeçalho, notas, frente/fundos e preço exato', () => {
    expect(sql.split('\n').slice(1, 3)).toEqual(['-- Versionado.', '-- Cidade: X']);
    expect(sql).toContain("'201', 'B01__F02__U201', '");
    expect(sql).toMatch(/'B01__F04__U401', '\w+', 232000, 'norte', 'fundos'\)/);
  });

  it('interior depois das unidades e cômodos em ordem', () => {
    const iUpdate = sql.indexOf('update public.unit_types');
    expect(iUpdate).toBeGreaterThan(sql.lastIndexOf('insert into public.units'));
    expect(sql).toContain("interior_reference_unit = 'B01__F02__U201'");
    expect(sql).toContain("(v_org, v_type_0, 'Estar · jantar', 14.3, -43.1, 20.3, 1),");
    expect(sql).toContain("(v_org, v_type_0, 'Quarto 1', 8.4, -46.6, 20.5, 2);");
    expect(sql.match(/update public\.unit_types/g)).toHaveLength(1);
  });
});
