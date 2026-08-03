export class SimulationClock {
  readonly fixedDt: number;
  private accumulator = 0;

  constructor(
    fixedHz = 60,
    private readonly maxSubSteps = 4,
  ) {
    this.fixedDt = 1 / fixedHz;
  }

  advance(deltaSeconds: number, step: (fixedDt: number) => void): number {
    this.accumulator += Math.min(deltaSeconds, this.fixedDt * this.maxSubSteps);
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
      step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    return this.accumulator / this.fixedDt;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
