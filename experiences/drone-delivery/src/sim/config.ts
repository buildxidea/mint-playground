import * as THREE from 'three';

/**
 * Flight tuning for the delivery quad. The rig fitting in `assets/drone.ts`
 * derives every visual dimension from `ARM_LENGTH`, so resizing the drone is
 * a one-line edit here.
 */

/** Arm length of the 5-inch racer the Mint part fit table was calibrated on. */
export const REFERENCE_ARM_LENGTH = 0.125;

/**
 * Motor-to-centre distance, metres. Larger than the source sim's 0.24 m
 * cinelifter so the drone stays readable against the miniature city from the
 * chase camera.
 */
export const ARM_LENGTH = 0.5;

const A = ARM_LENGTH / Math.SQRT2;

/** Rotor layout in mixer order: front-right, rear-right, rear-left, front-left. */
export const MOTORS: readonly THREE.Vector3[] = [
  new THREE.Vector3(A, 0, -A),
  new THREE.Vector3(A, 0, A),
  new THREE.Vector3(-A, 0, A),
  new THREE.Vector3(-A, 0, -A),
];

/** Arcade stabilized-flight tuning. Angles in radians, speeds in m/s. */
export const FLIGHT = {
  /** Max commanded tilt at full stick. */
  maxTilt: THREE.MathUtils.degToRad(24),
  /** Natural frequency of the critically damped tilt spring, rad/s. */
  tiltResponse: 7,
  /** Horizontal acceleration at full tilt. */
  maxAccel: 13,
  /** Linear horizontal drag, 1/s. */
  drag: 0.75,
  /** Max climb / descend rates. */
  maxClimb: 6,
  maxDescend: 4.5,
  /** Time constant for vertical speed tracking, s. */
  climbTau: 0.28,
  /** Max yaw rate at full stick, rad/s. */
  maxYawRate: 2.4,
  /** Yaw rate time constant, s. */
  yawTau: 0.14,
  /** How strongly wind pulls the drone toward the air-mass velocity, 1/s. */
  windCoupling: 0.35,
  /** Multipliers applied while carrying a package. */
  carryAccel: 0.8,
  carryClimb: 0.82,
  /** Touchdown classification, m/s of descent. */
  softLanding: 1.6,
  hardLanding: 3.2,
  /** Impact speed above which a collision counts as damaging. */
  damageSpeed: 3,
  /** Throttle stick level that lifts off from a landed state. */
  liftoffThrottle: 0.2,
  /** Descent rate forced by an empty battery. */
  emptyBatterySink: -2.2,
  gravity: 9.81,
} as const;

/** Drone collision proxy radius, metres. */
export const DRONE_RADIUS = 0.62;

/** The three delivery liveries. The same Mint model, tinted per drone. */
export const LIVERIES = [
  { name: 'Coral Courier', accent: new THREE.Color('#ff7f66') },
  { name: 'Minty Express', accent: new THREE.Color('#4ecdb4') },
  { name: 'Sunny Parcel', accent: new THREE.Color('#ffc94d') },
] as const;

/** Package/pad colour channels used to match deliveries to rooftops. */
export const PACKAGE_COLORS = [
  { id: 'coral', color: new THREE.Color('#ff6f61'), label: 'Coral' },
  { id: 'teal', color: new THREE.Color('#2fbfa7'), label: 'Teal' },
  { id: 'gold', color: new THREE.Color('#f7b32b'), label: 'Gold' },
  { id: 'violet', color: new THREE.Color('#9b7fe8'), label: 'Violet' },
] as const;

export type PackageColorId = (typeof PACKAGE_COLORS)[number]['id'];

export function packageColor(id: PackageColorId): THREE.Color {
  const entry = PACKAGE_COLORS.find((c) => c.id === id);
  return entry ? entry.color : PACKAGE_COLORS[0].color;
}
