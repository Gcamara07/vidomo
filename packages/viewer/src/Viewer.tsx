/**
 * <Viewer> — visualizador 3D desacoplado (regra 5 do CLAUDE.md).
 * Entrada: manifesto + mapa de status + modo/andar/filtros. Saída: eventos.
 * Não conhece Supabase nem o banco.
 *
 * Modos:
 *  - building: o empreendimento inteiro (vista geral). Com vários blocos, tocar num bloco
 *    sugere o modo bloco (onSelectTower) e cada bloco pode ter um rótulo curto.
 *  - tower: o bloco ativo enquadrado; os outros esmaecidos, mas visíveis e tocáveis (troca
 *    de bloco). Com uma torre só, este modo é pulado (vira building).
 *  - floor: o andar ativo em destaque, câmera oblíqua de cima; andares acima ocultos,
 *    abaixo esmaecidos (Areia translúcida, sem contorno). Estrutura e camada de detalhes são
 *    recortadas por altura (planos de corte pela cota das lajes FLOOR__), sem exigir nada
 *    do modelo. Com vários blocos, o recorte vale só para o bloco ativo e os colados a ele
 *    (projeções em planta que se tocam); os outros blocos aparecem inteiros como silhueta
 *    semitransparente (uma malha por bloco, sem cor de status, sem contorno, sem toque), que
 *    não muda ao trocar de andar. Malhas de detalhe que juntam vários blocos são divididas
 *    por bloco ao carregar (partition.ts).
 *
 * Desempenho: frameloop "demand" (só desenha quando algo muda), dpr limitado a 2,
 * MeshBasicMaterial sem luzes, sem sombras e sem pós-processamento. Trocar de andar só
 * muda constantes dos planos de corte e quais peças estão em cada lote (sem recompilar
 * shaders). Desenho em lotes (batch.ts): unidades por bloco e aparência, lajes, estrutura e
 * detalhes por aparência, cada lote com uma malha e um contorno; a unidade selecionada fica
 * à parte. 20 blocos: 970 → 196 draw calls na vista geral.
 */
import { Edges, Html, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  Component,
  Fragment,
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
  Color,
  Mesh,
  Vector3,
  type BufferGeometry,
  type Intersection,
  type Plane,
  type Material,
  type PerspectiveCamera,
  type Raycaster,
} from 'three';
import {
  LineMaterial,
  LineSegments2,
  LineSegmentsGeometry,
  type OrbitControls as OrbitControlsImpl,
} from 'three-stdlib';
import {
  groupBatches,
  mergeBatch,
  partArrays,
  slabClass,
  unitClass,
  type BatchItem,
  type SlabClass,
  type UnitClass,
} from './batch';
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
import { clipRange, computeFloorLevels } from './floors';
import {
  FILTERED_OUTLINE,
  GHOST_RENDER_ORDER,
  createViewerMaterials,
  setClipRange,
  toFlatMaterial,
  type ViewerMaterials,
} from './materials';
import { floorKeyOfUnit, parseUnitKey } from './naming';
import { buildGhostGeometries, splitByTower, type TowerPiece } from './partition';
import { extractBuilding, type ScenePart } from './scene-model';
import { classifyZone, type Footprint, type PartZone, type ZoneOptions } from './site';
import {
  computeAdjacency,
  computeTowers,
  cutTowers,
  outwardAzimuth,
  partView,
  resolveView,
  towerAtPoint,
  towerKeyOf,
  towerLabelPosition,
  type Point2,
  type ResolvedView,
  type TowerInfo,
} from './towers';
import { BRAND, PAPER_BACKGROUND, unitAppearance } from './styles';
import type {
  CameraPreset,
  UnitStatus,
  UnitStatusMap,
  Vec3,
  ViewerManifest,
  ViewerMode,
  ViewInsets,
} from './types';

export type { ViewerMode } from './types';

/** Estado do viewer, serializável (JSON): para guardar, compartilhar ou restaurar a vista. */
export interface ViewerViewState {
  mode: ViewerMode;
  /** Código da torre ativa (modo bloco ou andar com 2+ torres; ex.: 'B09'), ou null. */
  activeTower: string | null;
  /** object_key do andar ativo (ex.: 'TA__F08') ou null fora do modo andar. */
  activeFloor: string | null;
  selectedUnit: string | null;
  camera: CameraPreset;
}

