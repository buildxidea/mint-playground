import * as THREE from 'three';
import {
  ROBOT_WORLD_MARGIN,
  ROBOT_DIMENSIONS_METERS,
  type ControlMode,
  type RobotDefinition,
  type RobotId,
} from '../config/catalog';
import type { InputIntent } from '../core/InputController';
import type {
  PhysicsWorld,
  RobotContactProfile,
  RobotContactSensorSpec,
} from '../physics/PhysicsWorld';
import { RobotSensorSuite, type RobotSensorSnapshot } from '../sensors/RobotSensorSuite';
import type { AxiomRigBinding } from './AxiomRigContract';
import { resolveAxiomGraspMotion } from './AxiomGraspMotion';
import {
  AxiomJumpController,
  resolveAxiomJumpPose,
  type AxiomJumpPresentation,
} from './AxiomJumpMotion';
import type { RobotCarryVisualState } from './RobotCarryRigContract';
import { KestrelFlightController } from './KestrelFlightController';
import { ProductionRobotVisualFactory } from './ProductionRobotVisualFactory';
import { supportsRobotTaskVerb } from './RobotCapabilities';
import { RobotVisualFactory, type RobotVisual } from './RobotVisualFactory';
import {
  defaultRobotTaskVerb,
  RobotTaskController,
  type RobotTaskSnapshot,
  type RobotTaskVerb,
} from '../tasks/RobotTaskController';

type CollisionStep = {
  movement: THREE.Vector3;
  collisions: number;
  grounded: boolean;
};

type RobotShape = {
  radius: number;
  height: number;
  hover: boolean;
  maxSlopeDegrees: number;
  maxStepHeight: number;
  minStepWidth: number;
  boundaryRadius: number;
  visualGroundClearance?: number;
  boundaryTopPadding?: number;
  contactProfile?: RobotContactProfile;
  contactSensors?: readonly RobotContactSensorSpec[];
};

const AXIOM_CROUCHED_HEIGHT_METERS = 0.9;
const AXIOM_CRAWLING_HEIGHT_METERS = 0.66;

const SHAPES: Readonly<Record<RobotId, RobotShape>> = {
  'axiom-h1': {
    radius: 0.28,
    height: 1.78,
    hover: false,
    maxSlopeDegrees: 55,
    maxStepHeight: 0.38,
    minStepWidth: 0.22,
    boundaryRadius: ROBOT_WORLD_MARGIN['axiom-h1'],
    contactProfile: 'axiom-biped-feet-v1',
    contactSensors: [
      { name: 'left-foot', offset: [-0.12, -0.85, -0.04], radius: 0.065 },
      { name: 'right-foot', offset: [0.12, -0.85, -0.04], radius: 0.065 },
    ],
  },
  'quadrant-q4': {
    radius: 0.24,
    height: 0.72,
    hover: false,
    maxSlopeDegrees: 55,
    maxStepHeight: 0.48,
    minStepWidth: 0.24,
    boundaryRadius: ROBOT_WORLD_MARGIN['quadrant-q4'],
  },
  'forge-t7': {
    radius: 0.68,
    height: ROBOT_DIMENSIONS_METERS['forge-t7'][1],
    hover: false,
    maxSlopeDegrees: 35,
    maxStepHeight: 0.18,
    minStepWidth: 0.42,
    boundaryRadius: ROBOT_WORLD_MARGIN['forge-t7'],
    boundaryTopPadding: 0.15,
  },
  'swift-w2': {
    radius: 0.42,
    height: ROBOT_DIMENSIONS_METERS['swift-w2'][1],
    hover: false,
    maxSlopeDegrees: 35,
    maxStepHeight: 0.12,
    minStepWidth: 0.28,
    boundaryRadius: ROBOT_WORLD_MARGIN['swift-w2'],
    // Gaussian ground splats have a soft vertical footprint. Keep the
    // render-only caster above that footprint while Rapier remains grounded
    // on the authoritative collider.
    visualGroundClearance: 0.12,
  },
  'kestrel-d5': {
    radius: 0.39,
    height: ROBOT_DIMENSIONS_METERS['kestrel-d5'][1],
    hover: true,
    maxSlopeDegrees: 70,
    maxStepHeight: 0.1,
    minStepWidth: 0.1,
    boundaryRadius: ROBOT_WORLD_MARGIN['kestrel-d5'],
  },
};

