import * as THREE from 'three';
import {
  MAX_RENDER_SWELLS,
  MAX_RENDER_WAKES,
  type WaterRenderState,
  type WaveSystem,
} from './WaveSystem';

type UniformValue<T> = { value: T };

type WaterShader = {
  uniforms: Record<string, UniformValue<unknown>>;
  vertexShader: string;
  fragmentShader: string;
};

type WaterUniforms = {
  time: UniformValue<number>;
  envelope: UniformValue<number>;
  energy: UniformValue<number>;
  windDirection: UniformValue<THREE.Vector2>;
  debugMode: UniformValue<number>;
  swells: THREE.Vector4[];
  swellMotion: THREE.Vector4[];
  wakePose: THREE.Vector4[];
  wakeData: THREE.Vector4[];
};

export type WaterDebugMode = 'composite' | 'foam' | 'normal';

/** Dielectric Gerstner water with shared gameplay displacement and wake foam. */
export function createWater(
  halfWidth: number,
  halfDepth: number,
  waves: WaveSystem,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial> {
  const width = halfWidth * 2.4;
  const depth = halfDepth * 2.4;
  const segmentsX = THREE.MathUtils.clamp(Math.ceil(width * 1.75), 64, 96);
  const segmentsZ = THREE.MathUtils.clamp(Math.ceil(depth * 1.75), 64, 96);
  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
  const material = new THREE.MeshPhysicalMaterial({
    color: '#16708c',
    roughness: 0.23,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    ior: 1.333,
    reflectivity: 0.48,
    envMapIntensity: 0.78,
    emissive: '#031923',
    emissiveIntensity: 0.035,
    transparent: false,
    depthWrite: true,
  });
  const water = new THREE.Mesh(geometry, material);
  const uniforms = createUniforms();
  water.userData.waterUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    const typedShader = shader as unknown as WaterShader;
    typedShader.uniforms.uWaterTime = uniforms.time;
    typedShader.uniforms.uWaveEnvelope = uniforms.envelope;
    typedShader.uniforms.uWaveEnergy = uniforms.energy;
    typedShader.uniforms.uWindDirection = uniforms.windDirection;
    typedShader.uniforms.uWaterDebugMode = uniforms.debugMode;
    typedShader.uniforms.uSwells = { value: uniforms.swells };
    typedShader.uniforms.uSwellMotion = { value: uniforms.swellMotion };
    typedShader.uniforms.uWakePose = { value: uniforms.wakePose };
    typedShader.uniforms.uWakeData = { value: uniforms.wakeData };
    typedShader.vertexShader = injectWaterVertex(typedShader.vertexShader);
    typedShader.fragmentShader = injectWaterFragment(typedShader.fragmentShader);
    water.userData.waterShader = typedShader;
  };
  material.customProgramCacheKey = () => 'tiny-boat-gerstner-water-v6';

  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.02;
  water.receiveShadow = true;
  water.name = 'gerstner-water';
  water.userData.segments = { x: segmentsX, z: segmentsZ };
  updateWater(water, 0, false, waves);
  return water;
}

export function updateWater(
  water: THREE.Mesh,
  elapsed: number,
  reducedMotion: boolean,
  waves: WaveSystem,
): void {
  const uniforms = water.userData.waterUniforms as WaterUniforms | undefined;
  if (!uniforms) return;
  const state = waves.getRenderState(reducedMotion ? 0 : elapsed);
  writeUniforms(uniforms, state, reducedMotion);
}

export function setWaterDebugMode(water: THREE.Mesh, mode: WaterDebugMode): void {
  const uniforms = water.userData.waterUniforms as WaterUniforms | undefined;
  if (!uniforms) return;
  uniforms.debugMode.value = mode === 'foam' ? 1 : mode === 'normal' ? 2 : 0;
}

function createUniforms(): WaterUniforms {
  return {
    time: { value: 0 },
    envelope: { value: 1 },
    energy: { value: 0 },
    windDirection: { value: new THREE.Vector2(0, 1) },
    debugMode: { value: 0 },
    swells: Array.from({ length: MAX_RENDER_SWELLS }, () => new THREE.Vector4()),
    swellMotion: Array.from({ length: MAX_RENDER_SWELLS }, () => new THREE.Vector4()),
    wakePose: Array.from({ length: MAX_RENDER_WAKES }, () => new THREE.Vector4()),
    wakeData: Array.from({ length: MAX_RENDER_WAKES }, () => new THREE.Vector4()),
  };
}

