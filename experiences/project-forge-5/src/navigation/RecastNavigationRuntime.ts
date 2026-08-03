import type { NavMesh, NavMeshQuery } from '@recast-navigation/core';
import * as THREE from 'three';
import type { RobotId } from '../config/catalog';

type RecastProfile = Readonly<{
  id: string;
  cellSize: number;
  cellHeight: number;
  walkableSlopeDegrees: number;
  walkableHeightVoxels: number;
  walkableClimbVoxels: number;
  walkableRadiusVoxels: number;
}>;

export type RecastNavigationDiagnostics = Readonly<{
  mode: 'collider-navmesh';
  profile: string;
  sourceMeshes: number;
  buildMilliseconds: number;
  routePointsProjected: number;
  cachedSegments: number;
}>;

const PROFILES: Readonly<Record<RobotId, RecastProfile>> = {
  'axiom-h1': {
    id: 'humanoid',
    cellSize: 0.2,
    cellHeight: 0.1,
    walkableSlopeDegrees: 55,
    walkableHeightVoxels: 17,
    walkableClimbVoxels: 7,
    walkableRadiusVoxels: 2,
  },
  'quadrant-q4': {
    id: 'quadruped',
    cellSize: 0.2,
    cellHeight: 0.1,
    walkableSlopeDegrees: 55,
    walkableHeightVoxels: 7,
    walkableClimbVoxels: 7,
    walkableRadiusVoxels: 3,
  },
  'forge-t7': {
    id: 'tracked-heavy',
    cellSize: 0.1,
    cellHeight: 0.1,
    walkableSlopeDegrees: 35,
    walkableHeightVoxels: 15,
    walkableClimbVoxels: 1,
    // Full-body erosion fragments the detailed World triangle meshes into
    // false islands. Recast supplies a steering channel; the 0.68 m Rapier
    // capsule remains the authoritative physical-clearance check.
    walkableRadiusVoxels: 3,
  },
  'swift-w2': {
    id: 'wheeled-collaborative',
    cellSize: 0.2,
    cellHeight: 0.1,
    walkableSlopeDegrees: 35,
    walkableHeightVoxels: 14,
    walkableClimbVoxels: 3,
    walkableRadiusVoxels: 1,
  },
  'kestrel-d5': {
    id: 'aerial-corridor-projection',
    cellSize: 0.2,
    cellHeight: 0.1,
    walkableSlopeDegrees: 70,
    walkableHeightVoxels: 5,
    walkableClimbVoxels: 10,
    walkableRadiusVoxels: 2,
  },
};

const QUERY_HALF_EXTENTS = Object.freeze({ x: 4, y: 4, z: 4 });
const CACHED_GOAL_TOLERANCE_SQUARED = 0.25 * 0.25;

export function getRecastNavigationProfile(robotId: RobotId): RecastProfile {
  return PROFILES[robotId];
}

function toThree(point: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry instanceof THREE.BufferGeometry) meshes.push(mesh);
  });
  return meshes;
}

/**
 * Owns one Detour query built directly from the active final Mint collider.
 * The render splat never participates in navigation generation.
 */
export class RecastNavigationRuntime {
  private navMesh: NavMesh | null = null;
  private query: NavMeshQuery | null = null;
  private diagnosticsState: RecastNavigationDiagnostics | null = null;
  private cachedSegments: {
    goal: THREE.Vector3;
    path: THREE.Vector3[];
  }[] = [];

  get diagnostics(): RecastNavigationDiagnostics | null {
    return this.diagnosticsState;
  }

