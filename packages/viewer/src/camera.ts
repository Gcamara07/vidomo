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
}

/** Direção da vista inicial: frente-direita, um pouco acima. */
const VIEW_DIR: Vec3 = [0.75, 0.42, 1.2];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export function computeFraming(
  bounds: Bounds,
  fovDeg: number,
  aspect: number,
  preset?: CameraPreset,
): Framing {
  const size = sub(bounds.max, bounds.min);
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const radius = Math.max(len(size) / 2, 1);

  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.1));
  const fitDistance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.02;

  const d = len(VIEW_DIR);
  const position: Vec3 = preset?.position ?? [
    center[0] + (VIEW_DIR[0] / d) * fitDistance,
    center[1] + (VIEW_DIR[1] / d) * fitDistance,
    center[2] + (VIEW_DIR[2] / d) * fitDistance,
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
