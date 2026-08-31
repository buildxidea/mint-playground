import * as THREE from 'three';
import type { BoatState } from './BoatPhysics';
import type { SlipDef } from '../levels/LevelDef';

export class ChaseCamera {
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.camera.fov = 46;
    this.camera.near = 0.2;
    this.camera.far = 120;
  }

  snap(boat: BoatState): void {
    this.computeDesired(boat, 0);
    this.camera.position.copy(this.desired);
    this.look.set(boat.x, 0.6, boat.z).addScaledVector(this.forward(boat), 3.5);
    this.camera.lookAt(this.look);
  }

  update(dt: number, boat: BoatState, slip: SlipDef, lag: number, nearSlip: boolean): void {
    this.computeDesired(boat, nearSlip ? 0.85 : 0);
    const factor = 1 - Math.exp(-dt / Math.max(0.001, lag));
    this.camera.position.lerp(this.desired, factor);

    const lookAhead = nearSlip ? 1.2 : 3.8;
    this.look.set(boat.x, 0.55, boat.z).addScaledVector(this.forward(boat), lookAhead);
    if (nearSlip) {
      this.look.x = THREE.MathUtils.lerp(this.look.x, slip.x, 0.25);
      this.look.z = THREE.MathUtils.lerp(this.look.z, slip.z, 0.25);
    }
    this.camera.lookAt(this.look);

    const targetFov = nearSlip ? 42 : 46;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, factor);
    this.camera.updateProjectionMatrix();
  }

  private computeDesired(boat: BoatState, pullIn: number): void {
    const back = 8.5 - pullIn * 1.8;
    const up = 5.8 - pullIn * 0.6;
    const f = this.forward(boat);
    this.offset.set(-f.x * back, up, -f.z * back);
    this.desired.set(boat.x + this.offset.x, this.offset.y, boat.z + this.offset.z);
  }

  private forward(boat: BoatState): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(boat.yaw), 0, Math.cos(boat.yaw));
  }
}
