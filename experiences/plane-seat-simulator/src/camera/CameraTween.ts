import * as THREE from "three";
import type { Pose } from "../data/layout-types";

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface TweenTarget {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
}

/** Single active camera tween; a new request replaces the current one. */
export class CameraTween {
  private active: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromYaw: number;
    dYaw: number;
    fromPitch: number;
    dPitch: number;
    t: number;
    duration: number;
    onDone?: () => void;
  } | null = null;

  start(current: TweenTarget, to: Pose, duration: number, onDone?: () => void) {
    this.active = {
      fromPos: current.position.clone(),
      toPos: new THREE.Vector3(...to.position),
      fromYaw: current.yaw,
      dYaw: shortestAngle(current.yaw, to.yaw),
      fromPitch: current.pitch,
      dPitch: to.pitch - current.pitch,
      t: 0,
      duration,
      onDone,
    };
  }

  get isActive() {
    return this.active !== null;
  }

  cancel() {
    this.active = null;
  }

  /** Advances the tween; writes into `out`. Returns true while running. */
  update(dt: number, out: TweenTarget): boolean {
    const a = this.active;
    if (!a) return false;
    a.t = Math.min(a.t + dt / a.duration, 1);
    const k = easeInOutCubic(a.t);
    out.position.lerpVectors(a.fromPos, a.toPos, k);
    out.yaw = a.fromYaw + a.dYaw * k;
    out.pitch = a.fromPitch + a.dPitch * k;
    if (a.t >= 1) {
      this.active = null;
      a.onDone?.();
    }
    return true;
  }
}
