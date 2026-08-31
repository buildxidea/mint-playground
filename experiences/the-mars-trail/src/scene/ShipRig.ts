/**
 * The player's ship and its drive cores.
 *
 * Cores ride a turning ring around the hull's long axis, so they cross in
 * front of it and then pass behind. That occlusion gives a side-on scene depth.
 */

import * as THREE from 'three';
import { createGlowTexture } from './glow';

/** Ring radius as a multiple of hull length. Diameter slightly exceeds it. */
const RING_RADIUS_FACTOR = 0.6;

/** Fallback ring radius, used until a hull has been measured. */
const DEFAULT_RING_RADIUS = 2.4;

/**
 * Tilt off square-on, in radians. Perpendicular is seen exactly edge-on from
 * this camera and projects to a line, which reads as bobbing, not orbiting.
 */
const RING_TILT = 0.4;

/** Ring rotation in radians per second, coasting and at a hard burn. */
const SPIN_COASTING = 0.32;
const SPIN_HARD = 1.05;

/** Re-slot ease rate. Exponential in delta; roughly a second to close up. */
const RESPACE_RATE = 4;

/** Hull position, and so the ring centre. Right of the camera's look-at. */
const HULL_POSITION = new THREE.Vector3(5.4, -3.1, 0);

export class ShipRig {
  readonly group = new THREE.Group();

  private readonly hullHost = new THREE.Group();
  private readonly coreHost = new THREE.Group();
  private readonly plumeHost = new THREE.Group();

  private hullModel: THREE.Object3D | null = null;
  private coreModel: THREE.Object3D | null = null;
  /** `offset` is where a core is, `target` its even slot. They differ only
   * while survivors of a failure close up. */
  private coreInstances: Array<{ object: THREE.Object3D; offset: number; target: number }> = [];

  /** Ring rotation, in radians. Advances every frame. */
  private ringPhase = 0;
  private ringRadius = DEFAULT_RING_RADIUS;
  private plumes: THREE.Sprite[] = [];
  private readonly plumeMaterial: THREE.SpriteMaterial;

  private visibleCores = 0;
  private bobTime = 0;

