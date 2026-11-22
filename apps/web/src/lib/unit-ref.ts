/**
 * Como uma unidade, um bloco e um andar são nomeados para o comprador e nos links.
 * Tudo vem dos dados (regra 6): nome e nome curto do bloco, rótulo do andar.
 *
 * Código da unidade nos links (?u=): o próprio código quando ele não se repete no
 * empreendimento ("802"); senão "<código do bloco>-<código>" ("B09-201").
 * Mesma regra de private.unit_link_code (e-mail e webhook do lead).
 */
export interface UnitNaming {
  object_key: string;
  code: string;
  tower_code: string;
  tower_name: string;
  tower_short_name: string | null;
  floor_number: number;
  floor_label: string | null;
}

/** object_key → código do link. */
export function linkCodes(units: Pick<UnitNaming, 'object_key' | 'code' | 'tower_code'>[]) {
  const count = new Map<string, number>();
  for (const u of units) count.set(u.code, (count.get(u.code) ?? 0) + 1);
  return new Map(
    units.map((u) => [
      u.object_key,
      (count.get(u.code) ?? 0) > 1 ? `${u.tower_code}-${u.code}` : u.code,
    ]),
  );
}

/** Mais de um bloco no empreendimento. */
export function hasManyTowers(units: Pick<UnitNaming, 'tower_code'>[]): boolean {
  const first = units[0]?.tower_code;
  return units.some((u) => u.tower_code !== first);
}

/** Nome curto do bloco ("09"); sem cadastro, o código. */
export function towerShort(u: Pick<UnitNaming, 'tower_code' | 'tower_short_name'>): string {
  return u.tower_short_name ?? u.tower_code;
}

/** "Térreo" ou "8º andar". */
export function floorText(u: Pick<UnitNaming, 'floor_number' | 'floor_label'>): string {
  return u.floor_label ?? `${u.floor_number}º andar`;
}

/** Rótulo curto do andar para os chips: "Térreo" ou "8º". */
export function floorShort(u: Pick<UnitNaming, 'floor_number' | 'floor_label'>): string {
  return u.floor_label ?? `${u.floor_number}º`;
}

/**
 * Unidade numa frase ("apartamento 201 do Bloco 09"): com um bloco só, só o código, como
 * sempre foi ("apartamento 802").
 */
export function unitPhrase(u: Pick<UnitNaming, 'code' | 'tower_name'>, manyTowers: boolean) {
  return manyTowers ? `${u.code} do ${u.tower_name}` : u.code;
}

const norm = (s: string) => s.trim().toUpperCase();
const asNumber = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

/**
 * O bloco bate com o que veio no link? Aceita o código ("B09"), o nome curto ("09") e o
 * número sem zero à esquerda ("9" = "09").
 */
export function matchesTower(
  u: Pick<UnitNaming, 'tower_code' | 'tower_short_name'>,
  value: string,
): boolean {
  const v = norm(value);
  if (!v) return false;
  const names = [u.tower_code, u.tower_short_name].filter((x): x is string => !!x).map(norm);
  if (names.includes(v)) return true;
  const n = asNumber(v);
  return n !== null && names.some((x) => asNumber(x) === n);
}
