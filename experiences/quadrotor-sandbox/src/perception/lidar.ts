import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  Vector3,
} from "three";
import type { PhysicsWorld } from "../sim/physics";
import type { DroneState } from "../sim/state";

/**
 * A sweeping rangefinder that builds a point cloud of what the aircraft has
 * seen.
 *
 * Rays are cast through the same physics world the aircraft collides with, so
 * the cloud reflects the collision geometry rather than the render meshes —
 * which is exactly what a real sensor rig would be checked against, and makes
 * any mismatch between the two visible rather than hidden.
 *
 * Points live in a fixed ring buffer written in place. A growing array would
 * mean reallocating a GPU buffer mid-flight; the ring keeps the newest
 * `CAPACITY` returns at a constant cost and lets old ones fade out naturally.
 */

const CAPACITY = 12000;
/** Rays cast per simulation step. */
const RAYS_PER_STEP = 3;
/** Sweep rate around the vertical axis, radians per second. */
const SWEEP_RATE = 7.5;
/** Maximum sensing range, metres. */
const RANGE = 45;
/** Vertical fan half-angle, radians. */
const FAN = (14 * Math.PI) / 180;

export class Lidar {
  readonly points: Points;
  enabled = true;

  /** Distance to the ground directly below, metres, or null out of range. */
  altitudeAgl: number | null = null;

  private readonly positions: Float32Array;
  private readonly geometry: BufferGeometry;
  private write = 0;
  private filled = 0;
  private angle = 0;

  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly hit = new Vector3();

  /** Callback invoked for every return, used to feed the occupancy grid. */
  onReturn: ((point: Vector3) => void) | null = null;

  constructor() {
    this.positions = new Float32Array(CAPACITY * 3);

    this.geometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(this.positions, 3);
    positionAttribute.setUsage(35048 /* DynamicDrawUsage */);
    this.geometry.setAttribute("position", positionAttribute);
    this.geometry.setDrawRange(0, 0);

    this.points = new Points(
      this.geometry,
      new PointsMaterial({
        color: 0x63d0ff,
        size: 0.13,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.75,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  reset() {
    this.write = 0;
    this.filled = 0;
    this.angle = 0;
    this.geometry.setDrawRange(0, 0);
  }

  update(state: DroneState, physics: PhysicsWorld, dt: number) {
    this.origin.copy(state.position);

    // The downward rangefinder runs whether or not the sweep is drawn: it is a
    // single ray feeding an altitude readout, not part of the overlay.
    this.altitudeAgl = physics.castDown(this.origin, 120);

    if (!this.enabled) return;

    for (let i = 0; i < RAYS_PER_STEP; i += 1) {
      this.angle += SWEEP_RATE * (dt / RAYS_PER_STEP);

      // Fan the beam vertically as it sweeps so successive revolutions sample
      // different heights instead of retracing one flat ring.
      const pitch = Math.sin(this.angle * 0.37) * FAN;
      const cosPitch = Math.cos(pitch);
      this.direction.set(
        Math.sin(this.angle) * cosPitch,
        Math.sin(pitch),
        Math.cos(this.angle) * cosPitch,
      );

      const distance = physics.castRay(this.origin, this.direction, RANGE);
      if (distance === null) continue;

      this.hit.copy(this.origin).addScaledVector(this.direction, distance);
      this.record(this.hit);
      this.onReturn?.(this.hit);
    }

    this.geometry.setDrawRange(0, this.filled);
    this.geometry.attributes.position.needsUpdate = true;
  }

  private record(point: Vector3) {
    const offset = this.write * 3;
    this.positions[offset] = point.x;
    this.positions[offset + 1] = point.y;
    this.positions[offset + 2] = point.z;

    this.write = (this.write + 1) % CAPACITY;
    if (this.filled < CAPACITY) this.filled += 1;
  }

  dispose() {
    this.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}
