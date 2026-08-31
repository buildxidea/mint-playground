import * as THREE from 'three';

const MIN_PITCH = 0.18;
const MAX_PITCH = 1.35;
const MIN_DIST = 4;
const MAX_DIST = 24;
const DEFAULT_DIST = 10.8;
const DEFAULT_PITCH = 0.62;

/**
 * Follow-cam with free 360° orbit look around the car.
 * Drag on the canvas to look, scroll to zoom, C / double-click to reset behind.
 */
export class ChaseCamera {
  private readonly current = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();

  /** World-space orbit yaw (full wrap). */
  private orbitYaw = 0;
  /** Elevation from XZ plane. */
  private orbitPitch = DEFAULT_PITCH;
  private distance = DEFAULT_DIST;
  /** When true, gently keeps camera behind the car until the player looks. */
  private chaseBehind = true;
  private dragging = false;
  private dragPointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private canvas: HTMLElement | null = null;

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    // Ignore UI controls (touch stick / buttons sit above the canvas).
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('#touch-controls, #overlay, .btn-inline, button')) return;
    this.dragging = true;
    this.chaseBehind = false;
    this.dragPointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    try {
      this.canvas?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.dragging || e.pointerId !== this.dragPointerId) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Drag right → orbit left (natural turntable).
    this.orbitYaw -= dx * 0.0055;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.0042, MIN_PITCH, MAX_PITCH);
    e.preventDefault();
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.dragPointerId) return;
    this.dragging = false;
    this.dragPointerId = null;
  };

  private readonly onWheel = (e: WheelEvent) => {
    this.distance = clamp(this.distance + e.deltaY * 0.012, MIN_DIST, MAX_DIST);
    this.chaseBehind = false;
    e.preventDefault();
  };

  private readonly onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  private readonly onDblClick = () => {
    this.resetBehind();
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'KeyC') {
      this.resetBehind();
    }
  };

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.camera.fov = 42;
    this.camera.near = 0.1;
    this.camera.far = 120;
  }

  /** Attach look controls to the game canvas (and keyboard reset). */
  bind(canvas: HTMLElement): void {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKeyDown);
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
  }

  dispose(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointercancel', this.onPointerUp);
      canvas.removeEventListener('wheel', this.onWheel);
      canvas.removeEventListener('contextmenu', this.onContextMenu);
      canvas.removeEventListener('dblclick', this.onDblClick);
    }
    window.removeEventListener('keydown', this.onKeyDown);
    this.canvas = null;
  }

  /** Jump camera behind the car (also used on challenge start). */
  resetBehind(): void {
    this.chaseBehind = true;
    this.orbitPitch = DEFAULT_PITCH;
    this.distance = DEFAULT_DIST;
  }

  /** Deterministic orbit for screenshot / QA angles (radians). */
  setOrbit(yaw: number, pitch = DEFAULT_PITCH, distance = DEFAULT_DIST): void {
    this.chaseBehind = false;
    this.orbitYaw = yaw;
    this.orbitPitch = clamp(pitch, MIN_PITCH, MAX_PITCH);
    this.distance = clamp(distance, MIN_DIST, MAX_DIST);
  }

  /** Immediate camera placement for paused screenshot captures. */
  snapOrbit(x: number, z: number, orbitYaw: number, pitch?: number, distance?: number): void {
    this.setOrbit(orbitYaw, pitch, distance);
    this.apply(x, z, 0, 1);
    this.current.copy(this.desired);
    this.camera.position.copy(this.current);
    this.camera.lookAt(this.look);
  }

  snap(x: number, z: number, yaw: number): void {
    this.resetBehind();
    this.orbitYaw = yaw + Math.PI;
    this.apply(x, z, yaw, 1);
    this.current.copy(this.desired);
    this.camera.position.copy(this.current);
    this.camera.lookAt(this.look);
  }

  update(dt: number, x: number, z: number, yaw: number, lag = 0.12): void {
    // Right stick look (gamepad).
    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const rx = deadzone(pad.axes[2] ?? 0);
      const ry = deadzone(pad.axes[3] ?? 0);
      if (Math.abs(rx) > 0 || Math.abs(ry) > 0) {
        this.chaseBehind = false;
        this.orbitYaw -= rx * 2.4 * dt;
        this.orbitPitch = clamp(this.orbitPitch + ry * 1.8 * dt, MIN_PITCH, MAX_PITCH);
      }
      // Right-stick click resets to chase-behind.
      if (pad.buttons[11]?.pressed) {
        this.resetBehind();
      }
    }

    if (this.chaseBehind && !this.dragging) {
      const targetYaw = yaw + Math.PI;
      this.orbitYaw = lerpAngle(this.orbitYaw, targetYaw, 1 - Math.exp(-dt * 3.2));
      this.orbitPitch = THREE.MathUtils.lerp(
        this.orbitPitch,
        DEFAULT_PITCH,
        1 - Math.exp(-dt * 2.2),
      );
      this.distance = THREE.MathUtils.lerp(
        this.distance,
        DEFAULT_DIST,
        1 - Math.exp(-dt * 2.2),
      );
    }

    this.apply(x, z, yaw, 1 - Math.exp(-dt / Math.max(0.01, lag)));
    this.camera.position.copy(this.current);
    this.camera.lookAt(this.look);

    if (this.canvas) {
      this.canvas.style.cursor = this.dragging ? 'grabbing' : 'grab';
    }
  }

  private apply(x: number, z: number, _yaw: number, blend: number): void {
    const cy = Math.cos(this.orbitPitch);
    const sy = Math.sin(this.orbitPitch);
    const dist = this.distance;
    this.desired.set(
      x + Math.sin(this.orbitYaw) * dist * cy,
      Math.max(1.2, dist * sy),
      z + Math.cos(this.orbitYaw) * dist * cy,
    );
    this.look.set(x, 0.85, z);
    this.current.lerp(this.desired, blend);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function deadzone(v: number, z = 0.22): number {
  return Math.abs(v) < z ? 0 : v;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
