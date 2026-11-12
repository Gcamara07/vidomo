/**
 * Comparação entre os objetos de um GLB e o cadastro do banco.
 * Semente da validação do RF-A08 (upload de modelo pelo admin).
 */
import { parseObjectName } from '@vidomo/viewer/naming';

/** Limite do CLAUDE.md: cena do edifício até 10 MB comprimida. */
export const MAX_MODEL_BYTES = 10 * 1024 * 1024;

export interface DbKeys {
  unitKeys: string[];
  floorKeys: string[];
}

export interface ModelReport {
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
  counts: { unitObjects: number; floorObjects: number; dbUnits: number; dbFloors: number };
  fileBytes: number;
  overSizeLimit: boolean;
  ok: boolean;
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

export function compareModel(objectNames: string[], db: DbKeys, fileBytes: number): ModelReport {
  const unitObjs = new Map<string, number>();
  const floorObjs = new Map<string, number>();
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
    const bucket = parsed.kind === 'unit' ? unitObjs : parsed.kind === 'floor' ? floorObjs : null;
    bucket?.set(parsed.objectKey, (bucket.get(parsed.objectKey) ?? 0) + 1);
  }

  const dbUnits = new Set(db.unitKeys);
  const dbFloors = new Set(db.floorKeys);
  const duplicateKeys = [...unitObjs, ...floorObjs].filter(([, n]) => n > 1).map(([k]) => k);

  const report: Omit<ModelReport, 'ok'> = {
    unitsWithoutObject: sorted(db.unitKeys.filter((k) => !unitObjs.has(k))),
    objectsWithoutUnit: sorted([...unitObjs.keys()].filter((k) => !dbUnits.has(k))),
    floorsWithoutObject: sorted(db.floorKeys.filter((k) => !floorObjs.has(k))),
    objectsWithoutFloor: sorted([...floorObjs.keys()].filter((k) => !dbFloors.has(k))),
    invalidNames: sorted(invalidNames),
    duplicateKeys: sorted(duplicateKeys),
    unprefixedNames: sorted(unprefixedNames),
    counts: {
      unitObjects: unitObjs.size,
      floorObjects: floorObjs.size,
      dbUnits: dbUnits.size,
      dbFloors: dbFloors.size,
    },
    fileBytes,
    overSizeLimit: fileBytes > MAX_MODEL_BYTES,
  };

  return {
    ...report,
    // Andares divergentes não bloqueiam (a seleção é por unidade); o resto sim.
    ok:
      report.unitsWithoutObject.length === 0 &&
      report.objectsWithoutUnit.length === 0 &&
      report.invalidNames.length === 0 &&
      report.duplicateKeys.length === 0 &&
      !report.overSizeLimit,
  };
}
