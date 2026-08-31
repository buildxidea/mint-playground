import * as THREE from "three";
import { createMintGltfLoader } from "../assets/gltf-runtime";
import { mintArtifactUrl } from "../assets/registry";

/**
 * Loads the generated cubie and normalises it to an exact unit cube.
 *
 * This normalisation is the whole reason one generated mesh can be reused as
 * all 26 cubies: a generative mesh arrives at an arbitrary size with an
 * arbitrary pivot, but once it is recentred and scaled to exactly one unit,
 * every copy is identical by construction and the grid stays perfectly
 * aligned no matter how many turns are made. CubeView then scales that unit
 * template to whatever the current cube size needs.
 *
 * The mesh is used as delivered - its material is not recoloured or replaced.
 * Sticker tiles are separate geometry placed on top of it.
 */

/** The template is normalised to this edge length; CubeView rescales it. */
const UNIT = 1;

export interface CubieAsset {
  /** Ready-to-clone template, already normalised. Clones share geometry. */
  template: THREE.Object3D;
  dispose(): void;
}

const MODEL_URL = mintArtifactUrl("cubie", "canonical_model");

export async function loadCubieAsset(
  modelUrl = MODEL_URL,
): Promise<CubieAsset> {
  const loader = createMintGltfLoader();
  const gltf = await loader.loadAsync(modelUrl);
  const root = gltf.scene;

  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
  });
  if (meshes.length === 0) {
    throw new Error("The cubie model contains no meshes.");
  }

  // Measure in world space so nested node transforms are accounted for.
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 0) {
    throw new Error("The cubie model has a degenerate bounding box.");
  }
  const scale = UNIT / largest;

  // Bake the normalisation into a wrapper so every clone inherits it.
  const normalised = new THREE.Group();
  const centred = new THREE.Group();
  centred.position.copy(center).multiplyScalar(-1);
  centred.add(root);
  normalised.scale.setScalar(scale);
  normalised.add(centred);
  normalised.updateWorldMatrix(true, true);

  for (const mesh of meshes) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Raycasting targets the sticker//cubie group, not the inner mesh.
    mesh.userData.isCubieShell = true;
  }

  return {
    template: normalised,
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    },
  };
}

/**
 * Fallback used only if the generated model cannot be loaded, so a network or
 * decode failure degrades to a playable cube instead of a blank screen.
 */
export function proceduralCubieTemplate(): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(UNIT, UNIT, UNIT);
  const material = new THREE.MeshLambertMaterial({ color: 0x0a0a0a });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.isCubieShell = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
