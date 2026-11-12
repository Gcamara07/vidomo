import { describe, expect, it } from 'vitest';
import { EMPTY_FPS, addFpsSample } from './fps-summary';

const sample = (fps: number) => ({ fps, drawCalls: 1, triangles: 1, dpr: 2, renderer: 'x' });

describe('addFpsSample', () => {
  it('ignora segundos parados e calcula média e mínimo só com renderização', () => {
    let s = EMPTY_FPS;
    for (const fps of [0, 60, 1, 30, 45]) s = addFpsSample(s, sample(fps));
    expect(s.activeSeconds).toBe(3);
    expect(s.avg).toBeCloseTo(45);
    expect(s.min).toBe(30);
    expect(s.last?.fps).toBe(45);
  });
});
