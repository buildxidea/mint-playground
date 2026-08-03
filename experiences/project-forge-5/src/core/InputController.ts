import * as THREE from 'three';
import {
  isTouchControl,
  TouchInputState,
  type TouchControl,
  type TouchEdgeControl,
} from './TouchInputState';

export type InputIntent = {
  translation: THREE.Vector3;
  yaw: number;
  jump?: boolean;
  interact: boolean;
  secondaryAction: boolean;
  postureCycle: boolean;
  precision: boolean;
  boost: boolean;
  emergencyStop: boolean;
};

const NON_GAME_TARGETS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export class InputController {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly touch = new TouchInputState();
  private enabled = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (NON_GAME_TARGETS.has(target.tagName) || target.isContentEditable)) {
      return;
    }

    if (!this.keys.has(event.code)) this.pressed.add(event.code);
    this.keys.add(event.code);
    if (
      this.enabled &&
      ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)
    ) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly clear = () => {
    this.keys.clear();
    this.pressed.clear();
    this.touch.clear();
    this.inputRoot
      .querySelectorAll<HTMLElement>('[data-touch-input][data-active="true"]')
      .forEach((element) => delete element.dataset.active);
  };

  private readonly onTouchPointerDown = (event: PointerEvent) => {
    if (!this.enabled || event.button !== 0) return;
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-touch-input]');
    const control = button?.dataset.touchInput;
    if (!button || !this.inputRoot.contains(button) || !isTouchControl(control)) return;

    event.preventDefault();
    this.touch.press(event.pointerId, control);
    this.updateTouchControlVisual(control);
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Window-level release listeners still prevent a stuck hold when capture is unavailable.
    }
  };

  private readonly onTouchPointerEnd = (event: PointerEvent) => {
    const control = this.touch.release(event.pointerId);
    if (!control) return;
    event.preventDefault();
    this.updateTouchControlVisual(control);
  };

  private readonly onAccessibleTouchClick = (event: MouseEvent) => {
    if (!this.enabled || event.detail !== 0) return;
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-touch-input]');
    const control = button?.dataset.touchInput;
    if (
      !button ||
      !this.inputRoot.contains(button) ||
      (control !== 'interact' &&
        control !== 'jump' &&
        control !== 'secondary-action' &&
        control !== 'posture' &&
        control !== 'emergency-stop')
    ) {
      return;
    }
    this.touch.pulse(control satisfies TouchEdgeControl);
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly inputRoot: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    window.addEventListener('pointerup', this.onTouchPointerEnd);
    window.addEventListener('pointercancel', this.onTouchPointerEnd);
    document.addEventListener('visibilitychange', this.clear);
    canvas.addEventListener('pointerdown', this.focusCanvas);
    inputRoot.addEventListener('pointerdown', this.onTouchPointerDown);
    inputRoot.addEventListener('lostpointercapture', this.onTouchPointerEnd);
    inputRoot.addEventListener('click', this.onAccessibleTouchClick);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  readIntent(target: InputIntent): InputIntent {
    target.translation.set(0, 0, 0);
    target.yaw = 0;
    target.jump = this.consume('Space') || this.touch.consume('jump');
    target.interact = this.consume('KeyE') || this.touch.consume('interact');
    target.secondaryAction = this.consume('KeyQ') || this.touch.consume('secondary-action');
    target.postureCycle = this.consume('KeyZ') || this.touch.consume('posture');
    target.precision =
      this.keys.has('AltLeft') || this.keys.has('AltRight') || this.touch.isActive('precision');
    target.boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    target.emergencyStop = this.consume('KeyX') || this.touch.consume('emergency-stop');

    if (!this.enabled) return target;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) target.translation.z += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) target.translation.z -= 1;
    if (this.keys.has('KeyA')) target.translation.x -= 1;
    if (this.keys.has('KeyD')) target.translation.x += 1;
    if (this.keys.has('ArrowLeft')) target.yaw += 1;
    if (this.keys.has('ArrowRight')) target.yaw -= 1;
    if (this.touch.isActive('forward')) target.translation.z += 1;
    if (this.touch.isActive('backward')) target.translation.z -= 1;
    if (this.touch.isActive('strafe-left')) target.translation.x -= 1;
    if (this.touch.isActive('strafe-right')) target.translation.x += 1;
    if (this.touch.isActive('turn-left')) target.yaw += 1;
    if (this.touch.isActive('turn-right')) target.yaw -= 1;
    if (this.touch.isActive('ascend')) target.translation.y += 1;
    if (this.touch.isActive('descend')) target.translation.y -= 1;
    if (this.keys.has('Space')) target.translation.y += 1;
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) target.translation.y -= 1;

    const gamepad = navigator.getGamepads?.()[0];
    if (gamepad) {
      const deadzone = (value: number) => (Math.abs(value) < 0.12 ? 0 : value);
      target.translation.x += deadzone(gamepad.axes[0] ?? 0);
      target.translation.z -= deadzone(gamepad.axes[1] ?? 0);
      target.yaw -= deadzone(gamepad.axes[2] ?? 0);
      target.translation.y +=
        Number(gamepad.buttons[7]?.value ?? 0) - Number(gamepad.buttons[6]?.value ?? 0);
      target.interact ||= Boolean(gamepad.buttons[0]?.pressed);
      target.secondaryAction ||= Boolean(gamepad.buttons[2]?.pressed);
      target.postureCycle ||= Boolean(gamepad.buttons[3]?.pressed);
      target.precision ||= Boolean(gamepad.buttons[4]?.pressed);
      target.boost ||= Boolean(gamepad.buttons[5]?.pressed);
      target.emergencyStop ||= Boolean(gamepad.buttons[1]?.pressed);
    }

    if (target.translation.lengthSq() > 1) target.translation.normalize();
    target.yaw = THREE.MathUtils.clamp(target.yaw, -1, 1);
    return target;
  }

  consume(code: string): boolean {
    const has = this.pressed.has(code);
    this.pressed.delete(code);
    return has;
  }

  isHeld(code: string): boolean {
    return this.keys.has(code);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    window.removeEventListener('pointerup', this.onTouchPointerEnd);
    window.removeEventListener('pointercancel', this.onTouchPointerEnd);
    document.removeEventListener('visibilitychange', this.clear);
    this.canvas.removeEventListener('pointerdown', this.focusCanvas);
    this.inputRoot.removeEventListener('pointerdown', this.onTouchPointerDown);
    this.inputRoot.removeEventListener('lostpointercapture', this.onTouchPointerEnd);
    this.inputRoot.removeEventListener('click', this.onAccessibleTouchClick);
    this.clear();
  }

  private readonly focusCanvas = () => {
    this.canvas.focus({ preventScroll: true });
  };

  private updateTouchControlVisual(control: TouchControl): void {
    this.inputRoot
      .querySelectorAll<HTMLElement>(`[data-touch-input="${control}"]`)
      .forEach((element) => {
        if (this.touch.isActive(control)) element.dataset.active = 'true';
        else delete element.dataset.active;
      });
  }
}
