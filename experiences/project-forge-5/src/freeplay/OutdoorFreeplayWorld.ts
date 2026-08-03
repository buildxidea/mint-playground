import * as THREE from 'three';
import type { MintWorldRuntimeManifest } from '../worlds/MintWorldManifest';

export const OUTDOOR_FREEPLAY_WORLD = Object.freeze({
  name: 'Robot Adventure Valley',
  status: 'succeeded' as const,
  assetStage: 'final' as const,
  runtimeBytes: 32_487_008,
  colliderBytes: 2_193_772,
  colliderMeshes: 1,
  colliderTriangles: 82_394,
  manifest: {
    roomId: 'outdoor-freeplay',
    mintWorldAssetId: 'j97bt7r9p735amxb01schdvj058bfyj1',
    integrationMode: 'remote_stream',
    runtime: {
      runtimeUrl: 'https://cdn.mint.gg/rad/robot-valley-playground-5efb2e67e8354eb8-lod.rad',
      collider: {
        runtimeUrl:
          'https://cdn.mint.gg/worlds/robot-valley-playground-collider-e44ae2256c5c32ce.glb',
      },
    },
    rootTransform: {
      position: [0, 1.5, 0],
      rotation: [Math.PI, Math.PI, 0],
      uniformScale: 2.5,
    },
  } satisfies MintWorldRuntimeManifest,
  reviewedBounds: Object.freeze({
    min: Object.freeze([-223.69861602783206, -0.18246448040011143, -212.49402999877933] as const),
    max: Object.freeze([161.8857192993164, 102.87975692749025, 89.1442680358887] as const),
  }),
});

export function getOutdoorFreeplayReviewedBounds(): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(...OUTDOOR_FREEPLAY_WORLD.reviewedBounds.min),
    new THREE.Vector3(...OUTDOOR_FREEPLAY_WORLD.reviewedBounds.max),
  );
}
