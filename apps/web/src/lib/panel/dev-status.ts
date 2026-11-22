/**
 * Tela de status das unidades (/painel/dev-status): ordem, filtros e grupos por bloco.
 * Módulo puro (testável). Tudo vem do cadastro (nome, nome curto e ordem do bloco).
 */
import type { UnitStatus } from '@vidomo/viewer/types';

export interface DevStatusUnit {
  id: string;
  code: string;
  objectKey: string;
  status: UnitStatus;
  updatedAt: string;
  floor: number | null;
  /** Rótulo do andar (ex.: "Térreo"); null = o número. */
  floorLabel: string | null;
  typeName: string | null;
  development: string;
  developmentSlug: string;
  published: boolean;
  towerCode: string;
  /** Nome do bloco (ex.: "Bloco 09", "Torre A"). */
  towerName: string;
  /** Nome curto (ex.: "09"); null = sem cadastro. */
  towerShort: string | null;
  towerOrder: number;
}

export interface DevStatusFilters {
  /** slug do empreendimento. */
  development: string;
  /** Código do bloco; '' = todos. */
  tower: string;
  /** Número do andar; null = todos. */
  floor: number | null;
  /** '' = todos. */
  status: UnitStatus | '';
}

const collator = new Intl.Collator('pt-BR', { numeric: true });

/** Empreendimento → bloco (ordem de exibição, depois código) → andar → unidade. */
export function sortUnits(units: DevStatusUnit[]): DevStatusUnit[] {
  return [...units].sort(
    (a, b) =>
      collator.compare(a.development, b.development) ||
      a.towerOrder - b.towerOrder ||
      collator.compare(a.towerCode, b.towerCode) ||
      (a.floor ?? 0) - (b.floor ?? 0) ||
      collator.compare(a.code, b.code),
  );
}

export interface DevelopmentOption {
  slug: string;
  name: string;
  published: boolean;
}

/** Empreendimentos na ordem da lista (o primeiro abre filtrado). */
export function developmentOptions(units: DevStatusUnit[]): DevelopmentOption[] {
  const map = new Map<string, DevelopmentOption>();
  for (const u of sortUnits(units)) {
    if (!map.has(u.developmentSlug)) {
      map.set(u.developmentSlug, {
        slug: u.developmentSlug,
        name: u.development,
        published: u.published,
      });
    }
  }
  return [...map.values()];
}

export function defaultFilters(units: DevStatusUnit[]): DevStatusFilters {
  return {
    development: developmentOptions(units)[0]?.slug ?? '',
    tower: '',
    floor: null,
    status: '',
  };
}

/** Rótulo do bloco na coluna: nome curto, ou o nome. */
export const towerColumn = (u: Pick<DevStatusUnit, 'towerShort' | 'towerName'>) =>
  u.towerShort ?? u.towerName;

/** Andar como na página pública: rótulo do cadastro ("Térreo") ou o número. */
export const floorColumn = (u: Pick<DevStatusUnit, 'floor' | 'floorLabel'>) =>
  u.floorLabel ?? (u.floor === null ? '—' : String(u.floor));

export interface TowerOption {
  code: string;
  name: string;
}

/** Blocos de um empreendimento, na ordem de exibição. */
export function towerOptions(units: DevStatusUnit[], development: string): TowerOption[] {
  const map = new Map<string, TowerOption>();
  for (const u of sortUnits(units)) {
    if (u.developmentSlug === development && !map.has(u.towerCode)) {
      map.set(u.towerCode, { code: u.towerCode, name: u.towerName });
    }
  }
  return [...map.values()];
}

/** Andares do empreendimento (ou do bloco), em ordem; com rótulo quando houver. */
export function floorOptions(
  units: DevStatusUnit[],
  development: string,
  tower: string,
): { number: number; label: string }[] {
  const map = new Map<number, string>();
  for (const u of units) {
    if (u.developmentSlug !== development || u.floor === null) continue;
    if (tower && u.towerCode !== tower) continue;
    if (!map.has(u.floor)) map.set(u.floor, u.floorLabel ?? `${u.floor}º`);
  }
  return [...map].sort((a, b) => a[0] - b[0]).map(([number, label]) => ({ number, label }));
}

export function filterUnits(units: DevStatusUnit[], f: DevStatusFilters): DevStatusUnit[] {
  return sortUnits(
    units.filter(
      (u) =>
        u.developmentSlug === f.development &&
        (!f.tower || u.towerCode === f.tower) &&
        (f.floor === null || u.floor === f.floor) &&
        (!f.status || u.status === f.status),
    ),
  );
}

export interface TowerGroup {
  code: string;
  name: string;
  units: DevStatusUnit[];
  available: number;
}

/** Grupos por bloco, na ordem das unidades (já ordenadas). */
export function groupByTower(units: DevStatusUnit[]): TowerGroup[] {
  const groups: TowerGroup[] = [];
  for (const u of units) {
    let g = groups.at(-1);
    if (!g || g.code !== u.towerCode) {
      g = { code: u.towerCode, name: u.towerName, units: [], available: 0 };
      groups.push(g);
    }
    g.units.push(u);
    if (u.status === 'available') g.available++;
  }
  return groups;
}

/** "Bloco 09 · 16 unidades · 6 disponíveis". */
export function groupTitle(g: Pick<TowerGroup, 'name' | 'units' | 'available'>): string {
  const n = g.units.length;
  const units = n === 1 ? '1 unidade' : `${n} unidades`;
  const free = g.available === 1 ? '1 disponível' : `${g.available} disponíveis`;
  return `${g.name} · ${units} · ${free}`;
}

/** O empreendimento tem mais de um bloco (só então a coluna e os grupos aparecem). */
export function manyTowers(units: DevStatusUnit[], development: string): boolean {
  return towerOptions(units, development).length > 1;
}
