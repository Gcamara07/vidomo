/**
 * Encaixe do interior (maquete) numa unidade, a partir da geometria (sem posição no código).
 * Módulo puro, sem three.js: usado pelo viewer e pelo validador de modelos.
 *
 * O interior de um tipo de planta é modelado sobre uma unidade de referência (ex.: a U201 do
 * Residencial Vista), nas coordenadas do prédio. Para outra unidade do mesmo tipo:
 *
 * 1. Retângulo em planta de cada caixa UNIT__ (orientado, vale para blocos girados).
 * 2. Lados externos: o lado cujo ponto médio, empurrado 35 cm para fora, cai fora da laje
 *    FLOOR__ do andar. Na U201: fachada norte e oitão oeste; na U203: fachada sul e oitão
 *    oeste.
 * 3. As 8 transformações do retângulo (rotação de 0°, 90°, 180° ou 270°, com ou sem
 *    espelho): ficam as que levam cada lado externo da referência a um lado externo da
 *    unidade (e cada lado interno a um interno). Assim a fachada cai na fachada e a entrada
 *    fica do lado do corredor.
 * 4. Empate (ex.: unidade de meio de fileira, só com a fachada externa): sem espelho e com a
 *    menor rotação; o resultado sai marcado como ambíguo (o validador avisa).
 *    TODO(orientação): forçar a orientação por uma propriedade na caixa UNIT__ no Blender
 *    (custom property exportada como extras do glTF), para os casos ambíguos.
 * 5. Translação: centro da referência → centro da unidade. Altura: z = 0 do interior (piso
 *    acabado) → fundo da caixa da unidade (topo da laje).
 *
 * "Cabe": as medidas da referência, depois de giradas, batem com as da caixa da unidade com
 * tolerância de 5 cm por lado. A comparação é entre caixas (envoltórias), não com a malha do
 * interior: as paredes externas e a varanda passam da caixa de propósito.
 *
 * Coordenadas: as do viewer (three, Y para cima). Em planta, (x, z); o norte do Blender (+Y)
 * é −Z. O relatório (rotação e espelho) usa o Blender, que é o que o modelador vê.
 */

/** Ponto em planta (x, z) nas coordenadas do viewer. */
export type PlanPoint = [number, number];

/** Retângulo orientado em planta. */
export interface PlanRect {
  center: PlanPoint;
  /** Ângulo do eixo u em radianos, em (−45°, 45°]. */
  angle: number;
  /** Meias medidas ao longo de u e v. */
  half: [number, number];
  /** Cota do fundo (piso acabado da unidade). */
  base: number;
}

/** Lados do retângulo no próprio referencial: +u, −u, +v, −v. */
export type RectSide = 'u+' | 'u-' | 'v+' | 'v-';
export const RECT_SIDES: readonly RectSide[] = ['u+', 'u-', 'v+', 'v-'];

/** Distância para fora usada para testar se um lado é externo (m). */
export const EXTERIOR_PROBE = 0.35;
/** Tolerância de medida entre a referência e a unidade (m, por lado). */
export const FIT_TOLERANCE = 0.05;

/**
 * Retângulo orientado de uma caixa, pelos vértices em coordenadas de mundo (x, y, z
 * intercalados). O ângulo vem das arestas horizontais mais longas (módulo 90°).
 */
export function rectFromPositions(positions: ArrayLike<number>): PlanRect {
  const n = Math.floor(positions.length / 3);
  if (n === 0) throw new Error('caixa sem vértices');
  // Ângulo dominante: arestas entre vértices consecutivos de cada triângulo, pesadas pelo
  // comprimento, em graus inteiros (módulo 90°).
  const hist = new Map<number, number>();
  for (let t = 0; t + 2 < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = t + k;
      const b = t + ((k + 1) % 3);
      const dx = positions[b * 3]! - positions[a * 3]!;
      const dz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
      const dy = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
      const len = Math.hypot(dx, dz);
      if (len < 0.1 || Math.abs(dy) > 0.01) continue;
      let deg = Math.round((Math.atan2(dz, dx) * 180) / Math.PI);
      deg = ((deg % 90) + 90) % 90;
      if (deg > 45) deg -= 90;
      hist.set(deg, (hist.get(deg) ?? 0) + len);
    }
  }
  let best = 0;
  let bestW = -1;
  for (const [deg, w] of hist) {
    if (w > bestW || (w === bestW && Math.abs(deg) < Math.abs(best))) {
      best = deg;
      bestW = w;
    }
  }
  const angle = (best * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let base = Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const u = x * c + z * s;
    const v = -x * s + z * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    base = Math.min(base, y);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return {
    center: [cu * c - cv * s, cu * s + cv * c],
    angle,
    half: [(maxU - minU) / 2, (maxV - minV) / 2],
    base,
  };
}

