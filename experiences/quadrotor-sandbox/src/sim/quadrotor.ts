import { Quaternion, Vector3 } from "three";
import { GRAVITY } from "../core/basis";
import { VEHICLE } from "./config";
import { thrustToOmega } from "./mixer";
import type { DroneState } from "./state";

/**
 * Six-degree-of-freedom rigid-body integrator for the aircraft.
 *
 * This is the authoritative flight model — Rapier never integrates the drone
 * while it is flying, it only supplies contacts and the world (see
 * `sim/crash.ts` for the handoff). Keeping the dynamics here means the
 * response is reproducible and the PID gains mean something physical.
 *
 * Scratch vectors are module-level so a 200 Hz loop allocates nothing.
 */

const worldForce = new Vector3();
const relativeAir = new Vector3();
const torque = new Vector3();
const inertiaTimesOmega = new Vector3();
const gyroscopic = new Vector3();
const spinQuat = new Quaternion();
const derivative = new Quaternion();

/**
 * Advance the aircraft by `dt` seconds.
 *
 * @param targetThrusts per-rotor thrust demand from the mixer, N
 * @param windVelocity  air velocity at the aircraft, m/s (world frame)
 */
export function stepDynamics(
  state: DroneState,
  targetThrusts: ArrayLike<number>,
  windVelocity: Vector3,
  dt: number,
) {
  const { mass, kf, km, motors, inertia } = VEHICLE;

  // --- Rotors -------------------------------------------------------------
  // Motors cannot change speed instantly. This first-order lag is most of what
  // separates a quad that feels like an aircraft from one that feels telepathic.
  const lag = 1 - Math.exp(-dt / VEHICLE.motorTau);
  let totalThrust = 0;
  for (let i = 0; i < 4; i += 1) {
    const target = thrustToOmega(targetThrusts[i]);
    const omega = state.motorOmega[i] + (target - state.motorOmega[i]) * lag;
    state.motorOmega[i] = omega;

    const thrust = kf * omega * omega;
    state.motorThrust[i] = thrust;
    totalThrust += thrust;

    state.motorAngle[i] =
      (state.motorAngle[i] + omega * dt * motors[i].spin) % (Math.PI * 2);
  }

  // --- Translation --------------------------------------------------------
  // Thrust acts along body +Y.
  worldForce.set(0, totalThrust, 0).applyQuaternion(state.orientation);
  worldForce.y -= mass * GRAVITY;

  // Drag is computed against the air, not the ground, so wind and gusts push
  // the aircraft through exactly the same term.
  relativeAir.copy(windVelocity).sub(state.velocity);
  const airSpeed = relativeAir.length();
  if (airSpeed > 1e-6) {
    worldForce.addScaledVector(relativeAir, VEHICLE.dragFactor * airSpeed);
  }

  // Semi-implicit Euler: velocity first, then position from the new velocity.
  state.velocity.addScaledVector(worldForce, dt / mass);
  state.position.addScaledVector(state.velocity, dt);

  // --- Rotation -----------------------------------------------------------
  // A rotor thrust f at body offset (x, 0, z) contributes torque (-z*f, 0, x*f),
  // plus a reaction torque about +Y opposing its own spin.
  let tx = 0;
  let ty = 0;
  let tz = 0;
  const yawPerNewton = km / kf;
  for (let i = 0; i < 4; i += 1) {
    const motor = motors[i];
    const f = state.motorThrust[i];
    tx += -motor.z * f;
    tz += motor.x * f;
    ty += -motor.spin * yawPerNewton * f;
  }
  torque.set(tx, ty, tz);

  const omega = state.angularVelocity;
  const rateMagnitude = omega.length();
  if (rateMagnitude > 1e-6) {
    torque.addScaledVector(omega, -VEHICLE.angularDragFactor * rateMagnitude);
  }

  // Euler's equation for a rigid body: I*omegaDot = tau - omega x (I*omega).
  inertiaTimesOmega.set(
    omega.x * inertia.x,
    omega.y * inertia.y,
    omega.z * inertia.z,
  );
  gyroscopic.copy(omega).cross(inertiaTimesOmega);

  omega.x += ((torque.x - gyroscopic.x) / inertia.x) * dt;
  omega.y += ((torque.y - gyroscopic.y) / inertia.y) * dt;
  omega.z += ((torque.z - gyroscopic.z) / inertia.z) * dt;

  // qDot = 0.5 * q (x) omega_body, so the rate quaternion multiplies on the right.
  spinQuat.set(omega.x * 0.5 * dt, omega.y * 0.5 * dt, omega.z * 0.5 * dt, 0);
  derivative.copy(state.orientation).multiply(spinQuat);
  state.orientation.set(
    state.orientation.x + derivative.x,
    state.orientation.y + derivative.y,
    state.orientation.z + derivative.z,
    state.orientation.w + derivative.w,
  );
  state.orientation.normalize();

  state.time += dt;
}

/**
 * Minimal ground contact for the pre-physics milestone: stop the aircraft at
 * the pad instead of falling through the world.
 *
 * Milestone 2 replaces this with real Rapier colliders and the crash handoff.
 * It is deliberately crude — it exists so the flight core can be flown and
 * tuned before the physics world lands, not to model landing gear.
 */
export function applyFlatGround(state: DroneState, groundY: number) {
  if (state.position.y > groundY) return false;

  state.position.y = groundY;
  if (state.velocity.y < 0) state.velocity.y = 0;

  // Friction against the pad while resting.
  state.velocity.x *= 0.85;
  state.velocity.z *= 0.85;
  state.angularVelocity.multiplyScalar(0.85);
  return true;
}
