import * as THREE from 'three';
import { SWIM, CORRIDOR } from '../config';
import type { LoadedAsset } from '../assets/AssetLibrary';
import { fitModel } from '../assets/AssetLibrary';

export type SteerInput = {
  lateral: number; // -1 left .. 1 right
  vertical: number; // -1 down .. 1 up
  boost: boolean;
};

const FISH_SIZE = 1.9;
const FACING_STORAGE_KEY = 'jellyfish-race-fish-facing-v2';

/**
 * Candidate native forward axes for the generated model. `yaw` turns that
 * axis to -Z (the travel direction); `axis`/`headSign` tell the wiggle shader
 * which geometry axis runs head-to-tail and which end is the head.
 * Press F in game to cycle when the model swims the wrong way.
 */
const FACINGS = [
  { name: '-x', yaw: -Math.PI / 2, axis: 'x', headSign: -1 },
  { name: '+x', yaw: Math.PI / 2, axis: 'x', headSign: 1 },
  { name: '+z', yaw: Math.PI, axis: 'z', headSign: 1 },
  { name: '-z', yaw: 0, axis: 'z', headSign: -1 },
] as const;

type WiggleUniforms = {
  uTime: { value: number };
  uAmp: { value: number };
  uWaves: { value: number };
  uAxis: { value: number }; // 0 = body runs along local x, 1 = along local z
  uHead: { value: number }; // head coordinate along that axis
  uInvLen: { value: number }; // headSign / bodyLength
};

/**
 * The player fish. Auto-swims toward -Z; steering moves it inside the soft
 * corridor. Speed blends toward a target cap (base/boost) while jelly bounces
 * push it above the cap and decay back down. The swim look is a traveling
 * S-wave bent through the body in the vertex shader, sped up by swim speed.
 */
export class Fish {
  readonly group = new THREE.Group();
  readonly position = this.group.position;

  speed = SWIM.baseSpeed;
  boostReserve = 1;
  invulnerable = 0;

  private readonly lateralVel = new THREE.Vector2(); // x: lateral, y: vertical
  private modelHolder = new THREE.Group();
  private wiggleUniforms: WiggleUniforms[] = [];
  private modelBounds: { x: { min: number; max: number }; z: { min: number; max: number } } | null =
    null;
  private facingIndex = 0;
  private hasModel = false;
  private wigglePhase = 0;
  private wiggleTime = 0;
  private blockout: THREE.Mesh | null = null;

  constructor() {
    this.group.add(this.modelHolder);
    this.buildBlockout();
    this.position.set(0, 9, 0);
    const stored = FACINGS.findIndex(
      (facing) => facing.name === localStorage.getItem(FACING_STORAGE_KEY),
    );
    if (stored >= 0) this.facingIndex = stored;
  }

