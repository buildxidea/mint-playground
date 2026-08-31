import type { ModelAssetId } from './registry';
import type { OBB } from '../systems/CollisionSystem';

export type CollisionPartProfile = {
  /** Local offset: +X right, +Z forward after model normalization. */
  x: number;
  z: number;
  yaw?: number;
  hx: number;
  hz: number;
  minY: number;
  maxY: number;
};

export type ModelCollisionProfile = {
  kind: OBB['kind'];
  /** Explicit level-authoring relationship for stationary model arrangements. */
  staticRole: 'dock-module' | 'open-structure' | 'mounted' | 'moored' | 'cargo' | 'free';
  parts: readonly CollisionPartProfile[];
};

const part = (
  hx: number,
  hz: number,
  maxY: number,
  x = 0,
  z = 0,
  yaw = 0,
  minY = -0.35,
): CollisionPartProfile => ({ x, z, yaw, hx, hz, minY, maxY });

/**
 * Exhaustive, gameplay-authored footprints for every imported GLB.
 * These remain deliberately simpler than render meshes while matching the
 * normalized model silhouette closely enough for fair marina contact.
 */
export const MODEL_COLLISION_PROFILES: Record<ModelAssetId, ModelCollisionProfile> = {
  boat_red_runabout: { kind: 'boat', staticRole: 'moored', parts: [part(0.95, 2.35, 1.75)] },
  boat_teal_skiff: { kind: 'boat', staticRole: 'moored', parts: [part(0.98, 2.48, 1.85)] },
  boat_yellow_utility: { kind: 'boat', staticRole: 'moored', parts: [part(0.92, 2.25, 1.7)] },
  dock_straight: { kind: 'dock', staticRole: 'dock-module', parts: [part(2.8, 0.7, 1.05, 0, 0, 0, 0.08)] },
  dock_finger_end: { kind: 'dock', staticRole: 'dock-module', parts: [part(1.9, 0.65, 1.05, 0, 0, 0, 0.08)] },
  dock_corner_l: {
    kind: 'dock',
    staticRole: 'dock-module',
    parts: [
      part(2.2, 0.68, 1.05, 0, -1.52, 0, 0.08),
      part(0.68, 2.2, 1.05, -1.52, 0, 0, 0.08),
    ],
  },
  cleat_post: { kind: 'dock', staticRole: 'mounted', parts: [part(0.32, 0.32, 1.25, 0, 0, 0, 0.02)] },
  buoy_striped: { kind: 'buoy', staticRole: 'free', parts: [part(0.43, 0.43, 1.1, 0, 0, 0, -0.45)] },
  // Open-front building: collide with its two side walls and rear wall, while
  // allowing a correctly parked boat to occupy the covered water bay.
  marina_boathouse: {
    kind: 'dock',
    staticRole: 'open-structure',
    parts: [
      part(0.38, 4.45, 6.5, -2.77, 0, 0, 0.02),
      part(0.38, 4.45, 6.5, 2.77, 0, 0, 0.02),
      part(3.15, 0.48, 6.5, 0, 3.97, 0, 0.02),
    ],
  },
  crate_stack: { kind: 'dock', staticRole: 'cargo', parts: [part(0.78, 0.78, 1.65, 0, 0, 0, 0.02)] },
  bollard_lantern: { kind: 'dock', staticRole: 'mounted', parts: [part(0.36, 0.36, 1.45, 0, 0, 0, 0.02)] },
  life_ring_post: { kind: 'dock', staticRole: 'mounted', parts: [part(0.38, 0.38, 1.55, 0, 0, 0, 0.02)] },
};

export function isIntentionalStaticJoin(a: ModelAssetId, b: ModelAssetId): boolean {
  const roleA = MODEL_COLLISION_PROFILES[a].staticRole;
  const roleB = MODEL_COLLISION_PROFILES[b].staticRole;
  const roles = new Set([roleA, roleB]);
  if (roles.has('open-structure') && (roles.has('dock-module') || roles.has('moored'))) return true;
  if (roleA === 'dock-module' && roleB === 'dock-module') return true;
  if (roles.has('mounted') && roles.has('dock-module')) return true;
  if (roles.has('moored') && roles.has('dock-module')) return true;
  if (roles.has('cargo') && (roles.has('dock-module') || roles.has('moored'))) return true;
  return false;
}

export type ColliderInstanceOptions = {
  x: number;
  z: number;
  yaw: number;
  scale?: number;
  sourceId: string;
  kind?: OBB['kind'];
};

export function instantiateModelColliders(
  model: ModelAssetId,
  options: ColliderInstanceOptions,
): OBB[] {
  const profile = MODEL_COLLISION_PROFILES[model];
  const scale = Math.max(0.01, Math.abs(options.scale ?? 1));
  const cos = Math.cos(options.yaw);
  const sin = Math.sin(options.yaw);
  return profile.parts.map((source, partIndex) => {
    const localX = source.x * scale;
    const localZ = source.z * scale;
    return {
      x: options.x + localX * cos + localZ * sin,
      z: options.z - localX * sin + localZ * cos,
      yaw: options.yaw + (source.yaw ?? 0),
      hx: source.hx * scale,
      hz: source.hz * scale,
      minY: source.minY * scale,
      maxY: source.maxY * scale,
      kind: options.kind ?? profile.kind,
      sourceId: options.sourceId,
      model,
      partIndex,
    };
  });
}

export function primaryBoatFootprint(model: ModelAssetId): { hx: number; hz: number } {
  const profile = MODEL_COLLISION_PROFILES[model];
  const source = profile.parts[0];
  if (!source || profile.kind !== 'boat') {
    throw new Error(`Model ${model} does not define a boat collision footprint.`);
  }
  return { hx: source.hx, hz: source.hz };
}