/** Normal (para fora) de um lado, no referencial do retângulo. */
function sideNormal(side: RectSide): PlanPoint {
  switch (side) {
    case 'u+':
      return [1, 0];
    case 'u-':
      return [-1, 0];
    case 'v+':
      return [0, 1];
    case 'v-':
      return [0, -1];
  }
}

function sideOf(n: PlanPoint): RectSide {
  if (Math.abs(n[0]) > Math.abs(n[1])) return n[0] > 0 ? 'u+' : 'u-';
  return n[1] > 0 ? 'v+' : 'v-';
}

/** Ponto médio de um lado empurrado `dist` para fora, em coordenadas de mundo. */
export function sideProbe(rect: PlanRect, side: RectSide, dist = EXTERIOR_PROBE): PlanPoint {
  const [nu, nv] = sideNormal(side);
  const du = nu * (rect.half[0] + dist);
  const dv = nv * (rect.half[1] + dist);
  const c = Math.cos(rect.angle);
  const s = Math.sin(rect.angle);
  return [rect.center[0] + du * c - dv * s, rect.center[1] + du * s + dv * c];
}

/** Triângulos da laje em planta: (x, z) de 3 vértices por triângulo, intercalados. */
export type PlanTriangles = ArrayLike<number>;

/** Triângulos em planta a partir das posições de mundo (x, y, z), 3 vértices por triângulo. */
export function planTriangles(positions: ArrayLike<number>): Float32Array {
  const n = Math.floor(positions.length / 3);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = positions[i * 3]!;
    out[i * 2 + 1] = positions[i * 3 + 2]!;
  }
  return out;
}

/** O ponto (x, z) está sobre a laje (dentro de algum triângulo em planta)? */
export function onSlab(p: PlanPoint, tris: PlanTriangles): boolean {
  const [px, pz] = p;
  for (let i = 0; i + 5 < tris.length; i += 6) {
    const ax = tris[i]!;
    const az = tris[i + 1]!;
    const bx = tris[i + 2]!;
    const bz = tris[i + 3]!;
    const cx = tris[i + 4]!;
    const cz = tris[i + 5]!;
    const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
    const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
    const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}

/** Lados externos (fora da laje) de uma unidade. */
export function exteriorSides(rect: PlanRect, slab: PlanTriangles): Set<RectSide> {
  return new Set(RECT_SIDES.filter((s) => !onSlab(sideProbe(rect, s), slab)));
}

/** Transformação escolhida, nos termos do Blender (Z para cima, vista de cima). */
export interface FitTransform {
  /** Rotação em graus, anti-horária vista de cima no Blender (0, 90, 180 ou 270 se os
   *  blocos tiverem a mesma orientação). */
  rotation: number;
  /** Espelho no eixo Y do Blender (y → −y), aplicado antes da rotação. */
  mirror: boolean;
}

export interface FitResult {
  transform: FitTransform;
  /** Matriz 4×4 (coluna a coluna, como o three) que leva o interior à unidade. */
  matrix: number[];
  /** As medidas batem (tolerância de 5 cm por lado). */
  fits: boolean;
  /** Maior diferença de medida entre a referência girada e a caixa da unidade (m). */
  deviation: number;
  /** Mais de uma transformação serve: ficou a sem espelho e de menor rotação. */
  ambiguous: boolean;
  /** Os lados externos da referência casaram com os da unidade. */
  matched: boolean;
}

export interface FitSubject {
  rect: PlanRect;
  exterior: ReadonlySet<RectSide>;
}

type M2 = [number, number, number, number]; // [a, b, c, d] = [[a, b], [c, d]]

const rot2 = (a: number): M2 => [Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a)];
const mul2 = (p: M2, q: M2): M2 => [
  p[0] * q[0] + p[1] * q[2],
  p[0] * q[1] + p[1] * q[3],
  p[2] * q[0] + p[3] * q[2],
  p[2] * q[1] + p[3] * q[3],
];
const apply2 = (m: M2, p: PlanPoint): PlanPoint => [
  m[0] * p[0] + m[1] * p[1],
  m[2] * p[0] + m[3] * p[1],
];

