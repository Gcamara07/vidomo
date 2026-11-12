/**
 * Camadas extras do prédio de teste, para simular modelos reais (que pesam MB):
 *
 *   buildDetailDocument()  GLB de detalhes (camada 2): varandas e guarda-corpos por unidade
 *   addPaddingGrid()       malha plana "pesada" (terreno/entorno) que simula o peso de
 *                          geometria real: vértices com deslocamento horizontal aleatório,
 *                          pouco compressíveis, mas a superfície continua plana (sem arestas
 *                          internas no traço técnico do viewer)
 */
import { Document, type Buffer, type Material, type Mesh } from '@gltf-transform/core';
import { unitObjectKey } from '@vidomo/viewer/naming';
import { BUILDING } from './building';
import { boxArrays } from './box';

function srgbToLinear(color: string): [number, number, number, number] {
  const n = parseInt(color.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), 1];
}

function sceneAndBuffer(doc: Document) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const scene = root.listScenes()[0] ?? doc.createScene();
  return { buffer, scene };
}

function boxMesh(
  doc: Document,
  buffer: Buffer,
  name: string,
  size: [number, number, number],
  mat: Material,
): Mesh {
  const a = boxArrays(...size);
  const acc = (
    type: 'VEC3' | 'VEC2' | 'SCALAR',
    arr: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
  ) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', a.positions))
    .setAttribute('NORMAL', acc('VEC3', a.normals))
    .setAttribute('TEXCOORD_0', acc('VEC2', a.uvs))
    .setIndices(acc('SCALAR', a.indices))
    .setMaterial(mat);
  return doc.createMesh(name).addPrimitive(prim);
}

/** PRNG determinístico (mulberry32): o mesmo arquivo a cada geração. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PaddingOptions {
  /** Nome do objeto (ex.: VIS__TERRENO). */
  name: string;
  /** Células por lado da grade. */
  cells: number;
  /** Lado do quadrado externo (m), centrado na origem. */
  outer: number;
  /** Lado do quadrado interno vazado (m); 0 = grade cheia. */
  inner?: number;
  y: number;
  seed?: number;
}

export function addPaddingGrid(doc: Document, opts: PaddingOptions): void {
  const { buffer, scene } = sceneAndBuffer(doc);
  const n = Math.max(2, Math.floor(opts.cells));
  const step = opts.outer / n;
  const half = opts.outer / 2;
  const innerHalf = (opts.inner ?? 0) / 2;
  const rand = rng(opts.seed ?? 1);

  const verts = (n + 1) * (n + 1);
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = j * (n + 1) + i;
      const border = i === 0 || j === 0 || i === n || j === n;
      // Deslocamento só no plano: a superfície segue plana (normais para cima).
      const jx = border ? 0 : (rand() - 0.5) * step * 0.6;
      const jz = border ? 0 : (rand() - 0.5) * step * 0.6;
      positions[v * 3] = -half + i * step + jx;
      positions[v * 3 + 1] = opts.y;
      positions[v * 3 + 2] = -half + j * step + jz;
      // Normais levemente ruidosas e UVs aleatórias: como num modelo real, cada vértice
      // carrega dados pouco compressíveis (o viewer usa material sem luz e UVs próprias,
      // então isso não aparece na tela).
      const nx = (rand() - 0.5) * 0.2;
      const nz = (rand() - 0.5) * 0.2;
      const nl = Math.hypot(nx, 1, nz);
      normals[v * 3] = nx / nl;
      normals[v * 3 + 1] = 1 / nl;
      normals[v * 3 + 2] = nz / nl;
      uvs[v * 2] = rand() * 8;
      uvs[v * 2 + 1] = rand() * 8;
    }
  }

  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = -half + (i + 0.5) * step;
      const cz = -half + (j + 0.5) * step;
      if (innerHalf > 0 && Math.abs(cx) < innerHalf && Math.abs(cz) < innerHalf) continue;
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      // Anti-horário visto de cima (+Y).
      idx.push(a, c, b, b, c, d);
    }
  }
  const indices = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);

  const mat = doc
    .createMaterial(`MAT_${opts.name}`)
    .setBaseColorFactor(srgbToLinear('#E6DFD2'))
    .setRoughnessFactor(1)
    .setMetallicFactor(0);
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer),
    )
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
    .setMaterial(mat);
  scene.addChild(
    doc.createNode(opts.name).setMesh(doc.createMesh(opts.name.toLowerCase()).addPrimitive(prim)),
  );
}

/**
 * Camada de detalhes: varanda (laje + guarda-corpo) na fachada de cada unidade.
 * Só objetos VIS__ — nada selecionável.
 */
export function buildDetailDocument(): Document {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'vidomo/generate-test-building (detalhes)';
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Residencial Vista (detalhes)');
  const mat = doc
    .createMaterial('MAT_DETAIL')
    .setBaseColorFactor(srgbToLinear('#E6DFD2'))
    .setRoughnessFactor(1)
    .setMetallicFactor(0);

  const { unit, floorToFloor, slabThickness } = BUILDING;
  const balconyDepth = 1.2;
  const balconyWidth = unit.width - 2;
  const slab = boxMesh(doc, buffer, 'balcony_slab', [balconyWidth, 0.12, balconyDepth], mat);
  const rail = boxMesh(doc, buffer, 'balcony_rail', [balconyWidth, 1.0, 0.06], mat);

  for (let f = 1; f <= BUILDING.floors; f++) {
    const base = f * floorToFloor + slabThickness;
    for (let p = 1; p <= BUILDING.unitsPerFloor; p++) {
      const [x, z] = BUILDING.positions[p - 1]!;
      const dir = Math.sign(z); // norte = +Z, sul = −Z
      const facade = z + dir * (unit.depth / 2);
      const code = unitObjectKey(BUILDING.tower, f, f * 100 + p).replace(/__/g, '_');
      scene.addChild(
        doc
          .createNode(`VIS__VARANDA_${code}`)
          .setMesh(slab)
          .setTranslation([x, base + 0.06, facade + dir * (balconyDepth / 2)]),
      );
      scene.addChild(
        doc
          .createNode(`VIS__GUARDA_CORPO_${code}`)
          .setMesh(rail)
          .setTranslation([x, base + 0.12 + 0.5, facade + dir * (balconyDepth - 0.03)]),
      );
    }
  }
  return doc;
}
