/** Unidades de teste da página pública (sem banco). */
import { withLinkCodes, type PublicUnit } from '@/lib/public-development';

type Base = Omit<PublicUnit, 'link_code'>;

const pad = (n: number) => String(n).padStart(2, '0');

/** Unidade do Residencial Vista (torre TA). */
export function vistaUnit(floor: number, pos: number, patch: Partial<Base> = {}): Base {
  return {
    object_key: `TA__F${pad(floor)}__U${floor * 100 + pos}`,
    code: String(floor * 100 + pos),
    tower_code: 'TA',
    tower_name: 'Torre A',
    tower_short_name: null,
    tower_sort_order: 0,
    floor_number: floor,
    floor_label: null,
    unit_type_name: 'Tipo A',
    area_m2: 58,
    bedrooms: 2,
    suites: 1,
    plan_image_path: null,
    facade: pos <= 2 ? 'norte' : 'sul',
    frontage: pos <= 2 ? 'frente' : 'fundos',
    status: 'available',
    price: 428000,
    price_kind: 'from',
    ...patch,
  };
}

/** Unidade de um condomínio de blocos (B01, B02…; F01 = Térreo). */
export function blockUnit(
  tower: number,
  floor: number,
  pos: number,
  patch: Partial<Base> = {},
): Base {
  const code = `B${pad(tower)}`;
  return vistaUnit(floor, pos, {
    object_key: `${code}__F${pad(floor)}__U${floor * 100 + pos}`,
    tower_code: code,
    tower_name: `Bloco ${pad(tower)}`,
    tower_short_name: pad(tower),
    tower_sort_order: tower,
    floor_label: floor === 1 ? 'Térreo' : null,
    facade: null,
    frontage: null,
    ...patch,
  });
}

/** Com o código de link calculado (como fetchPublicUnits). */
export const withLinks = (units: Base[]): PublicUnit[] => withLinkCodes(units);
