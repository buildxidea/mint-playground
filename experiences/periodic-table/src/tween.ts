export type Ease = (t: number) => number;

export const easeInOutCubic: Ease = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic: Ease = (t) => t * t * t;
export const easeOutBack: Ease = (t) => {
  const c1 = 1.20158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

interface ActiveTween {
  elapsed: number;
  duration: number;
  delay: number;
  ease: Ease;
  onUpdate: (v: number) => void;
  onComplete?: () => void;
  done: boolean;
}

/** Minimal tween runner; the App owns one and pumps it each frame. */
export class Tweens {
  private list: ActiveTween[] = [];

  run(opts: {
    duration: number;
    delay?: number;
    ease?: Ease;
    onUpdate: (v: number) => void;
    onComplete?: () => void;
  }): void {
    this.list.push({
      elapsed: 0,
      duration: Math.max(opts.duration, 0.0001),
      delay: opts.delay ?? 0,
      ease: opts.ease ?? easeInOutCubic,
      onUpdate: opts.onUpdate,
      onComplete: opts.onComplete,
      done: false,
    });
  }

  /** Run tweens; returns a promise resolving when this batch completes. */
  runAsync(opts: Parameters<Tweens['run']>[0]): Promise<void> {
    return new Promise((resolve) => {
      const prev = opts.onComplete;
      this.run({
        ...opts,
        onComplete: () => {
          prev?.();
          resolve();
        },
      });
    });
  }

  update(dt: number): void {
    for (const t of this.list) {
      if (t.done) continue;
      if (t.delay > 0) {
        t.delay -= dt;
        if (t.delay > 0) continue;
      }
      t.elapsed += dt;
      const raw = Math.min(t.elapsed / t.duration, 1);
      t.onUpdate(t.ease(raw));
      if (raw >= 1) {
        t.done = true;
        t.onComplete?.();
      }
    }
    this.list = this.list.filter((t) => !t.done);
  }

  clear(): void {
    this.list = [];
  }
}
