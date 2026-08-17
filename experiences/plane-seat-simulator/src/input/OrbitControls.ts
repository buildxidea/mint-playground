import * as THREE from "three";
import type { CameraRig } from "../camera/CameraRig";
import { cabinHalfWidthAt, CROWN, DIMS } from "../data/cabin-layout";
import type { InspectTarget } from "../data/inspect-targets";

const PITCH_MIN = -0.9;
const PITCH_MAX = 1.15;
const DRAG_SLOP = 5;
/** How far the camera keeps off the trim it would otherwise poke through. */
const SKIN = 0.16;

/**
 * Confines a camera position to the cabin interior. X is clamped against the
 * fuselage cross-section at the camera's own height, which is what makes an
 * orbit path slide along the inside of the sidewall rather than swing out
 * through it; Y and Z are clamped to the floor-to-crown and nose-to-tail runs.
 */
function clampIntoCabin(p: THREE.Vector3, box: InspectTarget["cameraBox"]) {
  if (box) {
    p.set(
      Math.min(Math.max(p.x, box.min[0]), box.max[0]),
      Math.min(Math.max(p.y, box.min[1]), box.max[1]),
      Math.min(Math.max(p.z, box.min[2]), box.max[2]),
    );
    return;
  }
  p.y = Math.min(Math.max(p.y, 0.4), CROWN.peakY - SKIN);
  p.z = Math.min(Math.max(p.z, 0.5), DIMS.length - 0.5);
  const half = Math.max(cabinHalfWidthAt(p.y) - SKIN, 0.1);
  p.x = Math.min(Math.max(p.x, -half), half);
}

/**
 * Overview camera: drag to swing around the focus, wheel to pull in and out,
 * click to pick. The rig only stores a position and a yaw/pitch, so every
 * frame this resolves the orbit into one, clamps it inside the cabin, and
 * re-aims at the focus — so the target stays centered even where the wall
 * pushed the camera off its circle.
 */
export class OrbitControls {
  enabled = false;
  /** Called with client coordinates when a press ends without a drag. */
  onPick: ((x: number, y: number) => void) | null = null;

  readonly focus = new THREE.Vector3();
  yaw = 0;
  pitch = 0.18;
  distance = 7.5;
  private minDistance = 2;
  private maxDistance = 13;
  private cameraBox: InspectTarget["cameraBox"];

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;

  constructor(private canvas: HTMLCanvasElement, private rig: CameraRig) {
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /** Frames a target without moving the camera; callers tween into it. */
  adopt(target: InspectTarget) {
    this.focus.set(...target.focus);
    this.distance = target.distance;
    this.minDistance = target.minDistance;
    this.maxDistance = target.maxDistance;
    this.cameraBox = target.cameraBox;
  }

  /** Where the camera would sit for a target at the current orbit angles. */
  poseFor(target: InspectTarget) {
    const focus = new THREE.Vector3(...target.focus);
    const p = this.orbitPoint(focus, target.distance, target.cameraBox);
    return this.aimed(p, focus);
  }

  private orbitPoint(
    focus: THREE.Vector3,
    distance: number,
    box: InspectTarget["cameraBox"],
  ) {
    const cp = Math.cos(this.pitch);
    const p = new THREE.Vector3(
      focus.x + Math.sin(this.yaw) * cp * distance,
      focus.y + Math.sin(this.pitch) * distance,
      focus.z + Math.cos(this.yaw) * cp * distance,
    );
    clampIntoCabin(p, box);
    return p;
  }

  /** Pose looking from `p` at `focus`, in the rig's yaw/pitch convention. */
  private aimed(p: THREE.Vector3, focus: THREE.Vector3) {
    const to = focus.clone().sub(p);
    return {
      position: [p.x, p.y, p.z] as [number, number, number],
      yaw: Math.atan2(-to.x, -to.z),
      pitch: Math.atan2(to.y, Math.hypot(to.x, to.z)),
    };
  }

  /** Writes this frame's orbit into the rig. */
  apply() {
    const p = this.orbitPoint(this.focus, this.distance, this.cameraBox);
    const pose = this.aimed(p, this.focus);
    this.rig.position.copy(p);
    this.rig.yaw = pose.yaw;
    this.rig.pitch = pose.pitch;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dragging = true;
    this.moved = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.style.cursor = "grabbing";
  };

  private onMove = (e: PointerEvent) => {
    if (!this.enabled || !this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.yaw -= dx * 0.006;
    this.pitch = Math.min(
      PITCH_MAX,
      Math.max(PITCH_MIN, this.pitch + dy * 0.005),
    );
  };

  private onUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.style.cursor = "";
    // A rotate is a drag, so only a press that stayed put counts as a pick.
    if (this.enabled && this.moved <= DRAG_SLOP) {
      this.onPick?.(e.clientX, e.clientY);
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const step = Math.exp(e.deltaY * 0.0012);
    this.distance = Math.min(
      this.maxDistance,
      Math.max(this.minDistance, this.distance * step),
    );
  };

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }
}
