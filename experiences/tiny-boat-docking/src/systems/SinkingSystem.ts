export type SinkingPresentation = {
  y: number;
  pitch: number;
  roll: number;
  progress: number;
  complete: boolean;
};

const SINK_DURATION_SECONDS = 1.65;

/** Deterministic failure presentation; gameplay XZ/yaw remain authoritative. */
export class SinkingSystem {
  private elapsed = 0;
  private active = false;
  private rollSign = 1;

  start(rollSign = 1): void {
    if (this.active) return;
    this.elapsed = 0;
    this.active = true;
    this.rollSign = rollSign < 0 ? -1 : 1;
  }

  reset(): void {
    this.elapsed = 0;
    this.active = false;
    this.rollSign = 1;
  }

  update(deltaSeconds: number): void {
    if (!this.active) return;
    this.elapsed = Math.min(
      SINK_DURATION_SECONDS,
      this.elapsed + Math.max(0, Math.min(deltaSeconds, 0.1)),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  getPresentation(reducedMotion = false): SinkingPresentation {
    if (!this.active) {
      return { y: 0, pitch: 0, roll: 0, progress: 0, complete: false };
    }
    const progress = Math.min(1, this.elapsed / SINK_DURATION_SECONDS);
    const eased = progress * progress * (3 - 2 * progress);
    const tiltScale = reducedMotion ? 0.35 : 1;
    return {
      y: -2.9 * Math.pow(progress, 1.35),
      pitch: (-10 * Math.PI * eased * tiltScale) / 180,
      roll: (this.rollSign * 48 * Math.PI * eased * tiltScale) / 180,
      progress,
      complete: progress >= 1,
    };
  }
}
