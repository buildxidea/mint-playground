import type {
  Collider,
  KinematicCharacterController,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  prepareSplatCutVolumes,
  triangleIntersectsCutVolume,
  type SplatCutVolume,
} from '../world/SplatCutVolume';
import {
  clipPolygonToTrimPlane,
  prepareSplatTrimPlanes,
  type SplatTrimPlane,
} from '../world/SplatTrimPlane';

const FIXED_TIMESTEP = 1 / 60;
const MIN_WALKABLE_NORMAL_Y = Math.cos((48 * Math.PI) / 180);
type RapierModule = typeof import('@dimforge/rapier3d-compat');

export type PhysicsDiagnostics = {
  engine: 'rapier';
  timestep: number;
  bodies: number;
  colliders: number;
  sensors: number;
  ccdBodies: number;
  boundaryColliders: number;
  ballisticQueries: number;
  ballisticBlocks: number;
  facilityColliders: number;
  facilityCollidersEnabled: boolean;
  playerMotion: {
    fixedSteps: number;
    planarDistance: number;
    maxPlanarStep: number;
    teleportCount: number;
    teleportEvents: Array<{
      sequence: number;
      from: { x: number; y: number; z: number };
      to: { x: number; y: number; z: number };
      planarDistance: number;
    }>;
  };
  characterCollisions: Array<{
    handle: number;
    label: string;
    normal: { x: number; y: number; z: number };
    remaining: { x: number; y: number; z: number };
  }>;
};

export type BallisticHit = {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
};

export type SurfaceSample = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  walkable: boolean;
};

export class PhysicsWorld {
  private readonly world: World;
  private readonly controller: KinematicCharacterController;
  private playerBody: RigidBody | null = null;
  private playerCollider: Collider | null = null;
  private verticalVelocity = 0;
  private grounded = false;
  private sensors = 0;
  private boundaryColliders: Collider[] = [];
  private facilityColliders: Collider[] = [];
  private registeringFacilityColliders = true;
  private facilityCollidersEnabled = true;
  private ballisticQueries = 0;
  private ballisticBlocks = 0;
  private readonly colliderLabels = new Map<number, string>();
  private characterCollisions: PhysicsDiagnostics['characterCollisions'] = [];
  private playerMotion: PhysicsDiagnostics['playerMotion'] = {
    fixedSteps: 0,
    planarDistance: 0,
    maxPlanarStep: 0,
    teleportCount: 0,
    teleportEvents: [],
  };

  static async create(): Promise<PhysicsWorld> {
    const rapier = await import('@dimforge/rapier3d-compat');
    await rapier.init();
    return new PhysicsWorld(rapier);
  }

  private constructor(private readonly rapier: RapierModule) {
    this.world = new rapier.World({ x: 0, y: -19.6, z: 0 });
    this.controller = this.world.createCharacterController(0.025);
    this.world.timestep = FIXED_TIMESTEP;
    this.controller.enableAutostep(0.38, 0.2, true);
    this.controller.enableSnapToGround(0.22);
    this.controller.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((52 * Math.PI) / 180);
  }

