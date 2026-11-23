/**
 * Comparação entre os objetos de um GLB e o cadastro do banco.
 * Semente da validação do RF-A08 (upload de modelo pelo admin).
 *
 * Duas camadas:
 *   base    GLB leve obrigatório (volumes das unidades, lajes, casca). Torna o prédio
 *           interativo: precisa ter todas as unidades. Meta de até 2 MB.
 *   detail  GLB de detalhes opcional, só visual (fachada, varandas, entorno). Não deve ter
 *           unidades — a seleção vem sempre do modelo leve.
 */
import { parseFloorKey, parseObjectName, parseUnitKey } from '@vidomo/viewer/naming';

/** Limite do CLAUDE.md: cena do edifício até 10 MB comprimida. */
export const MAX_MODEL_BYTES = 10 * 1024 * 1024;
/** Meta do modelo leve: acima disso, o prédio corre risco de passar de 5 s em 4G. */
export const BASE_MODEL_BUDGET_BYTES = 2 * 1024 * 1024;

export type ModelLayer = 'base' | 'detail';

export interface DbKeys {
  unitKeys: string[];
  floorKeys: string[];
}

/** Diferenças de um bloco (torre) entre o GLB e o banco. */
export interface TowerReport {
  tower: string;
  unitObjects: number;
  dbUnits: number;
  floorObjects: number;
  dbFloors: number;
  unitsWithoutObject: string[];
  objectsWithoutUnit: string[];
  floorsWithoutObject: string[];
  objectsWithoutFloor: string[];
  /** Bloco só no GLB ou só no banco. */
  missingIn: 'model' | 'db' | null;
  /** Sem unidade faltando ou sobrando (andares divergentes são aviso). */
  ok: boolean;
}

export interface ModelReport {
  layer: ModelLayer;
  unitsWithoutObject: string[];
  objectsWithoutUnit: string[];
  floorsWithoutObject: string[];
  objectsWithoutFloor: string[];
  /** Nomes com prefixo conhecido mas fora do formato (ex.: 'UNIT__TA__F8__U802', '….001'). */
  invalidNames: string[];
  /** object_keys que aparecem em mais de um objeto. */
  duplicateKeys: string[];
  /** Objetos sem prefixo de tipo (aviso; o viewer os trata como visuais). */
  unprefixedNames: string[];
  /**
   * Vidros da fachada (VIDRO__<unidade>): só com pelo menos um no modelo. Unidade sem vidro
   * continua como caixa colorida (aviso); vidro sem unidade é ignorado pelo viewer (aviso).
   */
  glassObjects: number;
  unitsWithoutGlass: string[];
  glassWithoutUnit: string[];
  /** Áreas comuns (AMENITY__) encontradas. Por enquanto só visuais; o toque para abrir
   *  panoramas vem depois. */
  amenities: string[];
  counts: { unitObjects: number; floorObjects: number; dbUnits: number; dbFloors: number };
  fileBytes: number;
  /** Erro: acima de 10 MB. */
  overSizeLimit: boolean;
  /** Aviso (só camada base): acima de 2 MB. */
  overBaseBudget: boolean;
  /** Avisos que não bloqueiam. */
  warnings: string[];
  /** Por bloco, em ordem de código (camada base). */
  towers: TowerReport[];
  ok: boolean;
}

const towerOfKey = (key: string) => parseUnitKey(key)?.tower ?? parseFloorKey(key)?.tower ?? null;

/** Agrupa as listas da comparação por bloco (o código vem do object_key). */
export function compareByTower(
  unitObjects: Iterable<string>,
  floorObjects: Iterable<string>,
  db: DbKeys,
): TowerReport[] {
  const sets = {
    unitObjects: new Set(unitObjects),
    floorObjects: new Set(floorObjects),
    dbUnits: new Set(db.unitKeys),
    dbFloors: new Set(db.floorKeys),
  };
  const towers = new Set<string>();
  for (const set of Object.values(sets)) {
    for (const k of set) {
      const t = towerOfKey(k);
      if (t) towers.add(t);
    }
  }
  const of = (set: Set<string>, tower: string) => [...set].filter((k) => towerOfKey(k) === tower);
  return [...towers].sort().map((tower) => {
    const uo = of(sets.unitObjects, tower);
    const fo = of(sets.floorObjects, tower);
    const du = of(sets.dbUnits, tower);
    const df = of(sets.dbFloors, tower);
    const r = {
      tower,
      unitObjects: uo.length,
      dbUnits: du.length,
      floorObjects: fo.length,
      dbFloors: df.length,
      unitsWithoutObject: sorted(du.filter((k) => !sets.unitObjects.has(k))),
      objectsWithoutUnit: sorted(uo.filter((k) => !sets.dbUnits.has(k))),
      floorsWithoutObject: sorted(df.filter((k) => !sets.floorObjects.has(k))),
      objectsWithoutFloor: sorted(fo.filter((k) => !sets.dbFloors.has(k))),
      missingIn: uo.length + fo.length === 0 ? 'model' : du.length + df.length === 0 ? 'db' : null,
    } satisfies Omit<TowerReport, 'ok'>;
    return {
      ...r,
      ok: r.unitsWithoutObject.length === 0 && r.objectsWithoutUnit.length === 0,
    };
  });
}

