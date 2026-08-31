import { INTERMISSION_SECONDS, spawnCountForRound } from './zombiesData';

/**
 * Rounds are unbounded, but the work inside a round is intentionally bounded.
 * This keeps late rounds survivable and prevents the cubic legacy curve from
 * producing an unsafe spawn budget.
 */
export const MAX_ZOMBIES_PER_ROUND = 120;

export function spawnBudgetForRound(round: number): number {
  return Math.min(MAX_ZOMBIES_PER_ROUND, spawnCountForRound(round));
}

export type RoundEvent =
  | { type: 'round-start'; round: number; spawnBudget: number }
  | { type: 'round-clear'; round: number }
  | { type: 'intermission'; remaining: number };

export class RoundDirector {
  round = 0;
  pendingSpawns = 0;
  intermissionRemaining = 0;
  private living = 0;
  private started = false;

  reset(): void {
    this.round = 0;
    this.pendingSpawns = 0;
    this.intermissionRemaining = 0;
    this.living = 0;
    this.started = false;
  }

  begin(): RoundEvent[] {
    if (this.started) return [];
    this.started = true;
    return this.advanceRound();
  }

  get isIntermission(): boolean {
    return this.intermissionRemaining > 0;
  }

  get spawnBudgetRemaining(): number {
    return this.pendingSpawns;
  }

  notifySpawned(count: number): void {
    const used = Math.min(Math.max(0, Math.floor(count)), this.pendingSpawns);
    this.pendingSpawns -= used;
    this.living += used;
  }

  notifyDefeated(count = 1): RoundEvent[] {
    const defeated = Math.max(0, Math.floor(count));
    this.living = Math.max(0, this.living - defeated);
    if (
      defeated > 0 &&
      this.living === 0 &&
      this.pendingSpawns === 0 &&
      this.intermissionRemaining <= 0 &&
      this.started &&
      this.round > 0
    ) {
      this.intermissionRemaining = INTERMISSION_SECONDS;
      return [{ type: 'round-clear', round: this.round }];
    }
    return [];
  }

  /** Test helper: wipe spawn budget and start intermission immediately. */
  forceClearForTest(): RoundEvent[] {
    this.pendingSpawns = 0;
    this.living = 0;
    if (!this.started || this.round <= 0 || this.intermissionRemaining > 0) return [];
    this.intermissionRemaining = INTERMISSION_SECONDS;
    return [{ type: 'round-clear', round: this.round }];
  }

  /** Test helper: skip remaining intermission and begin the next round. */
  forceBeginNextRoundForTest(): RoundEvent[] {
    if (!this.started) return this.begin();
    this.pendingSpawns = 0;
    this.living = 0;
    this.intermissionRemaining = 0;
    return this.advanceRound();
  }

  update(delta: number): RoundEvent[] {
    if (this.intermissionRemaining <= 0) return [];
    this.intermissionRemaining = Math.max(0, this.intermissionRemaining - delta);
    if (this.intermissionRemaining <= 0) {
      return this.advanceRound();
    }
    return [{ type: 'intermission', remaining: this.intermissionRemaining }];
  }

  private advanceRound(): RoundEvent[] {
    this.round += 1;
    this.pendingSpawns = spawnBudgetForRound(this.round);
    this.living = 0;
    return [{ type: 'round-start', round: this.round, spawnBudget: this.pendingSpawns }];
  }
}
