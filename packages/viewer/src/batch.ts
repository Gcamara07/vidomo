/**
 * Desenho em lote (menos draw calls): peças com a mesma aparência viram uma malha só, e os
 * contornos delas, um conjunto de linhas só.
 *
 * - Unidades: um lote por bloco e por classe visual (status, esmaecida, filtrada…). A
 *   unidade selecionada fica fora dos lotes (contorno grosso, desenhada por cima).
 * - Cada peça tem os vértices já em coordenadas de mundo, calculados uma vez por modelo
 *   (partArrays); montar um lote é só concatenar. Mudar o status de uma unidade refaz só os
 *   dois lotes envolvidos (o de onde ela sai e o de onde ela entra), sem recarregar o modelo.
 * - Toque: cada triângulo do lote sabe de qual peça veio (keys[faceIndex]).
 */
import { BufferAttribute, BufferGeometry, EdgesGeometry, Vector3, type Matrix4 } from 'three';
import type { PartView } from './floors';
import type { UnitStatus } from './types';

/** Vértices de uma peça, em coordenadas de mundo, sem índice (3 por triângulo). */
export interface PartArrays {
  position: Float32Array;
  /** UVs (as unidades usam UVs em metros para a hachura); null se a peça não tiver. */
  uv: Float32Array | null;
  /** Cores por vértice (camada de detalhes); null se não houver. */
  color: Float32Array | null;
  /** Contorno (pares de pontos), em coordenadas de mundo. */
  edges: Float32Array;
}

const v = new Vector3();

/** Expande a geometria (sem índice) e aplica a matriz; contorno pelo mesmo limiar do drei. */
export function partArrays(
  geometry: BufferGeometry,
  matrix: Matrix4,
  edgeThreshold: number,
): PartArrays {
  const pos = geometry.getAttribute('position');
  const uvAttr = geometry.getAttribute('uv');
  const colorAttr = geometry.getAttribute('color');
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const position = new Float32Array(count * 3);
  const uv = uvAttr ? new Float32Array(count * 2) : null;
  const color = colorAttr ? new Float32Array(count * 3) : null;
  for (let i = 0; i < count; i++) {
    const vi = index ? index.getX(i) : i;
    v.fromBufferAttribute(pos, vi).applyMatrix4(matrix);
    position[i * 3] = v.x;
    position[i * 3 + 1] = v.y;
    position[i * 3 + 2] = v.z;
    if (uv && uvAttr) {
      uv[i * 2] = uvAttr.getX(vi);
      uv[i * 2 + 1] = uvAttr.getY(vi);
    }
    if (color && colorAttr) {
      color[i * 3] = colorAttr.getX(vi);
      color[i * 3 + 1] = colorAttr.getY(vi);
      color[i * 3 + 2] = colorAttr.getZ(vi);
    }
  }
  const eg = new EdgesGeometry(geometry, edgeThreshold);
  const ep = eg.getAttribute('position');
  const edges = new Float32Array(ep.count * 3);
  for (let i = 0; i < ep.count; i++) {
    v.fromBufferAttribute(ep, i).applyMatrix4(matrix);
    edges[i * 3] = v.x;
    edges[i * 3 + 1] = v.y;
    edges[i * 3 + 2] = v.z;
  }
  eg.dispose();
  return { position, uv, color, edges };
}

export interface BatchItem {
  /** Chave devolvida no toque (object_key da unidade/laje, ou nome da peça). */
  key: string;
  arrays: PartArrays;
}

export interface MergedBatch {
  geometry: BufferGeometry;
  /** Peça de cada triângulo (índice = faceIndex do raycast). */
  keys: string[];
  /** Contorno de todas as peças (pares de pontos). */
  edges: Float32Array;
}

/** Junta as peças num lote. UV e cor só entram se todas as peças tiverem. */
export function mergeBatch(items: BatchItem[]): MergedBatch {
  let verts = 0;
  let edgeFloats = 0;
  for (const it of items) {
    verts += it.arrays.position.length / 3;
    edgeFloats += it.arrays.edges.length;
  }
  const withUv = items.length > 0 && items.every((it) => it.arrays.uv);
  const withColor = items.length > 0 && items.every((it) => it.arrays.color);
  const position = new Float32Array(verts * 3);
  const uv = withUv ? new Float32Array(verts * 2) : null;
  const color = withColor ? new Float32Array(verts * 3) : null;
  const edges = new Float32Array(edgeFloats);
  const keys: string[] = [];
  let vo = 0;
  let eo = 0;
  for (const it of items) {
    const n = it.arrays.position.length / 3;
    position.set(it.arrays.position, vo * 3);
    if (uv) uv.set(it.arrays.uv!, vo * 2);
    if (color) color.set(it.arrays.color!, vo * 3);
    edges.set(it.arrays.edges, eo);
    eo += it.arrays.edges.length;
    for (let t = 0; t < n / 3; t++) keys.push(it.key);
    vo += n;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  if (uv) geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  if (color) geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, keys, edges };
}

/**
 * Classe visual de uma unidade (define o lote). null = não desenha (oculta, ou silhueta do
 * bloco); 'selected' = fora dos lotes (desenhada à parte).
 */
export type UnitClass =
  'lower' | 'context' | 'filtered' | 'nostatus' | `status:${UnitStatus}` | 'selected';

export function unitClass(
  view: PartView,
  status: UnitStatus | undefined,
  selected: boolean,
  filtered: boolean,
): UnitClass | null {
  if (view === 'hidden' || view === 'ghost') return null;
  if (view === 'lower') return 'lower';
  if (view === 'context') return 'context';
  // Sem status informado: aparece como indisponível e não é selecionável.
  if (status === undefined) return 'nostatus';
  if (selected) return 'selected';
  if (filtered) return 'filtered';
  return `status:${status}`;
}

/** Classe visual de uma laje: normal, abaixo do andar, de outro bloco (modo bloco). */
export type SlabClass = 'slab' | 'lower' | 'context';

export function slabClass(view: PartView): SlabClass | null {
  if (view === 'hidden' || view === 'ghost') return null;
  if (view === 'lower') return 'lower';
  if (view === 'context') return 'context';
  return 'slab';
}

/** Agrupa itens por chave de lote, mantendo a ordem; assinatura = membros do lote. */
export function groupBatches<T extends { key: string }>(
  items: T[],
  groupOf: (item: T) => string | null,
): Map<string, { items: T[]; signature: string }> {
  const out = new Map<string, { items: T[]; signature: string }>();
  for (const it of items) {
    const g = groupOf(it);
    if (g === null) continue;
    let entry = out.get(g);
    if (!entry) out.set(g, (entry = { items: [], signature: '' }));
    entry.items.push(it);
  }
  for (const entry of out.values()) entry.signature = entry.items.map((i) => i.key).join('|');
  return out;
}
