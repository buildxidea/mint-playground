/**
 * The declared spatial basis for this simulation (spatial-contracts.md, §1
 * "Declare The Basis"). Dynamics, physics, cameras, perception and UI all read
 * their conventions from here rather than each carrying private assumptions.
 *
 *   units          metres, kilograms, seconds, radians
 *   handedness     right-handed
 *   world up       +Y
 *   world right    +X
 *   world forward  -Z
 *
 * The body frame coincides with the world frame at identity orientation: the
 * aircraft's up is body +Y and its nose points along body -Z.
 *
 * `sim/state.ts` owns the canonical transform. The three.js Object3D and the
 * Rapier rigid body are both projections of that state and never write back
 * into it, except through the explicit crash handoff in `sim/crash.ts`.
 */

/** Standard gravity magnitude (m/s^2). Acts along world -Y. */
export const GRAVITY = 9.80665;

/** Sea-level air density (kg/m^3), used by the drag and wind model. */
export const AIR_DENSITY = 1.225;

export const WORLD_UP = Object.freeze({ x: 0, y: 1, z: 0 });
export const WORLD_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
export const WORLD_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });

/**
 * Body-frame axis each control channel rotates about, in the order the mixer
 * and rate controller use. Kept here so the sign conventions are stated once:
 *
 *   roll   about body -Z, positive = right side down
 *   pitch  about body +X, positive = nose up
 *   yaw    about body +Y, positive = nose left (counter-clockwise seen from above)
 */
export const AXIS_ORDER = Object.freeze(["roll", "pitch", "yaw"] as const);

export type AxisName = (typeof AXIS_ORDER)[number];
