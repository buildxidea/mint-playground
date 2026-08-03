import type { RobotId } from '../config/catalog';
import { ROBOT_TASK_VERBS, type RobotTaskVerb } from '../tasks/RobotTaskController';

export type RobotCapabilityProfile = Readonly<{
  taskVerbs: readonly RobotTaskVerb[];
  secondaryAction: 'release-or-cancel';
  supportsPrecisionMotion: true;
  supportsPostureCycle: boolean;
}>;

const ALL_TASK_VERBS = [...ROBOT_TASK_VERBS];

const CAPABILITIES: Readonly<Record<RobotId, RobotCapabilityProfile>> = {
  'axiom-h1': {
    taskVerbs: ALL_TASK_VERBS,
    secondaryAction: 'release-or-cancel',
    supportsPrecisionMotion: true,
    supportsPostureCycle: true,
  },
  'quadrant-q4': {
    taskVerbs: ['grasp', 'carry', 'release', 'dock', 'inspect', 'scan', 'stabilize', 'handoff'],
    secondaryAction: 'release-or-cancel',
    supportsPrecisionMotion: true,
    supportsPostureCycle: false,
  },
  'forge-t7': {
    taskVerbs: [
      'grasp',
      'carry',
      'release',
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
    ],
    secondaryAction: 'release-or-cancel',
    supportsPrecisionMotion: true,
    supportsPostureCycle: false,
  },
  'swift-w2': {
    taskVerbs: [
      'grasp',
      'carry',
      'release',
      'insert',
      'press',
      'connect',
      'disconnect',
      'dock',
      'inspect',
      'scan',
      'handoff',
    ],
    secondaryAction: 'release-or-cancel',
    supportsPrecisionMotion: true,
    supportsPostureCycle: false,
  },
  'kestrel-d5': {
    taskVerbs: ['grasp', 'carry', 'release', 'dock', 'inspect', 'scan', 'handoff'],
    secondaryAction: 'release-or-cancel',
    supportsPrecisionMotion: true,
    supportsPostureCycle: false,
  },
};

export function getRobotCapabilityProfile(robotId: RobotId): RobotCapabilityProfile {
  return CAPABILITIES[robotId];
}

export function supportsRobotTaskVerb(robotId: RobotId, verb: RobotTaskVerb): boolean {
  return CAPABILITIES[robotId].taskVerbs.includes(verb);
}

export function formatRobotTaskVerb(verb: RobotTaskVerb): string {
  return verb.replaceAll('-', ' ').toUpperCase();
}
