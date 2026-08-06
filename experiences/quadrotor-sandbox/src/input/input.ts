import type { Sticks } from "../sim/controller";
import { DEFAULT_BINDINGS, type Bindings } from "./bindings";

/** How fast a held key drives a stick to full deflection, per second. */
const RAMP_RATE = 4.5;
/** How fast a released stick springs back to centre, per second. */
const RETURN_RATE = 7;
/** Throttle travel per second while held. */
const THROTTLE_RATE = 0.65;

const GAMEPAD_DEADZONE = 0.08;

export interface InputCallbacks {
  onArm?: () => void;
  onCycleMode?: () => void;
  onReset?: () => void;
}

/**
 * Keyboard and gamepad pilot input.
 *
 * A keyboard has no analogue axes, so held keys *ramp* toward full deflection
 * and spring back when released. Without that the aircraft only ever sees
 * instant full-stick steps, which makes even a well-tuned controller look
 * twitchy and makes the tuning panel impossible to judge.
 *
 * A connected gamepad takes over the axes entirely when its sticks move.
 */
export class InputController {
  readonly sticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

  private readonly held = new Set<string>();
  private readonly bindings: Bindings;
  private usingGamepad = false;
  private suspended = false;

  constructor(
    private readonly callbacks: InputCallbacks = {},
    bindings: Bindings = DEFAULT_BINDINGS,
  ) {
    this.bindings = bindings;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.held.clear();
  }

  /**
   * Stop piloting without tearing the controller down.
   *
   * The craft picker borrows the arrow keys to move its highlight, and an
   * aircraft that kept flying underneath a modal chooser would be steering
   * itself while the pilot chose. Held keys are dropped on the way in so the
   * sticks spring back to centre rather than staying jammed wherever they were.
   */
  setSuspended(suspended: boolean) {
    this.suspended = suspended;
    if (suspended) this.held.clear();
  }

  /** True when the last update took its axes from a gamepad. */
  get gamepadActive() {
    return this.usingGamepad;
  }

  /** Park the throttle at centre, where position mode holds altitude. */
  centreThrottle() {
    this.sticks.throttle = 0.5;
  }

  update(dt: number) {
    if (this.suspended) {
      // Still run the axes so they spring back to centre; `held` is empty.
      this.sticks.roll = this.axis(this.sticks.roll, [], [], dt);
      this.sticks.pitch = this.axis(this.sticks.pitch, [], [], dt);
      this.sticks.yaw = this.axis(this.sticks.yaw, [], [], dt);
      return;
    }
    if (this.readGamepad()) return;
    this.usingGamepad = false;

    const b = this.bindings;
    this.sticks.roll = this.axis(this.sticks.roll, b.rollRight, b.rollLeft, dt);
    this.sticks.pitch = this.axis(this.sticks.pitch, b.pitchUp, b.pitchDown, dt);
    this.sticks.yaw = this.axis(this.sticks.yaw, b.yawLeft, b.yawRight, dt);

    let throttle = this.sticks.throttle;
    if (this.anyHeld(b.throttleUp)) throttle += THROTTLE_RATE * dt;
    if (this.anyHeld(b.throttleDown)) throttle -= THROTTLE_RATE * dt;
    this.sticks.throttle = Math.max(0, Math.min(1, throttle));
  }

  private axis(current: number, positive: string[], negative: string[], dt: number) {
    const up = this.anyHeld(positive);
    const down = this.anyHeld(negative);

    if (up === down) {
      // Nothing held (or both) — spring back toward centre.
      const step = RETURN_RATE * dt;
      if (Math.abs(current) <= step) return 0;
      return current - Math.sign(current) * step;
    }

    const target = up ? 1 : -1;
    const next = current + target * RAMP_RATE * dt;
    return target > 0 ? Math.min(1, next) : Math.max(-1, next);
  }

  private anyHeld(codes: string[]) {
    for (const code of codes) if (this.held.has(code)) return true;
    return false;
  }

  private readGamepad(): boolean {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad) continue;
      const [yawAxis, throttleAxis, rollAxis, pitchAxis] = pad.axes;
      if (
        Math.abs(yawAxis ?? 0) < GAMEPAD_DEADZONE &&
        Math.abs(throttleAxis ?? 0) < GAMEPAD_DEADZONE &&
        Math.abs(rollAxis ?? 0) < GAMEPAD_DEADZONE &&
        Math.abs(pitchAxis ?? 0) < GAMEPAD_DEADZONE &&
        !this.usingGamepad
      ) {
        continue;
      }

      this.usingGamepad = true;
      this.sticks.yaw = -(yawAxis ?? 0);
      this.sticks.roll = rollAxis ?? 0;
      // Gamepad Y axes report up as negative.
      this.sticks.pitch = -(pitchAxis ?? 0);
      this.sticks.throttle = Math.max(0, Math.min(1, (-(throttleAxis ?? 0) + 1) / 2));
      return true;
    }
    return false;
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || this.suspended) return;
    const code = event.code;

    if (this.bindings.arm.includes(code)) this.callbacks.onArm?.();
    else if (this.bindings.cycleMode.includes(code)) this.callbacks.onCycleMode?.();
    else if (this.bindings.reset.includes(code)) this.callbacks.onReset?.();

    if (this.isBound(code)) {
      this.held.add(code);
      event.preventDefault();
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.held.delete(event.code);
  };

  private onBlur = () => {
    // Losing focus mid-input would otherwise leave a stick pinned.
    this.held.clear();
  };

  private isBound(code: string) {
    for (const codes of Object.values(this.bindings)) {
      if (codes.includes(code)) return true;
    }
    return false;
  }
}
