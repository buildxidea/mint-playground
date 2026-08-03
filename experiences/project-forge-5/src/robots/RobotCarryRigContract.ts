import type { RobotId } from '../config/catalog';

export const CARRYABLE_OBJECT_IDS = [
  'playground-ball',
  'wooden-crate',
  'traffic-cone',
  'metal-barrel',
  'flying-disc',
  'cargo-case',
] as const;

export type CarryableObjectId = (typeof CARRYABLE_OBJECT_IDS)[number];

export const ROBOT_CARRY_MODES = [
  'bimanual',
  'dorsal-rack',
  'tool-gripper',
  'dual-arm-cradle',
  'underslung-hook',
] as const;

export type RobotCarryMode = (typeof ROBOT_CARRY_MODES)[number];

export type RobotCarryStage =
  'approach' | 'align' | 'secure' | 'lift' | 'hold' | 'lower' | 'release' | 'retract';

export type RobotCarryVisualState = Readonly<{
  active: true;
  robotId: RobotId;
  objectId: CarryableObjectId;
  mode: RobotCarryMode;
  socketName: string;
  stage: RobotCarryStage;
  progress: number;
  reach: number;
  gripClosure: number;
  lift: number;
  gripSpanMeters: number;
  loadScale: number;
}>;

export type RobotCarryMotion = Readonly<{
  stage: RobotCarryStage;
  progress: number;
  reach: number;
  gripClosure: number;
  lift: number;
  attachReady: boolean;
  detachReady: boolean;
}>;

const smoothstep = (start: number, end: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - start) / Math.max(1e-6, end - start)));
  return t * t * (3 - 2 * t);
};

export function resolveRobotCarryMotion(
  phase: number,
  operation: 'pickup' | 'release',
): RobotCarryMotion {
  const progress = Number.isFinite(phase) ? Math.max(0, Math.min(1, phase)) : 0;
  if (operation === 'release') {
    return {
      stage: progress < 0.52 ? 'lower' : progress < 0.72 ? 'release' : 'retract',
      progress,
      reach: 1 - smoothstep(0.7, 1, progress),
      gripClosure: 1 - smoothstep(0.52, 0.68, progress),
      lift: 1 - smoothstep(0.06, 0.58, progress),
      attachReady: false,
      detachReady: progress >= 0.64,
    };
  }

  return {
    stage:
      progress < 0.24
        ? 'approach'
        : progress < 0.46
          ? 'align'
          : progress < 0.62
            ? 'secure'
            : progress < 0.9
              ? 'lift'
              : 'hold',
    progress,
    reach: smoothstep(0, 0.48, progress),
    gripClosure: smoothstep(0.44, 0.6, progress),
    lift: smoothstep(0.62, 0.9, progress),
    attachReady: progress >= 0.58,
    detachReady: false,
  };
}

export function heldCarryMotion(): RobotCarryMotion {
  return {
    stage: 'hold',
    progress: 1,
    reach: 1,
    gripClosure: 1,
    lift: 1,
    attachReady: true,
    detachReady: false,
  };
}