/** As 8 transformações do retângulo no próprio referencial, na ordem de preferência. */
function dihedral(): { local: M2; mirror: boolean; quarter: number }[] {
  const out: { local: M2; mirror: boolean; quarter: number }[] = [];
  for (const mirror of [false, true]) {
    for (let q = 0; q < 4; q++) {
      const r = rot2((q * Math.PI) / 2).map((v) => Math.round(v)) as M2;
      out.push({ local: mirror ? mul2(r, [1, 0, 0, -1]) : r, mirror, quarter: q });
    }
  }
  return out;
}
const DIHEDRAL = dihedral();

/**
 * Encaixe do interior modelado sobre `reference` na unidade `target`.
 * Prefere: lados casados e medidas que cabem; depois sem espelho; depois menor rotação.
 */
export function fitInterior(reference: FitSubject, target: FitSubject): FitResult {
  const candidates = DIHEDRAL.map((d) => {
    // Lados: cada lado da referência vai para o lado local da unidade.
    let agree = 0;
    for (const side of RECT_SIDES) {
      const to = sideOf(apply2(d.local, sideNormal(side)));
      if (reference.exterior.has(side) === target.exterior.has(to)) agree++;
    }
    const [hu, hv] = reference.rect.half;
    const swapped = d.quarter % 2 === 1;
    const deviation = Math.max(
      Math.abs((swapped ? hv : hu) - target.rect.half[0]),
      Math.abs((swapped ? hu : hv) - target.rect.half[1]),
    );
    return { ...d, agree, deviation, fits: deviation <= FIT_TOLERANCE + 1e-6 };
  });
  const score = (c: (typeof candidates)[number]) => c.agree * 2 + (c.fits ? 1 : 0);
  const bestScore = Math.max(...candidates.map(score));
  // Desempate pela medida (ex.: tipo errado na unidade: a menos errada), depois pela ordem.
  const tied = candidates.filter((c) => score(c) === bestScore);
  const minDev = Math.min(...tied.map((c) => c.deviation));
  const winners = tied.filter((c) => c.deviation <= minDev + 0.01);
  const chosen = winners[0]!;

  // Mundo: L = R(alvo) · D · R(−referência).
  const L = mul2(mul2(rot2(target.rect.angle), chosen.local), rot2(-reference.rect.angle));
  const rc = apply2(L, reference.rect.center);
  const tx = target.rect.center[0] - rc[0];
  const tz = target.rect.center[1] - rc[1];
  const dy = target.rect.base;
  // (x, z) → (L00 x + L01 z + tx, L10 x + L11 z + tz); y → y + dy.
  const matrix = [L[0], 0, L[2], 0, 0, 1, 0, 0, L[1], 0, L[3], 0, tx, dy, tz, 1];

  // Nos termos do Blender: (x, y) = (x, −z). Lb = P·L·P, com P = diag(1, −1).
  const det = L[0] * L[3] - L[1] * L[2];
  const mirror = det < 0;
  // Lb = [[L00, −L01], [−L10, L11]]; com espelho, Lb·S (S = diag(1, −1)) é a rotação.
  let deg = (Math.atan2(-L[2], L[0]) * 180) / Math.PI;
  deg = Math.round(((deg % 360) + 360) % 360);
  if (deg === 360) deg = 0;

  return {
    transform: { rotation: deg, mirror },
    matrix,
    fits: chosen.fits,
    deviation: chosen.deviation,
    ambiguous: winners.length > 1,
    matched: chosen.agree === 4,
  };
}

/** Aplica a matriz de encaixe a um ponto do interior (coordenadas do viewer). */
export function applyFit(matrix: readonly number[], p: [number, number, number]) {
  const [x, y, z] = p;
  return [
    matrix[0]! * x + matrix[8]! * z + matrix[12]!,
    y + matrix[13]!,
    matrix[2]! * x + matrix[10]! * z + matrix[14]!,
  ] as [number, number, number];
}

/** Texto curto da transformação (ex.: "espelho Y + 90°", "0°"). */
export function describeFit(t: FitTransform): string {
  return t.mirror ? `espelho Y + ${t.rotation}°` : `${t.rotation}°`;
}
