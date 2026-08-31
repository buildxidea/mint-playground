import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createMintGltfLoader } from './gltf-runtime';
import registry from '../../mint-assets.json';

type ArtifactRecord = {
  artifactId: string;
  role: string;
  format?: string;
  localPath?: string;
  runtimeUrl?: string;
  loaderHint?: string;
};

type AssetRecord = {
  artifacts: Record<string, ArtifactRecord>;
};

type Registry = {
  assets: Record<string, AssetRecord>;
};

export type LoadedAsset = {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
};

function toBrowserUrl(artifact: ArtifactRecord): string {
  if (artifact.runtimeUrl) return artifact.runtimeUrl;
  if (!artifact.localPath) throw new Error(`Missing runtime URL for ${artifact.artifactId}`);
  // BASE_URL always ends in '/'. Keeps assets resolvable when the site is
  // served from a subpath such as GitHub Pages' /nemo/.
  return `${import.meta.env.BASE_URL}${artifact.localPath.replace(/^public\//, '')}`;
}

/**
 * Loads Mint-generated GLBs recorded in mint-assets.json and hands out clones.
 * Keys with no registry entry resolve to null so callers can keep a blockout
 * until the generated asset lands.
 */
export class AssetLibrary {
  private readonly loader = createMintGltfLoader();
  private readonly loaded = new Map<string, LoadedAsset>();

  has(key: string): boolean {
    return this.loaded.has(key);
  }

  async loadAll(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.load(key)));
  }

  private async load(key: string): Promise<void> {
    const record = (registry as Registry).assets[key];
    if (!record) return;

    const artifacts = Object.values(record.artifacts);
    const model =
      artifacts.find((artifact) => artifact.artifactId === 'optimized_glb') ??
      artifacts.find((artifact) => artifact.role === 'canonical_model') ??
      artifacts.find((artifact) => artifact.role === 'rigged_character') ??
      artifacts.find((artifact) => artifact.format === 'glb');
    if (!model) return;

    const gltf = await this.loader.loadAsync(toBrowserUrl(model));
    const clips = [...gltf.animations];

    // External animation clip GLBs (from Mint model animation) ride alongside
    // the base model under animation_clip roles.
    const clipArtifacts = artifacts.filter(
      (artifact) => artifact.role === 'animation_clip' && artifact !== model,
    );
    for (const clipArtifact of clipArtifacts) {
      const clipGltf = await this.loader.loadAsync(toBrowserUrl(clipArtifact));
      clips.push(...clipGltf.animations);
    }

    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });

    this.loaded.set(key, { scene: gltf.scene, clips });
  }

  /** Clone for scene placement. Uses SkeletonUtils so rigged models stay animatable. */
  instance(key: string): LoadedAsset | null {
    const asset = this.loaded.get(key);
    if (!asset) return null;
    return {
      scene: cloneSkeleton(asset.scene) as THREE.Group,
      clips: asset.clips,
    };
  }
}

/**
 * Normalizes a loaded model to a target size and grounds it at the group's
 * origin center so gameplay code can treat every model uniformly.
 */
export function fitModel(scene: THREE.Object3D, targetSize: number): THREE.Group {
  const wrapper = new THREE.Group();
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / maxAxis;
  scene.scale.setScalar(scale);
  box.setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(center);
  wrapper.add(scene);
  return wrapper;
}
