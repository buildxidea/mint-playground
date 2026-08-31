export type ControlIntent = {
  throttle: number;
  steer: number;
  brake: boolean;
};

export function keyboardIntent(keys: ReadonlySet<string>): ControlIntent {
  let throttle = 0;
  let steer = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steer -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) steer += 1;
  return {
    throttle: Math.max(-1, Math.min(1, throttle)),
    steer: Math.max(-1, Math.min(1, steer)),
    brake: keys.has('Space'),
  };
}

type PointerState = {
  active: boolean;
  id: number | null;
  centerX: number;
  radius: number;
};

type ExtendedGamepad = Gamepad & {
  vibrationActuator?: {
    playEffect(type: string, options: Record<string, number>): Promise<unknown>;
  };
};

export class InputController {
  private readonly keys = new Set<string>();
  private readonly pointerState: PointerState = { active: false, id: null, centerX: 0, radius: 1 };
  private steerPointer = 0;
  private touchDrive = false;
  private touchReverse = false;
  private touchBrake = false;
  private toggleRequested = false;
  private pauseRequested = false;
  private confirmRequested = false;
  private restartRequested = false;
  private gamepadToggleDown = false;
  private gamepadPauseDown = false;

  constructor(
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly driveButton: HTMLElement,
    private readonly reverseButton: HTMLElement,
    private readonly brakeButton: HTMLElement,
    private readonly resurfaceButton: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.stick.addEventListener('pointerdown', this.onStickDown);
    this.stick.addEventListener('pointermove', this.onStickMove);
    this.stick.addEventListener('pointerup', this.onStickUp);
    this.stick.addEventListener('pointercancel', this.onStickUp);
    this.stick.addEventListener('lostpointercapture', this.onStickLostCapture);

    this.bindHoldButton(this.driveButton, 'drive');
    this.bindHoldButton(this.reverseButton, 'reverse');
    this.bindHoldButton(this.brakeButton, 'brake');
    this.resurfaceButton.addEventListener('pointerdown', this.onResurfaceDown);
  }

  readIntent(): ControlIntent {
    const keyboard = keyboardIntent(this.keys);
    let throttle = keyboard.throttle;
    let steer = keyboard.steer;
    let brake = this.touchBrake || keyboard.brake;

    if (this.touchDrive) throttle += 1;
    if (this.touchReverse) throttle -= 1;
    steer += this.steerPointer;

    const pad = this.getGamepad();
    if (pad) {
      const axisSteer = this.deadzone(pad.axes[0] ?? 0, 0.16);
      const rightTrigger = pad.buttons[7]?.value ?? 0;
      const leftTrigger = pad.buttons[6]?.value ?? 0;
      const stickThrottle = -this.deadzone(pad.axes[1] ?? 0, 0.2);
      const padThrottle = rightTrigger > 0.05 || leftTrigger > 0.05 ? rightTrigger - leftTrigger : stickThrottle;
      if (Math.abs(axisSteer) > Math.abs(steer)) steer = axisSteer;
      if (Math.abs(padThrottle) > Math.abs(throttle)) throttle = padThrottle;
      brake ||= Boolean(pad.buttons[1]?.pressed);

      const toggleDown = Boolean(pad.buttons[0]?.pressed);
      if (toggleDown && !this.gamepadToggleDown) {
        this.toggleRequested = true;
        this.confirmRequested = true;
      }
      this.gamepadToggleDown = toggleDown;
      const pauseDown = Boolean(pad.buttons[9]?.pressed);
      if (pauseDown && !this.gamepadPauseDown) this.pauseRequested = true;
      this.gamepadPauseDown = pauseDown;
    } else {
      this.gamepadToggleDown = false;
      this.gamepadPauseDown = false;
    }

    return {
      throttle: Math.max(-1, Math.min(1, throttle)),
      steer: Math.max(-1, Math.min(1, steer)),
      brake,
    };
  }

  consumeToggleResurface(): boolean {
    const requested = this.toggleRequested;
    this.toggleRequested = false;
    return requested;
  }

  consumePause(): boolean {
    const requested = this.pauseRequested;
    this.pauseRequested = false;
    return requested;
  }

  consumeConfirm(): boolean {
    const requested = this.confirmRequested;
    this.confirmRequested = false;
    return requested;
  }

  consumeRestart(): boolean {
    const requested = this.restartRequested;
    this.restartRequested = false;
    return requested;
  }

