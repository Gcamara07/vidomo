import { BufferAttribute, BufferGeometry, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildGhostGeometries, splitByTower } from './partition';
import type { ScenePart } from './scene-model';

/** Dois quadrados (2 triângulos cada) lado a lado em x: [0..1] e [10..11], numa malha só. */
function mergedPart(matrix = new Matrix4()): ScenePart {
  const g = new BufferGeometry();
  // prettier-ignore
  const pos = new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1,
    10, 0, 0,  11, 0, 0,  11, 0, 1,  10, 0, 1,
  ]);
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return {
    name: 'VIS__ESQUADRIAS',
    kind: 'visual',
    objectKey: 'ESQUADRIAS',
    geometry: g,
    matrix,
    sourceMaterial: null,
  };
}

const byX = (x: number) => (x < 5 ? 'B01' : x < 20 ? 'B02' : null);

describe('splitByTower', () => {
  it('divide a malha única por bloco, compartilhando os atributos', () => {
    const part = mergedPart();
    const pieces = splitByTower(part, byX);
    expect(pieces.map((p) => p.tower).sort()).toEqual(['B01', 'B02']);
    for (const p of pieces) {
      expect(p.part.geometry.getAttribute('position')).toBe(part.geometry.getAttribute('position'));
      expect(p.part.geometry.index!.count).toBe(6);
      expect(p.part.name).toBe('VIS__ESQUADRIAS');
    }
    const b02 = pieces.find((p) => p.tower === 'B02')!.part.geometry.boundingBox!;
    expect(b02.min.x).toBe(10);
    expect(b02.max.x).toBe(11);
  });

  it('usa a posição de mundo (matriz do objeto)', () => {
    const pieces = splitByTower(mergedPart(new Matrix4().makeTranslation(20, 0, 0)), byX);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.tower).toBeNull();
  });

  it('peça inteira num bloco só volta como está', () => {
    const part = mergedPart();
    const pieces = splitByTower(part, () => 'B01');
    expect(pieces).toEqual([{ part, tower: 'B01' }]);
  });
});

describe('buildGhostGeometries', () => {
  it('uma malha por bloco, em coordenadas de mundo', () => {
    const pieces = splitByTower(mergedPart(new Matrix4().makeTranslation(0, 5, 0)), byX);
    const ghosts = buildGhostGeometries([...pieces, { part: mergedPart(), tower: null }]);
    expect([...ghosts.keys()].sort()).toEqual(['', 'B01', 'B02']);
    const b01 = ghosts.get('B01')!.getAttribute('position');
    expect(b01.count).toBe(6);
    expect(b01.getY(0)).toBe(5);
    expect(ghosts.get('')!.getAttribute('position').count).toBe(12);
  });
});
