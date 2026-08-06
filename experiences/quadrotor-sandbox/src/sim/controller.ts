import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { GRAVITY } from "../core/basis";
import {
  LIMITS,
  MAX_ROTOR_THRUST,
  VEHICLE,
  cloneGains,
  type GainPresetId,
  type GainSet,
} from "./config";
import type { MixerDemand } from "./mixer";
import { Pid } from "./pid";
import { tiltCosine, type DroneState } from "./state";

/**
 * Normalized pilot input.
 *
 * Roll and pitch follow aircraft convention: positive pitch is nose *up*, so
 * in position mode a positive pitch stick commands rearward travel. Throttle
 * is stateful (0..1) rather than self-centring, matching a real transmitter —
 * it stays where the pilot left it.
 */
export interface Sticks {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

/** Telemetry from the last controller update, for the HUD and the plots. */
export interface ControllerTelemetry {
  rateSetpoint: Vector3;
  velocitySetpoint: Vector3;
  climbSetpoint: number;
  tiltDemand: number;
  holding: boolean;
}

const STICK_DEADBAND = 0.06;
const THROTTLE_CENTER = 0.5;
const THROTTLE_DEADBAND = 0.08;

/** Full-authority collective, N. */
const MAX_COLLECTIVE = 4 * MAX_ROTOR_THRUST;

function deadband(value: number, width: number) {
  if (Math.abs(value) <= width) return 0;
  return (value - Math.sign(value) * width) / (1 - width);
}

function wrapAngle(angle: number) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Cascaded flight controller.
 *
 *   position -> velocity -> acceleration -> attitude -> body rate -> torque
 *
 * Each flight mode enters the cascade at a different depth: acro drives the
 * rate loop directly, stabilized enters at attitude, and position hold runs
 * the whole chain. Flying the same airframe in all three is the clearest way
 * to feel what each outer loop is contributing.
 */
export class FlightController {
  gains: GainSet;

  readonly telemetry: ControllerTelemetry = {
    rateSetpoint: new Vector3(),
    velocitySetpoint: new Vector3(),
    climbSetpoint: 0,
    tiltDemand: 0,
    holding: false,
  };

  private ratePitch: Pid;
  private rateYaw: Pid;
  private rateRoll: Pid;
  private velocityX: Pid;
  private velocityZ: Pid;
  private climb: Pid;

  private yawSetpoint = 0;
  private readonly holdPosition = new Vector3();
  private holdAltitude = 0;

  // Scratch — the controller runs 200 times a second and allocates nothing.
  private readonly desiredUp = new Vector3();
  private readonly accelCommand = new Vector3();
  private readonly rateSetpoint = new Vector3();
  private readonly noseAxis = new Vector3();
  private readonly rightAxis = new Vector3();
  private readonly backAxis = new Vector3();
  private readonly errorVector = new Vector3();
  private readonly desiredOrientation = new Quaternion();
  private readonly orientationError = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, "YXZ");
  private readonly basis = new Matrix4();

  constructor(preset: GainPresetId = "stable") {
    this.gains = cloneGains(preset);

    const { maxTorque } = LIMITS;
    this.ratePitch = new Pid(this.gains.rate.pitch, {
      integralLimit: maxTorque.pitch * 0.35,
      outputLimit: maxTorque.pitch,
      derivativeCutoffHz: 40,
    });
    this.rateRoll = new Pid(this.gains.rate.roll, {
      integralLimit: maxTorque.roll * 0.35,
      outputLimit: maxTorque.roll,
      derivativeCutoffHz: 40,
    });
    this.rateYaw = new Pid(this.gains.rate.yaw, {
      integralLimit: maxTorque.yaw * 0.35,
      outputLimit: maxTorque.yaw,
      derivativeCutoffHz: 40,
    });

    const maxHorizontalAccel = Math.tan(LIMITS.maxTilt) * GRAVITY;
    this.velocityX = new Pid(this.gains.horizontalVelocity, {
      integralLimit: maxHorizontalAccel * 0.5,
      outputLimit: maxHorizontalAccel,
    });
    this.velocityZ = new Pid(this.gains.horizontalVelocity, {
      integralLimit: maxHorizontalAccel * 0.5,
      outputLimit: maxHorizontalAccel,
    });
    this.climb = new Pid(this.gains.verticalVelocity, {
      integralLimit: GRAVITY * 0.6,
      outputLimit: GRAVITY * 1.5,
    });
  }

  /** Adopt a new gain set, rebinding every loop to the new numbers. */
  applyGains(gains: GainSet) {
    this.gains = gains;
    this.ratePitch.gains = gains.rate.pitch;
    this.rateRoll.gains = gains.rate.roll;
    this.rateYaw.gains = gains.rate.yaw;
    this.velocityX.gains = gains.horizontalVelocity;
    this.velocityZ.gains = gains.horizontalVelocity;
    this.climb.gains = gains.verticalVelocity;
  }

