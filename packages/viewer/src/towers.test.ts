import { describe, expect, it } from 'vitest';
import { clipRange, computeFloorLevels } from './floors';
import { classifyZone, type Box } from './site';
import {
  computeAdjacency,
  computeTowers,
  convexHull,
  cutTowers,
  hullDistance,
  partView,
  resolveView,
  signedDistanceToHull,
  towerAtPoint,
  towerKeyOf,
  towerLabelPosition,
  type Point2,
  type TowerPartInput,
} from './towers';

const box = (min: [number, number, number], max: [number, number, number]): Box => ({ min, max });

// Caixas reais do teste-flora (par B09 + B10, blocos girados ~26° em planta: as caixas
// alinhadas aos eixos se sobrepõem). 4 andares de 2,8 m, topo em 12,4 m.
const FLOORS = [1, 2, 3, 4];
const slabB09 = (f: number) =>
  box([7.83, (f - 1) * 2.8, -15.72], [28.45, (f - 1) * 2.8 + 0.1, 3.25]);
const slabB10 = (f: number) =>
  box([13.45, (f - 1) * 2.8, -4.04], [34.07, (f - 1) * 2.8 + 0.1, 14.93]);
const pad = (f: number) => String(f).padStart(2, '0');
// Cantos reais das lajes em planta (x, z): os dois blocos do par dividem uma aresta.
const HULL_B09: Point2[] = [
  [7.8, -8.4],
  [22.7, -15.7],
  [28.4, -4.0],
  [13.5, 3.2],
];
const HULL_B10: Point2[] = [
  [13.5, 3.2],
  [28.4, -4.0],
  [34.1, 7.7],
  [19.2, 14.9],
];
// B11: o prédio vizinho (outro par), 6 m além do B10, também girado.
const HULL_B11: Point2[] = HULL_B10.map(([x, z]) => [x + 8.3, z + 17.1]);
const boxOfHull = (h: Point2[], y0: number, y1: number) =>
  box(
    [Math.min(...h.map((p) => p[0])), y0, Math.min(...h.map((p) => p[1]))],
    [Math.max(...h.map((p) => p[0])), y1, Math.max(...h.map((p) => p[1]))],
  );

const parts: TowerPartInput[] = [
  { kind: 'tower', objectKey: 'B09', box: box([13.44, 0, -12.84], [22.83, 12.4, 0.37]) },
  { kind: 'tower', objectKey: 'B10', box: box([19.14, 0, -1.16], [28.53, 12.4, 12.05]) },
  ...FLOORS.flatMap((f) => [
    { kind: 'floor' as const, objectKey: `B09__F${pad(f)}`, box: slabB09(f) },
    { kind: 'floor' as const, objectKey: `B10__F${pad(f)}`, box: slabB10(f) },
    {
      kind: 'floor' as const,
      objectKey: `B11__F${pad(f)}`,
      box: boxOfHull(HULL_B11, (f - 1) * 2.8, (f - 1) * 2.8 + 0.1),
      points: HULL_B11,
    },
  ]),
  {
    kind: 'unit',
    objectKey: 'B09__F02__U201',
    box: box([20.33, 2.95, -9.79], [28.37, 5.45, -1.5]),
  },
  { kind: 'amenity', objectKey: 'PISCINA', box: box([-23.8, 0.1, -40.4], [-5.7, 0.2, -27.1]) },
  { kind: null, objectKey: null, box: box([0, 0, 0], [1, 1, 1]) },
];
// Formas reais em planta das lajes do par (sem elas, os cantos da caixa).
for (const p of parts) {
  if (p.kind !== 'floor' && p.kind !== 'tower') continue;
  if (p.objectKey?.startsWith('B09')) p.points = HULL_B09;
  if (p.objectKey?.startsWith('B10')) p.points = HULL_B10;
}
const towers = computeTowers(parts);
const adjacency = computeAdjacency(towers);
const levels = new Map(
  computeFloorLevels(
    parts.filter((p) => p.kind === 'floor').map((p) => ({ objectKey: p.objectKey!, ...p.box })),
    12.4,
  ).map((l) => [l.key, l]),
);

// Residencial Vista: uma torre só.
const vista = computeTowers([
  { kind: 'tower', objectKey: 'TA', box: box([-9.5, 0, -8.5], [9.5, 4, 8.5]) },
  { kind: 'floor', objectKey: 'TA__F08', box: box([-9.5, 25, -8.5], [9.5, 25.2, 8.5]) },
]);
const vistaLevels = new Map(
  computeFloorLevels(
    [{ objectKey: 'TA__F08', ...box([-9.5, 25, -8.5], [9.5, 25.2, 8.5]) }],
    28,
  ).map((l) => [l.key, l]),
);

