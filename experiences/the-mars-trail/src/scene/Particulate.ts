/**
 * Drifting particulate for THE MARS TRAIL — snow, ice crystals, dust, and the
 * slow motes that make the Deep Quiet feel occupied.
 *
 * One Points cloud, recycled by wrapping each particle when it leaves frame.
 * The buffer is allocated once; the hot path only writes positions.
 */

import * as THREE from 'three';

const COUNT = 700;
const SPAN_X = 46;
const SPAN_Y = 26;

export class Particulate {
  readonly points: THREE.Points;

  private readonly positions: Float32Array;
  private readonly drift: Float32Array;
  private readonly material: THREE.PointsMaterial;
  private density = 0.5;

  constructor(rng: () => number) {
    this.positions = new Float32Array(COUNT * 3);
    this.drift = new Float32Array(COUNT * 2);

    for (let i = 0; i < COUNT; i += 1) {
      this.positions[i * 3] = (rng() - 0.5) * SPAN_X;
      this.positions[i * 3 + 1] = (rng() - 0.5) * SPAN_Y;
      this.positions[i * 3 + 2] = -14 + rng() * 22;
      // Per-particle drift keeps the field from moving as one sheet.
      this.drift[i * 2] = 0.6 + rng() * 1.9;
      this.drift[i * 2 + 1] = -0.25 - rng() * 0.75;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.material = new THREE.PointsMaterial({
      color: '#cfe6f5',
      size: 0.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      fog: false,
    });

    this.points = new THREE.Points(geometry, this.material);
  }

  setPalette(color: string, density: number): void {
    this.material.color.set(color);
    this.density = THREE.MathUtils.clamp(density, 0, 1.2);
    this.material.opacity = 0.18 + this.density * 0.55;
    this.material.size = 0.07 + this.density * 0.09;
    this.points.visible = this.density > 0.03;
  }

  update(delta: number, travelRate: number): void {
    if (!this.points.visible) return;

    // Particulate streams past faster than any parallax band; it reads as the
    // closest thing to camera.
    const speed = 1.4 + travelRate * 0.9;

    // Streams toward +x with every other layer; see ParallaxLayers.update.
    for (let i = 0; i < COUNT; i += 1) {
      const xi = i * 3;
      this.positions[xi] += this.drift[i * 2] * speed * delta;
      this.positions[xi + 1] += this.drift[i * 2 + 1] * delta;

      if (this.positions[xi] > SPAN_X / 2) this.positions[xi] -= SPAN_X;
      if (this.positions[xi + 1] < -SPAN_Y / 2) this.positions[xi + 1] += SPAN_Y;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.material.dispose();
    this.points.geometry.dispose();
  }
}
