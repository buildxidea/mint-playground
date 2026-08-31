import * as THREE from 'three';
import { FOAM_NOISE } from './Wake';
import { waterSurfaceGlsl, type Water } from './Water';

/**
 * Foam thrown up where something strikes the water — a hull scraping a buoy, a
 * grounding, a boat settling into its berth.
 *
 * One mesh holds the whole pool: each burst owns a fan of vertices that the
 * shader blows outward from its centre, so spawning one costs a few array
 * writes rather than a draw call. It shares the wake's foam grain, so a splash
 * and the trail it lands in are visibly the same water.
 */

const POOL = 24;
const RINGS = 7;
const SEGMENTS = 20;
const PER_BURST = RINGS * SEGMENTS;
const LIFE = 1.5;

export class Splashes {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly burst = new Float32Array(POOL * PER_BURST * 4);
  private next = 0;

  constructor(private readonly water: Water) {
    this.geometry = new THREE.BufferGeometry();
    const polar = new Float32Array(POOL * PER_BURST * 2);
    const position = new Float32Array(POOL * PER_BURST * 3);
    for (let i = 0; i < POOL * PER_BURST; i += 1) {
      const ring = Math.floor((i % PER_BURST) / SEGMENTS);
      const segment = (i % PER_BURST) % SEGMENTS;
      polar[i * 2] = ring / (RINGS - 1);
      polar[i * 2 + 1] = (segment / SEGMENTS) * Math.PI * 2;
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    this.geometry.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
    this.geometry.setAttribute('aBurst', new THREE.BufferAttribute(this.burst, 4));

    const quads = (RINGS - 1) * SEGMENTS;
    const indices = new Uint32Array(POOL * quads * 6);
    let at = 0;
    for (let b = 0; b < POOL; b += 1) {
      const base = b * PER_BURST;
      for (let ring = 0; ring < RINGS - 1; ring += 1) {
        for (let segment = 0; segment < SEGMENTS; segment += 1) {
          const next = (segment + 1) % SEGMENTS;
          const a = base + ring * SEGMENTS + segment;
          const d = base + ring * SEGMENTS + next;
          const e = a + SEGMENTS;
          const f = d + SEGMENTS;
          indices[at++] = a;
          indices[at++] = e;
          indices[at++] = d;
          indices[at++] = d;
          indices[at++] = e;
          indices[at++] = f;
        }
      }
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uIntensity: { value: 1 },
          uCeiling: { value: 1e9 },
          uLit: { value: new THREE.Color('#ffffff') },
          uShade: { value: new THREE.Color('#b6cedb') },
        },
      ]),
      vertexShader: `
        attribute vec2 aPolar;
        attribute vec4 aBurst;

        uniform float uTime;
        uniform float uIntensity;
        uniform float uCeiling;

        varying vec3 vBurst;
        varying vec2 vWorld;

        #include <fog_pars_vertex>

        ${waterSurfaceGlsl(water.gridStep)}
        ${FOAM_NOISE}

        void main() {
          float life = ${LIFE.toFixed(2)};
          float age = uTime - aBurst.z;
          float progress = clamp(age / life, 0.0, 1.0);
          float scale = aBurst.w;

          // A burst that has run its course collapses to a point and is culled
          // by the discard below rather than left drawing a stale disc.
          float alive = step(0.0, age) * step(age, life) * step(0.0001, scale);

          float radius = aPolar.x;
          float angle = aPolar.y;
          vec2 dir = vec2(cos(angle), sin(angle));

          // Ragged rim: the same value noise the wake foam uses, so the two
          // effects break up the same way.
          float ragged = 0.75 + 0.5 * foamNoise(vec2(angle * 2.4, aBurst.z * 3.1));
          float spread = scale * (0.45 + progress * 1.7) * ragged;
          vec2 world = aBurst.xy + dir * (radius * spread) * alive;

          // Water thrown up on impact, dropping back as it spreads. Capped in
          // metres, not scaled with the hull: a ship ten times the size of a
          // dinghy does not throw foam ten times as high, and unbounded it
          // stood metres proud of the dock and up the hull's own side.
          float bloom = (1.0 - radius) * exp(-progress * 3.5) * min(scale * 0.22, 0.5);
          float height = min(sampleSurface(world, uTime, uIntensity) + bloom + 0.06, uCeiling);

          // Shape and grain are resolved per pixel; the fan is far too coarse
          // to carry either.
          vBurst = vec3(radius, progress, alive);
          vWorld = world;

          vec4 mvPosition = modelViewMatrix * vec4(world.x, height, world.y, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #ifdef USE_FOG
            vFogDepth = -mvPosition.z;
          #endif
        }`,
      fragmentShader: `
        uniform vec3 uLit;
        uniform vec3 uShade;

        varying vec3 vBurst;
        varying vec2 vWorld;

        #include <fog_pars_fragment>

        ${FOAM_NOISE}

        void main() {
          float radius = vBurst.x;
          float progress = vBurst.y;

          float rim = smoothstep(0.2, 0.9, radius) * (1.0 - smoothstep(0.88, 1.0, radius));
          float core = (1.0 - smoothstep(0.0, 0.7, radius)) * exp(-progress * 4.0);
          float grain = foamFbm(vWorld * 0.9);
          float broken = smoothstep(0.32, 0.72, grain);

          float foam =
            vBurst.z * (rim * 1.1 + core * 0.85) * (1.0 - progress) * mix(0.25, 1.15, broken);
          if (foam <= 0.02) discard;
          gl_FragColor = vec4(mix(uShade, uLit, clamp(foam, 0.0, 1.0)), clamp(foam, 0.0, 1.0));
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Throw a burst of foam at a point. `radius` is the size of whatever hit. */
  spawn(x: number, z: number, radius: number, time: number): void {
    const slot = this.next % POOL;
    this.next += 1;
    const base = slot * PER_BURST * 4;
    for (let i = 0; i < PER_BURST; i += 1) {
      const at = base + i * 4;
      this.burst[at] = x;
      this.burst[at + 1] = z;
      this.burst[at + 2] = time;
      this.burst[at + 3] = radius;
    }
    this.geometry.getAttribute('aBurst').needsUpdate = true;
  }

  /** Highest this foam may ever be drawn, in world units. */
  setCeiling(height: number): void {
    this.material.uniforms.uCeiling.value = height;
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uIntensity.value = this.water.sharedUniforms.uIntensity.value;
  }

  /** Drop every burst in flight, for a respawn or a level change. */
  reset(): void {
    this.burst.fill(0);
    this.geometry.getAttribute('aBurst').needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
