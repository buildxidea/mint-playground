import * as THREE from 'three';
import type { ZombieArchetype } from './zombiesData';

/**
 * Legacy marker for presentation-only geometry that must never expand ballistic
 * hit targets. Silhouette kits were removed; the flag remains so attachMintVisual
 * can keep skipping any leftover attachment meshes.
 */
export const ZOMBIE_SILHOUETTE_ATTACHMENT =
  'zombieSilhouetteAttachment' as const;

const sprinterMaterialVariants = new WeakMap<THREE.Material, THREE.Material>();
const bruteMaterialVariants = new WeakMap<THREE.Material, THREE.Material>();

function sharedMaterialVariant(
  source: THREE.Material,
  archetype: 'sprinter' | 'brute',
): THREE.Material {
  const variants =
    archetype === 'sprinter'
      ? sprinterMaterialVariants
      : bruteMaterialVariants;
  const cached = variants.get(source);
  if (cached) return cached;
  const material = source.clone();
  material.name = `${source.name || source.type}-${archetype}-shared`;
  if (material instanceof THREE.MeshStandardMaterial) {
    if (archetype === 'sprinter') {
      material.color.lerp(new THREE.Color('#ff4657'), 0.24);
      material.emissive.lerp(new THREE.Color('#310007'), 0.36);
      material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.14);
      material.roughness = Math.min(1, material.roughness + 0.05);
    } else {
      material.color.lerp(new THREE.Color('#303b40'), 0.18);
      material.roughness = Math.min(1, material.roughness + 0.11);
      material.metalness = Math.max(material.metalness, 0.08);
    }
  }
  variants.set(source, material);
  return material;
}

function styleImportedBody(
  imported: THREE.Object3D,
  archetype: 'sprinter' | 'brute',
): void {
  imported.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const styled = source.map((material) =>
      sharedMaterialVariant(material, archetype),
    );
    object.material = Array.isArray(object.material) ? styled : styled[0]!;
  });
}

/**
 * Wraps a normalized, grounded, +Z-facing Mint walker with archetype read via
 * scale, shared material treatment, and sprinter lean only — no external
 * silhouette props.
 */
export function buildZombiePresentation(
  imported: THREE.Object3D,
  archetype: ZombieArchetype,
): THREE.Object3D {
  if (archetype === 'shambler') return imported;

  const root = new THREE.Group();
  root.name = `zombie-presentation-${archetype}`;
  root.userData.zombiePresentationArchetype = archetype;
  root.add(imported);
  styleImportedBody(imported, archetype);

  if (archetype === 'sprinter') {
    imported.scale.x *= 0.86;
    // A whole-body drive from the feet reads as speed from front and profile;
    // keeping it on the presentation wrapper leaves actor yaw and collision
    // proxies canonical.
    root.rotation.x = 0.14;
    root.userData.presentationLeanRadians = 0.14;
  } else {
    imported.scale.x *= 1.13;
    imported.scale.z *= 1.04;
    root.userData.presentationLeanRadians = 0;
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  if (Number.isFinite(bounds.min.y)) root.position.y -= bounds.min.y;
  root.updateMatrixWorld(true);
  return root;
}
