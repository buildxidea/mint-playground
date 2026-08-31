/**
 * Fixed-timestep simulation with a decoupled render.
 *
 * Paint stamping runs inside the simulation step, so stroke density depends on
 * distance travelled rather than on frame rate. A swipe at 20fps lays the same
 * continuous band it does at 144fps.
 */
export class Loop {
  private handle = 0;
  private previous = 0;
  private accumulator = 0;
  private running = false;

  /** Guards against the spiral of death after a tab-switch or a long stall. */
  private readonly maxFrameMs = 250;

  constructor(
    private readonly step: (deltaSeconds: number) => void,
    private readonly draw: () => void,
    private readonly hz = 60,
  ) {}

  private get stepMs(): number {
    return 1000 / this.hz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previous = performance.now();
    this.accumulator = 0;
    this.handle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.tick);

    const elapsed = Math.min(now - this.previous, this.maxFrameMs);
    this.previous = now;
    this.accumulator += elapsed;

    const stepMs = this.stepMs;
    const deltaSeconds = stepMs / 1000;
    while (this.accumulator >= stepMs) {
      this.step(deltaSeconds);
      this.accumulator -= stepMs;
    }

    this.draw();
  };
}
