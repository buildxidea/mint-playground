import type { CoverageMetrics } from './CoverageGrid';
import type { Level, PatternTarget } from '../game/levels';

export type Grade = 'S' | 'A' | 'B' | 'C';

export type LevelResult = {
  coverage: number;
  pattern: number;
  overlap: number;
  fuelRemaining: number;
  score: number;
  grade: Grade;
  passed: boolean;
};

const WEIGHT_COVERAGE = 0.6;
const WEIGHT_PATTERN = 0.3;
const WEIGHT_FUEL = 0.1;
const PENALTY_OVERLAP = 0.15;

export function patternScore(metrics: CoverageMetrics, target: PatternTarget): number {
  switch (target) {
    case 'ns':
      return metrics.patternNs;
    case 'ew':
      return metrics.patternEw;
    case 'cross':
      return metrics.patternCross;
  }
}

export function gradeFor(score: number): Grade {
  if (score >= 0.92) return 'S';
  if (score >= 0.82) return 'A';
  if (score >= 0.7) return 'B';
  return 'C';
}

export function scoreLevel(
  metrics: CoverageMetrics,
  level: Level,
  fuelRemaining: number,
): LevelResult {
  const pattern = patternScore(metrics, level.target);
  const raw =
    WEIGHT_COVERAGE * metrics.coverage +
    WEIGHT_PATTERN * pattern +
    WEIGHT_FUEL * fuelRemaining -
    PENALTY_OVERLAP * metrics.overlap;
  const score = Math.max(0, Math.min(1, raw));

  return {
    coverage: metrics.coverage,
    pattern,
    overlap: metrics.overlap,
    fuelRemaining,
    score,
    grade: gradeFor(score),
    passed: metrics.coverage >= level.pass.coverage && pattern >= level.pass.pattern,
  };
}

const STORAGE_KEY = 'mowed.progress';
/** Saves written before the game was named. */
const LEGACY_KEYS = ['stripe-master.progress', 'stripe-master.best'];

export type LevelProgress = {
  /** Best score achieved, 0..1. */
  score: number;
  grade: Grade;
  /** True once the level's thresholds have been met at least once. */
  passed: boolean;
};

export type Progress = Record<string, LevelProgress>;

export function loadProgress(): Progress {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    for (const key of LEGACY_KEYS) {
      if (raw) break;
      raw = localStorage.getItem(key);
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LevelProgress | number>;
    const progress: Progress = {};
    for (const [id, value] of Object.entries(parsed)) {
      // An earlier build stored a bare score. Treat those as unpassed so the
      // level list stays honest rather than unlocking everything.
      progress[id] =
        typeof value === 'number'
          ? { score: value, grade: gradeFor(value), passed: false }
          : value;
    }
    return progress;
  } catch {
    return {};
  }
}

export function saveProgress(levelId: string, result: LevelResult): void {
  try {
    const progress = loadProgress();
    const existing = progress[levelId];
    progress[levelId] = {
      score: Math.max(existing?.score ?? 0, result.score),
      grade: gradeFor(Math.max(existing?.score ?? 0, result.score)),
      passed: (existing?.passed ?? false) || result.passed,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Private browsing and disabled storage are not worth failing a level over.
  }
}

/** The first level is always open; the rest need the one before it passed. */
export function isUnlocked(index: number, levelIds: string[], progress: Progress): boolean {
  if (index === 0) return true;
  return progress[levelIds[index - 1]]?.passed === true;
}
