import type { InputIntent } from '../core/InputController';
import type { TaskFixtureObservation, TaskObjectObservation } from '../physics/PhysicsWorld';
import type { RobotMobilityPosture, RobotTelemetry } from '../robots/RobotRuntime';
import type {
  RobotTaskSnapshot,
  RobotTaskStatus,
  RobotTaskVerb,
} from '../tasks/RobotTaskController';
import type { EpisodeEvent } from '../training/TrainingEpisode';

export type ReplayTaskFrame = Readonly<{
  verb: RobotTaskVerb;
  status: RobotTaskStatus;
  sequence: number;
  completedSequence: number;
  phase: number;
}>;

export type ReplayTaskObjectFrame = Readonly<{
  instanceId: string;
  state: TaskObjectObservation['state'];
  ownerRobotId: string | null;
  sequence: number;
  position: [number, number, number];
}>;

export type ReplayTaskFixtureFrame = Readonly<{
  id: TaskFixtureObservation['id'];
  state: TaskFixtureObservation['state'];
  sequence: number;
  ownerRobotId: string | null;
}>;

export type ReplayFrame = {
  tick: number;
  mobilityPosture: RobotMobilityPosture;
  action: {
    translation: [number, number, number];
    yaw: number;
    interact: boolean;
    secondaryAction?: boolean;
    postureCycle?: boolean;
    precision?: boolean;
    boost: boolean;
    emergencyStop: boolean;
  };
  task: ReplayTaskFrame;
  taskObject: ReplayTaskObjectFrame | null;
  taskFixtures: ReplayTaskFixtureFrame[];
  keyframe?: {
    position: [number, number, number];
    yaw: number;
    battery: number;
    collisions: number;
    stateHash: string;
  };
};

export type ReplayData = {
  version: 4;
  seed: number;
  robotId: string;
  roomId: string;
  scenarioId: string;
  fixedDt: number;
  identity: Readonly<{
    runtimeContract: 'forge5-authoritative-fixture-task-v2';
    environmentMode: 'production' | 'commissioning';
    worldAssetId: string | null;
    propAssetPackId: string | null;
  }>;
  frames: ReplayFrame[];
  events: EpisodeEvent[];
};

export class ReplayRecorder {
  private readonly frames: ReplayFrame[] = [];

  constructor(private readonly metadata: Omit<ReplayData, 'version' | 'frames' | 'events'>) {}

  record(
    tick: number,
    action: InputIntent,
    telemetry: RobotTelemetry,
    mobilityPosture: RobotMobilityPosture,
    task: RobotTaskSnapshot,
    taskObject: TaskObjectObservation | null,
    taskFixtures: readonly TaskFixtureObservation[] = [],
  ): void {
    const frame: ReplayFrame = {
      tick,
      mobilityPosture,
      action: {
        translation: [action.translation.x, action.translation.y, action.translation.z],
        yaw: action.yaw,
        interact: action.interact,
        secondaryAction: action.secondaryAction,
        postureCycle: action.postureCycle,
        precision: action.precision,
        boost: action.boost,
        emergencyStop: action.emergencyStop,
      },
      task: {
        verb: task.verb,
        status: task.status,
        sequence: task.sequence,
        completedSequence: task.completedSequence,
        phase: task.phase,
      },
      taskObject: taskObject
        ? {
            instanceId: taskObject.instanceId,
            state: taskObject.state,
            ownerRobotId: taskObject.ownerRobotId,
            sequence: taskObject.sequence,
            position: [taskObject.position.x, taskObject.position.y, taskObject.position.z],
          }
        : null,
      taskFixtures: taskFixtures.map((fixture) => ({
        id: fixture.id,
        state: fixture.state,
        sequence: fixture.sequence,
        ownerRobotId: fixture.ownerRobotId,
      })),
    };
    if (tick % 60 === 0) {
      frame.keyframe = {
        position: [telemetry.position.x, telemetry.position.y, telemetry.position.z],
        yaw: telemetry.yaw,
        battery: telemetry.battery,
        collisions: telemetry.collisions,
        stateHash: computeReplayStateHash(
          telemetry,
          task,
          taskObject,
          taskFixtures,
          mobilityPosture,
        ),
      };
    }
    this.frames.push(frame);
  }

