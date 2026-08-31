import * as THREE from 'three';
import type { Bounds } from './YardGeometry';

/** Elevation above the horizon for play. Steep enough to read the whole yard,
 *  shallow enough that props keep some volume. */
const ELEVATION = THREE.MathUtils.degToRad(70);
/** How much of the frame the yard is allowed to fill. */
const FIT_MARGIN = 0.88;
/** Prop height included in the fit so a tree never clips the top of frame. */
const PROP_HEIGHT = 2.6;

/** The landing page shot: low and close so the mower reads as a real object. */
const HERO_DIRECTION = new THREE.Vector3(0.62, 0.46, 1).normalize();
const HERO_DISTANCE = 6.3;
/** How far left of the mower the camera looks, which pushes the mower to the
 *  right of frame and leaves the left side clear for the wordmark. */
const HERO_SHIFT = 2.1;

type Mode = 'fit' | 'hero' | 'pan';

/**
 * A fixed camera per level: no follow, no orbit. It frames the whole yard while
 * playing, poses a hero shot of the mower on the landing page, and pans across
 * the finished stripes at the end of a yard.
 */
export class CameraRig {
  private readonly direction = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
  private readonly heroDirection = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly heroTarget = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private bounds: Bounds | null = null;
  private distance = 30;
  private panProgress = 0;
  private mode: Mode = 'fit';
  private heroTime = 0;
  private heroShift = HERO_SHIFT;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  frame(bounds: Bounds): void {
    this.bounds = bounds;
    this.center.set(bounds.centerX, 0, bounds.centerZ);
    this.distance = this.fitDistance(bounds);
    this.mode = 'fit';
    this.panProgress = 0;
    this.apply();
  }

  /** Pose the landing page shot around the parked mower. */
  frameHero(mowerX: number, mowerZ: number): void {
    this.mode = 'hero';
    this.heroTime = 0;
    this.heroTarget.set(mowerX, 0.45, mowerZ);
    this.updateHeroShift();
    this.apply();
  }

  /** Recompute on resize; both framings depend on the aspect ratio. */
  refit(): void {
    if (this.bounds) this.distance = this.fitDistance(this.bounds);
    this.updateHeroShift();
    this.apply();
  }

  startPan(): void {
    this.mode = 'pan';
    this.panProgress = 0;
  }

  stopPan(): void {
    if (this.mode === 'pan') this.mode = 'fit';
    this.panProgress = 0;
    this.apply();
  }

  update(delta: number): void {
    if (this.mode === 'pan') {
      this.panProgress = Math.min(1, this.panProgress + delta / 6);
      this.apply();
      return;
    }
    if (this.mode === 'hero') {
      this.heroTime += delta;
      this.apply();
    }
  }

  private apply(): void {
    if (this.mode === 'hero') {
      // A slow drift keeps the landing page from looking like a still image.
      const yaw = Math.sin(this.heroTime * 0.16) * 0.16;
      this.heroDirection.copy(HERO_DIRECTION).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);

      // The camera's right vector, from cross(forward, up) with forward = -dir.
      this.right.set(this.heroDirection.z, 0, -this.heroDirection.x).normalize();

      this.lookAt.copy(this.heroTarget).addScaledVector(this.right, -this.heroShift);
      this.camera.position
        .copy(this.heroTarget)
        .addScaledVector(this.heroDirection, HERO_DISTANCE + Math.sin(this.heroTime * 0.23) * 0.35);
      this.camera.lookAt(this.lookAt);
      this.camera.updateMatrixWorld();
      return;
    }

    if (!this.bounds) return;

    if (this.mode === 'pan') {
      // Drift from the far edge to the near edge, closer in, so the stripes
      // sweep past the camera at the end of a yard.
      const eased = this.panProgress * this.panProgress * (3 - 2 * this.panProgress);
      const z = THREE.MathUtils.lerp(this.bounds.minZ + 2, this.bounds.maxZ - 2, eased);
      this.lookAt.set(this.bounds.centerX, 0, z);
      this.camera.position.copy(this.lookAt).addScaledVector(this.direction, this.distance * 0.62);
    } else {
      this.lookAt.copy(this.center);
      this.camera.position.copy(this.center).addScaledVector(this.direction, this.distance);
    }

    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
  }

  /** Below the layout's breakpoint the hero text centres over the mower, so
   *  stop pushing the mower sideways or it walks out of frame. Keyed to the
   *  same 900px the stylesheet uses, so the two never disagree. */
  private updateHeroShift(): void {
    const wide = typeof window !== 'undefined' && window.innerWidth >= 900;
    this.heroShift = wide ? HERO_SHIFT : 0;
  }

  /**
   * Iterative fit: project the yard's corners at a candidate distance and scale
   * until the widest corner sits at the margin.
   */
  private fitDistance(bounds: Bounds): number {
    const corners: THREE.Vector3[] = [];
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        corners.push(new THREE.Vector3(x, 0, z));
        corners.push(new THREE.Vector3(x, PROP_HEIGHT, z));
      }
    }

    const center = new THREE.Vector3(bounds.centerX, 0, bounds.centerZ);
    const probe = this.camera.clone();
    let distance = Math.max(bounds.width, bounds.depth) * 1.2;

    for (let iteration = 0; iteration < 8; iteration += 1) {
      probe.position.copy(center).addScaledVector(this.direction, distance);
      probe.lookAt(center);
      probe.updateMatrixWorld(true);
      probe.updateProjectionMatrix();

      let extent = 0;
      const projected = new THREE.Vector3();
      for (const corner of corners) {
        projected.copy(corner).project(probe);
        extent = Math.max(extent, Math.abs(projected.x), Math.abs(projected.y));
      }
      if (extent < 1e-4) break;
      distance *= extent / FIT_MARGIN;
    }

    return distance;
  }
}
