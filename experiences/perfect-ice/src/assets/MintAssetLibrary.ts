import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import registry from '../../mint-assets.json';

type RegistryArtifact = {
  role: string;
  runtimeUrl: string;
};

type RegistryAsset = {
  artifacts: Record<string, RegistryArtifact>;
};

const assets = registry.assets as Record<string, RegistryAsset>;
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.mint.gg/runtime/draco/gltf/three-0.184.0/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
const modelCache = new Map<string, Promise<THREE.Group>>();

export function getMintArtifactUrl(key: string, artifactId: string): string {
  const artifact = assets[key]?.artifacts?.[artifactId];
  if (!artifact) throw new Error(`Mint artifact ${key}/${artifactId} is not registered.`);
  return artifact.runtimeUrl;
}

export function getMintArtifactUrlByRole(key: string, role: string): string {
  const artifact = Object.values(assets[key]?.artifacts ?? {}).find((entry) => entry.role === role);
  if (!artifact) throw new Error(`Mint asset ${key} has no artifact with role ${role}.`);
  return artifact.runtimeUrl;
}

export async function loadMintModel(key: string): Promise<THREE.Group> {
  let request = modelCache.get(key);
  if (!request) {
    request = gltfLoader.loadAsync(getMintArtifactUrlByRole(key, 'canonical_model')).then((gltf) => {
      const root = gltf.scene;
      root.name = `mint-${key}`;
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      return root;
    });
    modelCache.set(key, request);
  }
  const source = await request;
  const clone = source.clone(true);
  clone.name = `mint-${key}`;
  return clone;
}

export function fitMintModel(
  object: THREE.Object3D,
  targetSize: THREE.Vector3,
  options: {
    rotationY?: number;
    centerX?: number;
    centerZ?: number;
    groundY?: number;
  } = {},
): void {
  object.position.set(0, 0, 0);
  object.rotation.set(0, options.rotationY ?? 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);
  const sourceSize = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  object.scale.set(
    targetSize.x / Math.max(0.0001, sourceSize.x),
    targetSize.y / Math.max(0.0001, sourceSize.y),
    targetSize.z / Math.max(0.0001, sourceSize.z),
  );
  object.updateMatrixWorld(true);
  const fittedBounds = new THREE.Box3().setFromObject(object);
  const center = fittedBounds.getCenter(new THREE.Vector3());
  object.position.set(
    (options.centerX ?? 0) - center.x,
    (options.groundY ?? 0) - fittedBounds.min.y,
    (options.centerZ ?? 0) - center.z,
  );
  object.updateMatrixWorld(true);
}
