/**
 * Textos da ficha. O preço chega JÁ RESOLVIDO do banco (price, price_kind): aqui só se
 * formata — a regra de price_display nunca fica no front.
 */
import type { PublicUnit } from './public-development';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export interface PriceText {
  /** Ex.: "A partir de", ou null quando é o preço da unidade. */
  prefix: string | null;
  /** Ex.: "R$ 428.000" ou "Consulte condições". */
  value: string;
}

/** null = não mostrar preço nenhum (unidade vendida). */
export function priceText(
  u: Pick<PublicUnit, 'status' | 'price' | 'price_kind'>,
): PriceText | null {
  if (u.status === 'sold') return null;
  if (u.price === null || u.price_kind === null)
    return { prefix: null, value: 'Consulte condições' };
  return {
    prefix: u.price_kind === 'from' ? 'A partir de' : null,
    value: brl.format(u.price),
  };
}

/** "Face norte · frente", "Face sul · fundos", ou null se não houver dado. */
export function positionText(u: Pick<PublicUnit, 'facade' | 'frontage'>): string | null {
  const parts = [u.facade ? `Face ${u.facade}` : null, u.frontage].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Espaço que não quebra (entre o número e "m²"). */
const NBSP = String.fromCharCode(160);
const m2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Área em m² sem casas desnecessárias: "58 m²", "20,9 m²" (espaço que não quebra). */
export function areaText(value: number): string {
  return `${m2.format(value)}${NBSP}m²`;
}

/**
 * Título do "Ver apartamento": "Unidade 802 · 2 dormitórios (1 suíte) · 58 m²".
 * Com vários blocos, o bloco entra depois do código ("Unidade 201 do Bloco 09 · …").
 */
export function apartmentHeading(
  u: Pick<PublicUnit, 'code' | 'tower_name' | 'bedrooms' | 'suites' | 'area_m2'>,
  manyTowers = false,
): string {
  const parts = [`Unidade ${u.code}${manyTowers ? ` do ${u.tower_name}` : ''}`];
  if (u.bedrooms !== null) {
    const dorms = `${u.bedrooms} ${u.bedrooms === 1 ? 'dormitório' : 'dormitórios'}`;
    const suites = u.suites ? ` (${u.suites} ${u.suites === 1 ? 'suíte' : 'suítes'})` : '';
    parts.push(dorms + suites);
  }
  if (u.area_m2 !== null) parts.push(areaText(u.area_m2));
  return parts.join(' · ');
}
