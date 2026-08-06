import { Quaternion, Vector3 } from "three";

export type FlightMode = "acro" | "stabilized" | "position";

export const FLIGHT_MODES: readonly FlightMode[] = [
  "acro",
  "stabilized",
  "position",
];

export const MODE_LABELS: Record<FlightMode, string> = {
  acro: "Acro",
  stabilized: "Stabilized",
  position: "Position hold",
};

/**
 * The canonical aircraft state. This object is the single authority on where
 * the drone is and how it is moving; the three.js scene graph, the Rapier body
 * and the HUD all read from it (spatial-contracts.md, §2).
 */
export interface DroneState {
  /** World position, metres. */
  position: Vector3;
  /** World velocity, m/s. */
  velocity: Vector3;
  /** Body-to-world rotation. */
  orientation: Quaternion;
  /** Body-frame angular velocity, rad/s. */
  angularVelocity: Vector3;
  /** Current rotor speeds, rad/s, in mixer order. */
  motorOmega: Float64Array;
  /** Rotor thrusts from the last step, N — telemetry and prop-blur input. */
  motorThrust: Float64Array;
  /** Accumulated rotor angle for visual prop spin, radians. */
  motorAngle: Float64Array;
  armed: boolean;
  mode: FlightMode;
  /** Set by the crash handoff; the controller stops commanding while true. */
  crashed: boolean;
  /** Seconds of simulated time since the last reset. */
  time: number;
}

/** Pose captured before a step, so rendering can interpolate across it. */
export interface PoseSnapshot {
  position: Vector3;
  orientation: Quaternion;
}

/**
 * Spawn point on the pad. The height is set from the assembled airframe's
 * measured ground clearance once the rig has loaded, so the aircraft rests on
 * its skids rather than at a guessed altitude.
 */
export const SPAWN = { x: 0, y: 0.072, z: 0 };

export function createState(): DroneState {
  return {
    position: new Vector3(SPAWN.x, SPAWN.y, SPAWN.z),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    angularVelocity: new Vector3(),
    motorOmega: new Float64Array(4),
    motorThrust: new Float64Array(4),
    motorAngle: new Float64Array(4),
    armed: false,
    mode: "position",
    crashed: false,
    time: 0,
  };
}

/** Return to the spawn pad, disarmed and stationary. Keeps the current mode. */
export function resetState(state: DroneState) {
  state.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
  state.velocity.set(0, 0, 0);
  state.orientation.identity();
  state.angularVelocity.set(0, 0, 0);
  state.motorOmega.fill(0);
  state.motorThrust.fill(0);
  state.motorAngle.fill(0);
  state.armed = false;
  state.crashed = false;
  state.time = 0;
}

export function createSnapshot(state: DroneState): PoseSnapshot {
  return {
    position: state.position.clone(),
    orientation: state.orientation.clone(),
  };
}

export function captureSnapshot(state: DroneState, into: PoseSnapshot) {
  into.position.copy(state.position);
  into.orientation.copy(state.orientation);
}

/** Height of the aircraft above the world origin plane, metres. */
export function altitude(state: DroneState) {
  return state.position.y;
}

/** Cosine of the angle between the aircraft's up axis and world up. */
export function tiltCosine(state: DroneState) {
  // Body +Y in world coordinates is the rotation matrix's second column;
  // dotting it with world up leaves just the middle term.
  const { x, z } = state.orientation;
  return 1 - 2 * (x * x + z * z);
}
