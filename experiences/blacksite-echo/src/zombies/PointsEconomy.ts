export type PointsAwardReason =
  | 'hit'
  | 'headshot'
  | 'kill'
  | 'knife'
  | 'repair'
  | 'door';

const BASE_AWARDS: Record<PointsAwardReason, number> = {
  hit: 10,
  headshot: 25,
  kill: 60,
  knife: 130,
  repair: 10,
  door: 0,
};

export class PointsEconomy {
  points = 0;
  multiplier = 1;

  reset(starting: number): void {
    this.points = starting;
    this.multiplier = 1;
  }

  setDoublePoints(active: boolean): void {
    this.multiplier = active ? 2 : 1;
  }

  award(reason: PointsAwardReason, bonus = 0): number {
    const gained = Math.floor((BASE_AWARDS[reason] + bonus) * this.multiplier);
    this.points += gained;
    return gained;
  }

  awardMany(reason: PointsAwardReason, count: number, bonusEach = 0): number {
    const safeCount = Math.max(0, Math.floor(count));
    if (safeCount === 0) return 0;
    const gained =
      Math.floor((BASE_AWARDS[reason] + bonusEach) * this.multiplier) * safeCount;
    this.points += gained;
    return gained;
  }

  canAfford(cost: number): boolean {
    return this.points >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.points -= cost;
    return true;
  }
}
