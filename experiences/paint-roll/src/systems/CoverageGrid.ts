/**
 * CPU-side scoring mirror of the paint render target.
 *
 * Reading pixels back off the GPU to score coverage stalls the pipeline and
 * hitches visibly, so the same stroke path that queues GPU stamps also
 * rasterises them into this coarse grid. The grid is the only source of truth
 * for the coverage percentage; the render target is only ever the picture.
 */
export class CoverageGrid {
  readonly cols: number;
  readonly rows: number;

  private readonly value: Uint8Array;
  private readonly counted: Uint8Array;
  /** Cells that count toward completion. A v2 mask layer would clear entries here. */
  private readonly paintable: Uint8Array;

  private paintableCells: number;
  private coveredCells = 0;

  private readonly cellWidth: number;
  private readonly cellHeight: number;

  /**
   * A cell counts as covered above this accumulated alpha. Deliberately low:
   * finishing a wall should not turn into hunting for three stray pixels.
   */
  private readonly threshold = 120;

  constructor(
    readonly worldWidth: number,
    readonly worldHeight: number,
    longAxisCells = 132,
  ) {
    this.cols = longAxisCells;
    this.rows = Math.max(
      8,
      Math.round(longAxisCells * (worldHeight / worldWidth)),
    );
    const total = this.cols * this.rows;

    this.value = new Uint8Array(total);
    this.counted = new Uint8Array(total);
    this.paintable = new Uint8Array(total).fill(1);
    this.paintableCells = total;

    this.cellWidth = worldWidth / this.cols;
    this.cellHeight = worldHeight / this.rows;
  }

  /** 0..1. */
  get coverage(): number {
    return this.paintableCells === 0 ? 1 : this.coveredCells / this.paintableCells;
  }

  get isComplete(): boolean {
    // 99.5% reads as done. The last handful of cells are sub-pixel slivers at
    // the wall border and chasing them is not gameplay.
    return this.coverage >= 0.995;
  }

  reset(): void {
    this.value.fill(0);
    this.counted.fill(0);
    this.coveredCells = 0;
  }

  /**
   * Rasterise one roller footprint. Extents are shrunk slightly against the
   * shader's feathered edge so scoring tracks what the player can actually see
   * rather than the stamp's mathematical bounding box.
   */
  stamp(
    centreX: number,
    centreY: number,
    width: number,
    depth: number,
    rotation: number,
    alpha: number,
  ): void {
    if (alpha <= 0.02) return;

    const halfW = (width * 0.9) / 2;
    const halfD = (depth * 0.9) / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // AABB of the rotated rect, so we only visit cells that can possibly hit.
    const extentX = Math.abs(halfW * cos) + Math.abs(halfD * sin);
    const extentY = Math.abs(halfW * sin) + Math.abs(halfD * cos);

    const minCol = Math.max(0, Math.floor((centreX - extentX) / this.cellWidth));
    const maxCol = Math.min(
      this.cols - 1,
      Math.floor((centreX + extentX) / this.cellWidth),
    );
    const minRow = Math.max(0, Math.floor((centreY - extentY) / this.cellHeight));
    const maxRow = Math.min(
      this.rows - 1,
      Math.floor((centreY + extentY) / this.cellHeight),
    );
    if (minCol > maxCol || minRow > maxRow) return;

    const add = Math.min(255, Math.round(alpha * 255));

    for (let row = minRow; row <= maxRow; row += 1) {
      const cellY = (row + 0.5) * this.cellHeight - centreY;
      for (let col = minCol; col <= maxCol; col += 1) {
        const cellX = (col + 0.5) * this.cellWidth - centreX;

        // Rotate the cell centre into the stamp's local frame.
        const localX = cellX * cos + cellY * sin;
        const localY = -cellX * sin + cellY * cos;
        if (Math.abs(localX) > halfW || Math.abs(localY) > halfD) continue;

        const index = row * this.cols + col;
        if (this.paintable[index] === 0) continue;

        // Same "over" accumulation the GPU does, in 8-bit.
        const previous = this.value[index];
        const next = previous + ((add * (255 - previous)) / 255);
        this.value[index] = next > 255 ? 255 : next;

        if (this.counted[index] === 0 && this.value[index] >= this.threshold) {
          this.counted[index] = 1;
          this.coveredCells += 1;
        }
      }
    }
  }
}
