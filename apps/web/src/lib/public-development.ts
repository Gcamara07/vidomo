/**
 * Leitura pública de um empreendimento (regra 4): só pelas funções
 * public_development / public_development_units / public_development_unit_types /
 * public_contact.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  UNIT_STATUSES,
  type CameraPreset,
  type InteriorModelRef,
  type UnitStatus,
  type UnitStatusMap,
} from '@vidomo/viewer/types';
import { linkCodes } from './unit-ref';

export interface PublicDevelopment {
  slug: string;
  name: string;
  /** GLB leve (camada 1). */
  model_path: string | null;
  /** GLB de detalhes opcional (camada 2). */
  detail_model_path: string | null;
  /** Câmeras do viewer (manifest.cameras), ex.: a vista inicial do condomínio. */
  viewer_cameras: { default?: CameraPreset } | null;
}

export interface PublicUnit {
  object_key: string;
  code: string;
  /** Código da unidade nos links (?u=): calculado no app (unit-ref.ts → linkCodes). */
  link_code: string;
  tower_code: string;
  /** Nome do bloco (ex.: "Bloco 09", "Torre A"). */
  tower_name: string;
  /** Nome curto do bloco (ex.: "09"); null = o código. */
  tower_short_name: string | null;
  /** Ordem de exibição do bloco. */
  tower_sort_order: number;
  floor_number: number;
  /** Rótulo do andar (ex.: "Térreo"); null = "<número>º andar". */
  floor_label: string | null;
  unit_type_name: string | null;
  area_m2: number | null;
  bedrooms: number | null;
  suites: number | null;
  /** Caminho da planta 2D no bucket "plans" (null: planta ainda não disponível). */
  plan_image_path: string | null;
  facade: 'norte' | 'sul' | 'leste' | 'oeste' | null;
  frontage: 'frente' | 'fundos' | null;
  status: UnitStatus;
  /** Preço já resolvido no banco pela regra do empreendimento (null: não mostrar). */
  price: number | null;
  /** 'from' = "a partir de"; 'exact' = preço da unidade; null = "Consulte condições". */
  price_kind: 'from' | 'exact' | null;
}

/** Cômodo de um tipo de planta (etiqueta nas coordenadas do interior, como no Blender). */
export interface PublicRoom {
  name: string;
  area_m2: number;
  x: number;
  y: number;
}

/** Tipo de planta com interior e cômodos (public_development_unit_types). */
export interface PublicUnitType {
  name: string;
  area_m2: number;
  bedrooms: number;
  suites: number | null;
  /** GLB simples do interior (modo andar); null = tipo sem interior. */
  interior_model_path: string | null;
  /** GLB detalhado ("Ver apartamento"). */
  interior_detail_model_path: string | null;
  /** object_key da unidade de referência do interior. */
  interior_reference_unit: string | null;
  rooms: PublicRoom[];
}

export async function fetchPublicUnitTypes(
  client: SupabaseClient,
  slug: string,
): Promise<PublicUnitType[]> {
  const { data, error } = await client.rpc('public_development_unit_types', { p_slug: slug });
  if (error) throw new Error(`public_development_unit_types: ${error.message}`);
  return (data as PublicUnitType[]).map((t) => ({
    ...t,
    area_m2: Number(t.area_m2),
    rooms: (t.rooms ?? []).map((r) => ({
      name: r.name,
      area_m2: Number(r.area_m2),
      x: Number(r.x),
      y: Number(r.y),
    })),
  }));
}

/**
 * Interiores para o manifesto do viewer, por nome do tipo de planta (só tipos com
 * interior). `resolve` monta a URL do arquivo (getAssetUrl; o viewer não monta URLs).
 */
