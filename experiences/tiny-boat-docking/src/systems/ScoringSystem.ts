import type { LevelDef } from '../levels/LevelDef';
import type { DockingStatus } from './DockingZoneSystem';

export type ScoreBreakdown = {
  timeScore: number;
  damageScore: number;
  alignScore: number;
  composite: number;
  stars: number;
  timeSeconds: number;
  damage: number;
};

export class ScoringSystem {
  damage = 0;
  missedApproaches = 0;
  private elapsed = 0;

  reset(): void {
    this.damage = 0;
    this.missedApproaches = 0;
    this.elapsed = 0;
  }

  addDamage(amount: number): void {
    this.damage += amount;
  }

  registerMiss(): void {
    this.missedApproaches += 1;
  }

  tick(dt: number): void {
    this.elapsed += dt;
  }

  finalize(level: LevelDef, docking: DockingStatus): ScoreBreakdown {
    const timePenalty = this.missedApproaches * 4;
    const effectiveTime = this.elapsed + timePenalty;
    const timeScore = clamp(
      1 - (effectiveTime - level.parSeconds) / Math.max(1, level.parSlack),
      0,
      1,
    );
    const damageScore = clamp(1 - this.damage / level.damageBudget, 0, 1);
    const alignScore = clamp(
      1 - (docking.posError * 0.65 + docking.yawErrorDeg / level.slip.yawToleranceDeg * 0.35),
      0,
      1,
    );
    const composite = 0.4 * timeScore + 0.35 * damageScore + 0.25 * alignScore;
    let stars = 0;
    if (composite >= 0.85) stars = 3;
    else if (composite >= 0.65) stars = 2;
    else if (composite >= 0.4) stars = 1;

    return {
      timeScore,
      damageScore,
      alignScore,
      composite,
      stars,
      timeSeconds: this.elapsed,
      damage: this.damage,
    };
  }

  getElapsed(): number {
    return this.elapsed;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
