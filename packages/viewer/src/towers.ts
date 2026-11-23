/**
 * Torres (blocos) a partir dos nomes do modelo leve, e o modo efetivo do viewer.
 * Módulo puro (testável sem WebGL).
 *
 * A torre de cada peça vem do nome (UNIT__B09__…, FLOOR__B09__…, TOWER__B09), nunca da
 * posição: blocos girados em planta têm caixas que se sobrepõem.
 *
 * Com uma torre só, o modo bloco não existe: 'tower' vira 'building' e tudo funciona como
 * antes.
 *
 * Blocos colados (par do mesmo prédio): pela geometria, não pelo nome — dois blocos são
 * vizinhos se as projeções em planta (fecho convexo das lajes FLOOR__ e do TOWER__) se
 * tocam, com folga de ADJACENT_TOLERANCE_M. Num prédio de 2 blocos, é o par; numa fileira,
 * os dois lados.
 */
import { floorPartView, type FloorLevel, type PartView } from './floors';
import { parseFloorKey, parseUnitKey, type ObjectKind } from './naming';
import { TOWER_MARGIN_M, towerFootprint, type Box, type Footprint } from './site';
import type { Vec3, ViewerMode } from './types';

export interface TowerInfo {
  /** Código da torre (ex.: 'B09', 'TA'). */
  key: string;
  /** Caixa 3D da torre: TOWER__, lajes e unidades dela (para enquadrar a câmera). */
  bounds: Box;
  /** Projeção em planta (TOWER__ e FLOOR__), para separar torre × entorno. */
  footprint: Footprint;
  /** Fecho convexo em planta (x, z) das lajes e do TOWER__: forma real do bloco girado. */
  hull: Point2[];
}

/** Ponto em planta: [x, z]. */
export type Point2 = [number, number];

/** Folga para considerar dois blocos colados (m). */
export const ADJACENT_TOLERANCE_M = 0.5;

/** Torre de uma peça pelo nome; null para áreas comuns, visuais e objetos sem prefixo. */
export function towerKeyOf(kind: ObjectKind | null, objectKey: string | null): string | null {
  if (!objectKey) return null;
  if (kind === 'tower') return objectKey;
  if (kind === 'floor') return parseFloorKey(objectKey)?.tower ?? null;
  if (kind === 'unit' || kind === 'glass') return parseUnitKey(objectKey)?.tower ?? null;
  return null;
}

export interface TowerPartInput {
  kind: ObjectKind | null;
  objectKey: string | null;
  box: Box;
  /** Vértices em planta (x, z), mundo. Sem eles, usa os cantos da caixa. */
  points?: Point2[];
}

const boxCorners = (b: Box): Point2[] => [
  [b.min[0], b.min[2]],
  [b.max[0], b.min[2]],
  [b.max[0], b.max[2]],
  [b.min[0], b.max[2]],
];

const cross = (o: Point2, a: Point2, b: Point2) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Fecho convexo (cadeia monótona), anti-horário em x/z; pontos repetidos são ignorados. */
export function convexHull(points: Point2[]): Point2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const lower: Point2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2, 0), 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

const edges = (hull: Point2[]) => hull.map((a, i) => [a, hull[(i + 1) % hull.length]!] as const);

/**
 * Distância com sinal de um ponto ao fecho convexo: positiva fora, negativa dentro
 * (profundidade até a borda mais próxima).
 */
