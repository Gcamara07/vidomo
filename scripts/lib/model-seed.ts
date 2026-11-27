/**
 * Seed de um empreendimento a partir do GLB leve (blocos, andares e unidades pelos nomes) e
 * de uma configuração com o que o modelo não sabe (nome, tipos de planta, preços).
 * Módulo puro: o script seed-from-model.ts lê o GLB e grava o SQL.
 *
 * Posição da unidade (fachada): ponto cardeal mais próximo da direção que vai do centro do
 * bloco ao centro da unidade, em planta. Norte = +Y do Blender = −Z do glTF; leste = +X.
 */
import { UNIT_STATUSES, type UnitStatus } from '@vidomo/viewer/types';

export type Facade = 'norte' | 'sul' | 'leste' | 'oeste';

/** Ponto em planta (x, z) do glTF. */
export type PlanPoint = [number, number];

export function facadeOf(unit: PlanPoint, tower: PlanPoint): Facade {
  const east = unit[0] - tower[0];
  const north = -(unit[1] - tower[1]);
  if (Math.abs(east) >= Math.abs(north)) return east >= 0 ? 'leste' : 'oeste';
  return north >= 0 ? 'norte' : 'sul';
}

/** Hash FNV-1a de 32 bits: distribuições determinísticas a partir do object_key. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type StatusWeights = Partial<Record<UnitStatus, number>>;

/** Maioria disponível, todos os status presentes. */
export const DEFAULT_STATUS_WEIGHTS: Record<UnitStatus, number> = {
  available: 50,
  reserved: 15,
  negotiating: 10,
  sold: 15,
  unavailable: 10,
};

/** Status determinístico de uma unidade, pelos pesos. */
export function statusFor(objectKey: string, weights: StatusWeights = DEFAULT_STATUS_WEIGHTS) {
  const entries = UNIT_STATUSES.map((s) => [s, weights[s] ?? 0] as const).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = hash32(objectKey) % total;
  for (const [s, w] of entries) {
    if (r < w) return s;
    r -= w;
  }
  return entries.at(-1)![0];
}

export interface UnitTypeConfig {
  name: string;
  area_m2: number;
  bedrooms: number;
  /** Sem valor: não informado (a ficha mostra "—"). */
  suites?: number;
  /** Andares (número) deste tipo. Sem lista: os demais andares. */
  floors?: number[];
  /**
   * Finais do código da unidade deste tipo (ex.: ['1', '3'] para 201, 203, 301…). Sem lista:
   * todos os finais. Combina com `floors` (ex.: Tipo A térreo = andar 1, finais 1 e 3).
   */
  finals?: string[];
  /** Preço no 1º andar do tipo; cada andar acima soma pricePerFloor. */
  basePrice: number;
  pricePerFloor?: number;
  /** Ajuste de preço por andar, somado ao resto (ex.: { "4": -3000 }: 4º andar sem elevador). */
  floorPriceAdjust?: Record<string, number>;
  /** Interior (maquete) do tipo: caminhos no bucket `models` e a unidade de referência. */
  interior?: { modelPath: string; detailModelPath?: string; referenceUnit: string };
  /** Cômodos do "Ver apartamento" (unit_type_rooms), na ordem de exibição. */
  rooms?: RoomConfig[];
}

export interface RoomConfig {
  name: string;
  area_m2: number;
  /** Etiqueta nas coordenadas do Blender (x, y) sobre a unidade de referência. */
  label: [number, number];
}

/**
 * Status com contagem exata (em vez de pesos por unidade). A soma de `total` precisa ser o
 * número de unidades. `byFloor` fixa a contagem de um andar (ex.: térreo com mais vendidos);
 * `minAvailablePerTower` garante unidades livres em cada bloco. O resto sai em ordem de hash
 * do object_key: o mesmo modelo dá sempre o mesmo resultado.
 */
export interface StatusCounts {
  total: Record<UnitStatus, number>;
  byFloor?: Record<string, Partial<Record<UnitStatus, number>>>;
  minAvailablePerTower?: number;
}

