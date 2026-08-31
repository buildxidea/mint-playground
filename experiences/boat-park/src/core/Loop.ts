export class Loop {
  private frameId = 0;
  private lastTime = 0;
  private running = false;
  /** Rolling frame time. Raw rAF deltas jitter by milliseconds even at a locked
   * refresh rate, and every one of those is a visible flicker in boat speed. */
  private smoothedDelta = 1 / 60;

  constructor(
    private readonly update: (deltaSeconds: number, elapsedSeconds: number) => void,
    private readonly render: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.smoothedDelta = 1 / 60;
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private readonly tick = (time: number) => {
    if (!this.running) return;
    const rawDelta = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    // A hitch should still be a hitch, so only blend within a normal range —
    // past that, trust the raw number and let the sim take the real step.
    this.smoothedDelta =
      Math.abs(rawDelta - this.smoothedDelta) > 0.012
        ? rawDelta
        : this.smoothedDelta + (rawDelta - this.smoothedDelta) * 0.25;
    this.update(this.smoothedDelta, time / 1000);
    this.render();
    this.frameId = requestAnimationFrame(this.tick);
  };
}
