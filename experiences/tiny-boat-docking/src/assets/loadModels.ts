import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_REGISTRY, type ModelAssetId } from './registry';

export type LoadedModel = {
  id: ModelAssetId;
  scene: THREE.Object3D;
  size: THREE.Vector3;
};

const loader = new GLTFLoader();

export async function loadAllModels(): Promise<Map<ModelAssetId, LoadedModel>> {
  const map = new Map<ModelAssetId, LoadedModel>();
  const ids = Object.keys(MODEL_REGISTRY) as ModelAssetId[];
  await Promise.all(
    ids.map(async (id) => {
      const entry = MODEL_REGISTRY[id];
      const gltf = await loader.loadAsync(entry.path);
      const root = gltf.scene;
      normalizeModel(root, entry.targetLength, entry.forward);
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      map.set(id, { id, scene: root, size });
    }),
  );
  return map;
}

export function cloneModel(models: Map<ModelAssetId, LoadedModel>, id: ModelAssetId): THREE.Object3D {
  const source = models.get(id);
  if (!source) throw new Error(`Model not loaded: ${id}`);
  return source.scene.clone(true);
}

function normalizeModel(
  root: THREE.Object3D,
  targetLength: number,
  forward: 'posZ' | 'negZ' | 'posX' | 'negX',
): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  root.position.y += size.y / 2;

  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 1e-4) {
    root.scale.multiplyScalar(targetLength / longest);
  }

  if (forward === 'negZ') root.rotation.y = Math.PI;
  if (forward === 'posX') root.rotation.y = -Math.PI / 2;
  if (forward === 'negX') root.rotation.y = Math.PI / 2;

  root.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(root);
  root.position.y -= grounded.min.y;

  // Bake transform into children so clones can set world XZ without wiping Y.
  root.updateMatrixWorld(true);
  const children = [...root.children];
  for (const child of children) {
    child.applyMatrix4(root.matrix);
  }
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
}
