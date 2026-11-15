/**
 * Torre × entorno, sem mexer no modelo: pela projeção no chão (planta).
 *
 * - Projeção da torre: retângulo que envolve, em planta, os objetos TOWER__ e FLOOR__ do
 *   modelo leve.
 * - Um objeto é da "torre" se o contorno dele em planta fica dentro dessa projeção com uma
 *   margem de 2 m (assim varandas e guarda-corpos, que saem 1,6 m para fora, ficam na torre).
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

/**
 * "tower" se a caixa, em planta, cabe na projeção da torre + margem; senão "site".
 * Sem projeção (modelo sem TOWER__/FLOOR__), tudo é tratado como torre.
 */
export function classifyZone(
  box: Box,
  footprint: Footprint | null,
  margin = TOWER_MARGIN_M,
): PartZone {
  if (!footprint) return 'tower';
  const inside =
    box.min[0] >= footprint.minX - margin &&
    box.max[0] <= footprint.maxX + margin &&
    box.min[2] >= footprint.minZ - margin &&
    box.max[2] <= footprint.maxZ + margin;
  return inside ? 'tower' : 'site';
}