export type RobotTelemetry = {
  speed: number;
  battery: number;
  energyUsed: number;
  collisions: number;
  grounded: boolean;
  position: THREE.Vector3;
  yaw: number;
  emergencyStopped: boolean;
};

export type RobotVisualStatus = 'fallback-loading' | 'production' | 'fallback-error';
export type RobotMobilityPosture = 'standing' | 'crouched' | 'crawling';

export class RobotRuntime {
  readonly sensors: RobotSensorSuite;
  readonly telemetry: RobotTelemetry = {
    speed: 0,
    battery: 100,
    energyUsed: 0,
    collisions: 0,
    grounded: true,
    position: new THREE.Vector3(),
    yaw: 0,
    emergencyStopped: false,
  };

  private readonly shape: RobotShape;
  private readonly desiredDelta = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly resolvedPosition = new THREE.Vector3();
  private readonly syntheticIntent = new THREE.Vector3();
  private readonly taskController: RobotTaskController;
  private readonly jumpController = new AxiomJumpController();
  private animationTime = 0;
  private verticalVelocity = 0;
  private collisionLatch = false;
  private currentVisual: RobotVisual;
  private loadGeneration = 0;
  private isDisposed = false;
  private visualLoad: Promise<void> = Promise.resolve();
  private visualState: RobotVisualStatus = 'fallback-loading';
  private visualFailure: string | null = null;
  private carryVisualState: RobotCarryVisualState | null = null;
  private mobilityPostureState: RobotMobilityPosture = 'standing';
  private currentPhysicsHeight: number;
  private readonly flightController: KestrelFlightController | null;
  private readonly taskTargetWorld = new THREE.Vector3();
  private hasTaskTarget = false;
  private pendingTaskObjectGrasp = false;

  constructor(
    readonly definition: RobotDefinition,
    private readonly physics: PhysicsWorld,
    private readonly scene: THREE.Scene,
    spawn = new THREE.Vector3(-13.5, 0, 7.5),
  ) {
    this.shape = SHAPES[definition.id];
    this.flightController = definition.id === 'kestrel-d5' ? new KestrelFlightController() : null;
    this.currentPhysicsHeight = this.shape.height;
    this.taskController = new RobotTaskController(definition.id);
    this.sensors = new RobotSensorSuite(definition.id, physics);
    this.currentVisual = new RobotVisualFactory().create(definition);
    scene.add(this.currentVisual.root);

    const centerY = this.shape.hover ? 1.8 : this.shape.height * 0.5;
    const center = spawn.clone().setY(centerY);
    physics.createRobotBody(this.shape.radius, this.shape.height, center, {
      maxSlopeDegrees: this.shape.maxSlopeDegrees,
      maxStepHeight: this.shape.maxStepHeight,
      minStepWidth: this.shape.minStepWidth,
      requiresSupport: !this.shape.hover,
      contactProfile: this.shape.contactProfile,
      contactSensors: this.shape.contactSensors,
      boundaryRadius: this.shape.boundaryRadius,
      boundaryTopPadding: this.shape.boundaryTopPadding,
    });
    this.syncVisualFromPhysics();
    this.sensors.reset(this.telemetry);
  }

  get visual(): RobotVisual {
    return this.currentVisual;
  }

  get visualStatus(): RobotVisualStatus {
    return this.visualState;
  }

  get visualError(): string | null {
    return this.visualFailure;
  }

  get visualReady(): Promise<void> {
    return this.visualLoad;
  }

  get visualGroundClearanceMeters(): number {
    return this.shape.hover ? 0 : (this.shape.visualGroundClearance ?? 0);
  }

  get articulation(): AxiomRigBinding | null {
    return this.currentVisual.articulation ?? null;
  }

  get sensorSnapshot(): RobotSensorSnapshot {
    return this.sensors.snapshot;
  }

  get taskAction(): RobotTaskSnapshot {
    return this.taskController.snapshot;
  }

  get mobilityPosture(): RobotMobilityPosture {
    return this.mobilityPostureState;
  }