function writeUniforms(
  uniforms: WaterUniforms,
  state: WaterRenderState,
  reducedMotion: boolean,
): void {
  uniforms.time.value = state.elapsed;
  uniforms.envelope.value = reducedMotion ? 0.35 : state.envelope;
  uniforms.energy.value = state.energy;
  uniforms.windDirection.value.set(state.windDirection.x, state.windDirection.z).normalize();

  for (let index = 0; index < MAX_RENDER_SWELLS; index += 1) {
    const source = state.swells[index];
    if (!source) {
      uniforms.swells[index]!.set(0, 0, 0, 0);
      uniforms.swellMotion[index]!.set(0, 0, 0, 0);
      continue;
    }
    uniforms.swells[index]!.set(source.dirX, source.dirZ, source.height, source.waveNumber);
    uniforms.swellMotion[index]!.set(source.omega, source.phase, source.steepness, 1);
  }

  for (let index = 0; index < MAX_RENDER_WAKES; index += 1) {
    const source = state.wakes[index];
    if (!source) {
      uniforms.wakePose[index]!.set(0, 0, 0, 0);
      uniforms.wakeData[index]!.set(0, 0, 0, 0);
      continue;
    }
    uniforms.wakePose[index]!.set(source.x, source.z, source.dirX, source.dirZ);
    uniforms.wakeData[index]!.set(
      source.speed,
      reducedMotion ? source.strength * 0.35 : source.strength,
      source.phase,
      source.speed > 0.02 && source.strength > 0 ? 1 : 0,
    );
  }
}

