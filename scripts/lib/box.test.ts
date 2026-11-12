import { describe, expect, it } from 'vitest';
import { boxArrays } from './box';

function cross(a: number[], b: number[]) {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

describe('boxArrays', () => {
  const box = boxArrays(4, 3, 2);

  it('tem 24 vértices e 12 triângulos', () => {
    expect(box.positions.length).toBe(24 * 3);
    expect(box.indices.length).toBe(36);
  });

  it('cobre exatamente a caixa pedida', () => {
    const xs = [...box.positions].filter((_, i) => i % 3 === 0);
    const ys = [...box.positions].filter((_, i) => i % 3 === 1);
    const zs = [...box.positions].filter((_, i) => i % 3 === 2);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-2, 2]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([-1.5, 1.5]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([-1, 1]);
  });

  it('triângulos em sentido anti-horário visto de fora (face frontal correta)', () => {
    const p = (i: number) => [...box.positions.slice(i * 3, i * 3 + 3)];
    for (let t = 0; t < box.indices.length; t += 3) {
      const [a, b, c] = [p(box.indices[t]!), p(box.indices[t + 1]!), p(box.indices[t + 2]!)];
      const n = cross(
        b.map((v, i) => v - a[i]!),
        c.map((v, i) => v - a[i]!),
      );
      const normal = [...box.normals.slice(box.indices[t]! * 3, box.indices[t]! * 3 + 3)];
      expect(n[0]! * normal[0]! + n[1]! * normal[1]! + n[2]! * normal[2]!).toBeGreaterThan(0);
    }
  });

  it('UVs em metros (face frontal 4 × 3 m)', () => {
    const us = [...box.uvs].filter((_, i) => i % 2 === 0);
    expect(Math.max(...us)).toBe(4);
  });
});