  get jumpAnimation(): AxiomJumpPresentation {
    return this.jumpController.presentation;
  }

  get flightDynamics() {
    return this.flightController?.presentation ?? null;
  }

  setMobilityPosture(posture: RobotMobilityPosture): void {
    if (posture === this.mobilityPostureState) return;
    if (this.definition.id !== 'axiom-h1' && posture !== 'standing') {
      throw new Error(`${this.definition.id} does not support a humanoid low-clearance posture`);
    }
    const height =
      posture === 'crawling'
        ? AXIOM_CRAWLING_HEIGHT_METERS
        : posture === 'crouched'
          ? AXIOM_CROUCHED_HEIGHT_METERS
          : this.shape.height;
    this.physics.setRobotHeight(height);
    this.currentPhysicsHeight = height;
    this.mobilityPostureState = posture;
    this.syncVisualFromPhysics();
  }

  cycleMobilityPosture(): RobotMobilityPosture {
    if (this.definition.id !== 'axiom-h1') return this.mobilityPostureState;
    const next: RobotMobilityPosture =
      this.mobilityPostureState === 'standing'
        ? 'crouched'
        : this.mobilityPostureState === 'crouched'
          ? 'crawling'
          : 'standing';
    this.setMobilityPosture(next);
    return this.mobilityPostureState;
  }

