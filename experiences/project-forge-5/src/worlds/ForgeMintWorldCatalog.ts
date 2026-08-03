import * as THREE from 'three';
import { ROBOT_WORLD_MARGIN, type RobotId, type RoomId } from '../config/catalog';
import { getScenarioRoute } from '../config/scenarioRoutes';
import { KINETIC_HALL_COORDINATE_ALIGNMENT } from '../splats/KineticHallCoordinateAlignment';
import type { MintPropPlacement } from '../assets/props';
import {
  getSplatContainmentBounds,
  validateSplatContainmentManifest,
  type SplatContainmentManifest,
} from '../splats/SplatContainmentManifest';
import type { SplatCalibrationRecord } from '../splats/types';
import type { MintWorldRuntimeManifest } from './MintWorldManifest';

export const MINT_WORLD_EXPERIENCE_SCALE = 2;

type ReviewedBounds = Readonly<{
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}>;

export type ForgeMintWorldRecord = Readonly<{
  manifest: MintWorldRuntimeManifest;
  calibratedBounds: ReviewedBounds;
  containment: SplatContainmentManifest;
  calibration: 'collider-bounds-normalized' | 'accepted-analyzer-to-world';
  coordinateAlignment: SplatCalibrationRecord | null;
  navigation: 'collider-navmesh-runtime';
  semantics: 'pending-analyzer';
}>;

/**
 * Collider roots retain the measured, gameplay-qualified GLB frame. Each RAD
 * has a separately declared visual transform that resolves its source
 * presentation basis into that collider frame.
 */
export const FORGE_MINT_WORLDS: Readonly<Record<RoomId, ForgeMintWorldRecord>> = {
  'kinetic-hall': {
    manifest: {
      roomId: 'kinetic-hall',
      mintWorldAssetId: 'j9767qkb0ew316acv0gpbsj2ks8b915m',
      integrationMode: 'remote_stream',
      runtime: {
        runtimeUrl: 'https://cdn.mint.gg/rad/robotics-test-hall-7ff533e29f5f0fab-lod.rad',
        collider: {
          runtimeUrl:
            'https://cdn.mint.gg/worlds/kinetic-robotics-hall-collider-glb-2f2fa1b154c030a9.glb',
        },
      },
      rootTransform: {
        position: [3.613807201385498, 3.936429500579834, 0.2006683349609375],
        rotation: [0, 0, 0],
        uniformScale: MINT_WORLD_EXPERIENCE_SCALE,
      },
      visualTransform: {
        position: [0, -1.2593591213226318, -0.2006683349609375],
        rotation: [Math.PI, 0, 0],
        uniformScale: 1,
      },
    },
    calibratedBounds: {
      min: [-7.388126850128174, 0, -21.183399200439453],
      max: [7.388126850128174, 5.354140758514404, 21.183399200439453],
    },
    containment: {
      schemaVersion: 1,
      roomId: 'kinetic-hall',
      sourceSplatSha256: 'd6bf20bc58907c63f2e74df65fb02dbf6ab4103d2634a29739c9566c014c7178',
      basis: 'right-handed-y-up-meters',
      envelope: 'shared-root-collider-aabb',
      reviewStatus: 'coordinate-alignment-reviewed',
      semanticAuthority: false,
      bounds: {
        min: [-7.388126850128174, 0, -21.183399200439453],
        max: [7.388126850128174, 5.354140758514404, 21.183399200439453],
      },
    },
    calibration: 'accepted-analyzer-to-world',
    coordinateAlignment: KINETIC_HALL_COORDINATE_ALIGNMENT,
    navigation: 'collider-navmesh-runtime',
    semantics: 'pending-analyzer',
  },
  'precision-cell': {
    manifest: {
      roomId: 'precision-cell',
      mintWorldAssetId: 'j970vp62jb0qn0zv23prcwvp298b8n7b',
      integrationMode: 'remote_stream',
      runtime: {
        runtimeUrl: 'https://cdn.mint.gg/rad/precision-robotics-cell-6b56a5f41b3fbe6c-lod.rad',
        collider: {
          runtimeUrl:
            'https://cdn.mint.gg/worlds/precision-robotics-cell-collider-glb-a45fa8c3855b43d2.glb',
        },
      },
      rootTransform: {
        position: [-4.715074181556702, 4.1231608390808105, -1.3341035842895508],
        rotation: [0, 0, 0],
        uniformScale: MINT_WORLD_EXPERIENCE_SCALE,
      },
      visualTransform: {
        position: [0, -1.3716691732406616, 1.3341035842895508],
        rotation: [Math.PI, 0, 0],
        uniformScale: 1,
      },
    },
    calibratedBounds: {
      min: [-8.58114, 0, -26.615176],
      max: [8.58114, 5.502983331680298, 26.615176],
    },
    containment: {
      schemaVersion: 1,
      roomId: 'precision-cell',
      sourceSplatSha256: '83247fca38bbafff3100a55253be3301f06b6623bacd2bc9de78494fff1c76e9',
      basis: 'right-handed-y-up-meters',
      envelope: 'shared-root-collider-aabb',
      reviewStatus: 'collider-envelope-reviewed',
      semanticAuthority: false,
      bounds: {
        min: [-8.58114, 0, -26.615176],
        max: [8.58114, 5.502983331680298, 26.615176],
      },
    },
    calibration: 'collider-bounds-normalized',
    coordinateAlignment: null,
    navigation: 'collider-navmesh-runtime',
    semantics: 'pending-analyzer',
  },
  'crisis-bay': {
    manifest: {
      roomId: 'crisis-bay',
      mintWorldAssetId: 'j976jvmvtse2y745k4fmpp2xcd8b8wzj',
      integrationMode: 'remote_stream',
      runtime: {
        runtimeUrl: 'https://cdn.mint.gg/rad/crisis-bay-chamber-60d06154dd700843-lod.rad',
        collider: {
          runtimeUrl:
            'https://cdn.mint.gg/worlds/crisis-bay-chamber-collider-glb-392c8c9d12bcde15.glb',
        },
      },
      rootTransform: {
        position: [-1.7038694620132446, 6.587590217590332, -11.069660186767578],
        rotation: [0, 0, 0],
        uniformScale: MINT_WORLD_EXPERIENCE_SCALE,
      },
      visualTransform: {
        position: [0, -2.6991220116615295, 11.069660186767578],
        rotation: [Math.PI, 0, 0],
        uniformScale: 1,
      },
    },
    calibratedBounds: {
      min: [-5.267492175102234, 0, -15.7496337890625],
      max: [5.267492175102234, 7.776936411857605, 15.7496337890625],
    },
    containment: {
      schemaVersion: 1,
      roomId: 'crisis-bay',
      sourceSplatSha256: 'ebd502c6d9988d7382987c3aa6bb8bc8fae66c4a296abdf75f0637851a7d1ede',
      basis: 'right-handed-y-up-meters',
      envelope: 'shared-root-collider-aabb',
      reviewStatus: 'collider-envelope-reviewed',
      semanticAuthority: false,
      bounds: {
        min: [-5.267492175102234, 0, -15.7496337890625],
        max: [5.267492175102234, 7.776936411857605, 15.7496337890625],
      },
    },
    calibration: 'collider-bounds-normalized',
    coordinateAlignment: null,
    navigation: 'collider-navmesh-runtime',
    semantics: 'pending-analyzer',
  },
};

