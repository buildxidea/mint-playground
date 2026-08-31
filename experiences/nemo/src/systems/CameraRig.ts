import * as THREE from 'three';
import { CAMERA, SWIM } from '../config';

/**
 * Chase camera: sits behind/above the fish with lag, looks ahead down the
 * corridor, and widens its FOV as speed rises for the sense of acceleration.
 */
export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private fovKick = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    camera.fov = CAMERA.baseFov;
    camera.updateProjectionMatrix();
  }

  snapTo(target: THREE.Vector3): void {
    this.desiredPosition.set(
      target.x + CAMERA.offset.x,
      target.y + CAMERA.offset.y,
      target.z + CAMERA.offset.z,
    );
    this.camera.position.copy(this.desiredPosition);
    this.lookAhead(target);
    this.camera.lookAt(this.lookTarget);
  }

  update(delta: number, target: THREE.Vector3, speed: number): void {
    this.desiredPosition.set(
      target.x + CAMERA.offset.x,
      target.y + CAMERA.offset.y,
      target.z + CAMERA.offset.z,
    );
    const factor = 1 - Math.exp(-delta / CAMERA.lag);
    this.camera.position.lerp(this.desiredPosition, factor);
    this.lookAhead(target);
    this.camera.lookAt(this.lookTarget);

    const speedRatio = THREE.MathUtils.clamp(
      (speed - SWIM.baseSpeed) / (SWIM.bounceSpeed - SWIM.baseSpeed),
      0,
      1,
    );
    this.fovKick = THREE.MathUtils.damp(this.fovKick, speedRatio, 4, delta);
    const fov = THREE.MathUtils.lerp(CAMERA.baseFov, CAMERA.maxFov, this.fovKick);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private lookAhead(target: THREE.Vector3): void {
    this.lookTarget.set(
      target.x + CAMERA.lookAhead.x,
      target.y + CAMERA.lookAhead.y,
      target.z + CAMERA.lookAhead.z,
    );
  }
}
