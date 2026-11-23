/**
 * Torre × entorno de um GLB, pela projeção no chão (mesma regra do viewer: site.ts).
 * TODO(convenção): substituir pela convenção explícita (ex.: prefixo SITE__) quando existir.
 */
import { getBounds, type Document } from '@gltf-transform/core';
import { computeFloorLevels } from '@vidomo/viewer/floors';
import { parseObjectName } from '@vidomo/viewer/naming';
import { classifyZone, type Footprint, type ZoneOptions } from '@vidomo/viewer/site';
import { computeAdjacency, computeTowers, type Point2 } from '@vidomo/viewer/towers';

type Vec3 = [number, number, number];

function meshNodes(doc: Document) {
  return doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh());
}

function boxOf(n: ReturnType<typeof meshNodes>[number]) {
  const b = getBounds(n);
  return { min: b.min as Vec3, max: b.max as Vec3 };
}

/** Vértices do objeto em planta (x, z), coordenadas de mundo. */
function planPoints(n: ReturnType<typeof meshNodes>[number]): Point2[] {
  const m = n.getWorldMatrix();
  const out: Point2[] = [];
  const v = [0, 0, 0];
  for (const prim of n.getMesh()!.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      out.push([
        m[0] * v[0]! + m[4] * v[1]! + m[8] * v[2]! + m[12],
        m[2] * v[0]! + m[6] * v[1]! + m[10] * v[2]! + m[14],
      ]);
    }
  }
  return out;
}

function towerParts(doc: Document) {
  return meshNodes(doc).map((n) => {
    const parsed = parseObjectName(n.getName());
    const kind = parsed?.kind ?? null;
    return {
      kind,
      objectKey: parsed?.valid ? parsed.objectKey : null,
      box: boxOf(n),
      // Forma em planta só de lajes e núcleos (como no viewer).
      points: kind === 'floor' || kind === 'tower' ? planPoints(n) : undefined,
    };
  });
}

/** Blocos colados (como o viewer calcula): pares "B01+B02", em ordem. */
export function towerPairsOf(doc: Document): string[] {
  const adjacency = computeAdjacency(computeTowers(towerParts(doc)));
  const pairs = new Set<string>();
  for (const [a, list] of adjacency) for (const b of list) pairs.add([a, b].sort().join('+'));
  return [...pairs].sort();
}

export interface ZoneContext {
  /** Projeção em planta de cada torre (TOWER__ e FLOOR__ dela). */
  footprints: Footprint[];
  options: ZoneOptions;
}

/** Projeções das torres e topo do primeiro andar, pelo modelo (leve). */
export function zoneContextOf(doc: Document): ZoneContext {
  const parts = towerParts(doc);
  const towers = computeTowers(parts);
  const slabs = parts
    .filter((p) => p.kind === 'floor' && p.objectKey)
    .map((p) => ({ objectKey: p.objectKey!, ...p.box }));
  const top = Math.max(0, ...parts.map((p) => p.box.max[1]));
  const levels = computeFloorLevels(slabs, top);
  return {
    footprints: [...towers.values()].map((t) => t.footprint),
    options: levels.length ? { spanMinTop: Math.min(...levels.map((l) => l.top)) } : {},
  };
}

/**
 * Classifica os objetos que o viewer recorta (ou não) no modo andar. Unidades e lajes
 * seguem a regra do andar e não entram na lista.
 */
export function classifyObjects(
  doc: Document,
  ctx: ZoneContext,
): { tower: string[]; site: string[] } {
  const out = { tower: [] as string[], site: [] as string[] };
  for (const n of meshNodes(doc)) {
    const kind = parseObjectName(n.getName())?.kind;
    if (kind === 'unit' || kind === 'floor' || kind === 'glass') continue;
    out[classifyZone(boxOf(n), ctx.footprints, ctx.options)].push(n.getName());
  }
  out.tower.sort();
  out.site.sort();
  return out;
}
