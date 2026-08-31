import * as THREE from 'three';
import type { BoatState, BoatTuning } from './BoatPhysics';
import type { WakeEmitter, WaveSystem } from './WaveSystem';

const MAX_SAMPLES = 96;
const MAX_SPRAY_PARTICLES = 128;
const VERTICES_PER_SAMPLE = 2;
const SAMPLE_DISTANCE = 0.32;
const SAMPLE_TURN_COSINE = Math.cos(THREE.MathUtils.degToRad(5));
const FULL_LIFETIME = 5.2;
const REDUCED_LIFETIME = 2.8;
const MIN_FORWARD_SPEED = 0.24;
const SURFACE_OFFSET = 0.018;
const SURFACE_REFRESH_SECONDS = 1 / 15;
const GRAVITY = 9.81;

type WakeDebugMode = 'composite' | 'foam' | 'normal';

export type PlayerWakeDiagnostics = {
  active: boolean;
  emitterSpeed: number;
  sampleCount: number;
  trailLength: number;
  sprayParticles: number;
  froude: number;
};

/**
 * Water-conforming player wake presentation.
 *
 * A pooled world-space sheet stores the committed stern path. Its fragment
 * shader derives prop wash, turbulent aeration, and divergent arms from age,
 * speed, turn rate, and stable world-space noise, avoiding visible ribbon
 * edges. A second pooled points buffer adds restrained event-driven spray.
 */
export class PlayerWakeSystem {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly spray: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  private readonly emitter: WakeEmitter = {
    id: 'player-wake',
    x: 0,
    z: 0,
    dirX: 0,
    dirZ: 1,
    speed: 0,
    strength: 0.64,
    phase: 0.91,
  };

  private readonly positions = new Float32Array(
    MAX_SAMPLES * VERTICES_PER_SAMPLE * 3,
  );
  private readonly wakeData = new Float32Array(
    MAX_SAMPLES * VERTICES_PER_SAMPLE * 4,
  );
  private readonly wakeExtra = new Float32Array(
    MAX_SAMPLES * VERTICES_PER_SAMPLE * 4,
  );
  private readonly indices = new Uint16Array((MAX_SAMPLES - 1) * 6);
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly wakeDataAttribute: THREE.BufferAttribute;
  private readonly wakeExtraAttribute: THREE.BufferAttribute;
  private readonly indexAttribute: THREE.BufferAttribute;

  private readonly sampleX = new Float32Array(MAX_SAMPLES);
  private readonly sampleY = new Float32Array(MAX_SAMPLES);
  private readonly sampleZ = new Float32Array(MAX_SAMPLES);
  private readonly sampleRightX = new Float32Array(MAX_SAMPLES);
  private readonly sampleRightZ = new Float32Array(MAX_SAMPLES);
  private readonly sampleTime = new Float32Array(MAX_SAMPLES);
  private readonly sampleStrength = new Float32Array(MAX_SAMPLES);
  private readonly sampleSpeed = new Float32Array(MAX_SAMPLES);
  private readonly sampleTurn = new Float32Array(MAX_SAMPLES);
  private readonly sampleHalfWidth = new Float32Array(MAX_SAMPLES);
  private readonly sampleHalfLength = new Float32Array(MAX_SAMPLES);
  private readonly distances = new Float32Array(MAX_SAMPLES);

  private readonly particlePositions = new Float32Array(MAX_SPRAY_PARTICLES * 3);
  private readonly particleSizes = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleAlphas = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleX = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleY = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleZ = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleVX = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleVY = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleVZ = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleAge = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleLife = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleBaseSize = new Float32Array(MAX_SPRAY_PARTICLES);
  private readonly particleActive = new Uint8Array(MAX_SPRAY_PARTICLES);
  private readonly particlePositionAttribute: THREE.BufferAttribute;
  private readonly particleSizeAttribute: THREE.BufferAttribute;
  private readonly particleAlphaAttribute: THREE.BufferAttribute;

