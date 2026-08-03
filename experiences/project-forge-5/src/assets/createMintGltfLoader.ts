import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type MintGltfLoader = {
  loader: GLTFLoader;
  dispose(): void;
};

/**
 * Mint GLBs may require Draco. Keep one capability helper for robot, prop, and
 * World collider loading so extension support cannot drift between systems.
 */
export function createMintGltfLoader(
  decoderPath = 'https://cdn.mint.gg/runtime/draco/gltf/three-0.184.0/',
): MintGltfLoader {
  const draco = new DRACOLoader();
  draco.setDecoderPath(decoderPath);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  return {
    loader,
    dispose: () => draco.dispose(),
  };
}
