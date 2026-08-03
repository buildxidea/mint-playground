import type * as THREE from 'three';

export const KINETIC_HALL_PROP_IDS = [
  'powered-sliding-obstacle-sled',
  'modular-weighted-safety-barrier',
  'instrumented-slalom-cone',
  'adjustable-low-clearance-gantry',
  'fiducial-inspection-placard',
  'precision-docking-target',
  'rugged-instrument-case',
  'emergency-stop-pedestal',
  'traversable-training-ramp',
] as const;

export type KineticHallPropId = (typeof KINETIC_HALL_PROP_IDS)[number];

export type MintPropGeometryStats = Readonly<{
  nodes: number;
  meshes: number;
  primitives: number;
  materials: number;
  textures: number;
  animations: number;
  skins: number;
}>;

export type MintPropCapabilities = Readonly<{
  rigidPropReady: true;
  articulatedInteractionReady: false;
  note: string;
}>;

export type MintPropAsset = Readonly<{
  index: number;
  id: string;
  label: string;
  itemRecordId: string;
  modelId: string;
  finalAssetId: string;
  artifactId: string;
  publicUrl: string;
  filePath: `public/models/props/${string}.glb`;
  evidencePath: `data/mint/finals/${string}/artifact-manifest.json`;
  byteSize: number;
  sha256: string;
  staged: true;
  extensionsUsed: readonly string[];
  extensionsRequired: readonly string[];
  usesDraco: false;
  requiresDraco: false;
  geometry: MintPropGeometryStats;
  capabilities: MintPropCapabilities;
}>;

export type KineticHallPropGeometryStats = MintPropGeometryStats;
export type KineticHallPropCapabilities = MintPropCapabilities;
export type KineticHallPropAsset = MintPropAsset &
  Readonly<{
    id: KineticHallPropId;
    publicUrl: string;
    filePath: `public/models/props/kinetic-hall/${string}.glb`;
    evidencePath: `data/mint/finals/kinetic-hall/${string}/artifact-manifest.json`;
  }>;

export type Vector3Tuple = readonly [number, number, number];
export type QuaternionTuple = readonly [number, number, number, number];

export type MintPropResetPose = Readonly<{
  position: Vector3Tuple;
  quaternion: QuaternionTuple;
  scale: Vector3Tuple;
}>;

export type MintPropPlacement = Readonly<{
  instanceId: string;
  assetId: string;
  resetPose: MintPropResetPose;
}>;

export type KineticHallPropResetPose = MintPropResetPose;
export type KineticHallPropPlacement = MintPropPlacement &
  Readonly<{
    assetId: KineticHallPropId;
  }>;

export type MintPropPackDefinition = Readonly<{
  roomId: 'kinetic-hall' | 'precision-cell' | 'crisis-bay';
  assetPackId: string;
  name: string;
  itemCount: number;
  inventory: readonly MintPropAsset[];
  byId: Readonly<Record<string, MintPropAsset>>;
  supplementalModelIds?: readonly string[];
}>;

export interface MintPropInstance {
  readonly placement: MintPropPlacement;
  readonly asset: MintPropAsset;
  readonly root: THREE.Group;
  readonly imported: THREE.Object3D;
  reset(): void;
}

export interface ActiveMintPropSession {
  readonly root: THREE.Group;
  readonly instances: readonly MintPropInstance[];
  reset(): void;
}
