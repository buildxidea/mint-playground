import type { Heading } from '../entities/Mower';

const DIRECTION_KEYS: Record<string, Heading> = {
  KeyW: 'north',
  ArrowUp: 'north',
  KeyS: 'south',
  ArrowDown: 'south',
  KeyA: 'west',
  ArrowLeft: 'west',
  KeyD: 'east',
  ArrowRight: 'east',
};

export type ActionName = 'finish' | 'restart' | 'pause' | 'confirm' | 'menu';

const ACTION_KEYS: Record<string, ActionName> = {
  KeyF: 'finish',
  KeyR: 'restart',
  KeyM: 'menu',
  Escape: 'pause',
  Enter: 'confirm',
  Space: 'confirm',
};

/**
 * Keyboard input for a snap-to-four-direction mower.
 *
 * Direction keys are kept in press order so the most recently pressed key wins
 * while the others stay held — otherwise a rolling turn drops input.
 */
export class MowerInput {
  private readonly heldDirections: Heading[] = [];
  private readonly actionQueue: ActionName[] = [];
  private boosting = false;
  private firstInput = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const direction = DIRECTION_KEYS[event.code];
    if (direction) {
      event.preventDefault();
      this.firstInput = true;
      const existing = this.heldDirections.indexOf(direction);
      if (existing >= 0) this.heldDirections.splice(existing, 1);
      this.heldDirections.push(direction);
      return;
    }

    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.boosting = true;
      return;
    }

    const action = ACTION_KEYS[event.code];
    if (action && !event.repeat) {
      event.preventDefault();
      this.firstInput = true;
      this.actionQueue.push(action);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    const direction = DIRECTION_KEYS[event.code];
    if (direction) {
      const index = this.heldDirections.indexOf(direction);
      if (index >= 0) this.heldDirections.splice(index, 1);
      return;
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.boosting = false;
    }
  };

  private readonly onBlur = () => {
    this.heldDirections.length = 0;
    this.boosting = false;
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** The direction the player is asking for, or null when idling. */
  get direction(): Heading | null {
    return this.heldDirections.length === 0
      ? null
      : this.heldDirections[this.heldDirections.length - 1];
  }

  get isBoosting(): boolean {
    return this.boosting;
  }

  /** True once the player has touched any key, used to unlock audio. */
  get hasInteracted(): boolean {
    return this.firstInput;
  }

  /** Drains one-shot actions. */
  takeActions(): ActionName[] {
    if (this.actionQueue.length === 0) return [];
    return this.actionQueue.splice(0, this.actionQueue.length);
  }

  clearHeld(): void {
    this.heldDirections.length = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