export interface ViewerProps {
  manifest: ViewerManifest;
  unitStatus: UnitStatusMap;
  /** Modo (controlado pelo app). Padrão: 'building'. */
  mode?: ViewerMode;
  /**
   * Código da torre ativa no modo bloco (ex.: 'B09'). Inválido → modo edifício. No modo
   * andar, a torre vem do andar.
   */
  activeTower?: string | null;
  /** object_key do andar ativo no modo andar (ex.: 'TA__F08'). Inválido → modo edifício. */
  activeFloor?: string | null;
  /** Unidades esmaecidas pelos filtros: sem cor de status, em Areia claro, ainda tocáveis. */
  dimmedUnits?: ReadonlySet<string>;
  /** object_key da unidade selecionada (controlado pelo app). */
  selectedUnit?: string | null;
  /** Toque numa unidade (object_key) ou fora delas (null). */
  onSelectUnit?: (objectKey: string | null) => void;
  /**
   * Sugestão de andar: toque numa laje, ou numa unidade, no modo edifício (com uma torre só)
   * ou no modo bloco (no bloco ativo). O app decide se entra no modo andar.
   */
  onSelectFloor?: (floorKey: string) => void;
  /**
   * Sugestão de bloco (só com 2+ torres): toque num bloco (unidade, laje, núcleo ou rótulo)
   * na vista geral, ou num bloco esmaecido no modo bloco. O app decide se entra no modo bloco.
   */
  onSelectTower?: (towerKey: string) => void;
  /**
   * Rótulos curtos dos blocos na vista geral (só com 2+ torres), por código da torre:
   * ex.: { B09: { label: '09', title: 'Bloco 09' } }. Sem rótulos, nada aparece.
   */
  towerLabels?: Record<string, TowerLabel>;
  /** Chamado quando a transição para um modo termina (a câmera chegou). */
  onModeChange?: (mode: ViewerMode) => void;
  /** Estado serializável ao fim de cada interação de câmera e de cada transição. */
  onViewChange?: (state: ViewerViewState) => void;
  /**
   * Área coberta por interface do app (px). O centro da imagem vai para o meio da área
   * livre e o enquadramento usa a proporção dela (ex.: a ficha não cobre o andar).
   */
  insets?: ViewInsets;
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

export interface TowerLabel {
  /** Texto curto no 3D (ex.: '09'). */
  label: string;
  /** Nome para leitores de tela e dica (ex.: 'Bloco 09'). Padrão: o próprio label. */
  title?: string;
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
  activeTower = null,
  activeFloor = null,
  dimmedUnits = EMPTY_SET,
  selectedUnit = null,
  onSelectUnit,
  onSelectFloor,
  onSelectTower,
  towerLabels,
  onModeChange,
  onViewChange,
  initialCamera,
  onReady,
  onError,
  onDetailReady,
  onDetailError,
  onStats,
  autoRotate = false,
  insets,
  className,
  style,
}: ViewerProps) {
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  // Valores primitivos: um objeto novo a cada render não dispara efeitos à toa.
  const insetsKey = `${insets?.top ?? 0},${insets?.right ?? 0},${insets?.bottom ?? 0},${insets?.left ?? 0}`;

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
              activeTower={activeTower}
              activeFloor={activeFloor}
              dimmedUnits={dimmedUnits}
              selectedUnit={selectedUnit}
              onSelectUnit={onSelectUnit}
              onSelectFloor={onSelectFloor}
              onSelectTower={onSelectTower}
              towerLabels={towerLabels}
              onModeChange={onModeChange}
              onViewChange={onViewChange}
              initialCamera={initialCamera}
              onReady={onReady}
              onDetailReady={onDetailReady}
              onDetailError={onDetailError}
              autoRotate={autoRotate}
              insets={insetsKey}
            />
          </Suspense>
        </ErrorBoundary>
        <ViewOffset insets={insetsKey} />
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
  activeTower: string | null;
  activeFloor: string | null;
  dimmedUnits: ReadonlySet<string>;
  selectedUnit: string | null;
  onSelectUnit?: (objectKey: string | null) => void;
  onSelectFloor?: (floorKey: string) => void;
  onSelectTower?: (towerKey: string) => void;
  towerLabels?: Record<string, TowerLabel>;
  onModeChange?: (mode: ViewerMode) => void;
  onViewChange?: (state: ViewerViewState) => void;
  initialCamera?: CameraPreset;
  onReady?: () => void;
  onDetailReady?: () => void;
  onDetailError?: (error: Error) => void;
  autoRotate: boolean;
  /** "top,right,bottom,left" em px. */
  insets: string;
}

/** Faixa de altura atual (para o toque ignorar o que está recortado). */
type RangeRef = { current: { bottom: number; top: number } | null };

function partBox(part: ScenePart): { min: Vec3; max: Vec3 } {
  if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
  const b = new Box3().copy(part.geometry.boundingBox!).applyMatrix4(part.matrix);
  return { min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 };
}

/** Vértices da peça em planta (x, z), coordenadas de mundo (forma real de blocos girados). */
function planPoints(part: ScenePart): Point2[] {
  const pos = part.geometry.getAttribute('position');
  if (!pos) return [];
  const v = new Vector3();
  const out: Point2[] = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(part.matrix);
    out.push([v.x, v.z]);
  }
  return out;
}

