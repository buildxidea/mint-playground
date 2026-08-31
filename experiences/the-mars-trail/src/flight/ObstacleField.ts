/**
 * Visual mirror of the flight model's obstacle pool.
 *
 * This owns no gameplay state. Every frame it copies transforms out of the
 * pure `FlightRun` bodies, exactly the way `ParallaxLayers` mirrors travel
 * state. Collision, spawning, and recycling all happen in the model, so what
 * you see and what you hit can never disagree.
 */

import * as THREE from 'three';
import type { FlightBody } from './model/types';

/** Fallback shape used when a prop family has not loaded yet. */
function placeholderGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, 0);
}

export class ObstacleField {
  readonly group = new THREE.Group();

  private slots: THREE.Object3D[] = [];
  private placeholderMaterial: THREE.MeshStandardMaterial | null = null;
  private placeholderGeo: THREE.BufferGeometry | null = null;

  /**
   * Build one visual slot per model body. Cloning happens once, here, so the
   * hot path never allocates.
   *
   * @param sources loaded GLB roots to clone from. May be empty while a family
   *   is still streaming in, in which case neutral placeholders are used.
   */
  populate(sources: THREE.Object3D[], capacity: number, rng: () => number): void {
    this.clear();

    for (let i = 0; i < capacity; i += 1) {
      let object: THREE.Object3D;

      if (sources.length > 0) {
        // Clones share geometry and materials with the loaded source, the same
        // contract ParallaxLayers relies on; the source owns disposal.
        object = sources[Math.floor(rng() * sources.length)].clone(true);
      } else {
        if (!this.placeholderGeo) this.placeholderGeo = placeholderGeometry();
        if (!this.placeholderMaterial) {
          this.placeholderMaterial = new THREE.MeshStandardMaterial({
            color: '#6b7a88',
            roughness: 0.9,
            metalness: 0.05,
            flatShading: true,
          });
        }
        object = new THREE.Mesh(this.placeholderGeo, this.placeholderMaterial);
      }

      object.visible = false;
      this.group.add(object);
      this.slots.push(object);
    }
  }

  /** Copy the model's body transforms onto the visual slots. */
  syncFrom(bodies: readonly FlightBody[]): void {
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i];
      const body = bodies[i];

      if (!body || !body.active) {
        slot.visible = false;
        continue;
      }

      slot.visible = true;
      slot.position.set(body.x, body.y, body.z);
      // The model's radius is authoritative for collision, so the visual is
      // scaled to match it rather than the other way round.
      slot.scale.setScalar(body.r);
      slot.rotation.x = body.spinX * body.z * 0.02;
      slot.rotation.y = body.spinY * body.z * 0.02;
      slot.rotation.z = body.spinZ * body.z * 0.02;
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      this.group.remove(slot);
      slot.clear();
    }
    this.slots = [];
  }

  dispose(): void {
    this.clear();
    this.placeholderGeo?.dispose();
    this.placeholderMaterial?.dispose();
    this.placeholderGeo = null;
    this.placeholderMaterial = null;
  }
}
