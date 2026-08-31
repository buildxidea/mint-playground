import type { FlightCommand } from '../sim/flight';

interface StickState {
  pointerId: number | null;
  x: number;
  y: number;
}

export interface FlightActions {
  onArmToggle?: () => void;
  onCameraCycle?: () => void;
  onReset?: () => void;
  onHelpToggle?: () => void;
  onPause?: () => void;
}

/**
 * Unifies keyboard, gamepad, and dual virtual sticks into one normalized
 * command. Key map matches the source quadrotor sim (Mode 2):
 * W/S throttle, arrows pitch/roll, A/D yaw, Enter arm, C camera, R reset, H help.
 */
export class FlightInput {
  private readonly keys = new Set<string>();
  private readonly left: StickState = { pointerId: null, x: 0, y: 0 };
  private readonly right: StickState = { pointerId: null, x: 0, y: 0 };
  private gamepadIndex: number | null = null;
  touchActive = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    this.keys.add(event.code);
    switch (event.code) {
      case 'Enter':
        this.actions.onArmToggle?.();
        break;
      case 'KeyC':
        this.actions.onCameraCycle?.();
        break;
      case 'KeyR':
        this.actions.onReset?.();
        break;
      case 'KeyH':
        this.actions.onHelpToggle?.();
        break;
      case 'Escape':
        this.actions.onPause?.();
        break;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly onGamepadConnected = (event: GamepadEvent) => {
    this.gamepadIndex = event.gamepad.index;
  };

  private readonly onGamepadDisconnected = (event: GamepadEvent) => {
    if (this.gamepadIndex === event.gamepad.index) this.gamepadIndex = null;
  };

  private gamepadArmWasDown = false;

  constructor(
    private readonly actions: FlightActions,
    private readonly leftStick: HTMLElement,
    private readonly leftKnob: HTMLElement,
    private readonly rightStick: HTMLElement,
    private readonly rightKnob: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    this.bindStick(this.leftStick, this.leftKnob, this.left);
    this.bindStick(this.rightStick, this.rightKnob, this.right);
  }

  read(target: FlightCommand): FlightCommand {
    let throttle = 0;
    let pitch = 0;
    let roll = 0;
    let yaw = 0;

    if (this.keys.has('KeyW')) throttle += 1;
    if (this.keys.has('KeyS')) throttle -= 1;
    if (this.keys.has('ArrowUp')) pitch += 1;
    if (this.keys.has('ArrowDown')) pitch -= 1;
    if (this.keys.has('ArrowRight')) roll += 1;
    if (this.keys.has('ArrowLeft')) roll -= 1;
    if (this.keys.has('KeyD')) yaw -= 1;
    if (this.keys.has('KeyA')) yaw += 1;

    // Touch: left stick throttle/yaw, right stick pitch/roll (Mode 2).
    throttle += -this.left.y;
    yaw += -this.left.x;
    pitch += -this.right.y;
    roll += this.right.x;

    const pad = this.pollGamepad();
    if (pad) {
      throttle += -applyDeadzone(pad.axes[1] ?? 0);
      yaw += -applyDeadzone(pad.axes[0] ?? 0);
      pitch += -applyDeadzone(pad.axes[3] ?? 0);
      roll += applyDeadzone(pad.axes[2] ?? 0);
      const armDown = Boolean(pad.buttons[0]?.pressed);
      if (armDown && !this.gamepadArmWasDown) this.actions.onArmToggle?.();
      this.gamepadArmWasDown = armDown;
    }

    target.throttle = clamp(throttle);
    target.pitch = clamp(pitch);
    target.roll = clamp(roll);
    target.yaw = clamp(yaw);
    return target;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
  }

  private pollGamepad(): Gamepad | null {
    if (this.gamepadIndex === null) return null;
    return navigator.getGamepads?.()[this.gamepadIndex] ?? null;
  }

  private bindStick(stick: HTMLElement, knob: HTMLElement, state: StickState): void {
    let centerX = 0;
    let centerY = 0;
    let radius = 1;

    const move = (clientX: number, clientY: number) => {
      state.x = (clientX - centerX) / radius;
      state.y = (clientY - centerY) / radius;
      const lengthSq = state.x * state.x + state.y * state.y;
      if (lengthSq > 1) {
        const inv = 1 / Math.sqrt(lengthSq);
        state.x *= inv;
        state.y *= inv;
      }
      const distance = 34;
      knob.style.transform = `translate(calc(-50% + ${state.x * distance}px), calc(-50% + ${state.y * distance}px))`;
    };

    stick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.touchActive = true;
      const rect = stick.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      radius = rect.width * 0.42;
      state.pointerId = event.pointerId;
      try {
        stick.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic test events do not always have a capturable pointer id.
      }
      move(event.clientX, event.clientY);
    });
    stick.addEventListener('pointermove', (event) => {
      if (state.pointerId !== event.pointerId) return;
      event.preventDefault();
      move(event.clientX, event.clientY);
    });
    const release = (event: PointerEvent) => {
      if (state.pointerId !== event.pointerId) return;
      state.pointerId = null;
      state.x = 0;
      state.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
  }
}

function applyDeadzone(value: number, deadzone = 0.12): number {
  if (Math.abs(value) < deadzone) return 0;
  return (value - Math.sign(value) * deadzone) / (1 - deadzone);
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
