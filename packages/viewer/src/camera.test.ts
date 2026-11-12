import { describe, expect, it } from 'vitest';
import { clampToBounds, computeFraming } from './camera';

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

  it('o alvo da órbita fica preso ao volume do prédio e acima do chão', () => {
    const f = computeFraming({ min: [-1, -5, -1], max: [1, 10, 1] }, 40, 1);
    expect(clampToBounds([50, -20, 0], f.targetBounds)).toEqual([1, 0, 0]);
  });
});