const COMMISSIONING_BOUNDS = Object.freeze({
  minX: -17,
  maxX: 17,
  minZ: -11,
  maxZ: 11,
  maxAerialY: 4.2,
});

// Final Mint rooms are substantially narrower than the commissioning arena.
// Keep provisional routes around the open center volume until analyzer-derived
// walkable surfaces replace this bounds projection.
const PROVISIONAL_ROUTE_SPAN = Object.freeze({
  x: 0.42,
  z: 0.42,
});

/**
 * Collider- and RAD-reviewed start cells with an unobstructed chase-camera
 * view. They are shared by all morphologies until semantic spawn regions are
 * available from analyzer evidence.
 */
const PROVISIONAL_SPAWN: Readonly<Record<RoomId, readonly [number, number, number]>> = {
  'kinetic-hall': [-1.02, 0, 2.85],
  'precision-cell': [-2.31, 0, 2.19],
  'crisis-bay': [-0.52, 0, -1.43],
};

type RoutePoint = readonly [number, number, number];
type RouteOverrideKey = `${RoomId}/${RobotId}`;

/**
 * Collider-reviewed commissioning corridors for morphology/World pairs whose
 * generic bounds projection lands several objectives inside the 1.1 m
 * completion tolerance or on a disconnected navmesh island.
 */
