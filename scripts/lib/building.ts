/** Prédio de teste do Residencial Vista (ver generate-test-building.ts). */
import { Document, NodeIO, type Material, type Mesh } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { floorObjectKey, unitObjectKey } from '@vidomo/viewer/naming';
import { boxArrays } from './box';

export const BUILDING = {
  tower: 'TA',
  floors: 10,
  unitsPerFloor: 4,
  floorToFloor: 3.0,
  slabThickness: 0.2,
  footprint: { width: 25, depth: 15 },
  unit: { width: 11.6, height: 2.7, depth: 6.2 },
  /** Centro (x, z) de cada posição 1..4 no andar. */
  positions: [
    [-6, 4], // 1: noroeste (fachada norte)
    [6, 4], // 2: nordeste (fachada norte)
    [6, -4], // 3: sudeste (fachada sul)
    [-6, -4], // 4: sudoeste (fachada sul)
  ] as const,
} as const;

function hex(color: string): [number, number, number, number] {
  const n = parseInt(color.slice(1), 16);
  // glTF guarda baseColorFactor em espaço linear.
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), 1];
}

export function buildDocument(): Document {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'vidomo/generate-test-building';
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Residencial Vista (teste)');

  const material = (name: string, color: string): Material =>
    doc
      .createMaterial(name)
      .setBaseColorFactor(hex(color))
      .setRoughnessFactor(1)
      .setMetallicFactor(0);

  // Cores provisórias da marca; o viewer substitui os materiais em runtime.
  const matUnit = material('MAT_UNIT', '#8CCB8F');
  const matSlab = material('MAT_SLAB', '#E6DFD2');
  const matTower = material('MAT_TOWER', '#D6CFC1');

  const boxMesh = (name: string, w: number, h: number, d: number, mat: Material): Mesh => {
    const a = boxArrays(w, h, d);
    const prim = doc
      .createPrimitive()
      .setAttribute(
        'POSITION',
        doc.createAccessor().setType('VEC3').setArray(a.positions).setBuffer(buffer),
      )
      .setAttribute(
        'NORMAL',
        doc.createAccessor().setType('VEC3').setArray(a.normals).setBuffer(buffer),
      )
      .setAttribute(
        'TEXCOORD_0',
        doc.createAccessor().setType('VEC2').setArray(a.uvs).setBuffer(buffer),
      )
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(a.indices).setBuffer(buffer))
      .setMaterial(mat);
    return doc.createMesh(name).addPrimitive(prim);
  };

  const { footprint, floorToFloor, slabThickness, unit } = BUILDING;
  const topY = (BUILDING.floors + 1) * floorToFloor;

  const add = (name: string, mesh: Mesh, x: number, y: number, z: number) =>
    scene.addChild(doc.createNode(name).setMesh(mesh).setTranslation([x, y, z]));

  // Térreo e torre.
  add(
    `TOWER__${BUILDING.tower}`,
    boxMesh('tower_base', footprint.width - 1, floorToFloor, footprint.depth - 1, matTower),
    0,
    floorToFloor / 2,
    0,
  );
  add(
    'VIS__NUCLEO',
    boxMesh('core', 3, topY - floorToFloor, 1.6, matTower),
    0,
    (topY + floorToFloor) / 2,
    0,
  );

  const slabMesh = boxMesh('slab', footprint.width, slabThickness, footprint.depth, matSlab);
  add('VIS__COBERTURA', slabMesh, 0, topY + slabThickness / 2, 0);

  const unitMesh = boxMesh('unit_volume', unit.width, unit.height, unit.depth, matUnit);

  for (let f = 1; f <= BUILDING.floors; f++) {
    const base = f * floorToFloor;
    add(`FLOOR__${floorObjectKey(BUILDING.tower, f)}`, slabMesh, 0, base + slabThickness / 2, 0);

    for (let p = 1; p <= BUILDING.unitsPerFloor; p++) {
      const [x, z] = BUILDING.positions[p - 1]!;
      const code = f * 100 + p;
      add(
        `UNIT__${unitObjectKey(BUILDING.tower, f, code)}`,
        unitMesh,
        x,
        base + slabThickness + unit.height / 2,
        z,
      );
    }
  }

  return doc;
}

export async function createIO(): Promise<NodeIO> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
}

/** Otimiza e marca o documento para EXT_meshopt_compression (aplicada na escrita). */
export async function compressDocument(doc: Document): Promise<void> {
  await MeshoptEncoder.ready;
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize(),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}