  /** Swap the blockout for the Mint-generated clownfish once it is synced. */
  setModel(asset: LoadedAsset): void {
    // Body bounds in the model's own space, for the undulation envelope.
    const box = new THREE.Box3().setFromObject(asset.scene);
    this.modelBounds = {
      x: { min: box.min.x, max: box.max.x },
      z: { min: box.min.z, max: box.max.z },
    };

    this.wiggleUniforms = [];
    asset.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => this.patchMaterial(material));
      } else {
        mesh.material = this.patchMaterial(mesh.material);
      }
    });

    this.group.remove(this.modelHolder);
    this.modelHolder = fitModel(asset.scene, FISH_SIZE);
    this.group.add(this.modelHolder);
    this.blockout = null;
    this.hasModel = true;
    this.applyFacing();
  }

  /** Cycle the model's assumed native forward axis (F key). Persisted. */
  cycleFacing(): void {
    if (!this.hasModel) return;
    this.facingIndex = (this.facingIndex + 1) % FACINGS.length;
    localStorage.setItem(FACING_STORAGE_KEY, FACINGS[this.facingIndex].name);
    this.applyFacing();
  }

  update(delta: number, steer: SteerInput, sting: boolean): void {
    // Forward speed model: target cap from boost state, bounce overshoot decays.
    const boosting = steer.boost && this.boostReserve > 0;
    const cap = boosting ? SWIM.boostSpeed : SWIM.baseSpeed;
    if (this.speed > cap) {
      this.speed = Math.max(cap, this.speed - SWIM.bounceDecay * delta);
    } else {
      this.speed = THREE.MathUtils.damp(this.speed, cap, SWIM.forwardAccel / 4, delta);
    }

    if (boosting) {
      this.boostReserve = Math.max(0, this.boostReserve - delta / SWIM.boostDrainSeconds);
    } else {
      this.boostReserve = Math.min(1, this.boostReserve + delta / SWIM.boostRegenSeconds);
    }

    if (sting) {
      this.speed = SWIM.stingSpeed;
      this.invulnerable = SWIM.stingInvulnSeconds;
    }
    this.invulnerable = Math.max(0, this.invulnerable - delta);

    // Steering: smooth lateral/vertical velocity toward input.
    const steerScale = 0.75 + (this.speed / SWIM.bounceSpeed) * 0.45;
    const targetX = steer.lateral * SWIM.lateralSpeed * steerScale;
    const targetY = steer.vertical * SWIM.verticalSpeed * steerScale;
    const smoothing = 1 - Math.exp(-SWIM.steerAccel * delta);
    this.lateralVel.x += (targetX - this.lateralVel.x) * smoothing;
    this.lateralVel.y += (targetY - this.lateralVel.y) * smoothing;

    this.position.x += this.lateralVel.x * delta;
    this.position.y += this.lateralVel.y * delta;
    this.position.z -= this.speed * delta;

    // Soft corridor: ease back toward bounds instead of hard-stopping.
    const overX = Math.abs(this.position.x) - CORRIDOR.halfWidth;
    if (overX > 0) this.position.x -= Math.sign(this.position.x) * overX * Math.min(1, 6 * delta);
    if (this.position.y < CORRIDOR.minY) {
      this.position.y += (CORRIDOR.minY - this.position.y) * Math.min(1, 6 * delta);
    } else if (this.position.y > CORRIDOR.maxY) {
      this.position.y -= (this.position.y - CORRIDOR.maxY) * Math.min(1, 6 * delta);
    }

    // Orientation: yaw/pitch into travel, bank into turns, gentle idle roll.
    const speedRatio = this.speed / SWIM.baseSpeed;
    this.wiggleTime += delta * (5 + speedRatio * 8);
    const yaw = Math.atan2(-this.lateralVel.x, this.speed);
    const pitch = Math.atan2(this.lateralVel.y, this.speed);
    const roll =
      THREE.MathUtils.clamp(-this.lateralVel.x * 0.06, -0.85, 0.85) +
      Math.sin(this.wiggleTime * 0.45) * 0.045;
    this.group.rotation.y = THREE.MathUtils.damp(this.group.rotation.y, yaw, 13, delta);
    this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, -pitch, 13, delta);
    this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, roll, 10, delta);

    if (this.hasModel) {
      // Traveling body wave: faster and slightly stronger as speed rises.
      for (const uniforms of this.wiggleUniforms) {
        uniforms.uTime.value = this.wiggleTime;
        uniforms.uAmp.value = uniforms.uWaves.value > 0 ? this.waveAmplitude(speedRatio) : 0;
      }
      // Small head sway keeps the whole body alive on top of the mesh wave.
      const facing = FACINGS[this.facingIndex];
      this.modelHolder.rotation.y = facing.yaw + Math.sin(this.wiggleTime) * 0.045;
    } else {
      // Blockout fallback: simple wag until the model lands.
      this.wigglePhase += delta * (6 + speedRatio * 9);
      this.modelHolder.rotation.y = Math.sin(this.wigglePhase) * 0.16;
    }

    // Sting feedback: blink while invulnerable.
    const blink = this.invulnerable > 0 && Math.sin(this.invulnerable * 28) > 0;
    this.modelHolder.visible = !blink;
  }

  /** World position of the tail, where the bubble trail emits. */
  tailPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.set(0, 0, 1.05).applyQuaternion(this.group.quaternion).add(this.position);
  }

  bounce(): void {
    this.speed = SWIM.bounceSpeed;
    this.lateralVel.y = Math.max(this.lateralVel.y, 6.5);
  }

  reset(): void {
    this.position.set(0, 9, 0);
    this.group.rotation.set(0, 0, 0);
    this.lateralVel.set(0, 0);
    this.speed = SWIM.baseSpeed;
    this.boostReserve = 1;
    this.invulnerable = 0;
  }

  private applyFacing(): void {
    const facing = FACINGS[this.facingIndex];
    this.modelHolder.rotation.set(0, facing.yaw, 0);
    if (!this.modelBounds) return;
    const bounds = facing.axis === 'x' ? this.modelBounds.x : this.modelBounds.z;
    const length = Math.max(1e-4, bounds.max - bounds.min);
    const head = facing.headSign > 0 ? bounds.max : bounds.min;
    for (const uniforms of this.wiggleUniforms) {
      uniforms.uAxis.value = facing.axis === 'x' ? 0 : 1;
      uniforms.uHead.value = head;
      uniforms.uInvLen.value = facing.headSign / length;
      uniforms.uAmp.value = this.waveAmplitude(1);
      uniforms.uWaves.value = 1.15;
    }
  }

  private waveAmplitude(speedRatio: number): number {
    if (!this.modelBounds) return 0;
    const facing = FACINGS[this.facingIndex];
    const bounds = facing.axis === 'x' ? this.modelBounds.x : this.modelBounds.z;
    const length = Math.max(1e-4, bounds.max - bounds.min);
    return length * 0.055 * (0.65 + 0.5 * Math.min(speedRatio, 2.2));
  }

  /**
   * Bends the body with a traveling sine wave in the vertex shader: zero at
   * the head, growing toward the tail — the classic fish undulation.
   */
  private patchMaterial(material: THREE.Material): THREE.Material {
    const cloned = material.clone();
    const uniforms: WiggleUniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uWaves: { value: 1.15 },
      uAxis: { value: 0 },
      uHead: { value: 0 },
      uInvLen: { value: 1 },
    };
    this.wiggleUniforms.push(uniforms);
    cloned.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform float uAmp;
          uniform float uWaves;
          uniform float uAxis;
          uniform float uHead;
          uniform float uInvLen;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float bodyCoord = mix(transformed.x, transformed.z, step(0.5, uAxis));
            float tailward = clamp((uHead - bodyCoord) * uInvLen, 0.0, 1.0);
            float wave = sin(tailward * uWaves * 6.28318 - uTime);
            float envelope = 0.1 + 0.9 * tailward * tailward;
            float bend = wave * uAmp * envelope;
            transformed.x += bend * step(0.5, uAxis);
            transformed.z += bend * (1.0 - step(0.5, uAxis));
          }`,
        );
    };
    cloned.customProgramCacheKey = () => 'fish-body-wave';
    return cloned;
  }

  private buildBlockout(): void {
    const geometry = new THREE.CapsuleGeometry(0.42, 0.9, 6, 12);
    geometry.rotateX(Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: '#f27b21', roughness: 0.5 });
    this.blockout = new THREE.Mesh(geometry, material);
    this.modelHolder.add(this.blockout);
  }

  dispose(): void {
    if (this.blockout) {
      this.blockout.geometry.dispose();
      (this.blockout.material as THREE.Material).dispose();
    }
  }
}
