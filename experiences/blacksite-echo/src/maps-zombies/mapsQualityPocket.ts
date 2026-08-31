import * as THREE from 'three';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import type { MapsPlayableBounds } from './MapsPlacement';

/** Compact high-quality Street View pocket radius (metres). */
export const MAPS_QUALITY_POCKET_RADIUS = 9;

export type MapsQualityPocket = {
  center: THREE.Vector3;
  deckY: number;
  /** XZ playable box around the quality center. */
  bounds: THREE.Box3;
  playable: MapsPlayableBounds;
  sampleCount: number;
  usedOriginBias: boolean;
  waterEstimateY: number | null;
};

type SurfaceHit = {
  x: number;
  z: number;
  footY: number;
  walkable: boolean;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) * 0.5
    : sorted[mid]!;
}

function clampCenterToBounds(
  x: number,
  z: number,
  worldBounds: THREE.Box3,
  radius: number,
): { x: number; z: number } {
  const minX = worldBounds.min.x + radius + 0.5;
  const maxX = worldBounds.max.x - radius - 0.5;
  const minZ = worldBounds.min.z + radius + 0.5;
  const maxZ = worldBounds.max.z - radius - 0.5;
  return {
    x: THREE.MathUtils.clamp(x, Math.min(minX, maxX), Math.max(minX, maxX)),
    z: THREE.MathUtils.clamp(z, Math.min(minZ, maxZ), Math.max(minZ, maxZ)),
  };
}

function buildPocketBounds(
  centerX: number,
  centerZ: number,
  deckY: number,
  radius: number,
): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(centerX - radius, deckY - 2.5, centerZ - radius),
    new THREE.Vector3(centerX + radius, deckY + 6, centerZ + radius),
  );
}

/**
 * Convert Google Maps compass yaw (0 = north, clockwise degrees) to player yaw
 * where 0 looks along -Z (treated as north).
 */
export function mapsCompassYawToPlayerYaw(degrees: number): number {
  return -THREE.MathUtils.degToRad(degrees);
}

/**
 * Compact quality pocket on the densest content mass, seated on a continuous
 * deck inside the RAD visual shell (not buried collider bottoms / not above
 * the splat into black void).
 */
