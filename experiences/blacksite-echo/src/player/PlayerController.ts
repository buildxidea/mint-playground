import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import type { AccessibilitySettings } from '../game/types';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import type { SplatContainment } from '../world/SplatContainment';

const movement = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const lookDelta = new THREE.Vector2();

/** Default snap-back distance when the body drops through walkable support. */
export const DEFAULT_VOID_FALL_RECOVERY_METERS = 0.85;

export type PlayerSnapshot = {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  health: number;
  armor: number;
};

export class PlayerController {
  readonly position = new THREE.Vector3(0, 1, 7);
  yaw = 0;
  pitch = 0;
  health = 100;
  armor = 60;
  suppression = 0;
  isSprinting = false;
  isCrouching = false;
  isAiming = false;
  speed = 0;
  /** Wish-axis: A=-1 … D=+1 (last fixed step). */
  moveAxisX = 0;
  /** Wish-axis: W=+1 … S=-1 (last fixed step). */
  moveAxisForward = 0;

  private crouchToggle = false;
  private sprintToggle = false;
  private aimToggle = false;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private bobTime = 0;
  private cameraShake = 0;
  private readonly spawn = new THREE.Vector3(0, 1, 7);
  private readonly lastSafePosition = new THREE.Vector3(0, 1, 7);
  private playableBounds: THREE.Box3 | null = null;
  private splatContainment: SplatContainment | null = null;
  private splatActorId = 'player';
  private splatCapsuleRadius = 0.34;
  private containmentRecoveries = 0;
  private voidFallRecoveries = 0;
  /** When set, falling this far below lastSafe Y snaps the player back. */
  private voidFallRecoveryMeters: number | null = null;
  private readonly constrainSplatMovement = (
    previous: THREE.Vector3,
    proposed: THREE.Vector3,
  ): THREE.Vector3 =>
    this.splatContainment
      ? this.splatContainment.resolveMovement(
          this.splatActorId,
          previous,
          proposed,
          this.splatCapsuleRadius,
        ).position
      : proposed;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.physics.createPlayer(this.spawn);
    this.position.copy(this.spawn);
  }

  configurePlayableArea(
    colliderBounds: THREE.Box3,
    groundedSpawn: THREE.Vector3,
    inset = 1.25,
    options?: { voidFallRecoveryMeters?: number | null },
  ): void {
    this.splatContainment = null;
    this.splatActorId = 'player';
    this.voidFallRecoveryMeters =
      options?.voidFallRecoveryMeters === undefined
        ? DEFAULT_VOID_FALL_RECOVERY_METERS
        : options.voidFallRecoveryMeters;
    this.playableBounds = colliderBounds.clone();
    this.playableBounds.min.x += inset;
    this.playableBounds.max.x -= inset;
    this.playableBounds.min.z += inset;
    this.playableBounds.max.z -= inset;
    // Keep a shallow skirt for steps, but void recovery handles deep falls.
    this.playableBounds.min.y -= 1.5;
    this.playableBounds.max.y += 2;
    this.spawn.copy(groundedSpawn);
    this.lastSafePosition.copy(groundedSpawn);
    this.position.copy(groundedSpawn);
    this.physics.teleportPlayer(groundedSpawn);
  }

  clearVoidFallRecovery(): void {
    this.voidFallRecoveryMeters = null;
  }

  configureSplatContainment(
    containment: SplatContainment,
    groundedSpawn: THREE.Vector3,
    actorId = 'player',
    capsuleRadius = 0.34,
    options?: { voidFallRecoveryMeters?: number | null },
  ): void {
    this.splatContainment = containment;
    this.splatActorId = actorId;
    this.splatCapsuleRadius = capsuleRadius;
    this.playableBounds = null;
    this.voidFallRecoveryMeters =
      options?.voidFallRecoveryMeters === undefined
        ? DEFAULT_VOID_FALL_RECOVERY_METERS
        : options.voidFallRecoveryMeters;
    if (
      !containment.registerActor(
        actorId,
        groundedSpawn,
        capsuleRadius,
      )
    ) {
      throw new Error('Player spawn is outside the baked splat navigation surface');
    }
    this.lastSafePosition.copy(groundedSpawn);
  }

  get spawnPosition(): THREE.Vector3 {
    return this.spawn.clone();
  }

  get playableArea(): THREE.Box3 | null {
    return this.playableBounds?.clone() ?? null;
  }

  get recoveryCount(): number {
    return this.containmentRecoveries + this.voidFallRecoveries;
  }

  get containmentRecoveryCount(): number {
    return this.containmentRecoveries;
  }

  get voidFallRecoveryCount(): number {
    return this.voidFallRecoveries;
  }

  get voidFallRecoveryEnabled(): boolean {
    return this.voidFallRecoveryMeters != null;
  }

  updateLook(input: InputController, settings: AccessibilitySettings): void {
    input.consumeLook(lookDelta);
    const scale = settings.sensitivity * 0.00165;
    this.yaw -= lookDelta.x * scale;
    this.pitch -= lookDelta.y * scale;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.47, Math.PI * 0.47);
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(
      pitch,
      -Math.PI * 0.47,
      Math.PI * 0.47,
    );
  }

  updateFixed(
    delta: number,
    input: InputController,
    settings: AccessibilitySettings,
  ): void {
    this.updateModes(input, settings);
    const axisX =
      Number(input.isDown('KeyD') || input.isDown('ArrowRight')) -
      Number(input.isDown('KeyA') || input.isDown('ArrowLeft'));
    const axisZ =
      Number(input.isDown('KeyS') || input.isDown('ArrowDown')) -
      Number(input.isDown('KeyW') || input.isDown('ArrowUp'));
    this.moveAxisX = axisX;
    this.moveAxisForward = -axisZ;

    forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    movement.copy(right).multiplyScalar(axisX).addScaledVector(forward, -axisZ);
    if (movement.lengthSq() > 1) movement.normalize();

    const hasMovement = movement.lengthSq() > 0.01;
    this.isSprinting =
      this.sprintToggle && hasMovement && !this.isCrouching && !this.isAiming;
    const maxSpeed = this.isCrouching ? 2.65 : this.isSprinting ? 7.3 : 4.65;
    const targetSpeed = hasMovement ? maxSpeed : 0;
    this.speed = THREE.MathUtils.damp(this.speed, targetSpeed, hasMovement ? 15 : 11, delta);
    if (hasMovement) movement.normalize().multiplyScalar(this.speed);
    else movement.set(0, 0, 0);

    const jumpRequested = input.wasPressed('Space') && !this.isCrouching;
    // Catch tunneling / debug drops before soft containment masks the void Y.
    if (this.recoverVoidFallIfNeeded()) {
      // Fall through to bob/suppression updates below.
    } else {
      this.position.copy(
        this.physics.movePlayer(
          movement,
          jumpRequested,
          delta,
          this.splatContainment ? this.constrainSplatMovement : undefined,
        ),
      );
      if (this.recoverVoidFallIfNeeded()) {
        // snapped after movement
      } else if (!this.isInsidePlayableArea(this.position)) {
        this.position.copy(this.lastSafePosition);
        this.physics.teleportPlayer(this.lastSafePosition);
        this.speed = 0;
        this.containmentRecoveries += 1;
        this.splatContainment?.commitEntry(
          this.splatActorId,
          this.lastSafePosition,
          this.splatCapsuleRadius,
        );
      } else if (this.physics.isGrounded()) {
        this.lastSafePosition.copy(this.position);
      }
    }
    this.bobTime += this.speed * delta;
    this.suppression = Math.max(0, this.suppression - delta * 0.72);
  }

  updateCamera(
    delta: number,
    elapsed: number,
    settings: AccessibilitySettings,
    adsFactor: number,
  ): void {
    this.isAiming = adsFactor > 0.45;
    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 18, delta);
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 16, delta);
    this.cameraShake = Math.max(0, this.cameraShake - delta * 2.3);
    const eyeHeight = this.isCrouching ? 1.08 : 1.62;
    const bobAmount =
      this.physics.isGrounded() && this.speed > 0.6 && !settings.reducedShake
        ? (this.isSprinting ? 0.026 : 0.014) * (1 - adsFactor * 0.8)
        : 0;
    const bobY = Math.abs(Math.sin(this.bobTime * 1.55)) * bobAmount;
    const bobX = Math.sin(this.bobTime * 0.78) * bobAmount * 0.55;
    const trauma = settings.reducedShake ? this.cameraShake * 0.18 : this.cameraShake;
    const shakeX = Math.sin(elapsed * 43.7) * trauma * trauma * 0.018;
    const shakeY = Math.sin(elapsed * 37.1 + 1.3) * trauma * trauma * 0.014;
    this.camera.position.set(
      this.position.x + bobX + shakeX,
      this.position.y + eyeHeight + bobY + shakeY,
      this.position.z,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(
      this.pitch + this.recoilPitch + shakeY * 0.4,
      this.yaw + this.recoilYaw + shakeX * 0.4,
      settings.reducedShake ? 0 : Math.sin(this.bobTime * 0.78) * bobAmount * 0.35,
    );
    const baseFov = settings.fov;
    const targetFov = this.isAiming
      ? Math.max(48, baseFov - 20)
      : this.isSprinting
        ? baseFov + 5
        : baseFov;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 12, delta);
    this.camera.updateProjectionMatrix();
  }

  addRecoil(amount: number, lateral: number): void {
    this.recoilPitch += amount;
    this.recoilYaw += lateral;
    this.cameraShake = Math.min(1, this.cameraShake + amount * 5);
  }

  damage(amount: number): number {
    const absorbed = Math.min(this.armor, amount * 0.62);
    this.armor -= absorbed;
    const healthDamage = amount - absorbed;
    this.health = Math.max(0, this.health - healthDamage);
    this.cameraShake = Math.min(1, this.cameraShake + 0.48);
    return healthDamage;
  }

  healAtCheckpoint(armor: number): void {
    this.health = Math.max(this.health, 82);
    this.armor = Math.max(this.armor, armor);
  }

  addSuppression(amount: number): void {
    this.suppression = Math.min(1, this.suppression + amount);
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  snapshot(): PlayerSnapshot {
    return {
      position: this.position.clone(),
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      armor: this.armor,
    };
  }

  restore(snapshot: PlayerSnapshot, allowDebugPosition = false): void {
    const position = allowDebugPosition || this.isInsidePlayableArea(snapshot.position)
      ? snapshot.position
      : this.spawn;
    this.position.copy(position);
    this.physics.teleportPlayer(position);
    // Debug teleports (setPlayerView) must not rewrite lastSafe, or a void
    // drop would become the new floor and defeat fall recovery.
    if (!allowDebugPosition && this.isInsidePlayableArea(position)) {
      this.lastSafePosition.copy(position);
    }
    this.yaw = snapshot.yaw;
    this.pitch = snapshot.pitch;
    this.health = snapshot.health;
    this.armor = snapshot.armor;
    this.suppression = 0;
    this.speed = 0;
  }

  reset(position = this.spawn): void {
    this.restore({
      position: position.clone(),
      yaw: 0,
      pitch: 0,
      health: 100,
      armor: 60,
    });
  }

  private updateModes(input: InputController, settings: AccessibilitySettings): void {
    if (settings.crouchMode === 'toggle') {
      if (input.consumePressed('KeyC') || input.consumePressed('ControlLeft')) {
        this.crouchToggle = !this.crouchToggle;
      }
    } else {
      this.crouchToggle = input.isDown('KeyC') || input.isDown('ControlLeft');
    }
    this.isCrouching = this.crouchToggle;

    if (settings.sprintMode === 'toggle') {
      if (
        input.consumePressed('ShiftLeft') ||
        input.consumePressed('ShiftRight')
      ) {
        this.sprintToggle = !this.sprintToggle;
      }
    } else {
      this.sprintToggle = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    }

    if (settings.aimMode === 'toggle') {
      if (input.wasMousePressed(2)) this.aimToggle = !this.aimToggle;
    } else {
      this.aimToggle = input.isMouseDown(2);
    }
  }

  wantsAim(): boolean {
    return this.aimToggle && !this.isSprinting;
  }

  /** Locomotion sample for first-person arms / weapon feel. */
  locomotionSample(): {
    speed: number;
    forward: number;
    strafe: number;
    sprinting: boolean;
    crouching: boolean;
  } {
    return {
      speed: this.speed,
      forward: this.moveAxisForward,
      strafe: this.moveAxisX,
      sprinting: this.isSprinting,
      crouching: this.isCrouching,
    };
  }

  private recoverVoidFallIfNeeded(): boolean {
    if (
      this.voidFallRecoveryMeters == null ||
      this.position.y >= this.lastSafePosition.y - this.voidFallRecoveryMeters
    ) {
      return false;
    }
    this.position.copy(this.lastSafePosition);
    this.physics.teleportPlayer(this.lastSafePosition);
    this.speed = 0;
    this.voidFallRecoveries += 1;
    this.splatContainment?.commitEntry(
      this.splatActorId,
      this.lastSafePosition,
      this.splatCapsuleRadius,
    );
    return true;
  }

  private isInsidePlayableArea(position: THREE.Vector3): boolean {
    if (this.splatContainment) {
      return this.splatContainment.containsActor(
        this.splatActorId,
        position,
        this.splatCapsuleRadius,
      );
    }
    if (!this.playableBounds) return true;
    return (
      position.x >= this.playableBounds.min.x &&
      position.x <= this.playableBounds.max.x &&
      position.z >= this.playableBounds.min.z &&
      position.z <= this.playableBounds.max.z &&
      position.y >= this.playableBounds.min.y &&
      position.y <= this.playableBounds.max.y
    );
  }
}