  constructor() {
    this.hullHost.position.copy(HULL_POSITION);
    this.group.add(this.hullHost);
    this.group.add(this.coreHost);
    this.group.add(this.plumeHost);

    // A soft glow at the engines rather than hard additive quads. The ship
    // coasts for most of the crossing, so this is a hint of power, not a
    // full exhaust plume; the old rectangles read as debris stuck to the hull.
    this.plumeMaterial = new THREE.SpriteMaterial({
      map: createGlowTexture(),
      color: '#9fe8ff',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  /** Install the generated hull. Replaces any previous model. */
  setHullModel(model: THREE.Object3D): void {
    if (this.hullModel) this.hullHost.remove(this.hullModel);
    // The ascender is modelled nose-up for the pad. In the travel view it is
    // coasting, so lay it on its side with the nose pointing the way it is
    // going — otherwise it flies broadside across the whole crossing.
    model.rotation.set(0, 0, Math.PI / 2);
    this.hullModel = model;
    this.hullHost.add(model);
    // Sized off the hull actually installed. Laid on its side, long axis is x.
    model.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.y, size.z);
    this.ringRadius = length > 0 ? length * RING_RADIUS_FACTOR : DEFAULT_RING_RADIUS;
    this.buildPlumes();
  }

  /** Install the generated drive core. Cores are cloned from this source. */
  setCoreModel(model: THREE.Object3D): void {
    this.coreModel = model;
    // Force a rebuild so already-requested cores appear.
    const wanted = this.visibleCores;
    this.visibleCores = -1;
    this.setCoreCount(wanted);
  }

  get hasHull(): boolean {
    return this.hullModel !== null;
  }

  /**
   * Match visible cores to game state. Only the difference is added or
   * removed; rebuilding would teleport the survivors mid-rotation.
   */
  setCoreCount(count: number): void {
    const clamped = Math.max(0, Math.min(10, Math.round(count)));
    if (clamped === this.visibleCores) return;
    this.visibleCores = clamped;

    if (!this.coreModel) {
      for (const entry of this.coreInstances) {
        this.coreHost.remove(entry.object);
        entry.object.clear();
      }
      this.coreInstances = [];
      return;
    }

    while (this.coreInstances.length > clamped) {
      const dead = this.coreInstances.pop();
      if (!dead) break;
      this.coreHost.remove(dead.object);
      dead.object.clear();
    }

    while (this.coreInstances.length < clamped) {
      const object = this.coreModel.clone(true);
      // Nozzles aft wherever it sits, so the team reads as thrusters.
      object.rotation.y = Math.PI * 0.5;
      this.coreHost.add(object);
      // A new core appears already in its slot; nothing to slide in from.
      const slot = (this.coreInstances.length / clamped) * Math.PI * 2;
      this.coreInstances.push({ object, offset: slot, target: slot });
    }

    this.respace();
  }

  /** Hand every core an evenly spaced slot. They ease into it from wherever. */
  private respace(): void {
    const count = this.coreInstances.length;
    this.coreInstances.forEach((entry, index) => {
      entry.target = (index / Math.max(1, count)) * Math.PI * 2;
    });
  }

  private buildPlumes(): void {
    for (const plume of this.plumes) {
      this.plumeHost.remove(plume);
      // Sprites share one global geometry — disposing it here would break
      // every other sprite in the app, including the cloud deck.
    }
    this.plumes = [];

    for (let i = 0; i < 1; i += 1) {
      const plume = new THREE.Sprite(this.plumeMaterial);
      plume.scale.set(2.4, 1.5, 1);
      plume.position.set(
        HULL_POSITION.x + 2.5,
        HULL_POSITION.y + 0.05,
        0.2,
      );
      this.plumeHost.add(plume);
      this.plumes.push(plume);
    }
  }

  /**
   * @param burnFactor 0 for coasting, 1 for a hard burn. Drives plume length.
   */
  update(delta: number, elapsed: number, burnFactor: number): void {
    this.bobTime += delta;

    // A slow vertical bob sells thrust without animating the model itself.
    const bob = Math.sin(this.bobTime * 0.9) * 0.075;
    this.hullHost.position.y = HULL_POSITION.y + bob;
    this.hullHost.rotation.z = Math.sin(this.bobTime * 0.6) * 0.012;

    // Spin tracks the burn, so the schedule is visible in the scene.
    const spin = SPIN_COASTING + (SPIN_HARD - SPIN_COASTING) * Math.max(0, Math.min(1, burnFactor));
    this.ringPhase = (this.ringPhase + spin * delta) % (Math.PI * 2);

    const ease = 1 - Math.exp(-RESPACE_RATE * delta);
    for (const entry of this.coreInstances) {
      // The short way round, or 350 degrees to 10 travels most of a lap back.
      let gap = entry.target - entry.offset;
      gap -= Math.PI * 2 * Math.round(gap / (Math.PI * 2));
      entry.offset += gap * ease;

      const angle = this.ringPhase + entry.offset;
      // Rides the hull's bob so the ring stays locked to the ship.
      const across = Math.cos(angle) * this.ringRadius;
      entry.object.position.set(
        HULL_POSITION.x + across * Math.sin(RING_TILT),
        HULL_POSITION.y + bob + Math.sin(angle) * this.ringRadius,
        across * Math.cos(RING_TILT),
      );
    }

    // The glow breathes with the burn rate rather than stretching into a
    // plume: a hint that the engines are lit, not a full exhaust.
    const size = 1.5 + burnFactor * 1.4;
    this.plumes.forEach((plume, index) => {
      const flicker = 0.9 + Math.sin(elapsed * 9 + index * 2.1) * 0.1;
      plume.scale.set(size * flicker, size * 0.75 * flicker, 1);
    });
    this.plumeMaterial.opacity = 0.22 + burnFactor * 0.38;
  }

  dispose(): void {
    this.plumeMaterial.dispose();
    for (const plume of this.plumes) plume.geometry.dispose();
    this.plumes = [];
  }
}