  async build(
    colliderRoot: THREE.Object3D,
    robotId: RobotId,
    desiredRoute: readonly THREE.Vector3[],
  ): Promise<THREE.Vector3[]> {
    this.dispose();
    const meshes = collectMeshes(colliderRoot);
    if (meshes.length === 0) {
      throw new Error('Production navigation requires at least one collider mesh');
    }

    const started = performance.now();
    const [{ init, NavMeshQuery }, { threeToSoloNavMesh }] = await Promise.all([
      import('@recast-navigation/core'),
      import('@recast-navigation/three'),
    ]);
    await init();
    const profile = getRecastNavigationProfile(robotId);
    const result = threeToSoloNavMesh(meshes, {
      cs: profile.cellSize,
      ch: profile.cellHeight,
      walkableSlopeAngle: profile.walkableSlopeDegrees,
      walkableHeight: profile.walkableHeightVoxels,
      walkableClimb: profile.walkableClimbVoxels,
      walkableRadius: profile.walkableRadiusVoxels,
      maxEdgeLen: 20,
      maxSimplificationError: 1.3,
      minRegionArea: 2,
      mergeRegionArea: 8,
      maxVertsPerPoly: 6,
      detailSampleDist: 4,
      detailSampleMaxError: 1,
    });
    if (!result.success) {
      throw new Error(`Recast failed to build ${profile.id} navigation: ${result.error}`);
    }

    try {
      this.navMesh = result.navMesh;
      this.query = new NavMeshQuery(result.navMesh, { maxNodes: 4096 });
      this.query.defaultQueryHalfExtents = { ...QUERY_HALF_EXTENTS };
      const route = this.projectReachableRoute(desiredRoute, robotId);
      this.diagnosticsState = {
        mode: 'collider-navmesh',
        profile: profile.id,
        sourceMeshes: meshes.length,
        buildMilliseconds: performance.now() - started,
        routePointsProjected: route.length,
        cachedSegments: this.cachedSegments.length,
      };
      return route;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  plan(start: THREE.Vector3, goal: THREE.Vector3): THREE.Vector3[] {
    const cached = this.cachedSegments
      .map((segment) => ({
        segment,
        distance: horizontalDistanceSquared(segment.goal, goal),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (cached && cached.distance <= CACHED_GOAL_TOLERANCE_SQUARED) {
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      cached.segment.path.forEach((point, index) => {
        const distance = horizontalDistanceSquared(point, start);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      return cached.segment.path.slice(nearestIndex).map((point) => point.clone());
    }
    return this.computePath(start, goal);
  }

  dispose(): void {
    this.query?.destroy();
    this.navMesh?.destroy();
    this.query = null;
    this.navMesh = null;
    this.diagnosticsState = null;
    this.cachedSegments = [];
  }

  private computePath(start: THREE.Vector3, goal: THREE.Vector3): THREE.Vector3[] {
    if (!this.query) return [];
    const result = this.query.computePath(start, goal, {
      halfExtents: QUERY_HALF_EXTENTS,
      maxPathPolys: 512,
      maxStraightPathPoints: 512,
    });
    return result.success ? result.path.map(toThree) : [];
  }

  private projectReachableRoute(
    desiredRoute: readonly THREE.Vector3[],
    robotId: RobotId,
  ): THREE.Vector3[] {
    if (!this.query || desiredRoute.length === 0) return [];
    const projected = desiredRoute.map((point, index) => {
      const nearest = this.query!.findClosestPoint(point, {
        halfExtents: QUERY_HALF_EXTENTS,
      });
      if (!nearest.success) {
        throw new Error(
          `No ${PROFILES[robotId].id} navigation surface near route point ${index} ` +
            `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`,
        );
      }
      const result = toThree(nearest.point);
      if (robotId === 'kestrel-d5') result.y = point.y;
      return result;
    });

    const resolved = [projected[0]];
    for (let index = 1; index < projected.length; index += 1) {
      const previous = resolved[resolved.length - 1];
      const target = projected[index];
      const path = this.computePath(previous, target);
      let endpoint = path.at(-1)?.clone() ?? previous.clone();
      if (endpoint.distanceToSquared(previous) < 0.25) {
        const start = this.query.findNearestPoly(previous, {
          halfExtents: QUERY_HALF_EXTENTS,
        });
        if (start.success) {
          const moved = this.query.moveAlongSurface(start.nearestRef, previous, target, {
            maxVisitedSize: 512,
          });
          if (moved.success) endpoint = toThree(moved.resultPosition);
        }
      }
      if (robotId === 'kestrel-d5') endpoint.y = target.y;
      this.cachedSegments.push({
        goal: endpoint.clone(),
        path:
          path.length > 0
            ? path.map((point) => point.clone())
            : [previous.clone(), endpoint.clone()],
      });
      resolved.push(endpoint);
    }
    return resolved;
  }
}

function horizontalDistanceSquared(left: THREE.Vector3, right: THREE.Vector3): number {
  const deltaX = left.x - right.x;
  const deltaZ = left.z - right.z;
  return deltaX * deltaX + deltaZ * deltaZ;
}