  setTaskInteractionTarget(position: Readonly<{ x: number; y: number; z: number }> | null): void {
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) {
      this.hasTaskTarget = false;
      return;
    }
    this.taskTargetWorld.set(position.x, position.y, position.z);
    this.hasTaskTarget = true;
  }

  setCarryVisualState(state: RobotCarryVisualState | null): void {
    this.carryVisualState = state;
  }

  triggerTaskAction(verb?: RobotTaskVerb): boolean {
    const requestedVerb = verb ?? defaultRobotTaskVerb(this.definition.id);
    if (!supportsRobotTaskVerb(this.definition.id, requestedVerb)) return false;
    if (this.taskController.snapshot.active) return false;
    if (this.physics.hasTaskObject('instrument-case')) {
      if (requestedVerb === 'grasp') {
        const observation = this.physics.getTaskObjectObservation('instrument-case');
        const anchor = this.taskObjectAnchor();
        if (!anchor || !this.physics.canGraspTaskObject('instrument-case', 1.45)) return false;
        this.setTaskInteractionTarget(observation?.position ?? null);
        this.pendingTaskObjectGrasp = true;
      } else if (
        requestedVerb === 'release' &&
        !this.physics.releaseTaskObject('instrument-case', this.definition.id)
      ) {
        return false;
      }
    }
    if (
      requestedVerb === 'press' &&
      this.physics.hasTaskFixture('control-panel-east') &&
      !this.physics.actuateTaskFixture('control-panel-east', this.definition.id, this.telemetry.yaw)
    ) {
      return false;
    }
    if (
      requestedVerb === 'dock' &&
      this.physics.hasTaskFixture('dock-south') &&
      !this.physics.isTaskFixturePoseReady(
        'dock-south',
        this.telemetry.yaw,
        this.telemetry.speed,
        0.12,
        5,
        0.05,
      )
    ) {
      return false;
    }
    const triggered = this.taskController.trigger(requestedVerb);
    if (!triggered) this.pendingTaskObjectGrasp = false;
    return triggered;
  }

  triggerSecondaryAction(): boolean {
    const taskObject = this.physics.getTaskObjectObservation('instrument-case');
    if (
      taskObject?.state === 'grasped' &&
      taskObject.ownerRobotId === this.definition.id &&
      this.physics.releaseTaskObject('instrument-case', this.definition.id)
    ) {
      this.pendingTaskObjectGrasp = false;
      this.taskController.cancel();
      return this.taskController.trigger('release');
    }
    const canceled = this.taskController.cancel();
    if (canceled) this.pendingTaskObjectGrasp = false;
    return canceled;
  }

  acknowledgeTaskCompletion(): boolean {
    return this.taskController.acknowledgeCompletion();
  }

  loadProductionVisual(): Promise<void> {
    if (this.isDisposed) return Promise.resolve();
    const generation = ++this.loadGeneration;
    this.visualState = 'fallback-loading';
    this.visualFailure = null;
    this.visualLoad = new ProductionRobotVisualFactory()
      .create(this.definition)
      .then((candidate) => {
        if (this.isDisposed || generation !== this.loadGeneration) {
          candidate.dispose();
          return;
        }
        candidate.root.position.copy(this.currentVisual.root.position);
        candidate.root.quaternion.copy(this.currentVisual.root.quaternion);
        candidate.root.scale.copy(this.currentVisual.root.scale);
        this.scene.add(candidate.root);
        const fallback = this.currentVisual;
        this.currentVisual = candidate;
        fallback.root.removeFromParent();
        fallback.dispose();
        this.visualState = 'production';
      })
      .catch((error: unknown) => {
        if (this.isDisposed || generation !== this.loadGeneration) return;
        this.visualState = 'fallback-error';
        this.visualFailure = error instanceof Error ? error.message : String(error);
        console.error(`Failed to load production visual for ${this.definition.id}`, error);
      });
    return this.visualLoad;
  }

  fixedUpdate(
    fixedDt: number,
    intent: InputIntent,
    controlMode: ControlMode,
    navigationTarget: THREE.Vector3 | null,
    navigationYawTarget: number | null = null,
  ): void {
    if (intent.emergencyStop) this.telemetry.emergencyStopped = true;
    if (this.telemetry.emergencyStopped) {
      this.flightController?.reset();
      this.jumpController.reset();
      this.telemetry.speed = 0;
      this.animateVisuals(fixedDt, intent);
      this.updateStatus('fault');
      return;
    }

    const command = this.resolveCommand(intent, controlMode, navigationTarget, navigationYawTarget);
    if (command.interact) this.triggerTaskAction();
    if (command.secondaryAction) this.triggerSecondaryAction();
    let jumpStarted = false;
    if (
      command.jump &&
      !this.shape.hover &&
      (this.telemetry.grounded ||
        this.physics.robotMotionDiagnostics.grounded ||
        this.physics.robotContactObservation.grounded) &&
      this.verticalVelocity <= 0.01
    ) {
      this.verticalVelocity = 5.15;
      this.telemetry.grounded = false;
      jumpStarted = true;
    }
    const speedScale = intent.precision ? 0.28 : intent.boost ? 1.35 : 1;
    const targetSpeed = this.definition.maxSpeed * speedScale;
    const turnInput = command.yaw + (this.isHolonomic() ? 0 : -command.translation.x);
    if (this.flightController) {
      const flight = this.flightController.step(fixedDt, this.telemetry.yaw, {
        localRight: command.translation.x,
        localForward: command.translation.z,
        vertical: command.translation.y,
        yaw: turnInput,
        maxHorizontalSpeed: targetSpeed,
        maxVerticalSpeed: targetSpeed * 0.55,
        maxYawRate: this.definition.turnRate,
      });
      this.telemetry.yaw += flight.yawDelta;
      this.desiredDelta.copy(flight.velocity).multiplyScalar(fixedDt);
    } else {
      this.telemetry.yaw +=
        THREE.MathUtils.clamp(turnInput, -1, 1) * this.definition.turnRate * fixedDt;
      this.forward.set(-Math.sin(this.telemetry.yaw), 0, -Math.cos(this.telemetry.yaw));
      this.right.set(Math.cos(this.telemetry.yaw), 0, -Math.sin(this.telemetry.yaw));
      this.desiredDelta
        .copy(this.forward)
        .multiplyScalar(command.translation.z * targetSpeed * fixedDt);

      const lateralScale =
        this.definition.id === 'swift-w2'
          ? 1
          : this.definition.id === 'quadrant-q4'
            ? 0.55
            : this.definition.id === 'axiom-h1'
              ? 0.42
              : 0;
      this.desiredDelta.addScaledVector(
        this.right,
        command.translation.x * targetSpeed * lateralScale * fixedDt,
      );
      this.verticalVelocity = Math.max(-12, this.verticalVelocity - 9.81 * fixedDt);
      this.desiredDelta.y = this.verticalVelocity * fixedDt;
    }

    const collision = this.physics.moveRobot(this.desiredDelta);
    if (!this.shape.hover && collision.grounded && this.verticalVelocity < 0) {
      this.verticalVelocity = 0;
    }
    if (this.flightController) {
      this.flightController.reconcileResolvedVelocity(
        collision.movement.clone().multiplyScalar(1 / fixedDt),
      );
    }
    this.applyCollisionTelemetry(collision);
    if (this.definition.id === 'axiom-h1') {
      this.jumpController.step(fixedDt, {
        jumpStarted,
        grounded: collision.grounded,
        verticalVelocity: this.verticalVelocity,
      });
    } else {
      this.jumpController.reset();
    }

    const horizontalSpeed = Math.hypot(collision.movement.x, collision.movement.z) / fixedDt;
    this.telemetry.speed = THREE.MathUtils.lerp(this.telemetry.speed, horizontalSpeed, 0.28);
    const effort =
      (this.telemetry.speed / Math.max(0.1, this.definition.maxSpeed) +
        Math.abs(command.translation.y) * 0.5 +
        Math.abs(turnInput) * 0.12) *
      fixedDt;
    this.telemetry.energyUsed += effort;
    this.telemetry.battery = Math.max(0, 100 - this.telemetry.energyUsed * 0.065);
    this.animationTime += fixedDt * (0.5 + this.telemetry.speed * 2.2);
    this.animateVisuals(fixedDt, command);
    this.updatePendingTaskObjectGrasp();
    this.taskController.update(fixedDt);
    this.updateStatus('operational');
  }

  /**
   * Complete the robot side of an app-owned fixed tick after Rapier advances.
   * Physics stepping cannot belong to one robot because a stopped robot must
   * not freeze props, mechanisms, sensors, or future peer robots.
   */
  syncAfterPhysicsStep(fixedDt = 1 / 60): void {
    const contacts = this.physics.robotContactObservation;
    if (contacts.profile !== 'none') this.telemetry.grounded = contacts.grounded;
    this.syncVisualFromPhysics();
    this.sensors.update(fixedDt, this.telemetry, this.articulation);
  }

  reset(position = new THREE.Vector3(-13.5, 0, 7.5)): void {
    if (this.mobilityPostureState !== 'standing') {
      this.physics.placeRobotSafely(
        position.clone().setY(position.y + this.currentPhysicsHeight * 0.5),
      );
    }
    this.setMobilityPosture('standing');
    const centerY = this.shape.hover ? 1.8 : position.y + this.shape.height * 0.5;
    this.physics.placeRobotSafely(position.clone().setY(centerY));
    this.telemetry.speed = 0;
    this.telemetry.battery = 100;
    this.telemetry.energyUsed = 0;
    this.telemetry.collisions = 0;
    this.telemetry.grounded = !this.shape.hover;
    this.telemetry.position.copy(position);
    this.telemetry.yaw = 0;
    this.telemetry.emergencyStopped = false;
    this.animationTime = 0;
    this.taskController.reset();
    this.pendingTaskObjectGrasp = false;
    this.hasTaskTarget = false;
    this.carryVisualState = null;
    this.verticalVelocity = 0;
    this.jumpController.reset();
    this.flightController?.reset();
    this.collisionLatch = false;
    this.syncVisualFromPhysics();
    this.sensors.reset(this.telemetry);
    this.updateStatus('operational');
  }

  /**
   * Deterministically place the robot for E2E contact qualification.
   * `surfacePosition` is the point beneath the morphology. Preserve the
   * scenario-selected posture so a test reset cannot expand AXIOM into a
   * reviewed low-clearance task pose before teleporting.
   */
  setPoseForTest(surfacePosition: THREE.Vector3, yaw: number): void {
    this.teleportForTest(surfacePosition, yaw);
    this.telemetry.battery = 100;
    this.telemetry.energyUsed = 0;
    this.telemetry.collisions = 0;
    this.telemetry.emergencyStopped = false;
    this.animationTime = 0;
    this.taskController.reset();
    this.pendingTaskObjectGrasp = false;
    this.hasTaskTarget = false;
    this.jumpController.reset();
    this.sensors.reset(this.telemetry);
    this.updateStatus('operational');
  }

  /**
   * Move the test robot without resetting task sequence identity. This is used
   * to exercise a multi-objective physical scenario while preserving the same
   * authoritative task controller instance.
   */
  teleportForTest(surfacePosition: THREE.Vector3, yaw: number): void {
    const centerY = this.shape.hover ? 1.8 : surfacePosition.y + this.currentPhysicsHeight * 0.5;
    this.physics.placeRobotSafely(surfacePosition.clone().setY(centerY));
    this.telemetry.position.copy(surfacePosition);
    this.telemetry.speed = 0;
    this.telemetry.yaw = yaw;
    this.verticalVelocity = 0;
    this.jumpController.reset();
    this.flightController?.reset();
    this.collisionLatch = false;
    this.syncVisualFromPhysics();
  }

  clearEmergencyStop(): void {
    this.telemetry.emergencyStopped = false;
  }

  dispose(_scene?: THREE.Scene): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.loadGeneration += 1;
    this.currentVisual.root.removeFromParent();
    this.currentVisual.dispose();
    this.sensors.dispose();
    this.physics.releaseRobotBody();
  }

  private resolveCommand(
    intent: InputIntent,
    controlMode: ControlMode,
    navigationTarget: THREE.Vector3 | null,
    navigationYawTarget: number | null,
  ): InputIntent {
    if (controlMode === 'manual' || !navigationTarget) return intent;

    this.syntheticIntent.set(0, 0, 0);
    const delta = navigationTarget.clone().sub(this.telemetry.position);
    if (this.shape.hover) this.syntheticIntent.y = THREE.MathUtils.clamp(delta.y, -1, 1);
    delta.y = 0;
    const distance = delta.length();
    if (distance > 0.08) {
      delta.normalize();
      const localForward = delta.dot(this.forward);
      const localRight = delta.dot(this.right);
      const holonomic = this.isHolonomic();
      const desiredYaw = Math.atan2(-delta.x, -delta.z);
      const yawError = Math.atan2(
        Math.sin(desiredYaw - this.telemetry.yaw),
        Math.cos(desiredYaw - this.telemetry.yaw),
      );
      const turnInPlace = this.definition.id === 'axiom-h1' && Math.abs(yawError) > 0.25;
      if (!turnInPlace) {
        this.syntheticIntent.z = THREE.MathUtils.clamp(localForward, -1, 1);
      }
      if (holonomic) {
        this.syntheticIntent.x = THREE.MathUtils.clamp(localRight, -1, 1);
      }
      intent.yaw = THREE.MathUtils.clamp(yawError * 1.8, -1, 1);
    } else if (navigationYawTarget !== null) {
      const yawError = Math.atan2(
        Math.sin(navigationYawTarget - this.telemetry.yaw),
        Math.cos(navigationYawTarget - this.telemetry.yaw),
      );
      intent.yaw = THREE.MathUtils.clamp(yawError * 1.8, -1, 1);
    }

    if (controlMode === 'assisted') {
      this.syntheticIntent.lerp(intent.translation, 0.35);
    }
    intent.translation.copy(this.syntheticIntent);
    return intent;
  }

  private isHolonomic(): boolean {
    return this.definition.id === 'swift-w2' || this.definition.id === 'kestrel-d5';
  }

  private taskObjectAnchor(): THREE.Vector3 | null {
    switch (this.definition.id) {
      case 'axiom-h1':
        return new THREE.Vector3(0, -0.18, -0.72);
      case 'forge-t7':
        return new THREE.Vector3(0, 0, -1.05);
      case 'swift-w2':
        return new THREE.Vector3(0, -0.05, -0.78);
      case 'kestrel-d5':
        return new THREE.Vector3(0, -0.44, 0);
      case 'quadrant-q4':
        return null;
    }
  }

  private applyCollisionTelemetry(collision: CollisionStep): void {
    const colliding = collision.collisions > 0;
    if (colliding && !this.collisionLatch) this.telemetry.collisions += 1;
    this.collisionLatch = colliding;
    this.telemetry.grounded = collision.grounded;
  }

  private syncVisualFromPhysics(): void {
    this.physics.getRobotPosition(this.resolvedPosition);
    this.telemetry.position.copy(this.resolvedPosition);
    const verticalOffset = this.shape.hover ? 0.9 : this.currentPhysicsHeight * 0.5;
    this.visual.root.position.copy(this.resolvedPosition);
    this.visual.root.position.y -= verticalOffset;
    this.visual.root.position.y += this.visualGroundClearanceMeters;
    this.visual.root.userData.visualGroundClearanceMeters = this.visualGroundClearanceMeters;
    this.visual.root.rotation.y = this.telemetry.yaw;
  }

  private animateVisuals(fixedDt: number, command: InputIntent): void {
    const speedRatio = THREE.MathUtils.clamp(
      this.telemetry.speed / Math.max(0.1, this.definition.maxSpeed),
      0,
      1.5,
    );
    const stride = Math.sin(this.animationTime) * speedRatio;
    const jump = this.jumpController.presentation;
    this.currentVisual.root.userData.jumpAnimation =
      this.definition.id === 'axiom-h1'
        ? {
            ...jump,
            profile: 'axiom-h1:articulated-jump-v1',
          }
        : null;

    if (this.currentVisual.animate) {
      const taskAction = this.taskAction;
      this.currentVisual.animate({
        fixedDt,
        animationTime: this.animationTime,
        speedRatio,
        taskActionActive: taskAction.active,
        taskActionPhase: taskAction.phase,
        taskActionVerb: taskAction.verb,
        mobilityPosture: this.mobilityPostureState,
        command,
        flight: this.flightController?.presentation ?? null,
        jump,
        taskTargetWorld: this.hasTaskTarget ? this.taskTargetWorld : null,
        carry: this.carryVisualState,
      });
      return;
    }

    const carry = this.carryVisualState;
    if (this.definition.id === 'axiom-h1') {
      const jumpPose = resolveAxiomJumpPose(jump);
      this.visual.locomotionParts.forEach((part, index) => {
        part.rotation.x = jump.active
          ? THREE.MathUtils.degToRad(
              index % 2 === 0 ? jumpPose.thighPitchDegrees : jumpPose.kneePitchDegrees,
            )
          : stride * (index < 2 ? 0.42 : -0.42);
      });
      this.visual.manipulatorParts.forEach((part, index) => {
        const isShoulder = index % 2 === 0;
        part.rotation.x = carry
          ? -carry.reach * (isShoulder ? 0.72 : 0.48)
          : jump.active
            ? THREE.MathUtils.degToRad(
                isShoulder ? jumpPose.upperArmPitchDegrees : jumpPose.forearmPitchDegrees,
              )
            : stride * (index < 2 ? -0.18 : 0.18);
        if (isShoulder) {
          const side = index < 2 ? -1 : 1;
          part.rotation.z =
            jump.active && !carry
              ? THREE.MathUtils.degToRad(jumpPose.upperArmRollDegrees) * side
              : 0;
        }
      });
      this.visual.body.position.y = jumpPose.bodyOffsetY;
      this.visual.body.rotation.x = THREE.MathUtils.degToRad(
        jumpPose.hipsPitchDegrees * 0.24 + jumpPose.spinePitchDegrees,
      );
      this.visual.body.rotation.z = Math.sin(this.animationTime * 0.5) * speedRatio * 0.015;
    } else if (this.definition.id === 'quadrant-q4') {
      this.visual.locomotionParts.forEach((part, index) => {
        const phase = index % 4 < 2 ? 0 : Math.PI;
        part.rotation.x = Math.sin(this.animationTime + phase) * speedRatio * 0.38;
      });
      this.visual.body.position.y =
        Math.sin(this.animationTime * 2) * speedRatio * 0.018 -
        (carry ? (1 - carry.lift) * 0.1 + carry.loadScale * 0.025 : 0);
    } else if (this.definition.id === 'forge-t7') {
      for (const wheel of this.visual.locomotionParts) {
        wheel.rotation.x += fixedDt * this.telemetry.speed * 2.8;
      }
      this.visual.manipulatorParts[0].rotation.y = carry
        ? 0
        : Math.sin(this.animationTime * 0.12) * 0.12;
      if (carry) {
        this.visual.manipulatorParts[1].rotation.x = -0.48 - carry.reach * 0.34;
        this.visual.manipulatorParts[2].rotation.x = 0.96 + carry.reach * 0.48;
      }
    } else if (this.definition.id === 'swift-w2') {
      for (const wheel of this.visual.locomotionParts) {
        wheel.rotation.x += fixedDt * this.telemetry.speed * 4.2;
      }
      this.visual.manipulatorParts.forEach((part, index) => {
        part.rotation.x = carry
          ? -carry.reach * (index % 2 === 0 ? 0.78 : 0.56)
          : Math.sin(this.animationTime * 0.32 + index) * 0.08;
      });
    } else {
      for (const rotor of this.visual.locomotionParts) {
        rotor.rotation.y +=
          fixedDt *
          (18 + speedRatio * 14 + (this.flightController?.presentation.thrustRatio ?? 0) * 18);
      }
      this.visual.body.rotation.z = this.flightController?.presentation.roll ?? 0;
      this.visual.body.rotation.x = this.flightController?.presentation.pitch ?? 0;
      this.visual.body.position.y = carry ? -carry.loadScale * 0.035 : 0;
    }

    const taskAction = this.taskAction;
    const taskPulse = taskAction.active ? Math.sin(taskAction.phase * Math.PI) : 0;
    const taskSweep = taskAction.active ? Math.sin(taskAction.phase * Math.PI * 4) : 0;
    const sensorTask = taskAction.verb === 'scan' || taskAction.verb === 'inspect';
    this.visual.sensor.rotation.y = sensorTask
      ? taskSweep * 0.82
      : Math.sin(this.animationTime * 0.23) * 0.38;

    if (taskAction.active && !carry) {
      if (this.definition.id === 'axiom-h1') {
        this.visual.manipulatorParts.forEach((part, index) => {
          part.rotation.x = -taskPulse * (index % 2 === 0 ? 0.72 : 0.46);
        });
      } else if (this.definition.id === 'quadrant-q4') {
        this.visual.body.position.y = -taskPulse * 0.09;
      } else if (this.definition.id === 'forge-t7') {
        this.visual.manipulatorParts[0].rotation.y = taskSweep * 0.34;
        this.visual.manipulatorParts[1].rotation.x = -0.48 - taskPulse * 0.38;
        this.visual.manipulatorParts[2].rotation.x = 0.96 + taskPulse * 0.54;
      } else if (this.definition.id === 'swift-w2') {
        this.visual.manipulatorParts.forEach((part, index) => {
          part.rotation.x = -taskPulse * (index % 2 === 0 ? 0.8 : 0.56);
        });
      } else {
        this.visual.sensor.rotation.x = -0.16 - taskPulse * 0.28;
        this.visual.body.position.y = -taskPulse * 0.08;
      }
    }

    this.visual.root.userData.taskAnimation = {
      active: taskAction.active || carry !== null,
      verb: taskAction.verb,
      phase: carry?.progress ?? taskAction.phase,
      profile: carry
        ? `${this.definition.id}:carry-${carry.mode}-${carry.stage}`
        : `${this.definition.id}:${sensorTask ? 'sensor-sweep' : 'task-motion'}`,
    };
  }

  private updateStatus(state: 'operational' | 'fault'): void {
    for (const material of this.visual.statusMaterials) {
      const color = state === 'fault' ? '#ff2d2d' : this.definition.accent;
      material.color.set(color);
      material.emissive.set(color);
      material.emissiveIntensity =
        state === 'fault' ? 4 + Math.sin(this.animationTime * 8) * 1.5 : 2.2;
    }
  }

  private updatePendingTaskObjectGrasp(): void {
    if (!this.pendingTaskObjectGrasp) return;
    const task = this.taskAction;
    if (!task.active || task.verb !== 'grasp' || !resolveAxiomGraspMotion(task.phase).attachReady) {
      return;
    }
    const anchor = this.taskObjectAnchor();
    if (
      !anchor ||
      !this.physics.graspTaskObject(
        'instrument-case',
        this.definition.id,
        this.telemetry.yaw,
        anchor,
      )
    ) {
      this.taskController.cancel();
    }
    this.pendingTaskObjectGrasp = false;
  }
}
