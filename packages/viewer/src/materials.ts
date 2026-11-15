/**
 * Materiais do viewer: um por status + seleção + estrutura, criados uma vez e
 * compartilhados. Mudar o status de uma unidade só troca a referência do material.
 *
 * MeshBasicMaterial (sem luz) + Canvas `flat` (sem tone mapping) → cor chapada idêntica
 * aos hex da marca. Hachuras vêm de textura gerada em canvas (sem arquivo de imagem).
 */
import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  Plane,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { BRAND, SELECTED_APPEARANCE, STATUS_APPEARANCE, type UnitFill } from './styles';
import { UNIT_STATUSES, type UnitStatus } from './types';

/** Tamanho do ladrilho da hachura, em metros (as UVs das unidades estão em metros). */
export const HATCH_TILE_METERS = 0.45;
const HATCH_PX = 64;

export function createHatchTexture(
  fill: Extract<UnitFill, { kind: 'hatch' }>,
  anisotropy = 4,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = HATCH_PX;
  const ctx = canvas.getContext('2d')!;
  const s = HATCH_PX;

  ctx.fillStyle = fill.background;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = fill.color;
  ctx.lineWidth = s * 0.2;
  ctx.lineCap = 'square';
  // Uma diagonal por ladrilho, repetida nos vizinhos para emendar sem costura.
  for (const k of [-1, 0, 1]) {
    ctx.beginPath();
    if (fill.angle === 45) {
      ctx.moveTo(k * s, s);
      ctx.lineTo(k * s + s, 0);
    } else {
      ctx.moveTo(k * s, 0);
      ctx.lineTo(k * s + s, s);
    }
    ctx.stroke();
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(1 / HATCH_TILE_METERS, 1 / HATCH_TILE_METERS);
  tex.anisotropy = anisotropy;
  return tex;
}

function fillMaterial(fill: UnitFill, anisotropy: number): MeshBasicMaterial {
  const mat =
    fill.kind === 'solid'
      ? new MeshBasicMaterial({ color: fill.color })
      : new MeshBasicMaterial({ color: '#FFFFFF', map: createHatchTexture(fill, anisotropy) });
  // Empurra as faces para trás para o contorno não "brigar" com elas (z-fighting).
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 1;
  mat.polygonOffsetUnits = 1;
  return mat;
}

/**
 * Planos de corte por altura do modo andar (compartilhados; só as constantes mudam, então
 * os shaders não recompilam ao trocar de andar). No modo edifício ficam "abertos" (±1e6).
 * Convenção do three: o que fica do lado negativo do plano é recortado.
 */
export interface ClipPlanes {
  /** Mantém y ≤ topo do andar ativo (some o que está acima). */
  top: Plane;
  /** Mantém y ≥ base do andar ativo (a passada normal não desenha o que está abaixo). */
  bottom: Plane;
  /** Mantém y ≤ base do andar ativo (passada esmaecida do que está abaixo). */
  below: Plane;
}

const OPEN = 1e6;

export function createClipPlanes(): ClipPlanes {
  return {
    top: new Plane(new Vector3(0, -1, 0), OPEN),
    bottom: new Plane(new Vector3(0, 1, 0), OPEN),
    below: new Plane(new Vector3(0, -1, 0), OPEN),
  };
}

/** Ajusta os planos para a faixa [bottom, top]; null = sem recorte (modo edifício). */
export function setClipRange(planes: ClipPlanes, range: { bottom: number; top: number } | null) {
  planes.top.constant = range ? range.top : OPEN;
  planes.bottom.constant = range ? -range.bottom : OPEN;
  planes.below.constant = range ? range.bottom : OPEN;
}

/**
 * Abaixo do andar ativo: silhueta opaca clara (Areia clareada com Papel), sem contorno.
 * Opaca para não acumular transparência entre andares e para o andar ativo não parecer
 * flutuando; clara para dar contexto sem competir com as cores de status.
 */
export const LOWER_FILL = '#E4DED3';
/** Unidade fora dos filtros: sem cor de status, Areia claro, contorno suave. */
export const FILTERED_FILL = '#ECE8E0';
export const FILTERED_OUTLINE = '#B5AE9F';

export interface ViewerMaterials {
  status: Record<UnitStatus, MeshBasicMaterial>;
  selected: MeshBasicMaterial;
  slab: MeshBasicMaterial;
  /** Estrutura da torre (núcleo, cobertura, térreo), recortada no modo andar. */
  structure: MeshBasicMaterial;
  /** Estrutura do entorno (fora da projeção da torre): nunca recortada. */
  site: MeshBasicMaterial;
  /** Unidades e lajes abaixo do andar ativo. */
  lower: MeshBasicMaterial;
  /** Estrutura e detalhes abaixo do andar ativo (com recorte por altura). */
  lowerClipped: MeshBasicMaterial;
  /** Unidades fora dos filtros (dimmedUnits). */
  filtered: MeshBasicMaterial;
  planes: ClipPlanes;
  dispose(): void;
}

function lowerMaterial(anisotropy: number): MeshBasicMaterial {
  const m = fillMaterial({ kind: 'solid', color: LOWER_FILL }, anisotropy);
  m.name = 'vidomo_lower';
  return m;
}

export function createViewerMaterials(anisotropy = 4): ViewerMaterials {
  const planes = createClipPlanes();
  const status = Object.fromEntries(
    UNIT_STATUSES.map((s) => [s, fillMaterial(STATUS_APPEARANCE[s].fill, anisotropy)]),
  ) as Record<UnitStatus, MeshBasicMaterial>;
  const selected = fillMaterial(SELECTED_APPEARANCE.fill, anisotropy);
  const slab = fillMaterial({ kind: 'solid', color: BRAND.papel }, anisotropy);
  const structure = fillMaterial({ kind: 'solid', color: BRAND.linho }, anisotropy);
  structure.clippingPlanes = [planes.top, planes.bottom];
  const site = fillMaterial({ kind: 'solid', color: BRAND.linho }, anisotropy);
  const lower = lowerMaterial(anisotropy);
  const lowerClipped = lowerMaterial(anisotropy);
  lowerClipped.clippingPlanes = [planes.below];
  const filtered = fillMaterial({ kind: 'solid', color: FILTERED_FILL }, anisotropy);

  const all: Material[] = [
    ...Object.values(status),
    selected,
    slab,
    structure,
    site,
    lower,
    lowerClipped,
    filtered,
  ];
  return {
    status,
    selected,
    slab,
    structure,
    site,
    lower,
    lowerClipped,
    filtered,
    planes,
    dispose() {
      for (const m of all) {
        (m as MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    },
  };
}

/**
 * Versão chapada (sem luz) de um material do GLB: mantém cor, textura, cores por vértice,
 * transparência e lados, como o resto do viewer (cor idêntica à exportada, sem sombreamento).
 */
export function toFlatMaterial(src: Material): MeshBasicMaterial {
  const s = src as Material & {
    color?: Color;
    map?: Texture | null;
  };
  const mat = new MeshBasicMaterial({
    color: s.color ? s.color.clone() : new Color('#FFFFFF'),
    map: s.map ?? null,
    vertexColors: src.vertexColors,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    side: src.side,
  });
  mat.name = src.name;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 1;
  mat.polygonOffsetUnits = 1;
  return mat;
}