const sorted = (xs: Iterable<string>) => [...xs].sort();
const mb = (b: number) => (b / 1024 / 1024).toFixed(2);

export function compareModel(
  objectNames: string[],
  db: DbKeys,
  fileBytes: number,
  layer: ModelLayer = 'base',
): ModelReport {
  const unitObjs = new Map<string, number>();
  const amenities: string[] = [];
  const floorObjs = new Map<string, number>();
  const glassObjs = new Map<string, number>();
  const invalidNames: string[] = [];
  const unprefixedNames: string[] = [];

  for (const name of objectNames) {
    const parsed = parseObjectName(name);
    if (!parsed) {
      unprefixedNames.push(name);
      continue;
    }
    if (!parsed.valid) {
      invalidNames.push(name);
      continue;
    }
    if (parsed.kind === 'amenity') amenities.push(parsed.objectKey);
    const bucket =
      parsed.kind === 'unit'
        ? unitObjs
        : parsed.kind === 'floor'
          ? floorObjs
          : parsed.kind === 'glass'
            ? glassObjs
            : null;
    bucket?.set(parsed.objectKey, (bucket.get(parsed.objectKey) ?? 0) + 1);
  }

  const dbUnits = new Set(db.unitKeys);
  const dbFloors = new Set(db.floorKeys);
  const duplicateKeys = [
    ...unitObjs,
    ...floorObjs,
    ...[...glassObjs].map(([k, n]) => [`VIDRO__${k}`, n] as const),
  ]
    .filter(([, n]) => n > 1)
    .map(([k]) => k);
  const hasGlass = glassObjs.size > 0;
  const unitsWithoutGlass = hasGlass
    ? sorted([...unitObjs.keys()].filter((k) => !glassObjs.has(k)))
    : [];
  const glassWithoutUnit = sorted([...glassObjs.keys()].filter((k) => !unitObjs.has(k)));
  const isBase = layer === 'base';
  const overBaseBudget = isBase && fileBytes > BASE_MODEL_BUDGET_BYTES;
  const warnings: string[] = [];

  if (overBaseBudget) {
    warnings.push(
      `Modelo leve com ${mb(fileBytes)} MB (meta: ${mb(BASE_MODEL_BUDGET_BYTES)} MB). ` +
        'Mova fachada, varandas e entorno para o modelo de detalhes.',
    );
  }
  if (unitsWithoutGlass.length) {
    warnings.push(
      `${unitsWithoutGlass.length} unidade(s) sem VIDRO__: aparecem como caixa colorida, sem ` +
        'status nas janelas.',
    );
  }
  if (glassWithoutUnit.length) {
    warnings.push(
      `${glassWithoutUnit.length} VIDRO__ sem UNIT__ correspondente neste modelo: o viewer os ignora.`,
    );
  }
  if (!isBase && unitObjs.size > 0) {
    warnings.push(
      `O modelo de detalhes tem ${unitObjs.size} objetos UNIT__; o viewer os ignora ` +
        '(a seleção vem do modelo leve).',
    );
  }

  const report: Omit<ModelReport, 'ok'> = {
    layer,
    // Na camada de detalhes, unidades e andares não precisam bater com o banco.
    unitsWithoutObject: isBase ? sorted(db.unitKeys.filter((k) => !unitObjs.has(k))) : [],
    objectsWithoutUnit: isBase ? sorted([...unitObjs.keys()].filter((k) => !dbUnits.has(k))) : [],
    floorsWithoutObject: isBase ? sorted(db.floorKeys.filter((k) => !floorObjs.has(k))) : [],
    objectsWithoutFloor: isBase
      ? sorted([...floorObjs.keys()].filter((k) => !dbFloors.has(k)))
      : [],
    invalidNames: sorted(invalidNames),
    duplicateKeys: sorted(duplicateKeys),
    unprefixedNames: sorted(unprefixedNames),
    glassObjects: glassObjs.size,
    unitsWithoutGlass,
    glassWithoutUnit,
    amenities: sorted(amenities),
    counts: {
      unitObjects: unitObjs.size,
      floorObjects: floorObjs.size,
      dbUnits: dbUnits.size,
      dbFloors: dbFloors.size,
    },
    fileBytes,
    overSizeLimit: fileBytes > MAX_MODEL_BYTES,
    overBaseBudget,
    warnings,
    towers: isBase ? compareByTower(unitObjs.keys(), floorObjs.keys(), db) : [],
  };

  return {
    ...report,
    // Andares divergentes e o orçamento de 2 MB são avisos; o resto bloqueia.
    ok:
      report.unitsWithoutObject.length === 0 &&
      report.objectsWithoutUnit.length === 0 &&
      report.invalidNames.length === 0 &&
      report.duplicateKeys.length === 0 &&
      !report.overSizeLimit,
  };
}
