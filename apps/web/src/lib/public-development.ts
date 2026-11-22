/**
 * Leitura pública de um empreendimento (regra 4): só pelas funções
 * public_development / public_development_units / public_contact.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  UNIT_STATUSES,
  type CameraPreset,
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
