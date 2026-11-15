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
