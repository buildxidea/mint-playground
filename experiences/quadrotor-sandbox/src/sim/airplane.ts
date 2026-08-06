import { Quaternion, Vector3 } from "three";
import { AIR_DENSITY, GRAVITY } from "../core/basis";
import type { DroneState } from "./state";

/**
 * Fixed-wing flight model.
 *
 * A different regime from the quadrotor, not a reskin of it: lift comes from
 * airspeed and angle of attack, control surfaces only bite when air is moving
 * over them, and flying too slowly stalls the wing instead of just sinking.
 * There is no PID cascade here at all — a statically stable airframe (tail
 * behind the wing, fin behind the mass) is its own controller, which is why
 * the stick maps directly to surface deflection the way a real RC transmitter
 * does.
 *
 * Shares the canonical aircraft state with the quad: position, velocity,
 * orientation and body rates mean the same thing, and the rotor arrays carry
 * the single propeller (all four slots hold the same value so the RPM-driven
 * audio keeps working unchanged).
 *
 * Body frame per `core/basis.ts`: nose -Z, up +Y, right +X. Positive body
 * rates: pitch up about +X, yaw left about +Y, roll LEFT about +Z — so a
 * roll-right stick maps to a negative Z torque, matching the quad's
 * convention exactly.
 */

export interface PlaneConfig {
  /** Mass, kg. */
  mass: number;
  /** Wing area, m^2. */
  wingArea: number;
  /** Wingspan, m. */
  span: number;
  /** Mean chord, m. */
  chord: number;
  /** Diagonal body-frame inertia: x = pitch, y = yaw, z = roll axes. kg m^2. */
  inertia: { x: number; y: number; z: number };
  /** Lift curve: CL = cl0 + clAlpha * alpha, up to the stall break. */
  cl0: number;
  clAlpha: number;
  /** Stall break angle, radians. Past it the wing lets go progressively. */
  alphaStall: number;
  /** Parasitic and induced drag: CD = cd0 + kInduced * CL^2. */
  cd0: number;
  kInduced: number;
  /** Static pitch stability (negative), trim offset, pitch damping. */
  cm0: number;
  cmAlpha: number;
  cmQ: number;
  /** Elevator authority per unit stick. */
  cmElevator: number;
  /** Roll: damping, aileron authority, dihedral response to sideslip. */
  clP: number;
  clAileron: number;
  clBeta: number;
  /** Yaw: weathervane stiffness, damping, rudder authority (our axes). */
  cnBeta: number;
  cnR: number;
  cnRudder: number;
  /** Side force per radian of sideslip (negative opposes the slip). */
  cyBeta: number;
  /** Static thrust, N, fading linearly to zero at `thrustFadeSpeed` m/s. */
  maxThrust: number;
  thrustFadeSpeed: number;
  /** Propeller speed at full throttle (rad/s) and its spin-up lag (s). */
  maxPropOmega: number;
  propTau: number;
  /** Rolling resistance coefficient on the ground. */
  rollingFriction: number;
}

/**
 * An RC-class bush plane, sized to share a world with the 10-inch quad:
 * 1.8 m span, 2.2 kg, stalls near 7 m/s, trims hands-off around 12 m/s, and
 * tops out under 20. Authority numbers were chosen for ~160°/s peak roll and
 * ~90°/s pitch at cruise — sport-RC feel, forgiving on a keyboard.
 */
export const PLANE: PlaneConfig = {
  mass: 2.2,
  wingArea: 0.45,
  span: 1.8,
  chord: 0.28,
  inertia: { x: 0.2, y: 0.5, z: 0.35 },
  cl0: 0.3,
  clAlpha: 4.6,
  alphaStall: 0.3,
  cd0: 0.055,
  kInduced: 0.062,
  cm0: 0.045,
  cmAlpha: -0.9,
  cmQ: -11,
  cmElevator: 0.18,
  clP: -0.45,
  clAileron: 0.09,
  clBeta: 0.06,
  cnBeta: -0.06,
  cnR: -0.12,
  cnRudder: 0.025,
  cyBeta: -0.3,
  maxThrust: 9,
  thrustFadeSpeed: 40,
  maxPropOmega: 900,
  propTau: 0.12,
  rollingFriction: 0.05,
};

