import * as THREE from 'three';
import type { AppPhase } from '../app/AppStateMachine';
import type { CameraMode } from '../config/catalog';
import type { RobotTelemetry } from '../robots/RobotRuntime';

export class CameraDirector {
  private readonly desired = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly cameraRay = new THREE.Raycaster();
  private readonly cameraRayDirection = new THREE.Vector3();
  private readonly worldBounds = new THREE.Box3();
  private worldCollider: THREE.Object3D | null = null;
  private hasWorldBounds = false;
  private elapsed = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  setWorldBounds(bounds: THREE.Box3 | null): void {
    this.hasWorldBounds = bounds !== null;
    if (bounds) this.worldBounds.copy(bounds);
  }

  setWorldCollider(collider: THREE.Object3D | null): void {
    this.worldCollider = collider;
  }

  snapTo(position: THREE.Vector3, yaw = 0): void {
    this.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.desired
      .copy(position)
      .addScaledVector(this.forward, -6)
      .add(new THREE.Vector3(0, 3.4, 0));
    this.target.copy(position).add(new THREE.Vector3(0, 0.8, 0));
    this.constrainToWorld();
    this.snapToTargets();
  }

  update(
    delta: number,
    phase: AppPhase,
    mode: CameraMode,
    telemetry: RobotTelemetry,
    robotRoot: THREE.Object3D,
    immediate = false,
    carryFocus: THREE.Vector3 | null = null,
  ): void {
    if (immediate) this.elapsed = 0;
    else this.elapsed += delta;
    const subject = robotRoot.position;
    this.forward.set(-Math.sin(telemetry.yaw), 0, -Math.cos(telemetry.yaw));

    if (phase === 'sandbox-loading') {
      this.desired.copy(subject).add(new THREE.Vector3(6.2, 3.4, 6.2));
      this.target.copy(subject).add(new THREE.Vector3(0, 0.8, 0));
      this.constrainToWorld();
      if (immediate) this.snapToTargets();
      else this.ease(delta, 0.15);
      return;
    }

    if (phase !== 'live' && phase !== 'paused' && phase !== 'replay' && phase !== 'sandbox') {
      const angle = this.elapsed * 0.12;
      const radius = phase === 'robot-select' ? 3.4 : 13;
      this.desired.set(
        subject.x + Math.sin(angle) * radius,
        phase === 'robot-select' ? subject.y + 1.9 : 8.4,
        subject.z + Math.cos(angle) * radius,
      );
      this.target.copy(subject).add(new THREE.Vector3(0, phase === 'robot-select' ? 0.9 : 0.4, 0));
      if (immediate) this.snapToTargets();
      else this.ease(delta, 0.22);
      return;
    }

    switch (mode) {
      case 'chase':
        this.desired
          .copy(subject)
          .addScaledVector(this.forward, -5.6)
          .add(new THREE.Vector3(0, 2.8, 0));
        this.target
          .copy(subject)
          .addScaledVector(this.forward, 2.2)
          .add(new THREE.Vector3(0, 0.7, 0));
        break;
      case 'follow':
        this.desired
          .copy(subject)
          .addScaledVector(this.forward, -3.1)
          .add(new THREE.Vector3(0, 1.85, 0));
        this.target
          .copy(subject)
          .addScaledVector(this.forward, 2.6)
          .add(new THREE.Vector3(0, 0.75, 0));
        break;
      case 'first-person':
        {
          const mount = cameraMountFor(robotRoot, 'first-person');
          this.desired
            .copy(subject)
            .add(new THREE.Vector3(0, mount.height, 0))
            .addScaledVector(this.forward, mount.forward);
        }
        this.target.copy(this.desired).addScaledVector(this.forward, 8);
        break;
      case 'sensor':
        {
          const mount = cameraMountFor(robotRoot, 'sensor');
          this.desired
            .copy(subject)
            .add(new THREE.Vector3(0, mount.height, 0))
            .addScaledVector(this.forward, mount.forward);
        }
        this.target
          .copy(this.desired)
          .addScaledVector(this.forward, 10)
          .add(new THREE.Vector3(0, -1.4, 0));
        break;
      case 'orbit': {
        const angle = this.elapsed * 0.28;
        this.desired.set(
          subject.x + Math.sin(angle) * 5,
          subject.y + 3.2,
          subject.z + Math.cos(angle) * 5,
        );
        this.target.copy(subject).add(new THREE.Vector3(0, 0.8, 0));
        break;
      }
      case 'carry': {
        const focus = carryFocus ?? subject;
        this.right.set(-this.forward.z, 0, this.forward.x);
        this.target.copy(focus).lerp(subject, carryFocus ? 0.18 : 0);
        this.desired
          .copy(this.target)
          .addScaledVector(this.forward, -3.8)
          .addScaledVector(this.right, 2.7)
          .add(new THREE.Vector3(0, 2.15, 0));
        break;
      }
      case 'fixed':
        if (phase === 'sandbox') {
          this.desired.copy(subject).add(new THREE.Vector3(7, 5.5, 7));
        } else if (this.hasWorldBounds) {
          const size = this.worldBounds.getSize(new THREE.Vector3());
          this.desired.set(
            this.worldBounds.max.x - Math.min(1.2, size.x * 0.08),
            this.worldBounds.min.y + Math.min(6.2, size.y * 0.74),
            this.worldBounds.max.z - Math.min(1.2, size.z * 0.08),
          );
        } else {
          this.desired.copy(subject).add(new THREE.Vector3(7, 5.5, 7));
        }
        this.target.copy(subject).add(new THREE.Vector3(0, 0.5, 0));
        break;
      case 'overhead':
        this.desired.copy(subject).add(new THREE.Vector3(2.4, 7.4, 2.4));
        this.target.copy(subject).add(new THREE.Vector3(0, 0.65, 0));
        break;
    }
    this.constrainToWorld(mode !== 'first-person' && mode !== 'sensor' && mode !== 'overhead');
    if (immediate) this.snapToTargets();
    else
      this.ease(
        delta,
        mode === 'first-person' || mode === 'sensor' ? 0.055 : mode === 'carry' ? 0.12 : 0.15,
      );
  }

