import * as THREE from 'three';
import type { BirdOption, LoadedModel } from '../assets/assets';
import { BIRD_COLLIDER_RADIUS, TUNING } from '../game/tuning';

export class Bird {
  readonly group = new THREE.Group();
  velocityY = 0;

  private readonly tiltGroup = new THREE.Group();
  private readonly wings: THREE.Object3D[] = [];
  private readonly wingRestRotations: number[] = [];
  private flapAnimTime = Infinity;
  private dead = false;

  constructor(model: LoadedModel, option: BirdOption) {
    // Clone so the shared loaded model can back several Bird instances as the
    // player switches, without one instance's transforms leaking into another.
    const visual = model.scene.clone(true);
    const scale = option.height / model.size.y;
    visual.scale.setScalar(scale);
    // loadCenteredModel puts the base at y=0; drop it so the origin is the
    // bird's center, which is what physics and collision track.
    visual.position.y = -(model.size.y * scale) / 2;
    visual.rotation.y = option.yaw;

    visual.traverse((child) => {
      if (/wing/i.test(child.name)) {
        this.wings.push(child);
        this.wingRestRotations.push(child.rotation.z);
      }
    });

    this.tiltGroup.add(visual);
    this.group.add(this.tiltGroup);
    this.group.position.set(0, TUNING.birdStartY, 0);
  }

  get y(): number {
    return this.group.position.y;
  }

  get colliderRadius(): number {
    return BIRD_COLLIDER_RADIUS;
  }

  reset(): void {
    this.dead = false;
    this.velocityY = 0;
    this.flapAnimTime = Infinity;
    this.group.position.set(0, TUNING.birdStartY, 0);
    this.tiltGroup.rotation.set(0, 0, 0);
    this.tiltGroup.scale.setScalar(1);
  }

  flap(): void {
    if (this.dead) return;
    this.velocityY = TUNING.flapVelocity;
    this.flapAnimTime = 0;
  }

  kill(): void {
    this.dead = true;
    this.velocityY = Math.min(this.velocityY, 2);
  }

  /** Idle hover on the start screen: gentle bob plus slow wing flapping. */
  updateIdle(elapsed: number): void {
    this.group.position.y = TUNING.birdStartY + Math.sin(elapsed * 3.2) * 0.16;
    this.tiltGroup.rotation.x = Math.sin(elapsed * 3.2) * 0.06;
    this.animateWings(elapsed * 2.2);
  }

  updatePhysics(delta: number, elapsed: number): void {
    this.velocityY = Math.max(this.velocityY + TUNING.gravity * delta, TUNING.maxFallSpeed);
    this.group.position.y += this.velocityY * delta;

    if (!this.dead && this.group.position.y > TUNING.ceilingY) {
      this.group.position.y = TUNING.ceilingY;
      this.velocityY = 0;
    }
    if (this.group.position.y < TUNING.groundY + TUNING.birdRadius) {
      this.group.position.y = TUNING.groundY + TUNING.birdRadius;
    }

    if (this.dead) {
      // Tumble nose-first into the ground.
      this.tiltGroup.rotation.x = Math.max(this.tiltGroup.rotation.x - 7 * delta, -Math.PI / 2);
      return;
    }

    // Nose up right after a flap, nose down as the fall speed builds
    // (+X rotation pitches the -Z-facing nose upward).
    const targetTilt = THREE.MathUtils.clamp(this.velocityY * 0.055, -1.1, 0.45);
    this.tiltGroup.rotation.x = THREE.MathUtils.lerp(this.tiltGroup.rotation.x, targetTilt, 1 - Math.exp(-12 * delta));

    // Flap burst: fast wing beats plus a quick squash-and-recover pulse.
    this.flapAnimTime += delta;
    const burst = Math.max(0, 1 - this.flapAnimTime / 0.3);
    this.animateWings(elapsed * 9, burst);
    const squash = 1 - 0.12 * Math.sin(Math.min(this.flapAnimTime / 0.3, 1) * Math.PI);
    this.tiltGroup.scale.set(1, squash, 1);
  }

  isOnGround(): boolean {
    return this.group.position.y <= TUNING.groundY + TUNING.birdRadius + 0.001;
  }

  private animateWings(phase: number, intensity = 1): void {
    if (this.wings.length === 0) return;
    const beat = Math.sin(phase * Math.PI * 2) * 0.6 * intensity;
    this.wings.forEach((wing, index) => {
      const side = wing.position.x >= 0 ? 1 : -1;
      wing.rotation.z = this.wingRestRotations[index] + beat * side;
    });
  }
}