/**
 * A supersonic delta-wing reconnaissance jet: ~3.2 m long, 1.6 m span, 6 kg,
 * and roughly four times the bush plane's top speed (~74 m/s against ~18).
 *
 * The numbers are not the bush plane's scaled up — a fast aircraft is a
 * different design point, and two of these differences matter more than size:
 *
 * - **Thrust holds at speed.** `thrustFadeSpeed` is 220 rather than 40, so
 *   the engines keep pushing where a propeller would have run out of pitch.
 *   Solving thrust against drag puts the top speed near 74 m/s.
 * - **Control coefficients are far smaller.** Dynamic pressure rises with the
 *   square of airspeed, so at 60 m/s this airframe sees ~25x the bush plane's
 *   q. Keeping the plane's control powers would make full stick worth ~114
 *   rad/s^2 in pitch — an unflyable snap. Shrinking them (elevator 0.18 ->
 *   0.032, aileron 0.09 -> 0.012) lands steady rates near 24 deg/s in pitch
 *   and 115 deg/s in roll at cruise, which reads as a heavy, fast aircraft
 *   rather than a twitchy one.
 *
 * The delta wing also carries a low lift-curve slope and a high stall angle,
 * so it flies at very low angle of attack when fast and needs real speed to
 * stay up: stall is around 10 m/s and it is happiest well above 40.
 */
export const JET: PlaneConfig = {
  mass: 6,
  wingArea: 0.9,
  span: 1.6,
  chord: 0.8,
  inertia: { x: 2.5, y: 3, z: 0.9 },
  // Trimmed for the speed this aircraft actually flies at. A cambered wing's
  // `cl0` that suits 12 m/s produces about five times the needed lift at
  // 65 m/s: the jet balloons, trades all its speed for height, and never gets
  // anywhere near its top speed. Flat camber plus a very small nose-up moment
  // puts hands-off trim near 65 m/s — it sinks slowly below that and climbs
  // above it, which is how a fast aircraft should behave.
  cl0: 0.02,
  clAlpha: 3.2,
  alphaStall: 0.42,
  cd0: 0.02,
  kInduced: 0.09,
  cm0: 0.0009,
  cmAlpha: -0.55,
  cmQ: -11,
  cmElevator: 0.032,
  clP: -0.45,
  clAileron: 0.012,
  clBeta: 0.03,
  cnBeta: -0.05,
  cnR: -0.14,
  cnRudder: 0.01,
  cyBeta: -0.28,
  maxThrust: 90,
  thrustFadeSpeed: 220,
  // No visible propeller: the rotor arrays carry turbine spool speed, which
  // drives the afterburner plumes and the RPM-linked audio.
  maxPropOmega: 900,
  propTau: 0.9,
  rollingFriction: 0.03,
};

/** Stick input for the plane. Same physical sticks as the quad, new meaning. */
export interface PlaneControls {
  /** Aileron: positive rolls right. */
  roll: number;
  /** Elevator: positive pitches the nose up. */
  pitch: number;
  /** Rudder: positive yaws the nose left (quad yaw convention). */
  yaw: number;
  /** 0..1, stateful like a transmitter throttle. */
  throttle: number;
}