  private constrainToWorld(resolveOcclusion = true, allowAboveWorld = false): void {
    if (this.hasWorldBounds) {
      const cameraMargin = 0.6;
      const targetMargin = 0.08;
      this.desired.set(
        THREE.MathUtils.clamp(
          this.desired.x,
          this.worldBounds.min.x + cameraMargin,
          this.worldBounds.max.x - cameraMargin,
        ),
        allowAboveWorld
          ? Math.max(this.desired.y, this.worldBounds.max.y + 4)
          : THREE.MathUtils.clamp(
              this.desired.y,
              this.worldBounds.min.y + 0.4,
              this.worldBounds.max.y - 0.3,
            ),
        THREE.MathUtils.clamp(
          this.desired.z,
          this.worldBounds.min.z + cameraMargin,
          this.worldBounds.max.z - cameraMargin,
        ),
      );
      this.target.clamp(
        this.worldBounds.min.clone().addScalar(targetMargin),
        this.worldBounds.max.clone().addScalar(-targetMargin),
      );
    }
    if (resolveOcclusion) this.resolveColliderOcclusion();
  }

  private resolveColliderOcclusion(): void {
    if (!this.worldCollider) return;
    this.cameraRayDirection.subVectors(this.desired, this.target);
    const desiredDistance = this.cameraRayDirection.length();
    if (desiredDistance <= 0.2) return;
    this.cameraRayDirection.multiplyScalar(1 / desiredDistance);
    this.cameraRay.set(this.target, this.cameraRayDirection);
    this.cameraRay.near = 0.12;
    this.cameraRay.far = desiredDistance;
    const hit = this.cameraRay.intersectObject(this.worldCollider, true)[0];
    if (!hit) return;
    const resolvedDistance = Math.max(0.16, hit.distance - 0.28);
    this.desired.copy(this.target).addScaledVector(this.cameraRayDirection, resolvedDistance);
  }

  private snapToTargets(): void {
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.target);
  }

  private ease(delta: number, lag: number): void {
    const factor = 1 - Math.exp(-delta / lag);
    this.camera.position.lerp(this.desired, factor);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const currentTarget = this.camera.position.clone().add(look);
    currentTarget.lerp(this.target, Math.min(1, factor * 1.8));
    this.camera.lookAt(currentTarget);
  }
}

function cameraMountFor(
  robotRoot: THREE.Object3D,
  mode: 'first-person' | 'sensor',
): { height: number; forward: number } {
  const robotId = (robotRoot.userData as Record<string, unknown>).robotId;
  const mounts = {
    'axiom-h1': {
      'first-person': { height: 1.62, forward: 0.64 },
      sensor: { height: 1.25, forward: 0.68 },
    },
    'quadrant-q4': {
      'first-person': { height: 1.02, forward: 0.62 },
      sensor: { height: 1.04, forward: 0.68 },
    },
    'forge-t7': {
      'first-person': { height: 1.34, forward: 0.88 },
      sensor: { height: 1.22, forward: 0.94 },
    },
    'swift-w2': {
      'first-person': { height: 1.42, forward: 0.55 },
      sensor: { height: 1.38, forward: 0.62 },
    },
    'kestrel-d5': {
      'first-person': { height: 0.9, forward: 0.54 },
      sensor: { height: 0.7, forward: 0.58 },
    },
  } as const;
  return (
    mounts[robotId as keyof typeof mounts]?.[mode] ?? {
      height: mode === 'first-person' ? 1.5 : 1.2,
      forward: 0.65,
    }
  );
}
