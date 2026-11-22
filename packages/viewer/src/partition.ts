/**
 * Peças por bloco, sem mexer no modelo:
 *
 * - splitByTower: a camada de detalhes costuma juntar o mesmo elemento de todos os blocos
 *   numa malha só (ex.: VIS__ESQUADRIAS). Aqui cada triângulo vai para o bloco onde cai o
 *   centro dele em planta (towerAtPoint), e a malha vira uma peça por bloco. As peças
 *   compartilham os atributos da original (só o índice muda): nada é copiado.
 * - buildGhostGeometries: a silhueta de cada bloco no modo andar (unidades, lajes, núcleo e
 *   detalhes do bloco) numa malha única por bloco, em coordenadas de mundo. Assim os blocos
 *   fora do corte custam 2 draw calls cada, em vez de uma por peça.
 */
import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import type { ScenePart } from './scene-model';

export interface TowerPiece {
  part: ScenePart;
  /** Bloco da peça; null = fora de todos (fica com o entorno do corte: silhueta). */
  tower: string | null;
}

/** Índices dos vértices de cada triângulo (malha indexada ou não). */
function triangleIndices(g: BufferGeometry): ArrayLike<number> {
  if (g.index) return g.index.array as ArrayLike<number>;
  const n = g.getAttribute('position')!.count;
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

/**
 * Divide uma peça por bloco. `assign(x, z)` diz o bloco de um ponto em planta (mundo).
 * Peça inteira num bloco só: devolvida como está.
 */
export function splitByTower(
  part: ScenePart,
  assign: (x: number, z: number) => string | null,
): TowerPiece[] {
  const g = part.geometry;
  const pos = g.getAttribute('position');
  if (!pos) return [{ part, tower: null }];
  const idx = triangleIndices(g);
  const groups = new Map<string | null, number[]>();
  const v = new Vector3();
  const c = new Vector3();
  for (let t = 0; t + 2 < idx.length; t += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx[t + k]!));
    c.multiplyScalar(1 / 3).applyMatrix4(part.matrix);
    const key = assign(c.x, c.z);
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(idx[t]!, idx[t + 1]!, idx[t + 2]!);
  }
  if (groups.size <= 1) return [{ part, tower: groups.keys().next().value ?? null }];

  const pieces: TowerPiece[] = [];
  for (const [tower, list] of groups) {
    const piece = new BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) piece.setAttribute(name, attr);
    piece.setIndex(new BufferAttribute(new Uint32Array(list), 1));
    // Caixa só dos vértices usados (three calcularia sobre o atributo inteiro).
    const box = new Box3();
    for (const i of list) box.expandByPoint(v.fromBufferAttribute(pos, i));
    piece.boundingBox = box;
    piece.boundingSphere = box.getBoundingSphere(new Sphere());
    pieces.push({ part: { ...part, geometry: piece }, tower });
  }
  return pieces;
}

/** Uma malha por bloco (chave '' = peças sem bloco), só posições, em coordenadas de mundo. */
export function buildGhostGeometries(pieces: TowerPiece[]): Map<string, BufferGeometry> {
  const byTower = new Map<string, TowerPiece[]>();
  for (const p of pieces) {
    const key = p.tower ?? '';
    let list = byTower.get(key);
    if (!list) byTower.set(key, (list = []));
    list.push(p);
  }
  const out = new Map<string, BufferGeometry>();
  const v = new Vector3();
  for (const [key, list] of byTower) {
    let total = 0;
    for (const { part } of list) total += triangleIndices(part.geometry).length;
    const positions = new Float32Array(total * 3);
    let o = 0;
    for (const { part } of list) {
      const pos = part.geometry.getAttribute('position');
      if (!pos) continue;
      const idx = triangleIndices(part.geometry);
      for (let i = 0; i < idx.length; i++) {
        v.fromBufferAttribute(pos, idx[i]!).applyMatrix4(part.matrix);
        positions[o++] = v.x;
        positions[o++] = v.y;
        positions[o++] = v.z;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions.subarray(0, o), 3));
    geometry.computeBoundingSphere();
    out.set(key, geometry);
  }
  return out;
}
