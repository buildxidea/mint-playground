import type { VehicleId } from '../assets/manifest';

export type VehicleProfile = {
  id: VehicleId;
  label: string;
  length: number;
  width: number;
  height: number;
  /** Distance between axles (m). */
  wheelbase: number;
  /** Vehicle mass (kg) — heavier = slower to accelerate / stop. */
  mass: number;
  /** Peak engine force (N) at full throttle. */
  engineForce: number;
  /** Peak reverse force (N). */
  reverseForce: number;
  /** Peak brake force (N). */
  brakeForce: number;
  /** Coast / rolling resistance coefficient. */
  rollingResistance: number;
  /** Quadratic drag coefficient. */
  drag: number;
  /** Top speed (m/s). */
  maxSpeed: number;
  /** Top reverse speed (m/s). */
  maxReverse: number;
  /** Max front-wheel steer angle (radians). */
  maxSteer: number;
  /** How fast wheels reach steer target (rad/s). */
  steerResponse: number;
  /** Lateral tire grip (higher = less slide). */
  tireGrip: number;
  /** Cornering stiffness scale for bicycle yaw. */
  corneringStiffness: number;
};

/** Painted line inset required around the full visible vehicle footprint. */
export const PARKING_FIT_MARGIN = 0.08;

/** Small arcade forgiveness for impacts; parking fit still uses the full body. */
export const VEHICLE_COLLIDER_INSET = { width: 0.06, length: 0.08 } as const;

export function vehicleColliderHalfExtents(
  profile: Pick<VehicleProfile, 'width' | 'length'>,
): {
  hx: number;
  hz: number;
} {
  return {
    hx: Math.max(0.1, profile.width / 2 - VEHICLE_COLLIDER_INSET.width),
    hz: Math.max(0.1, profile.length / 2 - VEHICLE_COLLIDER_INSET.length),
  };
}

export const VEHICLE_PROFILES: Record<VehicleId, VehicleProfile> = {
  compact: {
    id: 'compact',
    label: 'Compact',
    length: 3.8,
    width: 1.7,
    height: 1.45,
    wheelbase: 2.5,
    mass: 1100,
    engineForce: 9000,
    reverseForce: 7200,
    brakeForce: 15000,
    rollingResistance: 0.018,
    drag: 0.42,
    maxSpeed: 9,
    maxReverse: 3.6,
    maxSteer: 0.55,
    steerResponse: 2.6,
    tireGrip: 14,
    corneringStiffness: 9.5,
  },
  sports: {
    id: 'sports',
    label: 'Sports',
    length: 4.2,
    width: 1.85,
    height: 1.25,
    wheelbase: 2.55,
    mass: 1250,
    engineForce: 12500,
    reverseForce: 7800,
    brakeForce: 13500,
    rollingResistance: 0.015,
    drag: 0.35,
    maxSpeed: 12,
    maxReverse: 4,
    maxSteer: 0.48,
    steerResponse: 3.1,
    tireGrip: 16,
    corneringStiffness: 11,
  },
  van: {
    id: 'van',
    label: 'Delivery Van',
    length: 5.0,
    width: 2.15,
    height: 2.2,
    wheelbase: 3.2,
    mass: 2000,
    engineForce: 9800,
    reverseForce: 8000,
    brakeForce: 17000,
    rollingResistance: 0.022,
    drag: 0.55,
    maxSpeed: 7,
    maxReverse: 3.2,
    maxSteer: 0.5,
    steerResponse: 2.0,
    tireGrip: 11,
    corneringStiffness: 7.5,
  },
};
