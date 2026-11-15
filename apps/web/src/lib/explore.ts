/**
 * Navegação da página pública (andares, filtros, contagens). Módulo puro: o 3D só recebe o
 * resultado (modo, andar ativo, unidades esmaecidas). Tudo é recalculado a partir do mapa de
 * status em tempo real, então filtros e contagens acompanham as mudanças.
 */
import { floorObjectKey } from '@vidomo/viewer/naming';
import { UNIT_STATUSES, type UnitStatus, type UnitStatusMap } from '@vidomo/viewer/types';
import type { PublicUnit } from './public-development';

export interface FloorEntry {
  /** object_key do andar (ex.: 'TA__F08'). */
  key: string;
  tower: string;
  number: number;
  /** Unidades disponíveis no andar, sem filtros. */
  available: number;
}

export function floorKeyOf(unit: Pick<PublicUnit, 'tower_code' | 'floor_number'>): string {
  return floorObjectKey(unit.tower_code, unit.floor_number);
}

/** Andares do empreendimento, do mais alto para o mais baixo. */
export function floorsFromUnits(units: PublicUnit[], statusMap: UnitStatusMap): FloorEntry[] {
  const byKey = new Map<string, FloorEntry>();
  for (const u of units) {
    const key = floorKeyOf(u);
    const entry = byKey.get(key) ?? {
      key,
      tower: u.tower_code,
      number: u.floor_number,
      available: 0,
    };
    if ((statusMap[u.object_key] ?? u.status) === 'available') entry.available++;
    byKey.set(key, entry);
  }
  // TODO(várias torres): agrupar por torre no seletor.
  return [...byKey.values()].sort((a, b) => b.number - a.number || a.tower.localeCompare(b.tower));
}

export function floorLabel(f: Pick<FloorEntry, 'number' | 'available'>): string {
  const free = f.available === 1 ? '1 livre' : `${f.available} livres`;
  return `${f.number}º · ${free}`;
}

export interface Filters {
  statuses: ReadonlySet<UnitStatus>;
  bedrooms: ReadonlySet<number>;
}

/** Quantidades de dormitórios que existem no empreendimento (para os botões de filtro). */
export function bedroomOptions(units: PublicUnit[]): number[] {
  return [...new Set(units.map((u) => u.bedrooms).filter((b): b is number => b !== null))].sort(
    (a, b) => a - b,
  );
}

/** Padrão: todos os status e todos os dormitórios. */
export function defaultFilters(units: PublicUnit[]): Filters {
  return { statuses: new Set(UNIT_STATUSES), bedrooms: new Set(bedroomOptions(units)) };
}

export function isDefaultFilters(f: Filters, units: PublicUnit[]): boolean {
  const opts = bedroomOptions(units);
  return (
    f.statuses.size === UNIT_STATUSES.length &&
    opts.length === f.bedrooms.size &&
    opts.every((b) => f.bedrooms.has(b))
  );
}

function matchesBedrooms(u: PublicUnit, f: Filters): boolean {
  // Unidade sem tipo (sem dormitórios cadastrados) não é escondida pelo filtro.
  return u.bedrooms === null || f.bedrooms.has(u.bedrooms);
}

export function matchesFilters(u: PublicUnit, status: UnitStatus, f: Filters): boolean {
  return f.statuses.has(status) && matchesBedrooms(u, f);
}

/** object_keys esmaecidos no 3D (não atendem aos filtros). */
export function dimmedUnitKeys(
  units: PublicUnit[],
  statusMap: UnitStatusMap,
  f: Filters,
): Set<string> {
  const out = new Set<string>();
  for (const u of units) {
    if (!matchesFilters(u, statusMap[u.object_key] ?? u.status, f)) out.add(u.object_key);
  }
  return out;
}

/**
 * Contagens da legenda: por status, entre as unidades que atendem ao filtro de dormitórios.
 * (Status desmarcados aparecem apagados na legenda, com a contagem deles.)
 */
export function legendCounts(
  units: PublicUnit[],
  statusMap: UnitStatusMap,
  f: Filters,
): { byStatus: Record<UnitStatus, number>; matching: number; total: number } {
  const byStatus = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as Record<
    UnitStatus,
    number
  >;
  let matching = 0;
  for (const u of units) {
    const s = statusMap[u.object_key] ?? u.status;
    if (!matchesBedrooms(u, f)) continue;
    byStatus[s]++;
    if (f.statuses.has(s)) matching++;
  }
  return { byStatus, matching, total: units.length };
}

export function toggleIn<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
