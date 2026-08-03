import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { MintPropInstance } from '../assets/props';
import type { RoomId } from '../config/catalog';
import {
  KINETIC_HALL_TASK_FIXTURES,
  scaleKineticHallTaskFixture,
  type KineticHallTaskFixtureContract,
  type KineticHallTaskFixtureId,
} from '../tasks/KineticHallPhysicalTaskContract';
import { MINT_WORLD_EXPERIENCE_SCALE } from '../worlds/ForgeMintWorldCatalog';
import { COMMISSIONING_COLLIDERS, createWedgeRampMeshData } from '../worlds/commissioningCourse';
import { extractMintColliderMeshes } from './mintColliderMesh';

export type RobotPhysicsBody = {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  requiresSupport: boolean;
  contactProfile: RobotContactProfile;
  contactSensors: readonly Readonly<{
    name: RobotContactSensorName;
    collider: RAPIER.Collider;
    baseOffset: RobotContactSensorSpec['offset'];
  }>[];
  standingHalfHeight: number;
  halfHeight: number;
  boundaryRadius: number;
  boundaryTopPadding: number;
  minTraversableNormalY: number;
};

export type RobotContactSensorName = 'left-foot' | 'right-foot';
export type RobotContactProfile = 'none' | 'axiom-biped-feet-v1';

export type RobotContactSensorSpec = Readonly<{
  name: RobotContactSensorName;
  offset: readonly [number, number, number];
  radius: number;
}>;

export type RobotControllerTuning = Readonly<{
  maxSlopeDegrees: number;
  maxStepHeight: number;
  minStepWidth: number;
  requiresSupport?: boolean;
  contactProfile?: RobotContactProfile;
  contactSensors?: readonly RobotContactSensorSpec[];
  boundaryRadius?: number;
  boundaryTopPadding?: number;
}>;

export type RobotContactObservation = Readonly<{
  sequence: number;
  profile: RobotContactProfile;
  leftFoot: boolean;
  rightFoot: boolean;
  supportCount: number;
  grounded: boolean;
}>;

export type RobotRaySample = Readonly<{
  direction: Readonly<{ x: number; y: number; z: number }>;
  distanceMeters: number;
  hit: boolean;
}>;

export type WorldSurfaceSample = Readonly<{
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distanceMeters: number;
}>;

export type RobotMotionDiagnostics = Readonly<{
  desired: Readonly<{ x: number; y: number; z: number }>;
  computed: Readonly<{ x: number; y: number; z: number }>;
  grounded: boolean;
  collisions: readonly Readonly<{
    normal: Readonly<{ x: number; y: number; z: number }>;
    witness: Readonly<{ x: number; y: number; z: number }>;
    timeOfImpact: number;
  }>[];
}>;

export type ContainmentViolation =
  | 'none'
  | 'outside-world-bounds'
  | 'attached-object-outside-world-bounds'
  | 'unsupported'
  | 'penetrating-world-collider';

export type RobotContainmentObservation = Readonly<{
  sequence: number;
  active: boolean;
  valid: boolean;
  insideWorldBounds: boolean;
  supported: boolean;
  supportDistanceMeters: number | null;
  penetratingWorldCollider: boolean;
  violationCount: number;
  correctionCount: number;
  lastViolation: ContainmentViolation;
  allowedCenterBounds: Readonly<{
    min: Readonly<{ x: number; y: number; z: number }>;
    max: Readonly<{ x: number; y: number; z: number }>;
  }> | null;
}>;

export type PropContainmentObservation = Readonly<{
  instanceId: string;
  valid: boolean;
  insideWorldBounds: boolean;
  supported: boolean;
  supportSource: 'world-collider' | 'reviewed-floor-plane' | 'not-required' | 'none';
  supportDistanceMeters: number | null;
  bounds: Readonly<{
    min: Readonly<{ x: number; y: number; z: number }>;
    max: Readonly<{ x: number; y: number; z: number }>;
  }>;
}>;

export type WorldContainmentDiagnostics = Readonly<{
  active: boolean;
  robot: RobotContainmentObservation;
  props: Readonly<{
    total: number;
    valid: number;
    invalid: number;
    correctionCount: number;
    entries: readonly PropContainmentObservation[];
  }>;
}>;

type MovingPropBody = {
  instance: MintPropInstance;
  body: RAPIER.RigidBody;
  bodyOrigin: THREE.Vector3;
  rootOrigin: THREE.Vector3;
  lastValidBodyPosition: THREE.Vector3;
  lastValidRootPosition: THREE.Vector3;
};

export type TaskObjectState = 'free' | 'grasped' | 'released';

export type TaskObjectObservation = Readonly<{
  sequence: number;
  instanceId: string;
  state: TaskObjectState;
  ownerRobotId: string | null;
  constraint: 'none' | 'rapier-fixed-impulse-joint-v1';
  position: Readonly<{ x: number; y: number; z: number }>;
  resetPosition: Readonly<{ x: number; y: number; z: number }>;
}>;

type TaskObjectBody = {
  instance: MintPropInstance;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  bodyHalfExtents: THREE.Vector3;
  bodyOrigin: THREE.Vector3;
  rootOrigin: THREE.Vector3;
  rootRotationOrigin: THREE.Quaternion;
  joint: RAPIER.ImpulseJoint | null;
  ownerRobotId: string | null;
  state: TaskObjectState;
  sequence: number;
  lastValidTranslation: THREE.Vector3;
  lastValidRotation: THREE.Quaternion;
};

export type TaskFixtureState = 'ready' | 'actuated';

export type TaskFixtureObservation = Readonly<{
  id: KineticHallTaskFixtureId;
  semanticObjectId: string;
  sourceDecision: KineticHallTaskFixtureContract['sourceDecision'];
  state: TaskFixtureState;
  sequence: number;
  ownerRobotId: string | null;
  sensorOverlap: boolean;
  horizontalDistanceMeters: number;
  yawErrorDegrees: number;
  contactPoint: Readonly<{ x: number; y: number; z: number }>;
  approachSurfacePosition: Readonly<{ x: number; y: number; z: number }>;
}>;

type TaskFixtureBody = {
  contract: KineticHallTaskFixtureContract;
  sensor: RAPIER.Collider;
  state: TaskFixtureState;
  sequence: number;
  ownerRobotId: string | null;
};

const ROBOT_COLLISION_GROUP = 1 << 1;
const TASK_OBJECT_COLLISION_GROUP = 1 << 2;
const TASK_FIXTURE_SENSOR_GROUP = 1 << 3;
const ALL_COLLISION_GROUPS = 0xffff;
const ROBOT_COLLIDER_CLEARANCE_METERS = 0.026;
const ROBOT_SUPPORT_PROBE_LIFT_METERS = 0.08;
const ROBOT_MAX_SUPPORT_DISTANCE_METERS = 0.3;
const PROP_MAX_SUPPORT_DISTANCE_METERS = 0.35;
const PROP_FLOOR_PLACEMENT_TOLERANCE_METERS = 0.03;
const CONTAINMENT_EPSILON_METERS = 0.005;
const interactionGroups = (membership: number, filter = ALL_COLLISION_GROUPS): number =>
  ((membership & ALL_COLLISION_GROUPS) << 16) | (filter & ALL_COLLISION_GROUPS);

