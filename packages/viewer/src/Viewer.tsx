/**
 * <Viewer> — visualizador 3D desacoplado (regra 5 do CLAUDE.md).
 * Entrada: manifesto + mapa de status. Saída: eventos. Não conhece Supabase nem o banco.
 *
 * Desempenho: frameloop "demand" (só desenha quando algo muda), dpr limitado a 2,
 * MeshBasicMaterial sem luzes, sem sombras e sem pós-processamento.
 */
import { Edges, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  Component,
  Suspense,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Material, PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { clampToBounds, computeFraming } from './camera';
import { createViewerMaterials, type ViewerMaterials } from './materials';
import { extractBuilding, type ScenePart } from './scene-model';
import { BRAND, PAPER_BACKGROUND, unitAppearance } from './styles';
import type { UnitStatus, UnitStatusMap, Vec3, ViewerManifest } from './types';

export interface ViewerProps {
  manifest: ViewerManifest;
  unitStatus: UnitStatusMap;
  /** object_key da unidade selecionada (controlado pelo app). */
  selectedUnit?: string | null;
  /** Toque/clique numa unidade (object_key) ou fora delas (null). */
  onSelectUnit?: (objectKey: string | null) => void;
  /** Modelo carregado e primeira cena montada. */
  onReady?: () => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
  // TODO(modos): onSelectFloor / onModeChange (modo andar) e onCameraChange para estado
  // serializável de câmera — fora desta fatia.
}

/** Deslocamento máximo (px) entre apertar e soltar para contar como toque, não arrasto. */
const TAP_TOLERANCE_PX = 8;

export function Viewer({
  manifest,
  unitStatus,
  selectedUnit = null,
  onSelectUnit,
  onReady,
  onError,
  className,
  style,
}: ViewerProps) {
  const pointerDown = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className={className}
      // Ocupa o contêiner; posição fica a cargo do app (className/style).
      style={{ width: '100%', height: '100%', overflow: 'hidden', ...PAPER_BACKGROUND, ...style }}
      onPointerDown={(e) => {
        pointerDown.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <Canvas
        flat
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 40, near: 0.5, far: 2000, position: [60, 40, 60] }}
        style={{ touchAction: 'none' }}
        onPointerMissed={(e) => {
          const d = pointerDown.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_TOLERANCE_PX) {
            onSelectUnit?.(null);
          }
        }}
      >
        <ErrorBoundary onError={onError}>
          <Suspense fallback={null}>
            <Building
              manifest={manifest}
              unitStatus={unitStatus}
              selectedUnit={selectedUnit}
              onSelectUnit={onSelectUnit}
              onReady={onReady}
            />
          </Suspense>
        </ErrorBoundary>
      </Canvas>
    </div>
  );
}

/** Pré-carrega o GLB (ex.: enquanto a página busca os status). */
export function preloadModel(url: string) {
  useGLTF.preload(url, false, true);
}

interface BuildingProps {
  manifest: ViewerManifest;
  unitStatus: UnitStatusMap;
  selectedUnit: string | null;
  onSelectUnit?: (objectKey: string | null) => void;
  onReady?: () => void;
}

function Building({ manifest, unitStatus, selectedUnit, onSelectUnit, onReady }: BuildingProps) {
  // useDraco = false (não usamos Draco; evita baixar o decoder), useMeshopt = true.
  const gltf = useGLTF(manifest.modelUrl, false, true);
  const prefixesKey = JSON.stringify(manifest.objectKeyPrefixes ?? {});
  const model = useMemo(
    () => extractBuilding(gltf.scene, manifest.objectKeyPrefixes),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefixesKey cobre o objeto
    [gltf.scene, prefixesKey],
  );

  const gl = useThree((s) => s.gl);
  const materials = useMemo(
    () => createViewerMaterials(Math.min(4, gl.capabilities.getMaxAnisotropy())),
    [gl],
  );
  useEffect(() => () => materials.dispose(), [materials]);

  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    // Depois do commit; o próximo frame já desenha o prédio.
    const id = requestAnimationFrame(() => onReadyRef.current?.());
    return () => cancelAnimationFrame(id);
  }, [model]);

  const bounds = useMemo(
    () => ({
      min: model.bounds.min.toArray() as Vec3,
      max: model.bounds.max.toArray() as Vec3,
    }),
    [model],
  );

  return (
    <>
      <CameraRig bounds={bounds} manifest={manifest} />
      {model.structure.map((part, i) => (
        <StaticPart key={`s${i}`} part={part} material={materials.structure} />
      ))}
      {model.floors.map((part, i) => (
        <StaticPart key={`f${i}`} part={part} material={materials.slab} />
      ))}
      {model.units.map((part) => (
        <UnitMesh
          key={part.objectKey!}
          part={part}
          status={unitStatus[part.objectKey!]}
          selected={part.objectKey === selectedUnit}
          materials={materials}
          onSelectUnit={onSelectUnit}
        />
      ))}
    </>
  );
}

