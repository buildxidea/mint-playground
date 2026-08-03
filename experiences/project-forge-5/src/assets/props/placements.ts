import * as THREE from 'three';
import { KINETIC_HALL_PROP_BY_ID } from './inventory';
import type {
  MintPropAsset,
  MintPropPlacement,
  MintPropResetPose,
  KineticHallPropPlacement,
  KineticHallPropResetPose,
  QuaternionTuple,
  Vector3Tuple,
} from './types';

export type MintPropPlacementIssue = Readonly<{
  code:
    | 'empty-instance-id'
    | 'duplicate-instance-id'
    | 'unknown-asset-id'
    | 'non-finite-pose'
    | 'invalid-quaternion'
    | 'invalid-scale';
  location: string;
  message: string;
}>;

export type KineticHallPropPlacementIssue = MintPropPlacementIssue;

export const IDENTITY_PROP_RESET_POSE: KineticHallPropResetPose = Object.freeze({
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

/**
 * Reviewed placements for the normalized final Kinetic Hall collider.
 *
 * Every generated GLB is centered on its origin, so Y includes half the
 * scaled authored height. Repeated cones intentionally share one source asset
 * while retaining stable instance identities for reset and replay.
 */
export const KINETIC_HALL_PROP_PLACEMENTS = parseKineticHallPropPlacements([
  {
    instanceId: 'sled-primary',
    assetId: 'powered-sliding-obstacle-sled',
    resetPose: {
      position: [0, 0.393, -2.5],
      quaternion: [0, 0, 0, 1],
      scale: [2, 0.85, 2],
    },
  },
  {
    instanceId: 'barrier-west',
    assetId: 'modular-weighted-safety-barrier',
    resetPose: {
      position: [-2.45, 0.469, -0.7],
      quaternion: [0, 0, 0, 1],
      scale: [2, 1.4, 1.2],
    },
  },
  ...[
    [-0.78, 1.9],
    [0.78, 1.1],
    [-0.78, 0.3],
    [0.78, -0.5],
  ].map(([x, z], index): KineticHallPropPlacement => ({
    instanceId: `slalom-cone-${index + 1}`,
    assetId: 'instrumented-slalom-cone',
    resetPose: {
      position: [x, 0.324, z],
      quaternion: [0, 0, 0, 1],
      scale: [0.65, 0.65, 0.65],
    },
  })),
  {
    instanceId: 'clearance-gantry',
    assetId: 'adjustable-low-clearance-gantry',
    resetPose: {
      position: [0, 1.376, -4.2],
      quaternion: [0, 0, 0, 1],
      scale: [3, 2.8, 1.3],
    },
  },
  {
    instanceId: 'fiducial-west',
    assetId: 'fiducial-inspection-placard',
    resetPose: {
      position: [-2.6, 0.624, -6],
      quaternion: [0, 0.7071067811865476, 0, 0.7071067811865476],
      scale: [1.25, 1.25, 1.25],
    },
  },
  {
    instanceId: 'dock-south',
    assetId: 'precision-docking-target',
    resetPose: {
      position: [1.9825462413043515, 0.5612813247736819, -6.1],
      quaternion: [0, 1, 0, 0],
      scale: [1.4, 1, 1.4],
    },
  },
  {
    instanceId: 'instrument-case',
    assetId: 'rugged-instrument-case',
    resetPose: {
      position: [-2.3, 0.32, 4.5],
      quaternion: [0, 0.7071067811865476, 0, 0.7071067811865476],
      scale: [0.75, 0.75, 0.75],
    },
  },
  {
    instanceId: 'estop-east',
    assetId: 'emergency-stop-pedestal',
    resetPose: {
      position: [2.5, 0.649, 4.8],
      quaternion: [0, -0.7071067811865476, 0, 0.7071067811865476],
      scale: [1.3, 1.3, 1.3],
    },
  },
]);

export function validateKineticHallPropPlacements(
  placements: readonly KineticHallPropPlacement[],
): readonly KineticHallPropPlacementIssue[] {
  return validateMintPropPlacements(placements, KINETIC_HALL_PROP_BY_ID, 'Kinetic Hall');
}

export function validateMintPropPlacements(
  placements: readonly MintPropPlacement[],
  assetsById: Readonly<Record<string, MintPropAsset>>,
  roomLabel: string,
): readonly MintPropPlacementIssue[] {
  const issues: MintPropPlacementIssue[] = [];
  const instanceIds = new Set<string>();

  for (const [index, placement] of placements.entries()) {
    const location = placement.instanceId.trim() || `placements[${index}]`;
    if (!placement.instanceId.trim()) {
      issues.push({
        code: 'empty-instance-id',
        location,
        message: 'instanceId must not be empty',
      });
    } else if (instanceIds.has(placement.instanceId)) {
      issues.push({
        code: 'duplicate-instance-id',
        location,
        message: `instanceId "${placement.instanceId}" is already in use`,
      });
    }
    instanceIds.add(placement.instanceId);

    if (!(placement.assetId in assetsById)) {
      issues.push({
        code: 'unknown-asset-id',
        location,
        message: `Unknown ${roomLabel} prop asset "${placement.assetId}"`,
      });
    }

    const poseValues = [
      ...placement.resetPose.position,
      ...placement.resetPose.quaternion,
      ...placement.resetPose.scale,
    ];
    if (!poseValues.every(Number.isFinite)) {
      issues.push({
        code: 'non-finite-pose',
        location,
        message: 'resetPose values must all be finite',
      });
      continue;
    }

    const quaternionLength = Math.hypot(...placement.resetPose.quaternion);
    if (Math.abs(quaternionLength - 1) > 1e-6) {
      issues.push({
        code: 'invalid-quaternion',
        location,
        message: 'resetPose quaternion must be normalized',
      });
    }
    if (placement.resetPose.scale.some((component) => component <= 0)) {
      issues.push({
        code: 'invalid-scale',
        location,
        message: 'resetPose scale components must be positive',
      });
    }
  }

  return issues;
}

export function parseKineticHallPropPlacements(
  placements: readonly KineticHallPropPlacement[],
): readonly KineticHallPropPlacement[] {
  return parseMintPropPlacements(
    placements,
    KINETIC_HALL_PROP_BY_ID,
    'Kinetic Hall',
  ) as readonly KineticHallPropPlacement[];
}

export function parseMintPropPlacements(
  placements: readonly MintPropPlacement[],
  assetsById: Readonly<Record<string, MintPropAsset>>,
  roomLabel: string,
): readonly MintPropPlacement[] {
  const issues = validateMintPropPlacements(placements, assetsById, roomLabel);
  if (issues.length > 0) {
    throw new Error(
      `Invalid ${roomLabel} prop placements:\n${issues
        .map(({ code, location, message }) => `- [${code}] ${location}: ${message}`)
        .join('\n')}`,
    );
  }

  return Object.freeze(
    placements.map((placement) =>
      Object.freeze({
        instanceId: placement.instanceId,
        assetId: placement.assetId,
        resetPose: Object.freeze({
          position: tuple3(placement.resetPose.position),
          quaternion: tuple4(placement.resetPose.quaternion),
          scale: tuple3(placement.resetPose.scale),
        }),
      }),
    ),
  );
}

export function applyKineticHallPropResetPose(
  root: THREE.Object3D,
  pose: KineticHallPropResetPose,
): void {
  applyMintPropResetPose(root, pose);
}

export function applyMintPropResetPose(root: THREE.Object3D, pose: MintPropResetPose): void {
  root.position.set(...pose.position);
  root.quaternion.set(...pose.quaternion);
  root.scale.set(...pose.scale);
  root.updateMatrix();
}

function tuple3(values: Vector3Tuple): Vector3Tuple {
  return Object.freeze([values[0], values[1], values[2]]);
}

function tuple4(values: QuaternionTuple): QuaternionTuple {
  return Object.freeze([values[0], values[1], values[2], values[3]]);
}