  export(events: readonly EpisodeEvent[]): ReplayData {
    return {
      version: 4,
      ...this.metadata,
      frames: this.frames.map((frame) => ({
        ...frame,
        action: { ...frame.action, translation: [...frame.action.translation] },
        task: { ...frame.task },
        taskObject: frame.taskObject
          ? { ...frame.taskObject, position: [...frame.taskObject.position] }
          : null,
        taskFixtures: frame.taskFixtures.map((fixture) => ({ ...fixture })),
        keyframe: frame.keyframe
          ? {
              ...frame.keyframe,
              position: [...frame.keyframe.position],
            }
          : undefined,
      })),
      events: events.map((event) => ({ ...event })),
    };
  }

  static load(serialized: string): ReplayData {
    const data = JSON.parse(serialized) as Partial<ReplayData>;
    if (
      data.version !== 4 ||
      !Array.isArray(data.frames) ||
      !Array.isArray(data.events) ||
      typeof data.seed !== 'number' ||
      data.identity?.runtimeContract !== 'forge5-authoritative-fixture-task-v2' ||
      (data.identity.environmentMode !== 'production' &&
        data.identity.environmentMode !== 'commissioning') ||
      (data.identity.worldAssetId !== null && typeof data.identity.worldAssetId !== 'string') ||
      (data.identity.propAssetPackId !== null &&
        typeof data.identity.propAssetPackId !== 'string') ||
      !data.frames.every(isReplayFrame)
    ) {
      throw new Error('Invalid Forge-5 replay');
    }
    return data as ReplayData;
  }
}

export function computeReplayStateHash(
  telemetry: RobotTelemetry,
  task: RobotTaskSnapshot | ReplayTaskFrame,
  taskObject: TaskObjectObservation | ReplayTaskObjectFrame | null,
  taskFixtures: readonly (TaskFixtureObservation | ReplayTaskFixtureFrame)[] = [],
  mobilityPosture: RobotMobilityPosture = 'standing',
): string {
  const taskObjectPosition: readonly number[] = taskObject
    ? 'x' in taskObject.position
      ? [taskObject.position.x, taskObject.position.y, taskObject.position.z]
      : [taskObject.position[0], taskObject.position[1], taskObject.position[2]]
    : [];
  const values: string[] = [
    finiteReplayNumber(telemetry.position.x, 2),
    finiteReplayNumber(telemetry.position.y, 2),
    finiteReplayNumber(telemetry.position.z, 2),
    finiteReplayNumber(telemetry.yaw, 3),
    finiteReplayNumber(telemetry.battery, 3),
    String(telemetry.collisions),
    mobilityPosture,
    task.verb,
    task.status,
    String(task.sequence),
    String(task.completedSequence),
    taskObject?.instanceId ?? 'none',
    taskObject?.state ?? 'none',
    taskObject?.ownerRobotId ?? 'none',
    String(taskObject?.sequence ?? 0),
    ...taskObjectPosition.map((value) => finiteReplayNumber(value, 2)),
    ...[...taskFixtures]
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((fixture) => [
        fixture.id,
        fixture.state,
        String(fixture.sequence),
        fixture.ownerRobotId ?? 'none',
      ]),
  ];
  const serialized = values.join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function finiteReplayNumber(value: number, decimalPlaces: number): string {
  return Number.isFinite(value) ? value.toFixed(decimalPlaces) : 'invalid';
}

function isReplayFrame(frame: ReplayFrame): boolean {
  return (
    Number.isInteger(frame?.tick) &&
    frame.tick >= 0 &&
    (frame.mobilityPosture === 'standing' ||
      frame.mobilityPosture === 'crouched' ||
      frame.mobilityPosture === 'crawling') &&
    Array.isArray(frame.action?.translation) &&
    frame.action.translation.length === 3 &&
    typeof frame.task?.verb === 'string' &&
    typeof frame.task?.status === 'string' &&
    Number.isInteger(frame.task?.sequence) &&
    (frame.taskObject === null ||
      (typeof frame.taskObject?.instanceId === 'string' &&
        Array.isArray(frame.taskObject.position) &&
        frame.taskObject.position.length === 3)) &&
    Array.isArray(frame.taskFixtures) &&
    frame.taskFixtures.every(
      (fixture) =>
        (fixture.id === 'control-panel-east' || fixture.id === 'dock-south') &&
        (fixture.state === 'ready' || fixture.state === 'actuated') &&
        Number.isInteger(fixture.sequence) &&
        (fixture.ownerRobotId === null || typeof fixture.ownerRobotId === 'string'),
    ) &&
    (frame.keyframe === undefined ||
      (Number.isInteger(frame.keyframe.collisions) &&
        frame.keyframe.collisions >= 0 &&
        /^[0-9a-f]{8}$/.test(frame.keyframe.stateHash)))
  );
}