  createPlayer(position: THREE.Vector3): void {
    if (this.playerBody) return;
    this.playerBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
        position.x,
        position.y,
        position.z,
      ),
    );
    this.playerCollider = this.world.createCollider(
      this.rapier.ColliderDesc.capsule(0.62, 0.34)
        .setFriction(0)
        .setCollisionGroups(0x0001_ffff),
      this.playerBody,
    );
  }

  addBox(
    center: THREE.Vector3,
    halfExtents: THREE.Vector3,
    rotationY = 0,
    sensor = false,
    label = 'box',
  ): Collider {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({
          x: 0,
          y: Math.sin(rotationY / 2),
          z: 0,
          w: Math.cos(rotationY / 2),
        }),
    );
    const desc = this.rapier.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z,
    );
    if (sensor) {
      desc.setSensor(true);
      this.sensors += 1;
    }
    const collider = this.world.createCollider(desc, body);
    this.colliderLabels.set(collider.handle, label);
    if (this.registeringFacilityColliders && !sensor) {
      this.facilityColliders.push(collider);
    }
    return collider;
  }

  addRamp(
    center: THREE.Vector3,
    halfExtents: THREE.Vector3,
    rotationX: number,
  ): Collider {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({
          x: Math.sin(rotationX / 2),
          y: 0,
          z: 0,
          w: Math.cos(rotationX / 2),
        }),
    );
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z),
      body,
    );
    if (this.registeringFacilityColliders) this.facilityColliders.push(collider);
    return collider;
  }

  completeFacilityColliderRegistration(): void {
    this.registeringFacilityColliders = false;
  }

  setFacilityCollidersEnabled(enabled: boolean): void {
    this.facilityCollidersEnabled = enabled;
    this.facilityColliders.forEach((collider) => collider.setEnabled(enabled));
  }

  addTrimeshScene(root: THREE.Object3D): number {
    return this.addTrimeshSceneColliders(root).length;
  }

  addTrimeshSceneColliders(
    root: THREE.Object3D,
    label = 'trimesh',
    collisionGroups?: number,
    cutVolumes: readonly SplatCutVolume[] = [],
    trimPlanes: readonly SplatTrimPlane[] = [],
  ): Collider[] {
    root.updateMatrixWorld(true);
    const registered: Collider[] = [];
    const vertex = new THREE.Vector3();
    const preparedCuts = prepareSplatCutVolumes(cutVolumes);
    const preparedTrims = prepareSplatTrimPlanes(trimPlanes);
    const triangleA = new THREE.Vector3();
    const triangleB = new THREE.Vector3();
    const triangleC = new THREE.Vector3();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      const position = geometry.getAttribute('position');
      if (!position || position.count < 3) return;

      const vertices = new Float32Array(position.count * 3);
      for (let index = 0; index < position.count; index += 1) {
        vertex
          .set(position.getX(index), position.getY(index), position.getZ(index))
          .applyMatrix4(object.matrixWorld);
        const offset = index * 3;
        vertices[offset] = vertex.x;
        vertices[offset + 1] = vertex.y;
        vertices[offset + 2] = vertex.z;
      }

      let sourceIndices: Uint32Array;
      if (geometry.index) {
        sourceIndices = new Uint32Array(geometry.index.count);
        for (let index = 0; index < geometry.index.count; index += 1) {
          sourceIndices[index] = geometry.index.getX(index);
        }
      } else {
        const usableCount = position.count - (position.count % 3);
        if (usableCount < 3) return;
        sourceIndices = new Uint32Array(usableCount);
        for (let index = 0; index < usableCount; index += 1) {
          sourceIndices[index] = index;
        }
      }
      let colliderVertices = vertices;
      let indices = sourceIndices;
      if (preparedTrims.length > 0) {
        const trimmedVertices: number[] = [];
        const trimmedIndices: number[] = [];
        for (let offset = 0; offset < sourceIndices.length; offset += 3) {
          const aIndex = sourceIndices[offset]!;
          const bIndex = sourceIndices[offset + 1]!;
          const cIndex = sourceIndices[offset + 2]!;
          triangleA.fromArray(vertices, aIndex * 3);
          triangleB.fromArray(vertices, bIndex * 3);
          triangleC.fromArray(vertices, cIndex * 3);
          if (
            preparedCuts.some((cut) =>
              triangleIntersectsCutVolume(
                triangleA,
                triangleB,
                triangleC,
                cut,
              ),
            )
          ) {
            continue;
          }
          let polygon = [
            triangleA.clone(),
            triangleB.clone(),
            triangleC.clone(),
          ];
          for (const trim of preparedTrims) {
            polygon = clipPolygonToTrimPlane(polygon, trim);
            if (polygon.length < 3) break;
          }
          if (polygon.length < 3) continue;
          const base = trimmedVertices.length / 3;
          for (const point of polygon) {
            trimmedVertices.push(point.x, point.y, point.z);
          }
          for (let index = 1; index < polygon.length - 1; index += 1) {
            trimmedIndices.push(base, base + index, base + index + 1);
          }
        }
        if (trimmedIndices.length < 3) return;
        colliderVertices = new Float32Array(trimmedVertices);
        indices = new Uint32Array(trimmedIndices);
      } else if (preparedCuts.length > 0) {
        const kept: number[] = [];
        for (let offset = 0; offset < sourceIndices.length; offset += 3) {
          const aIndex = sourceIndices[offset]!;
          const bIndex = sourceIndices[offset + 1]!;
          const cIndex = sourceIndices[offset + 2]!;
          triangleA.fromArray(vertices, aIndex * 3);
          triangleB.fromArray(vertices, bIndex * 3);
          triangleC.fromArray(vertices, cIndex * 3);
          if (
            preparedCuts.some((cut) =>
              triangleIntersectsCutVolume(
                triangleA,
                triangleB,
                triangleC,
                cut,
              ),
            )
          ) {
            continue;
          }
          kept.push(aIndex, bIndex, cIndex);
        }
        if (kept.length < 3) return;
        indices = new Uint32Array(kept);
      }

      const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed());
      const descriptor = this.rapier.ColliderDesc.trimesh(
        colliderVertices,
        indices,
      );
      if (collisionGroups !== undefined) {
        descriptor.setCollisionGroups(collisionGroups);
      }
      const collider = this.world.createCollider(descriptor, body);
      this.colliderLabels.set(collider.handle, label);
      registered.push(collider);
    });
    return registered;
  }

  addStaticTrimesh(
    vertices: Float32Array,
    indices: Uint32Array,
    label = 'static-trimesh',
  ): Collider {
    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed());
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.trimesh(vertices, indices),
      body,
    );
    this.colliderLabels.set(collider.handle, label);
    if (this.registeringFacilityColliders) {
      this.facilityColliders.push(collider);
    }
    return collider;
  }

  removeColliders(colliders: Collider[]): void {
    for (const collider of colliders) {
      this.colliderLabels.delete(collider.handle);
      const body = collider.parent();
      this.world.removeCollider(collider, true);
      if (body) this.world.removeRigidBody(body);
    }
  }

  clearWorldBoundary(): void {
    for (const collider of this.boundaryColliders) {
      const body = collider.parent();
      this.world.removeCollider(collider, true);
      if (body) this.world.removeRigidBody(body);
    }
    this.boundaryColliders = [];
  }

  /** Replace existing boundary walls with a new containment box. */
  setWorldBoundary(bounds: THREE.Box3, inset = 1.25): number {
    this.clearWorldBoundary();
    return this.addWorldBoundary(bounds, inset);
  }

  addWorldBoundary(bounds: THREE.Box3, inset = 1.25): number {
    if (this.boundaryColliders.length > 0 || bounds.isEmpty()) {
      return this.boundaryColliders.length;
    }
    const minX = bounds.min.x + inset;
    const maxX = bounds.max.x - inset;
    const minZ = bounds.min.z + inset;
    const maxZ = bounds.max.z - inset;
    const width = Math.max(1, maxX - minX);
    const depth = Math.max(1, maxZ - minZ);
    const wallHeight = Math.max(12, bounds.max.y - bounds.min.y + 4);
    const centerY = bounds.min.y + wallHeight * 0.5 - 1;
    const thickness = 0.3;
    this.boundaryColliders = [
      this.addBox(
        new THREE.Vector3(minX, centerY, (minZ + maxZ) * 0.5),
        new THREE.Vector3(thickness, wallHeight * 0.5, depth * 0.5),
      ),
      this.addBox(
        new THREE.Vector3(maxX, centerY, (minZ + maxZ) * 0.5),
        new THREE.Vector3(thickness, wallHeight * 0.5, depth * 0.5),
      ),
      this.addBox(
        new THREE.Vector3((minX + maxX) * 0.5, centerY, minZ),
        new THREE.Vector3(width * 0.5, wallHeight * 0.5, thickness),
      ),
      this.addBox(
        new THREE.Vector3((minX + maxX) * 0.5, centerY, maxZ),
        new THREE.Vector3(width * 0.5, wallHeight * 0.5, thickness),
      ),
    ];
    return this.boundaryColliders.length;
  }

  /**
   * Downward collider query used by player spawn, enemies, props, and HUD.
   * Hits the World Labs trimesh / facility colliders — never the RAD splat mesh.
   */
  sampleSurface(
    x: number,
    z: number,
    preferY = 2,
    castHeight = 2,
    maxDrop = 10,
    target = new THREE.Vector3(),
    normalTarget = new THREE.Vector3(),
  ): SurfaceSample | null {
    const originY = preferY + castHeight;
    const ray = new this.rapier.Ray(
      { x, y: originY, z },
      { x: 0, y: -1, z: 0 },
    );
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDrop + castHeight,
      false,
      undefined,
      undefined,
      this.playerCollider ?? undefined,
    );
    if (!hit) return null;
    const normal = normalTarget
      .set(hit.normal.x, hit.normal.y, hit.normal.z)
      .normalize();
    return {
      point: target.set(x, originY - hit.timeOfImpact, z),
      normal,
      walkable: normal.y >= MIN_WALKABLE_NORMAL_Y,
    };
  }

  findGroundedSpawn(
    x: number,
    z: number,
    preferredBodyY = 1,
    target = new THREE.Vector3(),
  ): THREE.Vector3 {
    const sample = this.sampleSurface(x, z, preferredBodyY, 0.75, 4.5, target);
    if (sample?.walkable) {
      return target.set(x, sample.point.y + 0.98, z);
    }
    return target.set(x, preferredBodyY, z);
  }

  /**
   * Cast from high above a Maps/collider arena. Prefers walkable hits above
   * minWalkableY; optionally accepts any solid hit as a fallback sample.
   */
  findHighestWalkableFoot(
    x: number,
    z: number,
    castFromY: number,
    minWalkableY: number,
    maxDrop = 120,
    options?: { allowNonWalkable?: boolean },
  ): { footY: number; normal: THREE.Vector3; walkable: boolean } | null {
    const sample = this.sampleSurface(
      x,
      z,
      castFromY - 0.75,
      0.75,
      maxDrop,
    );
    if (!sample) return null;
    if (sample.point.y < minWalkableY - 0.5) return null;
    if (!sample.walkable && !options?.allowNonWalkable) return null;
    return {
      footY: sample.point.y,
      normal: sample.normal.clone(),
      walkable: sample.walkable,
    };
  }

  /** Invisible kinematic deck used when Mint colliders are water/void-only. */
  addMapsDeckFloor(bounds: THREE.Box3, deckY: number): Collider {
    const width = Math.max(8, bounds.max.x - bounds.min.x);
    const depth = Math.max(8, bounds.max.z - bounds.min.z);
    const center = new THREE.Vector3(
      (bounds.min.x + bounds.max.x) * 0.5,
      deckY - 0.15,
      (bounds.min.z + bounds.max.z) * 0.5,
    );
    const half = new THREE.Vector3(width * 0.5, 0.15, depth * 0.5);
    return this.addBox(center, half, 0, false, 'maps-deck-floor');
  }

  /**
   * Search a spiral around (centerX, centerZ) for the highest walkable deck
   * suitable for Maps Outbreak spawn / floor mounts.
   */
  findBestMapsGroundedSpawn(
    centerX: number,
    centerZ: number,
    bounds: THREE.Box3,
    target = new THREE.Vector3(),
  ): THREE.Vector3 | null {
    if (!Number.isFinite(bounds.min.y) || !Number.isFinite(bounds.max.y)) {
      return null;
    }
    const castFromY = Math.max(bounds.max.y + 8, bounds.min.y + 24);
    const minWalkableY = bounds.min.y - 0.25;
    const radiusMax = Math.min(
      18,
      Math.max(
        4,
        Math.min(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) *
          0.42,
      ),
    );
    const candidates: Array<{
      x: number;
      z: number;
      footY: number;
      walkable: boolean;
    }> = [];
    const consider = (x: number, z: number, allowNonWalkable = false) => {
      if (
        x < bounds.min.x + 0.5 ||
        x > bounds.max.x - 0.5 ||
        z < bounds.min.z + 0.5 ||
        z > bounds.max.z - 0.5
      ) {
        return;
      }
      const hit = this.findHighestWalkableFoot(
        x,
        z,
        castFromY,
        minWalkableY,
        160,
        { allowNonWalkable },
      );
      if (!hit) return;
      candidates.push({
        x,
        z,
        footY: hit.footY,
        walkable: hit.walkable,
      });
    };
    consider(centerX, centerZ);
    for (let ring = 1; ring <= 12; ring += 1) {
      const radius = (ring / 12) * radiusMax;
      const steps = 8 + ring * 4;
      for (let step = 0; step < steps; step += 1) {
        const angle = (step / steps) * Math.PI * 2;
        consider(
          centerX + Math.cos(angle) * radius,
          centerZ + Math.sin(angle) * radius,
        );
      }
    }
    // Second pass: accept non-walkable solids if the trimesh normals are harsh.
    if (candidates.length === 0) {
      consider(centerX, centerZ, true);
      for (let ring = 1; ring <= 8; ring += 1) {
        const radius = (ring / 8) * radiusMax;
        const steps = 8 + ring * 3;
        for (let step = 0; step < steps; step += 1) {
          const angle = (step / steps) * Math.PI * 2;
          consider(
            centerX + Math.cos(angle) * radius,
            centerZ + Math.sin(angle) * radius,
            true,
          );
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if (a.walkable !== b.walkable) return a.walkable ? -1 : 1;
      const height = b.footY - a.footY;
      if (Math.abs(height) > 0.05) return height;
      return (
        Math.hypot(a.x - centerX, a.z - centerZ) -
        Math.hypot(b.x - centerX, b.z - centerZ)
      );
    });
    const best = candidates[0]!;
    return target.set(best.x, best.footY + 0.98, best.z);
  }

  /** Foot height for actors whose group origin sits on the floor. */
  findGroundedFootY(
    x: number,
    z: number,
    preferY = 2,
    maxDrop = 3,
    fallbackY = preferY,
  ): number {
    const sample = this.sampleSurface(x, z, preferY, 0.6, maxDrop);
    return sample?.walkable ? sample.point.y : fallbackY;
  }

  /**
   * Ballistics, enemy sightlines, and movement all query this same Rapier world.
   * The player capsule is excluded because callers compare the world hit with
   * their explicit gameplay target.
   */
  castBallisticRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): BallisticHit | null {
    if (maxDistance <= 0 || direction.lengthSq() <= 1e-8) return null;
    this.ballisticQueries += 1;
    const normalized = direction.clone().normalize();
    const ray = new this.rapier.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: normalized.x, y: normalized.y, z: normalized.z },
    );
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      false,
      undefined,
      undefined,
      this.playerCollider ?? undefined,
    );
    if (!hit) return null;
    this.ballisticBlocks += 1;
    return {
      distance: hit.timeOfImpact,
      point: origin.clone().addScaledVector(normalized, hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize(),
    };
  }

  movePlayer(
    horizontalVelocity: THREE.Vector3,
    jumpRequested: boolean,
    delta = FIXED_TIMESTEP,
    constrain?: (
      previous: THREE.Vector3,
      proposed: THREE.Vector3,
    ) => THREE.Vector3,
  ): THREE.Vector3 {
    if (!this.playerBody || !this.playerCollider) return new THREE.Vector3();
    if (jumpRequested && this.grounded) {
      this.verticalVelocity = 6.6;
      this.grounded = false;
    }
    this.verticalVelocity += -19.6 * delta;
    this.verticalVelocity = Math.max(this.verticalVelocity, -23);

    const desired = {
      x: horizontalVelocity.x * delta,
      y: this.verticalVelocity * delta,
      z: horizontalVelocity.z * delta,
    };
    this.controller.computeColliderMovement(this.playerCollider, desired);
    this.characterCollisions = [];
    for (let index = 0; index < this.controller.numComputedCollisions(); index += 1) {
      const collision = this.controller.computedCollision(index);
      const collider = collision?.collider;
      if (!collision || !collider) continue;
      this.characterCollisions.push({
        handle: collider.handle,
        label: this.colliderLabels.get(collider.handle) ?? 'unlabeled',
        normal: {
          x: collision.normal1.x,
          y: collision.normal1.y,
          z: collision.normal1.z,
        },
        remaining: {
          x: collision.translationDeltaRemaining.x,
          y: collision.translationDeltaRemaining.y,
          z: collision.translationDeltaRemaining.z,
        },
      });
    }
    const movement = this.controller.computedMovement();
    const current = this.playerBody.translation();
    const previous = new THREE.Vector3(current.x, current.y, current.z);
    const proposed = new THREE.Vector3(
      current.x + movement.x,
      current.y + movement.y,
      current.z + movement.z,
    );
    const committedPosition = constrain
      ? constrain(previous, proposed)
      : proposed;
    this.playerBody.setNextKinematicTranslation({
      x: committedPosition.x,
      y: committedPosition.y,
      z: committedPosition.z,
    });
    this.world.step();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = -0.25;
    const committed = this.getPlayerPosition();
    const planarStep = Math.hypot(
      committed.x - current.x,
      committed.z - current.z,
    );
    this.playerMotion.fixedSteps += 1;
    this.playerMotion.planarDistance += planarStep;
    this.playerMotion.maxPlanarStep = Math.max(
      this.playerMotion.maxPlanarStep,
      planarStep,
    );
    return committed;
  }

  teleportPlayer(position: THREE.Vector3): void {
    if (!this.playerBody) return;
    const from = this.getPlayerPosition();
    this.playerMotion.teleportCount += 1;
    this.playerMotion.teleportEvents.push({
      sequence: this.playerMotion.teleportCount,
      from: { x: from.x, y: from.y, z: from.z },
      to: { x: position.x, y: position.y, z: position.z },
      planarDistance: Math.hypot(position.x - from.x, position.z - from.z),
    });
    if (this.playerMotion.teleportEvents.length > 64) {
      this.playerMotion.teleportEvents.shift();
    }
    this.playerBody.setTranslation(position, true);
    this.playerBody.setNextKinematicTranslation(position);
    this.verticalVelocity = 0;
    this.grounded = false;
    this.world.step();
  }

  resetPlayerMotionDiagnostics(): void {
    this.playerMotion = {
      fixedSteps: 0,
      planarDistance: 0,
      maxPlanarStep: 0,
      teleportCount: 0,
      teleportEvents: [],
    };
  }

  getPlayerPosition(target = new THREE.Vector3()): THREE.Vector3 {
    if (!this.playerBody) return target.set(0, 1, 0);
    const translation = this.playerBody.translation();
    return target.set(translation.x, translation.y, translation.z);
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  diagnostics(): PhysicsDiagnostics {
    return {
      engine: 'rapier',
      timestep: FIXED_TIMESTEP,
      bodies: this.world.bodies.len(),
      colliders: this.world.colliders.len(),
      sensors: this.sensors,
      ccdBodies: 0,
      boundaryColliders: this.boundaryColliders.length,
      ballisticQueries: this.ballisticQueries,
      ballisticBlocks: this.ballisticBlocks,
      facilityColliders: this.facilityColliders.length,
      facilityCollidersEnabled: this.facilityCollidersEnabled,
      playerMotion: {
        ...this.playerMotion,
        teleportEvents: this.playerMotion.teleportEvents.map((event) => ({
          ...event,
          from: { ...event.from },
          to: { ...event.to },
        })),
      },
      characterCollisions: this.characterCollisions,
    };
  }

  dispose(): void {
    this.world.free();
  }
}
