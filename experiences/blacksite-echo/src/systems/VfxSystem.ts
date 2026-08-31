import * as THREE from 'three';
import type { MintAssetRuntime } from '../assets/MintAssetRuntime';

type Shell = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
};

type Impact = {
  mesh: THREE.Mesh;
  life: number;
  duration: number;
  baseScale: number;
  spin: number;
};

export type CombatImpactEvent = {
  critical: boolean;
  killed: boolean;
};

type SmokeZone = {
  group: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  life: number;
  particles: THREE.Points;
};

export class VfxSystem {
  private readonly shells: Shell[] = [];
  private readonly impacts: Impact[] = [];
  private readonly smokeZones: SmokeZone[] = [];
  private readonly shellGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.045, 6);
  private readonly shellMaterial = new THREE.MeshStandardMaterial({
    color: '#b38b45',
    roughness: 0.34,
    metalness: 0.86,
  });
  private readonly impactGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly impactMaterial = new THREE.MeshBasicMaterial({
    color: '#ffc06c',
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private impactTexture: THREE.Texture | null = null;
  private smokeTexture: THREE.Texture | null = null;
  private atlasLoadFailed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets?: MintAssetRuntime,
  ) {
    for (let index = 0; index < 24; index += 1) {
      const mesh = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shells.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
    }
    for (let index = 0; index < 48; index += 1) {
      const mesh = new THREE.Mesh(this.impactGeometry, this.impactMaterial.clone());
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this.impacts.push({ mesh, life: 0, duration: 0.22, baseScale: 0.12, spin: 0 });
    }
    void this.initializeMintAtlases();
  }

  spawnShell(position: THREE.Vector3, camera: THREE.Camera, seed: number): void {
    if (this.assets?.visibleFallbacksAllowed === false) return;
    const shell = this.shells.find((candidate) => candidate.life <= 0);
    if (!shell) return;
    shell.mesh.visible = true;
    shell.mesh.position.copy(position);
    shell.mesh.quaternion.copy(camera.quaternion);
    shell.velocity
      .set(1.4 + (seed % 5) * 0.11, 1.2 + (seed % 3) * 0.16, -0.35)
      .applyQuaternion(camera.quaternion);
    shell.life = 1.35;
  }

  spawnImpact(position: THREE.Vector3, normal: THREE.Vector3, hostile = false): void {
    if (!this.impactTexture && this.assets?.visibleFallbacksAllowed === false) return;
    this.emitImpact(position, normal, hostile ? 'flesh' : 'world');
  }

  spawnCombatImpact(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    event: CombatImpactEvent,
  ): void {
    if (!this.impactTexture && this.assets?.visibleFallbacksAllowed === false) return;
    this.emitImpact(position, normal, 'flesh');
    if (event.critical) {
      this.emitImpact(position.clone().addScaledVector(normal, 0.01), normal, 'headshot');
    }
    if (event.killed) {
      this.emitImpact(position.clone().addScaledVector(normal, 0.016), normal, 'kill');
    }
  }

  private emitImpact(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    kind: 'world' | 'flesh' | 'headshot' | 'kill',
  ): void {
    const impact = this.impacts.find((candidate) => candidate.life <= 0);
    if (!impact) return;
    impact.mesh.visible = true;
    impact.mesh.position.copy(position).addScaledVector(normal, 0.008);
    impact.mesh.lookAt(position.clone().add(normal));
    impact.mesh.rotation.z =
      ((Math.abs(position.x * 17 + position.y * 29 + position.z * 41) % 1) - 0.5) *
      Math.PI;
    const material = impact.mesh.material as THREE.MeshBasicMaterial;
    material.map = this.impactTexture;
    material.color.set(
      kind === 'headshot'
        ? '#ffd36a'
        : kind === 'kill'
          ? '#ff302b'
          : kind === 'flesh'
            ? '#ff5b4f'
            : '#ffc06c',
    );
    material.blending =
      kind === 'headshot' ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.opacity = kind === 'kill' ? 0.78 : 0.9;
    material.needsUpdate = true;
    impact.duration =
      kind === 'kill' ? 0.42 : kind === 'headshot' ? 0.32 : kind === 'flesh' ? 0.25 : 0.22;
    impact.baseScale =
      kind === 'kill' ? 0.24 : kind === 'headshot' ? 0.18 : kind === 'flesh' ? 0.14 : 0.12;
    impact.spin = kind === 'headshot' ? 2.8 : kind === 'kill' ? -1.5 : 0.7;
    impact.mesh.scale.setScalar(impact.baseScale);
    impact.life = impact.duration;
  }

  deploySmoke(position: THREE.Vector3): void {
    if (!this.smokeTexture && this.assets?.visibleFallbacksAllowed === false) return;
    const group = new THREE.Group();
    group.position.copy(position);
    const count = 78;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.399963;
      const radius = Math.sqrt(index / count) * 3.5;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = 0.35 + ((index * 17) % 31) / 31 * 2.3;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: '#a9b4aa',
        map: this.smokeTexture,
        alphaMap: this.smokeTexture,
        alphaTest: this.smokeTexture ? 0.06 : 0,
        size: 0.78,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    group.add(particles);
    this.scene.add(group);
    this.smokeZones.push({ group, position: position.clone(), radius: 3.8, life: 9, particles });
  }

  update(delta: number, elapsed: number): void {
    for (const shell of this.shells) {
      if (shell.life <= 0) continue;
      shell.life -= delta;
      shell.velocity.y -= 7.5 * delta;
      shell.mesh.position.addScaledVector(shell.velocity, delta);
      shell.mesh.rotation.x += delta * 18;
      shell.mesh.rotation.z += delta * 11;
      if (shell.mesh.position.y < 0.05) {
        shell.mesh.position.y = 0.05;
        shell.velocity.multiplyScalar(0.42);
        shell.velocity.y = Math.abs(shell.velocity.y) * 0.32;
      }
      if (shell.life <= 0) shell.mesh.visible = false;
    }
    for (const impact of this.impacts) {
      if (impact.life <= 0) continue;
      impact.life -= delta;
      const material = impact.mesh.material as THREE.MeshBasicMaterial;
      const progress = 1 - Math.max(0, impact.life) / impact.duration;
      material.opacity = Math.max(0, (1 - progress) * 0.9);
      impact.mesh.scale.setScalar(impact.baseScale * (1 + progress * 1.55));
      impact.mesh.rotation.z += impact.spin * delta;
      if (impact.life <= 0) impact.mesh.visible = false;
    }
    for (let index = this.smokeZones.length - 1; index >= 0; index -= 1) {
      const zone = this.smokeZones[index];
      zone.life -= delta;
      zone.group.rotation.y += delta * 0.14;
      zone.group.position.y = Math.sin(elapsed * 0.4 + index) * 0.08;
      const material = zone.particles.material as THREE.PointsMaterial;
      material.opacity = Math.min(0.36, zone.life * 0.15);
      if (zone.life <= 0) {
        this.scene.remove(zone.group);
        zone.particles.geometry.dispose();
        material.dispose();
        this.smokeZones.splice(index, 1);
      }
    }
  }

  isLineObscured(start: THREE.Vector3, end: THREE.Vector3): boolean {
    const line = new THREE.Line3(start, end);
    const closest = new THREE.Vector3();
    return this.smokeZones.some((zone) => {
      line.closestPointToPoint(zone.position, true, closest);
      return closest.distanceTo(zone.position) < zone.radius;
    });
  }

  reset(): void {
    for (const shell of this.shells) {
      shell.life = 0;
      shell.mesh.visible = false;
    }
    for (const impact of this.impacts) {
      impact.life = 0;
      impact.mesh.visible = false;
    }
    for (const zone of this.smokeZones) {
      this.scene.remove(zone.group);
      zone.particles.geometry.dispose();
      (zone.particles.material as THREE.Material).dispose();
    }
    this.smokeZones.length = 0;
  }

  dispose(): void {
    this.reset();
    for (const shell of this.shells) this.scene.remove(shell.mesh);
    for (const impact of this.impacts) {
      this.scene.remove(impact.mesh);
      (impact.mesh.material as THREE.Material).dispose();
    }
    this.shellGeometry.dispose();
    this.shellMaterial.dispose();
    this.impactGeometry.dispose();
    this.impactMaterial.dispose();
    this.impactTexture?.dispose();
    this.smokeTexture?.dispose();
  }

  diagnostics(): {
    mintImpactAtlasReady: boolean;
    mintSmokeAtlasReady: boolean;
    atlasLoadFailed: boolean;
    proceduralFallbackVisible: boolean;
    pooledShells: number;
    pooledImpacts: number;
    activeImpacts: number;
    activeSmokeZones: number;
  } {
    return {
      mintImpactAtlasReady: this.impactTexture !== null,
      mintSmokeAtlasReady: this.smokeTexture !== null,
      atlasLoadFailed: this.atlasLoadFailed,
      proceduralFallbackVisible:
        this.assets?.visibleFallbacksAllowed !== false &&
        (!this.impactTexture || !this.smokeTexture),
      pooledShells: this.shells.length,
      pooledImpacts: this.impacts.length,
      activeImpacts: this.impacts.filter((impact) => impact.life > 0).length,
      activeSmokeZones: this.smokeZones.length,
    };
  }

  private async initializeMintAtlases(): Promise<void> {
    if (!this.assets) return;
    try {
      const [impact, smoke] = await Promise.all([
        this.assets.loadTexture('vfx-impact-atlas'),
        this.assets.loadTexture('vfx-smoke-atlas'),
      ]);
      if (impact) {
        impact.repeat.set(0.25, 0.5);
        impact.offset.set(0, 0.5);
        impact.needsUpdate = true;
        this.impactTexture = impact;
        this.impacts.forEach(({ mesh }) => {
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.map = impact;
          material.needsUpdate = true;
        });
      }
      if (smoke) {
        smoke.repeat.set(0.25, 0.5);
        smoke.offset.set(0.25, 0);
        smoke.needsUpdate = true;
        this.smokeTexture = smoke;
      }
    } catch (error) {
      this.atlasLoadFailed = true;
      console.warn('Mint VFX atlases failed to load.', error);
    }
  }
}
