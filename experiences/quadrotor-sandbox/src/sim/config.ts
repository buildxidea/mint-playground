import type { PidGains } from "./pid";

/**
 * Vehicle parameters and controller gains — the whole tuning surface of the
 * sandbox in one file.
 *
 * This config is *authoritative for geometry*. When the Mint drone parts are
 * fitted in `assets/drone.ts`, the meshes are placed to match `MOTORS` below;
 * the art never moves the physics.
 */

/** One rotor's mounting position and spin direction in the body frame. */
export interface Rotor {
  /** Body-frame X offset (metres), +X is right. */
  x: number;
  /** Body-frame Z offset (metres), -Z is the nose. */
  z: number;
  /** +1 = counter-clockwise seen from above, -1 = clockwise. */
  spin: 1 | -1;
}

export interface VehicleConfig {
  /** Total mass, kg. */
  mass: number;
  /** Motor-to-centre distance, metres (a 5-inch class quad is ~0.125 m). */
  armLength: number;
  /** Diagonal body-frame inertia tensor, kg m^2. Y is the yaw axis. */
  inertia: { x: number; y: number; z: number };
  /** Thrust coefficient: thrust_N = kf * omega^2. */
  kf: number;
  /** Rotor drag-torque coefficient: torque_Nm = km * omega^2. */
  km: number;
  /** Rotor speed at full command, rad/s. */
  maxRotorOmega: number;
  /** First-order motor spin-up time constant, seconds. */
  motorTau: number;
  /** Combined 0.5 * rho * Cd * A for translational drag, N per (m/s)^2. */
  dragFactor: number;
  /** Angular drag coefficient, N m per (rad/s)^2. */
  angularDragFactor: number;
  /** Rotor layout, in mixer order: front-right, rear-right, rear-left, front-left. */
  motors: readonly [Rotor, Rotor, Rotor, Rotor];
}

/**
 * Arm length of the original 5-inch racer this sandbox shipped with. Every
 * absolute number elsewhere that was calibrated against that airframe — the
 * Mint part fit table, the collision box, the camera framing — derives its
 * own scale from `VEHICLE.armLength / REFERENCE_ARM_LENGTH` rather than
 * repeating a second copy of "how big the drone is".
 */
export const REFERENCE_ARM_LENGTH = 0.125;

// A 10-inch "cinelifter" class: bigger, heavier, and visibly less snappy than
// the 5-inch racer, the way a real payload-hauling quad is next to a race
// quad. ~1.9x the linear size.
const ARM = 0.24;
// X-configuration: each motor sits on a diagonal, so its axis-aligned offset is
// the arm length projected onto X and Z.
const A = ARM / Math.SQRT2;
const SIZE_SCALE = ARM / REFERENCE_ARM_LENGTH;

const MAX_THRUST_PER_ROTOR = 17; // N — a big cinelifter motor+prop combo
const MAX_OMEGA = 950; // rad/s — bigger props turn slower

/** Rotor drag torque per newton of thrust. Heavier blades carry relatively
 * more of it than the small racer's, hence the bump from the original 0.016. */
const YAW_DRAG_RATIO = 0.02;

export const VEHICLE: VehicleConfig = {
  // ~2.7x the 5-inch racer's mass, matching a real 10-inch payload-class quad
  // rather than a pure cube-law scale-up of the same airframe.
  mass: 2.4,
  armLength: ARM,
  // Roll/pitch inertia scales roughly with mass * armLength^2 relative to the
  // 5-inch baseline (mass 2.67x, arm 1.92x -> ~9.7x); yaw scaled the same way.
  inertia: { x: 0.078, y: 0.145, z: 0.078 },
  kf: MAX_THRUST_PER_ROTOR / (MAX_OMEGA * MAX_OMEGA),
  km: (MAX_THRUST_PER_ROTOR / (MAX_OMEGA * MAX_OMEGA)) * YAW_DRAG_RATIO,
  maxRotorOmega: MAX_OMEGA,
  // Bigger props carry more rotational inertia, so they spin up and down
  // slower than the 5-inch racer's.
  motorTau: 0.05,
  // Translational and angular drag scale with frontal area, ~SIZE_SCALE^2.
  dragFactor: 0.0214 * SIZE_SCALE * SIZE_SCALE,
  angularDragFactor: 0.0008 * SIZE_SCALE * SIZE_SCALE,
  motors: [
    { x: +A, z: -A, spin: -1 }, // 0 front-right
    { x: +A, z: +A, spin: +1 }, // 1 rear-right
    { x: -A, z: +A, spin: -1 }, // 2 rear-left
    { x: -A, z: -A, spin: +1 }, // 3 front-left
  ],
};

