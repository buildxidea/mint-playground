import * as THREE from 'three';
import { SPAWN } from '../config';
import type { LoadedAsset } from '../assets/AssetLibrary';
import { fitModel } from '../assets/AssetLibrary';

const RING_SIZE = SPAWN.ringRadius * 2.3;

let blockoutGeometry: THREE.TorusGeometry | null = null;
let blockoutMaterial: THREE.MeshStandardMaterial | null = null;
let glassMaterialCache: WeakMap<THREE.Material, THREE.MeshPhysicalMaterial> | null = null;

/**
 * Soap-bubble glass treatment (user-requested override of the delivered
 * materials): transparent, glossy, with a thin-film iridescent sheen.
 */
function toBubbleGlass(material: THREE.Material): THREE.MeshPhysicalMaterial {
  glassMaterialCache ??= new WeakMap();
  const cached = glassMaterialCache.get(material);
  if (cached) return cached;

  const source = material as THREE.MeshStandardMaterial;
  const glass = new THREE.MeshPhysicalMaterial({
    color: source.color ? source.color.clone().lerp(new THREE.Color('#dff4ff'), 0.55) : '#dff4ff',
    map: source.map ?? null,
    transparent: true,
    opacity: 0.42,
    roughness: 0.06,
    metalness: 0,
    envMapIntensity: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    iridescence: 0.9,
    iridescenceIOR: 1.3,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  glassMaterialCache.set(material, glass);
  return glass;
}

/** Scoring gate. The fish passes through the open center travelling -Z. */
export class BubbleRing {
  readonly group = new THREE.Group();
  passed = false;

  private spinSpeed = 0.35;

  constructor(asset: LoadedAsset | null) {
    if (asset) {
      asset.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((material) => toBubbleGlass(material));
        } else {
          mesh.material = toBubbleGlass(mesh.material);
        }
      });
      const model = fitModel(asset.scene, RING_SIZE);
      this.group.add(model);
    } else {
      blockoutGeometry ??= new THREE.TorusGeometry(SPAWN.ringRadius, 0.28, 12, 36);
      blockoutMaterial ??= new THREE.MeshStandardMaterial({
        color: '#aee6ff',
        emissive: '#3f8fbf',
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.85,
        roughness: 0.15,
      });
      this.group.add(new THREE.Mesh(blockoutGeometry, blockoutMaterial));
    }
  }

  place(x: number, y: number, z: number, spinSpeed: number): void {
    this.group.position.set(x, y, z);
    this.passed = false;
    this.spinSpeed = spinSpeed;
  }

  update(delta: number): void {
    this.group.rotation.z += delta * this.spinSpeed;
  }
}
