import type { RobotId } from '../config/catalog';

export const ROBOT_TASK_VERBS = [
  'grasp',
  'carry',
  'release',
  'insert',
  'press',
  'turn',
  'connect',
  'disconnect',
  'dock',
  'inspect',
  'scan',
  'clear',
  'stabilize',
  'handoff',
] as const;

export type RobotTaskVerb = (typeof ROBOT_TASK_VERBS)[number];
export type RobotTaskStatus = 'idle' | 'executing' | 'completed';

export type RobotTaskSnapshot = Readonly<{
  active: boolean;
  phase: number;
  verb: RobotTaskVerb;
  status: RobotTaskStatus;
  sequence: number;
  completedSequence: number;
  elapsedSeconds: number;
  durationSeconds: number;
}>;

const DEFAULT_TASK_VERB: Readonly<Record<RobotId, RobotTaskVerb>> = {
  'axiom-h1': 'grasp',
  'quadrant-q4': 'scan',
  'forge-t7': 'clear',
  'swift-w2': 'carry',
  'kestrel-d5': 'inspect',
};

const TASK_DURATION_SECONDS: Readonly<Partial<Record<RobotTaskVerb, number>>> = {
  grasp: 2,
  carry: 1.6,
  release: 1.2,
  insert: 2.8,
  press: 1.2,
  turn: 2.1,
  connect: 2.4,
  disconnect: 2,
  dock: 1.5,
  inspect: 2,
  scan: 2.2,
  clear: 2.8,
  stabilize: 2.4,
  handoff: 2.6,
};

export function defaultRobotTaskVerb(robotId: RobotId): RobotTaskVerb {
  return DEFAULT_TASK_VERB[robotId];
}

export function resolveScenarioTaskVerb(
  robotId: RobotId,
  objective: string | undefined,
): RobotTaskVerb {
  const normalized = objective?.toLowerCase() ?? '';
  if (/\b(scan|map|locate|verify|inspect|confirm)\b/.test(normalized)) {
    if (/\b(control|panel|button|switch)\b/.test(normalized)) return 'press';
    return robotId === 'kestrel-d5' || robotId === 'quadrant-q4' ? 'scan' : 'inspect';
  }
  if (/\b(grasp|collect|pick|retrieve|select|lift)\b/.test(normalized)) return 'grasp';
  if (/\b(insert|seat|install)\b/.test(normalized)) return 'insert';
  if (/\b(press|operate.*door|control panel|button|switch)\b/.test(normalized)) return 'press';
  if (/\b(turn|rotate|valve)\b/.test(normalized)) return 'turn';
  if (/\b(disconnect|unplug)\b/.test(normalized)) return 'disconnect';
  if (/\b(connect|plug)\b/.test(normalized)) return 'connect';
  if (/\b(release|set down|drop)\b/.test(normalized)) return 'release';
  if (/\b(dock|land|return to charge)\b/.test(normalized)) return 'dock';
  if (/\b(clear|push|move.*barrier|debris)\b/.test(normalized)) {
    return robotId === 'kestrel-d5' ? 'inspect' : 'clear';
  }
  if (/\b(stabilize|brace|assist)\b/.test(normalized)) return 'stabilize';
  if (/\b(handoff|deliver)\b/.test(normalized)) return 'handoff';
  if (/\b(carry|transport|move)\b/.test(normalized)) return 'carry';
  return defaultRobotTaskVerb(robotId);
}

export class RobotTaskController {
  private verb: RobotTaskVerb;
  private status: RobotTaskStatus = 'idle';
  private sequence = 0;
  private completedSequence = 0;
  private elapsedSeconds = 0;
  private durationSeconds = 0;

  constructor(private readonly robotId: RobotId) {
    this.verb = defaultRobotTaskVerb(robotId);
  }

  get snapshot(): RobotTaskSnapshot {
    const active = this.status === 'executing';
    return {
      active,
      phase:
        active && this.durationSeconds > 0
          ? Math.min(1, this.elapsedSeconds / this.durationSeconds)
          : 0,
      verb: this.verb,
      status: this.status,
      sequence: this.sequence,
      completedSequence: this.completedSequence,
      elapsedSeconds: this.elapsedSeconds,
      durationSeconds: this.durationSeconds,
    };
  }

  trigger(verb = defaultRobotTaskVerb(this.robotId)): boolean {
    if (this.status === 'executing') return false;
    this.verb = verb;
    this.status = 'executing';
    this.sequence += 1;
    this.elapsedSeconds = 0;
    this.durationSeconds = TASK_DURATION_SECONDS[verb] ?? 2.4;
    return true;
  }

  update(fixedDt: number): void {
    if (this.status !== 'executing' || !Number.isFinite(fixedDt) || fixedDt <= 0) return;
    this.elapsedSeconds = Math.min(this.durationSeconds, this.elapsedSeconds + fixedDt);
    if (this.elapsedSeconds < this.durationSeconds) return;
    this.status = 'completed';
    this.completedSequence = this.sequence;
  }

  cancel(): boolean {
    if (this.status !== 'executing') return false;
    this.status = 'idle';
    this.elapsedSeconds = 0;
    this.durationSeconds = 0;
    return true;
  }

  acknowledgeCompletion(): boolean {
    if (this.status !== 'completed') return false;
    this.status = 'idle';
    this.elapsedSeconds = 0;
    this.durationSeconds = 0;
    return true;
  }

  reset(): void {
    this.verb = defaultRobotTaskVerb(this.robotId);
    this.status = 'idle';
    this.sequence = 0;
    this.completedSequence = 0;
    this.elapsedSeconds = 0;
    this.durationSeconds = 0;
  }
}