export function signedDistanceToHull(p: Point2, hull: Point2[]): number {
  if (hull.length === 0) return Infinity;
  if (hull.length === 1) return Math.hypot(p[0] - hull[0]![0], p[1] - hull[0]![1]);
  const d = Math.min(...edges(hull).map(([a, b]) => segmentDistance(p, a, b)));
  const inside = hull.length >= 3 && edges(hull).every(([a, b]) => cross(a, b, p) >= -1e-9);
  return inside ? -d : d;
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Distância entre dois fechos convexos (0 se se tocam ou se sobrepõem). */
export function hullDistance(a: Point2[], b: Point2[]): number {
  if (a.some((p) => signedDistanceToHull(p, b) <= 0)) return 0;
  if (b.some((p) => signedDistanceToHull(p, a) <= 0)) return 0;
  for (const [p, q] of edges(a)) {
    for (const [r, s] of edges(b)) if (segmentsCross(p, q, r, s)) return 0;
  }
  return Math.min(
    ...a.map((p) => signedDistanceToHull(p, b)),
    ...b.map((p) => signedDistanceToHull(p, a)),
  );
}

const unionBox = (a: Box | undefined, b: Box): Box =>
  a
    ? {
        min: a.min.map((v, i) => Math.min(v, b.min[i]!)) as Vec3,
        max: a.max.map((v, i) => Math.max(v, b.max[i]!)) as Vec3,
      }
    : { min: [...b.min], max: [...b.max] };

/** Torres do modelo, em ordem de código. */
export function computeTowers(parts: TowerPartInput[]): Map<string, TowerInfo> {
  const bounds = new Map<string, Box>();
  const plan = new Map<string, Box[]>();
  const points = new Map<string, Point2[]>();
  for (const p of parts) {
    const key = towerKeyOf(p.kind, p.objectKey);
    if (!key) continue;
    bounds.set(key, unionBox(bounds.get(key), p.box));
    if (p.kind === 'tower' || p.kind === 'floor') {
      plan.set(key, [...(plan.get(key) ?? []), p.box]);
      const list = points.get(key) ?? [];
      list.push(...(p.points ?? boxCorners(p.box)));
      points.set(key, list);
    }
  }
  const out = new Map<string, TowerInfo>();
  for (const key of [...bounds.keys()].sort()) {
    const b = bounds.get(key)!;
    // Torre só com unidades (sem TOWER__/FLOOR__): a projeção é a caixa dela.
    const footprint = towerFootprint(plan.get(key) ?? [b])!;
    const hull = convexHull(points.get(key) ?? boxCorners(b));
    out.set(key, { key, bounds: b, footprint, hull });
  }
  return out;
}

/** Blocos colados a cada bloco (projeções em planta que se tocam). */
export function computeAdjacency(
  towers: Map<string, TowerInfo>,
  tolerance = ADJACENT_TOLERANCE_M,
): Map<string, string[]> {
  const list = [...towers.values()];
  const out = new Map<string, string[]>(list.map((t) => [t.key, []]));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      // Caixas em planta longe demais: nem calcula o fecho.
      if (
        a.footprint.minX > b.footprint.maxX + tolerance ||
        b.footprint.minX > a.footprint.maxX + tolerance ||
        a.footprint.minZ > b.footprint.maxZ + tolerance ||
        b.footprint.minZ > a.footprint.maxZ + tolerance
      ) {
        continue;
      }
      if (hullDistance(a.hull, b.hull) <= tolerance) {
        out.get(a.key)!.push(b.key);
        out.get(b.key)!.push(a.key);
      }
    }
  }
  return out;
}

/**
 * Bloco de um ponto em planta: o que o contém (o mais "por dentro", na divisa entre blocos
 * colados) ou o mais próximo até `margin` (varandas, platibanda). null fora de todos.
 */
export function towerAtPoint(
  p: Point2,
  towers: Map<string, TowerInfo>,
  margin = TOWER_MARGIN_M,
): string | null {
  let best: string | null = null;
  let bestD = margin;
  for (const t of towers.values()) {
    const fp = t.footprint;
    if (
      p[0] < fp.minX - margin ||
      p[0] > fp.maxX + margin ||
      p[1] < fp.minZ - margin ||
      p[1] > fp.maxZ + margin
    ) {
      continue;
    }
    const d = signedDistanceToHull(p, t.hull);
    if (d <= bestD) {
      bestD = d;
      best = t.key;
    }
  }
  return best;
}

/** Vista efetiva depois de validar modo, torre e andar pedidos pelo app. */
export interface ResolvedView {
  mode: ViewerMode;
  /** Torre ativa (modo bloco, ou a torre do andar no modo andar). */
  tower?: TowerInfo;
  /** Andar ativo (só no modo andar). */
  floor?: FloorLevel;
  /** Pedido inválido (torre ou andar que não existe no modelo): explica o que foi feito. */
  warning?: string;
}

