import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Vector3,
} from "three";
import type { DroneState } from "../sim/state";

/**
 * A fading ribbon tracing where the aircraft has been.
 *
 * More than decoration: a quad correcting badly leaves a visibly scalloped
 * trail, so the path is a readout of the tune in its own right. Switch to the
 * detuned preset and the line stops being smooth.
 *
 * Points are appended at a fixed spatial interval rather than every frame, so
 * the trail has consistent detail whether the aircraft is hovering or moving
 * at 14 m/s, and a hover does not burn the whole buffer standing still.
 */

const CAPACITY = 900;
/** Minimum distance between recorded points, metres. */
const STEP = 0.06;

export class MotionTrail {
  readonly line: Line;
  enabled = true;

  private readonly positions: Float32Array;
  private readonly geometry: BufferGeometry;
  private count = 0;
  private readonly last = new Vector3();
  private primed = false;

  constructor() {
    this.positions = new Float32Array(CAPACITY * 3);

    this.geometry = new BufferGeometry();
    const attribute = new BufferAttribute(this.positions, 3);
    attribute.setUsage(35048 /* DynamicDrawUsage */);
    this.geometry.setAttribute("position", attribute);
    this.geometry.setDrawRange(0, 0);

    this.line = new Line(
      this.geometry,
      new LineBasicMaterial({
        color: 0xe08a3c,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.line.frustumCulled = false;
  }

  reset() {
    this.count = 0;
    this.primed = false;
    this.geometry.setDrawRange(0, 0);
  }

  update(state: DroneState) {
    if (!this.enabled) return;

    if (this.primed && this.last.distanceToSquared(state.position) < STEP * STEP) {
      return;
    }
    this.last.copy(state.position);
    this.primed = true;

    if (this.count === CAPACITY) {
      // Slide the window: drop the oldest point and keep the newest.
      this.positions.copyWithin(0, 3);
      this.count -= 1;
    }

    const offset = this.count * 3;
    this.positions[offset] = state.position.x;
    this.positions[offset + 1] = state.position.y;
    this.positions[offset + 2] = state.position.z;
    this.count += 1;

    this.geometry.setDrawRange(0, this.count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.geometry.dispose();
    (this.line.material as LineBasicMaterial).dispose();
  }
}