/** Peak thrust one rotor can produce, N. Derived so it can never drift out of sync. */
export const MAX_ROTOR_THRUST =
  VEHICLE.kf * VEHICLE.maxRotorOmega * VEHICLE.maxRotorOmega;

/** Thrust needed to hold altitude level, N. */
export const HOVER_THRUST = VEHICLE.mass * 9.80665;

/** Pilot-facing envelope limits, shared by the controller and the HUD. */
export const LIMITS = {
  /** Maximum commanded tilt in stabilized and position modes, radians. */
  maxTilt: (35 * Math.PI) / 180,
  /** Maximum commanded body rates in acro mode, rad/s. */
  maxRate: { roll: 14, pitch: 14, yaw: 7 },
  /** Maximum commanded horizontal speed in position mode, m/s. */
  maxSpeed: 14,
  /** Maximum commanded climb and descent rate in position mode, m/s. */
  maxClimbRate: 4,
  /** Torque authority per axis, N m — used to clamp the rate loop's output. */
  maxTorque: {
    roll: A * 2 * MAX_THRUST_PER_ROTOR * 0.9,
    pitch: A * 2 * MAX_THRUST_PER_ROTOR * 0.9,
    yaw: YAW_DRAG_RATIO * 2 * MAX_THRUST_PER_ROTOR * 0.9,
  },
} as const;

export interface GainSet {
  label: string;
  /** Inner loop: body-rate error (rad/s) -> body torque (N m). */
  rate: { roll: PidGains; pitch: PidGains; yaw: PidGains };
  /** Attitude error (rad) -> body-rate setpoint (rad/s). Proportional only. */
  attitudeKp: number;
  /** Horizontal velocity error (m/s) -> horizontal acceleration (m/s^2). */
  horizontalVelocity: PidGains;
  /** Horizontal position error (m) -> velocity setpoint (m/s). */
  positionKp: number;
  /** Climb-rate error (m/s) -> vertical acceleration (m/s^2). */
  verticalVelocity: PidGains;
  /** Altitude error (m) -> climb-rate setpoint (m/s). */
  altitudeKp: number;
}

/**
 * Three presets, retuned for the bigger airframe below. `detuned` exists to be
 * flown: its rate loop is pushed harder and stripped of its damping term, so
 * the aircraft visibly rings instead of settling. It is the fastest way to
 * see what the D term was doing.
 *
 * The base numbers are the 5-inch racer's. Two adjustments carry them to this
 * airframe, and the reasoning behind the first one was got *wrong* once, so
 * it is worth stating precisely.
 *
 * **Rate loop: scale P and D by the full inertia ratio.** A rate loop's
 * closed-loop bandwidth is `kp / I` — torque authority does not appear in it
 * at all, it only sets where the output saturates. An earlier version of this
 * file divided the inertia ratio by the growth in torque authority, which is
 * dimensionally meaningless, and left the rate loop at 3.4 rad/s against an
 * attitude loop commanding 8 rad/s. That inverts the cascade: the outer loop
 * was 2.4x *faster* than the inner loop it drives, which is a textbook
 * oscillation recipe, and it flew visibly wobbly — measured at 13 rate
 * reversals and 64 degrees of tilt against a 35-degree stick command while
 * flying a simple box. Scaling by the inertia ratio alone restores the racer's
 * ~12.5 rad/s inner loop.
 *
 * Rate-loop I is deliberately *not* scaled. This was re-tested at the
 * corrected bandwidth across ki = 0.08 to 0.78: it changes almost nothing and
 * mildly worsens ringing at the top of that range, so the racer's value stands.
 *
 * **Attitude loop: lowered from 8 to 5.** Even with the inner loop corrected,
 * 8 rad/s of attitude gain against a 12.5 rad/s rate loop is a 1.56x cascade
 * separation, under the >=3x rule of thumb. Dropping it to 5 cut rate
 * reversals from 11 to 3 and brought peak tilt down to 40 degrees, near the
 * 35-degree commanded limit, at a cost of ~0.1 m/s more residual speed after
 * a hard displacement. Going further (3-4) overshoots less still but starts
 * leaving the aircraft drifting after a push.
 *
 * **Horizontal velocity loop: P dropped (2.2 -> 1.2 stable, 3 -> 1.6 sport).**
 * The original value left the outer and inner loops too close in bandwidth: a
 * hard stick push and release settled the rate loop fine but left the
 * *position* hold in a sustained limit cycle, never below 1 m/s for the next
 * 20 simulated seconds.
 *
 * Every number here was swept against three scenarios together — flying a box
 * with stick input, holding station in a 7 m/s crosswind, and recovering from
 * a hard displacement — because fixing any one of them alone regresses another.
 */
