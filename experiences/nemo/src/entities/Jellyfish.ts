import * as THREE from 'three';
import { JELLY } from '../config';
import type { LoadedAsset } from '../assets/AssetLibrary';
import { fitModel } from '../assets/AssetLibrary';

const JELLY_SIZE = 4.4;

let blockoutCapGeometry: THREE.SphereGeometry | null = null;
let blockoutTentGeometry: THREE.CylinderGeometry | null = null;
let blockoutCapMaterial: THREE.MeshStandardMaterial | null = null;
let blockoutTentMaterial: THREE.MeshStandardMaterial | null = null;

function blockoutParts(): { cap: THREE.Mesh; tentacles: THREE.Mesh } {
  blockoutCapGeometry ??= new THREE.SphereGeometry(1.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  blockoutTentGeometry ??= new THREE.CylinderGeometry(0.75, 0.5, JELLY.tentacleLength, 10, 1, true);
  blockoutCapMaterial ??= new THREE.MeshStandardMaterial({
    color: '#ff7bc1',
    emissive: '#b8347f',
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.82,
    roughness: 0.35,
  });
  blockoutTentMaterial ??= new THREE.MeshStandardMaterial({
    color: '#e75fae',
    emissive: '#7c2158',
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    roughness: 0.6,
  });
  const cap = new THREE.Mesh(blockoutCapGeometry, blockoutCapMaterial);
  const tentacles = new THREE.Mesh(blockoutTentGeometry, blockoutTentMaterial);
  tentacles.position.y = -JELLY.tentacleLength / 2;
  return { cap, tentacles };
}

/**
 * Interactive jellyfish. `group.position` marks the bell center; the bounce
 * sphere sits at the bell, the sting cylinder hangs below it.
 */
export class Jellyfish {
  readonly group = new THREE.Group();
  bounceCooldown = 0;
  interactive = true;

  private readonly holder = new THREE.Group();
  private baseY = 0;
  private phase = 0;
  private bobSpeed = 1;
  private squash = 0;

  constructor(asset: LoadedAsset | null, dim = false, tint?: THREE.Color) {
    if (asset) {
      const model = fitModel(asset.scene, JELLY_SIZE);
      if (dim) {
        model.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh) {
            const material = (mesh.material as THREE.MeshStandardMaterial).clone();
            material.transparent = true;
            material.opacity = 0.55;
            material.depthWrite = false;
            if (tint && material.color) {
              // Recolor the distant swarm so the backdrop isn't monochrome.
              material.color.lerp(tint, 0.75);
              if (material.emissive) material.emissive.lerp(tint, 0.4);
            }
            mesh.material = material;
          }
        });
      }
      this.holder.add(model);
    } else {
      const { cap, tentacles } = blockoutParts();
      this.holder.add(cap, tentacles);
    }
    this.group.add(this.holder);
  }

  place(x: number, y: number, z: number, phase: number, bobSpeed: number): void {
    this.group.position.set(x, y, z);
    this.baseY = y;
    this.phase = phase;
    this.bobSpeed = bobSpeed;
  }

  update(delta: number, elapsed: number): void {
    const t = elapsed * this.bobSpeed + this.phase;
    this.group.position.y = this.baseY + Math.sin(t) * 0.9;
    // Gentle bell pulse, plus a squash impulse when bounced on.
    this.squash = Math.max(0, this.squash - delta * 3.2);
    const pulse = 1 + Math.sin(t * 2.1) * 0.045;
    const squashY = 1 - this.squash * 0.45;
    const squashXZ = 1 + this.squash * 0.3;
    this.holder.scale.set(pulse * squashXZ, pulse * squashY, pulse * squashXZ);
    this.bounceCooldown = Math.max(0, this.bounceCooldown - delta);
  }

  onBounced(): void {
    this.squash = 1;
    this.bounceCooldown = JELLY.bounceCooldown;
  }
}
