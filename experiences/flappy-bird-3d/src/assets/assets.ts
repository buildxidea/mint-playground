import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createMintGltfLoader } from './gltf-runtime';

export const MODEL_URLS = {
  pipe: 'https://cdn.mint.gg/glb/glossy-green-warp-pipe-normalized-4b20c5a00336026f.glb',
  cloud: 'https://cdn.mint.gg/glb/pixel-puff-cloud-normalized-12021a5a316ac06f.glb',
} as const;

export type BirdId = 'classic' | 'red' | 'robo';

export interface BirdOption {
  id: BirdId;
  name: string;
  /** Logical key in mint-assets.json, and the folder under assets/mint. */
  key: string;
  /** Yaw that turns this model's authored facing down -Z, into the screen. */
  yaw: number;
  /** Height in world units; the rest of the model scales with it. */
  height: number;
}

// All three models happen to be authored facing +Z, so a half turn puts each
// one's back to the camera. Height is per bird: Robo's silhouette includes
// legs and an antenna, so it needs more of it to read at the same body size.
export const BIRDS: readonly BirdOption[] = [
  { id: 'classic', name: 'Classic', key: 'bird', yaw: Math.PI, height: 1 },
  { id: 'red', name: 'Red', key: 'bird-red', yaw: Math.PI, height: 1 },
  { id: 'robo', name: 'Robo', key: 'bird-robo', yaw: Math.PI, height: 1.2 },
];

export const DEFAULT_BIRD_ID: BirdId = 'classic';

export function findBird(id: string | null): BirdOption {
  return BIRDS.find((bird) => bird.id === id) ?? BIRDS[0];
}

export function birdModelUrl(bird: BirdOption): string {
  return BIRD_MODEL_URLS[bird.id];
}

/** Mint's own render of the model, reused as the picker thumbnail. */
export function birdThumbnailUrl(bird: BirdOption): string {
  return BIRD_THUMBNAIL_URLS[bird.id];
}

const BIRD_MODEL_URLS: Record<BirdId, string> = {
  classic: 'https://cdn.mint.gg/glb/round-beak-flapper-normalized-8448019be0704111.glb',
  red: 'https://cdn.mint.gg/glb/scarlet-scowl-bird-normalized-62aa842f26ec616e.glb',
  robo: 'https://cdn.mint.gg/glb/cyan-visor-sentinel-normalized-34e0b91971a793cb.glb',
};

const BIRD_THUMBNAIL_URLS: Record<BirdId, string> = {
  classic: 'https://cdn.mint.gg/images/models/round-beak-flapper-a90e9194cc640118.webp',
  red: 'https://cdn.mint.gg/images/models/scarlet-scowl-bird-7589482a676283cb.webp',
  robo: 'https://cdn.mint.gg/images/models/cyan-visor-sentinel-0d64d9d40feda282.webp',
};

export const AUDIO_URLS = {
  flap: 'https://cdn.mint.gg/audio/xd72x7meygxy5shcfghhrddsxs8bgncc/sfx-flap-2fef3e-05fa80cfa11b37ee.mp3',
  point: 'https://cdn.mint.gg/audio/xd74qb2as6jqhqcr2fy2h18fg18bga5g/sfx-point-58ee4f-6c4653e3706b931c.mp3',
  hit: 'https://cdn.mint.gg/audio/xd73rjfs3r9dqerm6wv0vqg38x8bgesh/sfx-hit-3a4a2b-b7ad4819bb103ff0.mp3',
  die: 'https://cdn.mint.gg/audio/xd73rjfs3r9dqerm6wv0vqg38x8bgesh/sfx-hit-3a4a2b-b7ad4819bb103ff0.mp3',
} as const;

export interface LoadedModel {
  scene: THREE.Group;
  size: THREE.Vector3;
}

const gltfLoader = createMintGltfLoader();

function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, undefined, reject);
  });
}

/**
 * Load a Mint GLB and re-center it so its bounding-box center sits at the
 * local origin with the base at y=0. Only the wrapper group is transformed;
 * the authored meshes and materials are untouched.
 */
export async function loadCenteredModel(url: string): Promise<LoadedModel> {
  const gltf = await loadGltf(url);
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const wrapper = new THREE.Group();
  wrapper.add(model);
  model.position.set(-center.x, -box.min.y, -center.z);

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
    }
  });

  return { scene: wrapper, size };
}

export interface CoreModels {
  pipe: LoadedModel;
  cloud: LoadedModel;
  bird: LoadedModel;
}

const birdCache = new Map<BirdId, Promise<LoadedModel>>();

/** Load a bird once and reuse it; repeat calls share the same request. */
export function loadBirdModel(id: BirdId): Promise<LoadedModel> {
  let pending = birdCache.get(id);
  if (!pending) {
    pending = loadCenteredModel(birdModelUrl(findBird(id)));
    birdCache.set(id, pending);
  }
  return pending;
}

/**
 * Only what is needed to start playing: the birds the player did not choose are
 * roughly two thirds of the download, and waiting on them would delay every
 * first load for models most sessions never show.
 */
export async function loadCoreModels(birdId: BirdId): Promise<CoreModels> {
  const [pipe, cloud, bird] = await Promise.all([
    loadCenteredModel(MODEL_URLS.pipe),
    loadCenteredModel(MODEL_URLS.cloud),
    loadBirdModel(birdId),
  ]);
  return { pipe, cloud, bird };
}

/** Warm the remaining birds once play is possible, so the picker feels instant. */
export function prefetchBirds(): void {
  for (const bird of BIRDS) {
    void loadBirdModel(bird.id).catch(() => {
      // A prefetch failure is not fatal; selecting that bird retries and reports.
    });
  }
}