const REFERENCE_INERTIA = 0.008;
const RATE_COMPENSATION = VEHICLE.inertia.x / REFERENCE_INERTIA;
const RATE_DAMPING_BOOST = 1.5;

function scaleRate(kp: number, ki: number, kd: number): PidGains {
  return {
    kp: kp * RATE_COMPENSATION,
    // Deliberately unscaled — see the comment above.
    ki,
    kd: kd * RATE_COMPENSATION * RATE_DAMPING_BOOST,
  };
}

export const GAIN_PRESETS = {
  stable: {
    label: "Stable",
    rate: {
      roll: scaleRate(0.1, 0.08, 0.0035),
      pitch: scaleRate(0.1, 0.08, 0.0035),
      yaw: scaleRate(0.3, 0.2, 0),
    },
    attitudeKp: 5,
    horizontalVelocity: { kp: 1.2, ki: 0.4, kd: 0.05 },
    positionKp: 1.4,
    verticalVelocity: { kp: 3, ki: 1.6, kd: 0.15 },
    altitudeKp: 2.2,
  },
  sport: {
    label: "Sport",
    rate: {
      roll: scaleRate(0.16, 0.1, 0.0045),
      pitch: scaleRate(0.16, 0.1, 0.0045),
      yaw: scaleRate(0.36, 0.22, 0),
    },
    // Scaled from stable's 5 in the same proportion the racer's sport preset
    // sat above its stable one, so "sport" stays sharper without re-inverting
    // the cascade separation that made the aircraft wobble.
    attitudeKp: 7,
    horizontalVelocity: { kp: 1.6, ki: 0.5, kd: 0.06 },
    positionKp: 2,
    verticalVelocity: { kp: 3.6, ki: 1.8, kd: 0.15 },
    altitudeKp: 2.8,
  },
  // Gain for gain, this is the interesting one. The rate loop's P is pushed
  // to twice `stable`'s while its D is stripped out entirely, so the phase
  // lag of the motors is no longer covered: disturb it and it rings for the
  // rest of the flight instead of settling. It is still flyable and bounded
  // (`flight-core.test.ts` checks a hard ceiling on the overshoot), which is
  // the point — you can feel the difference rather than just crash.
  detuned: {
    label: "Detuned",
    rate: {
      roll: { kp: 0.1 * RATE_COMPENSATION * 2, ki: 0.08, kd: 0 },
      pitch: { kp: 0.1 * RATE_COMPENSATION * 2, ki: 0.08, kd: 0 },
      yaw: scaleRate(0.3, 0.2, 0),
    },
    // Lowered from 32 once `stable`'s rate loop was corrected: against the
    // faster inner loop, 32 pushed the overshoot past 13 rad/s, which tumbles
    // rather than teaches. 24 rings for the whole observation window without
    // settling — the point of the preset — while staying flyable.
    attitudeKp: 24,
    horizontalVelocity: { kp: 1.2, ki: 0.4, kd: 0.05 },
    positionKp: 1.4,
    verticalVelocity: { kp: 3, ki: 1.6, kd: 0.15 },
    altitudeKp: 2.2,
  },
} satisfies Record<string, GainSet>;

export type GainPresetId = keyof typeof GAIN_PRESETS;

/** Deep copy so the live gains can be edited without mutating the preset. */
export function cloneGains(id: GainPresetId): GainSet {
  return structuredClone(GAIN_PRESETS[id]) as GainSet;
}
