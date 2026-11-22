/**
 * Torre × entorno de um GLB, pela projeção no chão (mesma regra do viewer: site.ts).
 * TODO(convenção): substituir pela convenção explícita (ex.: prefixo SITE__) quando existir.
 */
import { getBounds, type Document } from '@gltf-transform/core';
import { computeFloorLevels } from '@vidomo/viewer/floors';
import { parseObjectName } from '@vidomo/viewer/naming';
import { classifyZone, type Footprint, type ZoneOptions } from '@vidomo/viewer/site';
import { computeTowers } from '@vidomo/viewer/towers';

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

export interface ZoneContext {
  /** Projeção em planta de cada torre (TOWER__ e FLOOR__ dela). */
  footprints: Footprint[];
  options: ZoneOptions;
}

/** Projeções das torres e topo do primeiro andar, pelo modelo (leve). */
export function zoneContextOf(doc: Document): ZoneContext {
  const parts = meshNodes(doc).map((n) => {
    const parsed = parseObjectName(n.getName());
    return {
      kind: parsed?.kind ?? null,
      objectKey: parsed?.valid ? parsed.objectKey : null,
      box: boxOf(n),
    };
  });
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
    if (kind === 'unit' || kind === 'floor') continue;
    out[classifyZone(boxOf(n), ctx.footprints, ctx.options)].push(n.getName());
  }
  out.tower.sort();
  out.site.sort();
  return out;
}
