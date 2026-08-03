export type FlapListener = (source: 'key' | 'pointer') => void;

/**
 * One-shot flap input: Space/Enter keydown (no auto-repeat) and pointerdown
 * anywhere on the play surface. UI buttons stop propagation so clicking them
 * does not flap.
 */
export class FlapInput {
  private readonly listeners = new Set<FlapListener>();

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    this.emit('key');
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    // Anything inside a button is UI, not a flap — including the artwork inside
    // the bird picker's cards.
    if (event.target instanceof Element && event.target.closest('button')) return;
    this.emit('pointer');
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onPointerDown);
  }

  onFlap(listener: FlapListener): void {
    this.listeners.add(listener);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerdown', this.onPointerDown);
    this.listeners.clear();
  }

  private emit(source: 'key' | 'pointer'): void {
    for (const listener of this.listeners) listener(source);
  }
}
