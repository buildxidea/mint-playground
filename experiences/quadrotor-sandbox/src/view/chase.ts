import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { REFERENCE_ARM_LENGTH, VEHICLE } from "../sim/config";
import type { DroneState } from "../sim/state";

export type CameraMode = "chase" | "onboard" | "orbit" | "ground";

export const CAMERA_MODES: readonly CameraMode[] = [
  "chase",
  "onboard",
  "orbit",
  "ground",
];

export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: "Chase",
  onboard: "Onboard",
  orbit: "Orbit",
  ground: "Ground",
};

/**
 * How far the onboard camera sits above the airframe's centre and forward of
 * it, as fractions of the aircraft's own half-height and half-length. Derived
 * per vehicle rather than hand-set so each aircraft frames itself the same
 * way: high enough to clear the fuselage, far enough forward that the nose
 * and the wing or rotor edges stay at the frame's borders.
 */
export const ONBOARD_RISE = 0.6;
export const ONBOARD_FORWARD = 0.45;

/** Slight nose-down tilt, so the airframe sits in the lower frame rather than
 * out of shot below it. */
const ONBOARD_PITCH = (-5 * Math.PI) / 180;

// Chase and orbit distance scale with the airframe, so a bigger drone reads
// as bigger rather than just filling more of the frame at the same distance.
// Ground camera is a fixed viewpoint the aircraft flies past, not something
// framed around it, so it does not need the same treatment.
const FRAMING_SCALE = VEHICLE.armLength / REFERENCE_ARM_LENGTH;
const CHASE_OFFSET = new Vector3(0, 0.9, 3.2).multiplyScalar(FRAMING_SCALE);
const ORBIT_RADIUS = 6 * FRAMING_SCALE;
const GROUND_POSITION = new Vector3(6, 1.6, 9);

/**
 * Camera behaviour, kept out of the Engine so the renderer keeps one job.
 *
 * The chase camera follows the aircraft's *heading* rather than its full
 * orientation: inheriting roll and pitch from a quad that is constantly
 * correcting makes the world appear to lurch even when the flight is smooth.
 */
export class ChaseCamera {
  mode: CameraMode = "chase";

  /**
   * Per-vehicle framing multiplier on top of the quad-derived base offsets:
   * 1 frames the quad, larger values back off for physically larger aircraft
   * (the 1.8 m bush plane uses ~2.6). The ground camera is a fixed viewpoint
   * the aircraft flies past, so it ignores this.
   */
  framing = 1;

  /**
   * Camera position in body coordinates for the onboard view, set per vehicle
   * from its measured size.
   */
  readonly onboardOffset = new Vector3();

  /**
   * Onboard horizon behaviour. Stabilised takes only the aircraft's heading,
   * so the horizon stays flat while the airframe banks beneath it; raw
   * inherits the full attitude, so the world rolls with the aircraft. Toggled
   * in flight with `G`.
   */
  stabilized = false;