describe('towerKeyOf', () => {
  it('lê a torre pelo nome, nunca pela posição', () => {
    expect(towerKeyOf('unit', 'B09__F02__U201')).toBe('B09');
    expect(towerKeyOf('floor', 'B10__F04')).toBe('B10');
    expect(towerKeyOf('tower', 'B09')).toBe('B09');
    expect(towerKeyOf('amenity', 'PISCINA')).toBeNull();
    expect(towerKeyOf('unit', 'lixo')).toBeNull();
    expect(towerKeyOf(null, null)).toBeNull();
  });
});

describe('computeTowers', () => {
  it('agrupa núcleo, lajes e unidades por torre, em ordem de código', () => {
    expect([...towers.keys()]).toEqual(['B09', 'B10', 'B11']);
    const b09 = towers.get('B09')!;
    expect(b09.bounds).toEqual(box([7.83, 0, -15.72], [28.45, 12.4, 3.25]));
    // A projeção vem só de TOWER__ e FLOOR__.
    expect(b09.footprint).toEqual({ minX: 7.83, maxX: 28.45, minZ: -15.72, maxZ: 3.25 });
  });

  it('fecho convexo em planta com a forma girada do bloco', () => {
    expect(convexHull(towers.get('B09')!.hull)).toEqual(towers.get('B09')!.hull);
    expect(towers.get('B09')!.hull).toHaveLength(4);
  });

  it('rótulo: sem vizinho, no centro; com vizinho, na ponta oposta a ele', () => {
    expect(towerLabelPosition(towers.get('B09')!)).toEqual([18.14, 14.4, -6.235]);
    const [x, y, z] = towerLabelPosition(towers.get('B09')!, [towers.get('B10')!]);
    expect(y).toBe(14.4);
    const b10 = towers.get('B10')!.bounds;
    const dist = (px: number, pz: number) =>
      Math.hypot(px - (b10.min[0] + b10.max[0]) / 2, pz - (b10.min[2] + b10.max[2]) / 2);
    // Mais longe do B10 do que o centro do B09, e ainda dentro do B09.
    expect(dist(x, z)).toBeGreaterThan(dist(18.14, -6.235));
    expect(signedDistanceToHull([x, z], HULL_B09)).toBeLessThan(0);
  });
});

describe('blocos colados (par) pela geometria', () => {
  it('distância entre fechos: 0 quando dividem uma aresta, > 0 quando separados', () => {
    expect(hullDistance(HULL_B09, HULL_B10)).toBe(0);
    expect(hullDistance(HULL_B10, HULL_B11)).toBeCloseTo(6, 0);
    // Cruz: retângulos que se cruzam sem vértice de um dentro do outro.
    const h: Point2[] = [
      [-5, -1],
      [5, -1],
      [5, 1],
      [-5, 1],
    ];
    const v: Point2[] = [
      [-1, -5],
      [1, -5],
      [1, 5],
      [-1, 5],
    ];
    expect(hullDistance(h, v)).toBe(0);
  });

  it('o par é o bloco colado, não o vizinho de outro prédio', () => {
    expect(adjacency.get('B09')).toEqual(['B10']);
    expect(adjacency.get('B10')).toEqual(['B09']);
    expect(adjacency.get('B11')).toEqual([]);
  });

  it('bloco de um ponto: dentro, na divisa (o mais por dentro) e na margem', () => {
    expect(towerAtPoint([18, -6], towers)).toBe('B09');
    expect(towerAtPoint([24, 5], towers)).toBe('B10');
    // Na aresta comum, um pouco para o lado do B10.
    expect(towerAtPoint([21.5, 0.2], towers)).toBe('B10');
    // Varanda: 1 m para fora do B09 (lado oposto ao B10).
    expect(towerAtPoint([7.0, -9.6], towers)).toBe('B09');
    expect(towerAtPoint([-50, -50], towers)).toBeNull();
  });
});

describe('resolveView', () => {
  it('modo bloco com torre válida', () => {
    const v = resolveView('tower', 'B09', null, towers, levels);
    expect(v.mode).toBe('tower');
    expect(v.tower?.key).toBe('B09');
    expect(v.warning).toBeUndefined();
  });

  it('modo andar: a torre vem do andar (ignora activeTower)', () => {
    const v = resolveView('floor', 'B10', 'B09__F02', towers, levels);
    expect(v).toMatchObject({ mode: 'floor', floor: { key: 'B09__F02' }, tower: { key: 'B09' } });
  });

  it('torre ou andar inválidos viram a vista geral, com aviso', () => {
    expect(resolveView('tower', 'B99', null, towers, levels)).toMatchObject({
      mode: 'building',
      warning: expect.stringContaining('B99'),
    });
    expect(resolveView('floor', null, 'B09__F09', towers, levels)).toMatchObject({
      mode: 'building',
      warning: expect.stringContaining('B09__F09'),
    });
  });

  it('uma torre só: o modo bloco é pulado, sem aviso (Residencial Vista)', () => {
    expect(resolveView('tower', 'TA', null, vista, vistaLevels)).toEqual({ mode: 'building' });
    expect(resolveView('floor', null, 'TA__F08', vista, vistaLevels)).toMatchObject({
      mode: 'floor',
      floor: { key: 'TA__F08' },
    });
    expect(resolveView('building', null, null, vista, vistaLevels)).toEqual({ mode: 'building' });
  });
});