/**
 * A stealth flying wing, sized to fly the same city as the others: 2.6 m
 * span — the widest of the four — and the heaviest at 9 kg.
 *
 * The interesting numbers are the ones that are *unlike* the jet, because a
 * flying wing is close to its aerodynamic opposite:
 *
 *   inertia   The jet is a needle: heavy in pitch and yaw, light in roll. A
 *             flying wing puts its mass out along the span, so this is
 *             inverted — it pitches readily and rolls reluctantly.
 *   cnBeta    Weathervane stiffness. This aircraft has no vertical fin at all,
 *             so it is a quarter of the jet's: it barely points itself into
 *             the airflow. The real thing needs a computer to stay pointed,
 *             and the strong `cnR` damping below stands in for that yaw
 *             damper — without it the aircraft wanders unflyably on a
 *             keyboard, and with a stiff `cnBeta` instead it would not be a
 *             flying wing.
 *   cmAlpha   Pitch stability comes from a tail arm this aircraft does not
 *             have, so it is weaker than either of the other airframes.
 *   cd0       Nothing hangs off it. The lowest parasitic drag in the sim,
 *             which is what lets a subsonic wing carry 9 kg at 40 m/s.
 *
 * Trim and top speed are measured in `test/airplane.test.ts`, not asserted
 * here — the jet's numbers were wrong for a week because they were reasoned
 * about rather than flown.
 */
export const BOMBER: PlaneConfig = {
  mass: 9,
  // Aspect ratio 5.7, matching the real aircraft's planform.
  wingArea: 1.18,
  span: 2.6,
  chord: 0.45,
  inertia: { x: 1.2, y: 4, z: 3.5 },
  cl0: 0.05,
  clAlpha: 3.6,
  alphaStall: 0.35,
  cd0: 0.014,
  kInduced: 0.065,
  cm0: 0.003,
  cmAlpha: -0.35,
  cmQ: -9,
  // Elevons: one surface doing both jobs, on a wing with a lot of roll inertia.
  cmElevator: 0.045,
  clP: -0.5,
  clAileron: 0.022,
  clBeta: 0.02,
  cnBeta: -0.015,
  cnR: -0.3,
  // Drag rudders — split surfaces at the wingtips, not a rudder.
  cnRudder: 0.012,
  cyBeta: -0.25,
  maxThrust: 70,
  thrustFadeSpeed: 90,
  // Four buried turbofans: no visible fan, but the spool speed still drives
  // the RPM-linked audio. They take their time coming up.
  maxPropOmega: 900,
  propTau: 1.4,
  rollingFriction: 0.035,
};

/** What the ground contact looked like this step, for the crash policy. */
export interface GroundContact {
  grounded: boolean;
  /** Descent rate at the moment the clamp engaged, m/s (>= 0). */
  sinkSpeed: number;
  /** Terrain gradient magnitude at the contact point (0 = level runway). */
  slope: number;
  /** Ground speed at contact, m/s. */
  groundSpeed: number;
}

const contact: GroundContact = {
  grounded: false,
  sinkSpeed: 0,
  slope: 0,
  groundSpeed: 0,
};

// Scratch vectors, module-level like the quad integrator: the 200 Hz loop
// allocates nothing.
const relAirWorld = new Vector3();
const relAirBody = new Vector3();
const invOrientation = new Quaternion();
const forceWorld = new Vector3();
const liftDir = new Vector3();
const bodyUpWorld = new Vector3();
const relAirHat = new Vector3();
const bodyRightWorld = new Vector3();
const noseWorld = new Vector3();
const torque = new Vector3();
const inertiaTimesOmega = new Vector3();
const gyroscopic = new Vector3();
const spinQuat = new Quaternion();
const derivative = new Quaternion();

/** Ground height sampler. The metropolitan world is flat at zero. */
const FLAT_GROUND = () => 0;

export interface AirplaneOptions {
  /** Airframe to fly. Defaults to the bush plane. */
  config?: PlaneConfig;
  /**
   * Terrain height sampler; defaults to a flat world. Buildings and obstacles
   * are not ground — they collide through Rapier and reach the crash policy
   * as scenery contacts.
   */
  groundHeightAt?: (x: number, z: number) => number;
}

/**
 * Advance a fixed-wing aircraft by `dt` seconds and report ground contact.
 *
 * The airframe is a parameter, not a constant: the bush plane and the
 * supersonic jet are the same aerodynamics with different numbers, so they
 * share this integrator rather than duplicating it. An options object rather
 * than more positional parameters — the signature was already at five.
 *
 * @param gearClearance height of the body origin above the ground when the
 *   wheels are on it, metres (measured from the assembled rig).
 */
