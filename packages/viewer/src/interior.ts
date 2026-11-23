/**
 * Maquete do interior no modo andar: leitura do GLB simples de um tipo de planta e geometria
 * de cada unidade já encaixada (fit.ts), pronta para entrar nos lotes (batch.ts).
 *
 * Objetos do GLB: VIS__INT<tipo>_<MATERIAL> (um por material). Papéis:
 *  - PISO: piso de base (sala e circulação), tingido pelo status da unidade;
 *  - VIDRO: guarda-corpo e vidros, semitransparente;
 *  - o resto (paredes, corte, móveis, pisos de madeira e molhados, varanda): cor do próprio
 *    material, com um sombreado simples já gravado nas cores (sem luz em tempo real).
 */
import { Color, Matrix4, Vector3, type Object3D } from 'three';
import { partArrays, type PartArrays } from './batch';
import type { PlanRect } from './fit';
import { extractBuilding } from './scene-model';

export type InteriorRole = 'floor' | 'glass' | 'solid';

export interface InteriorPart {
  role: InteriorRole;
  /** Vértices e contorno no referencial do interior (antes do encaixe). */
  arrays: PartArrays;
  /** Cor do material (espaço linear). */
  color: Color;
}

export interface InteriorSource {
  parts: InteriorPart[];
}

/** Papel pelo nome do objeto: VIS__INTA_PISO → floor; VIS__INTB_VIDRO → glass. */
export function interiorRole(name: string): InteriorRole {
  const m = /^VIS__INT[A-Z0-9]*_([A-Z0-9_]+)$/.exec(name);
  const material = m?.[1] ?? '';
  if (material === 'PISO') return 'floor';
  if (material === 'VIDRO') return 'glass';
  return 'solid';
}

/** Lê o GLB simples de um tipo (uma vez por tipo; reaproveitado entre unidades e andares). */
export function extractInterior(root: Object3D): InteriorSource {
  const model = extractBuilding(root);
  const parts: InteriorPart[] = [];
  for (const p of [...model.structure, ...model.floors, ...model.units]) {
    const src = p.sourceMaterial as (typeof p.sourceMaterial & { color?: Color }) | null;
    parts.push({
      role: interiorRole(p.name),
      arrays: partArrays(p.geometry, p.matrix, 30),
      color: src?.color ? src.color.clone() : new Color('#cccccc'),
    });
  }
  return { parts };
}

/** Geometria de uma unidade, já encaixada (coordenadas de mundo). */
export interface InteriorUnitGeometry {
  /** Paredes, corte, móveis etc.: posição + cor (sombreado gravado). */
  solid: PartArrays;
  /** Vidros: só posição. */
  glass: PartArrays;
  /** Piso de base: posição + UV em metros (hachura) + cor neutra (piso esmaecido). */
  floor: PartArrays;
}

const tmp = new Vector3();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();

/** Sombreado simples por face (topo claro, laterais mais escuras), em espaço linear. */
function shadeOf(n: Vector3): number {
  const ny = Math.abs(n.y);
  if (ny > 0.7) return 1;
  return Math.abs(n.x) > Math.abs(n.z) ? 0.66 : 0.8;
}

function transformArrays(
  parts: InteriorPart[],
  m: Matrix4,
  mode: 'shaded' | 'flat' | 'none',
  withUv: boolean,
): PartArrays {
  let verts = 0;
  let edgeFloats = 0;
  for (const p of parts) {
    verts += p.arrays.position.length / 3;
    edgeFloats += p.arrays.edges.length;
  }
  const position = new Float32Array(verts * 3);
  const color = mode === 'none' ? null : new Float32Array(verts * 3);
  const uv = withUv ? new Float32Array(verts * 2) : null;
  const edges = new Float32Array(edgeFloats);
  // Espelho inverte a ordem dos vértices: troca dois deles para a face continuar de frente.
  const flip = m.determinant() < 0;
  let vo = 0;
  let eo = 0;
  for (const p of parts) {
    const src = p.arrays.position;
    const n = src.length / 3;
    for (let i = 0; i < n; i++) {
      const j = flip && i % 3 !== 0 ? i + (i % 3 === 1 ? 1 : -1) : i;
      tmp.fromArray(src, j * 3).applyMatrix4(m);
      tmp.toArray(position, (vo + i) * 3);
      if (uv) {
        uv[(vo + i) * 2] = tmp.x;
        uv[(vo + i) * 2 + 1] = tmp.z;
      }
    }
    if (color) {
      for (let t = 0; t < n; t += 3) {
        let s = 1;
        if (mode === 'shaded') {
          a.fromArray(position, (vo + t) * 3);
          b.fromArray(position, (vo + t + 1) * 3);
          c.fromArray(position, (vo + t + 2) * 3);
          s = shadeOf(b.sub(a).cross(c.sub(a)).normalize());
        }
        for (let k = 0; k < 3; k++) {
          const o = (vo + t + k) * 3;
          color[o] = p.color.r * s;
          color[o + 1] = p.color.g * s;
          color[o + 2] = p.color.b * s;
        }
      }
    }
    const e = p.arrays.edges;
    for (let i = 0; i < e.length / 3; i++) {
      tmp.fromArray(e, i * 3).applyMatrix4(m);
      tmp.toArray(edges, eo + i * 3);
    }
    eo += e.length;
    vo += n;
  }
  return { position, uv, color, edges };
}