describe('partView', () => {
  const f = (k: string) => levels.get(k);

  it('vista geral: tudo normal', () => {
    const v = resolveView('building', null, null, towers, levels);
    expect(partView(f('B10__F04'), 'B10', v)).toBe('normal');
  });

  it('modo bloco: bloco ativo normal, os outros esmaecidos (contexto)', () => {
    const v = resolveView('tower', 'B09', null, towers, levels);
    expect(partView(f('B09__F04'), 'B09', v)).toBe('normal');
    expect(partView(f('B10__F02'), 'B10', v)).toBe('context');
    expect(clipRange(v.mode, v.floor)).toBeNull();
  });

  it('modo andar: recorte só no bloco ativo e no colado; os outros viram silhueta', () => {
    const v = resolveView('floor', null, 'B09__F02', towers, levels);
    const cut = cutTowers(v, adjacency);
    expect(cut).toEqual(new Set(['B09', 'B10']));
    expect(partView(f('B09__F02'), 'B09', v, cut)).toBe('normal');
    // Bloco colado, mesmo andar: esmaecido abaixo do corte, não em destaque.
    expect(partView(f('B10__F02'), 'B10', v, cut)).toBe('lower');
    expect(partView(f('B09__F01'), 'B09', v, cut)).toBe('lower');
    // Acima do corte some, no ativo e no colado.
    expect(partView(f('B09__F03'), 'B09', v, cut)).toBe('hidden');
    expect(partView(f('B10__F03'), 'B10', v, cut)).toBe('hidden');
    // Outro prédio: silhueta inteira, em qualquer andar, e não muda ao trocar de andar.
    for (const n of FLOORS) expect(partView(f(`B11__F${pad(n)}`), 'B11', v, cut)).toBe('ghost');
    const v4 = resolveView('floor', null, 'B09__F04', towers, levels);
    expect(cutTowers(v4, adjacency)).toEqual(cut);
    // Peça sem bloco (fora de todos): silhueta também.
    expect(partView(undefined, null, v, cut)).toBe('ghost');
    // Os planos de corte valem só para quem está no corte.
    expect(clipRange(v.mode, v.floor)).toEqual({ bottom: 2.78, top: 5.58 });
  });

  it('sem silhuetas fora do modo andar e com uma torre só (Vista)', () => {
    expect(cutTowers(resolveView('tower', 'B09', null, towers, levels), adjacency)).toBeNull();
    expect(cutTowers(resolveView('building', null, null, towers, levels), adjacency)).toBeNull();
    const vistaFloor = resolveView('floor', null, 'TA__F08', vista, vistaLevels);
    expect(cutTowers(vistaFloor, computeAdjacency(vista))).toBeNull();
  });
});

describe('classifyZone com vários blocos', () => {
  const fps = [...towers.values()].map((t) => t.footprint);
  const opts = { spanMinTop: 2.8 };

  it('objeto dentro de um bloco é torre', () => {
    expect(classifyZone(box([14, 0, -12], [22, 12.4, 0]), fps, opts)).toBe('tower');
  });

  it('malha única com o mesmo elemento de vários blocos é torre (esquadrias, platibanda)', () => {
    expect(classifyZone(box([-90, 0.3, -50], [50, 12.2, 90]), fps, opts)).toBe('tower');
  });

  it('piso térreo que cruza blocos, piscina e terreno são entorno', () => {
    expect(classifyZone(box([-90, 0, -50], [50, 0.15, 90]), fps, opts)).toBe('site');
    expect(classifyZone(box([-23.8, 0.1, -40.4], [-5.7, 0.2, -27.1]), fps, opts)).toBe('site');
    expect(classifyZone(box([-141, -0.1, -94], [94, 0, 139]), fps, opts)).toBe('site');
  });

  it('com uma torre só, a regra de vários blocos nunca vale (Vista igual a antes)', () => {
    const one = [...vista.values()].map((t) => t.footprint);
    // VIS__ARVORES do Vista: cruza a torre e sobe acima do 1º andar, mas é entorno.
    const trees = box([-20.61, 2.11, -19.56], [21.02, 7.61, 26.41]);
    expect(classifyZone(trees, one, { spanMinTop: 7 })).toBe('site');
  });
});
