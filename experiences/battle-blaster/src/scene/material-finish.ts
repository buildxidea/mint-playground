import * as THREE from "three";
import { patternTexture } from "./patterns";
import type { FinishDef } from "../data/finishes";

interface Baseline {
  color: THREE.Color;
  map: THREE.Texture | null;
  metalness: number;
  roughness: number;
  emissive: THREE.Color;
  emissiveIntensity: number;
  emissiveMap: THREE.Texture | null;
}

/**
 * Authored values, captured the first time a material is seen. GLTF clones
 * share materials, so finishes are always computed from this baseline rather
 * than from the material's current state — that makes re-application
 * idempotent instead of compounding.
 */
const baselines = new WeakMap<THREE.MeshStandardMaterial, Baseline>();

function baselineOf(material: THREE.MeshStandardMaterial): Baseline {
  let baseline = baselines.get(material);
  if (!baseline) {
    baseline = {
      color: material.color.clone(),
      map: material.map,
      metalness: material.metalness,
      roughness: material.roughness,
      emissive: material.emissive.clone(),
      emissiveIntensity: material.emissiveIntensity,
      emissiveMap: material.emissiveMap,
    };
    baselines.set(material, baseline);
  }
  return baseline;
}

const scratch = new THREE.Color();

export function applyFinish(root: THREE.Object3D, finish: FinishDef): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const baseline = baselineOf(material);

      let programDirty = false;

      const nextMap = finish.pattern ? patternTexture(finish.pattern) : baseline.map;
      if (material.map !== nextMap) {
        material.map = nextMap;
        programDirty = true;
      }
      material.color.copy(baseline.color).multiply(scratch.setHex(finish.tint));

      material.metalness = finish.metalness ?? baseline.metalness;
      material.roughness = finish.roughness ?? baseline.roughness;

      const wantsGlow = finish.emissive !== undefined;
      const nextEmissiveMap = wantsGlow ? nextMap : baseline.emissiveMap;
      if (wantsGlow) {
        material.emissive.setHex(finish.emissive!);
        material.emissiveIntensity = finish.emissiveIntensity ?? 1;
      } else {
        material.emissive.copy(baseline.emissive);
        material.emissiveIntensity = baseline.emissiveIntensity;
      }

      // Swapping a texture slot changes the shader program, so only flag a
      // recompile when one actually differs.
      if (material.emissiveMap !== nextEmissiveMap) {
        material.emissiveMap = nextEmissiveMap;
        programDirty = true;
      }
      if (programDirty) material.needsUpdate = true;
    }
  });
}
