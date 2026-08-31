import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Axis, Vec3i } from "../cube/constants";
import { CubeView } from "../cube/geometry";
import { MoveEngine } from "../cube/moves";
import { Cubie } from "../cube/state";

/** Pointer travel that counts as a deliberate drag rather than a click. */
const LOCK_THRESHOLD_PX = 8;

/** Pixels of drag that correspond to a 90 degree turn. */
const PIXELS_PER_QUARTER = 110;

const QUARTER = Math.PI / 2;

interface Grab {
  pointerId: number;
  startX: number;
  startY: number;
  cubie: Cubie;
  /** Face normal in cube space, snapped to a signed unit axis. */
  normal: Vec3i;
  point: THREE.Vector3;
}

interface Lock {
  axis: Axis;
  /** +1 or -1: maps drag along the tangent to rotation about the +axis. */
  sign: number;
  /** Screen-space unit direction of the chosen tangent. */
  screenTangent: THREE.Vector2;
}

/**
 * Turns a drag that starts ON the cube into a live layer rotation.
 *
 * Which of the two possible layers a drag turns is genuinely ambiguous from
 * the hit alone, so it is resolved from the drag direction: the two in-plane
 * tangents of the hit face are projected to the screen, the one the drag
 * matches best is chosen, and the rotation axis is perpendicular to both that
 * tangent and the face normal.
 */
export class LayerDragger {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private grab: Grab | null = null;
  private lock: Lock | null = null;

  /** Set false to ignore input during scrambles and solution playback. */
  enabled = true;

  constructor(
    private readonly domElement: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly view: CubeView,
    private readonly engine: MoveEngine,
    private readonly orbit: OrbitControls,
  ) {
    // Capture phase so the decision to suppress orbit is made before
    // OrbitControls sees the same pointerdown.
    domElement.addEventListener("pointerdown", this.onPointerDown, {
      capture: true,
    });
    domElement.addEventListener("pointermove", this.onPointerMove);
    domElement.addEventListener("pointerup", this.onPointerUp);
    domElement.addEventListener("pointercancel", this.onPointerUp);
  }

  dispose(): void {
    this.domElement.removeEventListener("pointerdown", this.onPointerDown, {
      capture: true,
    });
    this.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.domElement.removeEventListener("pointercancel", this.onPointerUp);
  }

  private setNdc(event: PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    this.ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.engine.isBusy) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;

    this.setNdc(event);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.view.pickTargets(), true);
    if (hits.length === 0) return; // Empty space: let OrbitControls have it.

    const hit = hits[0];
    const cubie = this.view.cubieFromObject(hit.object);
    if (!cubie || !hit.face) return;

    const normal = hit.face.normal
      .clone()
      .transformDirection(hit.object.matrixWorld);

    this.grab = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cubie,
      normal: snapToAxis(normal),
      point: hit.point.clone(),
    };
    this.lock = null;

    // The cube owns this gesture, not the camera.
    this.orbit.enabled = false;
    capturePointer(this.domElement, event.pointerId, true);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const grab = this.grab;
    if (!grab || event.pointerId !== grab.pointerId) return;

    const dx = event.clientX - grab.startX;
    const dy = event.clientY - grab.startY;

    if (!this.lock) {
      if (Math.hypot(dx, dy) < LOCK_THRESHOLD_PX) return;
      this.lock = this.resolveLock(grab, dx, dy);
      if (!this.lock) return;
      this.engine.beginManual(this.lock.axis, grab.cubie.pos[this.lock.axis]);
    }

    const along = dx * this.lock.screenTangent.x + dy * this.lock.screenTangent.y;
    const angle = (along / PIXELS_PER_QUARTER) * QUARTER * this.lock.sign;
    this.engine.setManualAngle(angle);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const grab = this.grab;
    if (!grab || event.pointerId !== grab.pointerId) return;

    if (this.lock) this.engine.endManual();
    this.grab = null;
    this.lock = null;
    this.orbit.enabled = true;
    capturePointer(this.domElement, event.pointerId, false);
  };

  /**
   * Pick the in-plane tangent the drag best matches, then derive the rotation
   * axis from it.
   */
  private resolveLock(grab: Grab, dx: number, dy: number): Lock | null {
    const dragLength = Math.hypot(dx, dy);
    if (dragLength === 0) return null;
    const dragX = dx / dragLength;
    const dragY = dy / dragLength;

    const normalAxis = axisIndexOf(grab.normal);
    let best: { score: number; tangent: Vec3i; screen: THREE.Vector2 } | null =
      null;

    for (let axis = 0; axis < 3; axis++) {
      if (axis === normalAxis) continue;
      for (const sign of [1, -1]) {
        const tangent: Vec3i = [0, 0, 0];
        tangent[axis] = sign;

        const screen = this.screenDirection(grab.point, tangent);
        if (!screen) continue;

        const score = screen.x * dragX + screen.y * dragY;
        if (!best || score > best.score) best = { score, tangent, screen };
      }
    }

    if (!best) return null;

    // Rotating the layer by +theta about (normal x tangent) moves the grabbed
    // face along the tangent, which is what the drag is asking for.
    const axisVector = cross(grab.normal, best.tangent);
    const axis = axisIndexOf(axisVector);
    if (axis < 0) return null;

    return {
      axis: axis as Axis,
      sign: Math.sign(axisVector[axis]),
      screenTangent: best.screen,
    };
  }

  /** Screen-space unit direction of a world direction at a world point. */
  private screenDirection(
    origin: THREE.Vector3,
    direction: Vec3i,
  ): THREE.Vector2 | null {
    const rect = this.domElement.getBoundingClientRect();

    const a = origin.clone().project(this.camera);
    const b = origin
      .clone()
      .add(
        new THREE.Vector3(direction[0], direction[1], direction[2]).multiplyScalar(
          0.4,
        ),
      )
      .project(this.camera);

    // NDC to pixels, remembering that screen y runs downward.
    const px = (b.x - a.x) * (rect.width / 2);
    const py = -(b.y - a.y) * (rect.height / 2);
    const length = Math.hypot(px, py);
    if (length < 1e-6) return null;

    return new THREE.Vector2(px / length, py / length);
  }
}

/**
 * Pointer capture keeps a drag alive when the cursor leaves the canvas, but it
 * rejects ids that are not currently active. Failing to capture must never
 * break the gesture, so treat it as best-effort.
 */
function capturePointer(
  element: HTMLElement,
  pointerId: number,
  capture: boolean,
): void {
  try {
    if (capture) element.setPointerCapture(pointerId);
    else element.releasePointerCapture(pointerId);
  } catch {
    // Non-fatal: the drag still tracks via pointermove on the element.
  }
}

function snapToAxis(v: THREE.Vector3): Vec3i {
  const abs = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const axis = abs.indexOf(Math.max(...abs));
  const out: Vec3i = [0, 0, 0];
  out[axis] = v.getComponent(axis) >= 0 ? 1 : -1;
  return out;
}

function axisIndexOf(v: Vec3i): number {
  if (v[0] !== 0) return 0;
  if (v[1] !== 0) return 1;
  if (v[2] !== 0) return 2;
  return -1;
}

function cross(a: Vec3i, b: Vec3i): Vec3i {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
