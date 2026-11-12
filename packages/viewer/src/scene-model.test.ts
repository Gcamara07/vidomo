import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { extractBuilding, withMetricUVs } from './scene-model';

function mesh(name: string, w = 1, h = 1, d = 1) {
  const m = new Mesh(new BoxGeometry(w, h, d));
  m.name = name;
  return m;
}

describe('extractBuilding', () => {
  it('separa unidades, andares e estrutura pela convenção de nomes', () => {
    const root = new Group();
    const unit = mesh('UNIT__TA__F01__U101');
    unit.position.set(5, 3, 0);
    root.add(unit, mesh('FLOOR__TA__F01'), mesh('TOWER__TA'), mesh('VIS__NUCLEO'), mesh('Cube'));
    // Malha multi-primitiva: o GLTFLoader cria um grupo com o nome do nó.
    const group = new Group();
    group.name = 'UNIT__TA__F01__U102';
    group.add(mesh('UNIT__TA__F01__U102_1'));
    root.add(group);
    root.add(mesh('UNIT__TA__F1__U103')); // fora do padrão → estrutura

    const model = extractBuilding(root);
    expect(model.units.map((u) => u.objectKey)).toEqual(['TA__F01__U101', 'TA__F01__U102']);
    expect(model.floors.map((f) => f.objectKey)).toEqual(['TA__F01']);
    expect(model.structure.map((s) => s.name)).toEqual([
      'TOWER__TA',
      'VIS__NUCLEO',
      'Cube',
      'UNIT__TA__F1__U103',
    ]);
    expect(model.units[0]!.matrix.elements[12]).toBe(5);
    expect(model.bounds.max.x).toBeCloseTo(5.5);
  });

  it('respeita prefixos do manifesto', () => {
    const root = new Group();
    root.add(mesh('U-TA__F01__U101'));
    const model = extractBuilding(root, { unit: 'U-' });
    expect(model.units).toHaveLength(1);
  });
});

describe('withMetricUVs', () => {
  it('gera UVs em metros considerando a escala do objeto', () => {
    // Caixa unitária com escala 4 × 3 × 2 = caixa de 4 m × 3 m × 2 m.
    const g = withMetricUVs(new BoxGeometry(1, 1, 1), new Vector3(4, 3, 2));
    const uv = g.getAttribute('uv');
    const nor = g.getAttribute('normal');
    const us: number[] = [];
    const vs: number[] = [];
    for (let i = 0; i < uv.count; i++) {
      if (nor.getZ(i) > 0.9) {
        us.push(uv.getX(i));
        vs.push(uv.getY(i));
      }
    }
    // Face frontal (+Z): largura 4 m, altura 3 m.
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(4);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(3);
  });

  it('não altera a geometria original (compartilhada entre unidades)', () => {
    const original = new BoxGeometry(1, 1, 1);
    const before = original.getAttribute('uv').array.slice();
    withMetricUVs(original, new Vector3(10, 10, 10));
    expect(original.getAttribute('uv').array).toEqual(before);
  });
});
