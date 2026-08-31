import * as THREE from 'three';
import type { PlanarPose } from './CollisionSystem';

export class VfxSystem {
  readonly group = new THREE.Group();

  private readonly mistGeometry = new THREE.IcosahedronGeometry(0.09, 0);
  private readonly mistMaterial = new THREE.MeshBasicMaterial({
    color: '#c9fbff', transparent: true, opacity: 0.56, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  private readonly mist = new THREE.InstancedMesh(this.mistGeometry, this.mistMaterial, 22);
  private readonly flakeGeometry = new THREE.TetrahedronGeometry(0.055, 0);
  private readonly flakeMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0.82, depthWrite: false,
  });
  private readonly flakes = new THREE.InstancedMesh(this.flakeGeometry, this.flakeMaterial, 14);
  private readonly sparkGeometry = new THREE.TetrahedronGeometry(0.075, 0);
  private readonly sparkMaterial = new THREE.MeshBasicMaterial({
    color: '#ffb24b', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  private readonly sparks = new THREE.InstancedMesh(this.sparkGeometry, this.sparkMaterial, 12);
  private readonly sheenMaterial = new THREE.MeshBasicMaterial({
    color: '#86f1f5', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  private readonly sheen = new THREE.Mesh(new THREE.PlaneGeometry(2.28, 1.5), this.sheenMaterial);
  private readonly dummy = new THREE.Object3D();
  private sparkTimer = 0;
  private sparkOrigin = new THREE.Vector3();

  constructor() {
    this.group.name = 'gameplayVfx';
    this.mist.frustumCulled = false;
    this.flakes.frustumCulled = false;
    this.sparks.frustumCulled = false;
    this.sheen.rotation.x = -Math.PI / 2;
    this.sheen.renderOrder = 3;
    this.group.add(this.sheen, this.mist, this.flakes, this.sparks);
  }

  update(delta: number, elapsed: number, tool: PlanarPose, speed: number, active: boolean, reducedMotion: boolean): void {
    const time = reducedMotion ? 0.35 : elapsed;
    const forwardX = Math.sin(tool.heading);
    const forwardZ = -Math.cos(tool.heading);
    const rightX = Math.cos(tool.heading);
    const rightZ = Math.sin(tool.heading);
    const speedRatio = Math.min(1, Math.abs(speed) / 6.9);
    const visible = active;

    this.mist.visible = visible;
    this.flakes.visible = visible;
    this.sheen.visible = visible;
    if (visible) {
      this.sheen.position.set(tool.x - forwardX * 0.45, 0.071, tool.z - forwardZ * 0.45);
      this.sheen.rotation.y = tool.heading;
      this.sheenMaterial.opacity = 0.13 + speedRatio * 0.12;
      for (let index = 0; index < this.mist.count; index += 1) {
        const lateral = ((index % 11) / 10 - 0.5) * 2.25;
        const lane = Math.floor(index / 11);
        const phase = (time * (0.7 + speedRatio * 1.8) + index * 0.173) % 1;
        const trail = lane * 0.32 + phase * (0.35 + speedRatio * 1.2);
        const lift = 0.08 + Math.sin(phase * Math.PI) * (0.15 + speedRatio * 0.26);
        const drift = Math.sin(index * 2.13 + time * 4.1) * 0.06;
        this.dummy.position.set(
          tool.x + rightX * (lateral + drift) - forwardX * trail,
          lift,
          tool.z + rightZ * (lateral + drift) - forwardZ * trail,
        );
        const scale = 0.45 + (1 - phase) * 0.9;
        this.dummy.scale.setScalar(scale);
        this.dummy.rotation.set(time * 1.4 + index, time * 0.7, 0);
        this.dummy.updateMatrix();
        this.mist.setMatrixAt(index, this.dummy.matrix);
      }
      this.mist.instanceMatrix.needsUpdate = true;

      for (let index = 0; index < this.flakes.count; index += 1) {
        const lateral = ((index % 7) / 6 - 0.5) * 2.12;
        const phase = (time * 1.35 + index * 0.227) % 1;
        const trail = 0.12 + phase * (0.5 + speedRatio * 1.45);
        this.dummy.position.set(
          tool.x + rightX * lateral - forwardX * trail,
          0.1 + Math.sin(phase * Math.PI) * 0.32,
          tool.z + rightZ * lateral - forwardZ * trail,
        );
        this.dummy.scale.setScalar(0.5 + (1 - phase) * 0.75);
        this.dummy.rotation.set(time * 5 + index, time * 4 - index, phase * 3);
        this.dummy.updateMatrix();
        this.flakes.setMatrixAt(index, this.dummy.matrix);
      }
      this.flakes.instanceMatrix.needsUpdate = true;
    }

    this.sparkTimer = Math.max(0, this.sparkTimer - delta);
    this.sparks.visible = this.sparkTimer > 0;
    this.sparkMaterial.opacity = Math.min(1, this.sparkTimer * 6);
    if (this.sparkTimer > 0) {
      const progress = 1 - this.sparkTimer / 0.32;
      for (let index = 0; index < this.sparks.count; index += 1) {
        const angle = (index / this.sparks.count) * Math.PI * 2 + index * 0.41;
        const radius = progress * (0.35 + (index % 3) * 0.18);
        this.dummy.position.set(
          this.sparkOrigin.x + Math.cos(angle) * radius,
          0.22 + Math.sin(progress * Math.PI) * (0.22 + (index % 4) * 0.08),
          this.sparkOrigin.z + Math.sin(angle) * radius,
        );
        this.dummy.scale.setScalar(1 - progress * 0.7);
        this.dummy.rotation.set(angle, progress * 6, angle * 0.5);
        this.dummy.updateMatrix();
        this.sparks.setMatrixAt(index, this.dummy.matrix);
      }
      this.sparks.instanceMatrix.needsUpdate = true;
    }
  }

  collision(position: THREE.Vector3): void {
    this.sparkOrigin.copy(position);
    this.sparkTimer = 0.32;
  }

  dispose(): void {
    this.mistGeometry.dispose();
    this.mistMaterial.dispose();
    this.flakeGeometry.dispose();
    this.flakeMaterial.dispose();
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    this.sheen.geometry.dispose();
    this.sheenMaterial.dispose();
  }
}
