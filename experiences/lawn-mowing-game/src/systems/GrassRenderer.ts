import * as THREE from 'three';
import type { Level } from '../game/levels';
import type { YardGeometry } from './YardGeometry';

export type GrassSettings = {
  bladesPerSquareMeter: number;
  tallHeight: number;
  cutHeight: number;
  layStrength: number;
};

export const DEFAULT_GRASS: GrassSettings = {
  bladesPerSquareMeter: 240,
  tallHeight: 0.55,
  cutHeight: 0.13,
  layStrength: 0.92,
};

/**
 * Shared lawn lighting.
 *
 * `bend` is the horizontal direction the grass is laid in. Tilting the surface
 * normal against it is the entire stripe effect: lanes mown in opposite
 * directions catch the fixed sun differently, so they read pale and dark.
 */
const LAWN_LIGHTING = /* glsl */ `
  vec3 lawnNormal(vec2 bend) {
    return normalize(vec3(-bend.x, 1.0, -bend.y));
  }

  float lawnLight(vec2 bend, vec3 sunDir) {
    float lambert = max(dot(lawnNormal(bend), sunDir), 0.0);
    // Low ambient, high directional: the stripe IS this contrast, so the
    // directional term has to dominate.
    return 0.28 + 1.02 * lambert;
  }
`;

