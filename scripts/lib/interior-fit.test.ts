import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { boxArrays } from './box';
import { interiorFitReport, modelGeometry } from './interior-fit';

/** GLB mínimo: caixas pelo centro e medidas (coordenadas do glTF, Y para cima). */
function docWith(boxes: { name: string; min: number[]; max: number[] }[]): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  for (const b of boxes) {
    const size = b.max.map((v, i) => v - b.min[i]!);
    const a = boxArrays(size[0]!, size[1]!, size[2]!);
    const prim = doc
      .createPrimitive()
      .setAttribute(
        'POSITION',
        doc.createAccessor().setType('VEC3').setArray(a.positions).setBuffer(buffer),
      )
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(a.indices).setBuffer(buffer));
    const node = doc
      .createNode(b.name)
      .setMesh(doc.createMesh(b.name).addPrimitive(prim))
      .setTranslation(b.min.map((v, i) => v + size[i]! / 2) as [number, number, number]);
    scene.addChild(node);
  }
  return doc;
}

// Andar 2 do Residencial Vista.
const doc = docWith([
  { name: 'FLOOR__TA__F02', min: [-9.5, 7.0, -8.5], max: [9.5, 7.2, 8.5] },
  { name: 'UNIT__TA__F02__U201', min: [-9.45, 7.2, -8.45], max: [-1.25, 9.95, -1.55] },
  { name: 'UNIT__TA__F02__U202', min: [-1.15, 7.2, -8.45], max: [9.45, 9.95, -1.55] },
  { name: 'UNIT__TA__F02__U203', min: [-9.45, 7.2, 1.55], max: [-1.25, 9.95, 8.45] },
  { name: 'UNIT__TA__F02__U204', min: [-1.15, 7.2, 1.55], max: [9.45, 9.95, 8.45] },
]);
const units = [
  { objectKey: 'TA__F02__U201', type: 'Tipo A' },
  { objectKey: 'TA__F02__U202', type: 'Tipo B' },
  { objectKey: 'TA__F02__U203', type: 'Tipo A' },
  { objectKey: 'TA__F02__U204', type: 'Tipo B' },
];

describe('interiorFitReport', () => {
  it('lista tipo e transformação por unidade (espelho nas unidades 3 e 4)', () => {
    const geo = modelGeometry(doc);
    expect(geo.units.size).toBe(4);
    const r = interiorFitReport(geo, units, [
      { name: 'Tipo A', referenceUnit: 'TA__F02__U201' },
      { name: 'Tipo B', referenceUnit: 'TA__F02__U202' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.unit, x.type, x.transform, x.fits])).toEqual([
      ['TA__F02__U201', 'Tipo A', '0°', true],
      ['TA__F02__U202', 'Tipo B', '0°', true],
      ['TA__F02__U203', 'Tipo A', 'espelho Y + 0°', true],
      ['TA__F02__U204', 'Tipo B', 'espelho Y + 0°', true],
    ]);
  });

  it('tipo trocado não cabe; referência fora do GLB é erro claro', () => {
    const geo = modelGeometry(doc);
    const r = interiorFitReport(
      geo,
      units.map((u) => (u.objectKey === 'TA__F02__U204' ? { ...u, type: 'Tipo A' } : u)),
      [
        { name: 'Tipo A', referenceUnit: 'TA__F02__U201' },
        { name: 'Tipo B', referenceUnit: 'TA__F09__U902' },
      ],
    );
    const u204 = r.rows.find((x) => x.unit === 'TA__F02__U204')!;
    expect(u204.fits).toBe(false);
    expect(u204.deviation).toBeGreaterThan(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('TA__F09__U902');
    // Unidades do tipo B ficam sem transformação (sem referência).
    expect(r.rows.find((x) => x.unit === 'TA__F02__U202')!.transform).toBeNull();
  });

  it('avisa quando a unidade de referência é de outro tipo; tipo sem interior fica de fora', () => {
    const r = interiorFitReport(modelGeometry(doc), units, [
      { name: 'Tipo A', referenceUnit: 'TA__F02__U202' },
      { name: 'Tipo B', referenceUnit: null },
    ]);
    expect(r.warnings[0]).toContain('"Tipo B"');
    expect(r.rows.every((x) => x.type === 'Tipo A')).toBe(true);
  });
});
