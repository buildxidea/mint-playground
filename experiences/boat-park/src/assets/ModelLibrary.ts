import * as THREE from 'three';
import { createMintGltfLoader } from './gltf-runtime';
import registry from '../../mint-assets.json';

interface RegistryShape {
  assets?: Record<
    string,
    { artifacts?: Record<string, { runtimeUrl?: string }> }
  >;
}

// One shared Draco-capable loader for every Mint GLB path (models, dock, buoys).
const loader = createMintGltfLoader();
const cache = new Map<string, Promise<THREE.Group>>();

/**
 * Mint CDN URL for a published asset. Models expose `original_glb` and sounds
 * expose `audio_file`, so fall back across the registry's artifacts rather than
 * assuming one shape.
 */
export function mintModelUrl(key: string): string | null {
  const artifacts = (registry as RegistryShape).assets?.[key]?.artifacts;
  if (!artifacts) return null;
  return (
    artifacts.original_glb?.runtimeUrl ??
    artifacts.audio_file?.runtimeUrl ??
    Object.values(artifacts).find((entry) => entry?.runtimeUrl)?.runtimeUrl ??
    null
  );
}

export function loadMintModel(key: string): Promise<THREE.Group> {
  let shared = cache.get(key);
  if (!shared) {
    const url = mintModelUrl(key);
    if (!url) {
      return Promise.reject(new Error(`No Mint asset registered under key "${key}".`));
    }
    shared = loader.loadAsync(url).then((gltf) => gltf.scene);
    cache.set(key, shared);
  }
  // Clone per consumer; geometries and materials stay shared for memory.
  return shared.then((scene) => scene.clone(true));
}