export function resolveView(
  mode: ViewerMode,
  activeTower: string | null,
  activeFloor: string | null,
  towers: Map<string, TowerInfo>,
  levels: Map<string, FloorLevel>,
): ResolvedView {
  if (mode === 'floor') {
    const floor = activeFloor ? levels.get(activeFloor) : undefined;
    if (floor) return { mode: 'floor', floor, tower: towers.get(floor.tower) };
    return {
      mode: 'building',
      warning: `andar "${activeFloor ?? ''}" não existe no modelo; mostrando o prédio.`,
    };
  }
  if (mode === 'tower') {
    // Uma torre só: o modo bloco é pulado (sem aviso, é o caso normal).
    if (towers.size <= 1) return { mode: 'building' };
    const tower = activeTower ? towers.get(activeTower) : undefined;
    if (tower) return { mode: 'tower', tower };
    return {
      mode: 'building',
      warning: `bloco "${activeTower ?? ''}" não existe no modelo; mostrando o condomínio.`,
    };
  }
  return { mode: 'building' };
}

/**
 * Blocos recortados por altura no modo andar: o ativo e os colados a ele. Os outros viram
 * silhuetas inteiras. null = sem silhuetas (fora do modo andar, ou uma torre só: o Vista
 * segue como antes).
 */
export function cutTowers(
  view: ResolvedView,
  adjacency: Map<string, string[]>,
): ReadonlySet<string> | null {
  if (view.mode !== 'floor' || !view.tower || adjacency.size <= 1) return null;
  return new Set([view.tower.key, ...(adjacency.get(view.tower.key) ?? [])]);
}

/**
 * Como uma unidade ou laje aparece:
 * - modo edifício: normal;
 * - modo bloco: normal na torre ativa; 'context' (esmaecida, tocável) nas outras;
 * - modo andar: blocos fora do corte (`cut`) são silhueta ('ghost'); no ativo e nos colados,
 *   pela cota (floorPartView) — acima do corte some, abaixo esmaece; só o andar ativo da
 *   torre ativa fica normal.
 */
export function partView(
  floor: FloorLevel | undefined,
  tower: string | null,
  view: ResolvedView,
  cut: ReadonlySet<string> | null = null,
): PartView {
  if (view.mode === 'tower') return tower === view.tower?.key ? 'normal' : 'context';
  if (cut && !cut.has(tower ?? '')) return 'ghost';
  return floorPartView(floor, view.mode, view.floor);
}

const centerOf = (t: TowerInfo): Point2 => [
  (t.bounds.min[0] + t.bounds.max[0]) / 2,
  (t.bounds.min[2] + t.bounds.max[2]) / 2,
];

/**
 * Ponto do rótulo do bloco na vista geral, acima do topo. Sem vizinho colado: no centro.
 * Com vizinho: perto da ponta externa, do lado oposto ao vizinho (os rótulos do par não se
 * sobrepõem).
 */
export function towerLabelPosition(
  t: TowerInfo,
  neighbors: TowerInfo[] = [],
  lift = 2,
  inset = 2,
): Vec3 {
  const c = centerOf(t);
  const y = t.bounds.max[1] + lift;
  if (neighbors.length === 0) return [c[0], y, c[1]];
  const others = neighbors.map(centerOf);
  const m: Point2 = [
    others.reduce((s, p) => s + p[0], 0) / others.length,
    others.reduce((s, p) => s + p[1], 0) / others.length,
  ];
  const len = Math.hypot(c[0] - m[0], c[1] - m[1]);
  if (len < 1e-6) return [c[0], y, c[1]];
  const dir: Point2 = [(c[0] - m[0]) / len, (c[1] - m[1]) / len];
  const reach = Math.max(...t.hull.map((v) => (v[0] - c[0]) * dir[0] + (v[1] - c[1]) * dir[1]));
  const k = Math.max(reach - inset, 0);
  return [c[0] + dir[0] * k, y, c[1] + dir[1] * k];
}

/**
 * Ângulo horizontal da câmera no modo bloco (convenção de camera.ts: 0 = olhando de +Z):
 * do lado de fora, oposto aos blocos colados, girado `turn` rad para mostrar duas fachadas.
 * Assim o bloco do par fica atrás do ativo, não na frente. Sem vizinho: undefined (mantém o
 * ângulo atual da câmera, como numa torre só).
 */
export function outwardAzimuth(
  t: TowerInfo,
  neighbors: TowerInfo[],
  turn = 0.6,
): number | undefined {
  if (neighbors.length === 0) return undefined;
  const c = centerOf(t);
  const m = neighbors.map(centerOf).reduce<Point2>((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
  const dx = c[0] - m[0] / neighbors.length;
  const dz = c[1] - m[1] / neighbors.length;
  if (Math.hypot(dx, dz) < 1e-6) return undefined;
  return Math.atan2(dx, dz) + turn;
}