  rumble(durationMs: number, strong = 0.55, weak = 0.25): void {
    const pad = this.getGamepad() as ExtendedGamepad | null;
    const actuator = pad?.vibrationActuator;
    if (!actuator) return;
    void actuator.playEffect('dual-rumble', {
      duration: durationMs,
      strongMagnitude: strong,
      weakMagnitude: weak,
    }).catch(() => undefined);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stick.removeEventListener('pointerdown', this.onStickDown);
    this.stick.removeEventListener('pointermove', this.onStickMove);
    this.stick.removeEventListener('pointerup', this.onStickUp);
    this.stick.removeEventListener('pointercancel', this.onStickUp);
    this.stick.removeEventListener('lostpointercapture', this.onStickLostCapture);
    this.unbindHoldButton(this.driveButton, 'drive');
    this.unbindHoldButton(this.reverseButton, 'reverse');
    this.unbindHoldButton(this.brakeButton, 'brake');
    this.resurfaceButton.removeEventListener('pointerdown', this.onResurfaceDown);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
    this.keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyR') this.toggleRequested = true;
    if (event.code === 'Escape' || event.code === 'KeyP') this.pauseRequested = true;
    if (event.code === 'Enter') this.confirmRequested = true;
    if (event.code === 'Backspace') this.restartRequested = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onStickDown = (event: PointerEvent): void => {
    event.preventDefault();
    const rect = this.stick.getBoundingClientRect();
    this.pointerState.active = true;
    this.pointerState.id = event.pointerId;
    this.pointerState.centerX = rect.left + rect.width / 2;
    this.pointerState.radius = rect.width * 0.42;
    try {
      this.stick.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events may not expose pointer capture.
    }
    this.updatePointer(event.clientX);
  };

  private readonly onStickMove = (event: PointerEvent): void => {
    if (!this.pointerState.active || event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.updatePointer(event.clientX);
  };

  private readonly onStickUp = (event: PointerEvent): void => {
    if (this.pointerState.id !== null && event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.releaseStick();
  };

  private readonly onStickLostCapture = (): void => this.releaseStick();

  private readonly onResurfaceDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.toggleRequested = true;
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.releaseAll();
  };

  private readonly releaseAll = (): void => {
    this.keys.clear();
    this.touchDrive = false;
    this.touchReverse = false;
    this.touchBrake = false;
    this.releaseStick();
  };

  private bindHoldButton(element: HTMLElement, role: 'drive' | 'reverse' | 'brake'): void {
    element.addEventListener('pointerdown', this.holdHandler(role, true));
    element.addEventListener('pointerup', this.holdHandler(role, false));
    element.addEventListener('pointercancel', this.holdHandler(role, false));
    element.addEventListener('lostpointercapture', this.holdHandler(role, false));
  }

  private unbindHoldButton(element: HTMLElement, role: 'drive' | 'reverse' | 'brake'): void {
    element.removeEventListener('pointerdown', this.holdHandler(role, true));
    element.removeEventListener('pointerup', this.holdHandler(role, false));
    element.removeEventListener('pointercancel', this.holdHandler(role, false));
    element.removeEventListener('lostpointercapture', this.holdHandler(role, false));
  }

  private holdHandler(role: 'drive' | 'reverse' | 'brake', active: boolean): (event: PointerEvent) => void {
    const key = `${role}-${active}`;
    const handlers = (this as unknown as { __handlers?: Record<string, (event: PointerEvent) => void> });
    handlers.__handlers ??= {};
    handlers.__handlers[key] ??= (event: PointerEvent): void => {
      event.preventDefault();
      if (active) {
        try {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
          // Synthetic event.
        }
      }
      if (role === 'drive') this.touchDrive = active;
      if (role === 'reverse') this.touchReverse = active;
      if (role === 'brake') this.touchBrake = active;
    };
    return handlers.__handlers[key];
  }

  private releaseStick(): void {
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.steerPointer = 0;
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private updatePointer(clientX: number): void {
    this.steerPointer = Math.max(-1, Math.min(1, (clientX - this.pointerState.centerX) / this.pointerState.radius));
    this.knob.style.transform = `translate(calc(-50% + ${this.steerPointer * 38}px), -50%)`;
  }

  private getGamepad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) if (pad?.connected) return pad;
    return null;
  }

  private deadzone(value: number, threshold: number): number {
    if (Math.abs(value) <= threshold) return 0;
    return Math.sign(value) * ((Math.abs(value) - threshold) / (1 - threshold));
  }
}