export interface SeedConfig {
  organizationId: string;
  slug: string;
  name: string;
  status?: 'published' | 'draft';
  priceDisplay?: 'hidden' | 'from' | 'exact';
  /** Caminhos no bucket `models` (resolvidos no app por getAssetUrl()). */
  modelPath: string;
  detailModelPath?: string;
  /** Câmeras do viewer (developments.viewer_cameras), ex.: { default: { position, target } }. */
  viewerCameras?: Record<string, { position: number[]; target: number[] }>;
  /**
   * Nome e nome curto do bloco. Marcadores: {code} = código ('B09'), {num} = dígitos do
   * código ('09'). Ex.: { name: 'Bloco {num}', shortName: '{num}' }.
   */
  tower: { name: string; shortName?: string };
  /** Rótulos de andar por número (ex.: { "1": "Térreo" }). */
  floorLabels?: Record<string, string>;
  unitTypes: UnitTypeConfig[];
  statusWeights?: StatusWeights;
  /** Contagem exata de status; tem precedência sobre statusWeights. */
  statusCounts?: StatusCounts;
  /** Variação máxima do preço por unidade, em R$ (passos de 1.000). Padrão 4000; 0 = exato. */
  priceVariation?: number;
  /** Frente (lado da rua) ou fundos pela fachada da unidade. Sem valor: frontage nulo. */
  frontageByFacade?: Partial<Record<Facade, Frontage>>;
  /** Linha 2 do cabeçalho do SQL. Padrão: aviso de seed só local. */
  headerNote?: string;
  /** Comentários gravados no SQL (ex.: dados que ainda não têm campo no banco). */
  notes?: string[];
}

export type Frontage = 'frente' | 'fundos';

export interface ModelUnit {
  objectKey: string;
  code: string;
  floor: number;
  center: PlanPoint;
}

export interface ModelTower {
  code: string;
  center: PlanPoint;
  floors: number[];
  units: ModelUnit[];
}

const fill = (template: string, code: string) =>
  template.replaceAll('{code}', code).replaceAll('{num}', code.replace(/^\D+/, '') || code);

export function unitTypeFor(types: UnitTypeConfig[], floor: number, code?: string): UnitTypeConfig {
  const candidates = types.filter(
    (u) => !u.finals || (code !== undefined && u.finals.some((f) => code.endsWith(f))),
  );
  const t = candidates.find((u) => u.floors?.includes(floor)) ?? candidates.find((u) => !u.floors);
  if (!t) {
    throw new Error(
      `Nenhum tipo de planta para o andar ${floor}${code ? ` (unidade ${code})` : ''}.`,
    );
  }
  return t;
}

/** Status de todas as unidades pela contagem exata (ver StatusCounts). */
export function allocateStatuses(
  towers: ModelTower[],
  counts: StatusCounts,
): Map<string, UnitStatus> {
  const units = towers.flatMap((t) => t.units.map((u) => ({ ...u, tower: t.code })));
  const sum = UNIT_STATUSES.reduce((s, st) => s + (counts.total[st] ?? 0), 0);
  if (sum !== units.length) {
    throw new Error(`statusCounts.total soma ${sum}, mas o modelo tem ${units.length} unidades.`);
  }
  const rank = new Map(units.map((u) => [u.objectKey, hash32(`${u.objectKey}|status`)]));
  const ordered = (list: typeof units) =>
    [...list].sort(
      (a, b) =>
        rank.get(a.objectKey)! - rank.get(b.objectKey)! || a.objectKey.localeCompare(b.objectKey),
    );
  const left: Record<UnitStatus, number> = { ...counts.total };
  const out = new Map<string, UnitStatus>();
  const free = (list: typeof units) => ordered(list.filter((u) => !out.has(u.objectKey)));
  const take = (list: typeof units, status: UnitStatus, n: number, where: string) => {
    const pool = free(list);
    if (n > pool.length) throw new Error(`Faltam unidades para ${n} × ${status} (${where}).`);
    if (n > left[status]) throw new Error(`${where}: ${status} passa do total.`);
    for (const u of pool.slice(0, n)) out.set(u.objectKey, status);
    left[status] -= n;
  };

  for (const [floor, quota] of Object.entries(counts.byFloor ?? {})) {
    const onFloor = units.filter((u) => u.floor === Number(floor));
    for (const st of UNIT_STATUSES) take(onFloor, st, quota[st] ?? 0, `andar ${floor}`);
  }
  const min = counts.minAvailablePerTower ?? 0;
  for (const t of [...towers].sort((a, b) => a.code.localeCompare(b.code))) {
    const own = units.filter((u) => u.tower === t.code);
    const have = own.filter((u) => out.get(u.objectKey) === 'available').length;
    if (have < min) take(own, 'available', min - have, `bloco ${t.code}`);
  }
  const rest = free(units);
  for (const st of UNIT_STATUSES) {
    for (let i = 0; i < left[st]; i++) out.set(rest.shift()!.objectKey, st);
  }
  return out;
}

