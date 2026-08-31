import {
  Color,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { CoverageGrid } from '../systems/CoverageGrid';
import { PaintTarget, type StampInput } from '../systems/PaintTarget';
import type { StrokeRecorder } from '../systems/StrokeRecorder';
import { attachPaintComposite, type PaintCompositeHandle } from '../systems/WallMaterial';
import type { SurfacePlacement } from '../game/room';

export interface RollOptions {
  readonly color: Color;
  /** 0..1. Low values are the dry-brush streaks left by an empty roller. */
  readonly alpha: number;
  readonly sleeveWidth: number;
  readonly contactDepth: number;
  /** Wall-clock ms since the run started, for the time-lapse log. */
  readonly timeMs: number;
  readonly recorder?: StrokeRecorder;
}

export interface RollResult {
  /** Square metres swept this call, used to drain the roller. */
  readonly areaRolled: number;
  readonly stamps: number;
}

/**
 * One paintable surface: geometry, its grime material, its paint layer, and its
 * score grid.
 *
 * A surface knows only its own placement, so all four walls are the same class
 * at different transforms. Nothing here special-cases which wall it is.
 */
export class Surface {
  readonly mesh: Mesh;
  readonly paint: PaintTarget;
  readonly grid: CoverageGrid;
  readonly composite: PaintCompositeHandle;

  private lastRotation = Math.PI / 2;
  private readonly scratchColor = new Color();

  constructor(
    readonly placement: SurfacePlacement,
    readonly material: MeshStandardMaterial,
    paintResolution: number,
  ) {
    const { width, height } = placement;
    this.paint = new PaintTarget(width, height, paintResolution);
    this.grid = new CoverageGrid(width, height);
    this.composite = attachPaintComposite(material, this.paint.texture);

    const geometry = new PlaneGeometry(width, height, 1, 1);
    this.mesh = new Mesh(geometry, material);

    // Orient from the placement's own basis, then offset so surface-local (0,0)
    // lands on `origin` rather than on the plane's centre.
    const basis = new Matrix4().makeBasis(
      placement.right,
      placement.up,
      placement.normal,
    );
    this.mesh.quaternion.setFromRotationMatrix(basis);
    this.mesh.position
      .copy(placement.origin)
      .addScaledVector(placement.right, width / 2)
      .addScaledVector(placement.up, height / 2);
    this.mesh.receiveShadow = true;
  }

  get width(): number {
    return this.placement.width;
  }

  get height(): number {
    return this.placement.height;
  }

  get coverage(): number {
    return this.grid.coverage;
  }

  get area(): number {
    return this.placement.width * this.placement.height;
  }

  /** Sleeve angle of the most recent stroke, in surface-local radians. */
  get strokeRotation(): number {
    return this.lastRotation;
  }

  /** Surface-local metres to world space. */
  toWorld(u: number, v: number, out = new Vector3()): Vector3 {
    return out
      .copy(this.placement.origin)
      .addScaledVector(this.placement.right, u)
      .addScaledVector(this.placement.up, v);
  }

  contains(u: number, v: number): boolean {
    return u >= 0 && u <= this.width && v >= 0 && v <= this.height;
  }

  /**
   * Lay paint from one point to another.
   *
   * The interpolation is the whole reason a fast swipe reads as a continuous
   * band instead of a dotted line: stamps are spaced at a fraction of the
   * roller's contact depth regardless of how far the roller moved this step.
   */
  roll(
    fromU: number | null,
    fromV: number | null,
    toU: number,
    toV: number,
    options: RollOptions,
  ): RollResult {
    const { color, alpha, sleeveWidth, contactDepth, timeMs, recorder } = options;

    const hasPrevious = fromU !== null && fromV !== null;
    const du = hasPrevious ? toU - fromU : 0;
    const dv = hasPrevious ? toV - fromV : 0;
    const distance = Math.hypot(du, dv);

    if (distance > 1e-5) {
      // A real roller's sleeve axis sits perpendicular to the direction it is
      // pushed, so every stroke direction lays the same wide band.
      this.lastRotation = Math.atan2(dv, du) + Math.PI / 2;
    }

    const step = contactDepth * 0.4;
    const segments = distance > 1e-5
      ? Math.min(96, Math.max(1, Math.ceil(distance / step)))
      : 1;

    let stamps = 0;
    for (let i = 1; i <= segments; i += 1) {
      if (!this.paint.hasRoom) break;
      const t = segments === 1 ? 1 : i / segments;
      const u = hasPrevious ? fromU + du * t : toU;
      const v = hasPrevious ? fromV + dv * t : toV;

      const stamp: StampInput = {
        x: u,
        y: v,
        width: sleeveWidth,
        depth: contactDepth,
        rotation: this.lastRotation,
        color,
        alpha,
      };

      this.paint.queue(stamp);
      this.grid.stamp(u, v, sleeveWidth, contactDepth, this.lastRotation, alpha);
      recorder?.record(timeMs, this.placement.index, stamp);
      stamps += 1;
    }

    // Charge for the swept band, plus the footprint itself on first contact,
    // so the meter tracks work done rather than input speed.
    const areaRolled = distance * sleeveWidth
      + (hasPrevious ? 0 : sleeveWidth * contactDepth);

    return { areaRolled, stamps };
  }

  /** Re-stamp a recorded stamp during time-lapse playback. */
  replayStamp(stamp: StampInput): boolean {
    if (!this.paint.hasRoom) return false;
    this.paint.queue(stamp);
    return true;
  }

  flush(renderer: WebGLRenderer): void {
    this.paint.flush(renderer);
  }

  /** Wipe back to bare grime, for restart and for the replay. */
  clearPaint(renderer: WebGLRenderer, resetScore: boolean): void {
    this.paint.clear(renderer);
    if (resetScore) this.grid.reset();
  }

  get scratch(): Color {
    return this.scratchColor;
  }

  dispose(): void {
    this.paint.dispose();
    this.mesh.geometry.dispose();
    // These are per-surface clones made so each surface can carry its own
    // tiling; disposing the material alone would leak every map.
    this.material.map?.dispose();
    this.material.normalMap?.dispose();
    this.material.roughnessMap?.dispose();
    this.material.metalnessMap?.dispose();
    this.material.dispose();
  }
}