  /**
   * Clear every accumulator and re-anchor the hold targets to the aircraft.
   *
   * @param holdAltitude Optional altitude to hold instead of the aircraft's
   *   current height. Passing one turns arming into a takeoff: the altitude
   *   loop immediately has somewhere to climb to. Omit it to hold station
   *   wherever the aircraft already is, which is what every other caller wants.
   */
  reset(state: DroneState, holdAltitude?: number) {
    this.ratePitch.reset();
    this.rateRoll.reset();
    this.rateYaw.reset();
    this.velocityX.reset();
    this.velocityZ.reset();
    this.climb.reset();

    this.euler.setFromQuaternion(state.orientation, "YXZ");
    this.yawSetpoint = this.euler.y;
    this.holdPosition.copy(state.position);
    this.holdAltitude = holdAltitude ?? state.position.y;
  }

  update(state: DroneState, sticks: Sticks, dt: number): MixerDemand {
    if (!state.armed || state.crashed) {
      this.telemetry.holding = false;
      return { thrust: 0, pitch: 0, yaw: 0, roll: 0 };
    }

    const roll = deadband(sticks.roll, STICK_DEADBAND);
    const pitch = deadband(sticks.pitch, STICK_DEADBAND);
    const yaw = deadband(sticks.yaw, STICK_DEADBAND);

    let thrust: number;

    if (state.mode === "acro") {
      // Straight to the inner loop: sticks *are* the rate setpoint.
      this.rateSetpoint.set(
        pitch * LIMITS.maxRate.pitch,
        yaw * LIMITS.maxRate.yaw,
        -roll * LIMITS.maxRate.roll,
      );
      thrust = sticks.throttle * MAX_COLLECTIVE;
      this.telemetry.holding = false;
      this.telemetry.tiltDemand = 0;
    } else {
      this.yawSetpoint = wrapAngle(
        this.yawSetpoint + yaw * LIMITS.maxRate.yaw * dt,
      );

      if (state.mode === "stabilized") {
        // Sticks command a tilt; the aircraft returns to level when centred.
        this.euler.set(
          pitch * LIMITS.maxTilt,
          this.yawSetpoint,
          -roll * LIMITS.maxTilt,
          "YXZ",
        );
        this.desiredUp.set(0, 1, 0).applyEuler(this.euler);
        thrust = sticks.throttle * MAX_COLLECTIVE;
        this.telemetry.holding = false;
        this.telemetry.tiltDemand = Math.hypot(pitch, roll) * LIMITS.maxTilt;
      } else {
        thrust = this.updatePositionMode(state, roll, pitch, sticks.throttle, dt);
      }

      this.solveAttitude(state);
    }

    this.telemetry.rateSetpoint.copy(this.rateSetpoint);

    const omega = state.angularVelocity;
    return {
      thrust,
      pitch: this.ratePitch.update(this.rateSetpoint.x, omega.x, dt),
      yaw: this.rateYaw.update(this.rateSetpoint.y, omega.y, dt),
      roll: this.rateRoll.update(this.rateSetpoint.z, omega.z, dt),
    };
  }

