import { BufferAttribute, BufferGeometry, Color, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { partArrays } from './batch';
import { fitInterior, rectFromPositions, type FitSubject } from './fit';
import {
  INTERIOR_CUT_HEIGHT,
  interiorRole,
  placeInterior,
  statusBand,
  type InteriorSource,
} from './interior';

describe('interiorRole', () => {
  it('pisos tingidos: PISO, MADEIRA_PISO e MOLHADO (varanda não); VIDRO é vidro', () => {
    expect(interiorRole('VIS__INTA_PISO')).toBe('floor');
    expect(interiorRole('VIS__INTB_PISO')).toBe('floor');
    expect(interiorRole('VIS__INTA_MADEIRA_PISO')).toBe('floor');
    expect(interiorRole('VIS__INTA_MOLHADO')).toBe('floor');
    expect(interiorRole('VIS__INTA_VARANDA')).toBe('solid');
    expect(interiorRole('VIS__INTA_BOXPISO')).toBe('solid');
    expect(interiorRole('VIS__INTB_VIDRO')).toBe('glass');
    expect(interiorRole('VIS__INTA_CORTE')).toBe('solid');
  });
});

/** Um triângulo de piso, virado para cima (+Y), no referencial do interior. */
function floorSource(): InteriorSource {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-9, 0, -2, -2, 0, -8, -9, 0, -8]), 3),
  );
  return {
    parts: [
      { role: 'floor', arrays: partArrays(g, new Matrix4(), 30), color: new Color(0.8, 0.7, 0.6) },
      { role: 'solid', arrays: partArrays(g, new Matrix4(), 30), color: new Color(1, 0.5, 0.25) },
    ],
  };
}

function normalOf(pos: Float32Array): Vector3 {
  const a = new Vector3().fromArray(pos, 0);
  const b = new Vector3().fromArray(pos, 3).sub(a);
  const c = new Vector3().fromArray(pos, 6).sub(a);
  return b.cross(c).normalize();
}

describe('placeInterior', () => {
  const src = floorSource();
  const up = normalOf(src.parts[0]!.arrays.position);

  it('sem espelho: mantém a face de frente e o UV em metros (x, z do mundo)', () => {
    const m = new Matrix4().makeTranslation(0, 7.2, 0).toArray();
    const g = placeInterior(src, m);
    expect(normalOf(g.floor.position).dot(up)).toBeCloseTo(1, 5);
    expect(g.floor.position[1]).toBeCloseTo(7.2, 5);
    expect([...g.floor.uv!.slice(0, 2)]).toEqual([g.floor.position[0], g.floor.position[2]]);
    // Topo: sem escurecer; cor do material.
    expect(g.solid.color![0]).toBeCloseTo(1, 5);
  });

  it('com espelho: troca a ordem dos vértices (a face continua de frente)', () => {
    const m = new Matrix4().makeScale(1, 1, -1).toArray();
    const g = placeInterior(src, m);
    expect(normalOf(g.floor.position).dot(up)).toBeCloseTo(1, 5);
    expect(normalOf(g.solid.position).dot(up)).toBeCloseTo(1, 5);
  });
});

describe('statusBand', () => {
  const unit: number[] = [];
  for (const [x, z] of [
    [-9.45, -8.45],
    [-1.25, -8.45],
    [-1.25, -1.55],
    [-9.45, -1.55],
  ] as const)
    unit.push(x, 7.2, z);
  const rect = rectFromPositions(unit);

  it('faixa na altura do corte, em volta da unidade (8 triângulos)', () => {
    const { arrays, outline } = statusBand(rect, false);
    expect(arrays.position.length).toBe(8 * 3 * 3);
    for (let i = 1; i < arrays.position.length; i += 3) {
      expect(arrays.position[i]).toBeCloseTo(7.2 + INTERIOR_CUT_HEIGHT + 0.012, 5);
    }
    // Borda externa no eixo da parede: 5 cm fora da caixa.
    const xs = [...outline].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-9.5, 5);
    expect(Math.max(...xs)).toBeCloseTo(-1.2, 5);
  });

  it('selecionada: faixa mais larga', () => {
    const inner = (sel: boolean) =>
      Math.max(...[...statusBand(rect, sel).arrays.position].filter((_, i) => i % 3 === 0));
    // A borda interna não aparece no máximo; compara a largura pela área (soma dos x).
    expect(inner(true)).toBeCloseTo(inner(false), 5);
    const area = (sel: boolean) => {
      const p = statusBand(rect, sel).arrays.position;
      let a = 0;
      for (let i = 0; i < p.length; i += 9) {
        a +=
          Math.abs(
            (p[i + 3]! - p[i]!) * (p[i + 8]! - p[i + 2]!) -
              (p[i + 6]! - p[i]!) * (p[i + 5]! - p[i + 2]!),
          ) / 2;
      }
      return a;
    };
    expect(area(true)).toBeGreaterThan(area(false) * 2);
  });

  it('encaixe + faixa: a faixa da unidade espelhada fica na caixa dela', () => {
    const south = unit.map((v, i) => (i % 3 === 2 ? -v : v));
    const s: FitSubject = { rect: rectFromPositions(south), exterior: new Set(['u-', 'v+']) };
    const r: FitSubject = { rect, exterior: new Set(['u-', 'v-']) };
    expect(fitInterior(r, s).transform.mirror).toBe(true);
    const zs = [...statusBand(s.rect, false).outline].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(1.5, 5);
    expect(Math.max(...zs)).toBeCloseTo(8.5, 5);
  });
});
