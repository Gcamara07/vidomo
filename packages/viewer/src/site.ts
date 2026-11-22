/**
 * Torre × entorno, sem mexer no modelo: pela projeção no chão (planta).
 *
 * - Projeção de cada torre (bloco): retângulo que envolve, em planta, os objetos TOWER__ e
 *   FLOOR__ daquela torre no modelo leve.
 * - Um objeto é da "torre" se o contorno dele em planta fica dentro da projeção de alguma
 *   torre com uma margem de 2 m (assim varandas e guarda-corpos, que saem 1,6 m para fora,
 *   ficam na torre).
 * - Em empreendimentos de vários blocos, a camada de detalhes costuma juntar o mesmo
 *   elemento de todos os blocos numa malha só (ex.: VIS__ESQUADRIAS). Por isso também é da
 *   "torre" o objeto que, em planta, cruza a projeção de 2 ou mais torres e sobe acima do
 *   primeiro andar (`spanMinTop`). Com uma torre só, essa regra nunca vale.
 * - O resto é "entorno" (terreno, rua, pisos, piscina, árvores, áreas comuns, marquises).
 *
 * No modo andar, só a torre é recortada por altura e esmaecida abaixo do andar ativo; o
 * entorno aparece sempre normal, como contexto.
 *
 * TODO(convenção): prefixo explícito para entorno (ex.: SITE__) no lugar desta heurística,
 * quando os modelos do Blender adotarem a convenção. Módulo puro (usado também pelo
 * validador de modelos).
 */
import type { Vec3 } from './types';

export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type PartZone = 'tower' | 'site';

/** Margem em planta em volta da torre (m). */
export const TOWER_MARGIN_M = 2;

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Retângulo em planta que envolve as caixas dadas (TOWER__ e FLOOR__). null se vazio. */
export function towerFootprint(boxes: Box[]): Footprint | null {
  if (boxes.length === 0) return null;
  return boxes.reduce<Footprint>(
    (fp, b) => ({
      minX: Math.min(fp.minX, b.min[0]),
      maxX: Math.max(fp.maxX, b.max[0]),
      minZ: Math.min(fp.minZ, b.min[2]),
      maxZ: Math.max(fp.maxZ, b.max[2]),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
}

export interface ZoneOptions {
  /** Margem em planta (m). Padrão: TOWER_MARGIN_M. */
  margin?: number;
  /**
   * Cota do topo do primeiro andar. Objeto que cruza 2+ torres e sobe acima dela é da
   * torre (malha única com o mesmo elemento de vários blocos). Sem valor, a regra não vale.
   */
  spanMinTop?: number;
}

function insideFootprint(box: Box, fp: Footprint, margin: number): boolean {
  return (
    box.min[0] >= fp.minX - margin &&
    box.max[0] <= fp.maxX + margin &&
    box.min[2] >= fp.minZ - margin &&
    box.max[2] <= fp.maxZ + margin
  );
}

function overlapsFootprint(box: Box, fp: Footprint): boolean {
  return (
    box.min[0] < fp.maxX && box.max[0] > fp.minX && box.min[2] < fp.maxZ && box.max[2] > fp.minZ
  );
}

/**
 * "tower" se a caixa, em planta, cabe na projeção de alguma torre + margem (ou cruza 2+
 * torres e sobe acima do primeiro andar); senão "site".
 * Sem projeção (modelo sem TOWER__/FLOOR__), tudo é tratado como torre.
 */
export function classifyZone(
  box: Box,
  footprints: Footprint | readonly Footprint[] | null,
  options: ZoneOptions = {},
): PartZone {
  const list = footprints === null ? [] : Array.isArray(footprints) ? footprints : [footprints];
  if (list.length === 0) return 'tower';
  const margin = options.margin ?? TOWER_MARGIN_M;
  if (list.some((fp) => insideFootprint(box, fp, margin))) return 'tower';
  if (
    options.spanMinTop !== undefined &&
    box.max[1] > options.spanMinTop &&
    list.filter((fp) => overlapsFootprint(box, fp)).length >= 2
  ) {
    return 'tower';
  }
  return 'site';
}