export interface SeedUnitRow {
  objectKey: string;
  code: string;
  floor: number;
  typeIndex: number;
  status: UnitStatus;
  price: number;
  facade: Facade;
  frontage: Frontage | null;
}

/** Linhas das unidades (sem SQL): tipo, status, preço e fachada de cada uma. */
export function seedUnits(
  tower: ModelTower,
  config: SeedConfig,
  statuses?: Map<string, UnitStatus>,
): SeedUnitRow[] {
  const claimed = new Set(config.unitTypes.flatMap((t) => t.floors ?? []));
  // Primeiro andar de cada tipo no bloco: o preço sobe a partir dele.
  const firstFloorOf = (t: UnitTypeConfig) =>
    Math.min(...(t.floors ?? tower.floors.filter((f) => !claimed.has(f))));
  return [...tower.units]
    .sort((a, b) => a.floor - b.floor || a.code.localeCompare(b.code))
    .map((u) => {
      const type = unitTypeFor(config.unitTypes, u.floor, u.code);
      // Pequena variação por unidade (padrão: até R$ 4.000), determinística.
      const steps = Math.floor((config.priceVariation ?? 4000) / 1000);
      const price =
        type.basePrice +
        (u.floor - firstFloorOf(type)) * (type.pricePerFloor ?? 0) +
        (type.floorPriceAdjust?.[String(u.floor)] ?? 0) +
        (steps > 0 ? (hash32(`${u.objectKey}|preço`) % (steps + 1)) * 1000 : 0);
      const facade = facadeOf(u.center, tower.center);
      return {
        objectKey: u.objectKey,
        code: u.code,
        floor: u.floor,
        typeIndex: config.unitTypes.indexOf(type),
        status: statuses?.get(u.objectKey) ?? statusFor(u.objectKey, config.statusWeights),
        price,
        facade,
        frontage: config.frontageByFacade?.[facade] ?? null,
      };
    });
}

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** SQL do seed (um bloco DO; não roda de novo se o slug já existir). */
export function buildSeedSql(towers: ModelTower[], config: SeedConfig, source: string): string {
  const types = config.unitTypes;
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  out(`-- Gerado por scripts/seed-from-model.ts a partir de ${source}.`);
  out(
    `-- ${config.headerNote ?? 'SOMENTE Supabase local. Não versionar (pasta ignorada pelo .gitignore).'}`,
  );
  for (const note of config.notes ?? []) out(note ? `-- ${note}` : '--');
  out('do $$');
  out('declare');
  out(`  v_org uuid := ${q(config.organizationId)};`);
  out('  v_dev uuid;');
  out('  v_tower uuid;');
  out('  v_floor uuid;');
  types.forEach((_, i) => out(`  v_type_${i} uuid;`));
  out('begin');
  out(`  if exists (select 1 from public.developments where slug = ${q(config.slug)}) then`);
  out('    return;');
  out('  end if;');
  out();
  out('  insert into public.developments');
  out(
    '    (organization_id, slug, name, status, price_display, model_path, detail_model_path, viewer_cameras)',
  );
  out(
    `  values (v_org, ${q(config.slug)}, ${q(config.name)}, ${q(config.status ?? 'published')}, ` +
      `${q(config.priceDisplay ?? 'from')}, ${q(config.modelPath)}, ` +
      `${config.detailModelPath ? q(config.detailModelPath) : 'null'}, ` +
      `${config.viewerCameras ? `${q(JSON.stringify(config.viewerCameras))}::jsonb` : 'null'})`,
  );
  out('  returning id into v_dev;');
  out();
  types.forEach((t, i) => {
    out(
      '  insert into public.unit_types (organization_id, development_id, name, area_m2, bedrooms, suites)',
    );
    out(
      `  values (v_org, v_dev, ${q(t.name)}, ${t.area_m2.toFixed(2)}, ${t.bedrooms}, ${t.suites ?? 'null'})`,
    );
    out(`  returning id into v_type_${i};`);
  });

  const statuses = config.statusCounts ? allocateStatuses(towers, config.statusCounts) : undefined;
  const sorted = [...towers].sort((a, b) => a.code.localeCompare(b.code));
  sorted.forEach((tower, ti) => {
    out();
    out(`  -- ${tower.code}`);
    const short = config.tower.shortName ? q(fill(config.tower.shortName, tower.code)) : 'null';
    out(
      '  insert into public.towers (organization_id, development_id, code, name, short_name, sort_order)',
    );
    out(
      `  values (v_org, v_dev, ${q(tower.code)}, ${q(fill(config.tower.name, tower.code))}, ${short}, ${ti + 1})`,
    );
    out('  returning id into v_tower;');
    const rows = seedUnits(tower, config, statuses);
    for (const floor of [...tower.floors].sort((a, b) => a - b)) {
      const label = config.floorLabels?.[String(floor)];
      const floorKey = `${tower.code}__F${String(floor).padStart(2, '0')}`;
      out(
        '  insert into public.floors (organization_id, development_id, tower_id, number, object_key, label)',
      );
      out(
        `  values (v_org, v_dev, v_tower, ${floor}, ${q(floorKey)}, ${label ? q(label) : 'null'})`,
      );
      out('  returning id into v_floor;');
      const floorRows = rows.filter((r) => r.floor === floor);
      if (floorRows.length === 0) continue;
      out('  insert into public.units (');
      out('    organization_id, development_id, tower_id, floor_id, unit_type_id,');
      out('    code, object_key, status, price, facade, frontage');
      out('  ) values');
      floorRows.forEach((r, i) => {
        out(
          `    (v_org, v_dev, v_tower, v_floor, v_type_${r.typeIndex}, ${q(r.code)}, ` +
            `${q(r.objectKey)}, ${q(r.status)}, ${r.price}, ${q(r.facade)}, ` +
            `${r.frontage ? q(r.frontage) : 'null'})` +
            (i === floorRows.length - 1 ? ';' : ','),
        );
      });
    }
  });
  // Interiores depois das unidades: o trigger confere se a unidade de referência existe.
  types.forEach((t, i) => {
    if (t.interior) {
      out();
      out(`  -- Interior: ${t.name}`);
      out('  update public.unit_types');
      out(`     set interior_model_path = ${q(t.interior.modelPath)},`);
      out(
        `         interior_detail_model_path = ${t.interior.detailModelPath ? q(t.interior.detailModelPath) : 'null'},`,
      );
      out(`         interior_reference_unit = ${q(t.interior.referenceUnit)}`);
      out(`   where id = v_type_${i};`);
    }
    if (t.rooms?.length) {
      out(
        '  insert into public.unit_type_rooms (organization_id, unit_type_id, name, area_m2, label_x, label_y, sort_order)',
      );
      out('  values');
      t.rooms.forEach((r, k) => {
        out(
          `    (v_org, v_type_${i}, ${q(r.name)}, ${r.area_m2}, ${r.label[0]}, ${r.label[1]}, ${k + 1})` +
            (k === t.rooms!.length - 1 ? ';' : ','),
        );
      });
    }
  });
  out('end;');
  out('$$;');
  return `${lines.join('\n')}\n`;
}
