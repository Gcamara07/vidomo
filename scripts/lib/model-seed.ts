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
  /** Preço no 1º andar do tipo; cada andar acima soma pricePerFloor. */
  basePrice: number;
  pricePerFloor?: number;
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
}

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

export function unitTypeFor(types: UnitTypeConfig[], floor: number): UnitTypeConfig {
  const t = types.find((u) => u.floors?.includes(floor)) ?? types.find((u) => !u.floors);
  if (!t) throw new Error(`Nenhum tipo de planta para o andar ${floor}.`);
  return t;
}

export interface SeedUnitRow {
  objectKey: string;
  code: string;
  floor: number;
  typeIndex: number;
  status: UnitStatus;
  price: number;
  facade: Facade;
}

/** Linhas das unidades (sem SQL): tipo, status, preço e fachada de cada uma. */
export function seedUnits(tower: ModelTower, config: SeedConfig): SeedUnitRow[] {
  const claimed = new Set(config.unitTypes.flatMap((t) => t.floors ?? []));
  // Primeiro andar de cada tipo no bloco: o preço sobe a partir dele.
  const firstFloorOf = (t: UnitTypeConfig) =>
    Math.min(...(t.floors ?? tower.floors.filter((f) => !claimed.has(f))));
  return [...tower.units]
    .sort((a, b) => a.floor - b.floor || a.code.localeCompare(b.code))
    .map((u) => {
      const type = unitTypeFor(config.unitTypes, u.floor);
      // Pequena variação por unidade (até R$ 4.000), determinística.
      const price =
        type.basePrice +
        (u.floor - firstFloorOf(type)) * (type.pricePerFloor ?? 0) +
        (hash32(`${u.objectKey}|preço`) % 5) * 1000;
      return {
        objectKey: u.objectKey,
        code: u.code,
        floor: u.floor,
        typeIndex: config.unitTypes.indexOf(type),
        status: statusFor(u.objectKey, config.statusWeights),
        price,
        facade: facadeOf(u.center, tower.center),
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
  out('-- SOMENTE Supabase local. Não versionar (pasta ignorada pelo .gitignore).');
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
    const rows = seedUnits(tower, config);
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
            `${q(r.objectKey)}, ${q(r.status)}, ${r.price}, ${q(r.facade)}, null)` +
            (i === floorRows.length - 1 ? ';' : ','),
        );
      });
    }
  });
  out('end;');
  out('$$;');
  return `${lines.join('\n')}\n`;
}