export function interiorRefs(
  types: PublicUnitType[],
  resolve: (path: string) => string,
): Record<string, InteriorModelRef> {
  const out: Record<string, InteriorModelRef> = {};
  for (const t of types) {
    if (!t.interior_model_path || !t.interior_reference_unit) continue;
    out[t.name] = {
      simpleUrl: resolve(t.interior_model_path),
      detailUrl: t.interior_detail_model_path ? resolve(t.interior_detail_model_path) : undefined,
      referenceUnit: t.interior_reference_unit,
    };
  }
  return out;
}

/** Tipo de planta de cada unidade (object_key → nome do tipo), para o manifesto. */
export function unitTypeMap(units: Pick<PublicUnit, 'object_key' | 'unit_type_name'>[]) {
  const out: Record<string, string> = {};
  for (const u of units) if (u.unit_type_name) out[u.object_key] = u.unit_type_name;
  return out;
}

export async function fetchPublicDevelopment(
  client: SupabaseClient,
  slug: string,
): Promise<PublicDevelopment | null> {
  const { data, error } = await client.rpc('public_development', { p_slug: slug });
  if (error) throw new Error(`public_development: ${error.message}`);
  return (data as PublicDevelopment[])[0] ?? null;
}

/** Contato comercial e texto de consentimento atual (public_contact). */
export interface PublicContact {
  organization_name: string;
  /** Só dígitos, com DDI (5516…); null = sem botão de WhatsApp. */
  whatsapp_number: string | null;
  /** null = página padrão /privacidade. */
  privacy_policy_url: string | null;
  consent_version: string;
  /** Texto já com o nome da incorporadora. */
  consent_text: string;
}

export async function fetchPublicContact(
  client: SupabaseClient,
  slug: string,
): Promise<PublicContact | null> {
  const { data, error } = await client.rpc('public_contact', { p_slug: slug });
  if (error) throw new Error(`public_contact: ${error.message}`);
  return (data as PublicContact[])[0] ?? null;
}

export async function fetchPublicUnits(
  client: SupabaseClient,
  slug: string,
): Promise<PublicUnit[]> {
  const { data, error } = await client.rpc('public_development_units', { p_slug: slug });
  if (error) throw new Error(`public_development_units: ${error.message}`);
  return withLinkCodes(
    (data as Omit<PublicUnit, 'link_code'>[]).map((u) => ({
      ...u,
      // numeric do Postgres pode chegar como string dependendo da configuração.
      area_m2: u.area_m2 === null ? null : Number(u.area_m2),
      price: u.price === null || u.price === undefined ? null : Number(u.price),
    })),
  );
}

/** Acrescenta o código de link de cada unidade (depende das outras do empreendimento). */
export function withLinkCodes<T extends Omit<PublicUnit, 'link_code'>>(
  units: T[],
): (T & { link_code: string })[] {
  const codes = linkCodes(units);
  return units.map((u) => ({ ...u, link_code: codes.get(u.object_key)! }));
}

export function toStatusMap(units: PublicUnit[]): UnitStatusMap {
  return Object.fromEntries(units.map((u) => [u.object_key, u.status]));
}

export function countByStatus(statusMap: UnitStatusMap): Record<UnitStatus, number> {
  const counts = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as Record<UnitStatus, number>;
  for (const s of Object.values(statusMap)) counts[s]++;
  return counts;
}

export function isUnitStatus(value: unknown): value is UnitStatus {
  return typeof value === 'string' && (UNIT_STATUSES as readonly string[]).includes(value);
}

/**
 * Aplica uma mensagem do Broadcast `unit_status` ao mapa.
 * Ignora mensagens malformadas e unidades que a página não conhece.
 * Devolve o mesmo objeto quando nada muda (evita re-render).
 */
export function applyStatusMessage(statusMap: UnitStatusMap, payload: unknown): UnitStatusMap {
  if (!payload || typeof payload !== 'object') return statusMap;
  const { object_key: key, status } = payload as { object_key?: unknown; status?: unknown };
  if (typeof key !== 'string' || !isUnitStatus(status)) return statusMap;
  if (!(key in statusMap) || statusMap[key] === status) return statusMap;
  return { ...statusMap, [key]: status };
}
