import * as THREE from 'three';

export class InputController {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private readonly mouseButtons = new Set<number>();
  private readonly mousePressed = new Set<number>();
  private readonly lookDelta = new THREE.Vector2();
  private gameplayEnabled = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  setGameplayEnabled(enabled: boolean): void {
    this.gameplayEnabled = enabled;
    if (!enabled && document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  requestPointerLock(): void {
    if (!this.gameplayEnabled || document.pointerLockElement === this.canvas) return;
    void this.canvas.requestPointerLock();
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  setTestKey(code: string, down: boolean): void {
    if (down) {
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
      this.released.add(code);
    }
  }

  setTestMouseButton(button: number, down: boolean): void {
    if (down) {
      if (!this.mouseButtons.has(button)) this.mousePressed.add(button);
      this.mouseButtons.add(button);
    } else {
      this.mouseButtons.delete(button);
    }
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /**
   * Returns a key-down edge exactly once.
   *
   * Fixed-step gameplay may run more than once during a rendered frame. Toggle
   * actions must consume their edge or an even number of substeps can toggle
   * the action on and straight back off.
   */
  consumePressed(code: string): boolean {
    const pressed = this.pressed.has(code);
    if (pressed) this.pressed.delete(code);
    return pressed;
  }

  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  wasMousePressed(button: number): boolean {
    return this.mousePressed.has(button);
  }

  consumeLook(target: THREE.Vector2): THREE.Vector2 {
    target.copy(this.lookDelta);
    this.lookDelta.set(0, 0);
    return target;
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
  }

  clear(): void {
    this.keys.clear();
    this.pressed.clear();
    this.released.clear();
    this.mouseButtons.clear();
    this.mousePressed.clear();
    this.lookDelta.set(0, 0);
  }

  dispose(): void {
    this.clear();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.keys.has(event.code)) this.pressed.add(event.code);
    this.keys.add(event.code);
    if (
      this.gameplayEnabled &&
      ['Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft'].includes(event.code)
    ) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    this.released.add(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.gameplayEnabled) return;
    if (!this.isPointerLocked()) {
      this.requestPointerLock();
      return;
    }
    if (event.button === 1) event.preventDefault();
    this.mouseButtons.add(event.button);
    this.mousePressed.add(event.button);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.mouseButtons.delete(event.button);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.gameplayEnabled || !this.isPointerLocked()) return;
    this.lookDelta.x += event.movementX;
    this.lookDelta.y += event.movementY;
  };

  private readonly onPointerLockChange = (): void => {
    this.clear();
    window.dispatchEvent(
      new CustomEvent('blacksite:pointer-lock', {
        detail: { locked: this.isPointerLocked(), gameplayEnabled: this.gameplayEnabled },
      }),
    );
  };

  private readonly onBlur = (): void => this.clear();

  private readonly onVisibility = (): void => {
    if (document.hidden) this.clear();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.gameplayEnabled) event.preventDefault();
  };
}
