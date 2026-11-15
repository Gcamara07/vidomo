/**
 * Links compartilháveis da página pública:
 *   /e/<slug>?u=802     → andar da unidade, com a ficha aberta
 *   /e/<slug>?andar=8   → o andar
 * Link inválido cai no modo edifício, sem erro. A URL acompanha a navegação (replaceState),
 * então "Copiar link" sempre copia a vista atual. Outros parâmetros (ex.: debug) ficam.
 * TODO(várias torres): aceitar ?u=TA-802 quando houver mais de uma torre.
 */
import { floorKeyOf } from './explore';
import type { PublicUnit } from './public-development';

export interface NavState {
  mode: 'building' | 'floor';
  /** object_key do andar (ex.: 'TA__F08'). */
  activeFloor: string | null;
  /** object_key da unidade selecionada. */
  selected: string | null;
}

export const BUILDING: NavState = { mode: 'building', activeFloor: null, selected: null };

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p)?.trim() ?? '';

export function parseDeepLink(params: { u?: Param; andar?: Param }, units: PublicUnit[]): NavState {
  const code = first(params.u);
  if (code) {
    const unit = units.find((u) => u.code.toLowerCase() === code.toLowerCase());
    if (unit) return { mode: 'floor', activeFloor: floorKeyOf(unit), selected: unit.object_key };
    return BUILDING;
  }
  const andar = first(params.andar);
  if (/^\d{1,3}$/.test(andar)) {
    const n = Number(andar);
    const towers = new Set(units.filter((u) => u.floor_number === n).map((u) => u.tower_code));
    // Só um andar com esse número (uma torre): entra nele.
    if (towers.size === 1) {
      const tower = [...towers][0]!;
      return {
        mode: 'floor',
        activeFloor: floorKeyOf({ tower_code: tower, floor_number: n }),
        selected: null,
      };
    }
  }
  return BUILDING;
}

/** Aplica o estado de navegação à query string atual (mantém outros parâmetros). */
export function searchFor(current: string, nav: NavState, units: PublicUnit[]): string {
  const params = new URLSearchParams(current);
  params.delete('u');
  params.delete('andar');
  const unit = nav.selected ? units.find((u) => u.object_key === nav.selected) : undefined;
  if (unit) {
    params.set('u', unit.code);
  } else if (nav.mode === 'floor' && nav.activeFloor) {
    const u = units.find((x) => floorKeyOf(x) === nav.activeFloor);
    if (u) params.set('andar', String(u.floor_number));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
