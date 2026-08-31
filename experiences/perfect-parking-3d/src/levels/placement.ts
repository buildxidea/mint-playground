import type { VehicleId } from '../assets/manifest';
import { PARKING_FIT_MARGIN, VEHICLE_PROFILES } from '../vehicles/profiles';
import type { ChallengeDef, ObstacleKind, ParkingSpaceDef } from './challenges';
import { parkedVehicleSpec } from './GenericParkedCars';
import { VISIBLE_ASPHALT_BOUNDS, type AsphaltBounds } from './asphalt';

/** Minimum visible breathing room between separately placed solid objects. */
export const SOLID_PLACEMENT_CLEARANCE = PARKING_FIT_MARGIN;

/**
 * Collider half-extents in gameplay space after AssetLibrary forward bake
 * (yaw 0 → length along +Z). Barriers/curbs are long on Z, thin on X.
 */
export const OBSTACLE_COLLIDER: Record<
  ObstacleKind,
  { hx: number; hy: number; hz: number; y: number }
> = {
  cone: { hx: 0.22, hy: 0.35, hz: 0.22, y: 0.35 },
  barrier: { hx: 0.22, hy: 0.42, hz: 1.1, y: 0.42 },
  bollard: { hx: 0.14, hy: 0.45, hz: 0.14, y: 0.45 },
  booth: { hx: 1.1, hy: 1.2, hz: 1.1, y: 1.2 },
  curb: { hx: 0.18, hy: 0.14, hz: 1.5, y: 0.14 },
};

/** Conservative rendered X/Z bounds of the normalized production props. */
export const OBSTACLE_PLACEMENT_FOOTPRINT: Record<
  ObstacleKind,
  { hx: number; hz: number }
> = {
  cone: { hx: 0.34, hz: 0.34 },
  barrier: { hx: 1.1, hz: 0.61 },
  bollard: { hx: 0.26, hz: 0.26 },
  booth: { hx: 1.26, hz: 1.26 },
  curb: { hx: 0.38, hz: 1.5 },
};

export type OrientedFootprint = {
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
  label: string;
};

export type PlacementConflict = {
  left: string;
  right: string;
  clearance: number;
};

export type PlacementAudit = {
  minimumClearance: number;
  conflicts: PlacementConflict[];
};

type Axis = readonly [x: number, z: number];

/**
 * Separating-axis clearance between two yawed rectangular footprints.
 * Positive values are gaps; negative values are penetration depth.
 */
export function footprintClearance(
  left: OrientedFootprint,
  right: OrientedFootprint,
): number {
  let bestSeparation = -Infinity;
  for (const axis of [...footprintAxes(left), ...footprintAxes(right)]) {
    const centerDistance = Math.abs(
      (right.x - left.x) * axis[0] + (right.z - left.z) * axis[1],
    );
    const separation =
      centerDistance - projectionRadius(left, axis) - projectionRadius(right, axis);
    bestSeparation = Math.max(bestSeparation, separation);
  }
  return bestSeparation;
}

/** Minimum gap between a yawed footprint and the visible asphalt boundary. */
export function footprintBoundsClearance(
  footprint: OrientedFootprint,
  bounds: AsphaltBounds = VISIBLE_ASPHALT_BOUNDS,
): number {
  const [right, forward] = footprintAxes(footprint);
  const extentX =
    footprint.hx * Math.abs(right[0]) + footprint.hz * Math.abs(forward[0]);
  const extentZ =
    footprint.hx * Math.abs(right[1]) + footprint.hz * Math.abs(forward[1]);
  return Math.min(
    footprint.x - extentX - bounds.minX,
    bounds.maxX - (footprint.x + extentX),
    footprint.z - extentZ - bounds.minZ,
    bounds.maxZ - (footprint.z + extentZ),
  );
}

/** Occupied stalls omit decorative stops so no stop clips through a parked car. */
export function shouldPlaceWheelStop(space: ParkingSpaceDef): boolean {
  return !space.target && !space.occupied && Math.abs(Math.sin(space.yaw)) < 0.82;
}

/** Audit all static solids plus every supported player vehicle at the spawn. */
export function auditChallengePlacements(
  challenge: ChallengeDef,
  requiredClearance = SOLID_PLACEMENT_CLEARANCE,
): PlacementAudit {
  const parkedCars = challenge.parkingSpaces.flatMap((space, index) => {
    if (!space.occupied) return [];
    const spec = parkedVehicleSpec(space.occupied.vehicle);
    return [
      {
        x: space.x,
        z: space.z,
        yaw: space.yaw,
        hx: spec.width / 2,
        hz: spec.length / 2,
        label: `parked-${space.occupied.vehicle}-${index}`,
      } satisfies OrientedFootprint,
    ];
  });
  const obstacles = challenge.obstacles.map((obstacle, index) => {
    const footprint = OBSTACLE_PLACEMENT_FOOTPRINT[obstacle.kind];
    return {
      x: obstacle.x,
      z: obstacle.z,
      yaw: obstacle.yaw ?? 0,
      hx: footprint.hx,
      hz: footprint.hz,
      label: `${obstacle.kind}-${index}`,
    } satisfies OrientedFootprint;
  });
  const solids = [...parkedCars, ...obstacles];
  const pairs: Array<readonly [OrientedFootprint, OrientedFootprint]> = [];
  const boundaryFootprints: OrientedFootprint[] = [...solids];

  for (let left = 0; left < solids.length; left += 1) {
    for (let right = left + 1; right < solids.length; right += 1) {
      pairs.push([solids[left]!, solids[right]!]);
    }
  }

  for (const vehicleId of Object.keys(VEHICLE_PROFILES) as VehicleId[]) {
    const profile = VEHICLE_PROFILES[vehicleId];
    const spawn: OrientedFootprint = {
      x: challenge.spawn.x,
      z: challenge.spawn.z,
      yaw: challenge.spawn.yaw,
      hx: profile.width / 2,
      hz: profile.length / 2,
      label: `player-${vehicleId}-spawn`,
    };
    for (const solid of solids) pairs.push([spawn, solid]);
    boundaryFootprints.push(spawn);
  }

  let minimumClearance = Infinity;
  const conflicts: PlacementConflict[] = [];
  for (const [left, right] of pairs) {
    const clearance = footprintClearance(left, right);
    minimumClearance = Math.min(minimumClearance, clearance);
    if (clearance < requiredClearance) {
      conflicts.push({ left: left.label, right: right.label, clearance });
    }
  }
  for (const footprint of boundaryFootprints) {
    const clearance = footprintBoundsClearance(footprint);
    minimumClearance = Math.min(minimumClearance, clearance);
    if (clearance < requiredClearance) {
      conflicts.push({
        left: footprint.label,
        right: 'visible-asphalt-edge',
        clearance,
      });
    }
  }

  return {
    minimumClearance: Number.isFinite(minimumClearance) ? minimumClearance : 0,
    conflicts,
  };
}

function footprintAxes(footprint: OrientedFootprint): readonly [Axis, Axis] {
  const cos = Math.cos(footprint.yaw);
  const sin = Math.sin(footprint.yaw);
  return [
    [cos, -sin],
    [sin, cos],
  ];
}

function projectionRadius(footprint: OrientedFootprint, axis: Axis): number {
  const [right, forward] = footprintAxes(footprint);
  return (
    footprint.hx * Math.abs(right[0] * axis[0] + right[1] * axis[1]) +
    footprint.hz * Math.abs(forward[0] * axis[0] + forward[1] * axis[1])
  );
}
