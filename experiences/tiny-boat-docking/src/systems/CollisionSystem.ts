import type { BoatState, BoatTuning } from './BoatPhysics';

export type OBB = {
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
  minY?: number;
  maxY?: number;
  kind: 'dock' | 'buoy' | 'bound' | 'boat';
  sourceId?: string;
  model?: string;
  partIndex?: number;
};

export type MovingOBB = OBB & {
  vx: number;
  vz: number;
  sourceId: string;
  previousX?: number;
  previousZ?: number;
  previousYaw?: number;
};

export type CollisionHit = {
  kind: OBB['kind'];
  nx: number;
  nz: number;
  penetration: number;
  damage: number;
  sourceId?: string;
};

export type CollisionDiagnostics = {
  sweptHits: number;
  maxPenetration: number;
  unresolvedContacts: number;
};

type BoatPose = { x: number; z: number; yaw: number };

/** Separating-axis OBB vs boat capsule approximated as OBB. */
export class CollisionSystem {
  private readonly obstacles: OBB[] = [];
  private rng: () => number = Math.random;
  private diagnostics: CollisionDiagnostics = {
    sweptHits: 0,
    maxPenetration: 0,
    unresolvedContacts: 0,
  };

  setRng(rng: () => number): void {
    this.rng = rng;
  }

  setObstacles(list: OBB[]): void {
    this.obstacles.length = 0;
    this.obstacles.push(...list);
  }

  getObstacleCount(): number {
    return this.obstacles.length;
  }

  getDiagnostics(): Readonly<CollisionDiagnostics> {
    return this.diagnostics;
  }

  resolve(
    boat: BoatState,
    tuning: BoatTuning,
    movingObstacles: readonly MovingOBB[] = [],
    previousPose?: BoatPose,
  ): CollisionHit[] {
    this.diagnostics = { sweptHits: 0, maxPenetration: 0, unresolvedContacts: 0 };
    const hits: CollisionHit[] = [];
    const target = { x: boat.x, z: boat.z, yaw: boat.yaw };
    const previous = previousPose ?? target;
    const translation = Math.hypot(target.x - previous.x, target.z - previous.z);
    const rotation = Math.abs(normalizeAngle(target.yaw - previous.yaw));
    let relativeTravel = translation;
    for (const obstacle of movingObstacles) {
      relativeTravel = Math.max(
        relativeTravel,
        translation + Math.hypot(obstacle.x - (obstacle.previousX ?? obstacle.x), obstacle.z - (obstacle.previousZ ?? obstacle.z)),
      );
    }
    const sweepSteps = Math.min(
      48,
      Math.max(1, Math.ceil(Math.max(relativeTravel / 0.16, rotation / (Math.PI / 36)))),
    );

    let sweptContact = false;
    for (let step = 1; step <= sweepSteps; step += 1) {
      const alpha = step / sweepSteps;
      boat.x = lerp(previous.x, target.x, alpha);
      boat.z = lerp(previous.z, target.z, alpha);
      boat.yaw = previous.yaw + normalizeAngle(target.yaw - previous.yaw) * alpha;
      const boatObb = boatFootprint(boat, tuning);
      const staticHit = this.obstacles.find((obstacle) => overlapOBB(boatObb, obstacle));
      const movingHit = movingObstacles.find((obstacle) =>
        overlapOBB(boatObb, movingAt(obstacle, alpha)),
      );
      const obstacle = staticHit ?? (movingHit ? movingAt(movingHit, alpha) : undefined);
      if (!obstacle) continue;
      this.resolveObstacle(boat, boatObb, obstacle, hits);
      this.diagnostics.sweptHits += 1;
      sweptContact = true;
      break;
    }

    if (!sweptContact) {
      boat.x = target.x;
      boat.z = target.z;
      boat.yaw = target.yaw;
    }

    // Resolve corners and compound shapes in a stable, bounded iteration loop.
    for (let pass = 0; pass < 4; pass += 1) {
      let resolved = false;
      const boatObb = boatFootprint(boat, tuning);
      for (const obstacle of this.obstacles) {
        resolved = this.resolveObstacle(boat, boatObb, obstacle, hits) || resolved;
      }
      for (const obstacle of movingObstacles) {
        resolved = this.resolveObstacle(boat, boatObb, obstacle, hits) || resolved;
      }
      if (!resolved) break;
    }

    const finalObb = boatFootprint(boat, tuning);
    this.diagnostics.unresolvedContacts = [...this.obstacles, ...movingObstacles].filter(
      (obstacle) => overlapOBB(finalObb, obstacle) !== null,
    ).length;
    return hits;
  }

