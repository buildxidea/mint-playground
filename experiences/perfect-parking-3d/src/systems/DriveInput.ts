export type DriveAxes = {
  throttle: number;
  steer: number;
  brake: number;
  restartPressed: boolean;
  confirmPressed: boolean;
};

/**
 * Unified keyboard / gamepad / touch driving input.
 */
export class DriveInput {
  private readonly keys = new Set<string>();
  private touchThrottle = 0;
  private touchSteer = 0;
  private touchBrake = 0;
  private touchReverse = 0;
  private restartLatched = false;
  private confirmLatched = false;
  private prevRestart = false;
  private prevConfirm = false;
  /** When set, sample() returns these axes (test automation). */
  private injected: { throttle: number; steer: number; brake: number } | null = null;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  constructor(
    private readonly steerStick: HTMLElement,
    private readonly steerKnob: HTMLElement,
    private readonly accelBtn: HTMLElement,
    private readonly brakeBtn: HTMLElement,
    private readonly reverseBtn: HTMLElement,
    private readonly restartBtn: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.bindHold(this.accelBtn, (v) => {
      this.touchThrottle = v ? 1 : 0;
    });
    this.bindHold(this.brakeBtn, (v) => {
      this.touchBrake = v ? 1 : 0;
    });
    this.bindHold(this.reverseBtn, (v) => {
      this.touchReverse = v ? 1 : 0;
    });
    this.bindTap(this.restartBtn, () => {
      this.restartLatched = true;
    });
    this.bindSteerStick();
  }

  /**
   * Override keyboard/touch/gamepad for Playwright bots.
   * Pass null to clear and return to real input.
   */
  injectAxes(axes: { throttle?: number; steer?: number; brake?: number } | null): void {
    if (axes === null) {
      this.injected = null;
      return;
    }
    this.injected = {
      throttle: clamp(axes.throttle ?? 0, -1, 1),
      steer: clamp(axes.steer ?? 0, -1, 1),
      brake: clamp(axes.brake ?? 0, 0, 1),
    };
  }

  sample(): DriveAxes {
    if (this.injected) {
      const restartPressed = this.restartLatched && !this.prevRestart;
      const confirmPressed = this.confirmLatched && !this.prevConfirm;
      this.prevRestart = this.restartLatched;
      this.prevConfirm = this.confirmLatched;
      this.restartLatched = false;
      this.confirmLatched = false;
      return {
        throttle: this.injected.throttle,
        steer: this.injected.steer,
        brake: this.injected.brake,
        restartPressed,
        confirmPressed,
      };
    }

    let keyThrottle = 0;
    let keySteer = 0;
    let brake = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) keyThrottle += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) keyThrottle -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) keySteer -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) keySteer += 1;
    if (this.keys.has('Space') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
      brake = 1;
    }

    const touchDrive = this.touchThrottle - this.touchReverse;
    // Keyboard / on-screen buttons win over noisy gamepad sticks (drift was
    // canceling S/Rev to zero while still allowing forward).
    const hasDigitalThrottle = keyThrottle !== 0 || touchDrive !== 0;
    const hasDigitalSteer = keySteer !== 0 || this.touchSteer !== 0;

    let throttle = keyThrottle + touchDrive;
    let steer = keySteer + this.touchSteer;
    brake = Math.max(brake, this.touchBrake);

    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      if (!hasDigitalSteer) {
        steer += deadzone(pad.axes[0] ?? 0);
      }
      if (!hasDigitalThrottle) {
        const sy = deadzone(pad.axes[1] ?? 0);
        if (sy < -0.15) throttle += -sy;
        if (sy > 0.15) throttle -= sy;
        const rt = pad.buttons[7]?.value ?? 0;
        const lt = pad.buttons[6]?.value ?? 0;
        throttle += rt - lt;
      }
      if (pad.buttons[4]?.pressed || pad.buttons[5]?.pressed) brake = 1;
      if (pad.buttons[3]?.pressed || pad.buttons[8]?.pressed) this.restartLatched = true;
      if (pad.buttons[0]?.pressed || pad.buttons[9]?.pressed) this.confirmLatched = true;
    }

    if (this.keys.has('KeyR')) this.restartLatched = true;
    if (this.keys.has('Enter') || this.keys.has('Space')) this.confirmLatched = true;

    throttle = clamp(throttle, -1, 1);
    steer = clamp(steer, -1, 1);

    const restartPressed = this.restartLatched && !this.prevRestart;
    const confirmPressed = this.confirmLatched && !this.prevConfirm;
    this.prevRestart = this.restartLatched;
    this.prevConfirm = this.confirmLatched;
    this.restartLatched = false;
    this.confirmLatched = false;

    return { throttle, steer, brake, restartPressed, confirmPressed };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private bindHold(el: HTMLElement, set: (down: boolean) => void): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      set(true);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      set(false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    // Do not listen to pointerleave — it fires on capture/small buttons and
    // was releasing Rev/Go immediately so reverse felt broken on touch.
    el.addEventListener('lostpointercapture', up);
  }

  private bindTap(el: HTMLElement, fn: () => void): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
    });
  }

  private bindSteerStick(): void {
    let active = false;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    let radius = 1;

    const move = (clientX: number, clientY: number) => {
      const dx = (clientX - cx) / radius;
      const dy = (clientY - cy) / radius;
      this.touchSteer = clamp(dx, -1, 1);
      this.steerKnob.style.transform = `translate(calc(-50% + ${this.touchSteer * 34}px), -50%)`;
      void dy;
    };

    this.steerStick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const rect = this.steerStick.getBoundingClientRect();
      active = true;
      id = e.pointerId;
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
      radius = rect.width * 0.42;
      try {
        this.steerStick.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      move(e.clientX, e.clientY);
    });
    this.steerStick.addEventListener('pointermove', (e) => {
      if (!active || e.pointerId !== id) return;
      e.preventDefault();
      move(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      active = false;
      id = null;
      this.touchSteer = 0;
      this.steerKnob.style.transform = 'translate(-50%, -50%)';
    };
    this.steerStick.addEventListener('pointerup', end);
    this.steerStick.addEventListener('pointercancel', end);
  }
}

function deadzone(v: number, z = 0.18): number {
  return Math.abs(v) < z ? 0 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
