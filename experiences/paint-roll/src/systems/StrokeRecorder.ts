import { Color } from 'three';
import type { StampInput } from './PaintTarget';

/** Floats per recorded stamp: t, surface, u, v, rot, w, d, r, g, b, a. */
const STRIDE = 11;
const INITIAL_CAPACITY = 4096;

/**
 * Append-only log of every stamp that was actually drawn, across every surface.
 *
 * Because the render targets hold all paint state, replaying the room is just
 * "clear them, re-stamp this log faster". No snapshots, no second buffer.
 */
export class StrokeRecorder {
  private data = new Float32Array(INITIAL_CAPACITY * STRIDE);
  private length = 0;
  private strokeCount = 0;
  private penDown = false;

  get count(): number {
    return this.length;
  }

  /** Distinct strokes, i.e. how many times the roller was put to a surface. */
  get strokes(): number {
    return this.strokeCount;
  }

  get durationMs(): number {
    return this.length === 0 ? 0 : this.data[(this.length - 1) * STRIDE];
  }

  /** Called when the roller leaves a surface, so the next contact is a new stroke. */
  liftPen(): void {
    this.penDown = false;
  }

  record(timeMs: number, surfaceIndex: number, stamp: StampInput): void {
    if (!this.penDown) {
      this.penDown = true;
      this.strokeCount += 1;
    }

    if ((this.length + 1) * STRIDE > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }

    const o = this.length * STRIDE;
    this.data[o] = timeMs;
    this.data[o + 1] = surfaceIndex;
    this.data[o + 2] = stamp.x;
    this.data[o + 3] = stamp.y;
    this.data[o + 4] = stamp.rotation;
    this.data[o + 5] = stamp.width;
    this.data[o + 6] = stamp.depth;
    this.data[o + 7] = stamp.color.r;
    this.data[o + 8] = stamp.color.g;
    this.data[o + 9] = stamp.color.b;
    this.data[o + 10] = stamp.alpha;
    this.length += 1;
  }

  reset(): void {
    this.length = 0;
    this.strokeCount = 0;
    this.penDown = false;
  }

  /**
   * Emit every stamp recorded up to `timeMs`, starting at `cursor`.
   * Returns the new cursor.
   */
  replayUntil(
    timeMs: number,
    cursor: number,
    scratch: Color,
    emit: (surfaceIndex: number, stamp: StampInput) => boolean,
  ): number {
    let index = cursor;
    while (index < this.length) {
      const o = index * STRIDE;
      if (this.data[o] > timeMs) break;

      scratch.setRGB(this.data[o + 7], this.data[o + 8], this.data[o + 9]);
      const accepted = emit(this.data[o + 1], {
        x: this.data[o + 2],
        y: this.data[o + 3],
        rotation: this.data[o + 4],
        width: this.data[o + 5],
        depth: this.data[o + 6],
        color: scratch,
        alpha: this.data[o + 10],
      });
      // Paint targets have a per-frame stamp budget; stop and resume next frame.
      if (!accepted) break;
      index += 1;
    }
    return index;
  }
}