const GRASS_VERTEX = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec4 aParams;

  uniform sampler2D uMask;
  uniform vec2 uMaskMin;
  uniform vec2 uMaskSize;
  uniform float uTallHeight;
  uniform float uCutHeight;
  uniform float uLayStrength;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uCutColor;
  uniform vec3 uTallColor;
  uniform vec2 uMowerPos;
  uniform vec2 uMowerDir;
  uniform float uMowerRadius;

  varying vec3 vColor;

  ${LAWN_LIGHTING}

  void main() {
    vec2 maskUv = (aOffset.xz - uMaskMin) / uMaskSize;
    vec4 mask = texture2D(uMask, maskUv);
    float cut = mask.r;
    vec2 layDir = mask.gb * 2.0 - 1.0;

    float rot = aParams.x;
    float heightScale = aParams.y;
    float hueVar = aParams.z;
    float phase = aParams.w;

    float height = mix(uTallHeight, uCutHeight, cut) * heightScale;

    // Tall grass sways; cut grass lies still, which sells the contrast.
    float wind = sin(uTime * 1.7 + aOffset.x * 0.4 + aOffset.z * 0.3 + phase) * 0.14;
    vec2 bend = vec2(wind, wind * 0.45) * (1.0 - cut);
    bend += layDir * uLayStrength * cut;

    // Uncut grass bows just before the deck reaches it.
    float toMower = distance(aOffset.xz, uMowerPos);
    float bow = (1.0 - cut) * smoothstep(uMowerRadius + 1.0, uMowerRadius + 0.15, toMower);
    bend += uMowerDir * 0.55 * bow;

    float c = cos(rot);
    float s = sin(rot);
    float ny = position.y;
    vec3 local = vec3(position.x * c, ny * height, position.x * s);
    local.xz += bend * ny * ny * height;

    vec3 world = aOffset + local;

    float light = lawnLight(bend, uSunDir);
    float ao = mix(0.55, 1.0, ny);
    vec3 base = mix(uTallColor, uCutColor, cut) * (0.86 + 0.28 * hueVar);
    vColor = base * light * ao;

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const GRASS_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FLOOR_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FLOOR_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;

  uniform sampler2D uMask;
  uniform vec2 uMaskMin;
  uniform vec2 uMaskSize;
  uniform vec3 uSunDir;
  uniform vec3 uCutColor;
  uniform vec3 uTallColor;
  uniform float uLayStrength;

  ${LAWN_LIGHTING}

  void main() {
    vec2 maskUv = (vWorld.xz - uMaskMin) / uMaskSize;
    vec4 mask = texture2D(uMask, maskUv);
    float cut = mask.r;
    vec2 layDir = mask.gb * 2.0 - 1.0;
    vec2 bend = layDir * uLayStrength * cut;

    float light = lawnLight(bend, uSunDir);
    vec3 base = mix(uTallColor * 0.5, uCutColor * 0.72, cut);
    gl_FragColor = vec4(base * light, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Draws the lawn: an instanced field of blades plus a floor that reads the same
 * mask, so the stripes stay legible in the gaps between blades.
 */
export class GrassRenderer {
  readonly group = new THREE.Group();

  private readonly bladeMaterial: THREE.ShaderMaterial;
  private readonly floorMaterial: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly bladeGeometry: THREE.PlaneGeometry;
  private readonly floorGeometries: THREE.PlaneGeometry[] = [];

  readonly bladeCount: number;

  constructor(
    level: Level,
    yard: YardGeometry,
    maskTexture: THREE.Texture,
    sunDirection: THREE.Vector3,
    random: () => number,
    settings: GrassSettings = DEFAULT_GRASS,
  ) {
    const maskMin = new THREE.Vector2(yard.maskBounds.minX, yard.maskBounds.minZ);
    const maskSize = new THREE.Vector2(yard.maskBounds.width, yard.maskBounds.depth);
    // Real stripes are one colour lit two ways. Keep cut and uncut grass close
    // in hue so the lay-direction lighting carries the pattern, not the tint.
    const cutColor = new THREE.Color('#74a63f');
    const tallColor = new THREE.Color('#5d8b36');

    const sharedUniforms = {
      uMask: { value: maskTexture },
      uMaskMin: { value: maskMin },
      uMaskSize: { value: maskSize },
      uSunDir: { value: sunDirection.clone().normalize() },
      uCutColor: { value: cutColor },
      uTallColor: { value: tallColor },
    };

    this.bladeMaterial = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERTEX,
      fragmentShader: GRASS_FRAGMENT,
      uniforms: {
        ...sharedUniforms,
        uTallHeight: { value: settings.tallHeight },
        uCutHeight: { value: settings.cutHeight },
        uLayStrength: { value: settings.layStrength },
        uTime: { value: 0 },
        uMowerPos: { value: new THREE.Vector2(1e6, 1e6) },
        uMowerDir: { value: new THREE.Vector2(0, 1) },
        uMowerRadius: { value: 0.7 },
      },
      side: THREE.DoubleSide,
    });

    this.floorMaterial = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERTEX,
      fragmentShader: FLOOR_FRAGMENT,
      uniforms: {
        ...sharedUniforms,
        uLayStrength: { value: settings.layStrength },
      },
    });

    // Floor: one plane per yard rectangle, sampling the same mask.
    for (const rect of level.yard) {
      const geometry = new THREE.PlaneGeometry(rect.w, rect.d, 1, 1);
      this.floorGeometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, this.floorMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(rect.x, 0.002, rect.z);
      this.group.add(mesh);
    }

    // Blades: jittered grid, only where the yard is actually mowable.
    this.bladeGeometry = new THREE.PlaneGeometry(0.055, 1, 1, 3);
    this.bladeGeometry.translate(0, 0.5, 0);

    const area = level.yard.reduce((sum, rect) => sum + rect.w * rect.d, 0);
    const wanted = Math.floor(area * settings.bladesPerSquareMeter);
    const spacing = Math.sqrt(area / Math.max(1, wanted));
    const offsets: number[] = [];
    const params: number[] = [];

    const bounds = yard.bounds;
    for (let z = bounds.minZ; z < bounds.maxZ; z += spacing) {
      for (let x = bounds.minX; x < bounds.maxX; x += spacing) {
        const px = x + (random() - 0.5) * spacing * 1.6;
        const pz = z + (random() - 0.5) * spacing * 1.6;
        if (!yard.isMowable(px, pz)) continue;
        offsets.push(px, 0, pz);
        params.push(
          random() * Math.PI,
          0.72 + random() * 0.56,
          random(),
          random() * Math.PI * 2,
        );
      }
    }

    this.bladeCount = offsets.length / 3;

    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = this.bladeGeometry.index;
    this.geometry.attributes.position = this.bladeGeometry.attributes.position;
    this.geometry.attributes.uv = this.bladeGeometry.attributes.uv;
    this.geometry.instanceCount = this.bladeCount;
    this.geometry.setAttribute(
      'aOffset',
      new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3),
    );
    this.geometry.setAttribute(
      'aParams',
      new THREE.InstancedBufferAttribute(new Float32Array(params), 4),
    );
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(bounds.centerX, 0, bounds.centerZ),
      Math.hypot(bounds.width, bounds.depth),
    );

    const blades = new THREE.Mesh(this.geometry, this.bladeMaterial);
    blades.frustumCulled = false;
    this.group.add(blades);
  }

  update(
    time: number,
    mowerX: number,
    mowerZ: number,
    dirX: number,
    dirZ: number,
    deckRadius: number,
  ): void {
    const uniforms = this.bladeMaterial.uniforms;
    uniforms.uTime.value = time;
    uniforms.uMowerPos.value.set(mowerX, mowerZ);
    uniforms.uMowerDir.value.set(dirX, dirZ);
    uniforms.uMowerRadius.value = deckRadius;
  }

  dispose(): void {
    this.bladeMaterial.dispose();
    this.floorMaterial.dispose();
    this.geometry.dispose();
    this.bladeGeometry.dispose();
    for (const geometry of this.floorGeometries) geometry.dispose();
  }
}