function clampToUsableAxis(value: number, minimum: number, maximum: number): number {
  return minimum <= maximum
    ? THREE.MathUtils.clamp(value, minimum, maximum)
    : (minimum + maximum) * 0.5;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  private readonly staticColliderHandles: number[] = [];
  private readonly containmentGuardColliderHandles: number[] = [];
  private readonly propColliderHandles: number[] = [];
  private readonly propSupportColliderHandles: number[] = [];
  private readonly movingPropBodies: MovingPropBody[] = [];
  private readonly taskObjectBodies = new Map<string, TaskObjectBody>();
  private readonly taskFixtureBodies = new Map<KineticHallTaskFixtureId, TaskFixtureBody>();
  private robot: RobotPhysicsBody | null = null;
  private robotMovementBounds: THREE.Box3 | null = null;
  private readonly boundedRobotPosition = new THREE.Vector3();
  private readonly lastValidRobotPosition = new THREE.Vector3();
  private propContainment = new Map<string, PropContainmentObservation>();
  private propContainmentCorrectionCount = 0;
  private dynamicGateBody: RAPIER.RigidBody | null = null;
  private dynamicTime = 0;
  private dynamicPropTime = 0;
  private robotMotion: RobotMotionDiagnostics = {
    desired: { x: 0, y: 0, z: 0 },
    computed: { x: 0, y: 0, z: 0 },
    grounded: false,
    collisions: [],
  };
  private robotContacts: RobotContactObservation = {
    sequence: 0,
    profile: 'none',
    leftFoot: false,
    rightFoot: false,
    supportCount: 0,
    grounded: false,
  };
  private robotContainment: RobotContainmentObservation = {
    sequence: 0,
    active: false,
    valid: true,
    insideWorldBounds: true,
    supported: true,
    supportDistanceMeters: null,
    penetratingWorldCollider: false,
    violationCount: 0,
    correctionCount: 0,
    lastViolation: 'none',
    allowedCenterBounds: null,
  };

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  buildCommissioningCourse(roomId: RoomId): void {
    this.robotMovementBounds = null;
    this.robotContainment = this.createInactiveRobotContainmentObservation();
    this.removeStaticHandles(this.containmentGuardColliderHandles.splice(0));
    this.clearStatic();
    this.clearDynamic();
    this.clearKineticProps();
    this.dynamicTime = 0;
    this.createFixedCuboid(new THREE.Vector3(0, -0.25, 0), new THREE.Vector3(36, 0.5, 24));
    this.createFixedCuboid(new THREE.Vector3(-18.2, 1, 0), new THREE.Vector3(0.4, 2.5, 24));
    this.createFixedCuboid(new THREE.Vector3(18.2, 1, 0), new THREE.Vector3(0.4, 2.5, 24));
    this.createFixedCuboid(new THREE.Vector3(0, 1, -12.2), new THREE.Vector3(36, 2.5, 0.4));
    this.createFixedCuboid(new THREE.Vector3(0, 1, 12.2), new THREE.Vector3(36, 2.5, 0.4));
    for (const collider of COMMISSIONING_COLLIDERS[roomId]) {
      const position = new THREE.Vector3(...collider.position);
      const size = new THREE.Vector3(...collider.size);
      const rotation = new THREE.Euler(...(collider.rotation ?? [0, 0, 0]));
      if (collider.dynamic === 'vertical-gate') {
        this.createVerticalGate(position, size);
      } else if (collider.shape === 'wedge-ramp') {
        this.createFixedWedgeRamp(position, size);
      } else {
        this.createFixedCuboid(position, size, rotation);
      }
    }
  }

  buildMintCollider(colliderRoot: THREE.Object3D): {
    meshes: number;
    triangles: number;
  } {
    this.clearKineticProps();
    const meshData = extractMintColliderMeshes(colliderRoot);
    if (meshData.length === 0) {
      throw new Error('Mint World collider contains no usable triangle meshes');
    }

    let triangles = 0;
    const replacementHandles: number[] = [];
    try {
      for (const mesh of meshData) {
        const collider = this.world.createCollider(
          RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices).setFriction(0.9),
        );
        replacementHandles.push(collider.handle);
        triangles += mesh.triangles;
      }
    } catch (error) {
      this.removeStaticHandles(replacementHandles);
      throw error;
    }

    const previousHandles = this.staticColliderHandles.splice(0);
    this.removeStaticHandles(previousHandles);
    this.staticColliderHandles.push(...replacementHandles);
    this.clearDynamic();
    this.dynamicTime = 0;
    // Rapier refreshes its broad-phase scene queries during a World step.
    // No dynamic environment bodies remain here, so one fixed initialization
    // step makes support/placement queries authoritative before episode launch.
    this.world.timestep = 1 / 60;
    this.world.step(this.eventQueue);
    return { meshes: meshData.length, triangles };
  }

  buildPropColliders(instances: readonly MintPropInstance[]): {
    colliders: number;
    movingBodies: number;
  } {
    this.clearKineticProps();
    this.dynamicPropTime = 0;
    const containment = instances.map((instance) => this.evaluatePropContainment(instance));
    this.propContainment = new Map(
      containment.map((observation) => [observation.instanceId, observation]),
    );
    const invalidContainment = containment.filter((observation) => !observation.valid);
    if (invalidContainment.length > 0) {
      throw new Error(
        `Mint prop containment failed:\n${invalidContainment
          .map(
            (observation) =>
              `- ${observation.instanceId}: inside=${observation.insideWorldBounds}, ` +
              `supported=${observation.supported}, ` +
              `supportSource=${observation.supportSource}, ` +
              `supportDistance=${observation.supportDistanceMeters ?? 'none'}, ` +
              `bounds=${JSON.stringify(observation.bounds)}`,
          )
          .join('\n')}`,
      );
    }
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();

    try {
      for (const instance of instances) {
        if (instance.asset.id === 'powered-sliding-obstacle-sled') {
          instance.root.updateWorldMatrix(true, true);
          box.setFromObject(instance.root, true);
          if (box.isEmpty()) {
            throw new Error(`Mint prop "${instance.placement.instanceId}" has empty bounds`);
          }
          box.getSize(size);
          box.getCenter(center);
          if (
            ![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite) ||
            Math.min(size.x, size.y, size.z) <= 0.01
          ) {
            throw new Error(`Mint prop "${instance.placement.instanceId}" has invalid bounds`);
          }
          const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
              center.x,
              center.y,
              center.z,
            ),
          );
          this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(
              Math.max(0.025, size.x * 0.5),
              Math.max(0.025, size.y * 0.5),
              Math.max(0.025, size.z * 0.5),
            ).setFriction(0.86),
            body,
          );
          this.movingPropBodies.push({
            instance,
            body,
            bodyOrigin: center.clone(),
            rootOrigin: instance.root.position.clone(),
            lastValidBodyPosition: center.clone(),
            lastValidRootPosition: instance.root.position.clone(),
          });
        } else if (instance.asset.id === 'rugged-instrument-case') {
          instance.root.updateWorldMatrix(true, true);
          box.setFromObject(instance.root, true);
          if (box.isEmpty()) {
            throw new Error(`Mint prop "${instance.placement.instanceId}" has empty bounds`);
          }
          box.getSize(size);
          box.getCenter(center);
          if (
            ![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite) ||
            Math.min(size.x, size.y, size.z) <= 0.01
          ) {
            throw new Error(`Mint prop "${instance.placement.instanceId}" has invalid bounds`);
          }
          if (
            this.propContainment.get(instance.placement.instanceId)?.supportSource ===
            'reviewed-floor-plane'
          ) {
            this.createPropFloorSupport(box);
          }
          const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
              .setTranslation(center.x, center.y, center.z)
              .setLinearDamping(0.45)
              .setAngularDamping(0.8)
              .setCcdEnabled(true),
          );
          const collider = this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(
              Math.max(0.025, size.x * 0.5),
              Math.max(0.025, size.y * 0.5),
              Math.max(0.025, size.z * 0.5),
            )
              .setDensity(38)
              .setFriction(0.92)
              .setRestitution(0.02)
              .setCollisionGroups(interactionGroups(TASK_OBJECT_COLLISION_GROUP)),
            body,
          );
          body.sleep();
          this.taskObjectBodies.set(instance.placement.instanceId, {
            instance,
            body,
            collider,
            bodyHalfExtents: size.clone().multiplyScalar(0.5),
            bodyOrigin: center.clone(),
            rootOrigin: instance.root.position.clone(),
            rootRotationOrigin: instance.root.quaternion.clone(),
            joint: null,
            ownerRobotId: null,
            state: 'free',
            sequence: 0,
            lastValidTranslation: center.clone(),
            lastValidRotation: new THREE.Quaternion(),
          });
        } else {
          const meshData = extractMintColliderMeshes(instance.root);
          if (meshData.length === 0) {
            throw new Error(`Mint prop "${instance.placement.instanceId}" has no triangle mesh`);
          }
          for (const mesh of meshData) {
            const collider = this.world.createCollider(
              RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices).setFriction(0.86),
            );
            this.propColliderHandles.push(collider.handle);
          }
        }
      }
    } catch (error) {
      this.clearKineticProps();
      throw error;
    }

    return {
      colliders:
        this.propColliderHandles.length + this.movingPropBodies.length + this.taskObjectBodies.size,
      movingBodies: this.movingPropBodies.length + this.taskObjectBodies.size,
    };
  }

  buildKineticPropColliders(instances: readonly MintPropInstance[]): {
    colliders: number;
    movingBodies: number;
  } {
    return this.buildPropColliders(instances);
  }

  resetProps(): void {
    this.dynamicPropTime = 0;
    for (const binding of this.movingPropBodies) {
      binding.instance.reset();
      binding.body.setTranslation(binding.bodyOrigin, true);
      binding.body.setNextKinematicTranslation(binding.bodyOrigin);
      binding.instance.root.position.copy(binding.rootOrigin);
      binding.lastValidBodyPosition.copy(binding.bodyOrigin);
      binding.lastValidRootPosition.copy(binding.rootOrigin);
    }
    for (const binding of this.taskObjectBodies.values()) {
      this.removeTaskObjectJoint(binding);
      binding.instance.reset();
      binding.body.setTranslation(binding.bodyOrigin, true);
      binding.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      binding.instance.root.position.copy(binding.rootOrigin);
      binding.instance.root.quaternion.copy(binding.rootRotationOrigin);
      binding.ownerRobotId = null;
      binding.state = 'free';
      binding.sequence = 0;
      binding.lastValidTranslation.copy(binding.bodyOrigin);
      binding.lastValidRotation.identity();
      binding.body.sleep();
    }
    for (const binding of this.taskFixtureBodies.values()) {
      binding.state = 'ready';
      binding.sequence = 0;
      binding.ownerRobotId = null;
    }
    this.refreshMovingPropContainment();
  }

  resetKineticProps(): void {
    this.resetProps();
  }

  clearProps(): void {
    this.clearTaskFixtures();
    this.removeStaticHandles(this.propColliderHandles.splice(0));
    this.removeStaticHandles(this.propSupportColliderHandles.splice(0));
    for (const binding of this.movingPropBodies.splice(0)) {
      this.world.removeRigidBody(binding.body);
    }
    for (const binding of this.taskObjectBodies.values()) {
      this.removeTaskObjectJoint(binding);
      this.world.removeRigidBody(binding.body);
    }
    this.taskObjectBodies.clear();
    this.dynamicPropTime = 0;
    this.propContainment.clear();
    this.propContainmentCorrectionCount = 0;
  }

  clearKineticProps(): void {
    this.clearProps();
  }

  clearEnvironment(): void {
    this.robotMovementBounds = null;
    this.robotContainment = this.createInactiveRobotContainmentObservation();
    this.removeStaticHandles(this.containmentGuardColliderHandles.splice(0));
    this.clearKineticProps();
    this.clearStatic();
    this.clearDynamic();
    this.dynamicTime = 0;
  }

  createRobotBody(
    radius: number,
    height: number,
    position: THREE.Vector3,
    tuning: RobotControllerTuning = {
      maxSlopeDegrees: 50,
      maxStepHeight: 0.38,
      minStepWidth: 0.22,
    },
  ): RobotPhysicsBody {
    this.removeRobotBody();
    const halfHeight = Math.max(0.05, height * 0.5 - radius);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        position.x,
        position.y,
        position.z,
      ),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setFriction(0.8)
        .setCollisionGroups(interactionGroups(ROBOT_COLLISION_GROUP))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const contactSensors = (tuning.contactSensors ?? []).map((sensor) => ({
      name: sensor.name,
      collider: this.world.createCollider(
        RAPIER.ColliderDesc.ball(sensor.radius)
          .setTranslation(...sensor.offset)
          .setSensor(true)
          .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      ),
      baseOffset: sensor.offset,
    }));
    const controller = this.world.createCharacterController(0.025);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setSlideEnabled(true);
    controller.enableAutostep(tuning.maxStepHeight, tuning.minStepWidth, false);
    controller.enableSnapToGround(0.25);
    controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(tuning.maxSlopeDegrees));
    controller.setMinSlopeSlideAngle(
      THREE.MathUtils.degToRad(Math.min(89, tuning.maxSlopeDegrees + 5)),
    );
    this.robot = {
      body,
      collider,
      controller,
      requiresSupport: tuning.requiresSupport ?? true,
      contactProfile: tuning.contactProfile ?? 'none',
      contactSensors,
      standingHalfHeight: halfHeight,
      halfHeight,
      boundaryRadius: Math.max(radius, tuning.boundaryRadius ?? radius),
      boundaryTopPadding: Math.max(0, tuning.boundaryTopPadding ?? 0),
      minTraversableNormalY: Math.cos(THREE.MathUtils.degToRad(tuning.maxSlopeDegrees)),
    };
    this.boundedRobotPosition.copy(position);
    this.commitRobotPosition(this.constrainRobotPosition(this.boundedRobotPosition));
    this.lastValidRobotPosition.copy(this.boundedRobotPosition);
    this.robotContainment = this.createInactiveRobotContainmentObservation();
    this.robotContacts = {
      sequence: 0,
      profile: this.robot.contactProfile,
      leftFoot: false,
      rightFoot: false,
      supportCount: 0,
      grounded: false,
    };
    return this.robot;
  }

  setRobotHeight(heightMeters: number): void {
    if (!this.robot || !Number.isFinite(heightMeters) || heightMeters <= 0) {
      throw new Error('Robot height must be a positive finite value');
    }
    const radius = this.robot.collider.radius();
    const nextHalfHeight = Math.max(0.05, heightMeters * 0.5 - radius);
    const previousHalfHeight = this.robot.halfHeight;
    const delta = previousHalfHeight - nextHalfHeight;
    if (Math.abs(delta) < 1e-6) return;

    const current = this.robot.body.translation();
    this.robot.collider.setHalfHeight(nextHalfHeight);
    for (const sensor of this.robot.contactSensors) {
      sensor.collider.setTranslationWrtParent({
        x: sensor.baseOffset[0],
        y: sensor.baseOffset[1] + (this.robot.standingHalfHeight - nextHalfHeight),
        z: sensor.baseOffset[2],
      });
    }
    this.robot.halfHeight = nextHalfHeight;
    this.boundedRobotPosition.set(current.x, current.y - delta, current.z);
    const candidate = this.constrainRobotPosition(this.boundedRobotPosition);
    let observation = this.evaluateRobotContainment(candidate);
    if (
      nextHalfHeight < previousHalfHeight &&
      observation.lastViolation === 'penetrating-world-collider'
    ) {
      // With the capsule bottom held fixed, a shorter capsule is a strict
      // subset of the previously accepted shape. Rapier's standalone
      // trimesh-intersection query can conservatively report a contact here
      // until the collider shape reaches the next broad-phase update.
      observation = {
        ...observation,
        valid: observation.insideWorldBounds && observation.supported,
        penetratingWorldCollider: false,
        lastViolation:
          observation.insideWorldBounds && observation.supported
            ? 'none'
            : observation.lastViolation,
      };
    }
    if (observation.active && !observation.valid) {
      this.robot.collider.setHalfHeight(previousHalfHeight);
      for (const sensor of this.robot.contactSensors) {
        sensor.collider.setTranslationWrtParent({
          x: sensor.baseOffset[0],
          y: sensor.baseOffset[1] + (this.robot.standingHalfHeight - previousHalfHeight),
          z: sensor.baseOffset[2],
        });
      }
      this.robot.halfHeight = previousHalfHeight;
      this.recordRobotContainment(observation, false);
      throw new Error(
        `Robot posture violates World containment: ${observation.lastViolation}; ` +
          `position=${JSON.stringify(candidate.toArray())}; ` +
          `supportDistance=${observation.supportDistanceMeters ?? 'none'}`,
      );
    }
    this.commitRobotPosition(candidate);
    this.lastValidRobotPosition.copy(candidate);
    this.recordRobotContainment(observation, false);
  }

  setRobotMovementBounds(bounds: THREE.Box3 | null): void {
    if (bounds === null) {
      this.robotMovementBounds = null;
      this.removeStaticHandles(this.containmentGuardColliderHandles.splice(0));
      this.robotContainment = this.createInactiveRobotContainmentObservation();
      return;
    }
    const components = [...bounds.min.toArray(), ...bounds.max.toArray()];
    if (bounds.isEmpty() || !components.every(Number.isFinite)) {
      throw new Error('Robot movement bounds must be finite and non-empty');
    }
    this.robotMovementBounds = bounds.clone();
    this.rebuildContainmentGuards();
    if (!this.robot) return;
    const current = this.robot.body.translation();
    this.boundedRobotPosition.set(current.x, current.y, current.z);
    const candidate = this.constrainRobotPosition(this.boundedRobotPosition);
    this.commitRobotPosition(candidate);
    const observation = this.evaluateRobotContainment(candidate);
    if (observation.valid) this.lastValidRobotPosition.copy(candidate);
    this.recordRobotContainment(observation, false, false);
  }

  moveRobot(desiredDelta: THREE.Vector3): {
    movement: THREE.Vector3;
    collisions: number;
    grounded: boolean;
  } {
    if (!this.robot) throw new Error('Robot physics body has not been created');
    this.robot.controller.computeColliderMovement(
      this.robot.collider,
      {
        x: desiredDelta.x,
        y: desiredDelta.y,
        z: desiredDelta.z,
      },
      undefined,
      this.robot.collider.collisionGroups(),
      (candidate) => {
        if (
          this.robot?.contactSensors.some((sensor) => sensor.collider.handle === candidate.handle)
        ) {
          return false;
        }
        for (const fixture of this.taskFixtureBodies.values()) {
          if (fixture.sensor.handle === candidate.handle) return false;
        }
        for (const binding of this.taskObjectBodies.values()) {
          if (binding.joint && binding.collider.handle === candidate.handle) return false;
        }
        return true;
      },
    );
    const computedMovement = this.robot.controller.computedMovement();
    const current = this.robot.body.translation();
    this.boundedRobotPosition.set(
      current.x + computedMovement.x,
      current.y + computedMovement.y,
      current.z + computedMovement.z,
    );
    let boundedPosition = this.constrainRobotPosition(this.boundedRobotPosition);
    let containment = this.evaluateRobotContainment(boundedPosition);
    const proposedMovement = new THREE.Vector3(
      boundedPosition.x - current.x,
      boundedPosition.y - current.y,
      boundedPosition.z - current.z,
    );
    if (
      containment.active &&
      containment.valid &&
      !this.attachedTaskObjectsStayContained(proposedMovement)
    ) {
      containment = {
        ...containment,
        valid: false,
        insideWorldBounds: false,
        lastViolation: 'attached-object-outside-world-bounds',
      };
    }
    let correctedByContainment = false;
    if (containment.active && !containment.valid) {
      correctedByContainment = true;
      boundedPosition = this.lastValidRobotPosition;
    } else {
      this.lastValidRobotPosition.copy(boundedPosition);
    }
    const movement = new THREE.Vector3(
      boundedPosition.x - current.x,
      boundedPosition.y - current.y,
      boundedPosition.z - current.z,
    );
    this.robot.body.setNextKinematicTranslation(boundedPosition);
    let impactCollisions = 0;
    const collisions: {
      normal: { x: number; y: number; z: number };
      witness: { x: number; y: number; z: number };
      timeOfImpact: number;
    }[] = [];
    for (let index = 0; index < this.robot.controller.numComputedCollisions(); index += 1) {
      const collision = this.robot.controller.computedCollision(index);
      if (!collision) continue;
      collisions.push({
        normal: {
          x: collision.normal1.x,
          y: collision.normal1.y,
          z: collision.normal1.z,
        },
        witness: {
          x: collision.witness1.x,
          y: collision.witness1.y,
          z: collision.witness1.z,
        },
        timeOfImpact: collision.toi,
      });
      if (collision.normal1.y < this.robot.minTraversableNormalY - 0.02) {
        impactCollisions += 1;
      }
    }
    this.recordRobotContainment(containment, correctedByContainment);
    this.robotMotion = {
      desired: { x: desiredDelta.x, y: desiredDelta.y, z: desiredDelta.z },
      computed: { x: movement.x, y: movement.y, z: movement.z },
      grounded: this.robot.controller.computedGrounded(),
      collisions,
    };
    return {
      movement,
      collisions: impactCollisions,
      grounded: this.robotMotion.grounded,
    };
  }

  placeRobotSafely(position: THREE.Vector3): THREE.Vector3 {
    if (!this.robot) throw new Error('Robot physics body has not been created');
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      throw new Error('Robot placement must contain finite coordinates');
    }
    let lastCandidate = this.constrainRobotPosition(position.clone());
    let lastObservation = this.evaluateRobotContainment(lastCandidate);
    const evaluateCandidate = (
      source: THREE.Vector3,
    ): { candidate: THREE.Vector3; observation: RobotContainmentObservation } | null => {
      const candidate = this.constrainRobotPosition(source.clone());
      if (this.isContainmentActive() && this.robot!.requiresSupport) {
        const verticalHalfExtent = this.robot!.halfHeight + this.robot!.collider.radius();
        const support = this.measureStaticSupport(
          candidate.x,
          candidate.z,
          candidate.y - verticalHalfExtent,
          Math.max(ROBOT_MAX_SUPPORT_DISTANCE_METERS, verticalHalfExtent + 0.1),
          true,
        );
        if (support === null) {
          lastCandidate = candidate;
          lastObservation = {
            ...this.evaluateRobotContainment(candidate),
            valid: false,
            supported: false,
            supportDistanceMeters: null,
            lastViolation: 'unsupported',
          };
          return null;
        }
        candidate.y = support.surfaceY + verticalHalfExtent + ROBOT_COLLIDER_CLEARANCE_METERS;
        this.constrainRobotPosition(candidate);
      }

      let observation = this.evaluateRobotContainment(candidate);
      if (observation.active && observation.penetratingWorldCollider) {
        const allowed = this.getAllowedRobotCenterBounds();
        for (
          let lift = 0.01;
          lift <= ROBOT_MAX_SUPPORT_DISTANCE_METERS &&
          allowed &&
          candidate.y + 0.01 <= allowed.max.y;
          lift += 0.01
        ) {
          candidate.y += 0.01;
          observation = this.evaluateRobotContainment(candidate);
          if (!observation.penetratingWorldCollider) break;
        }
      }
      lastCandidate = candidate;
      lastObservation = observation;
      return !observation.active || observation.valid ? { candidate, observation } : null;
    };

    let accepted = evaluateCandidate(position);
    if (!accepted && this.isContainmentActive()) {
      const directions = 16;
      for (let radius = 0.15; radius <= 1.2 && !accepted; radius += 0.15) {
        for (let index = 0; index < directions && !accepted; index += 1) {
          const angle = (index / directions) * Math.PI * 2;
          accepted = evaluateCandidate(
            position
              .clone()
              .add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)),
          );
        }
      }
    }
    if (!accepted) {
      throw new Error(
        `Robot placement violates World containment: ${lastObservation.lastViolation}; ` +
          `position=${JSON.stringify(lastCandidate.toArray())}; ` +
          `supportDistance=${lastObservation.supportDistanceMeters ?? 'none'}`,
      );
    }
    const { candidate, observation } = accepted;
    this.commitRobotPosition(candidate);
    this.lastValidRobotPosition.copy(candidate);
    this.recordRobotContainment(observation, false);
    this.robotContacts = {
      sequence: this.robotContacts.sequence + 1,
      profile: this.robot.contactProfile,
      leftFoot: false,
      rightFoot: false,
      supportCount: 0,
      grounded: false,
    };
    return candidate.clone();
  }

  setRobotPosition(position: THREE.Vector3): void {
    if (!this.robot) return;
    this.boundedRobotPosition.copy(position);
    this.commitRobotPosition(this.constrainRobotPosition(this.boundedRobotPosition));
    this.robotContacts = {
      sequence: this.robotContacts.sequence + 1,
      profile: this.robot.contactProfile,
      leftFoot: false,
      rightFoot: false,
      supportCount: 0,
      grounded: false,
    };
  }

  getRobotPosition(target: THREE.Vector3): THREE.Vector3 {
    if (!this.robot) return target.set(0, 0, 0);
    const current = this.robot.body.translation();
    return target.set(current.x, current.y, current.z);
  }

  getDynamicGatePosition(target: THREE.Vector3): THREE.Vector3 | null {
    if (!this.dynamicGateBody) return null;
    const position = this.dynamicGateBody.translation();
    return target.set(position.x, position.y, position.z);
  }

  hasTaskObject(instanceId: string): boolean {
    return this.taskObjectBodies.has(instanceId);
  }

  configureTaskFixtures(roomId: RoomId): number {
    this.clearTaskFixtures();
    if (roomId !== 'kinetic-hall') return 0;
    for (const authoredContract of Object.values(KINETIC_HALL_TASK_FIXTURES)) {
      const contract = this.robotMovementBounds
        ? scaleKineticHallTaskFixture(authoredContract, MINT_WORLD_EXPERIENCE_SCALE)
        : authoredContract;
      if (this.robotMovementBounds) {
        const center = new THREE.Vector3(...contract.sensorCenter);
        const halfExtents = new THREE.Vector3(...contract.sensorHalfExtents);
        const sensorBounds = new THREE.Box3(
          center.clone().sub(halfExtents),
          center.clone().add(halfExtents),
        );
        if (!this.containsBoxWithinWorld(sensorBounds)) {
          throw new Error(`Task fixture "${contract.id}" lies outside World containment`);
        }
      }
      const sensor = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(...contract.sensorHalfExtents)
          .setTranslation(...contract.sensorCenter)
          .setSensor(true)
          .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
          .setCollisionGroups(interactionGroups(TASK_FIXTURE_SENSOR_GROUP, ROBOT_COLLISION_GROUP)),
      );
      this.taskFixtureBodies.set(contract.id, {
        contract,
        sensor,
        state: 'ready',
        sequence: 0,
        ownerRobotId: null,
      });
    }
    return this.taskFixtureBodies.size;
  }

  hasTaskFixture(id: KineticHallTaskFixtureId): boolean {
    return this.taskFixtureBodies.has(id);
  }

  getTaskFixtureObservation(
    id: KineticHallTaskFixtureId,
    robotYaw = 0,
  ): TaskFixtureObservation | null {
    const binding = this.taskFixtureBodies.get(id);
    if (!binding) return null;
    const robotPosition = this.robot?.body.translation();
    const approach = binding.contract.approachSurfacePosition;
    const horizontalDistanceMeters = robotPosition
      ? Math.hypot(robotPosition.x - approach[0], robotPosition.z - approach[2])
      : Number.POSITIVE_INFINITY;
    const yawErrorRadians = Math.abs(
      Math.atan2(
        Math.sin(robotYaw - binding.contract.desiredYawRadians),
        Math.cos(robotYaw - binding.contract.desiredYawRadians),
      ),
    );
    const contact = binding.contract.contactPoint;
    return {
      id,
      semanticObjectId: binding.contract.semanticObjectId,
      sourceDecision: binding.contract.sourceDecision,
      state: binding.state,
      sequence: binding.sequence,
      ownerRobotId: binding.ownerRobotId,
      sensorOverlap: this.robot
        ? this.world.intersectionPair(binding.sensor, this.robot.collider)
        : false,
      horizontalDistanceMeters,
      yawErrorDegrees: THREE.MathUtils.radToDeg(yawErrorRadians),
      contactPoint: { x: contact[0], y: contact[1], z: contact[2] },
      approachSurfacePosition: { x: approach[0], y: approach[1], z: approach[2] },
    };
  }

  actuateTaskFixture(id: 'control-panel-east', ownerRobotId: string, robotYaw: number): boolean {
    const binding = this.taskFixtureBodies.get(id);
    const observation = this.getTaskFixtureObservation(id, robotYaw);
    if (
      !binding ||
      !observation?.sensorOverlap ||
      observation.yawErrorDegrees > binding.contract.yawToleranceDegrees ||
      binding.state === 'actuated'
    ) {
      return false;
    }
    binding.state = 'actuated';
    binding.ownerRobotId = ownerRobotId;
    binding.sequence += 1;
    return true;
  }

  isTaskFixturePoseReady(
    id: KineticHallTaskFixtureId,
    robotYaw: number,
    robotSpeed: number,
    positionTolerance: number,
    yawToleranceDegrees: number,
    maxSpeed: number,
  ): boolean {
    const observation = this.getTaskFixtureObservation(id, robotYaw);
    return Boolean(
      observation?.sensorOverlap &&
      observation.horizontalDistanceMeters <= positionTolerance &&
      observation.yawErrorDegrees <= yawToleranceDegrees &&
      robotSpeed <= maxSpeed,
    );
  }

  getTaskObjectObservation(instanceId: string): TaskObjectObservation | null {
    const binding = this.taskObjectBodies.get(instanceId);
    if (!binding) return null;
    const position = binding.body.translation();
    return {
      sequence: binding.sequence,
      instanceId,
      state: binding.state,
      ownerRobotId: binding.ownerRobotId,
      constraint: binding.joint ? 'rapier-fixed-impulse-joint-v1' : 'none',
      position: { x: position.x, y: position.y, z: position.z },
      resetPosition: {
        x: binding.bodyOrigin.x,
        y: binding.bodyOrigin.y,
        z: binding.bodyOrigin.z,
      },
    };
  }

  canGraspTaskObject(instanceId: string, maxReachMeters = 1.45): boolean {
    const binding = this.taskObjectBodies.get(instanceId);
    if (!binding || !this.robot || binding.joint || binding.state === 'grasped') return false;
    const robotPosition = this.robot.body.translation();
    const objectPosition = binding.body.translation();
    const distance = Math.hypot(
      objectPosition.x - robotPosition.x,
      objectPosition.y - robotPosition.y,
      objectPosition.z - robotPosition.z,
    );
    return Number.isFinite(distance) && distance <= maxReachMeters;
  }

  graspTaskObject(
    instanceId: string,
    ownerRobotId: string,
    _robotYaw: number,
    _localAnchor = new THREE.Vector3(0, -0.18, -0.72),
    maxReachMeters = 1.45,
  ): boolean {
    const binding = this.taskObjectBodies.get(instanceId);
    if (!binding || !this.robot || !this.canGraspTaskObject(instanceId, maxReachMeters))
      return false;
    const robotPosition = this.robot.body.translation();
    const objectPosition = binding.body.translation();
    const objectRotationRaw = binding.body.rotation();
    const objectRotation = new THREE.Quaternion(
      objectRotationRaw.x,
      objectRotationRaw.y,
      objectRotationRaw.z,
      objectRotationRaw.w,
    );
    const anchor = new THREE.Vector3(
      objectPosition.x - robotPosition.x,
      objectPosition.y - robotPosition.y,
      objectPosition.z - robotPosition.z,
    );
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    binding.joint = this.world.createImpulseJoint(
      RAPIER.JointData.fixed(
        anchor,
        objectRotation,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
      ),
      this.robot.body,
      binding.body,
      true,
    );
    binding.collider.setCollisionGroups(
      interactionGroups(TASK_OBJECT_COLLISION_GROUP, ALL_COLLISION_GROUPS & ~ROBOT_COLLISION_GROUP),
    );
    binding.ownerRobotId = ownerRobotId;
    binding.state = 'grasped';
    binding.sequence += 1;
    binding.lastValidTranslation.set(objectPosition.x, objectPosition.y, objectPosition.z);
    binding.lastValidRotation.copy(objectRotation);
    this.syncTaskObjectPresentation(binding);
    return true;
  }

  releaseTaskObject(instanceId: string, ownerRobotId: string): boolean {
    const binding = this.taskObjectBodies.get(instanceId);
    if (!binding?.joint || binding.ownerRobotId !== ownerRobotId) return false;
    this.removeTaskObjectJoint(binding);
    binding.collider.setCollisionGroups(interactionGroups(TASK_OBJECT_COLLISION_GROUP));
    binding.ownerRobotId = null;
    binding.state = 'released';
    binding.sequence += 1;
    binding.body.wakeUp();
    return true;
  }

  sampleStaticSurface(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistanceMeters: number,
  ): WorldSurfaceSample | null {
    if (
      ![
        origin.x,
        origin.y,
        origin.z,
        direction.x,
        direction.y,
        direction.z,
        maxDistanceMeters,
      ].every(Number.isFinite) ||
      direction.lengthSq() < 1e-8 ||
      maxDistanceMeters <= 0
    ) {
      return null;
    }
    const normalizedDirection = direction.clone().normalize();
    const ray = new RAPIER.Ray(origin, normalizedDirection);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistanceMeters,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      undefined,
      (candidate) =>
        this.staticColliderHandles.includes(candidate.handle) &&
        !this.containmentGuardColliderHandles.includes(candidate.handle),
    );
    if (!hit) return null;
    return {
      point: origin.clone().addScaledVector(normalizedDirection, hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize(),
      distanceMeters: hit.timeOfImpact,
    };
  }

  castRobotSensorRays(
    origin: THREE.Vector3,
    directions: readonly THREE.Vector3[],
    maxDistanceMeters: number,
  ): readonly RobotRaySample[] {
    if (
      !this.robot ||
      ![origin.x, origin.y, origin.z, maxDistanceMeters].every(Number.isFinite) ||
      maxDistanceMeters <= 0
    ) {
      const fallbackDistance =
        Number.isFinite(maxDistanceMeters) && maxDistanceMeters > 0 ? maxDistanceMeters : 0;
      return directions.map((direction) => ({
        direction: { x: direction.x, y: direction.y, z: direction.z },
        distanceMeters: fallbackDistance,
        hit: false,
      }));
    }
    const robot = this.robot;
    return directions.map((sourceDirection) => {
      const direction = sourceDirection.clone();
      if (
        ![direction.x, direction.y, direction.z].every(Number.isFinite) ||
        direction.lengthSq() < 1e-8
      ) {
        return {
          direction: { x: 0, y: 0, z: 0 },
          distanceMeters: maxDistanceMeters,
          hit: false,
        };
      }
      direction.normalize();
      const hit = this.world.castRay(
        new RAPIER.Ray(origin, direction),
        maxDistanceMeters,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        robot.collider,
        robot.body,
      );
      return {
        direction: { x: direction.x, y: direction.y, z: direction.z },
        distanceMeters: hit?.timeOfImpact ?? maxDistanceMeters,
        hit: hit !== null,
      };
    });
  }

  step(fixedDt: number): void {
    if (this.dynamicGateBody) {
      this.dynamicTime += fixedDt;
      this.dynamicGateBody.setNextKinematicTranslation({
        x: 9.7,
        y: 1.1 + Math.sin(this.dynamicTime * 0.75) * 0.8,
        z: -2.5,
      });
    }
    if (this.movingPropBodies.length > 0) {
      this.dynamicPropTime += fixedDt;
      const offset = Math.sin(this.dynamicPropTime * 0.72) * 0.9;
      for (const binding of this.movingPropBodies) {
        const proposedBodyPosition = new THREE.Vector3(
          binding.bodyOrigin.x + offset,
          binding.bodyOrigin.y,
          binding.bodyOrigin.z,
        );
        const proposedRootPosition = new THREE.Vector3(
          binding.rootOrigin.x + offset,
          binding.rootOrigin.y,
          binding.rootOrigin.z,
        );
        const proposedBounds = new THREE.Box3().setFromObject(binding.instance.root, true);
        proposedBounds.translate(proposedRootPosition.clone().sub(binding.instance.root.position));
        if (this.isContainmentActive() && !this.containsBoxWithinWorld(proposedBounds)) {
          binding.body.setNextKinematicTranslation(binding.lastValidBodyPosition);
          binding.instance.root.position.copy(binding.lastValidRootPosition);
          this.propContainmentCorrectionCount += 1;
          continue;
        }
        binding.body.setNextKinematicTranslation({
          x: proposedBodyPosition.x,
          y: proposedBodyPosition.y,
          z: proposedBodyPosition.z,
        });
        binding.instance.root.position.copy(proposedRootPosition);
      }
    }
    this.world.timestep = fixedDt;
    this.world.step(this.eventQueue);
    for (const binding of this.taskObjectBodies.values()) {
      this.syncTaskObjectPresentation(binding);
    }
    this.enforceMovingPropContainment();
    this.updateRobotContacts();
  }

  get diagnostics(): { bodies: number; colliders: number; sensors: number; ccdBodies: number } {
    let sensors = 0;
    this.world.forEachCollider((collider) => {
      if (collider.isSensor()) sensors += 1;
    });
    let ccdBodies = 0;
    this.world.forEachRigidBody((body) => {
      if (body.isCcdEnabled()) ccdBodies += 1;
    });
    return {
      bodies: this.world.bodies.len(),
      colliders: this.world.colliders.len(),
      sensors,
      ccdBodies,
    };
  }

  get robotMotionDiagnostics(): RobotMotionDiagnostics {
    return this.robotMotion;
  }

  get containmentDiagnostics(): WorldContainmentDiagnostics {
    const entries = [...this.propContainment.values()].sort((left, right) =>
      left.instanceId.localeCompare(right.instanceId),
    );
    const valid = entries.filter((entry) => entry.valid).length;
    return {
      active: this.isContainmentActive(),
      robot: this.robotContainment,
      props: {
        total: entries.length,
        valid,
        invalid: entries.length - valid,
        correctionCount: this.propContainmentCorrectionCount,
        entries,
      },
    };
  }

  get robotContactObservation(): RobotContactObservation {
    return this.robotContacts;
  }

  releaseRobotBody(): void {
    this.removeRobotBody();
  }

  dispose(): void {
    this.removeRobotBody();
    this.clearKineticProps();
    this.clearStatic();
    this.clearDynamic();
    this.robotMovementBounds = null;
    this.removeStaticHandles(this.containmentGuardColliderHandles.splice(0));
    this.robotContainment = this.createInactiveRobotContainmentObservation();
    this.eventQueue.free();
    this.world.free();
  }

  private createInactiveRobotContainmentObservation(): RobotContainmentObservation {
    return {
      sequence: this.robotContainment.sequence + 1,
      active: false,
      valid: true,
      insideWorldBounds: true,
      supported: true,
      supportDistanceMeters: null,
      penetratingWorldCollider: false,
      violationCount: this.robotContainment.violationCount,
      correctionCount: this.robotContainment.correctionCount,
      lastViolation: 'none',
      allowedCenterBounds: null,
    };
  }

  private isContainmentActive(): boolean {
    return this.robotMovementBounds !== null && this.staticColliderHandles.length > 0;
  }

  private getAllowedRobotCenterBounds(): THREE.Box3 | null {
    if (!this.robot || !this.robotMovementBounds) return null;
    const bounds = this.robotMovementBounds;
    const radius = this.robot.collider.radius();
    const verticalHalfExtent = this.robot.halfHeight + radius;
    const min = new THREE.Vector3(
      bounds.min.x + this.robot.boundaryRadius,
      bounds.min.y + verticalHalfExtent,
      bounds.min.z + this.robot.boundaryRadius,
    );
    const max = new THREE.Vector3(
      bounds.max.x - this.robot.boundaryRadius,
      bounds.max.y - verticalHalfExtent - this.robot.boundaryTopPadding,
      bounds.max.z - this.robot.boundaryRadius,
    );
    if (min.x > max.x) min.x = max.x = (min.x + max.x) * 0.5;
    if (min.y > max.y) min.y = max.y = (min.y + max.y) * 0.5;
    if (min.z > max.z) min.z = max.z = (min.z + max.z) * 0.5;
    return new THREE.Box3(min, max);
  }

  private evaluateRobotContainment(position: THREE.Vector3): RobotContainmentObservation {
    if (!this.robot || !this.isContainmentActive()) {
      return this.createInactiveRobotContainmentObservation();
    }
    const allowed = this.getAllowedRobotCenterBounds()!;
    const insideWorldBounds =
      position.x >= allowed.min.x - CONTAINMENT_EPSILON_METERS &&
      position.x <= allowed.max.x + CONTAINMENT_EPSILON_METERS &&
      position.y >= allowed.min.y - CONTAINMENT_EPSILON_METERS &&
      position.y <= allowed.max.y + CONTAINMENT_EPSILON_METERS &&
      position.z >= allowed.min.z - CONTAINMENT_EPSILON_METERS &&
      position.z <= allowed.max.z + CONTAINMENT_EPSILON_METERS;
    const verticalHalfExtent = this.robot.halfHeight + this.robot.collider.radius();
    const maximumSupportProbeDistance = this.robotMovementBounds
      ? Math.max(
          ROBOT_MAX_SUPPORT_DISTANCE_METERS,
          position.y - verticalHalfExtent - this.robotMovementBounds.min.y + 0.1,
        )
      : ROBOT_MAX_SUPPORT_DISTANCE_METERS;
    const support = this.robot.requiresSupport
      ? this.measureStaticSupport(
          position.x,
          position.z,
          position.y - verticalHalfExtent,
          maximumSupportProbeDistance,
        )
      : null;
    const supported = !this.robot.requiresSupport || support !== null;
    const containmentShape = new RAPIER.Capsule(
      this.robot.halfHeight,
      this.robot.collider.radius(),
    );
    const penetrating =
      this.world.intersectionWithShape(
        position,
        this.robot.body.rotation(),
        containmentShape,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        this.robot.collider,
        this.robot.body,
        (candidate) =>
          this.staticColliderHandles.includes(candidate.handle) ||
          this.containmentGuardColliderHandles.includes(candidate.handle),
      ) !== null;
    const lastViolation: ContainmentViolation = !insideWorldBounds
      ? 'outside-world-bounds'
      : penetrating
        ? 'penetrating-world-collider'
        : !supported
          ? 'unsupported'
          : 'none';
    return {
      sequence: this.robotContainment.sequence + 1,
      active: true,
      valid: lastViolation === 'none',
      insideWorldBounds,
      supported,
      supportDistanceMeters: support?.distanceMeters ?? null,
      penetratingWorldCollider: penetrating,
      violationCount: this.robotContainment.violationCount,
      correctionCount: this.robotContainment.correctionCount,
      lastViolation,
      allowedCenterBounds: {
        min: { x: allowed.min.x, y: allowed.min.y, z: allowed.min.z },
        max: { x: allowed.max.x, y: allowed.max.y, z: allowed.max.z },
      },
    };
  }

  private recordRobotContainment(
    observation: RobotContainmentObservation,
    corrected: boolean,
    countViolation = true,
  ): void {
    const violation = observation.active && !observation.valid && countViolation;
    if (corrected) {
      const restored = this.evaluateRobotContainment(this.lastValidRobotPosition);
      this.robotContainment = {
        ...restored,
        sequence: observation.sequence,
        violationCount: this.robotContainment.violationCount + Number(violation),
        correctionCount: this.robotContainment.correctionCount + 1,
        lastViolation: observation.lastViolation,
      };
      return;
    }
    this.robotContainment = {
      ...observation,
      violationCount: this.robotContainment.violationCount + Number(violation),
      correctionCount: this.robotContainment.correctionCount,
    };
  }

  private measureStaticSupport(
    x: number,
    z: number,
    bottomY: number,
    maxDistanceMeters: number,
    allowSurfaceAboveBottom = false,
  ): { distanceMeters: number; surfaceY: number } | null {
    if (!this.isContainmentActive()) return null;
    const ray = new RAPIER.Ray(
      { x, y: bottomY + ROBOT_SUPPORT_PROBE_LIFT_METERS, z },
      { x: 0, y: -1, z: 0 },
    );
    const hit = this.world.castRay(
      ray,
      ROBOT_SUPPORT_PROBE_LIFT_METERS + maxDistanceMeters,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.robot?.collider,
      this.robot?.body,
      (candidate) =>
        this.staticColliderHandles.includes(candidate.handle) ||
        this.containmentGuardColliderHandles.includes(candidate.handle) ||
        this.propSupportColliderHandles.includes(candidate.handle),
    );
    if (!hit) return null;
    const distanceMeters = hit.timeOfImpact - ROBOT_SUPPORT_PROBE_LIFT_METERS;
    if (
      (!allowSurfaceAboveBottom && distanceMeters < -CONTAINMENT_EPSILON_METERS) ||
      distanceMeters < -ROBOT_SUPPORT_PROBE_LIFT_METERS - CONTAINMENT_EPSILON_METERS ||
      distanceMeters > maxDistanceMeters + CONTAINMENT_EPSILON_METERS
    ) {
      return null;
    }
    return {
      distanceMeters: Math.max(0, distanceMeters),
      surfaceY: ray.origin.y - hit.timeOfImpact,
    };
  }

  private containsBoxWithinWorld(box: THREE.Box3): boolean {
    const bounds = this.robotMovementBounds;
    if (!bounds) return true;
    return (
      box.min.x >= bounds.min.x - CONTAINMENT_EPSILON_METERS &&
      box.min.y >= bounds.min.y - CONTAINMENT_EPSILON_METERS &&
      box.min.z >= bounds.min.z - CONTAINMENT_EPSILON_METERS &&
      box.max.x <= bounds.max.x + CONTAINMENT_EPSILON_METERS &&
      box.max.y <= bounds.max.y + CONTAINMENT_EPSILON_METERS &&
      box.max.z <= bounds.max.z + CONTAINMENT_EPSILON_METERS
    );
  }

  private createPropFloorSupport(box: THREE.Box3): void {
    const floorY = this.robotMovementBounds?.min.y;
    if (floorY === undefined) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const halfHeight = 0.025;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        Math.max(0.05, size.x * 0.5 + 0.04),
        halfHeight,
        Math.max(0.05, size.z * 0.5 + 0.04),
      )
        .setTranslation(center.x, floorY - halfHeight, center.z)
        .setFriction(0.92),
    );
    this.propSupportColliderHandles.push(collider.handle);
  }

  private rebuildContainmentGuards(): void {
    this.removeStaticHandles(this.containmentGuardColliderHandles.splice(0));
    const bounds = this.robotMovementBounds;
    if (!bounds) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const halfHeight = 0.025;
    const wallThickness = 0.05;
    const floor = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x * 0.5, halfHeight, size.z * 0.5)
        .setTranslation(center.x, bounds.min.y - halfHeight, center.z)
        .setFriction(0.94),
    );
    this.containmentGuardColliderHandles.push(floor.handle);
    const ceiling = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x * 0.5, halfHeight, size.z * 0.5)
        .setTranslation(center.x, bounds.max.y + halfHeight, center.z)
        .setFriction(0.82),
    );
    const negativeX = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(wallThickness, size.y * 0.5, size.z * 0.5)
        .setTranslation(bounds.min.x - wallThickness, center.y, center.z)
        .setFriction(0.82),
    );
    const positiveX = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(wallThickness, size.y * 0.5, size.z * 0.5)
        .setTranslation(bounds.max.x + wallThickness, center.y, center.z)
        .setFriction(0.82),
    );
    const negativeZ = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, wallThickness)
        .setTranslation(center.x, center.y, bounds.min.z - wallThickness)
        .setFriction(0.82),
    );
    const positiveZ = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, wallThickness)
        .setTranslation(center.x, center.y, bounds.max.z + wallThickness)
        .setFriction(0.82),
    );
    this.containmentGuardColliderHandles.push(
      ceiling.handle,
      negativeX.handle,
      positiveX.handle,
      negativeZ.handle,
      positiveZ.handle,
    );
    this.world.timestep = 1 / 60;
    this.world.step(this.eventQueue);
  }

  private evaluatePropContainment(
    instance: MintPropInstance,
    requireSupport = true,
  ): PropContainmentObservation {
    instance.root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(instance.root, true);
    if (bounds.isEmpty()) {
      throw new Error(`Mint prop "${instance.placement.instanceId}" has empty bounds`);
    }
    const values = [...bounds.min.toArray(), ...bounds.max.toArray()];
    if (!values.every(Number.isFinite)) {
      throw new Error(`Mint prop "${instance.placement.instanceId}" has non-finite bounds`);
    }
    const active = this.isContainmentActive();
    const insideWorldBounds = !active || this.containsBoxWithinWorld(bounds);
    const center = bounds.getCenter(new THREE.Vector3());
    const supportProbeDistance = this.robotMovementBounds
      ? Math.max(
          PROP_MAX_SUPPORT_DISTANCE_METERS,
          bounds.min.y - this.robotMovementBounds.min.y + 0.5,
        )
      : PROP_MAX_SUPPORT_DISTANCE_METERS;
    const support = active
      ? this.measureStaticSupport(center.x, center.z, bounds.min.y, supportProbeDistance)
      : null;
    const floorAnchored =
      active &&
      this.robotMovementBounds !== null &&
      Math.abs(bounds.min.y - this.robotMovementBounds.min.y) <=
        PROP_FLOOR_PLACEMENT_TOLERANCE_METERS;
    const supported =
      !active ||
      !requireSupport ||
      floorAnchored ||
      (support !== null &&
        support.distanceMeters <= PROP_MAX_SUPPORT_DISTANCE_METERS + CONTAINMENT_EPSILON_METERS);
    const supportSource: PropContainmentObservation['supportSource'] =
      !active || !requireSupport
        ? 'not-required'
        : support !== null &&
            support.distanceMeters <= PROP_MAX_SUPPORT_DISTANCE_METERS + CONTAINMENT_EPSILON_METERS
          ? 'world-collider'
          : floorAnchored
            ? 'reviewed-floor-plane'
            : 'none';
    return {
      instanceId: instance.placement.instanceId,
      valid: insideWorldBounds && supported,
      insideWorldBounds,
      supported,
      supportSource,
      supportDistanceMeters:
        supportSource === 'reviewed-floor-plane' ? 0 : (support?.distanceMeters ?? null),
      bounds: {
        min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
        max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
      },
    };
  }

  private refreshMovingPropContainment(): void {
    for (const binding of this.movingPropBodies) {
      this.propContainment.set(
        binding.instance.placement.instanceId,
        this.evaluatePropContainment(binding.instance),
      );
    }
    for (const binding of this.taskObjectBodies.values()) {
      this.propContainment.set(
        binding.instance.placement.instanceId,
        this.evaluatePropContainment(binding.instance, binding.state !== 'grasped'),
      );
    }
  }

  private enforceMovingPropContainment(): void {
    for (const binding of this.movingPropBodies) {
      const observation = this.evaluatePropContainment(binding.instance);
      if (observation.valid) {
        const position = binding.body.translation();
        binding.lastValidBodyPosition.set(position.x, position.y, position.z);
        binding.lastValidRootPosition.copy(binding.instance.root.position);
        this.propContainment.set(observation.instanceId, observation);
        continue;
      }
      binding.body.setTranslation(binding.lastValidBodyPosition, true);
      binding.body.setNextKinematicTranslation(binding.lastValidBodyPosition);
      binding.instance.root.position.copy(binding.lastValidRootPosition);
      this.propContainmentCorrectionCount += 1;
      this.propContainment.set(
        observation.instanceId,
        this.evaluatePropContainment(binding.instance),
      );
    }
    for (const binding of this.taskObjectBodies.values()) {
      const observation = this.evaluatePropContainment(binding.instance, false);
      if (observation.valid) {
        const position = binding.body.translation();
        const rotation = binding.body.rotation();
        binding.lastValidTranslation.set(position.x, position.y, position.z);
        binding.lastValidRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
        this.propContainment.set(observation.instanceId, observation);
        continue;
      }
      binding.body.setTranslation(binding.lastValidTranslation, true);
      binding.body.setRotation(binding.lastValidRotation, true);
      binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.syncTaskObjectPresentation(binding);
      this.propContainmentCorrectionCount += 1;
      this.propContainment.set(
        observation.instanceId,
        this.evaluatePropContainment(binding.instance, false),
      );
    }
  }

  private attachedTaskObjectsStayContained(robotMovement: THREE.Vector3): boolean {
    if (!this.isContainmentActive()) return true;
    for (const binding of this.taskObjectBodies.values()) {
      if (!binding.joint) continue;
      const translation = binding.body.translation();
      const rotation = binding.body.rotation();
      const proposedTranslation = new THREE.Vector3(
        translation.x + robotMovement.x,
        translation.y + robotMovement.y,
        translation.z + robotMovement.z,
      );
      const proposedRotation = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
      if (
        !this.containsBoxWithinWorld(
          this.getTaskObjectBoundsAt(binding, proposedTranslation, proposedRotation),
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private getTaskObjectBoundsAt(
    binding: TaskObjectBody,
    translation: THREE.Vector3,
    rotation: THREE.Quaternion,
  ): THREE.Box3 {
    const localBounds = new THREE.Box3(
      binding.bodyHalfExtents.clone().multiplyScalar(-1),
      binding.bodyHalfExtents.clone(),
    );
    const matrix = new THREE.Matrix4().compose(translation, rotation, new THREE.Vector3(1, 1, 1));
    return localBounds.applyMatrix4(matrix);
  }

  private constrainRobotPosition(position: THREE.Vector3): THREE.Vector3 {
    if (!this.robot || !this.robotMovementBounds) return position;
    const bounds = this.robotMovementBounds;
    const radius = this.robot.collider.radius();
    const verticalHalfExtent = this.robot.halfHeight + radius;
    const minX = bounds.min.x + this.robot.boundaryRadius;
    const maxX = bounds.max.x - this.robot.boundaryRadius;
    const minY = bounds.min.y + verticalHalfExtent;
    const maxY = bounds.max.y - verticalHalfExtent - this.robot.boundaryTopPadding;
    const minZ = bounds.min.z + this.robot.boundaryRadius;
    const maxZ = bounds.max.z - this.robot.boundaryRadius;
    position.set(
      clampToUsableAxis(position.x, minX, maxX),
      clampToUsableAxis(position.y, minY, maxY),
      clampToUsableAxis(position.z, minZ, maxZ),
    );
    return position;
  }

  private commitRobotPosition(position: THREE.Vector3): void {
    if (!this.robot) return;
    this.robot.body.setTranslation(position, true);
    this.robot.body.setNextKinematicTranslation(position);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  private createFixedCuboid(
    center: THREE.Vector3,
    size: THREE.Vector3,
    rotation = new THREE.Euler(),
  ): void {
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5)
        .setTranslation(center.x, center.y, center.z)
        .setRotation(quaternion)
        .setFriction(0.9),
    );
    this.staticColliderHandles.push(collider.handle);
  }

  private createVerticalGate(center: THREE.Vector3, size: THREE.Vector3): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5).setFriction(0.8),
      body,
    );
    this.dynamicGateBody = body;
  }

  private createFixedWedgeRamp(center: THREE.Vector3, size: THREE.Vector3): void {
    const data = createWedgeRampMeshData([size.x, size.y, size.z]);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(data.vertices, data.indices)
        .setTranslation(center.x, center.y, center.z)
        .setFriction(0.9),
    );
    this.staticColliderHandles.push(collider.handle);
  }

  private clearStatic(): void {
    this.removeStaticHandles(this.staticColliderHandles.splice(0));
  }

  private removeStaticHandles(handles: readonly number[]): void {
    for (const handle of handles) {
      const collider = this.world.getCollider(handle);
      if (collider) this.world.removeCollider(collider, true);
    }
  }

  private clearDynamic(): void {
    if (!this.dynamicGateBody) return;
    this.world.removeRigidBody(this.dynamicGateBody);
    this.dynamicGateBody = null;
  }

  private clearTaskFixtures(): void {
    for (const binding of this.taskFixtureBodies.values()) {
      this.world.removeCollider(binding.sensor, true);
    }
    this.taskFixtureBodies.clear();
  }

  private updateRobotContacts(): void {
    if (!this.robot) return;
    let leftFoot = false;
    let rightFoot = false;
    for (const sensor of this.robot.contactSensors) {
      let supported = false;
      this.world.intersectionPairsWith(sensor.collider, (other) => {
        if (other.parent()?.handle !== this.robot?.body.handle) supported = true;
      });
      if (sensor.name === 'left-foot') leftFoot = supported;
      else rightFoot = supported;
    }
    const supportCount = Number(leftFoot) + Number(rightFoot);
    this.robotContacts = {
      sequence: this.robotContacts.sequence + 1,
      profile: this.robot.contactProfile,
      leftFoot,
      rightFoot,
      supportCount,
      grounded: this.robot.contactSensors.length > 0 ? supportCount > 0 : this.robotMotion.grounded,
    };
  }

  private syncTaskObjectPresentation(binding: TaskObjectBody): void {
    const position = binding.body.translation();
    const rotation = binding.body.rotation();
    binding.instance.root.position.set(
      binding.rootOrigin.x + position.x - binding.bodyOrigin.x,
      binding.rootOrigin.y + position.y - binding.bodyOrigin.y,
      binding.rootOrigin.z + position.z - binding.bodyOrigin.z,
    );
    binding.instance.root.quaternion
      .set(rotation.x, rotation.y, rotation.z, rotation.w)
      .multiply(binding.rootRotationOrigin);
  }

  private removeTaskObjectJoint(binding: TaskObjectBody): void {
    if (!binding.joint) return;
    this.world.removeImpulseJoint(binding.joint, true);
    binding.joint = null;
    binding.collider.setCollisionGroups(interactionGroups(TASK_OBJECT_COLLISION_GROUP));
  }

  private removeRobotBody(): void {
    if (this.robot) {
      for (const binding of this.taskObjectBodies.values()) {
        if (!binding.joint) continue;
        this.removeTaskObjectJoint(binding);
        binding.ownerRobotId = null;
        binding.state = 'released';
        binding.sequence += 1;
      }
      this.world.removeCharacterController(this.robot.controller);
      this.world.removeRigidBody(this.robot.body);
    }
    this.robot = null;
    this.robotContainment = this.createInactiveRobotContainmentObservation();
    this.robotMotion = {
      desired: { x: 0, y: 0, z: 0 },
      computed: { x: 0, y: 0, z: 0 },
      grounded: false,
      collisions: [],
    };
    this.robotContacts = {
      sequence: 0,
      profile: 'none',
      leftFoot: false,
      rightFoot: false,
      supportCount: 0,
      grounded: false,
    };
  }
}
