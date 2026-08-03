import type { RobotId, ScenarioDefinition, ScenarioObjectiveRule } from '../config/catalog';
import { resolveScenarioTaskVerb, type RobotTaskVerb } from '../tasks/RobotTaskController';

const NAVIGATION_ONLY_OBJECTIVE =
  /\b(reach|approach|traverse|cross|pass|return|navigate|route|slalom|avoid|take off|launch|clear overhead|land|dock)\b/i;

export type ObjectiveGuidance = Readonly<{
  instruction: string;
  requiresTaskAction: boolean;
  taskVerb: RobotTaskVerb | null;
}>;

export function objectiveRequiresTaskAction(
  scenario: ScenarioDefinition,
  objectiveIndex: number,
): boolean {
  const rule = scenario.objectiveRules?.[objectiveIndex - 1];
  if (rule) {
    return (
      rule.kind === 'interaction' ||
      rule.kind === 'physical-interaction' ||
      rule.kind === 'physical-dock'
    );
  }
  return !NAVIGATION_ONLY_OBJECTIVE.test(scenario.objectives[objectiveIndex - 1] ?? '');
}

export function getObjectiveGuidance(
  scenario: ScenarioDefinition,
  objectiveIndex: number,
): ObjectiveGuidance {
  const objective = scenario.objectives[objectiveIndex - 1] ?? 'Complete the highlighted step';
  const rule = scenario.objectiveRules?.[objectiveIndex - 1];
  const requiresTaskAction = objectiveRequiresTaskAction(scenario, objectiveIndex);
  const taskVerb = requiresTaskAction ? resolveScenarioTaskVerb(scenario.robotId, objective) : null;

  return {
    instruction: buildInstruction(scenario.robotId, objective, rule, requiresTaskAction, taskVerb),
    requiresTaskAction,
    taskVerb,
  };
}

function buildInstruction(
  robotId: RobotId,
  objective: string,
  rule: ScenarioObjectiveRule | undefined,
  requiresTaskAction: boolean,
  taskVerb: RobotTaskVerb | null,
): string {
  if (rule?.kind === 'safe-speed') {
    return `Enter the highlighted zone at or below ${rule.maxSpeed.toFixed(1)} m/s.`;
  }
  if (rule?.kind === 'precision-dock') {
    return `Align inside the cyan dock, slow below ${rule.maxSpeed.toFixed(2)} m/s, and hold for ${rule.holdSeconds.toFixed(1)} s.`;
  }
  if (rule?.kind === 'physical-dock') {
    return `Align inside the cyan dock, stop, press E to dock, and hold for ${rule.holdSeconds.toFixed(1)} s.`;
  }
  if (requiresTaskAction && taskVerb) {
    return `Reach the cyan task marker, face the target, press E to ${taskVerb}, and wait for the motion to finish.`;
  }

  if (/\b(take off|launch)\b/i.test(objective)) {
    return 'Hold SPACE to climb into the highlighted flight marker.';
  }
  if (/\b(land)\b/i.test(objective)) {
    return 'Use CTRL to descend, center over the cyan landing marker, and settle.';
  }
  if (/\b(dock)\b/i.test(objective)) {
    return 'Enter the cyan dock, align with its arrow, stop, and hold position.';
  }

  const movement =
    robotId === 'kestrel-d5'
      ? 'Fly'
      : robotId === 'axiom-h1'
        ? 'Walk'
        : robotId === 'swift-w2'
          ? 'Drive or strafe'
          : 'Drive';
  return `${movement} through the cyan route and enter the highlighted waypoint.`;
}
