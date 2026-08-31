import type { YardGeometry } from './YardGeometry';

export const AXIS_NONE = 0;
/** Mown while travelling along Z. */
export const AXIS_NS = 1;
/** Mown while travelling along X. */
export const AXIS_EW = 2;

/** Re-entering a cell sooner than this is the deck still sweeping past, not a second pass. */
const REVISIT_SECONDS = 1.0;

export type CoverageMetrics = {
  coverage: number;
  patternNs: number;
  patternEw: number;
  patternCross: number;
  overlap: number;
  cutCells: number;
  mowableCells: number;
};

/**
 * The CPU-side source of truth for scoring.
 *
 * The GPU paint mask exists to look right; this grid exists to be correct.
 * Both are stamped from the same swept-capsule math in {@link stamp} so they
 * cannot drift apart.
 */
export class CoverageGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly mowableCells: number;

  private readonly minX: number;
  private readonly minZ: number;
  private readonly mowable: Uint8Array;
  private readonly cut: Uint8Array;
  private readonly lastAxis: Uint8Array;
  private readonly axisFlags: Uint8Array;
  private readonly lastVisit: Float32Array;
  private readonly overlapped: Uint8Array;

  private cutCount = 0;
  private overlapCount = 0;

  constructor(yard: YardGeometry, cellsPerMeter = 6) {
    const bounds = yard.bounds;
    this.cellSize = 1 / cellsPerMeter;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.cols = Math.ceil(bounds.width * cellsPerMeter);
    this.rows = Math.ceil(bounds.depth * cellsPerMeter);

    const total = this.cols * this.rows;
    this.mowable = new Uint8Array(total);
    this.cut = new Uint8Array(total);
    this.lastAxis = new Uint8Array(total);
    this.axisFlags = new Uint8Array(total);
    this.lastVisit = new Float32Array(total);
    this.overlapped = new Uint8Array(total);

    let mowableCells = 0;
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const x = this.minX + (col + 0.5) * this.cellSize;
        const z = this.minZ + (row + 0.5) * this.cellSize;
        if (yard.isMowable(x, z)) {
          this.mowable[row * this.cols + col] = 1;
          mowableCells += 1;
        }
      }
    }
    this.mowableCells = mowableCells;
  }

  reset(): void {
    this.cut.fill(0);
    this.lastAxis.fill(0);
    this.axisFlags.fill(0);
    this.lastVisit.fill(-999);
    this.overlapped.fill(0);
    this.cutCount = 0;
    this.overlapCount = 0;
  }

  /**
   * Mark everything within `radius` of the segment (x0,z0)->(x1,z1) as cut.
   * `now` is level time in seconds and is what separates "the deck is still
   * passing over this" from "you drove here again".
   */
  stamp(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    radius: number,
    axis: number,
    now: number,
  ): void {
    const minCol = this.clampCol(Math.floor((Math.min(x0, x1) - radius - this.minX) / this.cellSize));
    const maxCol = this.clampCol(Math.ceil((Math.max(x0, x1) + radius - this.minX) / this.cellSize));
    const minRow = this.clampRow(Math.floor((Math.min(z0, z1) - radius - this.minZ) / this.cellSize));
    const maxRow = this.clampRow(Math.ceil((Math.max(z0, z1) + radius - this.minZ) / this.cellSize));

    const dx = x1 - x0;
    const dz = z1 - z0;
    const lengthSq = dx * dx + dz * dz;
    const radiusSq = radius * radius;

    for (let row = minRow; row <= maxRow; row += 1) {
      const z = this.minZ + (row + 0.5) * this.cellSize;
      for (let col = minCol; col <= maxCol; col += 1) {
        const index = row * this.cols + col;
        if (!this.mowable[index]) continue;

        const x = this.minX + (col + 0.5) * this.cellSize;
        let t = 0;
        if (lengthSq > 1e-9) {
          t = ((x - x0) * dx + (z - z0) * dz) / lengthSq;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
        }
        const px = x0 + dx * t - x;
        const pz = z0 + dz * t - z;
        if (px * px + pz * pz > radiusSq) continue;

        if (this.cut[index] === 0) {
          this.cut[index] = 1;
          this.cutCount += 1;
        } else if (
          this.overlapped[index] === 0 &&
          now - this.lastVisit[index] > REVISIT_SECONDS
        ) {
          this.overlapped[index] = 1;
          this.overlapCount += 1;
        }

        this.lastVisit[index] = now;
        this.lastAxis[index] = axis;
        this.axisFlags[index] |= axis;
      }
    }
  }

  /** 1 where the grass is already cut, 0 where it is still tall. */
  cutAt(x: number, z: number): number {
    const index = this.indexAt(x, z);
    return index < 0 ? 0 : this.cut[index];
  }

  /** Live coverage for the HUD, without a full rescan. */
  get coverage(): number {
    return this.mowableCells === 0 ? 0 : this.cutCount / this.mowableCells;
  }

  metrics(): CoverageMetrics {
    let cutCells = 0;
    let ns = 0;
    let ew = 0;
    let cross = 0;

    for (let i = 0; i < this.cut.length; i += 1) {
      if (!this.mowable[i] || !this.cut[i]) continue;
      cutCells += 1;
      if (this.lastAxis[i] === AXIS_NS) ns += 1;
      if (this.lastAxis[i] === AXIS_EW) ew += 1;
      if (this.axisFlags[i] === (AXIS_NS | AXIS_EW)) cross += 1;
    }

    const safeCut = Math.max(1, cutCells);
    return {
      coverage: this.mowableCells === 0 ? 0 : cutCells / this.mowableCells,
      patternNs: ns / safeCut,
      patternEw: ew / safeCut,
      patternCross: cross / safeCut,
      overlap: this.overlapCount / safeCut,
      cutCells,
      mowableCells: this.mowableCells,
    };
  }

  private indexAt(x: number, z: number): number {
    const col = Math.floor((x - this.minX) / this.cellSize);
    const row = Math.floor((z - this.minZ) / this.cellSize);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  private clampCol(value: number): number {
    return value < 0 ? 0 : value >= this.cols ? this.cols - 1 : value;
  }

  private clampRow(value: number): number {
    return value < 0 ? 0 : value >= this.rows ? this.rows - 1 : value;
  }
}
