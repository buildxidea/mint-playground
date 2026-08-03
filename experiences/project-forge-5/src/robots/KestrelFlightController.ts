import * as THREE from 'three';

export type KestrelFlightInput = Readonly<{
  localRight: number;
  localForward: number;
  vertical: number;
  yaw: number;
  maxHorizontalSpeed: number;
  maxVerticalSpeed: number;
  maxYawRate: number;
}>;

export type KestrelFlightPresentation = Readonly<{
  velocity: Readonly<{ x: number; y: number; z: number }>;
  yawRate: number;
  roll: number;
  pitch: number;
  thrustRatio: number;
}>;

export type KestrelFlightStep = Readonly<{
  velocity: THREE.Vector3;
  yawDelta: number;
  presentation: KestrelFlightPresentation;
}>;

const HORIZONTAL_ACCELERATION = 5.4;
const HORIZONTAL_BRAKING = 7.2;
const VERTICAL_ACCELERATION = 4.8;
const VERTICAL_BRAKING = 6.6;
const YAW_ACCELERATION = 4.8;
const YAW_BRAKING = 6.4;
const MAX_BANK_RADIANS = THREE.MathUtils.degToRad(19);
const ATTITUDE_RESPONSE = 7.5;

/**
 * Deterministic velocity-level flight model for KESTREL. Rapier still owns
 * collision resolution; this controller owns thrust inertia and presentation.
 */
export class KestrelFlightController {
  private readonly velocity = new THREE.Vector3();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly previousVelocity = new THREE.Vector3();
  private readonly acceleration = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private yawRate = 0;
  private roll = 0;
  private pitch = 0;
  private thrustRatio = 0.58;

  step(fixedDt: number, yawRadians: number, input: KestrelFlightInput): KestrelFlightStep {
    const dt = Number.isFinite(fixedDt) && fixedDt > 0 ? Math.min(fixedDt, 0.05) : 1 / 60;
    this.previousVelocity.copy(this.velocity);
    this.forward.set(-Math.sin(yawRadians), 0, -Math.cos(yawRadians));
    this.right.set(Math.cos(yawRadians), 0, -Math.sin(yawRadians));

    this.targetVelocity
      .copy(this.forward)
      .multiplyScalar(THREE.MathUtils.clamp(input.localForward, -1, 1) * input.maxHorizontalSpeed)
      .addScaledVector(
        this.right,
        THREE.MathUtils.clamp(input.localRight, -1, 1) * input.maxHorizontalSpeed,
      );
    const horizontalTargetLength = Math.hypot(this.targetVelocity.x, this.targetVelocity.z);
    if (horizontalTargetLength > input.maxHorizontalSpeed) {
      const scale = input.maxHorizontalSpeed / horizontalTargetLength;
      this.targetVelocity.x *= scale;
      this.targetVelocity.z *= scale;
    }
    this.targetVelocity.y = THREE.MathUtils.clamp(input.vertical, -1, 1) * input.maxVerticalSpeed;

    const hasHorizontalCommand =
      Math.abs(input.localForward) > 0.001 || Math.abs(input.localRight) > 0.001;
    const horizontalRate =
      (hasHorizontalCommand ? HORIZONTAL_ACCELERATION : HORIZONTAL_BRAKING) * dt;
    const horizontalDelta = new THREE.Vector2(
      this.targetVelocity.x - this.velocity.x,
      this.targetVelocity.z - this.velocity.z,
    );
    if (horizontalDelta.length() > horizontalRate) horizontalDelta.setLength(horizontalRate);
    this.velocity.x += horizontalDelta.x;
    this.velocity.z += horizontalDelta.y;

    const verticalRate =
      (Math.abs(input.vertical) > 0.001 ? VERTICAL_ACCELERATION : VERTICAL_BRAKING) * dt;
    this.velocity.y = moveTowards(this.velocity.y, this.targetVelocity.y, verticalRate);

    const targetYawRate = THREE.MathUtils.clamp(input.yaw, -1, 1) * Math.max(0, input.maxYawRate);
    const yawRateChange = (Math.abs(input.yaw) > 0.001 ? YAW_ACCELERATION : YAW_BRAKING) * dt;
    this.yawRate = moveTowards(this.yawRate, targetYawRate, yawRateChange);

    this.acceleration
      .copy(this.velocity)
      .sub(this.previousVelocity)
      .multiplyScalar(1 / dt);
    const rightAcceleration = this.acceleration.dot(this.right);
    const forwardAcceleration = this.acceleration.dot(this.forward);
    const targetRoll = THREE.MathUtils.clamp(
      -rightAcceleration / 9.81,
      -MAX_BANK_RADIANS,
      MAX_BANK_RADIANS,
    );
    const targetPitch = THREE.MathUtils.clamp(
      forwardAcceleration / 9.81,
      -MAX_BANK_RADIANS,
      MAX_BANK_RADIANS,
    );
    const attitudeAlpha = 1 - Math.exp(-ATTITUDE_RESPONSE * dt);
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, attitudeAlpha);
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, attitudeAlpha);
    this.thrustRatio = THREE.MathUtils.clamp(
      0.58 +
        this.acceleration.y / 9.81 +
        (Math.hypot(this.acceleration.x, this.acceleration.z) / 9.81) * 0.16,
      0.34,
      1,
    );

    return {
      velocity: this.velocity.clone(),
      yawDelta: this.yawRate * dt,
      presentation: this.presentation,
    };
  }

  reconcileResolvedVelocity(resolvedVelocity: THREE.Vector3): void {
    if ([resolvedVelocity.x, resolvedVelocity.y, resolvedVelocity.z].every(Number.isFinite)) {
      this.velocity.copy(resolvedVelocity);
    }
  }

  reset(): void {
    this.velocity.set(0, 0, 0);
    this.targetVelocity.set(0, 0, 0);
    this.previousVelocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.yawRate = 0;
    this.roll = 0;
    this.pitch = 0;
    this.thrustRatio = 0.58;
  }

  get presentation(): KestrelFlightPresentation {
    return {
      velocity: {
        x: this.velocity.x,
        y: this.velocity.y,
        z: this.velocity.z,
      },
      yawRate: this.yawRate,
      roll: this.roll,
      pitch: this.pitch,
      thrustRatio: this.thrustRatio,
    };
  }
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}
