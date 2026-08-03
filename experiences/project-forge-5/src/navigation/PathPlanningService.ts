import * as THREE from 'three';
import type { RobotId, RoomId } from '../config/catalog';
import { COMMISSIONING_COLLIDERS } from '../worlds/commissioningCourse';
import type { Aabb2, GridPlanRequest, Point2 } from './gridPlanner';
import {
  RecastNavigationRuntime,
  type RecastNavigationDiagnostics,
} from './RecastNavigationRuntime';

type Pending = {
  resolve: (path: THREE.Vector3[]) => void;
  reject: (error: Error) => void;
};

const CLEARANCE: Readonly<Record<RobotId, number>> = {
  'axiom-h1': 0.34,
  'quadrant-q4': 0.48,
  'forge-t7': 0.8,
  'swift-w2': 0.5,
  'kestrel-d5': 0.08,
};

export class PathPlanningService {
  private readonly worker = new Worker(new URL('./pathPlanner.worker.ts', import.meta.url), {
    type: 'module',
  });
  private readonly pending = new Map<number, Pending>();
  private readonly productionNavigation = new RecastNavigationRuntime();
  private productionReady = false;
  private nextId = 1;

  constructor() {
    this.worker.addEventListener('message', this.onMessage);
    this.worker.addEventListener('error', this.onError);
  }

  plan(
    start: THREE.Vector3,
    goal: THREE.Vector3,
    robotId: RobotId,
    roomId: RoomId,
  ): Promise<THREE.Vector3[]> {
    if (this.productionReady) {
      if (!this.productionNavigation.diagnostics) {
        return Promise.reject(new Error('Production navigation lost its collider navmesh'));
      }
      return Promise.resolve(this.productionNavigation.plan(start, goal));
    }
    const id = this.nextId++;
    const obstacles: Aabb2[] = COMMISSIONING_COLLIDERS[roomId]
      .filter((collider) => collider.navigationObstacle)
      .map((collider) => ({
        minX: collider.position[0] - collider.size[0] * 0.5,
        maxX: collider.position[0] + collider.size[0] * 0.5,
        minZ: collider.position[2] - collider.size[2] * 0.5,
        maxZ: collider.position[2] + collider.size[2] * 0.5,
      }));
    const request: GridPlanRequest = {
      start: { x: start.x, z: start.z },
      goal: { x: goal.x, z: goal.z },
      bounds: { minX: -17, maxX: 17, minZ: -11, maxZ: 11 },
      obstacles: robotId === 'kestrel-d5' ? [] : obstacles,
      cellSize: 0.4,
      clearance: CLEARANCE[robotId],
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, request });
    });
  }

  async useProductionCollider(
    colliderRoot: THREE.Object3D,
    robotId: RobotId,
    desiredRoute: readonly THREE.Vector3[],
  ): Promise<THREE.Vector3[]> {
    this.productionReady = false;
    const route = await this.productionNavigation.build(colliderRoot, robotId, desiredRoute);
    this.productionReady = true;
    return route;
  }

  useCommissioningBounds(): void {
    this.productionReady = false;
    this.productionNavigation.dispose();
  }

  get productionDiagnostics(): RecastNavigationDiagnostics | null {
    return this.productionNavigation.diagnostics;
  }

  dispose(): void {
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.terminate();
    this.productionReady = false;
    this.productionNavigation.dispose();
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Path planner disposed'));
    }
    this.pending.clear();
  }

  private readonly onMessage = (event: MessageEvent<{ id: number; path: Point2[] }>) => {
    const pending = this.pending.get(event.data.id);
    if (!pending) return;
    this.pending.delete(event.data.id);
    pending.resolve(event.data.path.map((point) => new THREE.Vector3(point.x, 0, point.z)));
  };

  private readonly onError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'Path planning worker failed');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  };
}
