/**
 * <Viewer> — visualizador 3D desacoplado (regra 5 do CLAUDE.md).
 * Entrada: manifesto + mapa de status + modo/andar/filtros. Saída: eventos.
 * Não conhece Supabase nem o banco.
 *
 * Modos:
 *  - building: o prédio inteiro.
 *  - floor: o andar ativo em destaque, câmera oblíqua de cima; andares acima ocultos,
 *    abaixo esmaecidos (Areia translúcida, sem contorno). Estrutura e camada de detalhes são
 *    recortadas por altura (planos de corte pela cota das lajes FLOOR__), sem exigir nada
 *    do modelo.
 *
 * Desempenho: frameloop "demand" (só desenha quando algo muda), dpr limitado a 2,
 * MeshBasicMaterial sem luzes, sem sombras e sem pós-processamento. Trocar de andar só
 * muda constantes dos planos de corte e referências de material (sem recompilar shaders).
 */
import { Edges, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  Component,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Box3,
  Mesh,
  type Intersection,
  type Material,
  type PerspectiveCamera,
  type Raycaster,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  azimuthOf,
  clampToBounds,
  computeFloorFraming,
  computeFraming,
  easeInOutCubic,
  lerpVec3,
  transitionMs,
  type Framing,
} from './camera';
import {
  clipRange,
  computeFloorLevels,
  floorPartView,
  type FloorLevel,
  type PartView,
  type ViewerMode,
} from './floors';
import {
  FILTERED_OUTLINE,
  createViewerMaterials,
  setClipRange,
  toFlatMaterial,
  type ViewerMaterials,
} from './materials';
import { floorKeyOfUnit } from './naming';
import { extractBuilding, type ScenePart } from './scene-model';
import { classifyZone, towerFootprint, type Footprint, type PartZone } from './site';
import { BRAND, PAPER_BACKGROUND, unitAppearance } from './styles';
import type { CameraPreset, UnitStatus, UnitStatusMap, Vec3, ViewerManifest } from './types';

export type { ViewerMode } from './floors';

/** Estado do viewer, serializável (JSON): para guardar, compartilhar ou restaurar a vista. */
export interface ViewerViewState {
  mode: ViewerMode;
  /** object_key do andar ativo (ex.: 'TA__F08') ou null no modo edifício. */
  activeFloor: string | null;
  selectedUnit: string | null;
  camera: CameraPreset;
}

