/**
 * Star scoring: delivery time vs par, package condition, battery remaining,
 * and landing accuracy each contribute to a 0-100 score.
 */
export interface ScoreInput {
  elapsed: number;
  parTime: number;
  /** 0-100, damaged by hard landings and collisions. */
  packageCondition: number;
  /** 0-100 at route end. */
  batteryPct: number;
  /** Mean landing accuracy across deliveries, 0 (rim) to 1 (bullseye). */
  landingAccuracy: number;
  /** Wrong-pad touchdowns with a package. */
  wrongDeliveries: number;
}

export interface ScoreResult {
  score: number;
  stars: 0 | 1 | 2 | 3;
  breakdown: {
    time: number;
    condition: number;
    battery: number;
    accuracy: number;
    penalty: number;
  };
}

export function computeScore(input: ScoreInput): ScoreResult {
  // Full time credit at or under par, fading to zero at 2x par.
  const timeRatio = input.parTime > 0 ? input.elapsed / input.parTime : 1;
  const time = 30 * clamp01(2 - timeRatio);
  const condition = 30 * clamp01(input.packageCondition / 100);
  const battery = 20 * clamp01(input.batteryPct / 100);
  const accuracy = 20 * clamp01(input.landingAccuracy);
  const penalty = Math.min(20, input.wrongDeliveries * 10);

  const score = Math.max(0, Math.round(time + condition + battery + accuracy - penalty));
  const stars: 0 | 1 | 2 | 3 = score >= 85 ? 3 : score >= 60 ? 2 : score >= 35 ? 1 : 0;
  return { score, stars, breakdown: { time, condition, battery, accuracy, penalty } };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
