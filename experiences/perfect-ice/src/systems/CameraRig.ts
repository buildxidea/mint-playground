import * as THREE from 'three';

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private trauma = 0;
  private shakeTime = 0;
  private reducedMotion = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  snapTo(target: THREE.Vector3, forward: THREE.Vector3): void {
    this.deriveDesired(target, forward, 0);
    this.camera.position.copy(this.desiredPosition);
    this.lookTarget.copy(this.desiredLook);
    this.camera.lookAt(this.lookTarget);
  }

  update(delta: number, target: THREE.Vector3, forward: THREE.Vector3, speed: number, lag = 0.18): void {
    this.deriveDesired(target, forward, speed);
    const factor = 1 - Math.exp(-delta / Math.max(0.001, lag));
    this.camera.position.lerp(this.desiredPosition, factor);
    this.lookTarget.lerp(this.desiredLook, factor * 1.4);
    this.camera.lookAt(this.lookTarget);

    this.shakeTime += delta;
    this.trauma = Math.max(0, this.trauma - delta * 1.7);
    if (!this.reducedMotion && this.trauma > 0) {
      const magnitude = this.trauma * this.trauma;
      this.camera.position.x += this.noise(this.shakeTime * 29, 1) * magnitude * 0.18;
      this.camera.position.y += this.noise(this.shakeTime * 31, 2) * magnitude * 0.12;
      this.camera.rotation.z += this.noise(this.shakeTime * 33, 3) * magnitude * 0.018;
    }
  }

  addTrauma(amount: number): void {
    if (this.reducedMotion) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) this.trauma = 0;
  }

  private deriveDesired(target: THREE.Vector3, forward: THREE.Vector3, speed: number): void {
    const aspect = this.camera.aspect || 1;
    const mobilePortrait = aspect < 0.78;
    const distance = mobilePortrait ? 12.6 : 9.1;
    const height = mobilePortrait ? 12.2 : 9.0;
    const lookAhead = mobilePortrait ? 2.2 : 3.2;
    this.forward.copy(forward).normalize();
    this.desiredPosition.copy(target).addScaledVector(this.forward, -distance);
    this.desiredPosition.y += height + Math.min(1.2, Math.abs(speed) * 0.08);
    this.desiredLook.copy(target).addScaledVector(this.forward, lookAhead);
    this.desiredLook.y = 0.3;
  }

  private noise(value: number, seed: number): number {
    const result = Math.sin(value * 12.9898 + seed * 78.233) * 43758.5453;
    return (result - Math.floor(result)) * 2 - 1;
  }
}
