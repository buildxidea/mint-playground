import { MAX_ROTOR_THRUST, VEHICLE } from "./config";

/**
 * Control allocation: turn one collective thrust demand and three body-torque
 * demands into four rotor thrusts.
 *
 * With motors indexed front-right, rear-right, rear-left, front-left and each
 * sitting at body offset (±a, 0, ±a), a rotor thrust f at (x, 0, z) produces
 * torque r x F = (-z*f, 0, x*f). Summing over the four rotors and folding in
 * the yaw reaction torque (km/kf per newton of thrust, signed by spin) gives:
 *
 *   T = f0 + f1 + f2 + f3                     total thrust
 *   P = (f0 + f3) - (f1 + f2) = tau_x / a     pitch, front minus rear
 *   R = (f0 + f1) - (f2 + f3) = tau_z / a     roll,  right minus left
 *   Y = -f0 + f1 - f2 + f3 = -tau_y * kf/km   yaw,   by spin direction
 *
 * which inverts exactly to the four thrusts below.
 */

const A = VEHICLE.motors[0].x; // axis-aligned motor offset, metres
const YAW_PER_NEWTON = VEHICLE.km / VEHICLE.kf;

export interface MixerDemand {
  /** Total upward thrust in the body frame, N. */
  thrust: number;
  /** Body torque about +X, positive = nose up, N m. */
  pitch: number;
  /** Body torque about +Y, positive = nose left, N m. */
  yaw: number;
  /** Body torque about +Z; positive tips the aircraft left, N m. */
  roll: number;
}

export interface MixerResult {
  /** Rotor thrusts in mixer order, N, each within [0, MAX_ROTOR_THRUST]. */
  thrusts: [number, number, number, number];
  /** True when the demand could not be met without clipping. */
  saturated: boolean;
}

/**
 * Allocate thrusts, preferring attitude over collective.
 *
 * When a demand does not fit, the collective term is what gets sacrificed
 * first: losing a little altitude authority is recoverable, losing attitude
 * authority is a crash. Only if the attitude demand alone exceeds the rotor
 * range are the torque terms scaled back, and then uniformly so the commanded
 * rotation axis is preserved even as its magnitude is reduced.
 */
export function mix(demand: MixerDemand): MixerResult {
  const p = demand.pitch / A;
  const r = demand.roll / A;
  const y = -demand.yaw / YAW_PER_NEWTON;

  // Per-motor attitude contribution, independent of collective.
  const offsets: [number, number, number, number] = [
    (+p + r - y) / 4,
    (-p + r + y) / 4,
    (-p - r - y) / 4,
    (+p - r + y) / 4,
  ];

  let scale = 1;
  const spread = Math.max(...offsets) - Math.min(...offsets);
  if (spread > MAX_ROTOR_THRUST) {
    // The rotation alone spans more than the rotor range; shrink it, keeping
    // the axis intact.
    scale = MAX_ROTOR_THRUST / spread;
  }

  const scaled = offsets.map((o) => o * scale) as [
    number,
    number,
    number,
    number,
  ];

  // Slide the collective until the whole set fits inside [0, max].
  let collective = demand.thrust / 4;
  const highest = collective + Math.max(...scaled);
  const lowest = collective + Math.min(...scaled);
  if (highest > MAX_ROTOR_THRUST) collective -= highest - MAX_ROTOR_THRUST;
  if (lowest < 0) collective -= lowest;

  const thrusts = scaled.map((o) => {
    const f = collective + o;
    return f < 0 ? 0 : f > MAX_ROTOR_THRUST ? MAX_ROTOR_THRUST : f;
  }) as [number, number, number, number];

  const requested = demand.thrust / 4;
  const saturated = scale < 1 || Math.abs(collective - requested) > 1e-9;

  return { thrusts, saturated };
}

/** Invert `thrust = kf * omega^2` to get the rotor speed command, rad/s. */
export function thrustToOmega(thrust: number): number {
  return thrust <= 0 ? 0 : Math.sqrt(thrust / VEHICLE.kf);
}
