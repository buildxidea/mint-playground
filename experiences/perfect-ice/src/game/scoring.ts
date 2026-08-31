import type { LevelDefinition, RunStats, ScoreBreakdown } from './types';
import { roundedRinkArea } from './RinkShape';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function calculateScore(level: LevelDefinition, stats: RunStats, complete: boolean): ScoreBreakdown {
  const coverageRatio = clamp01(stats.coverage / level.coverageTarget);
  const coverage = coverageRatio * 55;

  const productiveRatio = stats.productiveCells / Math.max(1, stats.productiveCells + stats.repeatedCells + stats.wastedCells);
  const cleanableArea = roundedRinkArea(level);
  const idealDistance = cleanableArea / 2.22;
  const routeRatio = clamp01(idealDistance / Math.max(idealDistance, stats.drivenDistance));
  const efficiency = (productiveRatio * 0.72 + routeRatio * 0.28) * 20;

  const overtimeRatio = clamp01((stats.elapsed - level.parTime) / Math.max(1, level.maxTime - level.parTime));
  const time = (1 - overtimeRatio) * 15;

  const waterRatio = clamp01(stats.water / level.waterCapacity);
  const fuelRatio = clamp01(stats.fuel / level.fuelCapacity);
  const resources = (waterRatio * 0.7 + fuelRatio * 0.3) * 10;

  const wastePenalty = (stats.wastedWater / Math.max(1, level.waterCapacity)) * 8;
  const penalties = Math.min(16, stats.collisions * 1.35 + wastePenalty);
  const total = Math.max(0, Math.round((coverage + efficiency + time + resources - penalties) * 10) / 10);
  const stars = !complete ? 0 : total >= 90 && stats.coverage >= level.coverageTarget + 0.015 ? 3 : total >= 74 ? 2 : 1;

  return {
    total,
    stars,
    coverage: Math.round(coverage * 10) / 10,
    efficiency: Math.round(efficiency * 10) / 10,
    time: Math.round(time * 10) / 10,
    resources: Math.round(resources * 10) / 10,
    penalties: Math.round(penalties * 10) / 10,
  };
}
