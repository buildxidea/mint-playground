export type BoatCommand = {
  throttle: number;
  steer: number;
  brake: number;
  retry: boolean;
  pause: boolean;
  mute: boolean;
};

type StickState = {
  active: boolean;
  id: number | null;
  centerX: number;
  centerY: number;
  radius: number;
  x: number;
  y: number;
};

export class BoatInput {
  private readonly keys = new Set<string>();
  private readonly steerStick: StickState = {
    active: false,
    id: null,
    centerX: 0,
    centerY: 0,
    radius: 1,
    x: 0,
    y: 0,
  };
  private readonly throttleStick: StickState = {
    active: false,
    id: null,
    centerX: 0,
    centerY: 0,
    radius: 1,
    x: 0,
    y: 0,
  };
  private touchBrake = false;
  private edgeRetry = false;
  private edgePause = false;
  private edgeMute = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    for (const token of keyTokens(event)) this.keys.add(token);
    if (this.keys.has('KeyR') || this.keys.has('r')) this.edgeRetry = true;
    if (this.keys.has('Escape')) this.edgePause = true;
    if (this.keys.has('KeyM') || this.keys.has('m')) this.edgeMute = true;
    if (
      this.keys.has('Space') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('ArrowDown') ||
      this.keys.has('ArrowLeft') ||
      this.keys.has('ArrowRight')
    ) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    for (const token of keyTokens(event)) this.keys.delete(token);
  };

  constructor(
    private readonly steerEl: HTMLElement,
    private readonly steerKnob: HTMLElement,
    private readonly throttleEl: HTMLElement,
    private readonly throttleKnob: HTMLElement,
    private readonly brakeEl: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.bindStick(this.steerEl, this.steerStick, this.steerKnob);
    this.bindStick(this.throttleEl, this.throttleStick, this.throttleKnob);
    this.brakeEl.addEventListener('pointerdown', this.onBrakeDown);
    this.brakeEl.addEventListener('pointerup', this.onBrakeUp);
    this.brakeEl.addEventListener('pointercancel', this.onBrakeUp);
    this.brakeEl.addEventListener('pointerleave', this.onBrakeUp);
  }

  read(): BoatCommand {
    let throttle = 0;
    let steer = 0;
    let brake = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.keys.has('w') || this.keys.has('W')) {
      throttle += 1;
    }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.keys.has('s') || this.keys.has('S')) {
      throttle -= 1;
    }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A')) {
      steer -= 1;
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D')) {
      steer += 1;
    }
    if (this.keys.has('Space') || this.keys.has(' ')) brake = 1;

    if (this.throttleStick.active) {
      throttle = THREE_CLAMP(-this.throttleStick.y, -1, 1);
    }
    if (this.steerStick.active) {
      steer = THREE_CLAMP(this.steerStick.x, -1, 1);
    }
    if (this.touchBrake) brake = 1;

    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const lx = deadzone(pad.axes[0] ?? 0);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (Math.abs(lx) > Math.abs(steer)) steer = lx;
      const padThrottle = rt - lt;
      if (Math.abs(padThrottle) > Math.abs(throttle)) throttle = padThrottle;
      if (pad.buttons[1]?.pressed) brake = 1;
      if (pad.buttons[9]?.pressed) this.edgePause = true;
      if (pad.buttons[3]?.pressed) this.edgeRetry = true;
    }

    const command: BoatCommand = {
      throttle: THREE_CLAMP(throttle, -1, 1),
      steer: THREE_CLAMP(steer, -1, 1),
      brake: THREE_CLAMP(brake, 0, 1),
      retry: this.edgeRetry,
      pause: this.edgePause,
      mute: this.edgeMute,
    };
    this.edgeRetry = false;
    this.edgePause = false;
    this.edgeMute = false;
    return command;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.brakeEl.removeEventListener('pointerdown', this.onBrakeDown);
    this.brakeEl.removeEventListener('pointerup', this.onBrakeUp);
    this.brakeEl.removeEventListener('pointercancel', this.onBrakeUp);
    this.brakeEl.removeEventListener('pointerleave', this.onBrakeUp);
  }

  private readonly onBrakeDown = (event: PointerEvent) => {
    event.preventDefault();
    this.touchBrake = true;
  };

  private readonly onBrakeUp = (event: PointerEvent) => {
    event.preventDefault();
    this.touchBrake = false;
  };

  private bindStick(el: HTMLElement, state: StickState, knob: HTMLElement): void {
    const down = (event: PointerEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      state.active = true;
      state.id = event.pointerId;
      state.centerX = rect.left + rect.width / 2;
      state.centerY = rect.top + rect.height / 2;
      state.radius = rect.width * 0.42;
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic events may not support capture.
      }
      this.updateStick(state, knob, event.clientX, event.clientY);
    };
    const move = (event: PointerEvent) => {
      if (!state.active || event.pointerId !== state.id) return;
      event.preventDefault();
      this.updateStick(state, knob, event.clientX, event.clientY);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== state.id) return;
      event.preventDefault();
      state.active = false;
      state.id = null;
      state.x = 0;
      state.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private updateStick(state: StickState, knob: HTMLElement, clientX: number, clientY: number): void {
    let x = (clientX - state.centerX) / state.radius;
    let y = (clientY - state.centerY) / state.radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    state.x = x;
    state.y = y;
    knob.style.transform = `translate(calc(-50% + ${x * 38}px), calc(-50% + ${y * 38}px))`;
  }
}

function deadzone(value: number, zone = 0.12): number {
  if (Math.abs(value) < zone) return 0;
  const sign = Math.sign(value);
  return ((Math.abs(value) - zone) / (1 - zone)) * sign;
}

function THREE_CLAMP(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function keyTokens(event: KeyboardEvent): string[] {
  const tokens = new Set<string>();
  if (event.code) tokens.add(event.code);
  if (event.key) {
    tokens.add(event.key);
    if (event.key.length === 1) tokens.add(event.key.toLowerCase());
  }
  return [...tokens];
}
