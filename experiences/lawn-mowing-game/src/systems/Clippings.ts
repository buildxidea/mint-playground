import * as THREE from 'three';

const MAX_PARTICLES = 260;
const GRAVITY = -9.2;

/** Grass clippings thrown from the deck. Small, cheap, and the main reason
 *  cutting reads as an event rather than a texture change. */
export class Clippings {
  readonly points: THREE.Points;

  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly lifetimes = new Float32Array(MAX_PARTICLES);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;
  private cursor = 0;
  private spawnAccumulator = 0;

  constructor(private readonly random: () => number) {
    this.lifetimes.fill(0);
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      this.positions[i * 3 + 1] = -100;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: '#9ccc4a',
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /**
   * @param rate particles per second, scaled by how much grass is being cut
   */
  emit(delta: number, origin: THREE.Vector3, direction: THREE.Vector2, rate: number): void {
    if (rate <= 0) return;
    this.spawnAccumulator += rate * delta;

    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;

      this.positions[index * 3] = origin.x + (this.random() - 0.5) * 0.2;
      this.positions[index * 3 + 1] = origin.y;
      this.positions[index * 3 + 2] = origin.z + (this.random() - 0.5) * 0.2;

      const spread = (this.random() - 0.5) * 1.9;
      this.velocities[index * 3] = direction.x * 1.4 + spread;
      this.velocities[index * 3 + 1] = 2.6 + this.random() * 1.9;
      this.velocities[index * 3 + 2] = direction.y * 1.4 + spread * 0.6;

      this.lifetimes[index] = 0.55 + this.random() * 0.35;
    }
  }

  update(delta: number): void {
    let alive = false;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (this.lifetimes[i] <= 0) continue;
      alive = true;
      this.lifetimes[i] -= delta;

      if (this.lifetimes[i] <= 0) {
        this.positions[i * 3 + 1] = -100;
        continue;
      }

      this.velocities[i * 3 + 1] += GRAVITY * delta;
      this.positions[i * 3] += this.velocities[i * 3] * delta;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * delta;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * delta;

      if (this.positions[i * 3 + 1] < 0.03) {
        this.positions[i * 3 + 1] = 0.03;
        this.velocities[i * 3] *= 0.4;
        this.velocities[i * 3 + 2] *= 0.4;
        this.velocities[i * 3 + 1] = 0;
        this.lifetimes[i] = Math.min(this.lifetimes[i], 0.18);
      }
    }

    if (alive) this.geometry.attributes.position.needsUpdate = true;
  }

  reset(): void {
    this.lifetimes.fill(0);
    for (let i = 0; i < MAX_PARTICLES; i += 1) this.positions[i * 3 + 1] = -100;
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
