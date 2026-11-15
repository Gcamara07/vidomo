/**
 * Torre × entorno de um GLB, pela projeção no chão (mesma regra do viewer: site.ts).
 * TODO(convenção): substituir pela convenção explícita (ex.: prefixo SITE__) quando existir.
 */
import { getBounds, type Document } from '@gltf-transform/core';
import { parseObjectName } from '@vidomo/viewer/naming';
import { classifyZone, towerFootprint, type Footprint } from '@vidomo/viewer/site';

type Vec3 = [number, number, number];

function meshNodes(doc: Document) {
  return doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh());
}

/** Projeção da torre: objetos TOWER__ e FLOOR__ do modelo (leve). */
export function footprintOf(doc: Document): Footprint | null {
  const boxes = meshNodes(doc)
    .filter((n) => {
      const kind = parseObjectName(n.getName())?.kind;
      return kind === 'tower' || kind === 'floor';
    })
    .map((n) => {
      const b = getBounds(n);
      return { min: b.min as Vec3, max: b.max as Vec3 };
    });
  return towerFootprint(boxes);
}

/**
 * Classifica os objetos que o viewer recorta (ou não) no modo andar. Unidades e lajes
 * seguem a regra do andar e não entram na lista.
 */
export function classifyObjects(
  doc: Document,
  footprint: Footprint | null,
): { tower: string[]; site: string[] } {
  const out = { tower: [] as string[], site: [] as string[] };
  for (const n of meshNodes(doc)) {
    const kind = parseObjectName(n.getName())?.kind;
    if (kind === 'unit' || kind === 'floor') continue;
    const b = getBounds(n);
    out[classifyZone({ min: b.min as Vec3, max: b.max as Vec3 }, footprint)].push(n.getName());
  }
  out.tower.sort();
  out.site.sort();
  return out;
}
