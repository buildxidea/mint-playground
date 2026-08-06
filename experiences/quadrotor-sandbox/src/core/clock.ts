/**
 * Fixed-timestep accumulator. The controller and the rigid-body integrator are
 * only stable and only reproducible at a fixed rate, so simulation time is
 * decoupled from frame time here and never reads the display refresh directly.
 *
 * Rendering interpolates between the last two committed states using the
 * fractional `alpha` left over after the whole steps have been consumed.
 */
export class FixedClock {
  readonly dt: number;

  private accumulator = 0;
  private last = 0;
  private started = false;

  /**
   * @param hz          simulation rate; 200 Hz is the inner rate loop's budget
   * @param maxSubsteps ceiling on catch-up steps per frame, so a stalled tab
   *                    resumes late rather than spiralling
   */
  constructor(
    readonly hz = 200,
    private readonly maxSubsteps = 5,
  ) {
    this.dt = 1 / hz;
  }

  /** Drop accumulated time; use after a pause, reset or tab visibility change. */
  reset() {
    this.accumulator = 0;
    this.started = false;
  }

  /**
   * Advance simulation time to `nowSeconds`, invoking `step` for each whole
   * timestep, and return the render interpolation factor in [0, 1).
   */
  advance(nowSeconds: number, step: (dt: number) => void): number {
    if (!this.started) {
      this.started = true;
      this.last = nowSeconds;
      return 0;
    }

    const frame = nowSeconds - this.last;
    this.last = nowSeconds;

    // A negative or absurd delta means the clock jumped (tab restore, debugger
    // pause). Skip the frame rather than running hundreds of catch-up steps.
    if (!(frame > 0) || frame > 1) return this.accumulator / this.dt;

    this.accumulator += frame;

    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxSubsteps) {
      step(this.dt);
      this.accumulator -= this.dt;
      steps += 1;
    }

    // Hit the substep ceiling: discard the backlog so the next frame starts
    // clean instead of inheriting an ever-growing debt.
    if (steps === this.maxSubsteps && this.accumulator > this.dt) {
      this.accumulator = 0;
    }

    return this.accumulator / this.dt;
  }
}
