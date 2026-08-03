import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { RobotId } from '../config/catalog';
import { createMintGltfLoader } from '../assets/createMintGltfLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  heldCarryMotion,
  resolveRobotCarryMotion,
  type CarryableObjectId,
  type RobotCarryMotion,
  type RobotCarryVisualState,
} from '../robots/RobotCarryRigContract';
import type { RobotTaskSnapshot } from '../tasks/RobotTaskController';
import { disposeObject3D } from '../utils/dispose';
import { resolveRobotCarryPose, type RobotCarryPose } from './RobotCarryPoseCatalog';

export type OutdoorFreeplayObjectState = 'free' | 'held' | 'thrown' | 'placed';

export type OutdoorFreeplayObjectDefinition = Readonly<{
  id: CarryableObjectId;
  label: string;
  publicUrl: string;
  byteSize: number;
  sha256: string;
  resetOffset: readonly [number, number];
  collider:
    | Readonly<{ shape: 'ball'; radius: number }>
    | Readonly<{ shape: 'cuboid'; halfExtents: readonly [number, number, number] }>
    | Readonly<{ shape: 'cylinder'; halfHeight: number; radius: number }>;
  mass: number;
  friction: number;
  restitution: number;
  throwSpeed: number;
}>;

export type OutdoorFreeplayObjectObservation = Readonly<{
  id: string;
  label: string;
  state: OutdoorFreeplayObjectState;
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: Readonly<{ x: number; y: number; z: number }>;
}>;

export type OutdoorFreeplaySnapshot = Readonly<{
  status: 'inactive' | 'loading' | 'ready' | 'error';
  targetId: string | null;
  targetLabel: string | null;
  heldId: string | null;
  heldLabel: string | null;
  carry: RobotCarryVisualState | null;
  attachmentErrorMeters: number | null;
  orientationErrorDegrees: number | null;
  lastAction: 'none' | 'picked-up' | 'placed' | 'thrown' | 'reset' | 'recovered';
  corrections: number;
  objects: readonly OutdoorFreeplayObjectObservation[];
}>;

type ObjectBinding = {
  definition: OutdoorFreeplayObjectDefinition;
  root: THREE.Group;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  halfHeight: number;
  selectionRadius: number;
  resetPosition: THREE.Vector3;
  state: OutdoorFreeplayObjectState;
  joint: RAPIER.ImpulseJoint | null;
  pickupRotation: THREE.Quaternion;
};

const ROBOT_COLLISION_GROUP = 1 << 1;
const FREEPLAY_OBJECT_COLLISION_GROUP = 1 << 4;
const ALL_COLLISION_GROUPS = 0xffff;
const interactionGroups = (membership: number, filter = ALL_COLLISION_GROUPS): number =>
  ((membership & ALL_COLLISION_GROUPS) << 16) | (filter & ALL_COLLISION_GROUPS);

const IDENTITY_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const DOWN = new THREE.Vector3(0, -1, 0);

export class OutdoorFreeplayObjects {
  readonly root = new THREE.Group();

