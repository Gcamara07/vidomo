import { describe, expect, it } from 'vitest';
import {
  applyFit,
  describeFit,
  exteriorSides,
  fitInterior,
  planTriangles,
  rectFromPositions,
  type FitSubject,
} from './fit';

/** Caixa em triângulos (só as faces de cima e de baixo bastam), girada em planta. */
function box(
  min: [number, number, number],
  max: [number, number, number],
  angleDeg = 0,
  pivot: [number, number] = [0, 0],
): number[] {
  const a = (angleDeg * Math.PI) / 180;
  const rot = (x: number, z: number) => {
    const dx = x - pivot[0];
    const dz = z - pivot[1];
    return [
      pivot[0] + dx * Math.cos(a) - dz * Math.sin(a),
      pivot[1] + dx * Math.sin(a) + dz * Math.cos(a),
    ];
  };
  const out: number[] = [];
  for (const y of [min[1], max[1]]) {
    const c = [
      rot(min[0], min[2]),
      rot(max[0], min[2]),
      rot(max[0], max[2]),
      rot(min[0], max[2]),
    ] as [number, number][];
    for (const [i, j, k] of [
      [0, 1, 2],
      [0, 2, 3],
    ] as const) {
      for (const p of [c[i]!, c[j]!, c[k]!]) out.push(p[0], y, p[1]);
    }
  }
  return out;
}

// Residencial Vista, andar 2 (coordenadas do viewer: norte do Blender = −Z).
const SLAB = box([-9.5, 7.0, -8.5], [9.5, 7.2, 8.5]);
const U201 = box([-9.45, 7.2, -8.45], [-1.25, 9.95, -1.55]);
const U202 = box([-1.15, 7.2, -8.45], [9.45, 9.95, -1.55]);
const U203 = box([-9.45, 7.2, 1.55], [-1.25, 9.95, 8.45]);
const U204 = box([-1.15, 7.2, 1.55], [9.45, 9.95, 8.45]);
const U501 = box([-9.45, 16.2, -8.45], [-1.25, 18.95, -1.55]);

function subject(unit: number[], slab: number[]): FitSubject {
  const rect = rectFromPositions(unit);
  return { rect, exterior: exteriorSides(rect, planTriangles(slab)) };
}

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 3));

describe('fitInterior (Residencial Vista)', () => {
  const refA = subject(U201, SLAB);
  const refB = subject(U202, SLAB);

  it('acha os lados externos pela laje (fachada e oitão)', () => {
    // U201: fachada norte (−Z → v−) e oitão oeste (−X → u−).
    expect([...refA.exterior].sort()).toEqual(['u-', 'v-']);
    expect([...subject(U203, SLAB).exterior].sort()).toEqual(['u-', 'v+']);
  });

  it('a própria unidade de referência: identidade', () => {
    const r = fitInterior(refA, refA);
    expect(r.transform).toEqual({ rotation: 0, mirror: false });
    expect(r.fits && r.matched && !r.ambiguous).toBe(true);
    close(applyFit(r.matrix, [-9.5, 0, -8.5]), [-9.5, 7.2, -8.5]);
  });

  it('outro andar: só translação vertical (z = 0 → topo da laje)', () => {
    const slab5 = box([-9.5, 16.0, -8.5], [9.5, 16.2, 8.5]);
    const r = fitInterior(refA, subject(U501, slab5));
    expect(describeFit(r.transform)).toBe('0°');
    close(applyFit(r.matrix, [-5, 1.4, -5]), [-5, 17.6, -5]);
  });

  it('unidades 3 e 4 (fachada sul): espelho no eixo Y', () => {
    const r3 = fitInterior(refA, subject(U203, SLAB));
    expect(r3.transform).toEqual({ rotation: 0, mirror: true });
    expect(r3.fits && r3.matched && !r3.ambiguous).toBe(true);
    // Fachada norte da U201 (y Blender = 8,5 → z = −8,5) vai para a fachada sul (z = +8,5).
    close(applyFit(r3.matrix, [-9.5, 0, -8.5]), [-9.5, 7.2, 8.5]);
    // Varanda (y Blender 10,1) fica para fora, ao sul.
    close(applyFit(r3.matrix, [-5, 0, -10.1]), [-5, 7.2, 10.1]);

    const r4 = fitInterior(refB, subject(U204, SLAB));
    expect(describeFit(r4.transform)).toBe('espelho Y + 0°');
    expect(r4.fits).toBe(true);
  });

  it('tipo errado na unidade: não cabe', () => {
    const r = fitInterior(refA, subject(U202, SLAB));
    expect(r.fits).toBe(false);
    expect(r.deviation).toBeCloseTo(1.2, 2);
  });
});

describe('fitInterior (vários blocos, unidades viradas)', () => {
  const refA = subject(U201, SLAB);

  it('bloco girado 90° no Blender: rotação de 90°', () => {
    // Gira laje e unidade 90° anti-horário no Blender (= −90° em x→z no viewer).
    const slab = box([-9.5, 7.0, -8.5], [9.5, 7.2, 8.5], -90);
    const unit = box([-9.45, 7.2, -8.45], [-1.25, 9.95, -1.55], -90);
    const r = fitInterior(refA, subject(unit, slab));
    expect(r.transform).toEqual({ rotation: 90, mirror: false });
    expect(r.fits && r.matched && !r.ambiguous).toBe(true);
  });

  it('bloco girado 180°: rotação de 180° (não espelho)', () => {
    const slab = box([-9.5, 7.0, -8.5], [9.5, 7.2, 8.5], 180);
    const unit = box([-9.45, 7.2, -8.45], [-1.25, 9.95, -1.55], 180);
    const r = fitInterior(refA, subject(unit, slab));
    expect(r.transform).toEqual({ rotation: 180, mirror: false });
  });

  it('bloco girado 30° e deslocado: mantém a forma, ângulo arbitrário', () => {
    const slab = box([40.5, 7.0, 11.5], [59.5, 7.2, 28.5], 30, [50, 20]);
    const unit = box([40.55, 7.2, 11.55], [48.75, 9.95, 18.45], 30, [50, 20]);
    const r = fitInterior(refA, subject(unit, slab));
    expect(r.transform).toEqual({ rotation: 330, mirror: false });
    expect(r.fits && r.matched).toBe(true);
    // O canto noroeste da U201 vai para o canto correspondente da unidade girada.
    const a = (30 * Math.PI) / 180;
    const [dx, dz] = [40.5 - 50, 11.5 - 20];
    close(applyFit(r.matrix, [-9.5, 0, -8.5]), [
      50 + dx * Math.cos(a) - dz * Math.sin(a),
      7.2,
      20 + dx * Math.sin(a) + dz * Math.cos(a),
    ]);
  });

  it('unidade de meio de fileira (só a fachada externa): ambíguo, sem espelho', () => {
    // Laje comprida: a unidade só encosta na borda norte.
    const slab = box([-30, 7.0, -8.5], [30, 7.2, 8.5]);
    const unit = box([10.05, 7.2, -8.45], [18.25, 9.95, -1.55]);
    const r = fitInterior(refA, subject(unit, slab));
    expect(r.ambiguous).toBe(true);
    expect(r.matched).toBe(false);
    expect(r.transform).toEqual({ rotation: 0, mirror: false });
  });
});