export function resolveMapsQualityPocket(
  physics: PhysicsWorld,
  worldBounds: THREE.Box3,
  options?: {
    radius?: number;
    /** RAD/splat bounds — required for correct vertical seating. */
    visualBounds?: THREE.Box3 | null;
  },
): MapsQualityPocket {
  const radius = options?.radius ?? MAPS_QUALITY_POCKET_RADIUS;
  const visual =
    options?.visualBounds && !options.visualBounds.isEmpty()
      ? options.visualBounds
      : null;
  const castFromY = Math.max(
    worldBounds.max.y + 10,
    worldBounds.min.y + 32,
    visual ? visual.max.y + 8 : -Infinity,
  );
  const contentCenter = (visual ?? worldBounds).getCenter(new THREE.Vector3());
  const spanX = Math.max(4, worldBounds.max.x - worldBounds.min.x);
  const spanZ = Math.max(4, worldBounds.max.z - worldBounds.min.z);
  const step = Math.max(3.5, Math.min(spanX, spanZ) / 14);

  // Outdoor Street View ground usually sits in the lower band of the RAD shell.
  const visualSpanY = visual
    ? Math.max(1, visual.max.y - visual.min.y)
    : Math.max(1, worldBounds.max.y - worldBounds.min.y);
  const visualDeckMin = visual
    ? visual.min.y - 0.5
    : worldBounds.min.y - 0.5;
  const visualDeckMax = visual
    ? visual.min.y + visualSpanY * 0.42
    : worldBounds.min.y + visualSpanY * 0.42;
  // When RAD bounds are not ready yet, the proven Maps seating band is ~28%
  // up the collider AABB — that keeps the camera inside the splat shell for
  // waterfront captures instead of under/over into black void.
  const fallbackDeckY = visual
    ? visual.min.y + visualSpanY * 0.18
    : worldBounds.min.y +
      Math.max(2.2, (worldBounds.max.y - worldBounds.min.y) * 0.28);

  const hits: SurfaceHit[] = [];
  const consider = (x: number, z: number) => {
    if (
      x < worldBounds.min.x + 0.5 ||
      x > worldBounds.max.x - 0.5 ||
      z < worldBounds.min.z + 0.5 ||
      z > worldBounds.max.z - 0.5
    ) {
      return;
    }
    const hit = physics.findHighestWalkableFoot(
      x,
      z,
      castFromY,
      worldBounds.min.y - 1,
      180,
      { allowNonWalkable: true },
    );
    if (!hit) return;
    hits.push({
      x,
      z,
      footY: hit.footY,
      walkable: hit.walkable,
    });
  };

  for (
    let x = worldBounds.min.x + 1;
    x <= worldBounds.max.x - 1;
    x += step
  ) {
    for (
      let z = worldBounds.min.z + 1;
      z <= worldBounds.max.z - 1;
      z += step
    ) {
      consider(x, z);
    }
  }
  for (let ring = 0; ring <= 6; ring += 1) {
    const ringRadius = ring * 2.4;
    const steps = ring === 0 ? 1 : 8 + ring * 2;
    for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
      const angle = (stepIndex / steps) * Math.PI * 2;
      consider(
        contentCenter.x + Math.cos(angle) * ringRadius,
        contentCenter.z + Math.sin(angle) * ringRadius,
      );
    }
  }

  const inVisualBand = hits.filter(
    (hit) => hit.footY >= visualDeckMin && hit.footY <= visualDeckMax,
  );
  const scoringPool = inVisualBand.length >= 6 ? inVisualBand : hits;

  if (scoringPool.length === 0) {
    const clamped = clampCenterToBounds(
      contentCenter.x,
      contentCenter.z,
      worldBounds,
      radius,
    );
    const deckY = fallbackDeckY;
    const bounds = buildPocketBounds(clamped.x, clamped.z, deckY, radius);
    return {
      center: new THREE.Vector3(clamped.x, deckY + 0.98, clamped.z),
      deckY,
      bounds,
      playable: {
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minZ: bounds.min.z,
        maxZ: bounds.max.z,
        floorY: deckY,
      },
      sampleCount: hits.length,
      usedOriginBias: false,
      waterEstimateY: visual?.min.y ?? worldBounds.min.y,
    };
  }

  let best: SurfaceHit | null = null;
  let bestScore = -Infinity;
  for (const hit of scoringPool) {
    const neighbors = scoringPool.filter(
      (other) =>
        Math.hypot(other.x - hit.x, other.z - hit.z) <= 4.5 &&
        Math.abs(other.footY - hit.footY) <= 1.1,
    );
    const upright = hit.walkable ? 1 : 0.55;
    const inBand =
      hit.footY >= visualDeckMin && hit.footY <= visualDeckMax ? 1.35 : 0.7;
    const centerDistance = Math.hypot(
      hit.x - contentCenter.x,
      hit.z - contentCenter.z,
    );
    const centerBias = 1 / (1 + centerDistance * 0.028);
    const score =
      neighbors.length * upright * inBand * (0.5 + 0.5 * centerBias);
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
  }

  const chosen = best ?? scoringPool[0]!;
  const cluster = scoringPool.filter(
    (other) =>
      Math.hypot(other.x - chosen.x, other.z - chosen.z) <= 5 &&
      Math.abs(other.footY - chosen.footY) <= 1.25,
  );
  let deckY = median(cluster.map((hit) => hit.footY));

  // Prefer RAD-shell seating. Without visual bounds, never trust buried
  // collider bottoms — use the proven AABB band that keeps the camera inside
  // the splat volume for waterfront Maps worlds.
  if (!visual || deckY < visualDeckMin || deckY > visualDeckMax) {
    deckY = fallbackDeckY;
  }

  const clamped = clampCenterToBounds(chosen.x, chosen.z, worldBounds, radius);
  const bounds = buildPocketBounds(clamped.x, clamped.z, deckY, radius);

  return {
    center: new THREE.Vector3(clamped.x, deckY + 0.98, clamped.z),
    deckY,
    bounds,
    playable: {
      minX: bounds.min.x,
      maxX: bounds.max.x,
      minZ: bounds.min.z,
      maxZ: bounds.max.z,
      floorY: deckY,
    },
    sampleCount: hits.length,
    usedOriginBias: false,
    waterEstimateY: visual?.min.y ?? worldBounds.min.y,
  };
}