function injectWaterVertex(source: string): string {
  const header = `
uniform float uWaterTime;
uniform float uWaveEnvelope;
uniform float uWaveEnergy;
uniform vec2 uWindDirection;
uniform vec4 uSwells[${MAX_RENDER_SWELLS}];
uniform vec4 uSwellMotion[${MAX_RENDER_SWELLS}];
uniform vec4 uWakePose[${MAX_RENDER_WAKES}];
uniform vec4 uWakeData[${MAX_RENDER_WAKES}];
varying vec2 tinyWaterWorldXZ;
varying vec3 tinyWaterWorldNormal;
varying float tinyWaterFoam;
varying float tinyWaterWake;
varying float tinyWaterRelief;

vec2 tinyBoatWakeField(vec2 worldXZ) {
  float height = 0.0;
  float intensity = 0.0;
  for (int i = 0; i < ${MAX_RENDER_WAKES}; i++) {
    vec4 pose = uWakePose[i];
    vec4 data = uWakeData[i];
    if (data.w < 0.5) continue;
    vec2 rel = worldXZ - pose.xy;
    float behind = -dot(rel, pose.zw);
    if (behind <= 0.0 || behind >= 20.0) continue;
    float lateral = abs(rel.x * pose.w - rel.y * pose.z);
    float speed = clamp(data.x / 2.4, 0.0, 1.15);
    float planing = smoothstep(0.55, 1.12, speed);
    float wakeSlope = mix(0.355, 0.225, planing);
    float ridge = abs(lateral - behind * wakeSlope);
    float onset = 1.0 - exp(-behind * 1.65);
    float divergentEnvelope = onset * exp(-behind * 0.086) * exp(-ridge * mix(1.75, 2.35, planing));
    float washWidth = 0.16 + behind * mix(0.075, 0.045, planing);
    float propWash = exp(-pow(lateral / washWidth, 2.0)) * exp(-behind * 0.19) * onset;
    float local = data.y * speed * divergentEnvelope;
    float wash = data.y * speed * propWash;
    float divergent = sin(behind * 2.35 - uWaterTime * 2.8 + data.z);
    float transverse = sin(behind * 1.08 - uWaterTime * 1.9 + data.z * 0.63);
    float washPulse = sin(behind * 3.7 - uWaterTime * 3.4 + data.z * 1.4);
    height +=
      (divergent * 0.7 + transverse * 0.3) * local * 0.066 +
      washPulse * wash * 0.018 -
      wash * 0.012;
    intensity = max(intensity, max(local, wash * 0.88));
  }
  return vec2(height, clamp(intensity, 0.0, 1.0));
}

void tinyBoatGerstner(
  vec2 parameterXZ,
  out vec3 surface,
  out vec3 tangentX,
  out vec3 tangentZ,
  out float convergence
) {
  surface = vec3(parameterXZ.x, 0.0, parameterXZ.y);
  tangentX = vec3(1.0, 0.0, 0.0);
  tangentZ = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < ${MAX_RENDER_SWELLS}; i++) {
    vec4 swell = uSwells[i];
    vec4 motion = uSwellMotion[i];
    if (motion.w < 0.5) continue;
    float amplitude = swell.z * uWaveEnvelope;
    float horizontalAmplitude = amplitude * motion.z;
    float phase = dot(parameterXZ, swell.xy) * swell.w - uWaterTime * motion.x + motion.y;
    float sine = sin(phase);
    float cosine = cos(phase);
    float horizontalDerivative = horizontalAmplitude * swell.w * sine;
    float verticalDerivative = amplitude * swell.w * cosine;
    surface.xz += swell.xy * horizontalAmplitude * cosine;
    surface.y += amplitude * sine;
    tangentX += vec3(
      -swell.x * swell.x * horizontalDerivative,
      swell.x * verticalDerivative,
      -swell.y * swell.x * horizontalDerivative
    );
    tangentZ += vec3(
      -swell.x * swell.y * horizontalDerivative,
      swell.y * verticalDerivative,
      -swell.y * swell.y * horizontalDerivative
    );
  }
  convergence = clamp(
    (1.0 - (tangentX.x * tangentZ.z - tangentX.z * tangentZ.x)) * 1.45,
    0.0,
    1.0
  );
}

float tinyBoatSwellScale() {
  float energy = 0.0;
  for (int i = 0; i < ${MAX_RENDER_SWELLS}; i++) {
    float height = uSwells[i].z * uWaveEnvelope;
    energy += height * height;
  }
  return max(sqrt(energy), 0.001);
}
`;

  return (
    header +
    source
      .replace(
        '#include <beginnormal_vertex>',
        `vec2 tinyWaterParameter = vec2(position.x, -position.y);
         vec3 tinySurface;
         vec3 tinyTangentX;
         vec3 tinyTangentZ;
         float tinyConvergence;
         tinyBoatGerstner(tinyWaterParameter, tinySurface, tinyTangentX, tinyTangentZ, tinyConvergence);
         vec2 tinyWake = tinyBoatWakeField(tinySurface.xz);
         float tinyWakeStep = 0.2;
         float tinyWakeSlopeX = (
           tinyBoatWakeField(tinySurface.xz + vec2(tinyWakeStep, 0.0)).x -
           tinyWake.x
         ) / tinyWakeStep;
         float tinyWakeSlopeZ = (
           tinyBoatWakeField(tinySurface.xz + vec2(0.0, tinyWakeStep)).x -
           tinyWake.x
         ) / tinyWakeStep;
         vec3 tinyWorldNormal = normalize(cross(tinyTangentZ, tinyTangentX));
         tinyWorldNormal = normalize(vec3(
           tinyWorldNormal.x - tinyWakeSlopeX,
           tinyWorldNormal.y,
           tinyWorldNormal.z - tinyWakeSlopeZ
         ));
         vec3 objectNormal = normalize(vec3(tinyWorldNormal.x, -tinyWorldNormal.z, tinyWorldNormal.y));`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         tinySurface.y += tinyWake.x;
         transformed.x = tinySurface.x;
         transformed.y = -tinySurface.z;
         transformed.z += tinySurface.y;
         tinyWaterWorldXZ = tinySurface.xz;
         tinyWaterWorldNormal = tinyWorldNormal;
         float tinySlope = length(tinyWorldNormal.xz);
         float tinySeaGate = smoothstep(0.55, 1.2, uWaveEnergy);
         tinyWaterFoam = smoothstep(0.93, 1.0, tinyConvergence + tinySlope * 0.03) * tinySeaGate;
         tinyWaterWake = tinyWake.y;
         tinyWaterRelief = clamp(tinySurface.y / tinyBoatSwellScale(), -1.0, 1.0);`,
      )
  );
}

function injectWaterFragment(source: string): string {
  const header = `
uniform float uWaterTime;
uniform float uWaveEnergy;
uniform float uWaterDebugMode;
uniform vec2 uWindDirection;
varying vec2 tinyWaterWorldXZ;
varying vec3 tinyWaterWorldNormal;
varying float tinyWaterFoam;
varying float tinyWaterWake;
varying float tinyWaterRelief;

float tinyWakeHash(vec2 value) {
  vec3 p3 = fract(vec3(value.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float tinyWakeNoise(vec2 value) {
  vec2 cell = floor(value);
  vec2 local = fract(value);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(tinyWakeHash(cell), tinyWakeHash(cell + vec2(1.0, 0.0)), local.x),
    mix(tinyWakeHash(cell + vec2(0.0, 1.0)), tinyWakeHash(cell + vec2(1.0)), local.x),
    local.y
  );
}

float tinyWakeFbm(vec2 value) {
  float total = 0.0;
  float amplitude = 0.58;
  mat2 rotateScale = mat2(1.6, 1.2, -1.2, 1.6);
  for (int octave = 0; octave < 3; octave++) {
    total += tinyWakeNoise(value) * amplitude;
    value = rotateScale * value + vec2(5.7, 9.2);
    amplitude *= 0.47;
  }
  return total;
}
`;

  return (
    header +
    source
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         vec2 tinyWind = normalize(uWindDirection + vec2(0.0001, 0.0));
         vec2 tinyCrossWind = vec2(-tinyWind.y, tinyWind.x);
         float tinyPhaseA = dot(tinyWaterWorldXZ, tinyWind * 4.6 + tinyCrossWind * 0.72) - uWaterTime * 2.15;
         float tinyPhaseB = dot(tinyWaterWorldXZ, tinyCrossWind * 7.4 - tinyWind * 1.15) - uWaterTime * 2.85;
         vec2 tinyGradient =
           (tinyWind * 4.6 + tinyCrossWind * 0.72) * cos(tinyPhaseA) * 0.018 +
           (tinyCrossWind * 7.4 - tinyWind * 1.15) * cos(tinyPhaseB) * 0.009;
         vec3 tinyMicroWorldNormal = normalize(vec3(-tinyGradient.x, 1.0, -tinyGradient.y));
         vec3 tinyMicroViewNormal = normalize(mat3(viewMatrix) * tinyMicroWorldNormal);
         normal = normalize(mix(normal, tinyMicroViewNormal, 0.19));`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float tinyFacing = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
         float tinyFresnel = pow(1.0 - tinyFacing, 4.0);
         vec3 tinyDeep = vec3(0.004, 0.055, 0.078);
         vec3 tinyShallow = vec3(0.015, 0.22, 0.285);
         vec3 tinySky = vec3(0.22, 0.48, 0.58);
         vec3 tinyWaterColor = mix(tinyDeep, tinyShallow, tinyWaterRelief * 0.5 + 0.5);
         tinyWaterColor = mix(tinyWaterColor, tinySky, tinyFresnel * 0.56);
         vec2 tinyWakeFlow = tinyWaterWorldXZ * 0.82 + vec2(uWaterTime * 0.045, -uWaterTime * 0.07);
         float tinyWakeCoarse = tinyWakeFbm(tinyWakeFlow);
         float tinyWakeFine = tinyWakeFbm(tinyWaterWorldXZ * 2.25 - tinyWakeFlow * 0.18 + 17.0);
         float tinyWakeBase = smoothstep(0.025, 0.36, tinyWaterWake);
         float tinyWakeBreakup = smoothstep(
           0.34 - tinyWakeBase * 0.12,
           0.72,
           tinyWakeCoarse * 0.67 + tinyWakeFine * 0.33
         );
         float tinyWakeStrands = 0.72 + 0.28 * sin(
           dot(tinyWaterWorldXZ, vec2(2.3, -1.7)) - uWaterTime * 1.4 + tinyWakeFine * 4.2
         );
         float tinyWakeFoam = tinyWakeBase * mix(0.24, 1.0, tinyWakeBreakup) * tinyWakeStrands;
         float tinyFoamMask = clamp(max(tinyWaterFoam, tinyWakeFoam), 0.0, 1.0);
         vec3 tinyOldFoam = vec3(0.5, 0.78, 0.8);
         vec3 tinyFreshFoam = vec3(0.92, 0.98, 0.97);
         vec3 tinyFoamColor = mix(tinyOldFoam, tinyFreshFoam, smoothstep(0.08, 0.7, tinyFoamMask));
         diffuseColor.rgb = mix(tinyWaterColor, tinyFoamColor, tinyFoamMask * 0.62);
         if (uWaterDebugMode > 1.5) {
           diffuseColor.rgb = normalize(tinyWaterWorldNormal) * 0.5 + 0.5;
         } else if (uWaterDebugMode > 0.5) {
           diffuseColor.rgb = vec3(tinyFoamMask);
         }`,
      )
  );
}