  private sampleStart = 0;
  private sampleCount = 0;
  private clock = 0;
  private trailLength = 0;
  private surfaceRefresh = 0;
  private lastForwardSpeed = 0;
  private latestFroude = 0;
  private sprayAccumulator = 0;
  private sprayCursor = 0;
  private sprayCount = 0;
  private randomState = 0x8f31a52d;
  private debugMode: WakeDebugMode = 'composite';

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.wakeDataAttribute = new THREE.BufferAttribute(this.wakeData, 4);
    this.wakeExtraAttribute = new THREE.BufferAttribute(this.wakeExtra, 4);
    this.indexAttribute = new THREE.BufferAttribute(this.indices, 1);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.wakeDataAttribute.setUsage(THREE.DynamicDrawUsage);
    this.wakeExtraAttribute.setUsage(THREE.DynamicDrawUsage);
    this.indexAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('wakeData', this.wakeDataAttribute);
    geometry.setAttribute('wakeExtra', this.wakeExtraAttribute);
    geometry.setIndex(this.indexAttribute);
    geometry.setDrawRange(0, 0);

    const material = createWakeMaterial();
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'player-wake-foam-field';
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    const sprayGeometry = new THREE.BufferGeometry();
    this.particlePositionAttribute = new THREE.BufferAttribute(this.particlePositions, 3);
    this.particleSizeAttribute = new THREE.BufferAttribute(this.particleSizes, 1);
    this.particleAlphaAttribute = new THREE.BufferAttribute(this.particleAlphas, 1);
    this.particlePositionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.particleSizeAttribute.setUsage(THREE.DynamicDrawUsage);
    this.particleAlphaAttribute.setUsage(THREE.DynamicDrawUsage);
    sprayGeometry.setAttribute('position', this.particlePositionAttribute);
    sprayGeometry.setAttribute('particleSize', this.particleSizeAttribute);
    sprayGeometry.setAttribute('particleAlpha', this.particleAlphaAttribute);
    sprayGeometry.setDrawRange(0, 0);

    this.spray = new THREE.Points(sprayGeometry, createSprayMaterial());
    this.spray.name = 'player-stern-spray';
    this.spray.renderOrder = 3;
    this.spray.frustumCulled = false;
    this.spray.visible = false;

