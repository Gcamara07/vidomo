/**
 * <ApartmentViewer> — "Ver apartamento": o interior detalhado de uma unidade, sozinho, com
 * etiquetas dos cômodos. Desacoplado do banco como o <Viewer> (regra 5): entrada = manifesto
 * (o mesmo do prédio) + object_key da unidade + cômodos; saída = eventos.
 *
 * - O GLB detalhado do tipo (manifest.interiors[tipo].detailUrl) só baixa aqui, ao abrir.
 * - Unidade espelhada ou girada aparece como ela é: o encaixe sai da caixa UNIT__ dela no
 *   GLB do prédio (já em cache na página), como no modo andar (fit.ts).
 * - Sem fotorrealismo: cores chapadas com sombreado simples gravado, contorno técnico, fundo
 *   Papel com grade milimetrada.
 * - Etiquetas em HTML sobre o canvas (nome em Inter, área em IBM Plex Mono, Nanquim com texto
 *   Papel), posicionadas a cada quadro sem se sobrepor nem sair da tela (labels.ts).
 * - Giro automático lento (autoRotate, controlado pelo app); arrastar gira, a pinça aproxima,
 *   com limites (sem pan, sempre visto de cima).
 */
import { OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Box3, DoubleSide, MeshBasicMaterial, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { mergeBatch } from './batch';
import { computeFraming } from './camera';
import { BatchEdges } from './edges';
import { applyFit } from './fit';
import { extractInterior, INTERIOR_CUT_HEIGHT, placeInterior, unitFitFromModel } from './interior';
import { layoutLabels } from './labels';
import { extractBuilding } from './scene-model';
import { BRAND, PAPER_BACKGROUND } from './styles';
import type { ViewerManifest } from './types';

/** Cômodo: nome, área (m²) e posição da etiqueta nas coordenadas do interior (Blender). */
export interface RoomLabel {
  name: string;
  area_m2: number;
  x: number;
  y: number;
}

export interface ApartmentViewerProps {
  /** O mesmo manifesto do prédio (modelo leve, interiores e tipo de cada unidade). */
  manifest: ViewerManifest;
  /** object_key da unidade (ex.: 'TA__F08__U802'). */
  unitKey: string;
  rooms: RoomLabel[];
  /** Giro automático lento (o app desliga com prefers-reduced-motion ou "Parar giro"). */
  autoRotate?: boolean;
  /** O comprador começou a arrastar ou aproximar (o app costuma parar o giro). */
  onInteract?: () => void;
  /** Modelo detalhado na tela. */
  onReady?: () => void;
  /** Falha (sem interior, GLB inacessível etc.). */
  onError?: (error: Error) => void;
  /** Texto da área de cada etiqueta (padrão: "20,9 m²"). */
  formatArea?: (m2: number) => string;
  className?: string;
  style?: CSSProperties;
}

/** Espaço que não quebra (entre o número e "m²"). */
const NBSP = String.fromCharCode(160);
const areaFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const defaultFormatArea = (m2: number) => `${areaFormat.format(m2)}${NBSP}m²`;

/** Altura das etiquetas sobre o piso (logo acima das paredes cortadas). */
const LABEL_HEIGHT = INTERIOR_CUT_HEIGHT + 0.15;

export function ApartmentViewer({
  manifest,
  unitKey,
  rooms,
  autoRotate = true,
  onInteract,
  onReady,
  onError,
  formatArea = defaultFormatArea,
  className,
  style,
}: ApartmentViewerProps) {
  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...PAPER_BACKGROUND,
        ...style,
      }}
    >
      <Canvas
        flat
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 35, near: 0.1, far: 200, position: [12, 14, 12] }}
        style={{ touchAction: 'none' }}
      >
        <Boundary onError={onError}>
          <Suspense fallback={null}>
            <Apartment
              manifest={manifest}
              unitKey={unitKey}
              rooms={rooms}
              autoRotate={autoRotate}
              onInteract={onInteract}
              onReady={onReady}
              labelEls={labelEls}
            />
          </Suspense>
        </Boundary>
      </Canvas>
      {/* Só visual: a lista acessível dos cômodos fica no app. */}
      <div aria-hidden style={LABELS_LAYER}>
        {rooms.map((r, i) => (
          <div
            key={r.name}
            ref={(el) => {
              labelEls.current[i] = el;
            }}
            style={LABEL_STYLE}
          >
            <span style={LABEL_NAME}>{r.name}</span>
            <span style={LABEL_AREA}>{formatArea(r.area_m2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Apartment({
  manifest,
  unitKey,
  rooms,
  autoRotate,
  onInteract,
  onReady,
  labelEls,
}: {
  manifest: ViewerManifest;
  unitKey: string;
  rooms: RoomLabel[];
  autoRotate: boolean;
  onInteract?: () => void;
  onReady?: () => void;
  labelEls: { current: (HTMLDivElement | null)[] };
}) {
  const typeKey = manifest.unitTypes?.[unitKey];
  const ref = typeKey ? manifest.interiors?.[typeKey] : undefined;
  if (!ref?.detailUrl) throw new Error(`a unidade ${unitKey} não tem interior detalhado`);

  // O prédio já está no cache do useGLTF (mesma URL da página); o interior baixa agora.
  const building = useGLTF(manifest.modelUrl, false, true);
  const detail = useGLTF(ref.detailUrl, false, true);
  const prefixesKey = JSON.stringify(manifest.objectKeyPrefixes ?? {});
  const placed = useMemo(() => {
    const model = extractBuilding(building.scene, manifest.objectKeyPrefixes);
    const found = unitFitFromModel(model, unitKey, ref.referenceUnit);
    if (!found) {
      console.warn(`[viewer] sem encaixe para ${unitKey}: mostrando o interior como modelado.`);
    }
    const matrix = found?.fit.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const geometry = placeInterior(extractInterior(detail.scene), matrix);
    // Centro da unidade na origem, piso em y = 0 (sem encaixe: o centro do próprio modelo).
    const rect = found?.rect;
    let offset: [number, number, number];
    if (rect) {
      offset = [-rect.center[0], -rect.base, -rect.center[1]];
    } else {
      const b = new Box3().setFromArray(geometry.solid.position);
      const c = b.getCenter(new Vector3());
      offset = [-c.x, -b.min.y, -c.z];
    }
    return { geometry, matrix, offset };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefixesKey cobre o objeto
  }, [building.scene, detail.scene, unitKey, ref.referenceUnit, prefixesKey]);

  const meshes = useMemo(() => {
    const solid = mergeBatch([
      { key: 'solid', arrays: placed.geometry.solid },
      { key: 'floor', arrays: placed.geometry.floor },
    ]);
    const glass = mergeBatch([{ key: 'glass', arrays: placed.geometry.glass }]);
    // Limites da câmera pelo apartamento inteiro (com a varanda).
    solid.geometry.computeBoundingBox();
    const b = solid.geometry.boundingBox!;
    const o = placed.offset;
    const bounds = {
      min: [b.min.x + o[0], b.min.y + o[1], b.min.z + o[2]] as [number, number, number],
      max: [b.max.x + o[0], b.max.y + o[1], b.max.z + o[2]] as [number, number, number],
    };
    return { solid, glass, bounds };
  }, [placed]);
  useEffect(
    () => () => {
      meshes.solid.geometry.dispose();
      meshes.glass.geometry.dispose();
    },
    [meshes],
  );

  const materials = useMemo(() => {
    const solid = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    solid.polygonOffset = true;
    solid.polygonOffsetFactor = 1;
    solid.polygonOffsetUnits = 1;
    const glass = new MeshBasicMaterial({
      color: '#A9CBD4',
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: DoubleSide,
    });
    return { solid, glass };
  }, []);
  useEffect(
    () => () => {
      materials.solid.dispose();
      materials.glass.dispose();
    },
    [materials],
  );

  // Pontos das etiquetas (mundo), pelo mesmo encaixe; Blender (x, y) → viewer (x, −y).
  const anchors = useMemo(
    () =>
      rooms.map((r) => {
        const p = applyFit(placed.matrix, [r.x, LABEL_HEIGHT, -r.y]);
        return new Vector3(p[0] + placed.offset[0], LABEL_HEIGHT, p[2] + placed.offset[2]);
      }),
    [rooms, placed],
  );

  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    const id = requestAnimationFrame(() => onReadyRef.current?.());
    return () => cancelAnimationFrame(id);
  }, [meshes]);

  return (
    <>
      <ApartmentCamera bounds={meshes.bounds} autoRotate={autoRotate} onInteract={onInteract} />
      <group position={placed.offset}>
        <mesh geometry={meshes.solid.geometry} material={materials.solid} />
        <BatchEdges positions={meshes.solid.edges} color={BRAND.musgo} clip={null} opacity={0.45} />
        <mesh geometry={meshes.glass.geometry} material={materials.glass} renderOrder={3} />
      </group>
      <RoomLabels anchors={anchors} rooms={rooms} labelEls={labelEls} />
    </>
  );
}

/** Câmera orbital: de cima, sem pan, com limites de distância (o comprador não se perde). */
function ApartmentCamera({
  bounds,
  autoRotate,
  onInteract,
}: {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  autoRotate: boolean;
  onInteract?: () => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const get = useThree((s) => s.get);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  // Enquadra ao abrir e quando a área muda (girar o celular, abrir a lista no desktop).
  useLayoutEffect(() => {
    const cam = get().camera as PerspectiveCamera;
    const aspect = Math.max(width, 1) / Math.max(height, 1);
    const f = computeFraming(bounds, cam.fov, aspect, undefined, 0.7);
    const target: [number, number, number] = [0, 0.4, 0];
    const dist = Math.hypot(...f.position.map((v, i) => v - f.target[i]!)) * 0.92;
    // 55° acima do horizonte.
    const el = (55 * Math.PI) / 180;
    cam.position.set(
      target[0] + Math.sin(0.7) * Math.cos(el) * dist,
      target[1] + Math.sin(el) * dist,
      target[2] + Math.cos(0.7) * Math.cos(el) * dist,
    );
    cam.near = Math.max(dist / 50, 0.05);
    cam.far = dist * 6;
    cam.updateProjectionMatrix();
    const c = controls.current;
    if (c) {
      c.target.set(...target);
      c.minDistance = dist * 0.45;
      c.maxDistance = dist * 1.6;
      c.update();
    }
    invalidate();
  }, [bounds, width, height, get, invalidate]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.1}
      enablePan={false}
      autoRotate={autoRotate}
      autoRotateSpeed={0.6}
      minPolarAngle={0.2}
      maxPolarAngle={1.2}
      onStart={onInteract}
    />
  );
}

/** Posiciona as etiquetas (HTML) a cada quadro desenhado: sem sobreposição, dentro da tela. */
function RoomLabels({
  anchors,
  rooms,
  labelEls,
}: {
  anchors: Vector3[];
  rooms: RoomLabel[];
  labelEls: { current: (HTMLDivElement | null)[] };
}) {
  const v = useMemo(() => new Vector3(), []);
  const invalidate = useThree((s) => s.invalidate);
  // Primeiro quadro com as etiquetas montadas.
  useEffect(() => invalidate(), [invalidate, anchors]);
  useFrame(({ camera, size }) => {
    const items = anchors.map((a, i) => {
      v.copy(a).project(camera);
      const el = labelEls.current[i];
      return {
        id: String(i),
        x: ((v.x + 1) / 2) * size.width,
        y: ((1 - v.y) / 2) * size.height,
        w: el?.offsetWidth ?? 0,
        h: el?.offsetHeight ?? 0,
        priority: rooms[i]?.area_m2 ?? 0,
        hidden: !el || v.z > 1 || v.z < -1,
      };
    });
    const placed = layoutLabels(items, { width: size.width, height: size.height });
    items.forEach((it, i) => {
      const el = labelEls.current[i];
      const p = placed.get(it.id);
      if (!el || !p) return;
      el.style.visibility = p.visible ? 'visible' : 'hidden';
      el.style.transform = `translate(${Math.round(p.left)}px, ${Math.round(p.top)}px)`;
    });
  });
  return null;
}

class Boundary extends Component<
  { onError?: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const LABELS_LAYER: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  overflow: 'hidden',
};

const LABEL_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  visibility: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 1,
  padding: '3px 7px',
  background: BRAND.nanquim,
  color: BRAND.papel,
  whiteSpace: 'nowrap',
  lineHeight: 1.15,
  willChange: 'transform',
};
// Fontes da página quando ela define as variáveis (--font-body, --font-mono); senão, pelo nome.
const LABEL_NAME: CSSProperties = {
  fontFamily: 'var(--font-body, Inter, system-ui, sans-serif)',
  fontSize: 12,
  fontWeight: 500,
};
const LABEL_AREA: CSSProperties = {
  fontFamily: 'var(--font-mono, "IBM Plex Mono", ui-monospace, monospace)',
  fontSize: 11,
  opacity: 0.85,
};