export interface ViewerProps {
  manifest: ViewerManifest;
  unitStatus: UnitStatusMap;
  /** Modo (controlado pelo app). Padrão: 'building'. */
  mode?: ViewerMode;
  /** object_key do andar ativo no modo andar (ex.: 'TA__F08'). Inválido → modo edifício. */
  activeFloor?: string | null;
  /** Unidades esmaecidas pelos filtros: sem cor de status, em Areia claro, ainda tocáveis. */
  dimmedUnits?: ReadonlySet<string>;
  /** object_key da unidade selecionada (controlado pelo app). */
  selectedUnit?: string | null;
  /** Toque numa unidade (object_key) ou fora delas (null). */
  onSelectUnit?: (objectKey: string | null) => void;
  /**
   * Sugestão de andar: toque numa laje, ou numa unidade, no modo edifício. O app decide se
   * entra no modo andar.
   */
  onSelectFloor?: (floorKey: string) => void;
  /** Chamado quando a transição para um modo termina (a câmera chegou). */
  onModeChange?: (mode: ViewerMode) => void;
  /** Estado serializável ao fim de cada interação de câmera e de cada transição. */
  onViewChange?: (state: ViewerViewState) => void;
  /** Câmera inicial (ex.: restaurada de um ViewerViewState). */
  initialCamera?: CameraPreset;
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
  // TODO(norte): seta de norte no viewer (o modelo usa −Z = norte, +Y do Blender).
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

const EMPTY_SET: ReadonlySet<string> = new Set();

export function Viewer({
  manifest,
  unitStatus,
  mode = 'building',
  activeFloor = null,
  dimmedUnits = EMPTY_SET,
  selectedUnit = null,
  onSelectUnit,
  onSelectFloor,
  onModeChange,
  onViewChange,
  initialCamera,
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
        onCreated={({ gl }) => {
          // Planos de corte por material (recorte por altura no modo andar).
          gl.localClippingEnabled = true;
        }}
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
              mode={mode}
              activeFloor={activeFloor}
              dimmedUnits={dimmedUnits}
              selectedUnit={selectedUnit}
              onSelectUnit={onSelectUnit}
              onSelectFloor={onSelectFloor}
              onModeChange={onModeChange}
              onViewChange={onViewChange}
              initialCamera={initialCamera}
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
  mode: ViewerMode;
  activeFloor: string | null;
  dimmedUnits: ReadonlySet<string>;
  selectedUnit: string | null;
  onSelectUnit?: (objectKey: string | null) => void;
  onSelectFloor?: (floorKey: string) => void;
  onModeChange?: (mode: ViewerMode) => void;
  onViewChange?: (state: ViewerViewState) => void;
  initialCamera?: CameraPreset;
  onReady?: () => void;
  onDetailReady?: () => void;
  onDetailError?: (error: Error) => void;
  autoRotate: boolean;
}

/** Faixa de altura atual (para o toque ignorar o que está recortado). */
type RangeRef = { current: { bottom: number; top: number } | null };

function partBox(part: ScenePart): { min: Vec3; max: Vec3 } {
  if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
  const b = new Box3().copy(part.geometry.boundingBox!).applyMatrix4(part.matrix);
  return { min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 };
}

function Building({
  manifest,
  unitStatus,
  mode,
  activeFloor,
  dimmedUnits,
  selectedUnit,
  onSelectUnit,
  onSelectFloor,
  onModeChange,
  onViewChange,
  initialCamera,
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
  const invalidate = useThree((s) => s.invalidate);
  const materials = useMemo(
    () => createViewerMaterials(Math.min(4, gl.capabilities.getMaxAnisotropy())),
    [gl],
  );
  useEffect(() => () => materials.dispose(), [materials]);

  // Andares pelas lajes FLOOR__ (cota de cada andar).
  const levels = useMemo(() => {
    const slabs = model.floors
      .filter((p) => p.objectKey)
      .map((p) => ({ objectKey: p.objectKey!, ...partBox(p) }));
    const list = computeFloorLevels(slabs, model.focusBounds.max.y);
    return new Map(list.map((l) => [l.key, l]));
  }, [model]);

  const requested = activeFloor ? levels.get(activeFloor) : undefined;
  const effectiveMode: ViewerMode = mode === 'floor' && requested ? 'floor' : 'building';
  // Andar ativo só vale no modo andar (no modo edifício, trocar o andar não move a câmera).
  const active = effectiveMode === 'floor' ? requested : undefined;
  useEffect(() => {
    if (mode === 'floor' && activeFloor && !levels.has(activeFloor)) {
      console.warn(`[viewer] andar "${activeFloor}" não existe no modelo; mostrando o prédio.`);
    }
  }, [mode, activeFloor, levels]);

  // Recorte por altura: só as constantes dos planos mudam.
  const range = useMemo(() => clipRange(effectiveMode, active), [effectiveMode, active]);
  const rangeRef: RangeRef = useRef(range);
  useLayoutEffect(() => {
    rangeRef.current = range;
    setClipRange(materials.planes, range);
    invalidate();
  }, [range, materials, invalidate]);

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

  // Eventos com os valores mais recentes (sem recriar handlers a cada render).
  const latest = useRef({ effectiveMode, active, selectedUnit, onSelectUnit, onSelectFloor });
  useLayoutEffect(() => {
    latest.current = { effectiveMode, active, selectedUnit, onSelectUnit, onSelectFloor };
  });
  const callbacks = useRef({ onModeChange, onViewChange });
  useLayoutEffect(() => {
    callbacks.current = { onModeChange, onViewChange };
  });

  const onTapUnit = useCallback((key: string) => {
    const { effectiveMode: m, onSelectUnit: su, onSelectFloor: sf } = latest.current;
    su?.(key);
    if (m === 'building') {
      const fk = floorKeyOfUnit(key);
      if (fk) sf?.(fk);
    }
  }, []);
  const onTapFloor = useCallback((key: string) => {
    if (latest.current.effectiveMode === 'building') latest.current.onSelectFloor?.(key);
  }, []);

  const emitView = useCallback((camera: CameraPreset) => {
    const { effectiveMode: m, active: a, selectedUnit: s } = latest.current;
    callbacks.current.onViewChange?.({
      mode: m,
      activeFloor: a?.key ?? null,
      selectedUnit: s,
      camera,
    });
  }, []);
  const onTransitionEnd = useCallback(
    (camera: CameraPreset) => {
      callbacks.current.onModeChange?.(latest.current.effectiveMode);
      emitView(camera);
    },
    [emitView],
  );

  const floorOf = (part: ScenePart) => {
    const fk = part.objectKey ? floorKeyOfUnit(part.objectKey) : null;
    return fk ? levels.get(fk) : undefined;
  };
  const isFloorMode = effectiveMode === 'floor';

  // Torre × entorno pela projeção no chão (TOWER__ + FLOOR__, margem de 2 m).
  const footprint = useMemo(
    () =>
      towerFootprint(
        [...model.structure.filter((p) => p.kind === 'tower'), ...model.floors].map(partBox),
      ),
    [model],
  );
  const structureZones = useMemo(
    () => model.structure.map((p) => classifyZone(partBox(p), footprint)),
    [model, footprint],
  );

  return (
    <>
      <CameraRig
        bounds={bounds}
        manifest={manifest}
        mode={effectiveMode}
        active={active}
        autoRotate={autoRotate}
        initialCamera={initialCamera}
        onTransitionEnd={onTransitionEnd}
        onInteractionEnd={emitView}
      />
      {detailStarted && manifest.detailModelUrl && (
        <ErrorBoundary
          onError={onDetailError ?? ((e) => console.warn('[viewer] modelo de detalhes falhou:', e))}
        >
          <Suspense fallback={null}>
            <DetailLayer
              url={manifest.detailModelUrl}
              manifest={manifest}
              materials={materials}
              footprint={footprint}
              showLower={isFloorMode}
              onReady={onDetailReady}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {model.structure.map((part, i) =>
        structureZones[i] === 'site' ? (
          <SitePart key={`s${i}`} part={part} material={materials.site} blocking threshold={15} />
        ) : (
          <ClippedPart
            key={`s${i}`}
            part={part}
            material={materials.structure}
            materials={materials}
            showLower={isFloorMode}
            blocking
            rangeRef={rangeRef}
            threshold={15}
          />
        ),
      )}
      {model.floors.map((part, i) => (
        <FloorSlab
          key={`f${i}`}
          part={part}
          view={floorPartView(
            part.objectKey ? levels.get(part.objectKey) : undefined,
            effectiveMode,
            active,
          )}
          interactive={!isFloorMode}
          materials={materials}
          onTap={onTapFloor}
        />
      ))}
      {model.units.map((part) => (
        <UnitMesh
          key={part.objectKey!}
          part={part}
          status={unitStatus[part.objectKey!]}
          selected={part.objectKey === selectedUnit}
          filtered={dimmedUnits.has(part.objectKey!)}
          view={floorPartView(floorOf(part), effectiveMode, active)}
          materials={materials}
          onTap={onTapUnit}
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
 * No modo andar: só a parte da torre é recortada por altura (acima do andar some; abaixo,
 * esmaecida). O entorno (terreno, rua, pisos, piscina, árvores, áreas comuns) fica sempre
 * normal, como contexto — classificado pela projeção no chão (site.ts).
 * TODO(panoramas): toque em AMENITY__ para abrir o panorama 360° — fora desta fatia.
 */
function DetailLayer({
  url,
  manifest,
  materials,
  footprint,
  showLower,
  onReady,
}: {
  url: string;
  manifest: ViewerManifest;
  materials: ViewerMaterials;
  footprint: Footprint | null;
  showLower: boolean;
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

  const parts = useMemo(
    () =>
      [...model.structure, ...model.floors].map((part) => ({
        part,
        zone: classifyZone(partBox(part), footprint),
      })),
    [model, footprint],
  );

  // Um material chapado por material do GLB e por zona: a torre usa os planos de corte da
  // estrutura; o entorno, nunca.
  const flat = useMemo(() => {
    const byKey = new Map<string, Material>();
    for (const { part, zone } of parts) {
      const src = part.sourceMaterial;
      const key = src ? `${src.uuid}|${zone}` : '';
      if (src && !byKey.has(key)) {
        const m = toFlatMaterial(src);
        if (zone === 'tower') m.clippingPlanes = [materials.planes.top, materials.planes.bottom];
        byKey.set(key, m);
      }
    }
    return byKey;
  }, [parts, materials]);
  useEffect(
    () => () => {
      for (const m of flat.values()) m.dispose();
    },
    [flat],
  );
  const materialFor = (part: ScenePart, zone: PartZone) =>
    (part.sourceMaterial && flat.get(`${part.sourceMaterial.uuid}|${zone}`)) ||
    (zone === 'site' ? materials.site : materials.structure);

  return (
    <>
      {parts.map(({ part, zone }, i) =>
        zone === 'site' ? (
          <SitePart
            key={`d${i}`}
            part={part}
            material={materialFor(part, zone)}
            blocking={false}
            threshold={30}
          />
        ) : (
          <ClippedPart
            key={`d${i}`}
            part={part}
            material={materialFor(part, zone)}
            materials={materials}
            showLower={showLower}
            blocking={false}
            threshold={30}
          />
        ),
      )}
    </>
  );
}

/** Peça do entorno: sempre normal (sem recorte e sem esmaecer), em qualquer modo. */
const SitePart = memo(function SitePart({
  part,
  material,
  blocking,
  threshold,
}: {
  part: ScenePart;
  material: Material;
  blocking: boolean;
  threshold: number;
}) {
  return (
    <mesh
      geometry={part.geometry}
      matrix={part.matrix}
      matrixAutoUpdate={false}
      material={material}
      raycast={blocking ? undefined : noRaycast}
      onClick={blocking ? stop : undefined}
    >
      <Edges color={BRAND.musgo} lineWidth={1} threshold={threshold} />
    </mesh>
  );
});

const noRaycast = () => null;
const stop = (e: ThreeEvent<MouseEvent>) => e.stopPropagation();

/**
 * Raycast que ignora o que está recortado (acima do andar) ou esmaecido (abaixo): sem
 * isso, a cobertura invisível "tamparia" o toque nas unidades do andar.
 */
function makeClippedRaycast(rangeRef: RangeRef) {
  return function clippedRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]) {
    const start = intersects.length;
    Mesh.prototype.raycast.call(this, raycaster, intersects);
    const r = rangeRef.current;
    if (!r) return;
    for (let i = intersects.length - 1; i >= start; i--) {
      const y = intersects[i]!.point.y;
      if (y > r.top || y < r.bottom) intersects.splice(i, 1);
    }
  };
}

/**
 * Peça sem andar (estrutura do modelo leve ou camada de detalhes). Passada normal recortada
 * na faixa do andar ativo; no modo andar, uma segunda passada esmaecida do que fica abaixo.
 */
const ClippedPart = memo(function ClippedPart({
  part,
  material,
  materials,
  showLower,
  blocking,
  rangeRef,
  threshold,
}: {
  part: ScenePart;
  material: Material;
  materials: ViewerMaterials;
  showLower: boolean;
  /** Estrutura tapa o toque nas unidades atrás dela; detalhes não. */
  blocking: boolean;
  rangeRef?: RangeRef;
  threshold: number;
}) {
  const raycast = useMemo(
    () => (blocking && rangeRef ? makeClippedRaycast(rangeRef) : noRaycast),
    [blocking, rangeRef],
  );
  const edgePlanes = useMemo(() => [materials.planes.top, materials.planes.bottom], [materials]);
  return (
    <>
      <mesh
        geometry={part.geometry}
        matrix={part.matrix}
        matrixAutoUpdate={false}
        material={material}
        raycast={raycast}
        onClick={blocking ? stop : undefined}
      >
        <Edges
          color={BRAND.musgo}
          lineWidth={1}
          threshold={threshold}
          // Repassado ao material da linha: o contorno também é recortado.
          {...({ clippingPlanes: edgePlanes } as object)}
        />
      </mesh>
      {showLower && (
        <mesh
          geometry={part.geometry}
          matrix={part.matrix}
          matrixAutoUpdate={false}
          material={materials.lowerClipped}
          raycast={noRaycast}
        />
      )}
    </>
  );
});

/** Laje FLOOR__: no modo edifício, tocar sugere o andar (onSelectFloor). */
const FloorSlab = memo(function FloorSlab({
  part,
  view,
  interactive,
  materials,
  onTap,
}: {
  part: ScenePart;
  view: PartView;
  interactive: boolean;
  materials: ViewerMaterials;
  onTap: (floorKey: string) => void;
}) {
  if (view === 'hidden') return null;
  const lower = view === 'lower';
  return (
    <mesh
      geometry={part.geometry}
      matrix={part.matrix}
      matrixAutoUpdate={false}
      material={lower ? materials.lower : materials.slab}
      raycast={lower ? noRaycast : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (interactive && part.objectKey && e.delta <= TAP_TOLERANCE_PX) onTap(part.objectKey);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (interactive) document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      {!lower && <Edges color={BRAND.musgo} lineWidth={1} threshold={15} />}
    </mesh>
  );
});

interface UnitMeshProps {
  part: ScenePart;
  /** undefined = unidade do modelo sem status informado: aparece como indisponível e não é selecionável. */
  status: UnitStatus | undefined;
  selected: boolean;
  /** Fora dos filtros: Areia claro, sem cor de status, ainda tocável. */
  filtered: boolean;
  view: PartView;
  materials: ViewerMaterials;
  onTap: (objectKey: string) => void;
}

const UnitMesh = memo(function UnitMesh({
  part,
  status,
  selected,
  filtered,
  view,
  materials,
  onTap,
}: UnitMeshProps) {
  if (view === 'hidden') return null;
  if (view === 'lower') {
    return (
      <mesh
        geometry={part.geometry}
        matrix={part.matrix}
        matrixAutoUpdate={false}
        material={materials.lower}
        raycast={noRaycast}
      />
    );
  }

  const selectable = status !== undefined;
  const isSelected = selected && selectable;
  const isFiltered = filtered && !isSelected;
  const appearance = unitAppearance(status ?? 'unavailable', isSelected);
  const material = isSelected
    ? materials.selected
    : isFiltered
      ? materials.filtered
      : materials.status[status ?? 'unavailable'];

  return (
    <mesh
      geometry={part.geometry}
      matrix={part.matrix}
      matrixAutoUpdate={false}
      material={material}
      renderOrder={isSelected ? 1 : 0}
      onClick={(e) => {
        e.stopPropagation();
        if (selectable && part.objectKey && e.delta <= TAP_TOLERANCE_PX) onTap(part.objectKey);
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
        color={isFiltered ? FILTERED_OUTLINE : appearance.outline.color}
        lineWidth={appearance.outline.width}
        threshold={15}
        renderOrder={isSelected ? 2 : 0}
      />
    </mesh>
  );
});

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const round2 = (v: Vec3): Vec3 => v.map((n) => Math.round(n * 100) / 100) as Vec3;

interface Anim {
  fromP: Vec3;
  fromT: Vec3;
  toP: Vec3;
  toT: Vec3;
  start: number;
  dur: number;
}

function CameraRig({
  bounds,
  manifest,
  mode,
  active,
  autoRotate,
  initialCamera,
  onTransitionEnd,
  onInteractionEnd,
}: {
  bounds: { min: Vec3; max: Vec3 };
  manifest: ViewerManifest;
  mode: ViewerMode;
  active: FloorLevel | undefined;
  autoRotate: boolean;
  initialCamera?: CameraPreset;
  onTransitionEnd: (camera: CameraPreset) => void;
  onInteractionEnd: (camera: CameraPreset) => void;
}) {
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const anim = useRef<Anim | null>(null);
  const framing = useRef<Framing | null>(null);
  const appliedKey = useRef<string | null>(null);
  const viewKey = `${mode}|${active?.key ?? ''}`;

  const framingFor = useCallback(
    (azimuth?: number, usePreset = false): Framing => {
      const { camera, size } = get();
      const fov = (camera as PerspectiveCamera).fov;
      const aspect = size.width / Math.max(size.height, 1);
      if (mode === 'floor' && active) {
        return computeFloorFraming(active, fov, aspect, azimuth ?? 0.56);
      }
      return computeFraming(
        bounds,
        fov,
        aspect,
        usePreset ? manifest.cameras?.default : undefined,
        azimuth,
      );
    },
    [get, mode, active, bounds, manifest.cameras?.default],
  );

  const currentCamera = useCallback((): CameraPreset => {
    const cam = get().camera;
    const target = controls.current?.target.toArray() as Vec3 | undefined;
    return {
      position: round2(cam.position.toArray() as Vec3),
      target: round2(target ?? [0, 0, 0]),
    };
  }, [get]);

  const applyLimits = useCallback(
    (f: Framing) => {
      const c = controls.current;
      const cam = get().camera as PerspectiveCamera;
      if (c) {
        c.minDistance = f.minDistance;
        c.maxDistance = f.maxDistance;
        c.minPolarAngle = f.minPolarAngle;
        c.maxPolarAngle = f.maxPolarAngle;
      }
      cam.near = Math.max(f.minDistance / 20, 0.1);
      cam.far = f.maxDistance * 6;
      cam.updateProjectionMatrix();
    },
    [get],
  );

  // Montagem (ou modelo novo): posiciona direto, sem animação.
  useLayoutEffect(() => {
    const f = framingFor(undefined, true);
    framing.current = f;
    const start = initialCamera ?? { position: f.position, target: f.target };
    const cam = get().camera;
    cam.position.set(...start.position);
    controls.current?.target.set(...start.target);
    applyLimits(f);
    controls.current?.update();
    appliedKey.current = viewKey;
    invalidate();
    // Só no modelo novo; trocas de modo/andar são animadas abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  // Troca de modo ou de andar: transição suave (≤ 600 ms), ou direta com reduced-motion.
  useEffect(() => {
    if (appliedKey.current === viewKey) return;
    appliedKey.current = viewKey;
    const c = controls.current;
    if (!c) return;
    const cam = get().camera;
    const fromP = cam.position.toArray() as Vec3;
    const fromT = c.target.toArray() as Vec3;
    const f = framingFor(azimuthOf(fromP, fromT));
    framing.current = f;
    const dur = transitionMs(prefersReducedMotion());
    if (dur === 0) {
      cam.position.set(...f.position);
      c.target.set(...f.target);
      applyLimits(f);
      c.update();
      invalidate();
      onTransitionEnd(currentCamera());
      return;
    }
    // Limites soltos durante a animação (senão o OrbitControls "puxa" a câmera de volta).
    c.minDistance = 0.01;
    c.maxDistance = 1e5;
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI;
    c.enabled = false;
    anim.current = { fromP, fromT, toP: f.position, toT: f.target, start: performance.now(), dur };
    invalidate();
  }, [viewKey, framingFor, get, applyLimits, invalidate, onTransitionEnd, currentCamera]);

  useFrame(() => {
    const a = anim.current;
    const c = controls.current;
    if (!a || !c) return;
    const t = easeInOutCubic((performance.now() - a.start) / a.dur);
    get().camera.position.set(...lerpVec3(a.fromP, a.toP, t));
    c.target.set(...lerpVec3(a.fromT, a.toT, t));
    c.update();
    if (t >= 1) {
      anim.current = null;
      if (framing.current) applyLimits(framing.current);
      c.enabled = true;
      c.update();
      onTransitionEnd(currentCamera());
    }
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      autoRotate={autoRotate}
      autoRotateSpeed={4}
      screenSpacePanning
      onEnd={() => onInteractionEnd(currentCamera())}
      onChange={() => {
        const c = controls.current;
        const f = framing.current;
        if (!c || !f || anim.current) return;
        const t = c.target.toArray() as Vec3;
        const clamped = clampToBounds(t, f.targetBounds);
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