  private readonly position = new Vector3(0, 2, 6);
  private readonly target = new Vector3();
  private readonly desired = new Vector3();
  private readonly heading = new Quaternion();
  private readonly onboardWorld = new Vector3();
  private readonly onboardTilt = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    ONBOARD_PITCH,
  );
  private orbitAngle = 0;

  reset(state: DroneState) {
    // `framing` matters here as much as it does in `update`. Without it the
    // camera was placed at the quad's distance regardless of vehicle and then
    // smoothly swung out to the right one over the following second — a 35 m
    // lurch on every rocket spawn, and a visible one on the jet too.
    this.desired
      .copy(CHASE_OFFSET)
      .multiplyScalar(this.framing)
      .add(state.position);
    this.position.copy(this.desired);
    this.target.copy(state.position);
  }

  /**
   * `pose` is where the aircraft is *drawn* this frame, which is the raw
   * simulation state interpolated across the leftover fraction of a physics
   * step. It matters enormously for the onboard view: a camera bolted to the
   * airframe has to use the same pose the airframe was drawn at, or the two
   * disagree by up to one step of travel — at the jet's 73 m/s that is 0.37 m
   * per 200 Hz step, next to a camera half a metre from the nose, and it reads
   * as violent shaking. Defaults to the raw state so tests and any caller
   * without an interpolated pose still work.
   */
  update(
    camera: PerspectiveCamera,
    state: DroneState,
    dt: number,
    pose: Pose = state,
  ) {
    // The onboard view is bolted to the airframe, so it neither smooths its
    // position nor uses `lookAt` — both of those exist to make a *following*
    // camera pleasant, and either one here would make the aircraft appear to
    // drift around its own camera mount.
    if (this.mode === "onboard") {
      this.onboardWorld
        .copy(this.onboardOffset)
        .applyQuaternion(pose.orientation)
        .add(pose.position);
      camera.position.copy(this.onboardWorld);

      if (this.stabilized) {
        camera.quaternion.copy(headingOf(pose.orientation, this.heading));
      } else {
        camera.quaternion.copy(pose.orientation);
      }
      camera.quaternion.multiply(this.onboardTilt);

      // Keep the smoothed chase state tracking the aircraft, so switching
      // back to chase does not swing in from wherever it was left.
      this.position.copy(this.onboardWorld);
      this.target.copy(pose.position);
      return;
    }

    switch (this.mode) {
      case "chase": {
        // Yaw-only frame: strip roll and pitch out of the aircraft attitude.
        this.desired
          .copy(CHASE_OFFSET)
          .multiplyScalar(this.framing)
          .applyQuaternion(headingOf(pose.orientation, this.heading))
          .add(pose.position);
        break;
      }
      case "orbit": {
        this.orbitAngle += dt * 0.25;
        const radius = ORBIT_RADIUS * this.framing;
        this.desired.set(
          pose.position.x + Math.sin(this.orbitAngle) * radius,
          pose.position.y + 2.2 * FRAMING_SCALE * this.framing,
          pose.position.z + Math.cos(this.orbitAngle) * radius,
        );
        break;
      }
      case "ground": {
        this.desired.copy(GROUND_POSITION);
        break;
      }
    }

    // Critically-damped-ish smoothing, frame-rate independent.
    const follow = this.mode === "ground" ? 1 : 1 - Math.exp(-dt * 6);
    this.position.lerp(this.desired, follow);
    this.target.lerp(pose.position, 1 - Math.exp(-dt * 8));

    camera.position.copy(this.position);
    camera.lookAt(this.target);
  }
}

/** Just enough of a rigid-body pose for the camera to attach to. */
export interface Pose {
  position: Vector3;
  orientation: Quaternion;
}

const UP = new Vector3(0, 1, 0);

/**
 * Horizontal length of the fore-aft axis below which it stops being a usable
 * heading and the up axis takes over. 0.12 is about seven degrees off vertical.
 */
const NEARLY_VERTICAL = 0.12;

/**
 * The aircraft's heading as a rotation about world up, with roll and pitch
 * discarded. Shared by the chase camera (which would otherwise lurch every
 * time the controller corrects) and the stabilised onboard view.
 *
 * The fallback is what makes this work for a rocket. Heading is normally the
 * fore-aft axis flattened onto the ground plane, but a vehicle pointing
 * *straight up* has no fore-aft direction on that plane at all: both
 * components collapse to zero, and `atan2` of two numbers that are nothing but
 * floating-point noise returns a different answer every frame. The chase
 * camera duly whipped around a rocket on the pad and lerped straight through
 * it, which is what the zooming and glitching on switching to one was.
 *
 * So near vertical it blends over to the body's *up* axis, which for a
 * nose-vertical vehicle is horizontal and perfectly well defined. Blended
 * rather than switched, so an aircraft pitching up through vertical does not
 * get a camera jump at the crossover.
 */
function headingOf(orientation: Quaternion, into: Quaternion): Quaternion {
  const { x, y, z, w } = orientation;

  // Body +Z (aft) in world, horizontal components.
  const aftX = 2 * (x * z + w * y);
  const aftZ = 1 - 2 * (x * x + y * y);
  const horizontal = Math.hypot(aftX, aftZ);

  let headingX = aftX;
  let headingZ = aftZ;

  if (horizontal < NEARLY_VERTICAL) {
    // Body +Y (up) in world, horizontal components.
    const upX = 2 * (x * y - w * z);
    const upZ = 2 * (y * z + w * x);
    const blend = horizontal / NEARLY_VERTICAL;
    headingX = aftX * blend + upX * (1 - blend);
    headingZ = aftZ * blend + upZ * (1 - blend);
  }

  return into.setFromAxisAngle(UP, Math.atan2(headingX, headingZ));
}
