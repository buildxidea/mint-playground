import type { LoadingManager } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Mint's GLB optimizer emits KHR_draco_mesh_compression. Every GLTFLoader that
// can receive a Mint GLB must share one Draco decoder pinned to this immutable,
// version-matched path. See references/gltf-runtime-compatibility.md.
export const MINT_DRACO_DECODER_PATH =
  "https://cdn.mint.gg/runtime/draco/gltf/three-0.184.0/";

const dracoLoaders = new Map<string, DRACOLoader>();

function normalizedDecoderPath(value: string) {
  const path = value.trim();
  if (!path) throw new Error("The Draco decoder path cannot be empty.");
  return path.endsWith("/") ? path : `${path}/`;
}

function sharedDracoLoader(decoderPath: string) {
  const path = normalizedDecoderPath(decoderPath);
  let loader = dracoLoaders.get(path);
  if (!loader) {
    loader = new DRACOLoader().setDecoderPath(path);
    dracoLoaders.set(path, loader);
  }
  return loader;
}

/** Create a GLTFLoader wired to the shared, lazily-initialized Draco decoder. */
export function createMintGltfLoader(
  options: { manager?: LoadingManager; decoderPath?: string } = {},
) {
  const loader = new GLTFLoader(options.manager);
  return loader.setDRACOLoader(
    sharedDracoLoader(options.decoderPath ?? MINT_DRACO_DECODER_PATH),
  );
}

/** Dispose shared decoders only during permanent application teardown. */
export function disposeMintGltfRuntime() {
  dracoLoaders.forEach((loader) => loader.dispose());
  dracoLoaders.clear();
}
