/**
 * Convenção de nomes 3D (CLAUDE.md). Módulo puro, sem three.js: usado pelo viewer
 * e pelos scripts de geração/validação de modelos (`@vidomo/viewer/naming`).
 *
 *   UNIT__TA__F08__U802   → kind 'unit',  objectKey 'TA__F08__U802'
 *   FLOOR__TA__F08        → kind 'floor', objectKey 'TA__F08'
 *   TOWER__TA             → kind 'tower', objectKey 'TA'
 *   AMENITY__PISCINA      → kind 'amenity'
 *   VIS__FACHADA_NORTE    → kind 'visual'
 */

export type ObjectKind = 'unit' | 'floor' | 'tower' | 'amenity' | 'visual';

export type ObjectKeyPrefixes = Record<ObjectKind, string>;

export const DEFAULT_OBJECT_KEY_PREFIXES: ObjectKeyPrefixes = {
  unit: 'UNIT__',
  floor: 'FLOOR__',
  tower: 'TOWER__',
  amenity: 'AMENITY__',
  visual: 'VIS__',
};

export interface ParsedObjectName {
  kind: ObjectKind;
  /** Nome sem o prefixo de tipo — é o object_key do banco. */
  objectKey: string;
  /** false quando o nome tem o prefixo mas não segue o formato do tipo. */
  valid: boolean;
}

const SEGMENT = '[A-Z0-9]+';
const KEY_PATTERNS: Record<ObjectKind, RegExp> = {
  unit: new RegExp(`^(${SEGMENT})__F(\\d{2,3})__U(${SEGMENT})$`),
  floor: new RegExp(`^(${SEGMENT})__F(\\d{2,3})$`),
  tower: new RegExp(`^(${SEGMENT})$`),
  amenity: /^[A-Z0-9_]+$/,
  visual: /^[A-Z0-9_]+$/,
};

/** Classifica o nome de um objeto do GLB. Retorna null se não tiver prefixo conhecido. */
export function parseObjectName(
  name: string,
  prefixes: ObjectKeyPrefixes = DEFAULT_OBJECT_KEY_PREFIXES,
): ParsedObjectName | null {
  for (const kind of Object.keys(prefixes) as ObjectKind[]) {
    const prefix = prefixes[kind];
    if (name.startsWith(prefix)) {
      const objectKey = name.slice(prefix.length);
      return { kind, objectKey, valid: KEY_PATTERNS[kind].test(objectKey) };
    }
  }
  return null;
}

export interface UnitKeyParts {
  tower: string;
  floor: number;
  code: string;
}

/** Decompõe um object_key de unidade (ex.: 'TA__F08__U802'). */
export function parseUnitKey(objectKey: string): UnitKeyParts | null {
  const m = KEY_PATTERNS.unit.exec(objectKey);
  if (!m) return null;
  return { tower: m[1]!, floor: Number(m[2]), code: m[3]! };
}

/** Decompõe um object_key de andar (ex.: 'TA__F08'). */
export function parseFloorKey(objectKey: string): { tower: string; floor: number } | null {
  const m = KEY_PATTERNS.floor.exec(objectKey);
  if (!m) return null;
  return { tower: m[1]!, floor: Number(m[2]) };
}

/** object_key do andar de uma unidade ('TA__F08__U802' → 'TA__F08'). */
export function floorKeyOfUnit(unitKey: string): string | null {
  const p = parseUnitKey(unitKey);
  return p ? floorObjectKey(p.tower, p.floor) : null;
}

/** Monta o object_key de unidade a partir das partes (andar com 2 dígitos). */
export function unitObjectKey(tower: string, floor: number, code: string | number): string {
  return `${tower}__F${String(floor).padStart(2, '0')}__U${code}`;
}

/** Monta o object_key de andar (ex.: 'TA__F08'). */
export function floorObjectKey(tower: string, floor: number): string {
  return `${tower}__F${String(floor).padStart(2, '0')}`;
}
