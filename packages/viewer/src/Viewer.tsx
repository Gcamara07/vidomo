/**
 * <Viewer> — visualizador 3D desacoplado (regra 5 do CLAUDE.md).
 * Entrada: manifesto + mapa de status. Saída: eventos. Não conhece Supabase nem o banco.
 *
 * Desempenho: frameloop "demand" (só desenha quando algo muda), dpr limitado a 2,
 * MeshBasicMaterial sem luzes, sem sombras e sem pós-processamento.
 */
import { Edges, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  Component,
  Suspense,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Material, PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { clampToBounds, computeFraming } from './camera';
import { createViewerMaterials, toFlatMaterial, type ViewerMaterials } from './materials';
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
  /** Modelo leve (obrigatório) carregado e primeira cena montada: o prédio já é interativo. */
  onReady?: () => void;
  /** Falha no modelo leve (o prédio não aparece). */
  onError?: (error: Error) => void;
  /** Modelo de detalhes (opcional) carregado e montado. */
  onDetailReady?: () => void;
  /** Falha no modelo de detalhes: o prédio segue funcionando só com o modelo leve. */
  onDetailError?: (error: Error) => void;
  /** Estatísticas de renderização a cada 1 s (para depuração/medição). */
  onStats?: (stats: ViewerStats) => void;
  /** Gira a câmera sozinho (útil para medir fps no aparelho). */
  autoRotate?: boolean;
  className?: string;
  style?: CSSProperties;
  // TODO(modos): onSelectFloor / onModeChange (modo andar) e onCameraChange para estado
  // serializável de câmera — fora desta fatia.
}

export interface ViewerStats {
  /** Quadros desenhados no último segundo (0 quando nada muda: frameloop sob demanda). */
  fps: number;
  drawCalls: number;
  triangles: number;
  dpr: number;
  /** GPU informada pelo WebGL. */
  renderer: string;
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
  onDetailReady,
  onDetailError,
  onStats,
  autoRotate = false,
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
              onDetailReady={onDetailReady}
              onDetailError={onDetailError}
              autoRotate={autoRotate}
            />
          </Suspense>
        </ErrorBoundary>
        {onStats && <FrameStats onStats={onStats} />}
      </Canvas>
    </div>
  );
}

/** Pré-carrega o GLB leve (ex.: enquanto a página busca os status). */
export function preloadModel(url: string) {
  useGLTF.preload(url, false, true);
}

interface BuildingProps {
  manifest: ViewerManifest;
  unitStatus: UnitStatusMap;
  selectedUnit: string | null;
  onSelectUnit?: (objectKey: string | null) => void;
  onReady?: () => void;
  onDetailReady?: () => void;
  onDetailError?: (error: Error) => void;
  autoRotate: boolean;
}

