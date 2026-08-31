import type { ModelAssetId } from '../assets/registry';

export type Vec2 = { x: number; z: number };

export type DockPieceDef = {
  model: ModelAssetId;
  x: number;
  z: number;
  yaw: number;
  scale?: number;
  /** Collider half extents in world XZ (and Y height). */
  collider?: { hx: number; hy: number; hz: number };
};

export type PropDef = {
  model: ModelAssetId;
  x: number;
  z: number;
  yaw: number;
  scale?: number;
  buoy?: boolean;
};

export type SlipDef = {
  x: number;
  z: number;
  yaw: number;
  halfWidth: number;
  halfLength: number;
  yawToleranceDeg: number;
  maxHoldSpeed: number;
  holdSeconds: number;
};

export type SwellComponentDef = {
  /** 0..1 normalized harbor swell energy. */
  amplitude: number;
  /** Seconds per crest. */
  period: number;
  /** World-space distance between crests. */
  wavelength: number;
  direction: Vec2;
};

export type WaveDef = {
  /** 0 = calm, ~1 = rough harbor chop. */
  amplitude: number;
  /** Seconds per primary swell. */
  period: number;
  /** Defaults to wind direction when omitted. */
  direction?: Vec2;
  /** Defaults from period when omitted. */
  wavelength?: number;
  /** Additional swell trains crossing the primary swell. */
  secondary?: SwellComponentDef[];
  /** Slow envelope that groups larger crests into readable wave sets. */
  setStrength?: number;
  /** Seconds between the peaks of incoming wave sets. */
  setPeriod?: number;
  /** Mean basin depth in metres; used by finite-depth wave dispersion. */
  depth?: number;
  /** 0..1.35 horizontal Gerstner displacement / crest sharpness. */
  choppiness?: number;
};

export type WindDef = Vec2 & {
  /** Fractional gust increase over the base vector. */
  gust?: number;
  /** Seconds between gust peaks. */
  gustPeriod?: number;
  /** Slow side-to-side change around the base direction. */
  directionShiftDeg?: number;
};

export type TrafficBoatModel = Extract<
  ModelAssetId,
  'boat_red_runabout' | 'boat_teal_skiff' | 'boat_yellow_utility'
>;

export type TrafficBoatDef = {
  model: TrafficBoatModel;
  /** Closed, authored XZ route. Four or more points keeps corners smooth. */
  route: Vec2[];
  /** Cruise speed in world units per second. */
  speed: number;
  /** Normalized start distance around the route. */
  phase: number;
  /** 0..1 local wake energy. */
  wakeStrength: number;
  /** Early traffic yields sooner; steady traffic retains right-of-way. */
  behavior: 'yielding' | 'steady';
};

export type DifficultyDef = {
  rank: number;
  /** Normalized 0..5 axes used by the monotonic challenge validator. */
  route: number;
  precision: number;
  traffic: number;
  weather: number;
};

export type ApproachType = 'bow' | 'stern' | 'parallel';

export type PathShape =
  | 'straight'
  | 'l_bend'
  | 'u_turn'
  | 's_slalom'
  | 'maze'
  | 'dogleg'
  | 'ring'
  | 'parallel_slide'
  | 'gated'
  | 'hairpin';

export type DensityClass = 'open' | 'medium' | 'packed' | 'maze';
export type WeatherClass = 'calm' | 'crosswind' | 'gust' | 'swell' | 'storm';
export type ObstacleMix = 'buoy' | 'boat' | 'dock' | 'mixed';
export type DockTopology =
  | 'finger'
  | 'quay'
  | 'corner'
  | 'island'
  | 'maze_grid'
  | 'gates'
  | 'angled'
  | 'alley';

/** Discrete tags used by the uniqueness scorer (pairwise ≤ 50%). */
export type CourseTags = {
  approach: ApproachType;
  path: PathShape;
  slipFacing: 'N' | 'E' | 'S' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
  spawnQuadrant: 'N' | 'E' | 'S' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
  density: DensityClass;
  weather: WeatherClass;
  obstacles: ObstacleMix;
  topology: DockTopology;
};

export type LevelDef = {
  id: number;
  name: string;
  subtitle: string;
  spawn: { x: number; z: number; yaw: number };
  slip: SlipDef;
  /** Optional approach waypoints before the slip gate (XZ). */
  waypoints?: Vec2[];
  /** bow / stern / parallel parking approach. */
  approach?: ApproachType;
  /** Uniqueness tags — required for similarity scoring. */
  tags: CourseTags;
  difficulty: DifficultyDef;
  wind: WindDef;
  /** Gameplay swell; if omitted, light chop is derived from strong wind. */
  waves?: WaveDef;
  /** Moving harbor traffic. Empty on the opening tutorial. */
  traffic: TrafficBoatDef[];
  parSeconds: number;
  parSlack: number;
  damageBudget: number;
  basin: { halfWidth: number; halfDepth: number };
  docks: DockPieceDef[];
  props: PropDef[];
  parkedBoats?: PropDef[];
};

export const WATERLINE_Y = 0;

export function difficultyScore(value: DifficultyDef): number {
  return value.route * 0.3 + value.precision * 0.25 + value.traffic * 0.25 + value.weather * 0.2;
}

export type DifficultyLabel = 'Easy' | 'Moderate' | 'Challenging' | 'Hard' | 'Expert';

export function difficultyLabel(rank: number): DifficultyLabel {
  if (rank <= 3) return 'Easy';
  if (rank <= 6) return 'Moderate';
  if (rank <= 9) return 'Challenging';
  if (rank <= 12) return 'Hard';
  return 'Expert';
}

/** Showcase set: easy → reverse → parallel → maze → angled → master. */
export const SHOWCASE_LEVEL_INDICES = [0, 3, 4, 6, 9, 14] as const;
