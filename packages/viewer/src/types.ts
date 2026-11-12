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

export interface CameraPreset {
  position: Vec3;
  target: Vec3;
}

export interface ViewerManifest {
  /** URL já resolvida pelo app (getAssetUrl() no apps/web). O viewer não monta URLs. */
  modelUrl: string;
  /** `default` é a câmera inicial; sem ela, o viewer enquadra o prédio sozinho. */
  cameras?: { default?: CameraPreset } & Record<string, CameraPreset | undefined>;
  objectKeyPrefixes?: Partial<ObjectKeyPrefixes>;
}