function Building({
  manifest,
  unitStatus,
  selectedUnit,
  onSelectUnit,
  onReady,
  onDetailReady,
  onDetailError,
  autoRotate,
}: BuildingProps) {
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
  // Camada 2 (detalhes) só começa depois que o modelo leve está na tela: não disputa
  // banda nem CPU com o que torna o prédio interativo.
  const [detailStarted, setDetailStarted] = useState(false);
  useEffect(() => {
    // Depois do commit; o próximo frame já desenha o prédio.
    const id = requestAnimationFrame(() => {
      onReadyRef.current?.();
      setDetailStarted(true);
    });
    return () => cancelAnimationFrame(id);
  }, [model]);

  // Enquadra o prédio (unidades, lajes, torre), não o terreno ou o entorno.
  const bounds = useMemo(
    () => ({
      min: model.focusBounds.min.toArray() as Vec3,
      max: model.focusBounds.max.toArray() as Vec3,
    }),
    [model],
  );

  return (
    <>
      <CameraRig bounds={bounds} manifest={manifest} autoRotate={autoRotate} />
      {detailStarted && manifest.detailModelUrl && (
        <ErrorBoundary
          onError={onDetailError ?? ((e) => console.warn('[viewer] modelo de detalhes falhou:', e))}
        >
          <Suspense fallback={null}>
            <DetailLayer
              url={manifest.detailModelUrl}
              manifest={manifest}
              materials={materials}
              onReady={onDetailReady}
            />
          </Suspense>
        </ErrorBoundary>
      )}
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

/**
 * Camada 2: modelo de detalhes (fachada, varandas, entorno, áreas comuns). Só visual: não
 * seleciona e não bloqueia o toque nas unidades atrás dele. Unidades neste arquivo são
 * ignoradas — a seleção vem sempre do modelo leve.
 * Cores: as do próprio GLB, em material chapado (sem luz), com o mesmo contorno técnico.
 * TODO(panoramas): toque em AMENITY__ para abrir o panorama 360° — fora desta fatia.
 */
function DetailLayer({
  url,
  manifest,
  materials,
  onReady,
}: {
  url: string;
  manifest: ViewerManifest;
  materials: ViewerMaterials;
  onReady?: () => void;
}) {
  const gltf = useGLTF(url, false, true);
  const prefixesKey = JSON.stringify(manifest.objectKeyPrefixes ?? {});
  const model = useMemo(
    () => extractBuilding(gltf.scene, manifest.objectKeyPrefixes),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefixesKey cobre o objeto
    [gltf.scene, prefixesKey],
  );

  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    if (model.units.length > 0) {
      console.warn(
        `[viewer] o modelo de detalhes tem ${model.units.length} objetos UNIT__; eles são ignorados.`,
      );
    }
    const id = requestAnimationFrame(() => onReadyRef.current?.());
    return () => cancelAnimationFrame(id);
  }, [model]);

  // Um material chapado por material do GLB (compartilhado entre objetos que o usam).
  const flat = useMemo(() => {
    const byUuid = new Map<string, Material>();
    for (const part of [...model.structure, ...model.floors]) {
      const src = part.sourceMaterial;
      if (src && !byUuid.has(src.uuid)) byUuid.set(src.uuid, toFlatMaterial(src));
    }
    return byUuid;
  }, [model]);
  useEffect(
    () => () => {
      for (const m of flat.values()) m.dispose();
    },
    [flat],
  );
  const materialFor = (part: ScenePart) =>
    (part.sourceMaterial && flat.get(part.sourceMaterial.uuid)) || materials.structure;

  return (
    <>
      {model.structure.map((part, i) => (
        <DetailPart key={`d${i}`} part={part} material={materialFor(part)} />
      ))}
      {model.floors.map((part, i) => (
        <DetailPart key={`df${i}`} part={part} material={materialFor(part)} />
      ))}
    </>
  );
}

const noRaycast = () => null;

const DetailPart = memo(function DetailPart({
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
      raycast={noRaycast}
    >
      <Edges color={BRAND.musgo} lineWidth={1} threshold={30} />
    </mesh>
  );
});

/** Conta quadros desenhados (frameloop sob demanda: só conta quando algo muda). */
function FrameStats({ onStats }: { onStats: (stats: ViewerStats) => void }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const onStatsRef = useRef(onStats);
  useLayoutEffect(() => {
    onStatsRef.current = onStats;
  });
  useFrame(() => {
    frames.current++;
  });

  useEffect(() => {
    const ctx = gl.getContext();
    const info = ctx.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER),
    );
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const fps = (frames.current * 1000) / (now - last);
      frames.current = 0;
      last = now;
      onStatsRef.current({
        fps,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        dpr: gl.getPixelRatio(),
        renderer,
      });
    }, 1000);
    return () => clearInterval(id);
  }, [gl]);

  return null;
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
  autoRotate,
}: {
  bounds: { min: Vec3; max: Vec3 };
  manifest: ViewerManifest;
  autoRotate: boolean;
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
      autoRotate={autoRotate}
      autoRotateSpeed={4}
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
