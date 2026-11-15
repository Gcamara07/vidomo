/**
 * @vidomo/viewer — visualizador 3D desacoplado (regra 5 do CLAUDE.md).
 * Não importa Supabase nem conhece o banco: entrada = manifesto + mapa de status,
 * saída = eventos.
 */
export {
  Viewer,
  preloadModel,
  type ViewerMode,
  type ViewerProps,
  type ViewerStats,
  type ViewerViewState,
} from './Viewer';
export { computeFloorLevels, type FloorLevel } from './floors';
export { classifyZone, towerFootprint, type Footprint, type PartZone } from './site';
export {
  UNIT_STATUSES,
  type CameraPreset,
  type UnitStatus,
  type UnitStatusMap,
  type Vec3,
  type ViewerManifest,
} from './types';
export {
  BRAND,
  PAPER_BACKGROUND,
  swatchBackground,
  SELECTED_APPEARANCE,
  STATUS_APPEARANCE,
  STATUS_LABELS,
  unitAppearance,
  type UnitAppearance,
  type UnitFill,
} from './styles';
export * from './naming';