/** Interior de um tipo encaixado numa unidade (matriz de fitInterior). */
export function placeInterior(
  source: InteriorSource,
  fitMatrix: readonly number[],
): InteriorUnitGeometry {
  const m = new Matrix4().fromArray(fitMatrix as number[]);
  const by = (role: InteriorRole) => source.parts.filter((p) => p.role === role);
  const solid = transformArrays(by('solid'), m, 'shaded', false);
  const glass = transformArrays(by('glass'), m, 'none', false);
  const floor = transformArrays(by('floor'), m, 'flat', true);
  // O contorno do vidro vai junto com o das peças sólidas (um conjunto de linhas só).
  const edges = new Float32Array(solid.edges.length + glass.edges.length);
  edges.set(solid.edges, 0);
  edges.set(glass.edges, solid.edges.length);
  return {
    solid: { ...solid, edges },
    glass: { ...glass, edges: new Float32Array(0) },
    floor: { ...floor, edges: new Float32Array(0) },
  };
}

/** Altura do corte das paredes da maquete sobre o piso (m). */
export const INTERIOR_CUT_HEIGHT = 1.4;
/** Recorte do prédio (estrutura e detalhes) no andar ativo com maquetes, sobre a laje (m). */
export const INTERIOR_BUILDING_CUT = 1.45;
/** Faixa de status: do eixo da parede externa (5 cm fora da caixa) para dentro (m). */
const BAND_OUTSET = 0.05;
const BAND_WIDTH = 0.12;
const BAND_WIDTH_SELECTED = 0.26;

function rectCorners(rect: PlanRect, grow: number): [number, number][] {
  const cs = Math.cos(rect.angle);
  const sn = Math.sin(rect.angle);
  const hu = rect.half[0] + grow;
  const hv = rect.half[1] + grow;
  return (
    [
      [-hu, -hv],
      [hu, -hv],
      [hu, hv],
      [-hu, hv],
    ] as const
  ).map(([u, v]) => [rect.center[0] + u * cs - v * sn, rect.center[1] + u * sn + v * cs]);
}

/**
 * Faixa de status em volta da unidade, na altura do corte (sobre o topo das paredes).
 * Selecionada: faixa mais larga e o contorno externo (linha Nanquim) em `outline`.
 */
export function statusBand(
  rect: PlanRect,
  selected: boolean,
): { arrays: PartArrays; outline: Float32Array } {
  const y = rect.base + INTERIOR_CUT_HEIGHT + 0.012;
  const outer = rectCorners(rect, BAND_OUTSET);
  const inner = rectCorners(rect, BAND_OUTSET - (selected ? BAND_WIDTH_SELECTED : BAND_WIDTH));
  const pos: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const o0 = outer[i]!;
    const o1 = outer[j]!;
    const i0 = inner[i]!;
    const i1 = inner[j]!;
    pos.push(o0[0], y, o0[1], o1[0], y, o1[1], i1[0], y, i1[1]);
    pos.push(o0[0], y, o0[1], i1[0], y, i1[1], i0[0], y, i0[1]);
  }
  const outline: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = outer[i]!;
    const q = outer[(i + 1) % 4]!;
    outline.push(p[0], y + 0.005, p[1], q[0], y + 0.005, q[1]);
  }
  return {
    arrays: {
      position: new Float32Array(pos),
      uv: null,
      color: null,
      edges: new Float32Array(0),
    },
    outline: new Float32Array(outline),
  };
}
