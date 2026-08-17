import type { CameraRig } from "../camera/CameraRig";

const PITCH_MIN = -1.05; // -60 deg
const PITCH_MAX = 1.31; // +75 deg

/** Seated drag-look: pointer drag on the canvas, no pointer lock. */
export class LookControls {
  enabled = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLCanvasElement, private rig: CameraRig) {
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.style.cursor = "grabbing";
  };

  private onMove = (e: PointerEvent) => {
    if (!this.enabled || !this.dragging || this.rig.isTweening) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.rig.yaw -= dx * 0.0045;
    this.rig.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.rig.pitch - dy * 0.0045));
  };

  private onUp = () => {
    this.dragging = false;
    this.canvas.style.cursor = "";
  };

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
  }
}
