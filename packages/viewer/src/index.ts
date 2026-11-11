/**
 * @vidomo/viewer — visualizador 3D desacoplado (regra 5 do CLAUDE.md).
 * Não importa Supabase nem conhece o banco: entrada = manifesto + mapa de status,
 * saída = eventos. O componente <Viewer> chega na Etapa 4.
 */

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

export interface ViewerManifest {
  /** URL já resolvida pelo app via getAssetUrl(). */
  modelUrl: string;
  cameras?: Record<
    string,
    { position: [number, number, number]; target: [number, number, number] }
  >;
  objectKeyPrefixes?: Partial<Record<'unit' | 'floor' | 'tower' | 'amenity' | 'visual', string>>;
}
