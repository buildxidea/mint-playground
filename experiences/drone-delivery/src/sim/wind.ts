import * as THREE from 'three';

/**
 * Slowly wandering wind: a base vector plus two out-of-phase sine bands and
 * occasional stronger gusts. Deterministic given the elapsed time, so replays
 * and screenshots stay stable.
 */
export class Wind {
  readonly current = new THREE.Vector3();
  private gustEnvelope = 0;

  constructor(
    private base = new THREE.Vector3(),
    private variability = 0.6,
    private gustStrength = 0,
  ) {}

  configure(base: THREE.Vector3, variability: number, gustStrength: number): void {
    this.base.copy(base);
    this.variability = variability;
    this.gustStrength = gustStrength;
  }

  /** Returns true on the tick a gust ramps up (for the gust sound cue). */
  update(elapsed: number): boolean {
    const wobbleX = Math.sin(elapsed * 0.31) * 0.6 + Math.sin(elapsed * 0.113 + 2.1) * 0.4;
    const wobbleZ = Math.sin(elapsed * 0.27 + 1.3) * 0.6 + Math.sin(elapsed * 0.089 + 4.2) * 0.4;

    // Gusts ride a slow band and only count when the band crests.
    const gustBand = Math.sin(elapsed * 0.16 + 0.7) * Math.sin(elapsed * 0.053 + 2.9);
    const gustTarget = gustBand > 0.62 ? 1 : 0;
    const previous = this.gustEnvelope;
    this.gustEnvelope += (gustTarget - this.gustEnvelope) * 0.02;

    this.current.set(
      this.base.x + wobbleX * this.variability + this.base.x * this.gustEnvelope * this.gustStrength,
      0,
      this.base.z + wobbleZ * this.variability + this.base.z * this.gustEnvelope * this.gustStrength,
    );

    return previous < 0.25 && this.gustEnvelope >= 0.25;
  }

  get strength(): number {
    return this.current.length();
  }
}
