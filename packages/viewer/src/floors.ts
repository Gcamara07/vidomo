/**
 * Andares a partir das lajes FLOOR__ do modelo leve (sem exigir nada do modelo além da
 * convenção de nomes) e regras de visibilidade do modo andar. Módulo puro (testável).
 *
 * Cota do andar F: da face de baixo da laje F até a face de baixo da laje F+1 (ou o topo do
 * prédio, no último andar).
 */
import { floorKeyOfUnit, parseFloorKey } from './naming';
import type { Vec3 } from './types';

export type ViewerMode = 'building' | 'floor';

export interface FloorLevel {
  /** object_key do andar (ex.: 'TA__F08'). */
  key: string;
  tower: string;
  number: number;
  /** Cota da base (face de baixo da laje do andar). */
  base: number;
  /** Cota do topo (base da laje de cima, ou topo do prédio). */
  top: number;
  /** Caixa da laje (para enquadrar a câmera). */
  slab: { min: Vec3; max: Vec3 };
}

export interface FloorSlabInput {
  objectKey: string;
  min: Vec3;
  max: Vec3;
}

export function computeFloorLevels(slabs: FloorSlabInput[], buildingTop: number): FloorLevel[] {
  const byTower = new Map<string, (FloorSlabInput & { number: number })[]>();
  for (const s of slabs) {
    const p = parseFloorKey(s.objectKey);
    if (!p) continue;
    const list = byTower.get(p.tower) ?? [];
    list.push({ ...s, number: p.floor });
    byTower.set(p.tower, list);
  }
  const levels: FloorLevel[] = [];
  for (const [tower, list] of byTower) {
    list.sort((a, b) => a.number - b.number);
    list.forEach((s, i) => {
      const next = list[i + 1];
      levels.push({
        key: s.objectKey,
        tower,
        number: s.number,
        base: s.min[1],
        top: next ? next.min[1] : Math.max(buildingTop, s.max[1]),
        slab: { min: s.min, max: s.max },
      });
    });
  }
  return levels.sort((a, b) => a.base - b.base || a.tower.localeCompare(b.tower));
}

/**
 * Como uma peça aparece no modo atual.
 * - normal: como no modo edifício
 * - lower: andar abaixo do ativo — esmaecida, sem contorno, sem toque
 * - hidden: andar acima do ativo — oculta, sem toque
 */
export type PartView = 'normal' | 'lower' | 'hidden';

const EPS = 0.05;

/** Visão de uma peça que pertence a um andar (unidade ou laje). */
export function floorPartView(
  partFloor: FloorLevel | undefined,
  mode: ViewerMode,
  active: FloorLevel | undefined,
): PartView {
  if (mode === 'building' || !active || !partFloor) return 'normal';
  if (partFloor.key === active.key) return 'normal';
  // Compara por cota (vale também entre torres diferentes).
  if (partFloor.base > active.base + EPS) return 'hidden';
  return 'lower';
}

export function unitView(
  unitKey: string,
  levels: Map<string, FloorLevel>,
  mode: ViewerMode,
  active: FloorLevel | undefined,
): PartView {
  const fk = floorKeyOfUnit(unitKey);
  return floorPartView(fk ? levels.get(fk) : undefined, mode, active);
}

/**
 * Faixa de altura que fica "normal" para peças sem andar (núcleo, cobertura, camada de
 * detalhes): acima de `top` some; abaixo de `bottom` aparece esmaecida.
 * No modo edifício não há recorte (null).
 */
export function clipRange(
  mode: ViewerMode,
  active: FloorLevel | undefined,
): { bottom: number; top: number } | null {
  if (mode === 'building' || !active) return null;
  // Pequena folga: a laje de cima (e varandas apoiadas nela) já fica fora.
  return { bottom: active.base - 0.02, top: active.top - 0.02 };
}
