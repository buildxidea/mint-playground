import * as THREE from "three";
import type { Pose } from "../data/layout-types";
import { CameraTween } from "./CameraTween";

/**
 * Sole owner of the camera pose. Position plus yaw/pitch (YXZ order, no roll).
 * Inputs and tweens mutate the rig; the rig writes the camera once per frame.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  private tween = new CameraTween();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
    this.camera.rotation.order = "YXZ";
  }

  setPose(pose: Pose) {
    this.tween.cancel();
    this.position.set(...pose.position);
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
  }

  flyTo(pose: Pose, duration: number, onDone?: () => void) {
    this.tween.start(this, pose, duration, onDone);
  }

  get isTweening() {
    return this.tween.isActive;
  }

  update(dt: number) {
    this.tween.update(dt, this);
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
