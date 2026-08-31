import * as THREE from 'three';
import { cloneModel, type LoadedModel } from '../assets/loadModels';
import {
  isIntentionalStaticJoin,
  primaryBoatFootprint,
} from '../assets/collisionProfiles';
import type { ModelAssetId } from '../assets/registry';
import type { LevelDef } from './LevelDef';
import { overlapOBB, type OBB } from '../systems/CollisionSystem';
import type { FloatingBodyKind, FloatingBodySpec } from '../systems/FloatingBodySystem';
import { liftAboveWater, liftFloating, WATER_CLEARANCE } from './grounding';
import {
  buildAuthoredObstacles,
  buildBoundaryObstacles,
  buildSlipPostObstacles,
} from './LevelObstacles';
import { createSlipMarker, type SlipMarker } from './SlipMarker';

export type BuiltMarina = {
  group: THREE.Group;
  obstacles: OBB[];
  slipMesh: THREE.Mesh;
  slipMarker: SlipMarker;
  buoyPositions: { x: number; z: number }[];
  floatables: FloatingBodySpec[];
};

/** Place on XZ without wiping the Y bake from normalizeModel(). */
function placeOnWater(mesh: THREE.Object3D, x: number, z: number, yaw: number, scale?: number): void {
  const bakedY = mesh.position.y;
  mesh.position.set(x, bakedY, z);
  mesh.rotation.y = yaw;
  if (scale) mesh.scale.multiplyScalar(scale);
}

function wrapFloating(
  mesh: THREE.Object3D,
  id: string,
  kind: FloatingBodyKind,
  x: number,
  z: number,
  yaw: number,
  halfLength: number,
  halfWidth: number,
): { root: THREE.Group; spec: FloatingBodySpec } {
  const modelY = mesh.position.y;
  mesh.position.set(0, modelY, 0);
  mesh.rotation.y = 0;
  const root = new THREE.Group();
  root.name = `${id}-floating-root`;
  root.position.set(x, 0, z);
  root.rotation.order = 'YXZ';
  root.rotation.y = yaw;
  root.add(mesh);
  const pose = { x, z, yaw };
  return {
    root,
    spec: {
      id,
      kind,
      root,
      halfLength,
      halfWidth,
      getPose: () => pose,
    },
  };
}

export function buildMarina(
  level: LevelDef,
  models: Map<ModelAssetId, LoadedModel>,
): BuiltMarina {
  const group = new THREE.Group();
  const obstacles: OBB[] = [];
  const buoyPositions: { x: number; z: number }[] = [];
  const floatables: FloatingBodySpec[] = [];

  for (const [index, dock] of level.docks.entries()) {
    const mesh = cloneModel(models, dock.model);
    placeOnWater(mesh, dock.x, dock.z, dock.yaw, dock.scale);
    liftFloating(mesh, 0.035);
    const hx = dock.collider?.hx ?? 2.5;
    const hz = dock.collider?.hz ?? 0.72;
    const floating = wrapFloating(
      mesh,
      `pontoon-${index}`,
      'pontoon',
      dock.x,
      dock.z,
      dock.yaw,
      Math.max(hx, hz),
      Math.min(hx, hz),
    );
    group.add(floating.root);
    floatables.push(floating.spec);
  }

  for (const [index, prop] of level.props.entries()) {
    const mesh = cloneModel(models, prop.model);
    placeOnWater(mesh, prop.x, prop.z, prop.yaw, prop.scale);
    if (prop.buoy || prop.model === 'buoy_striped') {
      liftFloating(mesh, 0.08);
      const floating = wrapFloating(
        mesh,
        `buoy-${index}`,
        'buoy',
        prop.x,
        prop.z,
        prop.yaw,
        0.43 * (prop.scale ?? 1),
        0.43 * (prop.scale ?? 1),
      );
      group.add(floating.root);
      floatables.push(floating.spec);
      buoyPositions.push({ x: prop.x, z: prop.z });
    } else {
      group.add(mesh);
      liftAboveWater(mesh, WATER_CLEARANCE + 0.04);
    }
  }

  for (const [index, boat] of (level.parkedBoats ?? []).entries()) {
    const mesh = cloneModel(models, boat.model);
    placeOnWater(mesh, boat.x, boat.z, boat.yaw);
    liftFloating(mesh, 0.06);
    const footprint = primaryBoatFootprint(boat.model);
    const floating = wrapFloating(
      mesh,
      `moored-boat-${index}`,
      'moored-boat',
      boat.x,
      boat.z,
      boat.yaw,
      footprint.hz * (boat.scale ?? 1),
      footprint.hx * (boat.scale ?? 1),
    );
    group.add(floating.root);
    floatables.push(floating.spec);
  }

  const authoredObstacles = buildAuthoredObstacles(level);
  validateImportedObjectPlacement(level, authoredObstacles);
  obstacles.push(
    ...authoredObstacles,
    ...buildBoundaryObstacles(level),
    ...buildSlipPostObstacles(level),
  );

  const slipMarker = createSlipMarker(level, models);
  group.add(slipMarker.group);

  return {
    group,
    obstacles,
    slipMesh: slipMarker.pad,
    slipMarker,
    buoyPositions,
    floatables,
  };
}

/** Fail level loading when separately-authored imported models occupy the same solid space. */
function validateImportedObjectPlacement(level: LevelDef, obstacles: readonly OBB[]): void {
  for (let i = 0; i < obstacles.length; i += 1) {
    const a = obstacles[i]!;
    if (!a.model || !a.sourceId) continue;
    for (let j = i + 1; j < obstacles.length; j += 1) {
      const b = obstacles[j]!;
      if (!b.model || !b.sourceId || a.sourceId === b.sourceId) continue;
      if (!overlapOBB(a, b)) continue;
      if (isIntentionalStaticJoin(a.model as ModelAssetId, b.model as ModelAssetId)) continue;
      throw new Error(
        `${level.name}: imported objects ${a.sourceId} (${a.model}) and ` +
          `${b.sourceId} (${b.model}) have overlapping collision volumes.`,
      );
    }
  }
}