/** Torre × entorno e bloco de cada peça (compartilhado entre o modelo leve e os detalhes). */
interface TowerContext {
  footprints: Footprint[];
  options: ZoneOptions;
  /** Uma torre só: o código dela (ou null sem torre). Várias: undefined. */
  single: string | null | undefined;
  /** Bloco de um ponto em planta (só com várias torres). */
  assign: (x: number, z: number) => string | null;
}

interface ZonedPiece extends TowerPiece {
  zone: PartZone;
}

/**
 * Classifica as peças (torre × entorno) e diz o bloco de cada uma: pelo nome, ou, com
 * várias torres, pela posição em planta — malha única com vários blocos vira uma peça por
 * bloco (splitByTower). O entorno não tem bloco.
 */
function zonedPieces(parts: ScenePart[], ctx: TowerContext): ZonedPiece[] {
  const out: ZonedPiece[] = [];
  for (const part of parts) {
    const zone = classifyZone(partBox(part), ctx.footprints, ctx.options);
    const named = towerKeyOf(part.kind, part.objectKey);
    if (zone === 'site') out.push({ part, zone, tower: null });
    else if (named) out.push({ part, zone, tower: named });
    else if (ctx.single !== undefined) out.push({ part, zone, tower: ctx.single });
    else for (const piece of splitByTower(part, ctx.assign)) out.push({ ...piece, zone });
  }
  return out;
}

/** Bloco fora do corte no modo andar: a peça some e a silhueta do bloco a substitui. */
const isGhost = (cut: ReadonlySet<string> | null, tower: string | null) =>
  !!cut && !cut.has(tower ?? '');

