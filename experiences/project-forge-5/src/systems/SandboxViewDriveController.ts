import * as THREE from 'three';
import type { InputIntent } from '../core/InputController';

const VIEW_PROJECTION_EPSILON = 1e-5;

/**
 * Owns the outdoor sandbox's camera-relative movement frame and subject-follow
 * offset. Pointer input changes the camera elsewhere; it never enters this
 * controller as a robot destination.
 */
export class SandboxViewDriveController {
  private readonly viewForward = new THREE.Vector3(0, 0, -1);
  private readonly viewRight = new THREE.Vector3(1, 0, 0);
  private readonly worldMovement = new THREE.Vector3();
  private readonly robotForward = new THREE.Vector3();
  private readonly robotRight = new THREE.Vector3();
  private readonly previousSubjectPosition = new THREE.Vector3();
  private readonly subjectDelta = new THREE.Vector3();
  private following = false;

  applyCameraRelativeIntent(
    intent: InputIntent,
    camera: THREE.Camera,
    robotYaw: number,
  ): InputIntent {
    const horizontalX = intent.translation.x;
    const horizontalZ = intent.translation.z;
    if (horizontalX === 0 && horizontalZ === 0) return intent;

    camera.getWorldDirection(this.worldMovement);
    this.worldMovement.y = 0;
    if (this.worldMovement.lengthSq() > VIEW_PROJECTION_EPSILON) {
      this.viewForward.copy(this.worldMovement).normalize();
    }
    this.viewRight.set(-this.viewForward.z, 0, this.viewForward.x);

    this.worldMovement
      .copy(this.viewForward)
      .multiplyScalar(horizontalZ)
      .addScaledVector(this.viewRight, horizontalX);
    const movementMagnitude = Math.min(1, this.worldMovement.length());
    if (movementMagnitude <= VIEW_PROJECTION_EPSILON) {
      intent.translation.x = 0;
      intent.translation.z = 0;
      return intent;
    }
    this.worldMovement.normalize().multiplyScalar(movementMagnitude);

    this.robotForward.set(-Math.sin(robotYaw), 0, -Math.cos(robotYaw));
    this.robotRight.set(Math.cos(robotYaw), 0, -Math.sin(robotYaw));
    intent.translation.x = this.worldMovement.dot(this.robotRight);
    intent.translation.z = this.worldMovement.dot(this.robotForward);

    const desiredYaw = Math.atan2(-this.viewForward.x, -this.viewForward.z);
    const yawError = Math.atan2(Math.sin(desiredYaw - robotYaw), Math.cos(desiredYaw - robotYaw));
    intent.yaw = THREE.MathUtils.clamp(intent.yaw + yawError * 1.8, -1, 1);
    return intent;
  }

  beginFollowing(subjectPosition: THREE.Vector3): void {
    this.previousSubjectPosition.copy(subjectPosition);
    this.following = true;
  }

  followSubject(
    subjectPosition: THREE.Vector3,
    camera: THREE.Camera,
    orbitTarget: THREE.Vector3,
  ): void {
    if (!this.following) {
      this.beginFollowing(subjectPosition);
      return;
    }
    this.subjectDelta.subVectors(subjectPosition, this.previousSubjectPosition);
    if (this.subjectDelta.lengthSq() > 0) {
      camera.position.add(this.subjectDelta);
      orbitTarget.add(this.subjectDelta);
    }
    this.previousSubjectPosition.copy(subjectPosition);
  }

  recenter(
    subjectPosition: THREE.Vector3,
    robotYaw: number,
    camera: THREE.Camera,
    orbitTarget: THREE.Vector3,
  ): void {
    this.viewForward.set(-Math.sin(robotYaw), 0, -Math.cos(robotYaw));
    camera.position
      .copy(subjectPosition)
      .addScaledVector(this.viewForward, -6)
      .add(new THREE.Vector3(0, 3.4, 0));
    orbitTarget.copy(subjectPosition).add(new THREE.Vector3(0, 0.8, 0));
    camera.lookAt(orbitTarget);
    this.beginFollowing(subjectPosition);
  }

  stopFollowing(): void {
    this.following = false;
  }
}
