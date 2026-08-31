/**
 * Gameplay input for THE MARS TRAIL.
 *
 * Generic on purpose: it produces normalised axes and knows nothing about
 * flight. Polled once per fixed step from the loop rather than firing events,
 * so input can never desync from the simulation step.
 *
 * Listeners are attached only while a sequence is running, so the turn-based
 * game keeps its keyboard entirely free for text fields and buttons.
 */

export interface InputAxes {
  /** -1 (left) to 1 (right). */
  x: number;
  /** -1 (down) to 1 (up). */
  y: number;
  boost: boolean;
  brake: boolean;
  /** Held throttle for the launch: W up, S down. */
  throttleUp: boolean;
  throttleDown: boolean;
  /** True on the frame the key was pressed, then cleared. Launch sequence. */
  ignitePressed: boolean;
  stagePressed: boolean;
  /** True on the frame Escape was pressed, then cleared. */
  abortRequested: boolean;
}

/** Physical key codes, so AZERTY and Dvorak keep the same physical WASD block. */
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const BOOST = new Set(['ShiftLeft', 'ShiftRight']);
const BRAKE = new Set(['ControlLeft', 'ControlRight']);

/** Launch sequence keys, mirroring the reference rocket sim. */
const THROTTLE_UP = new Set(['KeyW', 'ArrowUp']);
const THROTTLE_DOWN = new Set(['KeyS', 'ArrowDown']);
const IGNITE = new Set(['Enter', 'Space']);
const STAGE = new Set(['KeyZ']);

/** Keys we swallow while flying, so the page does not scroll under the player. */
const SWALLOW = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'Enter',
]);

/** Axis smoothing rates. Attack is quicker than release, which feels responsive. */
const ATTACK = 14;
const RELEASE = 20;

export class InputController {
  private readonly held = new Set<string>();
  private attached = false;
  private abort = false;
  private ignite = false;
  private stage = false;

  /** Pointer steering, -1..1, only used once the pointer actually moves. */
  private pointerX = 0;
  private pointerY = 0;
  private pointerActive = false;

  private smoothedX = 0;
  private smoothedY = 0;

  constructor(private readonly target: HTMLElement) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.target.addEventListener('pointermove', this.onPointerMove);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.reset);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.target.removeEventListener('pointermove', this.onPointerMove);
    this.reset();
  }

  /** Clear everything. Called on blur so the ship does not fly on alt-tab. */
  readonly reset = (): void => {
    this.held.clear();
    this.pointerActive = false;
    this.pointerX = 0;
    this.pointerY = 0;
    this.smoothedX = 0;
    this.smoothedY = 0;
    this.abort = false;
    this.ignite = false;
    this.stage = false;
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.reset();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'Escape') {
      this.abort = true;
      return;
    }
    if (IGNITE.has(event.code)) this.ignite = true;
    if (STAGE.has(event.code)) this.stage = true;
    this.held.add(event.code);
    // A keypress takes over from a resting mouse, so the two never fight.
    this.pointerActive = false;
    if (SWALLOW.has(event.code)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
    if (SWALLOW.has(event.code)) event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const rect = this.target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this.pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    // Screen y grows downward; flight y grows upward.
    this.pointerY = -((event.clientY - rect.top) / rect.height - 0.5) * 2;
    this.pointerActive = true;
  };

  private any(codes: Set<string>): boolean {
    for (const code of this.held) if (codes.has(code)) return true;
    return false;
  }

  /**
   * Smoothed axes for this step.
   *
   * Smoothing is exponential in delta rather than a fixed lerp, so the feel is
   * identical at 60 Hz and 144 Hz and matches the headless harness.
   */
  sample(delta: number): InputAxes {
    let rawX = 0;
    let rawY = 0;

    if (this.pointerActive) {
      rawX = Math.max(-1, Math.min(1, this.pointerX * 1.4));
      rawY = Math.max(-1, Math.min(1, this.pointerY * 1.4));
    } else {
      if (this.any(LEFT)) rawX -= 1;
      if (this.any(RIGHT)) rawX += 1;
      if (this.any(DOWN)) rawY -= 1;
      if (this.any(UP)) rawY += 1;
    }

    const rate = (raw: number, current: number) =>
      Math.abs(raw) > Math.abs(current) ? ATTACK : RELEASE;
    this.smoothedX += (rawX - this.smoothedX) * (1 - Math.exp(-rate(rawX, this.smoothedX) * delta));
    this.smoothedY += (rawY - this.smoothedY) * (1 - Math.exp(-rate(rawY, this.smoothedY) * delta));

    const abortRequested = this.abort;
    const ignitePressed = this.ignite;
    const stagePressed = this.stage;
    this.abort = false;
    this.ignite = false;
    this.stage = false;

    return {
      x: this.smoothedX,
      y: this.smoothedY,
      boost: this.any(BOOST),
      brake: this.any(BRAKE),
      throttleUp: this.any(THROTTLE_UP),
      throttleDown: this.any(THROTTLE_DOWN),
      ignitePressed,
      stagePressed,
      abortRequested,
    };
  }
}
