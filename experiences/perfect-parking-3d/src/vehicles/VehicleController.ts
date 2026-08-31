import type { VehicleProfile } from './profiles';

/** Shared lot top — visuals and physics agree on this plane. */
export const FLOOR_SURFACE_Y = 0;

export type DrivePose = {
  x: number;
  z: number;
  yaw: number;
  /** Signed speed along heading (forward +). */
  speed: number;
  /** World velocity magnitude. */
  speedAbs: number;
  steerAngle: number;
  /** Body visual lean (rad): + = lean right in turns. */
  bodyRoll: number;
  /** Body visual pitch (rad): + = nose up under accel. */
  bodyPitch: number;
  yawRate: number;
};

/**
 * Dynamic bicycle car model:
 * - Throttle/brake apply longitudinal force in heading frame
 * - Steering sets front-wheel angle; yaw from lateral tire forces
 * - Velocity can slip sideways (understeer) then grip pulls it back
 * Feels like a car, tuned for a parking lot (not a highway sim).
 */
export class VehicleController {
  x = 0;
  z = 0;
  yaw = 0;
  /** World-space velocity. */
  vx = 0;
  vz = 0;
  yawRate = 0;
  steerAngle = 0;
  /** Smoothed throttle/brake pedals for engine inertia feel. */
  private throttlePedal = 0;
  private brakePedal = 0;
  bodyRoll = 0;
  bodyPitch = 0;

  reset(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.throttlePedal = 0;
    this.brakePedal = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
  }

  step(
    dt: number,
    profile: VehicleProfile,
    throttle: number,
    steerInput: number,
    brake: number,
  ): DrivePose {
    const h = Math.min(Math.max(dt, 0), 0.05);
    // Substep for stability when frame hitch spikes.
    const steps = h > 1 / 45 ? 2 : 1;
    const sub = h / steps;
    for (let i = 0; i < steps; i += 1) {
      this.simulate(sub, profile, throttle, steerInput, brake);
    }
    return this.pose();
  }

  pose(): DrivePose {
    const forward = this.forwardSpeed();
    return {
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      speed: forward,
      speedAbs: Math.hypot(this.vx, this.vz),
      steerAngle: this.steerAngle,
      bodyRoll: this.bodyRoll,
      bodyPitch: this.bodyPitch,
      yawRate: this.yawRate,
    };
  }