  private resolveObstacle(
    boat: BoatState,
    boatObb: OBB,
    obstacle: OBB | MovingOBB,
    hits: CollisionHit[],
  ): boolean {
    const result = overlapOBB(boatObb, obstacle);
    if (!result) return false;
    this.diagnostics.maxPenetration = Math.max(this.diagnostics.maxPenetration, result.penetration);

    // Small skin so we don't re-penetrate and chatter next frame.
    const skin = 0.02;
    boat.x += result.nx * (result.penetration + skin);
    boat.z += result.nz * (result.penetration + skin);
    boatObb.x = boat.x;
    boatObb.z = boat.z;

    const obstacleVx = 'vx' in obstacle ? obstacle.vx : 0;
    const obstacleVz = 'vz' in obstacle ? obstacle.vz : 0;
    const vn = (boat.vx - obstacleVx) * result.nx + (boat.vz - obstacleVz) * result.nz;
    if (vn < 0) {
      // Soft, mostly inelastic response — hard bounce + wave push caused jitter.
      const bounce = obstacle.kind === 'buoy' ? 0.18 : obstacle.kind === 'boat' ? 0.08 : 0.04;
      boat.vx -= (1 + bounce) * vn * result.nx;
      boat.vz -= (1 + bounce) * vn * result.nz;
      // Kill residual normal velocity so waves don't re-slam every tick.
      const vnAfter = boat.vx * result.nx + boat.vz * result.nz;
      if (vnAfter < 0) {
        boat.vx -= vnAfter * result.nx;
        boat.vz -= vnAfter * result.nz;
      }
      boat.yawRate += (this.rng() * 2 - 1) * 0.06 * Math.min(1, Math.abs(vn));
      boat.yawRate *= 0.92;
    }

    const impact = Math.max(0, -vn);
    // Every solid object deals damage — bounds scrape, buoys bump, docks hit hard.
    const damage =
      obstacle.kind === 'bound'
        ? 0.12 + impact * 0.25
        : obstacle.kind === 'buoy'
          ? 0.18 + impact * 0.35
          : obstacle.kind === 'boat'
            ? 0.25 + impact * 0.42
            : 0.35 + impact * 0.55;

    const duplicate = hits.some(
      (hit) => hit.kind === obstacle.kind && hit.sourceId === obstacle.sourceId,
    );
    if (!duplicate) {
      hits.push({
        kind: obstacle.kind,
        nx: result.nx,
        nz: result.nz,
        penetration: result.penetration,
        damage,
        sourceId: obstacle.sourceId,
      });
    }
    return true;
  }
}

function boatFootprint(boat: BoatState, tuning: BoatTuning): OBB {
  return {
    x: boat.x,
    z: boat.z,
    yaw: boat.yaw,
    hx: tuning.hullHalfWidth,
    hz: tuning.hullHalfLength,
    minY: -0.45,
    maxY: 1.95,
    kind: 'boat',
    sourceId: 'player',
  };
}

function movingAt(obstacle: MovingOBB, alpha: number): MovingOBB {
  const previousYaw = obstacle.previousYaw ?? obstacle.yaw;
  return {
    ...obstacle,
    x: lerp(obstacle.previousX ?? obstacle.x, obstacle.x, alpha),
    z: lerp(obstacle.previousZ ?? obstacle.z, obstacle.z, alpha),
    yaw: previousYaw + normalizeAngle(obstacle.yaw - previousYaw) * alpha,
  };
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function overlapOBB(
  a: OBB,
  b: OBB,
): { nx: number; nz: number; penetration: number } | null {
  const aMinY = a.minY ?? -Infinity;
  const aMaxY = a.maxY ?? Infinity;
  const bMinY = b.minY ?? -Infinity;
  const bMaxY = b.maxY ?? Infinity;
  if (aMaxY <= bMinY || bMaxY <= aMinY) return null;
  const axes = [
    { x: Math.sin(a.yaw), z: Math.cos(a.yaw) },
    { x: Math.cos(a.yaw), z: -Math.sin(a.yaw) },
    { x: Math.sin(b.yaw), z: Math.cos(b.yaw) },
    { x: Math.cos(b.yaw), z: -Math.sin(b.yaw) },
  ];

  let minPen = Infinity;
  let nx = 0;
  let nz = 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;

  for (const axis of axes) {
    const aProj = projectRadius(a, axis);
    const bProj = projectRadius(b, axis);
    const dist = Math.abs(dx * axis.x + dz * axis.z);
    const pen = aProj + bProj - dist;
    if (pen <= 0) return null;
    if (pen < minPen) {
      minPen = pen;
      const sign = dx * axis.x + dz * axis.z < 0 ? -1 : 1;
      // Push A out of B: opposite of B-relative vector.
      nx = -axis.x * sign;
      nz = -axis.z * sign;
    }
  }

  const len = Math.hypot(nx, nz) || 1;
  return { nx: nx / len, nz: nz / len, penetration: minPen };
}

function projectRadius(obb: OBB, axis: { x: number; z: number }): number {
  const fx = Math.sin(obb.yaw);
  const fz = Math.cos(obb.yaw);
  const rx = Math.cos(obb.yaw);
  const rz = -Math.sin(obb.yaw);
  return (
    Math.abs(fx * axis.x + fz * axis.z) * obb.hz +
    Math.abs(rx * axis.x + rz * axis.z) * obb.hx
  );
}
