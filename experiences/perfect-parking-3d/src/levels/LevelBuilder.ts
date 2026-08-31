import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import type { ModelKey } from '../assets/manifest';
import type { ChallengeDef, ObstacleKind } from './challenges';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import { FLOOR_SURFACE_Y } from '../vehicles/VehicleController';
import { ParkingLotArt } from './ParkingLotArt';
import { VISIBLE_ASPHALT_BOUNDS, type AsphaltBounds } from './asphalt';
import { auditChallengePlacements, OBSTACLE_COLLIDER } from './placement';

export { OBSTACLE_COLLIDER } from './placement';

const OBSTACLE_MODEL: Record<ObstacleKind, ModelKey> = {
  cone: 'traffic_cone',
  barrier: 'concrete_barrier',
  bollard: 'bollard',
  booth: 'parking_booth',
  curb: 'curb_piece',
};

/** Physics lot half-extents (walls). Shared with coverage probes. */
export const LOT_HALF_W = 13;
export const LOT_HALF_D = 10;

export class LevelBuilder {
  private readonly root = new THREE.Group();
  private readonly art = new ParkingLotArt();
  private bayHighlight: THREE.Mesh | null = null;
  private asphaltBounds: AsphaltBounds | null = null;
  private pulseTime = 0;
  private parkedCars = 0;
  private genericCars = 0;
  private parkingSpaces = 0;
  private minParkedGroundClearance = 0;
  private maxParkedGroundClearance = 0;
  private minParkedAsphaltClearance = 0;
  private parkedGroundClearances: Array<{ label: string; clearance: number }> = [];
  private minPlacementClearance = 0;
  private placementConflictCount = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetLibrary,
    private readonly physics: PhysicsWorld,
  ) {
    this.scene.add(this.root);
  }

  buildSharedLot(): void {
    const lot = this.assets.cloneModel('asphalt_lot');
    lot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(lot);
    // Seat lot so its top is exactly the shared floor plane.
    lot.position.y += FLOOR_SURFACE_Y - bounds.max.y;
    lot.updateMatrixWorld(true);
    this.asphaltBounds = { ...VISIBLE_ASPHALT_BOUNDS };
    this.physics.setFloorY(FLOOR_SURFACE_Y);
    this.root.add(lot);
    this.art.buildShared(this.root, FLOOR_SURFACE_Y);
  }

  getAsphaltBounds(): AsphaltBounds | null {
    return this.asphaltBounds;
  }

  getSceneCounts(): {
    parkedCars: number;
    genericCars: number;
    parkingSpaces: number;
    environmentAssets: number;
    minParkedGroundClearance: number;
    maxParkedGroundClearance: number;
    minParkedAsphaltClearance: number;
    parkedGroundClearances: Array<{ label: string; clearance: number }>;
    minPlacementClearance: number;
    placementConflictCount: number;
  } {
    return {
      parkedCars: this.parkedCars,
      genericCars: this.genericCars,
      parkingSpaces: this.parkingSpaces,
      environmentAssets: 8,
      minParkedGroundClearance: this.minParkedGroundClearance,
      maxParkedGroundClearance: this.maxParkedGroundClearance,
      minParkedAsphaltClearance: this.minParkedAsphaltClearance,
      parkedGroundClearances: this.parkedGroundClearances.map((entry) => ({ ...entry })),
      minPlacementClearance: this.minPlacementClearance,
      placementConflictCount: this.placementConflictCount,
    };
  }

  loadChallenge(challenge: ChallengeDef): void {
    // Remove prior challenge props (keep shared lot children tagged)
    const toRemove: THREE.Object3D[] = [];
    for (const child of this.root.children) {
      if (child.userData.challengeProp) toRemove.push(child);
    }
    for (const obj of toRemove) {
      this.root.remove(obj);
      disposeObject(obj);
    }

    this.physics.clearStatics();
    this.physics.addLotBounds(LOT_HALF_W, LOT_HALF_D);
    this.pulseTime = 0;

    const floorY = this.physics.getFloorY();
    const sceneCounts = this.art.buildChallenge(this.root, challenge, this.assets, this.physics);
    this.parkedCars = sceneCounts.parkedCars;
    this.genericCars = sceneCounts.genericCars;
    this.parkingSpaces = sceneCounts.parkingSpaces;
    this.minParkedGroundClearance = sceneCounts.minParkedGroundClearance;
    this.maxParkedGroundClearance = sceneCounts.maxParkedGroundClearance;
    this.minParkedAsphaltClearance = sceneCounts.minParkedAsphaltClearance;
    this.parkedGroundClearances = sceneCounts.parkedGroundClearances;

    const placementAudit = auditChallengePlacements(challenge);
    this.minPlacementClearance = placementAudit.minimumClearance;
    this.placementConflictCount = placementAudit.conflicts.length;
    if (placementAudit.conflicts.length > 0) {
      console.error(
        `[placement] Challenge ${challenge.id} has invalid solid placements`,
        placementAudit.conflicts,
      );
    }

    // The green target is the sole parking affordance. The imported bay model
    // used to add a dark inset whose authored orientation fought the painted
    // lot lines, so the ordinary stall outline now stays clean and square.
    const highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(challenge.bay.width, challenge.bay.length),
      new THREE.MeshBasicMaterial({
        color: '#7dffb3',
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    highlight.position.set(challenge.bay.x, this.physics.getFloorY() + 0.05, challenge.bay.z);
    highlight.rotation.order = 'YXZ';
    highlight.rotation.y = challenge.bay.yaw;
    highlight.rotation.x = -Math.PI / 2;
    highlight.userData.challengeProp = true;
    highlight.userData.disposeGeometry = true;
    this.bayHighlight = highlight;
    this.root.add(highlight);

    const mat = highlight.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.42;

    for (const obs of challenge.obstacles) {
      const pivot = new THREE.Group();
      const model = this.assets.cloneModel(OBSTACLE_MODEL[obs.kind]);
      pivot.add(model);
      pivot.position.set(obs.x, floorY, obs.z);
      pivot.rotation.y = obs.yaw ?? 0;
      pivot.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(pivot);
      pivot.position.y += floorY - b.min.y;
      pivot.userData.challengeProp = true;
      this.root.add(pivot);

      const col = OBSTACLE_COLLIDER[obs.kind];
      this.physics.addStaticBox({
        x: obs.x,
        y: floorY + col.y,
        z: obs.z,
        hx: col.hx,
        hy: col.hy,
        hz: col.hz,
        yaw: obs.yaw ?? 0,
        tag: 'obstacle',
        label: `${obs.kind}@${obs.x.toFixed(2)},${obs.z.toFixed(2)}`,
      });
    }

    // Side-line sensors match the actual target dimensions. The open mouth is
    // intentionally not a sensor: entering a space should not count as a hit.
    const fx = Math.sin(challenge.bay.yaw);
    const fz = Math.cos(challenge.bay.yaw);
    const rx = Math.cos(challenge.bay.yaw);
    const rz = -Math.sin(challenge.bay.yaw);
    for (const side of [-1, 1]) {
      this.physics.addStaticBox({
        x: challenge.bay.x + rx * (challenge.bay.width / 2) * side,
        y: floorY + 0.05,
        z: challenge.bay.z + rz * (challenge.bay.width / 2) * side,
        hx: 0.05,
        hy: 0.05,
        hz: challenge.bay.length / 2,
        yaw: challenge.bay.yaw,
        tag: 'line',
        label: `target-line-${side < 0 ? 'left' : 'right'}`,
      });
    }
    void fx;
    void fz;
  }

  pulseBay(align: number, inside: boolean, dt: number): void {
    if (!this.bayHighlight) return;
    this.pulseTime += dt;
    const mat = this.bayHighlight.material as THREE.MeshBasicMaterial;
    const pulse = 0.2 + align * 0.3 + Math.sin(this.pulseTime * 5.5) * 0.035;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, pulse, 1 - Math.exp(-dt * 8));
    // Keep one consistent green parking affordance in every state. Opacity
    // communicates improving alignment without turning the square amber/red.
    mat.color.set(inside ? '#65f2a7' : align >= 0.62 ? '#83eeb0' : '#75cf9b');
  }
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      if (mesh.userData.disposeGeometry) mesh.geometry?.dispose();
      if (!mesh.userData.sharedParkingArt) {
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
        else mesh.material?.dispose();
      }
    }
  });
}
