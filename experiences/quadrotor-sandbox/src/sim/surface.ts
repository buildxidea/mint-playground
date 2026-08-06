import { Vector3 } from "three";
import type { PhysicsWorld } from "./physics";

/**
 * What is underneath the aircraft.
 *
 * Both flight models used to assume the world was a plane at y = 0 — the quad
 * clamped to a constant and the fixed-wing's terrain sampler returned zero
 * everywhere. Every building in the city was a collider you bounced off, never
 * a surface you could rest on: approach a roof slowly enough not to crash and
 * you sank straight through it.
 *
 * This asks the physics world instead. The ray already exists and already
 * excludes the aircraft's own collider, so a rooftop, the runway and the
 * street are all just "the first thing below you".
 */

/**
 * How far down to look. Beyond this the aircraft is treated as being over
 * nothing — which, over the flat city floor, never happens, but the fall-back
 * keeps the constraint defined rather than leaving it to a null.
 */
const MAX_DROP = 400;

/**
 * Start the ray this far above the query point.
 *
 * A ray cast from exactly the aircraft's origin while it is resting starts
 * inside its own clearance and can miss a surface it is already touching at
 * grazing incidence — the same class of problem as the heightfield probes
 * missing at exact lattice points. Starting above the aircraft and subtracting
 * the lift afterwards side-steps it entirely.
 */
const PROBE_LIFT = 1;

const probe = new Vector3();

/**
 * Height of the first surface below `(x, z)`, searching down from `fromY`.
 *
 * Returns `null` when nothing is within range, which callers should read as
 * "no support here" rather than "the ground is at zero".
 */
export function surfaceHeightAt(
  physics: PhysicsWorld,
  x: number,
  fromY: number,
  z: number,
): number | null {
  probe.set(x, fromY + PROBE_LIFT, z);
  const distance = physics.castDown(probe, MAX_DROP);
  return distance === null ? null : probe.y - distance;
}

/**
 * A terrain sampler for `stepAirplane`, bound to the aircraft's own altitude.
 *
 * The fixed-wing model asks for terrain height as a function of `(x, z)` only,
 * but a ray needs somewhere to start. Reading the altitude through a getter
 * rather than capturing it means the sampler stays correct across the whole
 * flight instead of being pinned to wherever the aircraft was when it was
 * built.
 */
export function makeGroundSampler(
  physics: PhysicsWorld,
  altitude: () => number,
): (x: number, z: number) => number {
  return (x, z) => surfaceHeightAt(physics, x, altitude(), z) ?? 0;
}
