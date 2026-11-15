import { describe, expect, it } from 'vitest';
import {
  azimuthOf,
  clampToBounds,
  computeFloorFraming,
  computeFraming,
  easeInOutCubic,
  lerpVec3,
  transitionMs,
} from './camera';

describe('computeFloorFraming', () => {
  const floor = { base: 25, top: 28, slab: { min: [-9.5, 25, -8.5], max: [9.5, 25.2, 8.5] } } as {
    base: number;
    top: number;
    slab: { min: [number, number, number]; max: [number, number, number] };
  };

  it('vista oblíqua de cima, mirando o meio da laje, no ângulo horizontal atual', () => {
    const f = computeFloorFraming(floor, 40, 9 / 19.5, 0.8);
    expect(f.target).toEqual([0, 26.2, 0]);
    const d = f.position.map((v, i) => v - f.target[i]!);
    const elevation = Math.atan2(d[1]!, Math.hypot(d[0]!, d[2]!));
    expect(elevation).toBeCloseTo((50 * Math.PI) / 180);
    expect(azimuthOf(f.position, f.target)).toBeCloseTo(0.8);
    // A laje inteira cabe: a distância cobre o raio da caixa do andar.
    expect(Math.hypot(...d)).toBeGreaterThan(Math.hypot(19, 3, 17) / 2);
    expect(f.maxPolarAngle).toBeLessThan(Math.PI / 2 - 0.2);
    expect(f.targetBounds).toEqual({ min: [-9.5, 25, -8.5], max: [9.5, 28, 8.5] });
  });
});

describe('transição', () => {
  it('easing começa e termina parado e respeita prefers-reduced-motion', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(2)).toBe(1);
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
    expect(transitionMs(true)).toBe(0);
    expect(transitionMs(false)).toBeLessThanOrEqual(600);
  });
});

const building = { min: [-12.5, 0, -7.5], max: [12.5, 33.4, 7.5] } as {
  min: [number, number, number];
  max: [number, number, number];
};

describe('computeFraming', () => {
  it('mira o centro do prédio e começa acima do chão', () => {
    const f = computeFraming(building, 40, 16 / 9);
    expect(f.target).toEqual([0, 16.7, 0]);
    expect(f.position[1]).toBeGreaterThan(f.target[1]);
    expect(f.maxPolarAngle).toBeLessThan(Math.PI / 2);
  });

  it('afasta mais a câmera em tela retrato (celular)', () => {
    const wide = computeFraming(building, 40, 16 / 9);
    const tall = computeFraming(building, 40, 9 / 19.5);
    const dist = (f: typeof wide) => Math.hypot(...f.position.map((v, i) => v - f.target[i]!));
    expect(dist(tall)).toBeGreaterThan(dist(wide));
    expect(tall.maxDistance).toBeGreaterThan(dist(tall));
    expect(tall.minDistance).toBeLessThan(dist(tall));
  });

  it('usa a câmera do manifesto quando informada', () => {
    const f = computeFraming(building, 40, 1, { position: [50, 30, 50], target: [0, 10, 0] });
    expect(f.position).toEqual([50, 30, 50]);
    expect(f.target).toEqual([0, 10, 0]);
  });

  it('mantém o ângulo horizontal pedido (transição suave)', () => {
    const f = computeFraming(building, 40, 1, undefined, Math.PI / 2);
    expect(azimuthOf(f.position, f.target)).toBeCloseTo(Math.PI / 2);
  });

  it('o alvo da órbita fica preso ao volume do prédio e acima do chão', () => {
    const f = computeFraming({ min: [-1, -5, -1], max: [1, 10, 1] }, 40, 1);
    expect(clampToBounds([50, -20, 0], f.targetBounds)).toEqual([1, 0, 0]);
  });
});
