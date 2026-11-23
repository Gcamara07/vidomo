/** Enquadramento e limites da câmera orbital. Módulo puro (testável sem WebGL). */
import type { CameraPreset, Vec3 } from './types';

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface Framing {
  position: Vec3;
  target: Vec3;
  minDistance: number;
  maxDistance: number;
  /** Ângulo polar mínimo (rad): não fica exatamente a pino. */
  minPolarAngle: number;
  /** Ângulo polar máximo (rad): a câmera nunca desce abaixo do horizonte do alvo. */
  maxPolarAngle: number;
  /** Região onde o alvo da órbita pode ficar (o pan não "perde" o prédio). */
  targetBounds: Bounds;
  /**
   * Plano near da câmera (m). Sem valor: minDistance / 20. No modo andar é maior, para sobrar
   * precisão de profundidade entre pisos a poucos milímetros (maquete sobre a laje) em GPUs
   * de celular.
   */
  near?: number;
}

/** Direção da vista inicial: frente-direita, um pouco acima. */
const VIEW_DIR: Vec3 = [0.75, 0.42, 1.2];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** Ângulo horizontal (rad) da câmera em volta do alvo: 0 = olhando de +Z. */
export function azimuthOf(position: Vec3, target: Vec3): number {
  return Math.atan2(position[0] - target[0], position[2] - target[2]);
}

/** Direção da câmera com o azimute dado e a elevação da vista inicial. */
function viewDir(azimuth?: number): Vec3 {
  if (azimuth === undefined) return VIEW_DIR;
  const h = Math.hypot(VIEW_DIR[0], VIEW_DIR[2]);
  return [Math.sin(azimuth) * h, VIEW_DIR[1], Math.cos(azimuth) * h];
}

function fitDistanceFor(radius: number, fovDeg: number, aspect: number) {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.1));
  return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.02;
}

export function computeFraming(
  bounds: Bounds,
  fovDeg: number,
  aspect: number,
  preset?: CameraPreset,
  /** Mantém o ângulo horizontal atual (transição suave entre modos). */
  azimuth?: number,
): Framing {
  const size = sub(bounds.max, bounds.min);
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const radius = Math.max(len(size) / 2, 1);

  const fitDistance = fitDistanceFor(radius, fovDeg, aspect);

  const dir = viewDir(azimuth);
  const d = len(dir);
  const position: Vec3 = preset?.position ?? [
    center[0] + (dir[0] / d) * fitDistance,
    center[1] + (dir[1] / d) * fitDistance,
    center[2] + (dir[2] / d) * fitDistance,
  ];
  const target: Vec3 = preset?.target ?? center;
  const startDistance = len(sub(position, target));

  return {
    position,
    target,
    minDistance: radius * 0.35,
    maxDistance: Math.max(startDistance, fitDistance) * 1.8,
    minPolarAngle: 0.12,
    maxPolarAngle: Math.PI / 2 - 0.04,
    targetBounds: {
      // Alvo nunca abaixo do chão nem fora da projeção do prédio.
      min: [bounds.min[0], Math.max(bounds.min[1], 0), bounds.min[2]],
      max: bounds.max,
    },
  };
}

export function clampToBounds(p: Vec3, b: Bounds): Vec3 {
  return [
    Math.min(Math.max(p[0], b.min[0]), b.max[0]),
    Math.min(Math.max(p[1], b.min[1]), b.max[1]),
    Math.min(Math.max(p[2], b.min[2]), b.max[2]),
  ];
}

/** Elevação da vista do andar: oblíqua, de cima (50° acima do horizonte). */
const FLOOR_ELEVATION = (50 * Math.PI) / 180;

/**
 * Enquadramento do modo andar: vista oblíqua de cima, laje inteira na tela, mantendo o
 * ângulo horizontal atual da câmera.
 */
export function computeFloorFraming(
  floor: { base: number; top: number; slab: Bounds },
  fovDeg: number,
  aspect: number,
  azimuth: number,
): Framing {
  const { slab, base, top } = floor;
  const min: Vec3 = [slab.min[0], base, slab.min[2]];
  const max: Vec3 = [slab.max[0], top, slab.max[2]];
  const center: Vec3 = [(min[0] + max[0]) / 2, base + 1.2, (min[2] + max[2]) / 2];
  const radius = Math.max(len(sub(max, min)) / 2, 1);
  const fit = fitDistanceFor(radius, fovDeg, aspect);
  const horizontal = Math.cos(FLOOR_ELEVATION) * fit;
  return {
    position: [
      center[0] + Math.sin(azimuth) * horizontal,
      center[1] + Math.sin(FLOOR_ELEVATION) * fit,
      center[2] + Math.cos(azimuth) * horizontal,
    ],
    target: center,
    minDistance: radius * 0.5,
    maxDistance: fit * 1.6,
    // A câmera fica a pelo menos radius × 0,5 do alvo e olha de cima: nada útil fica a menos
    // de radius × 0,1 dela.
    near: radius * 0.1,
    minPolarAngle: 0.12,
    // Continua "de cima": não deixa olhar o andar de lado.
    maxPolarAngle: (72 * Math.PI) / 180,
    targetBounds: { min, max },
  };
}

/** Duração da transição de câmera (0 com prefers-reduced-motion). */
export function transitionMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 500;
}

export function easeInOutCubic(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