  private readonly bindings = new Map<string, ObjectBinding>();
  private readonly highlightBounds = new THREE.Box3();
  private readonly highlight = new THREE.Box3Helper(this.highlightBounds, 0xffd66b);
  private readonly cameraDirection = new THREE.Vector3();
  private readonly robotForward = new THREE.Vector3();
  private readonly carryPosition = new THREE.Vector3();
  private readonly desiredCarryPosition = new THREE.Vector3();
  private readonly carryOffset = new THREE.Vector3();
  private readonly carryQuaternion = new THREE.Quaternion();
  private readonly desiredCarryQuaternion = new THREE.Quaternion();
  private readonly anchorQuaternion = new THREE.Quaternion();
  private readonly rotationDelta = new THREE.Quaternion();
  private readonly localCarryQuaternion = new THREE.Quaternion();
  private readonly placementPosition = new THREE.Vector3();
  private readonly placementQuaternion = new THREE.Quaternion();
  private readonly worldBounds = new THREE.Box3();
  private anchorBody: RAPIER.RigidBody | null = null;
  private targetId: CarryableObjectId | null = null;
  private heldId: CarryableObjectId | null = null;
  private pendingPickupId: CarryableObjectId | null = null;
  private pendingPlacementId: CarryableObjectId | null = null;
  private readonly pickupStartPosition = new THREE.Vector3();
  private activeCarryPose: RobotCarryPose | null = null;
  private carryMotion: RobotCarryMotion | null = null;
  private attachmentErrorMeters: number | null = null;
  private orientationErrorDegrees: number | null = null;
  private status: OutdoorFreeplaySnapshot['status'] = 'inactive';
  private lastAction: OutdoorFreeplaySnapshot['lastAction'] = 'none';
  private corrections = 0;
  private revision = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.root.name = 'outdoor-freeplay-objects';
    this.root.userData.productionAsset = true;
    this.highlight.name = 'outdoor-freeplay-target';
    this.highlight.visible = false;
    this.highlight.renderOrder = 20;
    const material = this.highlight.material as THREE.LineBasicMaterial;
    material.transparent = true;
    material.opacity = 0.92;
    material.depthTest = false;
    this.scene.add(this.root, this.highlight);
  }

  async load(
    definitions: readonly OutdoorFreeplayObjectDefinition[],
    spawnSurface: THREE.Vector3,
    worldBounds: THREE.Box3,
  ): Promise<void> {
    if (this.disposed) throw new Error('Outdoor freeplay objects have been disposed');
    const revision = ++this.revision;
    this.unloadBindings();
    this.status = 'loading';
    this.worldBounds.copy(worldBounds);
    const gltf = createMintGltfLoader();
    const loaded: THREE.Object3D[] = [];
    try {
      const scenes = await Promise.all(
        definitions.map(async (definition) => {
          const result = await gltf.loader.loadAsync(definition.publicUrl);
          loaded.push(result.scene);
          return [definition, result.scene] as const;
        }),
      );
      if (this.disposed || revision !== this.revision) {
        throw new Error('Outdoor freeplay object load was superseded');
      }

      for (const [definition, imported] of scenes) {
        const binding = this.createBinding(definition, imported, spawnSurface);
        loaded.splice(loaded.indexOf(imported), 1);
        this.bindings.set(definition.id, binding);
        this.root.add(binding.root);
      }
      this.anchorBody = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          spawnSurface.x,
          spawnSurface.y + 1,
          spawnSurface.z,
        ),
      );
      this.status = 'ready';
      this.lastAction = 'reset';
      this.updatePresentation();
    } catch (error) {
      this.status = 'error';
      this.unloadBindings();
      for (const imported of loaded) disposeObject3D(imported);
      throw error;
    } finally {
      gltf.dispose();
    }
  }

  beforePhysics(
    robotId: RobotId,
    carrySocket: THREE.Object3D,
    taskAction?: RobotTaskSnapshot,
  ): void {
    if (!this.anchorBody) return;
    const interactionId = this.heldId ?? this.pendingPickupId ?? this.pendingPlacementId;
    this.activeCarryPose = interactionId ? resolveRobotCarryPose(robotId, interactionId) : null;
    this.resolveCarryTransform(carrySocket, this.activeCarryPose);

    if (this.pendingPickupId) {
      const motion =
        taskAction?.active && taskAction.verb === 'grasp'
          ? resolveRobotCarryMotion(taskAction.phase, 'pickup')
          : resolveRobotCarryMotion(0, 'pickup');
      this.carryMotion = motion;
      if (!motion.attachReady) return;
      const pending = this.bindings.get(this.pendingPickupId);
      if (!pending || !this.attachAtCurrentPose(pending)) {
        this.pendingPickupId = null;
        this.activeCarryPose = null;
        this.carryMotion = null;
        return;
      }
      const position = pending.body.translation();
      this.pickupStartPosition.set(position.x, position.y, position.z);
      const rotation = pending.body.rotation();
      pending.pickupRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this.pendingPickupId = null;
    }

    if (!this.heldId) return;

    const binding = this.bindings.get(this.heldId);
    if (!binding) return;
    if (this.pendingPlacementId) {
      const motion =
        taskAction?.active && taskAction.verb === 'release'
          ? resolveRobotCarryMotion(taskAction.phase, 'release')
          : resolveRobotCarryMotion(0, 'release');
      this.carryMotion = motion;
      this.carryPosition.lerpVectors(
        this.placementPosition,
        this.desiredCarryPosition,
        motion.lift,
      );
      this.carryQuaternion.slerpQuaternions(
        this.placementQuaternion,
        this.desiredCarryQuaternion,
        motion.lift,
      );
      this.moveAnchorFor(binding, this.carryPosition, this.carryQuaternion);
      if (motion.detachReady) this.finishPlacement(binding);
      return;
    }

    const pickupMotion =
      taskAction?.active && taskAction.verb === 'grasp'
        ? resolveRobotCarryMotion(taskAction.phase, 'pickup')
        : heldCarryMotion();
    this.carryMotion = pickupMotion;
    this.carryPosition.lerpVectors(
      this.pickupStartPosition,
      this.desiredCarryPosition,
      pickupMotion.lift,
    );
    this.carryQuaternion.slerpQuaternions(
      binding.pickupRotation,
      this.desiredCarryQuaternion,
      pickupMotion.lift,
    );
    this.moveAnchorFor(binding, this.carryPosition, this.carryQuaternion);
  }

  afterPhysics(camera: THREE.Camera, robotPosition: THREE.Vector3, robotYaw: number): void {
    if (this.status !== 'ready') return;
    this.updatePresentation();
    this.enforceContainment();
    this.updateTarget(camera, robotPosition, robotYaw);
  }

  interact(
    camera: THREE.Camera,
    robotPosition: THREE.Vector3,
    robotYaw: number,
    robotId: RobotId,
  ): boolean {
    if (this.status !== 'ready') return false;
    if (this.pendingPickupId || this.pendingPlacementId) return false;
    if (this.heldId) return this.beginPlaceHeld(robotPosition, robotYaw);
    if (!this.targetId) this.updateTarget(camera, robotPosition, robotYaw);
    const binding = this.targetId ? this.bindings.get(this.targetId) : undefined;
    if (!binding || !this.anchorBody) return false;
    const position = binding.body.translation();
    if (robotPosition.distanceTo(new THREE.Vector3(position.x, position.y, position.z)) > 3.25) {
      return false;
    }

    this.activeCarryPose = resolveRobotCarryPose(robotId, binding.definition.id);
    this.carryMotion = resolveRobotCarryMotion(0, 'pickup');
    this.pendingPickupId = binding.definition.id;
    return true;
  }

  cancelPendingPickup(): void {
    this.pendingPickupId = null;
    this.pendingPlacementId = null;
    this.carryMotion = this.heldId ? heldCarryMotion() : null;
  }

  throwHeld(camera: THREE.Camera, robotPosition: THREE.Vector3): boolean {
    const binding = this.heldId ? this.bindings.get(this.heldId) : undefined;
    if (!binding) return false;
    this.releaseJoint(binding);
    camera.getWorldDirection(this.cameraDirection).normalize();
    const horizontalDistance = Math.hypot(this.cameraDirection.x, this.cameraDirection.z);
    if (horizontalDistance < 0.15) {
      this.cameraDirection.set(0, 0.18, -1).normalize();
    } else {
      this.cameraDirection.y = Math.max(0.16, this.cameraDirection.y);
      this.cameraDirection.normalize();
    }
    const speed = binding.definition.throwSpeed;
    binding.body.setLinvel(
      {
        x: this.cameraDirection.x * speed,
        y: this.cameraDirection.y * speed + 1.4,
        z: this.cameraDirection.z * speed,
      },
      true,
    );
    const side = Math.sign(robotPosition.x + robotPosition.z) || 1;
    binding.body.setAngvel({ x: 2.4, y: 4.2 * side, z: -1.8 }, true);
    binding.state = 'thrown';
    this.heldId = null;
    this.pendingPickupId = null;
    this.pendingPlacementId = null;
    this.targetId = null;
    this.activeCarryPose = null;
    this.carryMotion = null;
    this.lastAction = 'thrown';
    return true;
  }

  releaseForRobotSwitch(): void {
    const binding = this.heldId ? this.bindings.get(this.heldId) : undefined;
    if (!binding) return;
    this.releaseJoint(binding);
    binding.state = 'free';
    this.heldId = null;
    this.pendingPickupId = null;
    this.pendingPlacementId = null;
    this.targetId = null;
    this.activeCarryPose = null;
    this.carryMotion = null;
  }

  reset(): void {
    if (this.status !== 'ready') return;
    this.heldId = null;
    this.targetId = null;
    this.pendingPickupId = null;
    this.pendingPlacementId = null;
    this.activeCarryPose = null;
    this.carryMotion = null;
    this.attachmentErrorMeters = null;
    this.orientationErrorDegrees = null;
    for (const binding of this.bindings.values()) this.resetBinding(binding);
    this.corrections = 0;
    this.lastAction = 'reset';
    this.highlight.visible = false;
  }

  get snapshot(): OutdoorFreeplaySnapshot {
    const target = this.targetId ? this.bindings.get(this.targetId) : undefined;
    const held = this.heldId ? this.bindings.get(this.heldId) : undefined;
    return {
      status: this.status,
      targetId: target?.definition.id ?? null,
      targetLabel: target?.definition.label ?? null,
      heldId: held?.definition.id ?? null,
      heldLabel: held?.definition.label ?? null,
      carry: this.carryVisualState,
      attachmentErrorMeters: this.attachmentErrorMeters,
      orientationErrorDegrees: this.orientationErrorDegrees,
      lastAction: this.lastAction,
      corrections: this.corrections,
      objects: [...this.bindings.values()].map((binding) => {
        const position = binding.body.translation();
        const velocity = binding.body.linvel();
        return {
          id: binding.definition.id,
          label: binding.definition.label,
          state: binding.state,
          position: { x: position.x, y: position.y, z: position.z },
          velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
        };
      }),
    };
  }

  get carryVisualState(): RobotCarryVisualState | null {
    const pose = this.activeCarryPose;
    const motion = this.carryMotion;
    if (!pose || !motion || (!this.pendingPickupId && !this.heldId && !this.pendingPlacementId)) {
      return null;
    }
    return {
      active: true,
      robotId: pose.robotId,
      objectId: pose.objectId,
      mode: pose.mode,
      socketName: pose.socketName,
      stage: motion.stage,
      progress: motion.progress,
      reach: motion.reach,
      gripClosure: motion.gripClosure,
      lift: motion.lift,
      gripSpanMeters: pose.gripSpanMeters,
      loadScale: pose.loadScale,
    };
  }

  getHeldWorldPosition(target: THREE.Vector3): THREE.Vector3 | null {
    const binding = this.heldId ? this.bindings.get(this.heldId) : undefined;
    if (!binding) return null;
    const position = binding.body.translation();
    return target.set(position.x, position.y, position.z);
  }

  stageObjectForTest(
    objectId: CarryableObjectId,
    robotPosition: THREE.Vector3,
    robotYaw: number,
  ): boolean {
    if (this.status !== 'ready') return false;
    const binding = this.bindings.get(objectId);
    if (!binding) return false;
    this.heldId = null;
    this.pendingPickupId = null;
    this.pendingPlacementId = null;
    this.activeCarryPose = null;
    this.carryMotion = null;
    for (const candidate of this.bindings.values()) this.resetBinding(candidate);
    this.robotForward.set(-Math.sin(robotYaw), 0, -Math.cos(robotYaw));
    const target = robotPosition.clone().addScaledVector(this.robotForward, 1.45);
    const surface = this.physics.sampleStaticSurface(
      new THREE.Vector3(target.x, robotPosition.y + 5, target.z),
      DOWN,
      12,
    );
    const y = (surface?.point.y ?? robotPosition.y) + binding.halfHeight + 0.04;
    binding.body.setTranslation({ x: target.x, y, z: target.z }, true);
    binding.body.setRotation(IDENTITY_ROTATION, true);
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setGravityScale(0, true);
    binding.body.setAdditionalSolverIterations(12);
    binding.body.wakeUp();
    binding.state = 'free';
    this.targetId = objectId;
    this.lastAction = 'reset';
    this.updatePresentation();
    return true;
  }

  unload(): void {
    this.revision += 1;
    this.unloadBindings();
    this.status = 'inactive';
    this.lastAction = 'none';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unload();
    this.root.removeFromParent();
    this.highlight.removeFromParent();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
  }

  private createBinding(
    definition: OutdoorFreeplayObjectDefinition,
    imported: THREE.Object3D,
    spawnSurface: THREE.Vector3,
  ): ObjectBinding {
    imported.updateMatrixWorld(true);
    const importedBounds = new THREE.Box3().setFromObject(imported, true);
    if (importedBounds.isEmpty()) {
      disposeObject3D(imported);
      throw new Error(`Outdoor freeplay prop "${definition.label}" has empty bounds`);
    }
    const sourceSize = importedBounds.getSize(new THREE.Vector3());
    const sourceCenter = importedBounds.getCenter(new THREE.Vector3());
    const colliderSize = getColliderSize(definition.collider);
    const uniformScale =
      Math.min(
        colliderSize.x / Math.max(0.001, sourceSize.x),
        colliderSize.y / Math.max(0.001, sourceSize.y),
        colliderSize.z / Math.max(0.001, sourceSize.z),
      ) * 0.92;
    imported.position.sub(sourceCenter);
    const model = new THREE.Group();
    model.name = `outdoor-freeplay-model:${definition.id}`;
    model.scale.setScalar(uniformScale);
    model.add(imported);
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    const root = new THREE.Group();
    root.name = `outdoor-freeplay-object:${definition.id}`;
    root.userData.outdoorFreeplayObjectId = definition.id;
    root.userData.productionAsset = true;
    root.add(model);

    const halfHeight = colliderSize.y * 0.5;
    const resetPosition = this.resolveResetPosition(definition, spawnSurface, halfHeight);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(resetPosition.x, resetPosition.y, resetPosition.z)
        .setLinearDamping(0.28)
        .setAngularDamping(0.36)
        .setCcdEnabled(true),
    );
    const collider = this.physics.world.createCollider(
      createColliderDescriptor(definition)
        .setMass(definition.mass)
        .setFriction(definition.friction)
        .setRestitution(definition.restitution)
        .setCollisionGroups(interactionGroups(FREEPLAY_OBJECT_COLLISION_GROUP)),
      body,
    );
    return {
      definition,
      root,
      body,
      collider,
      halfHeight,
      selectionRadius: colliderSize.length() * 0.55,
      resetPosition,
      state: 'free',
      joint: null,
      pickupRotation: new THREE.Quaternion(),
    };
  }

  private resolveResetPosition(
    definition: OutdoorFreeplayObjectDefinition,
    spawnSurface: THREE.Vector3,
    halfHeight: number,
  ): THREE.Vector3 {
    const x = spawnSurface.x + definition.resetOffset[0];
    const z = spawnSurface.z + definition.resetOffset[1];
    const origin = new THREE.Vector3(x, spawnSurface.y + 6, z);
    const surface = this.physics.sampleStaticSurface(origin, DOWN, 12);
    return new THREE.Vector3(x, (surface?.point.y ?? spawnSurface.y) + halfHeight + 0.04, z);
  }

  private beginPlaceHeld(robotPosition: THREE.Vector3, robotYaw: number): boolean {
    const binding = this.heldId ? this.bindings.get(this.heldId) : undefined;
    if (!binding) return false;
    this.robotForward.set(-Math.sin(robotYaw), 0, -Math.cos(robotYaw));
    const target = robotPosition.clone().addScaledVector(this.robotForward, 1.55);
    const surface = this.physics.sampleStaticSurface(
      new THREE.Vector3(target.x, robotPosition.y + 4, target.z),
      DOWN,
      10,
    );
    if (!surface || surface.normal.y < 0.52) return false;
    this.placementPosition.set(
      surface.point.x,
      surface.point.y + binding.halfHeight + 0.045,
      surface.point.z,
    );
    this.placementQuaternion.identity();
    this.pendingPlacementId = binding.definition.id;
    this.carryMotion = resolveRobotCarryMotion(0, 'release');
    return true;
  }

  private finishPlacement(binding: ObjectBinding): void {
    this.releaseJoint(binding);
    binding.body.setTranslation(this.placementPosition, true);
    binding.body.setRotation(this.placementQuaternion, true);
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    binding.state = 'placed';
    this.heldId = null;
    this.pendingPlacementId = null;
    this.targetId = binding.definition.id;
    this.activeCarryPose = null;
    this.carryMotion = null;
    this.attachmentErrorMeters = null;
    this.orientationErrorDegrees = null;
    this.lastAction = 'placed';
  }

  private attachAtCurrentPose(binding: ObjectBinding): boolean {
    if (!this.anchorBody) return false;
    const position = binding.body.translation();
    this.anchorBody.setTranslation(position, true);
    this.anchorBody.setNextKinematicTranslation(position);
    this.anchorBody.setRotation(IDENTITY_ROTATION, true);
    this.anchorBody.setNextKinematicRotation(IDENTITY_ROTATION);
    const rotation = binding.body.rotation();
    const inverseRotation = new THREE.Quaternion(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    ).invert();
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    binding.collider.setCollisionGroups(
      interactionGroups(
        FREEPLAY_OBJECT_COLLISION_GROUP,
        ALL_COLLISION_GROUPS & ~ROBOT_COLLISION_GROUP,
      ),
    );
    binding.joint = this.physics.world.createImpulseJoint(
      RAPIER.JointData.fixed(
        { x: 0, y: 0, z: 0 },
        IDENTITY_ROTATION,
        { x: 0, y: 0, z: 0 },
        {
          x: inverseRotation.x,
          y: inverseRotation.y,
          z: inverseRotation.z,
          w: inverseRotation.w,
        },
      ),
      this.anchorBody,
      binding.body,
      true,
    );
    binding.state = 'held';
    this.heldId = binding.definition.id;
    this.targetId = binding.definition.id;
    this.lastAction = 'picked-up';
    return true;
  }

  private resolveCarryTransform(carrySocket: THREE.Object3D, pose: RobotCarryPose | null): void {
    if (!pose) return;
    carrySocket.updateWorldMatrix(true, false);
    carrySocket.getWorldPosition(this.desiredCarryPosition);
    carrySocket.getWorldQuaternion(this.desiredCarryQuaternion);
    this.carryOffset.set(...pose.localOffset).applyQuaternion(this.desiredCarryQuaternion);
    this.desiredCarryPosition.add(this.carryOffset);
    this.localCarryQuaternion.setFromEuler(new THREE.Euler(...pose.localEuler));
    this.desiredCarryQuaternion.multiply(this.localCarryQuaternion).normalize();
  }

  private moveAnchorFor(
    binding: ObjectBinding,
    targetPosition: THREE.Vector3,
    targetQuaternion: THREE.Quaternion,
  ): void {
    if (!this.anchorBody) return;
    this.anchorBody.setNextKinematicTranslation(targetPosition);
    this.rotationDelta
      .copy(targetQuaternion)
      .multiply(this.anchorQuaternion.copy(binding.pickupRotation).invert())
      .normalize();
    this.anchorBody.setNextKinematicRotation(this.rotationDelta);
    const position = binding.body.translation();
    const rotation = binding.body.rotation();
    this.attachmentErrorMeters = targetPosition.distanceTo(
      this.carryOffset.set(position.x, position.y, position.z),
    );
    this.carryQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.orientationErrorDegrees = THREE.MathUtils.radToDeg(
      this.carryQuaternion.angleTo(targetQuaternion),
    );
  }

  private updateTarget(camera: THREE.Camera, robotPosition: THREE.Vector3, robotYaw: number): void {
    if (this.heldId) {
      this.targetId = this.heldId;
      this.updateHighlight();
      return;
    }
    camera.getWorldDirection(this.cameraDirection).normalize();
    let bestId: CarryableObjectId | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const binding of this.bindings.values()) {
      const position = binding.body.translation();
      const center = new THREE.Vector3(position.x, position.y, position.z);
      const robotDistance = center.distanceTo(robotPosition);
      if (robotDistance > 4) continue;
      const toObject = center.sub(camera.position);
      const projection = toObject.dot(this.cameraDirection);
      if (projection <= 0 || projection > 16) continue;
      const perpendicular = toObject.addScaledVector(this.cameraDirection, -projection).length();
      const score = perpendicular / Math.max(0.35, binding.selectionRadius) + projection * 0.018;
      if (perpendicular <= Math.max(0.48, binding.selectionRadius) && score < bestScore) {
        bestScore = score;
        bestId = binding.definition.id;
      }
    }
    if (!bestId) {
      this.robotForward.set(-Math.sin(robotYaw), 0, -Math.cos(robotYaw));
      for (const binding of this.bindings.values()) {
        const position = binding.body.translation();
        const offset = new THREE.Vector3(
          position.x - robotPosition.x,
          0,
          position.z - robotPosition.z,
        );
        const distance = offset.length();
        if (distance > 2.2 || distance < 1e-4) continue;
        const facing = offset.normalize().dot(this.robotForward);
        const score = distance + (1 - facing) * 1.5;
        if (facing > 0.15 && score < bestScore) {
          bestScore = score;
          bestId = binding.definition.id;
        }
      }
    }
    this.targetId = bestId;
    this.updateHighlight();
  }

  private updateHighlight(): void {
    if (this.heldId) {
      this.highlight.visible = false;
      return;
    }

    const binding = this.targetId ? this.bindings.get(this.targetId) : undefined;
    if (!binding) {
      this.highlight.visible = false;
      return;
    }
    this.highlightBounds.setFromObject(binding.root, true).expandByScalar(0.06);
    this.highlight.visible = true;
  }

  private updatePresentation(): void {
    for (const binding of this.bindings.values()) {
      const position = binding.body.translation();
      const rotation = binding.body.rotation();
      binding.root.position.set(position.x, position.y, position.z);
      binding.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      if (binding.state === 'thrown' && binding.body.isSleeping()) {
        binding.state = 'free';
      }
    }
    this.updateHighlight();
  }

  private enforceContainment(): void {
    for (const binding of this.bindings.values()) {
      if (binding.state === 'held') continue;
      const position = binding.body.translation();
      const inside =
        position.x >= this.worldBounds.min.x - 1 &&
        position.x <= this.worldBounds.max.x + 1 &&
        position.y >= this.worldBounds.min.y - 4 &&
        position.y <= this.worldBounds.max.y + 4 &&
        position.z >= this.worldBounds.min.z - 1 &&
        position.z <= this.worldBounds.max.z + 1;
      if (inside) continue;
      this.resetBinding(binding);
      this.corrections += 1;
      this.lastAction = 'recovered';
    }
  }

  private resetBinding(binding: ObjectBinding): void {
    this.releaseJoint(binding);
    binding.body.setTranslation(binding.resetPosition, true);
    binding.body.setRotation(IDENTITY_ROTATION, true);
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.wakeUp();
    binding.state = 'free';
    binding.pickupRotation.identity();
  }

  private releaseJoint(binding: ObjectBinding): void {
    if (binding.joint) {
      this.physics.world.removeImpulseJoint(binding.joint, true);
      binding.joint = null;
    }
    binding.body.setGravityScale(1, true);
    binding.body.setAdditionalSolverIterations(0);
    binding.collider.setCollisionGroups(interactionGroups(FREEPLAY_OBJECT_COLLISION_GROUP));
  }

  private unloadBindings(): void {
    this.highlight.visible = false;
    this.targetId = null;
    this.heldId = null;
    this.pendingPickupId = null;
    this.pendingPlacementId = null;
    this.activeCarryPose = null;
    this.carryMotion = null;
    this.attachmentErrorMeters = null;
    this.orientationErrorDegrees = null;
    for (const binding of this.bindings.values()) {
      this.releaseJoint(binding);
      this.physics.world.removeRigidBody(binding.body);
      binding.root.removeFromParent();
      disposeObject3D(binding.root);
    }
    this.bindings.clear();
    if (this.anchorBody) {
      this.physics.world.removeRigidBody(this.anchorBody);
      this.anchorBody = null;
    }
    this.root.clear();
  }
}

function getColliderSize(collider: OutdoorFreeplayObjectDefinition['collider']): THREE.Vector3 {
  if (collider.shape === 'ball') {
    return new THREE.Vector3(collider.radius * 2, collider.radius * 2, collider.radius * 2);
  }
  if (collider.shape === 'cylinder') {
    return new THREE.Vector3(collider.radius * 2, collider.halfHeight * 2, collider.radius * 2);
  }
  return new THREE.Vector3(
    collider.halfExtents[0] * 2,
    collider.halfExtents[1] * 2,
    collider.halfExtents[2] * 2,
  );
}

function createColliderDescriptor(
  definition: OutdoorFreeplayObjectDefinition,
): RAPIER.ColliderDesc {
  const collider = definition.collider;
  if (collider.shape === 'ball') return RAPIER.ColliderDesc.ball(collider.radius);
  if (collider.shape === 'cylinder') {
    return RAPIER.ColliderDesc.cylinder(collider.halfHeight, collider.radius);
  }
  return RAPIER.ColliderDesc.cuboid(...collider.halfExtents);
}
