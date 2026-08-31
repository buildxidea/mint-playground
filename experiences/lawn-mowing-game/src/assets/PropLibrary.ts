import * as THREE from 'three';
import registryJson from '../../mint-assets.json';
import { createMintGltfLoader } from './gltf-runtime';

export type PropKey = 'mower' | 'tree' | 'flowerbed' | 'fence' | 'gnome';

interface RuntimeRegistry {
  assets: Record<string, { artifacts: Record<string, { role?: string; runtimeUrl?: string }> }>;
}

const registry = registryJson as RuntimeRegistry;

function modelUrl(key: PropKey): string {
  const artifacts = Object.values(registry.assets[key]?.artifacts ?? {});
  const model = artifacts.find((artifact) => artifact.role === 'canonical_model');
  if (!model?.runtimeUrl) throw new Error(`Missing published Mint model: ${key}`);
  return model.runtimeUrl;
}

const MODEL_URLS: Record<PropKey, string> = {
  mower: modelUrl('mower'),
  tree: modelUrl('tree'),
  flowerbed: modelUrl('flowerbed'),
  fence: modelUrl('fence'),
  gnome: modelUrl('gnome'),
};

/**
 * Loads the generated props once and hands out clones.
 *
 * Loading is fire-and-forget: the game starts on gray-box placeholders and
 * swaps them as models arrive, so a slow or failed load never blocks play.
 */
export class PropLibrary {
  private readonly models = new Map<PropKey, THREE.Object3D>();
  private readonly failures: string[] = [];

  async loadAll(): Promise<void> {
    const loader = createMintGltfLoader();
    const entries = Object.entries(MODEL_URLS) as [PropKey, string][];

    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const gltf = await loader.loadAsync(url);
          this.models.set(key, gltf.scene);
        } catch (error) {
          this.failures.push(`${key}: ${(error as Error).message}`);
        }
      }),
    );

    if (this.failures.length > 0) {
      console.warn(`Some props could not be loaded, keeping placeholders.\n${this.failures.join('\n')}`);
    }
  }

  get(key: PropKey): THREE.Object3D | null {
    return this.models.get(key) ?? null;
  }

  get loadedCount(): number {
    return this.models.size;
  }
}