const stop = (e: ThreeEvent<MouseEvent>) => e.stopPropagation();

/** Estrutura e lajes: traço técnico, não selecionáveis, mas tapam o que está atrás. */
const StaticPart = memo(function StaticPart({
  part,
  material,
}: {
  part: ScenePart;
  material: Material;
}) {
  return (
    <mesh
      geometry={part.geometry}
      matrix={part.matrix}
      matrixAutoUpdate={false}
      material={material}
      onClick={stop}
    >
      <Edges color={BRAND.musgo} lineWidth={1} threshold={15} />
    </mesh>
  );
});

interface UnitMeshProps {
  part: ScenePart;
  /** undefined = unidade do modelo sem status informado: aparece como indisponível e não é selecionável. */
  status: UnitStatus | undefined;
  selected: boolean;
  materials: ViewerMaterials;
  onSelectUnit?: (objectKey: string | null) => void;
}

const UnitMesh = memo(function UnitMesh({
  part,
  status,
  selected,
  materials,
  onSelectUnit,
}: UnitMeshProps) {
  const selectable = status !== undefined;
  const isSelected = selected && selectable;
  const appearance = unitAppearance(status ?? 'unavailable', isSelected);
  const material = isSelected ? materials.selected : materials.status[status ?? 'unavailable'];

  return (
    <mesh
      geometry={part.geometry}
      matrix={part.matrix}
      matrixAutoUpdate={false}
      material={material}
      renderOrder={isSelected ? 1 : 0}
      onClick={(e) => {
        e.stopPropagation();
        if (selectable && e.delta <= TAP_TOLERANCE_PX) onSelectUnit?.(part.objectKey);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (selectable) document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      <Edges
        color={appearance.outline.color}
        lineWidth={appearance.outline.width}
        threshold={15}
        renderOrder={isSelected ? 2 : 0}
      />
    </mesh>
  );
});

function CameraRig({
  bounds,
  manifest,
}: {
  bounds: { min: Vec3; max: Vec3 };
  manifest: ViewerManifest;
}) {
  const get = useThree((s) => s.get);
  const controls = useRef<OrbitControlsImpl>(null);

  // Enquadra uma vez por modelo (redimensionar a tela não reposiciona a câmera).
  const framing = useMemo(() => {
    const { camera, size } = get();
    return computeFraming(
      bounds,
      (camera as PerspectiveCamera).fov,
      size.width / Math.max(size.height, 1),
      manifest.cameras?.default,
    );
  }, [get, bounds, manifest.cameras?.default]);

  useLayoutEffect(() => {
    // A câmera é do R3F (objeto three.js mutável), lida via get() dentro do efeito.
    const camera = get().camera as PerspectiveCamera;
    camera.position.set(...framing.position);
    camera.near = Math.max(framing.minDistance / 20, 0.1);
    camera.far = framing.maxDistance * 4;
    camera.updateProjectionMatrix();
    controls.current?.target.set(...framing.target);
    controls.current?.update();
  }, [get, framing]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={framing.target}
      enableDamping
      dampingFactor={0.12}
      minDistance={framing.minDistance}
      maxDistance={framing.maxDistance}
      minPolarAngle={framing.minPolarAngle}
      maxPolarAngle={framing.maxPolarAngle}
      screenSpacePanning
      onChange={() => {
        const c = controls.current;
        if (!c) return;
        const t = c.target.toArray() as Vec3;
        const clamped = clampToBounds(t, framing.targetBounds);
        if (clamped.some((v, i) => v !== t[i])) {
          // Move câmera e alvo juntos: o pan "bate" na borda em vez de girar.
          const dx = clamped[0] - t[0];
          const dy = clamped[1] - t[1];
          const dz = clamped[2] - t[2];
          c.target.set(...clamped);
          c.object.position.x += dx;
          c.object.position.y += dy;
          c.object.position.z += dz;
        }
      }}
    />
  );
}

class ErrorBoundary extends Component<
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