const REVIEWED_ROUTE_OVERRIDES: Readonly<Partial<Record<RouteOverrideKey, readonly RoutePoint[]>>> =
  {
    'kinetic-hall/axiom-h1': [
      [-1.02, 0, 2.85],
      [1.2, 0, -1.8],
      [0.33, 0, -2.06],
      [2.62, 0, -1.3907620727223216],
      [2, 0.08928132477368189, -5.33555],
    ],
    'kinetic-hall/quadrant-q4': [
      [-1, 0, 2.8],
      [-1, 0, 0.4],
      [-0.9, 0, -1.4],
      [-0.6, 0, -3.2],
      [0, 0, -5],
    ],
    'kinetic-hall/forge-t7': [
      [-1, 0, 2.8],
      [-1, 0, 1],
      [-1, 0, -0.8],
      [-1, 0, -3],
      [-0.5, 0, -5],
    ],
    'kinetic-hall/swift-w2': [
      [0.3, 0, 2.8],
      [0.2, 0, 0.5],
      [0.1, 0, -1.5],
      [0.2, 0, -3.5],
      [0.8, 0, -5.2],
    ],
    'precision-cell/axiom-h1': [
      [-2.31, 0, 2.19],
      [-2.3, 0, 3.6],
      [-2.2, 0, 5],
      [-2.1, 0, 6.4],
      [-2, 0, 7.8],
    ],
    'precision-cell/quadrant-q4': [
      [-3.15, 0, -11.25],
      [-3.15, 0, -9],
      [-3.12, 0, -8],
      [-3.08, 0, -6.75],
      [-3.04, 0, -5.76],
    ],
    'precision-cell/forge-t7': [
      [-3.04, 0, -11.25],
      [-3.04, 0, -9],
      [-3.04, 0, -8],
      [-3.04, 0, -6.75],
      [-3.04, 0, -5.76],
    ],
  };

export function getForgeMintWorld(roomId: RoomId): ForgeMintWorldRecord {
  return FORGE_MINT_WORLDS[roomId];
}

export function getForgeMintWorldBounds(roomId: RoomId): THREE.Box3 {
  return getSplatContainmentBounds(FORGE_MINT_WORLDS[roomId].containment);
}

export function getForgeMintContainmentManifest(roomId: RoomId): SplatContainmentManifest {
  return validateSplatContainmentManifest(FORGE_MINT_WORLDS[roomId].containment);
}

export function scaleMintWorldPoint(
  point: readonly [number, number, number],
): [number, number, number] {
  return [point[0] * MINT_WORLD_EXPERIENCE_SCALE, point[1], point[2] * MINT_WORLD_EXPERIENCE_SCALE];
}

export function scaleMintWorldPropPlacements(
  placements: readonly MintPropPlacement[],
): readonly MintPropPlacement[] {
  return placements.map((placement) => ({
    ...placement,
    resetPose: {
      ...placement.resetPose,
      position: scaleMintWorldPoint(placement.resetPose.position),
    },
  }));
}

/**
 * Projects the deterministic commissioning route into the reviewed collider
 * envelope. These points are provisional until analyzer semantics/navmesh are
 * reviewed, but they never target space outside the final World bounds.
 */
export function getForgeMintScenarioRoute(
  roomId: RoomId,
  robotId: RobotId,
): readonly THREE.Vector3[] {
  const reviewedOverride = REVIEWED_ROUTE_OVERRIDES[`${roomId}/${robotId}`];
  if (reviewedOverride) {
    return reviewedOverride.map((point) => new THREE.Vector3(...scaleMintWorldPoint(point)));
  }

  const bounds = FORGE_MINT_WORLDS[roomId].calibratedBounds;
  const margin = ROBOT_WORLD_MARGIN[robotId];
  const minX = bounds.min[0] + margin;
  const maxX = bounds.max[0] - margin;
  const minZ = bounds.min[2] + margin;
  const maxZ = bounds.max[2] - margin;
  const maximumFlightY = Math.max(1.2, bounds.max[1] - 0.5);

  const route = getScenarioRoute(roomId, robotId).map((point) => {
    const normalizedX =
      (point.x - COMMISSIONING_BOUNDS.minX) /
      (COMMISSIONING_BOUNDS.maxX - COMMISSIONING_BOUNDS.minX);
    const normalizedZ =
      (point.z - COMMISSIONING_BOUNDS.minZ) /
      (COMMISSIONING_BOUNDS.maxZ - COMMISSIONING_BOUNDS.minZ);
    const y =
      robotId === 'kestrel-d5'
        ? THREE.MathUtils.lerp(
            1.15,
            maximumFlightY,
            THREE.MathUtils.clamp(point.y / COMMISSIONING_BOUNDS.maxAerialY, 0, 1),
          )
        : 0;
    const projectedX = THREE.MathUtils.lerp(minX, maxX, normalizedX);
    const projectedZ = THREE.MathUtils.lerp(minZ, maxZ, normalizedZ);
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    return new THREE.Vector3(
      THREE.MathUtils.lerp(centerX, projectedX, PROVISIONAL_ROUTE_SPAN.x),
      y,
      THREE.MathUtils.lerp(centerZ, projectedZ, PROVISIONAL_ROUTE_SPAN.z),
    );
  });
  route[0].set(...scaleMintWorldPoint(PROVISIONAL_SPAWN[roomId]));
  return route;
}
