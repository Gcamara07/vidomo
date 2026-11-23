import type { ObjectKeyPrefixes } from './naming';

export const UNIT_STATUSES = [
  'available',
  'reserved',
  'negotiating',
  'sold',
  'unavailable',
] as const;

export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** object_key (nome do objeto sem o prefixo de tipo) → status. */
export type UnitStatusMap = Record<string, UnitStatus>;

export type Vec3 = [number, number, number];

/**
 * Modo do viewer:
 * - building: o empreendimento inteiro (vista geral);
 * - tower: um bloco enquadrado, os outros esmaecidos (só com 2+ torres no modelo);
 * - floor: um andar, com recorte por altura em todas as torres.
 */
export type ViewerMode = 'building' | 'tower' | 'floor';

export interface CameraPreset {
  position: Vec3;
  target: Vec3;
}

export interface ViewerManifest {
  /**
   * Camada 1 (obrigatória): GLB leve — volumes das unidades, lajes e casca (até 2 MB).
   * Torna o prédio interativo. URL já resolvida pelo app (getAssetUrl()); o viewer não monta URLs.
   */
  modelUrl: string;
  /**
   * Camada 2 (opcional): GLB de detalhes, carregado depois que o prédio já está interativo.
   * Só visual (fachada, varandas, entorno); não bloqueia a interação e, se falhar, o prédio
   * segue só com o modelo leve.
   */
  detailModelUrl?: string;
  /** `default` é a câmera inicial; sem ela, o viewer enquadra o prédio sozinho. */
  cameras?: { default?: CameraPreset } & Record<string, CameraPreset | undefined>;
  objectKeyPrefixes?: Partial<ObjectKeyPrefixes>;
  /**
   * Interiores (maquetes) por tipo de planta, com chave livre (ex.: o id do tipo). Sem
   * interior, o tipo continua como caixa colorida no modo andar.
   */
  interiors?: Record<string, InteriorModelRef>;
  /** Tipo de planta de cada unidade: object_key → chave em `interiors`. */
  unitTypes?: Record<string, string>;
}

export interface InteriorModelRef {
  /** GLB simples (modo andar), URL já resolvida pelo app (getAssetUrl()). */
  simpleUrl: string;
  /** GLB detalhado ("Ver apartamento"), URL já resolvida. */
  detailUrl?: string;
  /**
   * object_key da unidade de referência: o interior foi modelado nas coordenadas do prédio
   * sobre a caixa UNIT__ dela (envoltória de referência). O encaixe nas outras unidades sai
   * da comparação das caixas (fit.ts).
   */
  referenceUnit: string;
}

/**
 * Área da tela coberta por interface do app (em px CSS): cabeçalho, folha inferior, coluna
 * de andares. O viewer centraliza e enquadra o prédio/andar na área livre.
 */
export interface ViewInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}