    this.group.name = 'player-wake-system';
    this.group.add(this.mesh, this.spray);
  }

  getEmitter(): WakeEmitter {
    return this.emitter;
  }

  setDebugMode(mode: WakeDebugMode): void {
    this.debugMode = mode;
    this.mesh.material.uniforms.uDebugMode!.value = mode === 'foam' ? 1 : 0;
    this.mesh.material.visible = mode !== 'normal';
    this.spray.material.visible = mode === 'composite';
  }

  reset(state?: BoatState, tuning?: BoatTuning): void {
    this.clock = 0;
    this.sampleStart = 0;
    this.sampleCount = 0;
    this.trailLength = 0;
    this.surfaceRefresh = 0;
    this.lastForwardSpeed = 0;
    this.latestFroude = 0;
    this.sprayAccumulator = 0;
    this.sprayCursor = 0;
    this.sprayCount = 0;
    this.randomState = 0x8f31a52d;
    this.particleActive.fill(0);
    this.emitter.speed = 0;
    this.emitter.strength = tuning
      ? THREE.MathUtils.clamp(0.5 + tuning.hullHalfWidth * 0.15, 0.58, 0.72)
      : 0.64;
    if (state && tuning) this.syncEmitterPose(state, tuning);
    this.mesh.visible = false;
    this.spray.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
    this.spray.geometry.setDrawRange(0, 0);
  }

  update(
    dt: number,
    waveElapsed: number,
    state: BoatState,
    tuning: BoatTuning,
    waves: WaveSystem,
    reducedMotion: boolean,
    emitting: boolean,
  ): void {
    const safeDt = THREE.MathUtils.clamp(dt, 0, 0.1);
    this.clock += safeDt;
    this.mesh.material.uniforms.uTime!.value = this.clock;
    this.mesh.material.uniforms.uOpacity!.value = reducedMotion ? 0.36 : 0.72;
    this.spray.material.uniforms.uOpacity!.value = reducedMotion ? 0.2 : 0.72;
    this.syncEmitterPose(state, tuning);

    const forwardSpeed = state.vx * this.emitter.dirX + state.vz * this.emitter.dirZ;
    const targetSpeed = emitting && forwardSpeed > MIN_FORWARD_SPEED ? forwardSpeed : 0;
    const response = targetSpeed > this.emitter.speed ? 9 : 4.5;
    this.emitter.speed +=
      (targetSpeed - this.emitter.speed) * (1 - Math.exp(-response * safeDt));
    if (this.emitter.speed < 0.025) this.emitter.speed = 0;

    const hullLength = Math.max(0.5, tuning.hullHalfLength * 2);
    this.latestFroude = Math.max(0, forwardSpeed) / Math.sqrt(GRAVITY * hullLength);

    const lifetime = reducedMotion ? REDUCED_LIFETIME : FULL_LIFETIME;
    this.pruneExpired(lifetime);
    if (targetSpeed > MIN_FORWARD_SPEED) {
      this.recordSample(waveElapsed, state, tuning, waves, targetSpeed);
    }

    this.surfaceRefresh -= safeDt;
    if (this.surfaceRefresh <= 0) {
      this.refreshSurfaceHeights(waveElapsed, waves);
      this.surfaceRefresh = SURFACE_REFRESH_SECONDS;
    }
    this.rebuildGeometry(lifetime);
    this.updateSpray(
      safeDt,
      waveElapsed,
      state,
      tuning,
      waves,
      targetSpeed,
      emitting && !reducedMotion,
    );
    this.lastForwardSpeed = forwardSpeed;
  }

  getDiagnostics(): PlayerWakeDiagnostics {
    return {
      active: this.mesh.visible,
      emitterSpeed: this.emitter.speed,
      sampleCount: this.sampleCount,
      trailLength: this.trailLength,
      sprayParticles: this.sprayCount,
      froude: this.latestFroude,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.spray.geometry.dispose();
    this.spray.material.dispose();
  }

  private syncEmitterPose(state: BoatState, tuning: BoatTuning): void {
    const forwardX = Math.sin(state.yaw);
    const forwardZ = Math.cos(state.yaw);
    const sternOffset = tuning.hullHalfLength * 0.88;
    this.emitter.x = state.x - forwardX * sternOffset;
    this.emitter.z = state.z - forwardZ * sternOffset;
    this.emitter.dirX = forwardX;
    this.emitter.dirZ = forwardZ;
    this.emitter.strength = THREE.MathUtils.clamp(
      0.5 + tuning.hullHalfWidth * 0.15,
      0.58,
      0.72,
    );
  }

  private recordSample(
    waveElapsed: number,
    state: BoatState,
    tuning: BoatTuning,
    waves: WaveSystem,
    forwardSpeed: number,
  ): void {
    const rightX = Math.cos(state.yaw);
    const rightZ = -Math.sin(state.yaw);
    const sternX = this.emitter.x - this.emitter.dirX * 0.08;
    const sternZ = this.emitter.z - this.emitter.dirZ * 0.08;

    if (this.sampleCount > 0) {
      const newest = this.sampleIndex(this.sampleCount - 1);
      const moved = Math.hypot(sternX - this.sampleX[newest]!, sternZ - this.sampleZ[newest]!);
      const headingDot = rightX * this.sampleRightX[newest]! + rightZ * this.sampleRightZ[newest]!;
      if (moved < SAMPLE_DISTANCE && headingDot > SAMPLE_TURN_COSINE) return;
    }

    let index: number;
    if (this.sampleCount < MAX_SAMPLES) {
      index = this.sampleIndex(this.sampleCount);
      this.sampleCount += 1;
    } else {
      this.sampleStart = (this.sampleStart + 1) % MAX_SAMPLES;
      index = this.sampleIndex(this.sampleCount - 1);
    }

    const fullLength = Math.max(0.5, tuning.hullHalfLength * 2);
    const froude = forwardSpeed / Math.sqrt(GRAVITY * fullLength);
    const planing = smoothstep(0.28, 0.72, froude);
    const speedStrength = smoothstep(MIN_FORWARD_SPEED, tuning.maxForwardSpeed * 0.88, forwardSpeed);
    const surface = waves.sampleSurface(waveElapsed, sternX, sternZ);
    this.sampleX[index] = sternX;
    this.sampleY[index] = surface.height + SURFACE_OFFSET;
    this.sampleZ[index] = sternZ;
    this.sampleRightX[index] = rightX;
    this.sampleRightZ[index] = rightZ;
    this.sampleTime[index] = this.clock;
    this.sampleStrength[index] = THREE.MathUtils.clamp(
      0.14 + speedStrength * 0.58 + planing * 0.28,
      0.14,
      1,
    );
    this.sampleSpeed[index] = forwardSpeed;
    this.sampleTurn[index] = THREE.MathUtils.clamp(state.yawRate / 0.75, -1, 1);
    this.sampleHalfWidth[index] = tuning.hullHalfWidth;
    this.sampleHalfLength[index] = tuning.hullHalfLength;
  }

  private pruneExpired(lifetime: number): void {
    while (this.sampleCount > 0) {
      const oldest = this.sampleStart;
      if (this.clock - this.sampleTime[oldest]! <= lifetime) break;
      this.sampleStart = (this.sampleStart + 1) % MAX_SAMPLES;
      this.sampleCount -= 1;
    }
  }

  private refreshSurfaceHeights(waveElapsed: number, waves: WaveSystem): void {
    for (let logical = 0; logical < this.sampleCount; logical += 1) {
      const sample = this.sampleIndex(logical);
      this.sampleY[sample] =
        waves.sampleSurface(waveElapsed, this.sampleX[sample]!, this.sampleZ[sample]!).height +
        SURFACE_OFFSET;
    }
  }

  private rebuildGeometry(lifetime: number): void {
    if (this.sampleCount < 2) {
      this.trailLength = 0;
      this.mesh.visible = false;
      this.mesh.geometry.setDrawRange(0, 0);
      return;
    }

    this.distances[this.sampleCount - 1] = 0;
    let distance = 0;
    for (let logical = this.sampleCount - 2; logical >= 0; logical -= 1) {
      const current = this.sampleIndex(logical);
      const next = this.sampleIndex(logical + 1);
      distance += Math.hypot(
        this.sampleX[next]! - this.sampleX[current]!,
        this.sampleZ[next]! - this.sampleZ[current]!,
      );
      this.distances[logical] = distance;
    }
    this.trailLength = distance;

    for (let logical = 0; logical < this.sampleCount; logical += 1) {
      const sample = this.sampleIndex(logical);
      const age = THREE.MathUtils.clamp(
        (this.clock - this.sampleTime[sample]!) / lifetime,
        0,
        1,
      );
      const behind = this.distances[logical]!;
      const fullLength = Math.max(0.5, this.sampleHalfLength[sample]! * 2);
      const froude = this.sampleSpeed[sample]! / Math.sqrt(GRAVITY * fullLength);
      const planing = smoothstep(0.28, 0.72, froude);
      const apparentHalfAngle = THREE.MathUtils.degToRad(
        THREE.MathUtils.lerp(19.47, 11.5, planing),
      );
      const wakeHalfWidth =
        this.sampleHalfWidth[sample]! * THREE.MathUtils.lerp(0.72, 0.56, planing) +
        Math.min(behind, 26) * Math.tan(apparentHalfAngle);
      const rightX = this.sampleRightX[sample]!;
      const rightZ = this.sampleRightZ[sample]!;
      const vertex = logical * VERTICES_PER_SAMPLE;

      this.writeVertex(
        vertex,
        this.sampleX[sample]! - rightX * wakeHalfWidth,
        this.sampleY[sample]!,
        this.sampleZ[sample]! - rightZ * wakeHalfWidth,
      );
      this.writeVertex(
        vertex + 1,
        this.sampleX[sample]! + rightX * wakeHalfWidth,
        this.sampleY[sample]!,
        this.sampleZ[sample]! + rightZ * wakeHalfWidth,
      );
      this.writeWakeAttributes(vertex, -1, age, sample, behind, wakeHalfWidth);
      this.writeWakeAttributes(vertex + 1, 1, age, sample, behind, wakeHalfWidth);
    }

    let indexCursor = 0;
    for (let logical = 0; logical < this.sampleCount - 1; logical += 1) {
      const base = logical * VERTICES_PER_SAMPLE;
      this.indices[indexCursor++] = base;
      this.indices[indexCursor++] = base + 2;
      this.indices[indexCursor++] = base + 1;
      this.indices[indexCursor++] = base + 1;
      this.indices[indexCursor++] = base + 2;
      this.indices[indexCursor++] = base + 3;
    }

    this.positionAttribute.needsUpdate = true;
    this.wakeDataAttribute.needsUpdate = true;
    this.wakeExtraAttribute.needsUpdate = true;
    this.indexAttribute.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, indexCursor);
    this.mesh.visible = indexCursor > 0 && this.debugMode !== 'normal';
  }

  private updateSpray(
    dt: number,
    waveElapsed: number,
    state: BoatState,
    tuning: BoatTuning,
    waves: WaveSystem,
    forwardSpeed: number,
    emitting: boolean,
  ): void {
    const acceleration = Math.max(0, (forwardSpeed - this.lastForwardSpeed) / Math.max(dt, 1e-4));
    const rate = emitting && forwardSpeed > 1.25
      ? 1.5 + forwardSpeed * 1.35 + acceleration * 0.12 + Math.abs(state.yawRate) * 4.2
      : 0;
    this.sprayAccumulator += rate * dt;
    while (this.sprayAccumulator >= 1) {
      this.sprayAccumulator -= 1;
      this.spawnSprayParticle(waveElapsed, state, tuning, waves, forwardSpeed);
    }

    let visible = 0;
    for (let index = 0; index < MAX_SPRAY_PARTICLES; index += 1) {
      if (!this.particleActive[index]) continue;
      this.particleAge[index] += dt;
      if (this.particleAge[index]! >= this.particleLife[index]!) {
        this.particleActive[index] = 0;
        continue;
      }
      const drag = Math.exp(-2.1 * dt);
      this.particleVX[index] *= drag;
      this.particleVZ[index] *= drag;
      this.particleVY[index] -= 1.25 * dt;
      this.particleX[index] += this.particleVX[index]! * dt;
      this.particleY[index] += this.particleVY[index]! * dt;
      this.particleZ[index] += this.particleVZ[index]! * dt;

      const life = 1 - this.particleAge[index]! / this.particleLife[index]!;
      const offset = visible * 3;
      this.particlePositions[offset] = this.particleX[index]!;
      this.particlePositions[offset + 1] = this.particleY[index]!;
      this.particlePositions[offset + 2] = this.particleZ[index]!;
      this.particleSizes[visible] = this.particleBaseSize[index]! * (0.7 + life * 0.3);
      this.particleAlphas[visible] = smoothstep(0, 0.16, life) * smoothstep(0, 0.18, 1 - life);
      visible += 1;
    }

    this.sprayCount = visible;
    this.particlePositionAttribute.needsUpdate = true;
    this.particleSizeAttribute.needsUpdate = true;
    this.particleAlphaAttribute.needsUpdate = true;
    this.spray.geometry.setDrawRange(0, visible);
    this.spray.visible = visible > 0 && this.debugMode === 'composite';
  }

  private spawnSprayParticle(
    waveElapsed: number,
    state: BoatState,
    tuning: BoatTuning,
    waves: WaveSystem,
    forwardSpeed: number,
  ): void {
    let index = this.sprayCursor;
    for (let attempt = 0; attempt < MAX_SPRAY_PARTICLES; attempt += 1) {
      const candidate = (this.sprayCursor + attempt) % MAX_SPRAY_PARTICLES;
      if (!this.particleActive[candidate]) {
        index = candidate;
        break;
      }
    }
    this.sprayCursor = (index + 1) % MAX_SPRAY_PARTICLES;

    const rightX = Math.cos(state.yaw);
    const rightZ = -Math.sin(state.yaw);
    const lateral = (this.random() - 0.5) * tuning.hullHalfWidth * 1.25;
    const behind = 0.08 + this.random() * 0.28;
    const x = this.emitter.x + rightX * lateral - this.emitter.dirX * behind;
    const z = this.emitter.z + rightZ * lateral - this.emitter.dirZ * behind;
    const surfaceY = waves.sampleSurface(waveElapsed, x, z).height;
    const sideVelocity = (this.random() - 0.5) * (0.45 + Math.abs(state.yawRate) * 0.45);

    this.particleActive[index] = 1;
    this.particleAge[index] = 0;
    this.particleLife[index] = 0.38 + this.random() * 0.42;
    this.particleBaseSize[index] = 8 + this.random() * 8 + Math.min(5, forwardSpeed);
    this.particleX[index] = x;
    this.particleY[index] = surfaceY + 0.035 + this.random() * 0.07;
    this.particleZ[index] = z;
    this.particleVX[index] =
      state.vx * 0.16 - this.emitter.dirX * (0.18 + this.random() * 0.34) + rightX * sideVelocity;
    this.particleVY[index] = 0.18 + this.random() * 0.48;
    this.particleVZ[index] =
      state.vz * 0.16 - this.emitter.dirZ * (0.18 + this.random() * 0.34) + rightZ * sideVelocity;
  }

  private writeVertex(index: number, x: number, y: number, z: number): void {
    const offset = index * 3;
    this.positions[offset] = x;
    this.positions[offset + 1] = y;
    this.positions[offset + 2] = z;
  }

  private writeWakeAttributes(
    vertex: number,
    across: number,
    age: number,
    sample: number,
    behind: number,
    halfWidth: number,
  ): void {
    const dataOffset = vertex * 4;
    this.wakeData[dataOffset] = across;
    this.wakeData[dataOffset + 1] = age;
    this.wakeData[dataOffset + 2] = this.sampleStrength[sample]!;
    this.wakeData[dataOffset + 3] = this.sampleTurn[sample]!;
    this.wakeExtra[dataOffset] = behind;
    this.wakeExtra[dataOffset + 1] = this.sampleSpeed[sample]!;
    this.wakeExtra[dataOffset + 2] = halfWidth;
    this.wakeExtra[dataOffset + 3] = this.sampleHalfWidth[sample]!;
  }

  private sampleIndex(logicalIndex: number): number {
    return (this.sampleStart + logicalIndex) % MAX_SAMPLES;
  }

  private random(): number {
    let value = this.randomState >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0;
    return this.randomState / 0x1_0000_0000;
  }
}

function createWakeMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
      uOpacity: { value: 0.72 },
      uDebugMode: { value: 0 },
    },
    vertexShader: `
      attribute vec4 wakeData;
      attribute vec4 wakeExtra;
      varying vec2 vWakeCoord;
      varying vec2 vWorldXZ;
      varying vec4 vWakeState;
      varying float vWakeWidth;
      #include <fog_pars_vertex>

      void main() {
        vWakeCoord = vec2(wakeData.x, wakeExtra.x);
        vWakeState = vec4(wakeData.y, wakeData.z, wakeData.w, wakeExtra.y);
        vWakeWidth = wakeExtra.z;
        vWorldXZ = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uDebugMode;
      varying vec2 vWakeCoord;
      varying vec2 vWorldXZ;
      varying vec4 vWakeState;
      varying float vWakeWidth;
      #include <common>
      #include <fog_pars_fragment>

      float wakeHash(vec2 value) {
        vec3 p3 = fract(vec3(value.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float wakeNoise(vec2 value) {
        vec2 cell = floor(value);
        vec2 local = fract(value);
        local = local * local * (3.0 - 2.0 * local);
        return mix(
          mix(wakeHash(cell), wakeHash(cell + vec2(1.0, 0.0)), local.x),
          mix(wakeHash(cell + vec2(0.0, 1.0)), wakeHash(cell + vec2(1.0)), local.x),
          local.y
        );
      }

      float wakeFbm(vec2 value) {
        float total = 0.0;
        float amplitude = 0.56;
        mat2 rotateScale = mat2(1.55, 1.18, -1.18, 1.55);
        for (int octave = 0; octave < 4; octave++) {
          total += wakeNoise(value) * amplitude;
          value = rotateScale * value + vec2(7.1, 3.7);
          amplitude *= 0.48;
        }
        return total;
      }

      void main() {
        float across = vWakeCoord.x;
        float absoluteAcross = abs(across);
        float behind = vWakeCoord.y;
        float age = clamp(vWakeState.x, 0.0, 1.0);
        float strength = clamp(vWakeState.y, 0.0, 1.0);
        float turn = clamp(vWakeState.z, -1.0, 1.0);
        float speed = max(vWakeState.w, 0.0);
        float freshness = 1.0 - age;

        vec2 slowFlow = vec2(uTime * 0.055, -uTime * 0.075);
        float coarseNoise = wakeFbm(vWorldXZ * 0.62 + slowFlow);
        float fineNoise = wakeFbm(vWorldXZ * 1.85 - slowFlow * 1.7 + 11.3);
        float cellNoise = wakeNoise(vWorldXZ * 3.6 + vec2(uTime * 0.14, -uTime * 0.22));
        float streaks = 0.5 + 0.5 * sin(
          behind * 3.4 - uTime * (1.4 + min(speed, 6.0) * 0.2) + coarseNoise * 5.2
        );

        float centerSigma = mix(0.3, 0.075, smoothstep(0.05, 0.92, age));
        float propWash = exp(-pow(absoluteAcross / max(centerSigma, 0.02), 2.0));
        propWash *= pow(freshness, 0.62) * smoothstep(0.15, 1.15, speed);

        float armCenter = mix(0.54, 0.84, smoothstep(0.02, 0.9, age));
        float armWidth = mix(0.155, 0.055, age);
        float divergentArms = exp(-pow((absoluteAcross - armCenter) / armWidth, 2.0));
        divergentArms *= smoothstep(0.32, 1.25, behind) * pow(freshness, 0.92);

        float aeratedCoreWidth = mix(0.68, 0.24, age);
        float aeratedCore = exp(-pow(absoluteAcross / aeratedCoreWidth, 4.0));
        aeratedCore *= freshness * freshness * smoothstep(0.4, 2.2, speed) * 0.22;

        float turnBias = clamp(1.0 + sign(across) * turn * 0.38, 0.62, 1.38);
        float baseFoam = propWash * 0.7 + divergentArms * turnBias * 0.78 + aeratedCore;
        float breakup = coarseNoise * 0.58 + fineNoise * 0.29 + cellNoise * 0.13;
        float breakupGate = smoothstep(
          mix(0.34, 0.54, age) - baseFoam * 0.15,
          mix(0.64, 0.79, age),
          breakup
        );
        float filament = mix(0.68, 1.14, smoothstep(0.2, 0.88, streaks));
        float softBoundary = 1.0 - smoothstep(0.84, 0.99, absoluteAcross);
        float foam = baseFoam * mix(0.09, 1.0, breakupGate) * filament * softBoundary;
        foam *= strength * smoothstep(0.0, 0.08, freshness);

        float microBubbles = smoothstep(0.8, 0.98, fineNoise + baseFoam * 0.35);
        foam += microBubbles * aeratedCore * freshness * 0.18;
        float alpha = clamp(foam * uOpacity, 0.0, 0.72);
        if (alpha < 0.012) discard;

        vec3 oldFoam = vec3(0.31, 0.61, 0.66);
        vec3 freshFoam = vec3(0.88, 0.955, 0.93);
        vec3 foamColor = mix(oldFoam, freshFoam, clamp(freshness * 0.66 + foam * 0.4, 0.0, 1.0));
        foamColor *= mix(0.86, 1.045, fineNoise);
        if (uDebugMode > 0.5) {
          foamColor = vec3(alpha);
          alpha = 1.0;
        }

        gl_FragColor = vec4(foamColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
    blending: THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.forceSinglePass = true;
  return material;
}

function createSprayMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uOpacity: { value: 0.72 },
    },
    vertexShader: `
      attribute float particleSize;
      attribute float particleAlpha;
      varying float vParticleAlpha;
      #include <fog_pars_vertex>

      void main() {
        vParticleAlpha = particleAlpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = particleSize * clamp(7.0 / max(-mvPosition.z, 0.1), 0.55, 2.1);
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying float vParticleAlpha;
      #include <fog_pars_fragment>

      void main() {
        vec2 centered = gl_PointCoord - 0.5;
        float radius = length(centered) * 2.0;
        float body = 1.0 - smoothstep(0.35, 1.0, radius);
        float sparkle = 1.0 - smoothstep(0.0, 0.55, length(centered - vec2(-0.12, 0.12)) * 2.0);
        float alpha = body * vParticleAlpha * uOpacity;
        if (alpha < 0.01) discard;
        vec3 color = mix(vec3(0.57, 0.82, 0.84), vec3(0.98), sparkle * 0.45 + body * 0.3);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    toneMapped: true,
    blending: THREE.NormalBlending,
  });
  return material;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const normalized = THREE.MathUtils.clamp((value - edge0) / Math.max(edge1 - edge0, 1e-6), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}
