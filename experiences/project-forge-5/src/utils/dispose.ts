import * as THREE from 'three';

export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);

    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of meshMaterials) materials.add(material);
  });

  for (const material of materials) collectMaterialTextures(material, textures);
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function collectMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>): void {
  const values = Object.values(material as unknown as Record<string, unknown>);
  for (const value of values) {
    if (isThreeTexture(value)) textures.add(value);
  }
}

function isThreeTexture(value: unknown): value is THREE.Texture {
  return Boolean(
    value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture,
  );
}
