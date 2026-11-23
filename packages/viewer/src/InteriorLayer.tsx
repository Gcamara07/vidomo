/**
 * Maquetes do andar ativo (modo andar): interiores encaixados, em lotes.
 *
 * Draw calls (todas as unidades do andar juntas): 1 para paredes, corte e móveis (cores por
 * vértice), 1 para o contorno deles, 1 para os vidros, 1 por tom de piso (status presentes) e
 * 1 por cor de faixa de status; a selecionada soma a linha Nanquim. Mudar um status só refaz
 * o lote de piso e o de faixa envolvidos, sem recarregar nada.
 *
 * Só visual: não recebe toque. O toque continua nas caixas UNIT__ (invisíveis no andar).
 */
import { forwardRef, memo, useEffect, useMemo } from 'react';
import { DoubleSide, MeshBasicMaterial, type Group, type Material } from 'three';
import { groupBatches, mergeBatch, type BatchItem, type UnitClass } from './batch';
import { BatchEdges } from './edges';
import type { PlanRect } from './fit';
import { statusBand, type InteriorUnitGeometry } from './interior';
import type { ViewerMaterials } from './materials';
import { BRAND, INTERIOR_BAND } from './styles';
import type { UnitStatus } from './types';

export interface InteriorUnit {
  key: string;
  cls: UnitClass;
  status: UnitStatus | undefined;
  rect: PlanRect;
  geometry: InteriorUnitGeometry;
}

const noRaycast = () => null;

/** Tom do piso: status (as hachuras também), ou null = piso neutro (esmaecida). */
function floorTone(u: InteriorUnit): UnitStatus | null {
  if (u.cls === 'filtered') return null;
  if (u.cls === 'nostatus') return 'unavailable';
  if (u.cls === 'selected') return u.status ?? 'unavailable';
  return u.cls.startsWith('status:') ? (u.cls.slice(7) as UnitStatus) : 'unavailable';
}

function bandTone(u: InteriorUnit): keyof typeof INTERIOR_BAND {
  if (u.cls === 'selected') return 'selected';
  if (u.cls === 'filtered') return 'filtered';
  if (u.cls.startsWith('status:')) return u.cls.slice(7) as UnitStatus;
  return 'unavailable';
}

function MergedMesh({
  signature,
  items,
  material,
  renderOrder = 0,
}: {
  signature: string;
  items: BatchItem[];
  material: Material;
  renderOrder?: number;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura cobre os itens
  const merged = useMemo(() => mergeBatch(items), [signature]);
  useEffect(() => () => merged.geometry.dispose(), [merged]);
  return (
    <mesh
      geometry={merged.geometry}
      material={material}
      raycast={noRaycast}
      renderOrder={renderOrder}
    />
  );
}

export const InteriorLayer = memo(
  forwardRef<Group, { units: InteriorUnit[]; materials: ViewerMaterials }>(function InteriorLayer(
    { units, materials },
    ref,
  ) {
    const own = useMemo(() => {
      const solid = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
      solid.polygonOffset = true;
      solid.polygonOffsetFactor = 1;
      solid.polygonOffsetUnits = 1;
      solid.name = 'vidomo_interior';
      const glass = new MeshBasicMaterial({
        color: '#A9CBD4',
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: DoubleSide,
      });
      glass.name = 'vidomo_interior_glass';
      const band = Object.fromEntries(
        Object.entries(INTERIOR_BAND).map(([k, color]) => {
          const m = new MeshBasicMaterial({ color, side: DoubleSide });
          m.name = `vidomo_band_${k}`;
          return [k, m];
        }),
      ) as Record<keyof typeof INTERIOR_BAND, MeshBasicMaterial>;
      return { solid, glass, band };
    }, []);
    useEffect(
      () => () => {
        own.solid.dispose();
        own.glass.dispose();
        for (const m of Object.values(own.band)) m.dispose();
      },
      [own],
    );

    // Paredes e móveis (+ piso neutro das esmaecidas): um lote.
    const solid = useMemo(() => {
      const items: BatchItem[] = [];
      for (const u of units) {
        items.push({ key: u.key, arrays: u.geometry.solid });
        if (floorTone(u) === null) items.push({ key: `${u.key}~piso`, arrays: u.geometry.floor });
      }
      return { items, signature: items.map((i) => i.key).join('|') };
    }, [units]);
    const edges = useMemo(() => {
      const n = units.reduce((t, u) => t + u.geometry.solid.edges.length, 0);
      const out = new Float32Array(n);
      let o = 0;
      for (const u of units) {
        out.set(u.geometry.solid.edges, o);
        o += u.geometry.solid.edges.length;
      }
      return out;
    }, [units]);
    const glass = useMemo(() => {
      const items = units.map((u) => ({ key: u.key, arrays: u.geometry.glass }));
      return { items, signature: items.map((i) => i.key).join('|') };
    }, [units]);
    const floors = useMemo(
      () =>
        groupBatches(
          units.map((u) => ({ key: u.key, unit: u, arrays: u.geometry.floor })),
          (it) => floorTone(it.unit),
        ),
      [units],
    );
    const bands = useMemo(
      () =>
        groupBatches(
          units.map((u) => ({
            key: u.key,
            unit: u,
            ...statusBand(u.rect, u.cls === 'selected'),
          })),
          (it) => bandTone(it.unit),
        ),
      [units],
    );
    const selectedOutline = useMemo(() => {
      const sel = units.find((u) => u.cls === 'selected');
      return sel ? statusBand(sel.rect, true).outline : null;
    }, [units]);

    return (
      <group ref={ref} visible={false}>
        {solid.items.length > 0 && (
          <MergedMesh signature={solid.signature} items={solid.items} material={own.solid} />
        )}
        {edges.length > 0 && (
          <BatchEdges positions={edges} color={BRAND.musgo} clip={null} opacity={0.4} />
        )}
        {[...floors].map(([tone, b]) => (
          <MergedMesh
            key={tone}
            signature={`${tone}|${b.signature}`}
            items={b.items}
            material={materials.status[tone as UnitStatus]}
          />
        ))}
        {[...bands].map(([tone, b]) => (
          <MergedMesh
            key={tone}
            signature={`${tone}|${b.signature}`}
            items={b.items}
            material={own.band[tone as keyof typeof INTERIOR_BAND]}
          />
        ))}
        {selectedOutline && (
          <BatchEdges positions={selectedOutline} color={BRAND.nanquim} clip={null} width={3} />
        )}
        {glass.items.length > 0 && (
          <MergedMesh
            signature={glass.signature}
            items={glass.items}
            material={own.glass}
            renderOrder={3}
          />
        )}
      </group>
    );
  }),
);
