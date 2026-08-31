import * as THREE from 'three';

export type CameraMode = 'chase' | 'top' | 'fpv';

const CHASE_OFFSET = new THREE.Vector3(0, 2.4, 5.2);
const LOOK_AHEAD = 4;

/**
 * Smooth trailing camera. Chase mode swings behind the drone's heading with a
 * soft lag; top is a readable overhead for tight landings; FPV mounts just
 * ahead of the camera pod.
 */
export class CameraRig {
  mode: CameraMode = 'chase';

  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  cycle(): CameraMode {
    this.mode = this.mode === 'chase' ? 'top' : this.mode === 'top' ? 'fpv' : 'chase';
    return this.mode;
  }

  snapTo(position: THREE.Vector3, yaw: number): void {
    this.computeDesired(position, yaw);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.look);
  }

  update(delta: number, position: THREE.Vector3, yaw: number, velocity: THREE.Vector3): void {
    this.computeDesired(position, yaw);

    if (this.mode === 'fpv') {
      this.camera.position.copy(this.desired);
      this.camera.lookAt(this.look);
      return;
    }

    const lag = this.mode === 'chase' ? 0.22 : 0.3;
    const factor = 1 - Math.exp(-delta / lag);
    this.camera.position.lerp(this.desired, factor);

    if (this.mode === 'chase') {
      // Look slightly ahead of travel so fast passes stay readable.
      this.look.copy(position);
      this.look.x += velocity.x * 0.25;
      this.look.z += velocity.z * 0.25;
      this.look.y += 0.6;
    }
    this.camera.lookAt(this.look);
  }

  private computeDesired(position: THREE.Vector3, yaw: number): void {
    if (this.mode === 'top') {
      this.desired.set(position.x, position.y + 26, position.z + 6);
      this.look.copy(position);
      return;
    }
    if (this.mode === 'fpv') {
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      this.desired.set(position.x - sin * 0.35, position.y + 0.12, position.z - cos * 0.35);
      this.look.set(position.x - sin * LOOK_AHEAD, position.y - 0.4, position.z - cos * LOOK_AHEAD);
      return;
    }
    // Chase: rotate the offset by the drone heading (forward is -Z at yaw 0).
    this.offset.copy(CHASE_OFFSET);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    this.desired.set(
      position.x + this.offset.x * cos + this.offset.z * sin,
      position.y + this.offset.y,
      position.z - this.offset.x * sin + this.offset.z * cos,
    );
    this.look.copy(position);
    this.look.y += 0.6;
  }
}