function Building({
  manifest,
  unitStatus,
  mode,
  activeTower,
  activeFloor,
  dimmedUnits,
  selectedUnit,
  onSelectUnit,
  onSelectFloor,
  onSelectTower,
  towerLabels,
  onModeChange,
  onViewChange,
  initialCamera,
  onReady,
  onDetailReady,
  onDetailError,
  autoRotate,
  insets,
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

  // Torres (blocos) pelos nomes: enquadramento do modo bloco e projeção torre × entorno.
  const towers = useMemo(
    () =>
      computeTowers(
        [...model.units, ...model.floors, ...model.structure].map((p) => ({
          kind: p.kind,
          objectKey: p.objectKey,
          box: partBox(p),
          // Forma em planta só de lajes e núcleos (o resto usa a caixa).
          points: p.kind === 'floor' || p.kind === 'tower' ? planPoints(p) : undefined,
        })),
      ),
    [model],
  );
  const multiTower = towers.size > 1;
  // Blocos colados (par do mesmo prédio), pela geometria.
  const adjacency = useMemo(() => computeAdjacency(towers), [towers]);

  // Modo efetivo: andar/torre inválidos (ou modo bloco com uma torre só) viram edifício.
  // Andar ativo só vale no modo andar (no modo edifício, trocar o andar não move a câmera).
  const view = useMemo(
    () => resolveView(mode, activeTower, activeFloor, towers, levels),
    [mode, activeTower, activeFloor, towers, levels],
  );
  const effectiveMode = view.mode;
  const active = view.floor;
  // Modo andar com vários blocos: só o ativo e os colados são recortados; os outros viram
  // silhueta inteira (não muda ao trocar de andar). Uma torre só: null, como antes.
  const cut = useMemo(() => cutTowers(view, adjacency), [view, adjacency]);
  // Modo bloco: câmera do lado de fora do par (o bloco colado não tapa o ativo).
  const towerAzimuth = useMemo(
    () =>
      view.mode === 'tower' && view.tower
        ? outwardAzimuth(
            view.tower,
            (adjacency.get(view.tower.key) ?? []).map((k) => towers.get(k)!),
          )
        : undefined,
    [view, adjacency, towers],
  );
  useEffect(() => {
    if (view.warning) console.warn(`[viewer] ${view.warning}`);
  }, [view.warning]);

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
  const latestValues = {
    view,
    multiTower,
    selectedUnit,
    onSelectUnit,
    onSelectFloor,
    onSelectTower,
  };
  const latest = useRef(latestValues);
  useLayoutEffect(() => {
    latest.current = latestValues;
  });
  const callbacks = useRef({ onModeChange, onViewChange });
  useLayoutEffect(() => {
    callbacks.current = { onModeChange, onViewChange };
  });

  /**
   * Toque num bloco que não é o ativo (vista geral com 2+ torres, ou bloco esmaecido no
   * modo bloco): sugere o bloco. Devolve true se o toque foi tratado assim.
   */
  const suggestTower = useCallback((tower: string | null): boolean => {
    const { view: v, multiTower: multi, onSelectTower: st } = latest.current;
    if (!multi || !tower || v.mode === 'floor') return false;
    if (v.mode === 'tower' && v.tower?.key === tower) return false;
    st?.(tower);
    return true;
  }, []);
  const onTapUnit = useCallback(
    (key: string) => {
      if (suggestTower(parseUnitKey(key)?.tower ?? null)) return;
      const { view: v, onSelectUnit: su, onSelectFloor: sf } = latest.current;
      su?.(key);
      if (v.mode !== 'floor') {
        const fk = floorKeyOfUnit(key);
        if (fk) sf?.(fk);
      }
    },
    [suggestTower],
  );
  const onTapFloor = useCallback(
    (key: string) => {
      if (suggestTower(towerKeyOf('floor', key))) return;
      if (latest.current.view.mode !== 'floor') latest.current.onSelectFloor?.(key);
    },
    [suggestTower],
  );
  const onTapTower = useCallback(
    (key: string) => {
      suggestTower(key);
    },
    [suggestTower],
  );

  const emitView = useCallback((camera: CameraPreset) => {
    const { view: v, selectedUnit: s } = latest.current;
    callbacks.current.onViewChange?.({
      mode: v.mode,
      activeTower: v.mode === 'building' ? null : (v.tower?.key ?? null),
      activeFloor: v.floor?.key ?? null,
      selectedUnit: s,
      camera,
    });
  }, []);
  const onTransitionEnd = useCallback(
    (camera: CameraPreset) => {
      callbacks.current.onModeChange?.(latest.current.view.mode);
      emitView(camera);
    },
    [emitView],
  );

  const isFloorMode = effectiveMode === 'floor';

  // Torre × entorno pela projeção no chão de cada torre (TOWER__ + FLOOR__, margem de 2 m).
  const towerContext = useMemo<TowerContext>(() => {
    const footprints = [...towers.values()].map((t) => t.footprint);
    // Topo do primeiro andar: malha única que cruza vários blocos e sobe acima dele é torre.
    const tops = [...levels.values()].map((l) => l.top);
    const options: ZoneOptions = tops.length ? { spanMinTop: Math.min(...tops) } : {};
    return {
      footprints,
      options,
      single: towers.size > 1 ? undefined : (towers.keys().next().value ?? null),
      assign: (x, z) => towerAtPoint([x, z], towers),
    };
  }, [towers, levels]);
  const structure = useMemo(
    () => zonedPieces(model.structure, towerContext),
    [model, towerContext],
  );
  // Silhueta de cada bloco (unidades, lajes, núcleo e estrutura dele): só com vários blocos.
  const ghosts = useMemo(
    () =>
      multiTower
        ? buildGhostGeometries([
            ...[...model.units, ...model.floors].map((part) => ({
              part,
              tower: towerKeyOf(part.kind, part.objectKey),
            })),
            ...structure.filter((p) => p.zone === 'tower'),
          ])
        : null,
    [multiTower, model, structure],
  );
  useEffect(
    () => () => {
      for (const g of ghosts?.values() ?? []) g.dispose();
    },
    [ghosts],
  );

  // ---- Lotes (batch.ts): menos draw calls ------------------------------------------
  // Vértices de cada peça em coordenadas de mundo, calculados uma vez por modelo.
  const modelId = gltf.scene.uuid;
  const unitItems = useMemo(
    () =>
      model.units.map((part) => ({
        key: part.objectKey!,
        part,
        arrays: partArrays(part.geometry, part.matrix, 15),
      })),
    [model],
  );
  const slabItems = useMemo(
    () =>
      model.floors.map((part, i) => ({
        key: part.objectKey ?? `~f${i}`,
        part,
        arrays: partArrays(part.geometry, part.matrix, 15),
      })),
    [model],
  );
  const structureItems = useMemo(
    () =>
      structure
        .filter((p) => p.zone === 'tower')
        .map((p, i) => ({
          // Núcleo TOWER__: a chave é o código do bloco (toque sugere o bloco).
          key: p.part.kind === 'tower' && p.part.objectKey ? p.part.objectKey : `~s${i}`,
          tower: p.tower,
          arrays: partArrays(p.part.geometry, p.part.matrix, 15),
        })),
    [structure],
  );

  // Unidades: um lote por bloco e classe visual; a selecionada fica fora (desenhada à parte).
  const unitBatches = useMemo(
    () =>
      groupBatches(unitItems, (it) => {
        const fk = floorKeyOfUnit(it.key);
        const tower = towerKeyOf('unit', it.key);
        const cls = unitClass(
          partView(fk ? levels.get(fk) : undefined, tower, view, cut),
          unitStatus[it.key],
          it.key === selectedUnit,
          dimmedUnits.has(it.key),
        );
        return cls && cls !== 'selected' ? `${tower ?? ''}|${cls}` : null;
      }),
    [unitItems, levels, view, cut, unitStatus, selectedUnit, dimmedUnits],
  );
  const selectedPart = useMemo(() => {
    if (!selectedUnit) return null;
    const it = unitItems.find((u) => u.key === selectedUnit);
    if (!it) return null;
    const fk = floorKeyOfUnit(it.key);
    const cls = unitClass(
      partView(fk ? levels.get(fk) : undefined, towerKeyOf('unit', it.key), view, cut),
      unitStatus[it.key],
      true,
      false,
    );
    return cls === 'selected' ? it.part : null;
  }, [selectedUnit, unitItems, levels, view, cut, unitStatus]);

  // Lajes: um lote por classe (normal, abaixo do andar, de outro bloco).
  const slabBatches = useMemo(
    () =>
      groupBatches(slabItems, (it) =>
        slabClass(
          partView(
            it.part.objectKey ? levels.get(it.part.objectKey) : undefined,
            towerKeyOf('floor', it.part.objectKey),
            view,
            cut,
          ),
        ),
      ),
    [slabItems, levels, view, cut],
  );
  // Estrutura da torre (núcleos, cobertura): um lote só, fora os blocos em silhueta.
  const structureBatch = useMemo(
    () =>
      groupBatches(structureItems, (it) => (isGhost(cut, it.tower) ? null : 'structure')).get(
        'structure',
      ),
    [structureItems, cut],
  );
  const clipPlanes = useMemo(() => [materials.planes.top, materials.planes.bottom], [materials]);
  const onTapStructure = useCallback(
    (key: string) => {
      if (towers.has(key)) onTapTower(key);
    },
    [towers, onTapTower],
  );

  return (
    <>
      <CameraRig
        bounds={bounds}
        manifest={manifest}
        view={view}
        towerAzimuth={towerAzimuth}
        autoRotate={autoRotate}
        initialCamera={initialCamera}
        insets={insets}
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
              towerContext={towerContext}
              cut={cut}
              showLower={isFloorMode}
              onReady={onDetailReady}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {ghosts && <GhostLayer geometries={ghosts} cut={cut} materials={materials} />}
      {structure.map(({ part, zone }, i) =>
        zone === 'site' ? (
          <SitePart key={`s${i}`} part={part} material={materials.site} blocking threshold={15} />
        ) : null,
      )}
      {structureBatch && (
        <Batch
          signature={`${modelId}|${structureBatch.signature}`}
          items={structureBatch.items}
          material={materials.structure}
          edgeColor={BRAND.musgo}
          edgeClip={clipPlanes}
          raycast="clipped"
          rangeRef={rangeRef}
          onTap={multiTower ? onTapStructure : undefined}
          lowerPass={isFloorMode ? materials.lowerClipped : null}
        />
      )}
      {[...slabBatches].map(([cls, b]) => {
        const st = slabStyle(cls as SlabClass, materials, !isFloorMode);
        return (
          <Batch
            key={cls}
            signature={`${modelId}|${b.signature}`}
            items={b.items}
            material={st.material}
            edgeColor={st.edgeColor}
            raycast={st.raycast}
            onTap={st.tappable ? onTapFloor : undefined}
            pointer={st.tappable}
          />
        );
      })}
      {[...unitBatches].map(([group, b]) => {
        const st = unitStyle(group.slice(group.indexOf('|') + 1) as UnitClass, materials);
        return (
          <Batch
            key={group}
            signature={`${modelId}|${b.signature}`}
            items={b.items}
            material={st.material}
            edgeColor={st.edgeColor}
            raycast={st.raycast}
            onTap={st.tappable ? onTapUnit : undefined}
            pointer={st.tappable}
          />
        );
      })}
      {selectedPart && (
        <SelectedUnit
          part={selectedPart}
          status={unitStatus[selectedPart.objectKey!]!}
          materials={materials}
          onTap={onTapUnit}
        />
      )}
      {multiTower && towerLabels && effectiveMode === 'building' && (
        <TowerLabels
          towers={towers}
          adjacency={adjacency}
          labels={towerLabels}
          onTap={onTapTower}
        />
      )}
    </>
  );
}

/**
 * Rótulos curtos dos blocos na vista geral (HTML sobre o canvas: não custam draw calls nem
 * texturas). O rótulo também é um alvo de toque maior que o bloco no celular.
 */
const TowerLabels = memo(function TowerLabels({
  towers,
  adjacency,
  labels,
  onTap,
}: {
  towers: Map<string, TowerInfo>;
  adjacency: Map<string, string[]>;
  labels: Record<string, TowerLabel>;
  onTap: (towerKey: string) => void;
}) {
  return (
    <>
      {[...towers.values()].map((t) => {
        const l = labels[t.key];
        if (!l) return null;
        return (
          <Html
            key={t.key}
            // Perto da ponta externa do bloco, longe do vizinho colado.
            position={towerLabelPosition(
              t,
              (adjacency.get(t.key) ?? []).map((k) => towers.get(k)!),
            )}
            center
            // Fica abaixo da interface do app (folha inferior, cabeçalho).
            zIndexRange={[1, 0]}
          >
            <button
              type="button"
              title={l.title ?? l.label}
              aria-label={l.title ?? l.label}
              onClick={() => onTap(t.key)}
              style={TOWER_LABEL_STYLE}
            >
              {l.label}
            </button>
          </Html>
        );
      })}
    </>
  );
});

/**
 * Silhuetas dos blocos fora do corte (modo andar): uma malha por bloco, primeiro só a
 * profundidade, depois a cor semitransparente só na face mais próxima. Sem cor de status,
 * sem contorno, sem toque.
 */
const GhostLayer = memo(function GhostLayer({
  geometries,
  cut,
  materials,
}: {
  geometries: Map<string, BufferGeometry>;
  cut: ReadonlySet<string> | null;
  materials: ViewerMaterials;
}) {
  if (!cut) return null;
  return (
    <>
      {[...geometries]
        .filter(([key]) => !cut.has(key))
        .map(([key, geometry]) => (
          <Fragment key={key}>
            <mesh
              geometry={geometry}
              material={materials.ghostDepth}
              renderOrder={GHOST_RENDER_ORDER}
              raycast={noRaycast}
            />
            <mesh
              geometry={geometry}
              material={materials.ghost}
              renderOrder={GHOST_RENDER_ORDER + 1}
              raycast={noRaycast}
            />
          </Fragment>
        ))}
    </>
  );
});

const TOWER_LABEL_STYLE: CSSProperties = {
  font: '500 10px/1 "IBM Plex Mono", ui-monospace, monospace',
  color: BRAND.musgo,
  background: BRAND.papel,
  border: `1px solid ${BRAND.musgo}`,
  padding: '2px 3px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  userSelect: 'none',
};

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
  towerContext,
  cut,
  showLower,
  onReady,
}: {
  url: string;
  manifest: ViewerManifest;
  materials: ViewerMaterials;
  towerContext: TowerContext;
  cut: ReadonlySet<string> | null;
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

  // Malha única com vários blocos (ex.: VIS__ESQUADRIAS) vira uma peça por bloco: cada
  // bloco é recortado ou vira silhueta sozinho.
  const parts = useMemo(
    () => zonedPieces([...model.structure, ...model.floors], towerContext),
    [model, towerContext],
  );
  const ghosts = useMemo(
    () =>
      towerContext.single === undefined
        ? buildGhostGeometries(parts.filter((p) => p.zone === 'tower'))
        : null,
    [parts, towerContext],
  );
  // As peças divididas compartilham os atributos da malha original (cache do GLB): não são
  // descartadas aqui; as silhuetas são cópias próprias e são.
  useEffect(
    () => () => {
      for (const g of ghosts?.values() ?? []) g.dispose();
    },
    [ghosts],
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

  // Lotes por material do GLB e zona (torre recortada × entorno); blocos em silhueta saem.
  const items = useMemo(
    () =>
      parts.map((p, i) => ({
        key: `~d${i}`,
        piece: p,
        arrays: partArrays(p.part.geometry, p.part.matrix, 30),
      })),
    [parts],
  );
  const batches = useMemo(
    () =>
      groupBatches(items, (it) => {
        if (it.piece.zone === 'tower' && isGhost(cut, it.piece.tower)) return null;
        return `${it.piece.zone}|${it.piece.part.sourceMaterial?.uuid ?? ''}`;
      }),
    [items, cut],
  );
  const clipPlanes = useMemo(() => [materials.planes.top, materials.planes.bottom], [materials]);

  return (
    <>
      {ghosts && <GhostLayer geometries={ghosts} cut={cut} materials={materials} />}
      {[...batches].map(([group, b]) => {
        const tower = group.startsWith('tower|');
        const first = b.items[0]!.piece;
        return (
          <Batch
            key={group}
            signature={`${gltf.scene.uuid}|${b.signature}`}
            items={b.items}
            material={materialFor(first.part, first.zone)}
            edgeColor={BRAND.musgo}
            edgeClip={tower ? clipPlanes : null}
            raycast="none"
            lowerPass={tower && showLower ? materials.lowerClipped : null}
          />
        );
      })}
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

interface BatchStyle {
  material: Material;
  /** Cor do contorno; null = sem contorno. */
  edgeColor: string | null;
  /** 'none': não recebe toque; 'default': recebe (e tapa o que está atrás). */
  raycast: 'none' | 'default';
  /** Toque chama o handler (unidade/laje); senão só tapa. */
  tappable: boolean;
}

/** Aparência de um lote de unidades (mesmas regras de antes, por unidade). */
function unitStyle(cls: UnitClass, materials: ViewerMaterials): BatchStyle {
  switch (cls) {
    case 'lower':
      // Abaixo do andar ativo: silhueta clara, sem contorno, sem toque.
      return { material: materials.lower, edgeColor: null, raycast: 'none', tappable: false };
    case 'context':
      // Outro bloco no modo bloco: contorno suave; tocar troca o bloco.
      return {
        material: materials.lower,
        edgeColor: FILTERED_OUTLINE,
        raycast: 'default',
        tappable: true,
      };
    case 'filtered':
      return {
        material: materials.filtered,
        edgeColor: FILTERED_OUTLINE,
        raycast: 'default',
        tappable: true,
      };
    case 'nostatus':
      // Sem status informado: como indisponível, não selecionável (mas tapa o toque).
      return {
        material: materials.status.unavailable,
        edgeColor: unitAppearance('unavailable', false).outline.color,
        raycast: 'default',
        tappable: false,
      };
    case 'selected':
      throw new Error('unidade selecionada não entra em lote');
    default: {
      const status = cls.slice('status:'.length) as UnitStatus;
      return {
        material: materials.status[status],
        edgeColor: unitAppearance(status, false).outline.color,
        raycast: 'default',
        tappable: true,
      };
    }
  }
}

/** Aparência de um lote de lajes. `interactive`: fora do modo andar, tocar sugere o andar. */
function slabStyle(cls: SlabClass, materials: ViewerMaterials, interactive: boolean): BatchStyle {
  if (cls === 'lower') {
    return { material: materials.lower, edgeColor: null, raycast: 'none', tappable: false };
  }
  return {
    material: cls === 'context' ? materials.lower : materials.slab,
    edgeColor: cls === 'context' ? FILTERED_OUTLINE : BRAND.musgo,
    raycast: 'default',
    tappable: interactive,
  };
}

interface BatchProps {
  /** Membros do lote (e o modelo): muda → o lote é refeito. */
  signature: string;
  items: BatchItem[];
  material: Material;
  edgeColor?: string | null;
  /** Planos de corte do contorno (estrutura e detalhes da torre). */
  edgeClip?: Plane[] | null;
  /** 'clipped': ignora o que está fora da faixa do andar (rangeRef), como a estrutura. */
  raycast?: 'none' | 'default' | 'clipped';
  rangeRef?: RangeRef;
  /** Toque numa peça do lote: recebe a chave dela (object_key). */
  onTap?: (key: string) => void;
  pointer?: boolean;
  /** Segunda passada esmaecida (abaixo do andar ativo), com a mesma malha. */
  lowerPass?: Material | null;
}

/**
 * Lote: uma malha e um contorno para várias peças com a mesma aparência. O toque descobre a
 * peça pelo triângulo atingido (keys[faceIndex]).
 */
const Batch = memo(
  function Batch({
    signature,
    items,
    material,
    edgeColor = null,
    edgeClip = null,
    raycast = 'none',
    rangeRef,
    onTap,
    pointer = false,
    lowerPass = null,
  }: BatchProps) {
    const clippedRaycast = useMemo(
      () => (rangeRef ? makeClippedRaycast(rangeRef) : undefined),
      [rangeRef],
    );
    // A assinatura cobre os itens (o array muda a cada render; os membros, não).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const merged = useMemo(() => mergeBatch(items), [signature]);
    useEffect(() => () => merged.geometry.dispose(), [merged]);
    const blocking = raycast !== 'none';
    return (
      <>
        <mesh
          geometry={merged.geometry}
          material={material}
          raycast={
            raycast === 'none' ? noRaycast : raycast === 'clipped' ? clippedRaycast : undefined
          }
          onClick={
            blocking
              ? (e) => {
                  e.stopPropagation();
                  const key = e.faceIndex != null ? merged.keys[e.faceIndex] : undefined;
                  if (onTap && key && !key.startsWith('~') && e.delta <= TAP_TOLERANCE_PX) {
                    onTap(key);
                  }
                }
              : undefined
          }
          onPointerOver={
            blocking
              ? (e) => {
                  e.stopPropagation();
                  if (pointer) document.body.style.cursor = 'pointer';
                }
              : undefined
          }
          onPointerOut={
            blocking
              ? () => {
                  document.body.style.cursor = '';
                }
              : undefined
          }
        />
        {edgeColor && merged.edges.length > 0 && (
          <BatchEdges positions={merged.edges} color={edgeColor} clip={edgeClip} />
        )}
        {lowerPass && <mesh geometry={merged.geometry} material={lowerPass} raycast={noRaycast} />}
      </>
    );
  },
  (a, b) =>
    a.signature === b.signature &&
    a.material === b.material &&
    a.edgeColor === b.edgeColor &&
    a.edgeClip === b.edgeClip &&
    a.raycast === b.raycast &&
    a.rangeRef === b.rangeRef &&
    a.onTap === b.onTap &&
    a.pointer === b.pointer &&
    a.lowerPass === b.lowerPass,
);

/** Contorno de um lote: as mesmas linhas do <Edges> do drei (1 px de tela), num draw call. */
function BatchEdges({
  positions,
  color,
  clip,
}: {
  positions: Float32Array;
  color: string;
  clip: Plane[] | null;
}) {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const line = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial();
    material.color = new Color(color);
    material.linewidth = 1;
    if (clip) material.clippingPlanes = clip;
    const l = new LineSegments2(geometry, material);
    l.computeLineDistances();
    l.raycast = noRaycast as unknown as LineSegments2['raycast'];
    return l;
  }, [positions, color, clip]);
  useLayoutEffect(() => {
    line.material.resolution.set(width, height);
  }, [line, width, height]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

/** Unidade selecionada: fora dos lotes (Latão, contorno grosso, desenhada por cima). */
const SelectedUnit = memo(function SelectedUnit({
  part,
  status,
  materials,
  onTap,
}: {
  part: ScenePart;
  status: UnitStatus;
  materials: ViewerMaterials;
  onTap: (objectKey: string) => void;
}) {
  const appearance = unitAppearance(status, true);
  return (
    <mesh
      geometry={part.geometry}
      matrix={part.matrix}
      matrixAutoUpdate={false}
      material={materials.selected}
      renderOrder={1}
      onClick={(e) => {
        e.stopPropagation();
        if (part.objectKey && e.delta <= TAP_TOLERANCE_PX) onTap(part.objectKey);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      <Edges
        color={appearance.outline.color}
        lineWidth={appearance.outline.width}
        threshold={15}
        renderOrder={2}
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
  view,
  towerAzimuth,
  autoRotate,
  initialCamera,
  insets,
  onTransitionEnd,
  onInteractionEnd,
}: {
  bounds: { min: Vec3; max: Vec3 };
  manifest: ViewerManifest;
  view: ResolvedView;
  /** Modo bloco: ângulo horizontal fixo (lado de fora do par); sem valor, o atual. */
  towerAzimuth?: number;
  autoRotate: boolean;
  initialCamera?: CameraPreset;
  insets: string;
  onTransitionEnd: (camera: CameraPreset) => void;
  onInteractionEnd: (camera: CameraPreset) => void;
}) {
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const anim = useRef<Anim | null>(null);
  const framing = useRef<Framing | null>(null);
  const appliedKey = useRef<string | null>(null);
  const { mode, floor: active, tower } = view;
  // Nos modos andar e bloco, a área livre (insets) entra na chave: abrir/fechar a ficha
  // reenquadra. No modo edifício só o centro se ajusta (ViewOffset), sem desfazer o zoom.
  const viewKey =
    mode === 'floor'
      ? `floor|${active?.key ?? ''}|${insets}`
      : mode === 'tower'
        ? `tower|${tower?.key ?? ''}|${insets}`
        : 'building';

  const framingFor = useCallback(
    (azimuth?: number, usePreset = false): Framing => {
      const { camera, size } = get();
      // Enquadra na área livre (descontando a interface do app por cima do 3D).
      const [t, r, b, l] = insets.split(',').map(Number) as [number, number, number, number];
      const visW = Math.max(size.width - l - r, 1);
      const visH = Math.max(size.height - t - b, 1);
      const fullFov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
      const visHeightFraction = Math.min(visH / Math.max(size.height, 1), 1);
      const fov = (2 * Math.atan(Math.tan(fullFov / 2) * visHeightFraction) * 180) / Math.PI;
      const aspect = visW / visH;
      if (mode === 'floor' && active) {
        return computeFloorFraming(active, fov, aspect, azimuth ?? 0.56);
      }
      if (mode === 'tower' && tower) {
        return computeFraming(tower.bounds, fov, aspect, undefined, towerAzimuth ?? azimuth);
      }
      return computeFraming(
        bounds,
        fov,
        aspect,
        usePreset ? manifest.cameras?.default : undefined,
        azimuth,
      );
    },
    [get, mode, active, tower, towerAzimuth, bounds, manifest.cameras?.default, insets],
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

/**
 * Desloca o centro da projeção para o meio da área livre (insets): o que está enquadrado
 * aparece acima da folha inferior, ao lado da coluna de andares etc. Não move a câmera.
 */
function ViewOffset({ insets }: { insets: string }) {
  const get = useThree((s) => s.get);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const cam = get().camera as PerspectiveCamera;
    const [t, r, b, l] = insets.split(',').map(Number) as [number, number, number, number];
    if (!t && !r && !b && !l) cam.clearViewOffset();
    else cam.setViewOffset(width, height, (r - l) / 2, (b - t) / 2, width, height);
    invalidate();
  }, [get, insets, width, height, invalidate]);
  return null;
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
