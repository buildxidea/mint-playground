import * as THREE from 'three';
import { FLIGHT } from './config';

/** Normalized pilot command, every axis in [-1, 1]. */
export interface FlightCommand {
  throttle: number;
  pitch: number;
  roll: number;
  yaw: number;
}

export interface FlightEnv {
  /** Air-mass velocity the drone is coupled to, world space, m/s. */
  wind: THREE.Vector3;
  /** True while a package hangs under the drone. */
  carrying: boolean;
  /** True once the battery is empty: the drone sinks regardless of throttle. */
  batteryEmpty: boolean;
  /** Height of whatever surface is directly under the drone, world Y. */
  supportHeight: number;
  /** Distance from the body origin down to the skids. */
  groundClearance: number;
}

export type TouchdownKind = 'soft' | 'hard' | 'crash';

export interface FlightEvents {
  /** Set on the tick the drone touches a surface. */
  touchdown: { kind: TouchdownKind; speed: number } | null;
  liftoff: boolean;
}

export class FlightState {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  yawRate = 0;
  /** Body tilt angles, rad: tiltPitch leans the nose (+ forward), tiltRoll leans sideways. */
  tiltPitch = 0;
  tiltRoll = 0;
  tiltPitchVel = 0;
  tiltRollVel = 0;
  armed = false;
  landed = true;

  reset(position: THREE.Vector3, yaw: number): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.tiltPitch = 0;
    this.tiltRoll = 0;
    this.tiltPitchVel = 0;
    this.tiltRollVel = 0;
    this.armed = false;
    this.landed = true;
  }
}

const scratchAccel = new THREE.Vector3();

/**
 * Arcade stabilized flight: sticks command tilt and climb rate, a critically
 * damped spring chases the targets, and centring the sticks settles the drone
 * into a gentle hover. Deliberately forgiving — this is a delivery game, not
 * a rate-mode simulator.
 */
export function stepFlight(
  state: FlightState,
  cmd: FlightCommand,
  env: FlightEnv,
  dt: number,
): FlightEvents {
  const events: FlightEvents = { touchdown: null, liftoff: false };
  const floorY = env.supportHeight + env.groundClearance;

  if (state.landed) {
    state.position.y = floorY;
    state.velocity.set(0, 0, 0);
    decayTilt(state, dt);
    if (state.armed && !env.batteryEmpty && cmd.throttle > FLIGHT.liftoffThrottle) {
      state.landed = false;
      events.liftoff = true;
    }
    return events;
  }

  if (!state.armed) {
    // Disarmed in the air: fall with a bit of drag.
    state.velocity.y -= FLIGHT.gravity * dt;
    state.velocity.y = Math.max(state.velocity.y, -12);
    decayTilt(state, dt);
  } else {
    const accelScale = env.carrying ? FLIGHT.carryAccel : 1;
    const climbScale = env.carrying ? FLIGHT.carryClimb : 1;

    // Tilt springs chase the stick targets.
    const targetPitch = cmd.pitch * FLIGHT.maxTilt;
    const targetRoll = cmd.roll * FLIGHT.maxTilt;
    const w = FLIGHT.tiltResponse;
    state.tiltPitchVel += (w * w * (targetPitch - state.tiltPitch) - 2 * w * state.tiltPitchVel) * dt;
    state.tiltRollVel += (w * w * (targetRoll - state.tiltRoll) - 2 * w * state.tiltRollVel) * dt;
    state.tiltPitch += state.tiltPitchVel * dt;
    state.tiltRoll += state.tiltRollVel * dt;

    // Yaw rate follows the stick with a short lag.
    const targetYawRate = cmd.yaw * FLIGHT.maxYawRate;
    state.yawRate += ((targetYawRate - state.yawRate) / FLIGHT.yawTau) * dt;
    state.yaw += state.yawRate * dt;

    // Tilt produces horizontal acceleration in the heading frame.
    const forward = (state.tiltPitch / FLIGHT.maxTilt) * FLIGHT.maxAccel * accelScale;
    const side = (state.tiltRoll / FLIGHT.maxTilt) * FLIGHT.maxAccel * accelScale;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    scratchAccel.set(side * cos - forward * sin, 0, -forward * cos - side * sin);

    // Drag plus wind coupling toward the air-mass velocity.
    scratchAccel.x += -state.velocity.x * FLIGHT.drag + (env.wind.x - state.velocity.x) * FLIGHT.windCoupling;
    scratchAccel.z += -state.velocity.z * FLIGHT.drag + (env.wind.z - state.velocity.z) * FLIGHT.windCoupling;
    state.velocity.x += scratchAccel.x * dt;
    state.velocity.z += scratchAccel.z * dt;

    // Vertical speed tracks the throttle target.
    const targetVy = env.batteryEmpty
      ? FLIGHT.emptyBatterySink
      : cmd.throttle >= 0
        ? cmd.throttle * FLIGHT.maxClimb * climbScale
        : cmd.throttle * FLIGHT.maxDescend;
    state.velocity.y += ((targetVy - state.velocity.y) / FLIGHT.climbTau) * dt;
  }

  state.position.addScaledVector(state.velocity, dt);

  // Touchdown against the supporting surface.
  if (state.position.y <= floorY && state.velocity.y <= 0) {
    const speed = -state.velocity.y;
    state.position.y = floorY;
    state.landed = true;
    state.velocity.set(0, 0, 0);
    const kind: TouchdownKind =
      speed > FLIGHT.hardLanding ? 'crash' : speed > FLIGHT.softLanding ? 'hard' : 'soft';
    events.touchdown = { kind, speed };
  }

  return events;
}

function decayTilt(state: FlightState, dt: number): void {
  const k = Math.exp(-6 * dt);
  state.tiltPitch *= k;
  state.tiltRoll *= k;
  state.yawRate *= k;
}
