import * as THREE from 'three';
import { roundedRinkContact } from '../game/RinkShape';
import type { LevelDefinition, ObstacleDefinition } from '../game/types';

export type PlanarPose = {
  x: number;
  z: number;
  heading: number;
};

export type CollisionCircle = {
  localX: number;
  localZ: number;
  radius: number;
};

export type CollisionResult = {
  pose: PlanarPose;
  collided: boolean;
  normalX: number;
  normalZ: number;
  obstacleId?: string;
};

export class CollisionSystem {
  resolve(pose: PlanarPose, radius: number, level: LevelDefinition): CollisionResult {
    return this.resolveCompound(pose, [{ localX: 0, localZ: 0, radius }], level);
  }

  resolveCompound(pose: PlanarPose, footprint: readonly CollisionCircle[], level: LevelDefinition): CollisionResult {
    const resolved = { ...pose };
    let collided = false;
    let normalX = 0;
    let normalZ = 0;
    let obstacleId: string | undefined;

    // Several small circles approximate the long chassis and rear blade. A
    // handful of solver passes lets one correction settle the other samples.
    for (let pass = 0; pass < 4; pass += 1) {
      let correctedThisPass = false;
      for (const circle of footprint) {
        const center = this.localToWorld(resolved, circle.localX, circle.localZ);
        const boardHit = this.resolveBoards(center.x, center.z, circle.radius, level);
        if (boardHit) {
          resolved.x += boardHit.pushX;
          resolved.z += boardHit.pushZ;
          normalX += boardHit.normalX;
          normalZ += boardHit.normalZ;
          collided = true;
          correctedThisPass = true;
        }

        for (const obstacle of level.obstacles) {
          const correctedCenter = this.localToWorld(resolved, circle.localX, circle.localZ);
          const hit = this.resolveObstacle(correctedCenter.x, correctedCenter.z, circle.radius, obstacle);
          if (!hit) continue;
          resolved.x += hit.pushX;
          resolved.z += hit.pushZ;
          normalX += hit.normalX;
          normalZ += hit.normalZ;
          collided = true;
          correctedThisPass = true;
          obstacleId = obstacle.id;
        }
      }
      if (!correctedThisPass) break;
    }

    const length = Math.hypot(normalX, normalZ);
    if (length > 0.0001) {
      normalX /= length;
      normalZ /= length;
    }
    return { pose: resolved, collided, normalX, normalZ, obstacleId };
  }

  private localToWorld(pose: PlanarPose, localX: number, localZ: number): { x: number; z: number } {
    const cosine = Math.cos(pose.heading);
    const sine = Math.sin(pose.heading);
    return {
      x: pose.x + localX * cosine - localZ * sine,
      z: pose.z + localX * sine + localZ * cosine,
    };
  }

  private resolveBoards(
    x: number,
    z: number,
    radius: number,
    level: LevelDefinition,
  ): { pushX: number; pushZ: number; normalX: number; normalZ: number } | null {
    const contact = roundedRinkContact(x, z, level.halfWidth, level.halfDepth, level.cornerRadius);
    const penetration = contact.signedDistance + radius;
    if (penetration <= 0) return null;
    const normalX = -contact.outwardX;
    const normalZ = -contact.outwardZ;
    return {
      pushX: normalX * penetration,
      pushZ: normalZ * penetration,
      normalX,
      normalZ,
    };
  }

  private resolveObstacle(
    x: number,
    z: number,
    radius: number,
    obstacle: ObstacleDefinition,
  ): { pushX: number; pushZ: number; normalX: number; normalZ: number } | null {
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    if (obstacle.shape.type === 'circle') {
      const minimum = radius + obstacle.shape.radius;
      const distance = Math.hypot(dx, dz);
      if (distance >= minimum) return null;
      const normalX = distance > 0.0001 ? dx / distance : 1;
      const normalZ = distance > 0.0001 ? dz / distance : 0;
      const penetration = minimum - distance;
      return { pushX: normalX * penetration, pushZ: normalZ * penetration, normalX, normalZ };
    }

    const rotation = obstacle.rotation ?? 0;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const localX = dx * cosine - dz * sine;
    const localZ = dx * sine + dz * cosine;
    const closestX = THREE.MathUtils.clamp(localX, -obstacle.shape.halfWidth, obstacle.shape.halfWidth);
    const closestZ = THREE.MathUtils.clamp(localZ, -obstacle.shape.halfDepth, obstacle.shape.halfDepth);
    let deltaX = localX - closestX;
    let deltaZ = localZ - closestZ;
    let distance = Math.hypot(deltaX, deltaZ);
    if (distance >= radius) return null;

    if (distance < 0.0001) {
      const xPenetration = obstacle.shape.halfWidth - Math.abs(localX);
      const zPenetration = obstacle.shape.halfDepth - Math.abs(localZ);
      if (xPenetration < zPenetration) {
        deltaX = localX >= 0 ? 1 : -1;
        deltaZ = 0;
        distance = 0;
      } else {
        deltaX = 0;
        deltaZ = localZ >= 0 ? 1 : -1;
        distance = 0;
      }
    }
    const normalLocalX = distance > 0.0001 ? deltaX / distance : deltaX;
    const normalLocalZ = distance > 0.0001 ? deltaZ / distance : deltaZ;
    const penetration = radius - distance;
    const normalX = normalLocalX * cosine + normalLocalZ * sine;
    const normalZ = -normalLocalX * sine + normalLocalZ * cosine;
    return { pushX: normalX * penetration, pushZ: normalZ * penetration, normalX, normalZ };
  }
}
