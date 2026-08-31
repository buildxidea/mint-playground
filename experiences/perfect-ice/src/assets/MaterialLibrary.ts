import * as THREE from 'three';

export class MaterialLibrary {
  readonly paint = new THREE.MeshPhysicalMaterial({
    color: '#0d8fa4', roughness: 0.28, metalness: 0.04, clearcoat: 0.82, clearcoatRoughness: 0.14,
  });
  readonly cream = new THREE.MeshStandardMaterial({ color: '#f2efe3', roughness: 0.54, metalness: 0.02 });
  readonly navy = new THREE.MeshStandardMaterial({ color: '#102c43', roughness: 0.46, metalness: 0.12 });
  readonly deepNavy = new THREE.MeshStandardMaterial({ color: '#071a2b', roughness: 0.7, metalness: 0.05 });
  readonly coral = new THREE.MeshStandardMaterial({ color: '#ff6f4d', roughness: 0.42, metalness: 0.03 });
  readonly yellow = new THREE.MeshStandardMaterial({ color: '#ffc857', roughness: 0.4, metalness: 0.03 });
  readonly metal = new THREE.MeshStandardMaterial({ color: '#90aab8', roughness: 0.38, metalness: 0.78 });
  readonly rubber = new THREE.MeshStandardMaterial({ color: '#071319', roughness: 0.94, metalness: 0 });
  readonly puck = new THREE.MeshStandardMaterial({ color: '#061119', roughness: 0.86, metalness: 0.03 });
  readonly glass = new THREE.MeshPhysicalMaterial({
    color: '#dffaff', roughness: 0.04, transparent: true, opacity: 0.1, clearcoat: 1, depthWrite: false,
  });
  readonly emissiveCool = new THREE.MeshStandardMaterial({
    color: '#d9fbff', emissive: '#56dcef', emissiveIntensity: 1.65, roughness: 0.28,
  });
  readonly shadow = new THREE.MeshBasicMaterial({ color: '#03111a', transparent: true, opacity: 0.24, depthWrite: false });

  dispose(): void {
    for (const value of Object.values(this)) {
      if (value instanceof THREE.Material) value.dispose();
    }
  }
}