  /** Signed speed in the car's forward direction. */
  forwardSpeed(): number {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  resolveCollision(): void {
    // Kill most velocity into the obstacle; keep a little for feel.
    this.vx *= 0.15;
    this.vz *= 0.15;
    this.yawRate *= 0.35;
    if (Math.hypot(this.vx, this.vz) < 0.4) {
      this.vx = 0;
      this.vz = 0;
    }
  }

  private simulate(
    dt: number,
    profile: VehicleProfile,
    throttle: number,
    steerInput: number,
    brake: number,
  ): void {
    const throttleIn = clamp(throttle, -1, 1);
    const brakeIn = clamp(brake, 0, 1);
    // Negate: Three.js chase-cam projects driver-left to screen-right, so
    // raw bicycle yaw feels mirrored. Flip once here so A/← = screen-left.
    const steerIn = -clamp(steerInput, -1, 1);

    // Pedal lag — cars don't dump full force on frame 1, but parking needs snap.
    // Reverse gets a slightly snappier pedal so S/Rev engages from a stop.
    const throttleRate = throttleIn < 0 ? 20 : 14;
    this.throttlePedal = expSmooth(this.throttlePedal, throttleIn, throttleRate, dt);
    this.brakePedal = expSmooth(this.brakePedal, brakeIn, 18, dt);

    // Speed-limited steering: at speed you can't crank full lock as hard.
    const speedAbs = Math.hypot(this.vx, this.vz);
    const speedNorm = Math.min(1, speedAbs / Math.max(0.1, profile.maxSpeed));
    const maxSteerNow = profile.maxSteer * (1 - 0.45 * speedNorm * speedNorm);
    const steerTarget = steerIn * maxSteerNow;
    const steerRate = profile.steerResponse * (1.15 - 0.4 * speedNorm);
    this.steerAngle = moveToward(this.steerAngle, steerTarget, steerRate * dt);

    // Local velocity (car frame): +z forward, +x right.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    let localX = this.vx * c - this.vz * s; // right
    let localZ = this.vx * s + this.vz * c; // forward

    // --- Longitudinal forces ---
    let longForce = 0;
    if (this.brakePedal > 0.05) {
      // Brakes oppose motion (and hold when nearly stopped).
      if (Math.abs(localZ) > 0.08) {
        longForce -= Math.sign(localZ) * profile.brakeForce * this.brakePedal;
      } else {
        localZ = 0;
      }
    } else if (this.throttlePedal > 0.04) {
      const headroom = 1 - Math.max(0, localZ) / profile.maxSpeed;
      longForce += profile.engineForce * this.throttlePedal * Math.max(0.15, headroom);
    } else if (this.throttlePedal < -0.04) {
      // Reverse: brake while still rolling forward quickly; engage reverse sooner
      // so parking maneuvers don't feel stuck in engine-brake-only mode.
      if (localZ > 0.45) {
        longForce -= profile.brakeForce * 0.65 * Math.abs(this.throttlePedal);
      } else {
        const headroom = 1 - Math.min(0, localZ) / -profile.maxReverse;
        longForce += profile.reverseForce * this.throttlePedal * Math.max(0.4, headroom);
      }
    }

    // Rolling resistance + aero drag (always oppose velocity).
    const roll = profile.rollingResistance * profile.mass * 9.81;
    if (Math.abs(localZ) > 0.02) {
      longForce -= Math.sign(localZ) * roll;
    }
    longForce -= profile.drag * localZ * Math.abs(localZ) * 60;

    const longAccel = longForce / profile.mass;

    // Integrate longitudinal first so steer uses updated speed.
    localZ += longAccel * dt;
    if (localZ > profile.maxSpeed) localZ = profile.maxSpeed;
    if (localZ < -profile.maxReverse) localZ = -profile.maxReverse;
    if (Math.abs(localZ) < 0.03 && Math.abs(this.throttlePedal) < 0.04 && this.brakePedal < 0.05) {
      localZ = 0;
    }

    // --- Bicycle yaw (Ackermann): ω = v/L * tan(δ) ---
    // Primary turn rate — this is what makes the car point like a real car.
    const signedSpeed = localZ;
    const bicycleYaw =
      Math.abs(signedSpeed) > 0.04
        ? (signedSpeed / profile.wheelbase) * Math.tan(this.steerAngle)
        : 0;

    // Low-speed parking crawl: nudge yaw when creeping with lock.
    // Sign follows motion (or pedal when still starting) so reverse crawl
    // doesn't fight the bicycle model and cancel reverse turns.
    let crawlYaw = 0;
    if (Math.abs(signedSpeed) < 1.25 && Math.abs(this.steerAngle) > 0.05) {
      if (Math.abs(this.throttlePedal) > 0.04 || Math.abs(signedSpeed) > 0.12) {
        const crawlSign =
          Math.abs(signedSpeed) > 0.04
            ? Math.sign(signedSpeed)
            : Math.sign(this.throttlePedal) || 1;
        crawlYaw = crawlSign * this.steerAngle * (1.25 - Math.abs(signedSpeed)) * 0.85;
      }
    }

    const yawTarget = bicycleYaw + crawlYaw;
    const yawFollow = 9 + profile.steerResponse * 0.5;
    this.yawRate = expSmooth(this.yawRate, yawTarget, yawFollow, dt);
    this.yawRate = clamp(this.yawRate, -2.4, 2.4);
    this.yaw += this.yawRate * dt;

    // --- Lateral slip ---
    // Velocity is remapped through the updated yaw below, which already
    // rotates world velocity with the car (kinematic no-slip). Tire grip
    // only needs to kill leftover body-frame sideways speed — never chase
    // ω·v (that quantity is an acceleration, and produced huge crabbing).
    const gripRate = profile.tireGrip * profile.corneringStiffness * 0.55;
    localX *= Math.exp(-gripRate * dt);
    if (Math.abs(localX) < 0.02) localX = 0;

    // Back to world (local expressed in pre-yaw frame → apply new yaw).
    const c2 = Math.cos(this.yaw);
    const s2 = Math.sin(this.yaw);
    this.vx = localX * c2 + localZ * s2;
    this.vz = -localX * s2 + localZ * c2;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Visual body lean from accel (game feel, not full suspension).
    const targetRoll = clamp(-localX * 0.045 - this.yawRate * 0.08, -0.12, 0.12);
    const targetPitch = clamp(-longAccel * 0.012, -0.08, 0.08);
    this.bodyRoll = expSmooth(this.bodyRoll, targetRoll, 8, dt);
    this.bodyPitch = expSmooth(this.bodyPitch, targetPitch, 8, dt);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

function expSmooth(current: number, target: number, rate: number, dt: number): number {
  const k = 1 - Math.exp(-rate * dt);
  return current + (target - current) * k;
}
