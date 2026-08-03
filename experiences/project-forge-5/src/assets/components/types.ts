export const COMPONENT_ROBOT_IDS = ['quadrant-q4', 'forge-t7', 'swift-w2', 'kestrel-d5'] as const;

export type ComponentRobotId = (typeof COMPONENT_ROBOT_IDS)[number];

export type Vector3Tuple = readonly [number, number, number];

export type LocalBounds = Readonly<{
  min: Vector3Tuple;
  max: Vector3Tuple;
}>;

export type ComponentGeometryStats = Readonly<{
  nodes: number;
  meshes: number;
  primitives: number;
  triangles: number;
  materials: number;
  textures: number;
  images: number;
  skins: number;
  animations: number;
}>;

export type ComponentAssetMetadata<Role extends string = string> = Readonly<{
  role: Role;
  publicUrl: string;
  filePath: `public/models/components/${string}.glb`;
  evidencePath: `data/mint/finals/${string}/validation.json`;
  byteSize: number;
  sha256: string;
  geometry: ComponentGeometryStats;
  localBounds: LocalBounds;
}>;

export type ComponentInventoryLike = Readonly<
  Record<string, Readonly<Record<string, ComponentAssetMetadata>>>
>;
