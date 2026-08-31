/**
 * Soft cloud deck for the ascent.
 *
 * These are scenery, not obstacles: you fly straight through them. That is why
 * they live here rather than in the flight model, which owns everything that
 * can actually be collided with.
 *
 * Billboards rather than meshes, because passing through a solid low-poly cloud
 * shows you its inside faces and instantly breaks the illusion. A billboard that
 * fades as it reaches the camera reads as flying into cloud instead.
 */

import * as THREE from 'three';

/**
 * How many puffs.
 *
 * Per-sprite opacity means each puff carries its own material and therefore its
 * own draw call, so this is a real cost rather than free dressing. The puffs are
 * large, so this many still covers the frame at the widest spread.
 */
const PUFF_COUNT = 34;

/** Half-extent of the spread. Deliberately far wider than the flight corridor. */
const SPREAD_X = 46;
const SPREAD_Y = 30;

/** Where a puff is recycled once it has passed behind the camera. */
const RECYCLE_Z = 22;

interface Puff {
  sprite: THREE.Sprite;
  baseScale: number;
  drift: number;
}

/** A soft round blob, drawn once into a canvas and shared by every puff. */
function puffTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create cloud texture context.');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.34)');
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class CloudLayer {
  readonly group = new THREE.Group();

  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private readonly puffs: Puff[] = [];
  private spawnDepth = 260;

  constructor(rng: () => number) {
    this.texture = puffTexture();
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      opacity: 1,
      color: '#ffffff',
    });

    for (let i = 0; i < PUFF_COUNT; i += 1) {
      const sprite = new THREE.Sprite(this.material.clone());
      const baseScale = 13 + rng() * 30;
      sprite.scale.setScalar(baseScale);
      sprite.position.set(
        (rng() - 0.5) * 2 * SPREAD_X,
        (rng() - 0.5) * 2 * SPREAD_Y,
        -rng() * this.spawnDepth,
      );
      this.puffs.push({ sprite, baseScale, drift: (rng() - 0.5) * 1.6 });
      this.group.add(sprite);
    }
  }

  /** Reposition every puff across the full spread. Called when a run begins. */
  reset(rng: () => number, spawnDepth: number): void {
    this.spawnDepth = spawnDepth;
    for (const puff of this.puffs) {
      puff.sprite.position.set(
        (rng() - 0.5) * 2 * SPREAD_X,
        (rng() - 0.5) * 2 * SPREAD_Y,
        -rng() * spawnDepth,
      );
    }
  }

  /**
   * @param density 0-1. Drives how many puffs are visible and how opaque they
   *   are, so the deck can thin out as the vehicle climbs above the weather.
   */
  update(delta: number, speed: number, density: number, tint: THREE.Color): void {
    const visibleCount = Math.round(this.puffs.length * Math.min(1, density * 1.15));
    this.group.visible = density > 0.01;
    if (!this.group.visible) return;

    for (let i = 0; i < this.puffs.length; i += 1) {
      const puff = this.puffs[i];
      const sprite = puff.sprite;

      if (i >= visibleCount) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;

      sprite.position.z += speed * delta;
      sprite.position.x += puff.drift * delta;

      if (sprite.position.z > RECYCLE_Z) {
        sprite.position.z -= this.spawnDepth + RECYCLE_Z;
      }

      // Fade out as a puff reaches the camera, so flying through one is a soft
      // whiteout rather than a billboard snapping out of existence.
      const nearness = Math.max(0, Math.min(1, (RECYCLE_Z - sprite.position.z) / 26));
      const material = sprite.material as THREE.SpriteMaterial;
      // Veil, not whiteout. At the old strength a single puff filled the
      // frame with white and you could not see the vehicle at all.
      material.opacity = density * 0.34 * nearness;
      material.color.copy(tint);
      sprite.scale.setScalar(puff.baseScale * (1 + (1 - nearness) * 0.2));
    }
  }

  dispose(): void {
    for (const puff of this.puffs) {
      (puff.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.material.dispose();
    this.texture.dispose();
  }
}
