export type ScoreInputs = {
  success: boolean;
  elapsedSeconds: number;
  timeLimitSeconds: number;
  pathDistance: number;
  optimalDistance: number;
  energyUsed: number;
  collisions: number;
  objectiveAccuracy: number;
};

export type ScoreBreakdown = {
  completion: number;
  time: number;
  pathEfficiency: number;
  energy: number;
  safety: number;
  taskAccuracy: number;
  total: number;
  rank:
    | 'Qualification Failed'
    | 'Basic Qualification'
    | 'Operational'
    | 'Advanced'
    | 'Expert'
    | 'Autonomous Excellence';
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function calculateScore(inputs: ScoreInputs): ScoreBreakdown {
  const completion = inputs.success ? 35 : 0;
  const timeRatio = 1 - inputs.elapsedSeconds / Math.max(1, inputs.timeLimitSeconds);
  const time = inputs.success ? clampScore(timeRatio * 15) : 0;
  const efficiencyRatio =
    inputs.optimalDistance <= 0
      ? 1
      : inputs.optimalDistance / Math.max(inputs.optimalDistance, inputs.pathDistance);
  const pathEfficiency = clampScore(efficiencyRatio * 15);
  const energy = clampScore(12 - inputs.energyUsed * 0.035);
  const safety = clampScore(15 - inputs.collisions * 3);
  const taskAccuracy = clampScore(inputs.objectiveAccuracy * 8);
  const total = completion + time + pathEfficiency + energy + safety + taskAccuracy;

  let rank: ScoreBreakdown['rank'] = 'Qualification Failed';
  if (inputs.success && total >= 92) rank = 'Autonomous Excellence';
  else if (inputs.success && total >= 84) rank = 'Expert';
  else if (inputs.success && total >= 72) rank = 'Advanced';
  else if (inputs.success && total >= 58) rank = 'Operational';
  else if (inputs.success) rank = 'Basic Qualification';

  return {
    completion,
    time,
    pathEfficiency,
    energy,
    safety,
    taskAccuracy,
    total,
    rank,
  };
}
