/**
 * Links compartilháveis da página pública:
 *   /e/<slug>?u=802              → andar da unidade, com a ficha aberta
 *   /e/<slug>?u=B09-201          → idem, quando o código da unidade se repete entre blocos
 *   /e/<slug>?u=802&ver=1        → idem, com o "Ver apartamento" aberto (se o tipo tiver
 *                                  interior; senão, só a ficha)
 *   /e/<slug>?andar=8            → o andar (empreendimento de um bloco só)
 *   /e/<slug>?bloco=09           → o bloco (aceita o nome curto "09", o código "B09" ou "9")
 *   /e/<slug>?bloco=09&andar=2   → o andar do bloco
 * Link inválido cai na vista geral, sem erro. A URL acompanha a navegação (replaceState),
 * então "Copiar link" sempre copia a vista atual. Outros parâmetros (ex.: debug) ficam.
 */
import type { ViewerMode } from '@vidomo/viewer/types';
import { floorKeyOf } from './explore';
import type { PublicUnit } from './public-development';
import { hasManyTowers, matchesTower, towerShort } from './unit-ref';

export interface NavState {
  mode: ViewerMode;
  /** Código do bloco ativo (modo bloco ou andar), ou null. */
  activeTower: string | null;
  /** object_key do andar (ex.: 'TA__F08'). */
  activeFloor: string | null;
  /** object_key da unidade selecionada. */
  selected: string | null;
  /** "Ver apartamento" aberto (só com unidade selecionada). */
  apartment?: boolean;
}

export const BUILDING: NavState = {
  mode: 'building',
  activeTower: null,
  activeFloor: null,
  selected: null,
};

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p)?.trim() ?? '';
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/** Unidade do ?u=: o código do link ("802", "B09-201") ou "<bloco>-<código>" ("09-201"). */
function unitFromParam(code: string, units: PublicUnit[]): PublicUnit | undefined {
  return (
    units.find((u) => same(u.link_code, code)) ??
    units.find((u) => same(`${u.tower_code}-${u.code}`, code)) ??
    units.find((u) => same(`${towerShort(u)}-${u.code}`, code))
  );
}

function floorNav(unit: PublicUnit, selected: string | null): NavState {
  return {
    mode: 'floor',
    activeTower: unit.tower_code,
    activeFloor: floorKeyOf(unit),
    selected,
  };
}

export function parseDeepLink(
  params: { u?: Param; andar?: Param; bloco?: Param; ver?: Param },
  units: PublicUnit[],
): NavState {
  const code = first(params.u);
  if (code) {
    const unit = unitFromParam(code, units);
    if (!unit) return BUILDING;
    const nav = floorNav(unit, unit.object_key);
    return first(params.ver) === '1' ? { ...nav, apartment: true } : nav;
  }

  const many = hasManyTowers(units);
  const bloco = first(params.bloco);
  // Com vários blocos, ?bloco= escolhe o bloco; com um só, é ignorado (o bloco é o único).
  let scope = units;
  if (bloco && many) {
    scope = units.filter((u) => matchesTower(u, bloco));
    if (scope.length === 0) return BUILDING;
  }

  const andar = first(params.andar);
  if (/^\d{1,3}$/.test(andar)) {
    const n = Number(andar);
    const onFloor = scope.filter((u) => u.floor_number === n);
    // Só um andar com esse número no escopo (um bloco): entra nele.
    if (onFloor.length > 0 && new Set(onFloor.map((u) => u.tower_code)).size === 1) {
      return floorNav(onFloor[0]!, null);
    }
  }
  if (bloco && many) {
    return { mode: 'tower', activeTower: scope[0]!.tower_code, activeFloor: null, selected: null };
  }
  return BUILDING;
}

/** Aplica o estado de navegação à query string atual (mantém outros parâmetros). */
export function searchFor(current: string, nav: NavState, units: PublicUnit[]): string {
  const params = new URLSearchParams(current);
  params.delete('u');
  params.delete('andar');
  params.delete('bloco');
  params.delete('ver');
  const many = hasManyTowers(units);
  const unit = nav.selected ? units.find((u) => u.object_key === nav.selected) : undefined;
  const towerUnit = nav.activeTower
    ? units.find((u) => u.tower_code === nav.activeTower)
    : undefined;
  if (unit) {
    params.set('u', unit.link_code);
    if (nav.apartment) params.set('ver', '1');
  } else if (nav.mode === 'floor' && nav.activeFloor) {
    const u = units.find((x) => floorKeyOf(x) === nav.activeFloor);
    if (u) {
      if (many) params.set('bloco', towerShort(u));
      params.set('andar', String(u.floor_number));
    }
  } else if (nav.mode === 'tower' && many && towerUnit) {
    params.set('bloco', towerShort(towerUnit));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Link de compartilhar da ficha: a vista atual sem o "Ver apartamento" (?ver=). */
export function shareUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('ver');
  return url.toString();
}
