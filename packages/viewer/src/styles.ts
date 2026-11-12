/**
 * Aparência das unidades por status (tabela do CLAUDE.md). Módulo puro, sem three.js,
 * para o app reutilizar na legenda e o viewer nos materiais.
 */
import type { UnitStatus } from './types';

export const BRAND = {
  musgo: '#23382F',
  salvia: '#3E5A4D',
  latao: '#B08D57',
  papel: '#F3EFE7',
  linho: '#E6DFD2',
  areia: '#D6CFC1',
  nanquim: '#1A2420',
} as const;

export type UnitFill =
  | { kind: 'solid'; color: string }
  /** angle: 45 (/) ou −45 (\), em graus, no plano da face. */
  | { kind: 'hatch'; color: string; background: string; angle: 45 | -45 };

export interface UnitAppearance {
  fill: UnitFill;
  outline: { color: string; width: number };
}

export const STATUS_LABELS: Record<UnitStatus, string> = {
  available: 'Disponível',
  reserved: 'Reservado',
  negotiating: 'Em negociação',
  sold: 'Vendido',
  unavailable: 'Indisponível',
};

const OUTLINE = { color: BRAND.musgo, width: 1 } as const;

export const STATUS_APPEARANCE: Record<UnitStatus, UnitAppearance> = {
  available: { fill: { kind: 'solid', color: '#8CCB8F' }, outline: OUTLINE },
  reserved: {
    fill: { kind: 'hatch', color: '#C99A2E', background: '#F3E3B8', angle: 45 },
    outline: OUTLINE,
  },
  negotiating: {
    fill: { kind: 'hatch', color: BRAND.salvia, background: '#DCE5DF', angle: -45 },
    outline: OUTLINE,
  },
  sold: { fill: { kind: 'solid', color: '#C97A6C' }, outline: OUTLINE },
  unavailable: { fill: { kind: 'solid', color: BRAND.areia }, outline: OUTLINE },
};

/** Seleção é interação, não status: Latão sólido + contorno Nanquim 3 px. */
export const SELECTED_APPEARANCE: UnitAppearance = {
  fill: { kind: 'solid', color: BRAND.latao },
  outline: { color: BRAND.nanquim, width: 3 },
};

export function unitAppearance(status: UnitStatus, selected: boolean): UnitAppearance {
  return selected ? SELECTED_APPEARANCE : STATUS_APPEARANCE[status];
}
