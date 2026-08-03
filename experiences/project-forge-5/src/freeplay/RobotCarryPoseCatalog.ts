import * as THREE from 'three';
import type { RobotId } from '../config/catalog';
import {
  CARRYABLE_OBJECT_IDS,
  type CarryableObjectId,
  type RobotCarryMode,
} from '../robots/RobotCarryRigContract';

type Tuple3 = readonly [number, number, number];

export type RobotCarryPose = Readonly<{
  robotId: RobotId;
  objectId: CarryableObjectId;
  mode: RobotCarryMode;
  socketName: string;
  localOffset: Tuple3;
  localEuler: Tuple3;
  gripSpanMeters: number;
  loadScale: number;
  clearanceMeters: number;
}>;

type ObjectGripProfile = Readonly<{
  gripSpanMeters: number;
  halfHeightMeters: number;
  massKg: number;
  localEuler: Tuple3;
  centerBias: Tuple3;
}>;

const OBJECT_GRIP_PROFILES: Readonly<Record<CarryableObjectId, ObjectGripProfile>> = {
  'playground-ball': {
    gripSpanMeters: 0.52,
    halfHeightMeters: 0.38,
    massKg: 0.7,
    localEuler: [0, 0, 0],
    centerBias: [0, 0.04, 0],
  },
  'wooden-crate': {
    gripSpanMeters: 0.62,
    halfHeightMeters: 0.4,
    massKg: 8,
    localEuler: [0, 0, 0],
    centerBias: [0, 0.05, 0],
  },
  'traffic-cone': {
    gripSpanMeters: 0.36,
    halfHeightMeters: 0.5,
    massKg: 1.2,
    localEuler: [0, 0, 0],
    centerBias: [0, 0.14, 0],
  },
  'metal-barrel': {
    gripSpanMeters: 0.68,
    halfHeightMeters: 0.55,
    massKg: 14,
    localEuler: [0, 0, 0],
    centerBias: [0, 0.18, 0],
  },
  'flying-disc': {
    gripSpanMeters: 0.46,
    halfHeightMeters: 0.055,
    massKg: 0.35,
    localEuler: [0, 0, 0],
    centerBias: [0, -0.12, 0],
  },
  'cargo-case': {
    gripSpanMeters: 0.7,
    halfHeightMeters: 0.3,
    massKg: 6,
    localEuler: [0, Math.PI / 2, 0],
    centerBias: [0, 0, 0],
  },
};

const ROBOT_CARRY_PROFILES: Readonly<
  Record<
    RobotId,
    Readonly<{
      mode: RobotCarryMode;
      socketName: string;
      localOffset: Tuple3;
      clearanceMeters: number;
    }>
  >
> = {
  'axiom-h1': {
    mode: 'bimanual',
    socketName: 'chest-bimanual-center',
    localOffset: [0, 0, 0],
    clearanceMeters: 0.16,
  },
  'quadrant-q4': {
    mode: 'dorsal-rack',
    socketName: 'dorsal-payload-rack',
    localOffset: [0, 0.22, 0.04],
    clearanceMeters: 0.12,
  },
  'forge-t7': {
    mode: 'tool-gripper',
    socketName: 'quick-change-gripper',
    localOffset: [0, 0, -0.08],
    clearanceMeters: 0.2,
  },
  'swift-w2': {
    mode: 'dual-arm-cradle',
    socketName: 'dual-arm-cradle-center',
    localOffset: [0, 0.02, -0.04],
    clearanceMeters: 0.14,
  },
  'kestrel-d5': {
    mode: 'underslung-hook',
    socketName: 'underslung-payload-hook',
    localOffset: [0, -0.08, 0],
    clearanceMeters: 0.18,
  },
};

export function resolveRobotCarryPose(
  robotId: RobotId,
  objectId: CarryableObjectId,
): RobotCarryPose {
  const robot = ROBOT_CARRY_PROFILES[robotId];
  const object = OBJECT_GRIP_PROFILES[objectId];
  const verticalSizeAdjustment =
    robotId === 'kestrel-d5'
      ? Math.max(0, object.halfHeightMeters - 0.3) * 0.32
      : Math.max(0, object.halfHeightMeters - 0.3) * 0.58;
  const objectBiasY =
    robotId === 'kestrel-d5'
      ? object.centerBias[1] * 0.2 + verticalSizeAdjustment
      : object.centerBias[1] + verticalSizeAdjustment;
  return {
    robotId,
    objectId,
    mode: robot.mode,
    socketName: robot.socketName,
    localOffset: [
      robot.localOffset[0] + object.centerBias[0],
      robot.localOffset[1] + objectBiasY,
      robot.localOffset[2] + object.centerBias[2],
    ],
    localEuler: object.localEuler,
    gripSpanMeters: object.gripSpanMeters,
    loadScale: THREE.MathUtils.clamp(object.massKg / 14, 0.08, 1),
    clearanceMeters: robot.clearanceMeters,
  };
}

export const ROBOT_CARRY_POSES: readonly RobotCarryPose[] = Object.freeze(
  (['axiom-h1', 'quadrant-q4', 'forge-t7', 'swift-w2', 'kestrel-d5'] as const).flatMap((robotId) =>
    CARRYABLE_OBJECT_IDS.map((objectId) => resolveRobotCarryPose(robotId, objectId)),
  ),
);