  /**
   * Full outer cascade. Sticks command velocity; centred sticks hand over to a
   * position hold anchored wherever the aircraft was when they centred.
   */
  private updatePositionMode(
    state: DroneState,
    roll: number,
    pitch: number,
    throttle: number,
    dt: number,
  ): number {
    const sin = Math.sin(this.yawSetpoint);
    const cos = Math.cos(this.yawSetpoint);
    this.noseAxis.set(-sin, 0, -cos);
    this.rightAxis.set(cos, 0, -sin);

    const setpoint = this.telemetry.velocitySetpoint;
    const commanding = Math.hypot(roll, pitch) > 0;

    if (commanding) {
      // Nose-up stick flies backwards, so the forward term is negated.
      setpoint
        .copy(this.rightAxis)
        .multiplyScalar(roll * LIMITS.maxSpeed)
        .addScaledVector(this.noseAxis, -pitch * LIMITS.maxSpeed);
      this.holdPosition.copy(state.position);
    } else {
      // Position hold: outer P on position error, clamped to a sane speed.
      setpoint
        .subVectors(this.holdPosition, state.position)
        .multiplyScalar(this.gains.positionKp);
      setpoint.y = 0;
      if (setpoint.length() > LIMITS.maxSpeed) {
        setpoint.setLength(LIMITS.maxSpeed);
      }
    }
    this.telemetry.holding = !commanding;

    const climbStick = deadband(
      (throttle - THROTTLE_CENTER) * 2,
      THROTTLE_DEADBAND,
    );
    let climbSetpoint: number;
    if (climbStick !== 0) {
      climbSetpoint = climbStick * LIMITS.maxClimbRate;
      this.holdAltitude = state.position.y;
    } else {
      climbSetpoint = Math.max(
        -LIMITS.maxClimbRate,
        Math.min(
          LIMITS.maxClimbRate,
          (this.holdAltitude - state.position.y) * this.gains.altitudeKp,
        ),
      );
    }
    setpoint.y = climbSetpoint;
    this.telemetry.climbSetpoint = climbSetpoint;

    this.accelCommand.set(
      this.velocityX.update(setpoint.x, state.velocity.x, dt),
      this.climb.update(climbSetpoint, state.velocity.y, dt),
      this.velocityZ.update(setpoint.z, state.velocity.z, dt),
    );

    // The thrust axis must point along gravity-plus-demanded-acceleration.
    this.desiredUp
      .set(this.accelCommand.x, GRAVITY + this.accelCommand.y, this.accelCommand.z)
      .normalize();

    // Clamp the commanded tilt so an aggressive velocity error cannot ask for
    // an attitude that trades away all of the lift.
    const cosTilt = this.desiredUp.y;
    const minCos = Math.cos(LIMITS.maxTilt);
    if (cosTilt < minCos) {
      const horizontal = Math.hypot(this.desiredUp.x, this.desiredUp.z);
      const allowed = Math.sin(LIMITS.maxTilt);
      if (horizontal > 1e-6) {
        const k = allowed / horizontal;
        this.desiredUp.x *= k;
        this.desiredUp.z *= k;
      }
      this.desiredUp.y = minCos;
      this.desiredUp.normalize();
    }
    this.telemetry.tiltDemand = Math.acos(
      Math.max(-1, Math.min(1, this.desiredUp.y)),
    );

    // Vertical acceleration is only achieved along body up, so divide out the
    // current tilt. Floored so an upset attitude cannot demand infinite thrust.
    const lean = Math.max(tiltCosine(state), 0.5);
    return (VEHICLE.mass * (GRAVITY + this.accelCommand.y)) / lean;
  }

  /**
   * Attitude loop. Builds the desired orientation from the demanded thrust
   * axis plus the yaw setpoint, then converts the quaternion error into a body
   * rate setpoint.
   *
   * Working in quaternions rather than Euler angles keeps the loop well-behaved
   * at large bank angles, where roll/pitch/yaw decomposition starts to fight
   * itself.
   */
  private solveAttitude(state: DroneState) {
    const sin = Math.sin(this.yawSetpoint);
    const cos = Math.cos(this.yawSetpoint);
    this.noseAxis.set(-sin, 0, -cos);

    // Orthonormal basis around the demanded up axis: right = up x back.
    this.backAxis.copy(this.noseAxis).negate();
    this.rightAxis.crossVectors(this.desiredUp, this.backAxis);
    if (this.rightAxis.lengthSq() < 1e-8) {
      // Thrust axis is parallel to the heading reference (pointed straight at
      // the horizon); any perpendicular will do.
      this.rightAxis.set(cos, 0, -sin);
    }
    this.rightAxis.normalize();
    this.backAxis.crossVectors(this.rightAxis, this.desiredUp).normalize();

    this.desiredOrientation.setFromRotationMatrix(
      this.basis.makeBasis(this.rightAxis, this.desiredUp, this.backAxis),
    );

    // Error expressed in the body frame: q_err = q_current^-1 * q_desired.
    this.orientationError
      .copy(state.orientation)
      .conjugate()
      .multiply(this.desiredOrientation);

    // Take the short way round.
    if (this.orientationError.w < 0) {
      this.orientationError.set(
        -this.orientationError.x,
        -this.orientationError.y,
        -this.orientationError.z,
        -this.orientationError.w,
      );
    }

    const w = Math.max(-1, Math.min(1, this.orientationError.w));
    const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
    if (sinHalf < 1e-6) {
      this.errorVector.set(0, 0, 0);
    } else {
      const angle = 2 * Math.acos(w);
      this.errorVector
        .set(
          this.orientationError.x,
          this.orientationError.y,
          this.orientationError.z,
        )
        .multiplyScalar(angle / sinHalf);
    }

    this.rateSetpoint.copy(this.errorVector).multiplyScalar(this.gains.attitudeKp);
    this.rateSetpoint.x = clampAxis(this.rateSetpoint.x, LIMITS.maxRate.pitch);
    this.rateSetpoint.y = clampAxis(this.rateSetpoint.y, LIMITS.maxRate.yaw);
    this.rateSetpoint.z = clampAxis(this.rateSetpoint.z, LIMITS.maxRate.roll);
  }
}

function clampAxis(value: number, limit: number) {
  return value > limit ? limit : value < -limit ? -limit : value;
}
