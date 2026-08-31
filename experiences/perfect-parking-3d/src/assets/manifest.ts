/**
 * Semantic runtime map for Mint artifacts.
 * Paths are filled after download; loaders never call Mint MCP.
 */

export type ModelKey =
  | 'compact_car'
  | 'sports_car'
  | 'delivery_van'
  | 'parking_bay'
  | 'traffic_cone'
  | 'concrete_barrier'
  | 'bollard'
  | 'parking_booth'
  | 'asphalt_lot'
  | 'curb_piece';

export type AudioKey = 'engine' | 'tire' | 'collision' | 'success' | 'countdown';

export type ModelEntry = {
  path: string;
  /** Authored forward axis in model space after normalize. */
  forward: 'negZ' | 'posZ' | 'negX' | 'posX';
  /** Target length along gameplay forward for vehicles / props (meters). */
  targetSize: number;
  /** Canonical gameplay width for vehicles after forward normalization (meters). */
  targetWidth?: number;
};

export const MODEL_MANIFEST: Record<ModelKey, ModelEntry> = {
  // Mint vehicles: compact/sports authored nose-along -X; van along +X.
  // Gameplay yaw 0 faces +Z after the bake in normalizeModel.
  compact_car: {
    path: 'https://cdn.mint.gg/glb/compact-car-normalized-7401cbe979d5d7a6.glb',
    forward: 'negX',
    targetSize: 3.8,
    targetWidth: 1.7,
  },
  sports_car: {
    path: 'https://cdn.mint.gg/glb/sports-car-normalized-0269e27ab217e5e3.glb',
    forward: 'negX',
    targetSize: 4.2,
    targetWidth: 1.85,
  },
  delivery_van: {
    path: 'https://cdn.mint.gg/glb/delivery-van-normalized-4c0db986de5a53c7.glb',
    forward: 'posX',
    targetSize: 5.0,
    targetWidth: 2.15,
  },
  // Same authored +X length as vehicles; bay length must run along gameplay forward.
  parking_bay: { path: 'https://cdn.mint.gg/glb/parking-bay-normalized-f4175390d328b379.glb', forward: 'posX', targetSize: 6.2 },
  traffic_cone: { path: 'https://cdn.mint.gg/glb/traffic-cone-normalized-8c39652dafb5328e.glb', forward: 'negZ', targetSize: 0.85 },
  concrete_barrier: { path: 'https://cdn.mint.gg/glb/concrete-barrier-normalized-0c9947193604950b.glb', forward: 'negZ', targetSize: 2.2 },
  bollard: { path: 'https://cdn.mint.gg/glb/bollard-normalized-600b00c481aa06a6.glb', forward: 'negZ', targetSize: 0.9 },
  parking_booth: { path: 'https://cdn.mint.gg/glb/parking-booth-normalized-501be53ce401e999.glb', forward: 'negZ', targetSize: 3.2 },
  asphalt_lot: { path: 'https://cdn.mint.gg/glb/asphalt-lot-normalized-b4ad9dfcef4d950e.glb', forward: 'negZ', targetSize: 32 },
  curb_piece: { path: 'https://cdn.mint.gg/glb/curb-piece-normalized-ea0a71772864cbae.glb', forward: 'negZ', targetSize: 3.0 },
};

export const AUDIO_MANIFEST: Record<AudioKey, string> = {
  engine: 'https://cdn.mint.gg/audio/xd7f25zgmyv4yttz6yf68vpfax8bx0jh/engine-loop-fdace1-89fa10138e6b52bc.mp3',
  tire: 'https://cdn.mint.gg/audio/xd7ctsp2wvjxg0gpn7d7ta87hh8bxcxx/tire-scrub-c3f9c9-b29eefeb14f7035b.mp3',
  collision: 'https://cdn.mint.gg/audio/xd7aez6b5c0j4gy42mg45wmcrn8bwh30/collision-20acff-f9afc50ed3cb03d1.mp3',
  success: 'https://cdn.mint.gg/audio/xd79tzsf1gpgef7667mtd0f9f58bx5xq/success-b79aca-934a20e3a81e7bad.mp3',
  countdown: 'https://cdn.mint.gg/audio/xd7437h234d5a8xvbc88015ten8bxk7r/countdown-2d1162-cda88ce37c36f7a4.mp3',
};

export type VehicleId = 'compact' | 'sports' | 'van';

export const VEHICLE_MODEL: Record<VehicleId, ModelKey> = {
  compact: 'compact_car',
  sports: 'sports_car',
  van: 'delivery_van',
};
