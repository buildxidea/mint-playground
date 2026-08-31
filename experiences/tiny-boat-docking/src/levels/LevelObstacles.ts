import {
  instantiateModelColliders,
  primaryBoatFootprint,
} from '../assets/collisionProfiles';
import type { ModelAssetId } from '../assets/registry';
import { overlapOBB, type OBB } from '../systems/CollisionSystem';
import type { LevelDef } from './LevelDef';

export const REQUIRED_SLIP_CLEARANCE = 0.28;

export type SlipParkabilityIssue = {
  levelId: number;
  levelName: string;
  boat: ModelAssetId;
  reason: 'zone-width' | 'zone-length' | 'parked-overlap' | 'approach-overlap';
  obstacleId?: string;
};

export function buildAuthoredObstacles(level: LevelDef): OBB[] {
  const obstacles: OBB[] = [];
  level.docks.forEach((dock, index) => {
    obstacles.push(
      ...instantiateModelColliders(dock.model, {
        x: dock.x,
        z: dock.z,
        yaw: dock.yaw,
        scale: dock.scale,
        sourceId: `dock-${index}`,
        kind: 'dock',
      }),
    );
  });
  level.props.forEach((prop, index) => {
    obstacles.push(
      ...instantiateModelColliders(prop.model, {
        x: prop.x,
        z: prop.z,
        yaw: prop.yaw,
        scale: prop.scale,
        sourceId: `prop-${index}`,
        kind: prop.buoy || prop.model === 'buoy_striped' ? 'buoy' : undefined,
      }),
    );
  });
  (level.parkedBoats ?? []).forEach((boat, index) => {
    obstacles.push(
      ...instantiateModelColliders(boat.model, {
        x: boat.x,
        z: boat.z,
        yaw: boat.yaw,
        scale: boat.scale,
        sourceId: `parked-boat-${index}`,
        kind: 'boat',
      }),
    );
  });
  return obstacles;
}

export function buildBoundaryObstacles(level: LevelDef): OBB[] {
  const { halfWidth, halfDepth } = level.basin;
  const wall = 0.6;
  return [
    { x: 0, z: -halfDepth - wall, yaw: 0, hx: halfWidth + 2, hz: wall, kind: 'bound', sourceId: 'bound-north' },
    { x: 0, z: halfDepth + wall, yaw: 0, hx: halfWidth + 2, hz: wall, kind: 'bound', sourceId: 'bound-south' },
    { x: -halfWidth - wall, z: 0, yaw: 0, hx: wall, hz: halfDepth + 2, kind: 'bound', sourceId: 'bound-west' },
    { x: halfWidth + wall, z: 0, yaw: 0, hx: wall, hz: halfDepth + 2, kind: 'bound', sourceId: 'bound-east' },
  ];
}

export function buildSlipPostObstacles(level: LevelDef): OBB[] {
  const slip = level.slip;
  const side = slip.halfWidth + 0.55;
  const end = slip.halfLength * 0.9;
  const localCorners: Array<[number, number]> = [
    [-side, -end],
    [side, -end],
    [-side, end],
    [side, end],
  ];
  const cos = Math.cos(slip.yaw);
  const sin = Math.sin(slip.yaw);
  return localCorners.flatMap(([lx, lz], index) =>
    instantiateModelColliders('cleat_post', {
      x: slip.x + lx * cos + lz * sin,
      z: slip.z - lx * sin + lz * cos,
      yaw: slip.yaw,
      sourceId: `slip-post-${index}`,
      kind: 'dock',
    }),
  );
}

export function buildLevelObstacles(level: LevelDef): OBB[] {
  return [
    ...buildAuthoredObstacles(level),
    ...buildBoundaryObstacles(level),
    ...buildSlipPostObstacles(level),
  ];
}

/**
 * Verify a boat can occupy the berth and travel through its final straight
 * approach with a small collision skin. This tests physical scenery rather
 * than trusting the decorative slip rectangle.
 */
export function slipParkabilityIssues(
  level: LevelDef,
  boat: ModelAssetId,
  obstacles: readonly OBB[] = buildLevelObstacles(level),
): SlipParkabilityIssue[] {
  const footprint = primaryBoatFootprint(boat);
  const issues: SlipParkabilityIssue[] = [];
  if (level.slip.halfWidth - footprint.hx < REQUIRED_SLIP_CLEARANCE) {
    issues.push(issue(level, boat, 'zone-width'));
  }
  if (level.slip.halfLength - footprint.hz < REQUIRED_SLIP_CLEARANCE) {
    issues.push(issue(level, boat, 'zone-length'));
  }

  const parkedHull = clearanceHull(
    level.slip.x,
    level.slip.z,
    level.slip.yaw,
    footprint,
  );
  const parkedObstacle = obstacles.find((obstacle) => overlapOBB(parkedHull, obstacle));
  if (parkedObstacle) {
    issues.push(issue(level, boat, 'parked-overlap', parkedObstacle.sourceId));
  }

  const forwardX = Math.sin(level.slip.yaw);
  const forwardZ = Math.cos(level.slip.yaw);
  const approachDistance = level.slip.halfLength + footprint.hz + REQUIRED_SLIP_CLEARANCE;
  for (let step = 1; step <= 32; step += 1) {
    const distance = approachDistance * (1 - step / 32);
    const hull = clearanceHull(
      level.slip.x - forwardX * distance,
      level.slip.z - forwardZ * distance,
      level.slip.yaw,
      footprint,
    );
    const obstacle = obstacles.find((candidate) => overlapOBB(hull, candidate));
    if (!obstacle) continue;
    issues.push(issue(level, boat, 'approach-overlap', obstacle.sourceId));
    break;
  }
  return issues;
}

function clearanceHull(
  x: number,
  z: number,
  yaw: number,
  footprint: ReturnType<typeof primaryBoatFootprint>,
): OBB {
  return {
    x,
    z,
    yaw,
    hx: footprint.hx + REQUIRED_SLIP_CLEARANCE,
    hz: footprint.hz + REQUIRED_SLIP_CLEARANCE,
    minY: -0.45,
    maxY: 1.95,
    kind: 'boat',
    sourceId: 'parkability-probe',
  };
}

function issue(
  level: LevelDef,
  boat: ModelAssetId,
  reason: SlipParkabilityIssue['reason'],
  obstacleId?: string,
): SlipParkabilityIssue {
  return {
    levelId: level.id,
    levelName: level.name,
    boat,
    reason,
    ...(obstacleId ? { obstacleId } : {}),
  };
}
