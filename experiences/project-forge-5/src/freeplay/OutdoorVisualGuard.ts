import * as THREE from 'three';
import visualGuardManifest from '../../data/mint/finals/outdoor-freeplay/visual-guard-v1.json';
import { OUTDOOR_FREEPLAY_OBJECTS } from './OutdoorFreeplayCatalog';
import { OUTDOOR_FREEPLAY_WORLD } from './OutdoorFreeplayWorld';

type Vector3Tuple = readonly [number, number, number];

export type OutdoorVisualGuardManifest = Readonly<{
  schemaVersion: 1;
  id: string;
  reviewedAt: string;
  source: Readonly<{
    assetId: string;
    runtimeUrl: string;
    colliderRuntimeUrl: string;
    rootTransform: Readonly<{
      position: Vector3Tuple;
      rotation: Vector3Tuple;
      uniformScale: number;
    }>;
    collider: Readonly<{
      byteSize: number;
      meshCount: number;
      triangleCount: number;
      reviewedBounds: Readonly<{
        min: Vector3Tuple;
        max: Vector3Tuple;
      }>;
    }>;
  }>;
  safeVolume: Readonly<{
    shape: 'aabb';
    bounds: Readonly<{
      min: Vector3Tuple;
      max: Vector3Tuple;
    }>;
    renderedEnvelopePolicy: 'per-robot-turn-clearance';
    maximumRobotHorizontalMarginMeters: number;
    reviewBasis: string;
  }>;
  review: Readonly<{
    status: 'accepted';
    method: readonly string[];
    evidence: readonly string[];
  }>;
  failurePolicy: 'block-outdoor-world';
}>;

export type OutdoorVisualGuardRuntimeProof = Readonly<{
  bounds: THREE.Box3;
  colliderMeshes: number;
  colliderTriangles: number;
}>;

export const OUTDOOR_VISUAL_GUARD_SHA256 =
  '3a634c02d0bbf2992642fb0d3c704ab0ad1f26f3a11b23fe8bf0d4c027cb4249';

export const OUTDOOR_VISUAL_GUARD = visualGuardManifest as unknown as OutdoorVisualGuardManifest;

const COMPATIBILITY_EPSILON_METERS = 0.1;

function tuplesMatch(left: readonly number[], right: readonly number[], epsilon = 1e-9): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => Math.abs(value - right[index]) <= epsilon)
  );
}

function boundsMatch(left: THREE.Box3, right: THREE.Box3): boolean {
  return (
    left.min.distanceTo(right.min) <= COMPATIBILITY_EPSILON_METERS &&
    left.max.distanceTo(right.max) <= COMPATIBILITY_EPSILON_METERS
  );
}

export function getOutdoorVisualSafeBounds(): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(...OUTDOOR_VISUAL_GUARD.safeVolume.bounds.min),
    new THREE.Vector3(...OUTDOOR_VISUAL_GUARD.safeVolume.bounds.max),
  );
}

export function assertOutdoorVisualGuardCompatible(runtime: OutdoorVisualGuardRuntimeProof): void {
  const guard = OUTDOOR_VISUAL_GUARD;
  const world = OUTDOOR_FREEPLAY_WORLD;
  const failures: string[] = [];
  if (guard.schemaVersion !== 1) failures.push('unsupported guard schema');
  if (guard.review.status !== 'accepted') failures.push('guard review is not accepted');
  if (guard.failurePolicy !== 'block-outdoor-world') failures.push('guard is not fail-closed');
  if (guard.source.assetId !== world.manifest.mintWorldAssetId) {
    failures.push('Mint asset identity changed');
  }
  if (guard.source.runtimeUrl !== world.manifest.runtime.runtimeUrl) {
    failures.push('RAD runtime identity changed');
  }
  if (guard.source.colliderRuntimeUrl !== world.manifest.runtime.collider.runtimeUrl) {
    failures.push('collider runtime identity changed');
  }
  if (
    !tuplesMatch(guard.source.rootTransform.position, world.manifest.rootTransform.position) ||
    !tuplesMatch(guard.source.rootTransform.rotation, world.manifest.rootTransform.rotation) ||
    guard.source.rootTransform.uniformScale !== world.manifest.rootTransform.uniformScale
  ) {
    failures.push('shared root transform changed');
  }
  if (
    guard.source.collider.byteSize !== world.colliderBytes ||
    guard.source.collider.meshCount !== runtime.colliderMeshes ||
    guard.source.collider.triangleCount !== runtime.colliderTriangles
  ) {
    failures.push('reviewed collider metrics changed');
  }

  const reviewedBounds = new THREE.Box3(
    new THREE.Vector3(...guard.source.collider.reviewedBounds.min),
    new THREE.Vector3(...guard.source.collider.reviewedBounds.max),
  );
  if (!boundsMatch(runtime.bounds, reviewedBounds)) {
    failures.push('reviewed collider bounds changed');
  }

  const safeBounds = getOutdoorVisualSafeBounds();
  if (safeBounds.isEmpty() || !runtime.bounds.containsBox(safeBounds)) {
    failures.push('safe volume is empty or outside the runtime collider');
  }
  const safeSize = safeBounds.getSize(new THREE.Vector3());
  if (
    safeSize.x <= guard.safeVolume.maximumRobotHorizontalMarginMeters * 2 ||
    safeSize.z <= guard.safeVolume.maximumRobotHorizontalMarginMeters * 2 ||
    safeSize.y < 8
  ) {
    failures.push('safe volume cannot contain the reviewed robot envelopes');
  }
  for (const object of OUTDOOR_FREEPLAY_OBJECTS) {
    const [x, z] = object.resetOffset;
    const margin = guard.safeVolume.maximumRobotHorizontalMarginMeters;
    if (
      x < safeBounds.min.x + margin ||
      x > safeBounds.max.x - margin ||
      z < safeBounds.min.z + margin ||
      z > safeBounds.max.z - margin
    ) {
      failures.push(`freeplay reset offset "${object.id}" is outside the safe volume`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Outdoor visual-splat guard rejected the runtime: ${[...new Set(failures)].join('; ')}`,
    );
  }
}

export function createOutdoorVisualGuardDebugHelper(): THREE.Box3Helper {
  const helper = new THREE.Box3Helper(getOutdoorVisualSafeBounds(), 0xffb31a);
  helper.name = 'outdoor-visual-safe-volume';
  helper.userData.debugLayer = 'colliders';
  helper.visible = false;
  helper.renderOrder = 30;
  const material = helper.material as THREE.LineBasicMaterial;
  material.transparent = true;
  material.opacity = 0.96;
  material.depthTest = false;
  return helper;
}
