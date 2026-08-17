import * as THREE from "three";
import type { CameraRig } from "../camera/CameraRig";
import type { Colliders } from "../world/Colliders";
import { STANDING_EYE, WALK_SPEED } from "../data/cabin-layout";

const PITCH_LIMIT = 1.48; // ~85 deg

/** Pointer-lock WASD first-person walking with collision. */
export class WalkControls {
  enabled = false;
  onLockLost: (() => void) | null = null;
  onLockGained: (() => void) | null = null;

  private keys = new Set<string>();
  private locked = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private rig: CameraRig,
    private colliders: Colliders,
  ) {
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => this.keys.clear());
  }

  requestLock() {
    this.canvas.requestPointerLock();
  }

  exitLock() {
    if (this.locked) document.exitPointerLock();
  }

  get isLocked() {
    return this.locked;
  }

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) this.onLockGained?.();
    else {
      this.keys.clear();
      this.onLockLost?.();
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled || !this.locked) return;
    this.rig.yaw -= e.movementX * 0.0025;
    this.rig.pitch = Math.min(
      PITCH_LIMIT,
      Math.max(-PITCH_LIMIT, this.rig.pitch - e.movementY * 0.0025),
    );
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  update(dt: number) {
    if (!this.enabled || !this.locked || this.rig.isTweening) return;
    let fwd = 0;
    let strafe = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafe -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafe += 1;
    if (fwd === 0 && strafe === 0) return;
    const len = Math.hypot(fwd, strafe);
    fwd /= len;
    strafe /= len;
    // Yaw 0 looks toward -Z; forward is -Z rotated by yaw.
    const sin = Math.sin(this.rig.yaw);
    const cos = Math.cos(this.rig.yaw);
    const dirX = -sin * fwd + cos * strafe;
    const dirZ = -cos * fwd - sin * strafe;
    const step = WALK_SPEED * dt;
    const p = this.rig.position;
    const res = this.colliders.moveCircle(p.x, p.z, dirX * step, dirZ * step);
    p.set(res.x, STANDING_EYE + this.headBob(), res.z);
  }

  private bobPhase = 0;
  private headBob() {
    this.bobPhase += 0.25;
    return Math.sin(this.bobPhase) * 0.006;
  }

  dispose() {
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}

/** Raycast helper: seat pick proxies are tested from the camera center. */
export function centerRaycaster(camera: THREE.PerspectiveCamera) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  ray.far = 3;
  return ray;
}