export function stepAirplane(
  state: DroneState,
  controls: PlaneControls,
  windVelocity: Vector3,
  gearClearance: number,
  dt: number,
  options: AirplaneOptions = {},
): GroundContact {
  const c = options.config ?? PLANE;
  const groundHeightAt = options.groundHeightAt ?? FLAT_GROUND;

  // --- Propeller -----------------------------------------------------------
  const lag = 1 - Math.exp(-dt / c.propTau);
  const targetOmega = (state.armed ? controls.throttle : 0) * c.maxPropOmega;
  const omega = state.motorOmega[0] + (targetOmega - state.motorOmega[0]) * lag;
  state.motorOmega.fill(omega);
  state.motorAngle[0] = (state.motorAngle[0] + omega * dt) % (Math.PI * 2);

  // --- Air data ------------------------------------------------------------
  relAirWorld.copy(state.velocity).sub(windVelocity);
  invOrientation.copy(state.orientation).conjugate();
  relAirBody.copy(relAirWorld).applyQuaternion(invOrientation);

  const forwardSpeed = -relAirBody.z;
  const airspeed = relAirWorld.length();

  // Angle of attack and sideslip only mean anything with air moving mostly
  // nose-first over the airframe.
  let alpha = 0;
  let beta = 0;
  if (forwardSpeed > 0.5) {
    alpha = Math.atan2(-relAirBody.y, forwardSpeed);
    beta = Math.atan2(relAirBody.x, forwardSpeed);
  }

  const q = 0.5 * AIR_DENSITY * airspeed * airspeed;

  // --- Lift with a progressive stall ---------------------------------------
  let cl = c.cl0 + c.clAlpha * clampSym(alpha, c.alphaStall);
  if (Math.abs(alpha) > c.alphaStall) {
    // Past the break the wing sheds lift over the next ~11 degrees rather
    // than switching off — abrupt stalls are neither realistic nor teachable.
    const past = Math.abs(alpha) - c.alphaStall;
    cl *= Math.max(0.35, 1 - past / 0.2);
  }
  const cd = c.cd0 + c.kInduced * cl * cl;

  // --- Forces (world frame) ------------------------------------------------
  forceWorld.set(0, -c.mass * GRAVITY, 0);

  if (airspeed > 0.5) {
    relAirHat.copy(relAirWorld).divideScalar(airspeed);

    // Lift acts perpendicular to the relative wind, in the plane containing
    // the body's up axis: project body-up off the airflow direction.
    bodyUpWorld.set(0, 1, 0).applyQuaternion(state.orientation);
    liftDir
      .copy(bodyUpWorld)
      .addScaledVector(relAirHat, -bodyUpWorld.dot(relAirHat));
    if (liftDir.lengthSq() > 1e-8) {
      liftDir.normalize();
      forceWorld.addScaledVector(liftDir, q * c.wingArea * cl);
    }

    // Drag opposes the relative wind.
    forceWorld.addScaledVector(relAirHat, -q * c.wingArea * cd);

    // Side force opposes sideslip along the body's right axis.
    bodyRightWorld.set(1, 0, 0).applyQuaternion(state.orientation);
    forceWorld.addScaledVector(bodyRightWorld, q * c.wingArea * c.cyBeta * beta);
  }

  // Thrust along the nose, fading with forward speed like a fixed-pitch prop.
  const thrust =
    (state.armed ? controls.throttle : 0) *
    c.maxThrust *
    Math.max(0, 1 - Math.max(0, forwardSpeed) / c.thrustFadeSpeed);
  noseWorld.set(0, 0, -1).applyQuaternion(state.orientation);
  forceWorld.addScaledVector(noseWorld, thrust);
  state.motorThrust.fill(thrust / 4);

  state.velocity.addScaledVector(forceWorld, dt / c.mass);
  state.position.addScaledVector(state.velocity, dt);

  // --- Moments (body frame) ------------------------------------------------
  const w = state.angularVelocity;
  const qSb = q * c.wingArea * c.span;
  const qSc = q * c.wingArea * c.chord;
  // Non-dimensional rate terms; guarded so a standstill divides by nothing.
  const vRef = Math.max(airspeed, 2);
  const pitchHat = (w.x * c.chord) / (2 * vRef);
  const yawHat = (w.y * c.span) / (2 * vRef);
  const rollHat = (w.z * c.span) / (2 * vRef);

  torque.set(
    qSc * (c.cm0 + c.cmAlpha * alpha + c.cmQ * pitchHat + c.cmElevator * controls.pitch),
    qSb * (c.cnBeta * beta + c.cnR * yawHat + c.cnRudder * controls.yaw),
    // Roll right = negative Z in this basis, hence the minus on aileron.
    qSb * (c.clBeta * beta + c.clP * rollHat - c.clAileron * controls.roll),
  );

  inertiaTimesOmega.set(w.x * c.inertia.x, w.y * c.inertia.y, w.z * c.inertia.z);
  gyroscopic.copy(w).cross(inertiaTimesOmega);

  w.x += ((torque.x - gyroscopic.x) / c.inertia.x) * dt;
  w.y += ((torque.y - gyroscopic.y) / c.inertia.y) * dt;
  w.z += ((torque.z - gyroscopic.z) / c.inertia.z) * dt;

  spinQuat.set(w.x * 0.5 * dt, w.y * 0.5 * dt, w.z * 0.5 * dt, 0);
  derivative.copy(state.orientation).multiply(spinQuat);
  state.orientation.set(
    state.orientation.x + derivative.x,
    state.orientation.y + derivative.y,
    state.orientation.z + derivative.z,
    state.orientation.w + derivative.w,
  );
  state.orientation.normalize();

  state.time += dt;

  // --- Ground --------------------------------------------------------------
  const groundY = groundHeightAt(state.position.x, state.position.z) + gearClearance;
  contact.grounded = state.position.y <= groundY;
  contact.sinkSpeed = 0;
  contact.slope = 0;
  contact.groundSpeed = Math.hypot(state.velocity.x, state.velocity.z);

  if (contact.grounded) {
    contact.sinkSpeed = Math.max(0, -state.velocity.y);

    const eps = 2;
    const gx =
      (groundHeightAt(state.position.x + eps, state.position.z) -
        groundHeightAt(state.position.x - eps, state.position.z)) /
      (2 * eps);
    const gz =
      (groundHeightAt(state.position.x, state.position.z + eps) -
        groundHeightAt(state.position.x, state.position.z - eps)) /
      (2 * eps);
    contact.slope = Math.hypot(gx, gz);

    state.position.y = groundY;
    if (state.velocity.y < 0) state.velocity.y = 0;

    // Rolling resistance as a force, not a per-step velocity multiplier — a
    // multiplier at 200 Hz would stop the takeoff roll dead.
    const groundSpeed = contact.groundSpeed;
    if (groundSpeed > 1e-3) {
      const decel = Math.min(c.rollingFriction * GRAVITY * dt, groundSpeed);
      state.velocity.x -= (state.velocity.x / groundSpeed) * decel;
      state.velocity.z -= (state.velocity.z / groundSpeed) * decel;
    }

    // Nosewheel steering: rudder authority on the ground, scaled by roll
    // speed, so the plane can be lined up on the runway before the fin has
    // any air over it.
    w.y += controls.yaw * 1.4 * Math.min(groundSpeed / 8, 1) * dt * 10;

    // Wheels resist rolling and pitching on the pavement.
    const settle = Math.max(0, 1 - 4 * dt);
    w.x *= settle;
    w.z *= settle;
  }

  return contact;
}

function clampSym(value: number, limit: number) {
  return value > limit ? limit : value < -limit ? -limit : value;
}
