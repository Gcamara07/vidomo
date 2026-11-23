/**
 * Encaixe dos interiores por unidade, para o validador (`pnpm model:validate`): o mesmo
 * cálculo do viewer (@vidomo/viewer/fit), a partir das caixas UNIT__ e das lajes FLOOR__ do
 * GLB leve e dos tipos de planta do banco.
 */
import type { Document } from '@gltf-transform/core';
import {
  describeFit,
  exteriorSides,
  fitInterior,
  planTriangles,
  rectFromPositions,
  type FitSubject,
} from '@vidomo/viewer/fit';
import { floorKeyOfUnit, parseObjectName } from '@vidomo/viewer/naming';

/** Vértices (x, y, z; 3 por triângulo) em coordenadas de mundo, por object_key. */
export interface ModelGeometry {
  units: Map<string, Float32Array>;
  floors: Map<string, Float32Array>;
}

export interface InteriorType {
  name: string;
  /** object_key da unidade de referência; null = tipo sem interior. */
  referenceUnit: string | null;
}

export interface UnitFitRow {
  unit: string;
  type: string;
  /** Ex.: "0°", "espelho Y + 0°"; null quando não deu para calcular. */
  transform: string | null;
  fits: boolean;
  deviation: number | null;
  ambiguous: boolean;
}

export interface InteriorFitReport {
  rows: UnitFitRow[];
  /** Erros que impedem o encaixe (ex.: unidade de referência fora do GLB). */
  errors: string[];
  warnings: string[];
}

/** Triângulos de cada UNIT__ e FLOOR__ do GLB, já com a transformação do nó. */
export function modelGeometry(doc: Document): ModelGeometry {
  const out: ModelGeometry = { units: new Map(), floors: new Map() };
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const parsed = parseObjectName(node.getName());
    if (!mesh || !parsed?.valid || (parsed.kind !== 'unit' && parsed.kind !== 'floor')) continue;
    const m = node.getWorldMatrix();
    const pts: number[] = [];
    const v = [0, 0, 0];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i < n; i++) {
        pos.getElement(idx ? idx.getScalar(i) : i, v);
        const [x, y, z] = v as [number, number, number];
        pts.push(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        );
      }
    }
    (parsed.kind === 'unit' ? out.units : out.floors).set(parsed.objectKey, new Float32Array(pts));
  }
  return out;
}

function subjectOf(geo: ModelGeometry, unitKey: string): FitSubject | null {
  const unit = geo.units.get(unitKey);
  const fk = floorKeyOfUnit(unitKey);
  const slab = fk ? geo.floors.get(fk) : undefined;
  if (!unit || !slab) return null;
  const rect = rectFromPositions(unit);
  return { rect, exterior: exteriorSides(rect, planTriangles(slab)) };
}

/**
 * Por unidade com tipo de planta que tem interior: transformação escolhida, se cabe na
 * caixa (5 cm) e se é ambígua. Unidade de referência fora do GLB é erro.
 */
export function interiorFitReport(
  geo: ModelGeometry,
  units: { objectKey: string; type: string | null }[],
  types: InteriorType[],
): InteriorFitReport {
  const report: InteriorFitReport = { rows: [], errors: [], warnings: [] };
  const refs = new Map<string, FitSubject | null>();
  for (const t of types) {
    if (!t.referenceUnit) continue;
    const s = subjectOf(geo, t.referenceUnit);
    refs.set(t.name, s);
    if (!s) {
      report.errors.push(
        `Tipo "${t.name}": a unidade de referência ${t.referenceUnit} não está no GLB do ` +
          `prédio (UNIT__${t.referenceUnit} com a laje FLOOR__ do andar). Sem ela, o interior ` +
          'não encaixa em nenhuma unidade do tipo.',
      );
      continue;
    }
    const refUnit = units.find((u) => u.objectKey === t.referenceUnit);
    if (refUnit && refUnit.type !== t.name) {
      report.warnings.push(
        `Tipo "${t.name}": a unidade de referência ${t.referenceUnit} está cadastrada como ` +
          `"${refUnit.type ?? 'sem tipo'}".`,
      );
    }
  }
  for (const u of units) {
    if (!u.type || !refs.has(u.type)) continue;
    const ref = refs.get(u.type);
    const target = subjectOf(geo, u.objectKey);
    if (!ref || !target) {
      report.rows.push({
        unit: u.objectKey,
        type: u.type,
        transform: null,
        fits: false,
        deviation: null,
        ambiguous: false,
      });
      continue;
    }
    const fit = fitInterior(ref, target);
    report.rows.push({
      unit: u.objectKey,
      type: u.type,
      transform: describeFit(fit.transform),
      fits: fit.fits,
      deviation: fit.deviation,
      ambiguous: fit.ambiguous,
    });
  }
  report.rows.sort((a, b) => a.unit.localeCompare(b.unit, 'en', { numeric: true }));
  return report;
}
