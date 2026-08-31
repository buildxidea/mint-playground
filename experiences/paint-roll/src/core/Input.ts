/**
 * One snapshot of player intent.
 *
 * There is a single camera model now, so these axes mean exactly one thing:
 * `moveX` is across the surface the camera is facing, `moveY` is up it.
 */
export interface InputSnapshot {
  moveX: number;
  moveY: number;
  precise: boolean;
  /** Space held — refill. */
  refillKey: boolean;
  /** Zero-based swatch index requested this step, if any. */
  swatch: number | null;
  restart: boolean;
}

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

/**
 * Keyboard source. A touch source would implement the same shape and drop in
 * without any control logic changing, which is the v2 hook.
 */
export class InputSource {
  private readonly keys = new Set<string>();
  private swatch: number | null = null;
  private restart = false;

  private readonly snapshot: InputSnapshot = {
    moveX: 0, moveY: 0, precise: false, refillKey: false,
    swatch: null, restart: false,
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      if (MOVE_KEYS.has(event.code)) event.preventDefault();
      return;
    }
    this.keys.add(event.code);

    if (MOVE_KEYS.has(event.code) || event.code === 'Space') {
      event.preventDefault();
    }

    if (event.code.startsWith('Digit')) {
      const digit = Number(event.code.slice(5));
      if (digit >= 1 && digit <= 8) this.swatch = digit - 1;
    }
    if (event.code === 'KeyR') this.restart = true;
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    // Losing focus mid-stroke must not leave keys latched down.
    this.keys.clear();
  };

  private axis(negative: string[], positive: string[]): number {
    const down = negative.some((code) => this.keys.has(code)) ? -1 : 0;
    const up = positive.some((code) => this.keys.has(code)) ? 1 : 0;
    return down + up;
  }

  /** Reads intent and clears everything that is edge-shaped. */
  sample(): InputSnapshot {
    const s = this.snapshot;
    s.moveX = this.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    s.moveY = this.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    s.precise = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    s.refillKey = this.keys.has('Space');
    s.swatch = this.swatch;
    s.restart = this.restart;

    this.swatch = null;
    this.restart = false;

    return s;
  }
}
