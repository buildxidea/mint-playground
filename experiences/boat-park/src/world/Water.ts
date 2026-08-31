import * as THREE from 'three';

interface Wave {
  dirX: number;
  dirZ: number;
  amplitude: number;
  wavelength: number;
  speed: number;
}

// Same wave sum runs on GPU (vertex displacement) and CPU (buoyancy sampling),
// so boats sit exactly on the rendered surface.
const WAVES: Wave[] = [
  { dirX: 1, dirZ: 0.35, amplitude: 0.22, wavelength: 23, speed: 1.4 },
  { dirX: -0.6, dirZ: 1, amplitude: 0.16, wavelength: 15, speed: 1.9 },
  { dirX: 0.4, dirZ: -1, amplitude: 0.1, wavelength: 8.5, speed: 2.6 },
  { dirX: 1, dirZ: 1, amplitude: 0.34, wavelength: 61, speed: 0.9 },
];

// Shading-only ripples. Their wavelengths are far below the vertex spacing, so
// they exist purely in the fragment normal — they never move the surface and
// never desync the CPU buoyancy sampler from what is drawn.
const DETAIL: Wave[] = [
  { dirX: 0.8, dirZ: 0.6, amplitude: 0.035, wavelength: 5.1, speed: 3.4 },
  { dirX: -0.35, dirZ: 0.94, amplitude: 0.022, wavelength: 3.2, speed: 4.1 },
  { dirX: 0.95, dirZ: -0.3, amplitude: 0.013, wavelength: 1.7, speed: 5.2 },
];

function normalized(waves: Wave[]): Wave[] {
  return waves.map((wave) => {
    const len = Math.hypot(wave.dirX, wave.dirZ);
    return { ...wave, dirX: wave.dirX / len, dirZ: wave.dirZ / len };
  });
}

const NORMALIZED = normalized(WAVES);
const NORMALIZED_DETAIL = normalized(DETAIL);

/** GLSL that accumulates height and surface gradient for a set of waves. */
function waveGlsl(waves: Wave[]): string {
  return waves
    .map((wave) => {
      const k = (Math.PI * 2) / wave.wavelength;
      return `
        {
          vec2 dir = vec2(${wave.dirX.toFixed(5)}, ${wave.dirZ.toFixed(5)});
          float k = ${k.toFixed(6)};
          float a = ${wave.amplitude.toFixed(4)} * intensity;
          float phase = dot(dir, p) * k + t * ${wave.speed.toFixed(3)};
          height += a * sin(phase);
          grad += dir * (a * k * cos(phase));
        }`;
    })
    .join('\n');
}

const WAVE_FUNCTIONS = `
  void sampleSwell(vec2 p, float t, float intensity, out float height, out vec2 grad) {
    height = 0.0;
    grad = vec2(0.0);
    ${waveGlsl(NORMALIZED)}
  }

  void sampleDetail(vec2 p, float t, float intensity, out float height, out vec2 grad) {
    height = 0.0;
    grad = vec2(0.0);
    ${waveGlsl(NORMALIZED_DETAIL)}
  }`;

/**
 * GLSL mirror of {@link Water.heightAt}: the height of the ocean as it is drawn,
 * faceted grid and all. Anything that has to sit flush on the surface — foam,
 * wake, spray — reads it through this, because the smooth wave sum is up to
 * half a metre away from what the player can actually see.
 */
export function waterSurfaceGlsl(gridStep: number): string {
  return `
  ${WAVE_FUNCTIONS}

  float sampleSurface(vec2 p, float t, float intensity) {
    float step = ${gridStep.toFixed(6)};
    vec2 cell = floor(p / step) * step;
    vec2 f = (p - cell) / step;
    float h;
    vec2 g;
    if (f.x + f.y <= 1.0) {
      sampleSwell(cell, t, intensity, h, g);
      float hx; vec2 gx; sampleSwell(cell + vec2(step, 0.0), t, intensity, hx, gx);
      float hz; vec2 gz; sampleSwell(cell + vec2(0.0, step), t, intensity, hz, gz);
      return h + (hx - h) * f.x + (hz - h) * f.y;
    }
    sampleSwell(cell + vec2(step), t, intensity, h, g);
    float hx; vec2 gx; sampleSwell(cell + vec2(0.0, step), t, intensity, hx, gx);
    float hz; vec2 gz; sampleSwell(cell + vec2(step, 0.0), t, intensity, hz, gz);
    return h + (hx - h) * (1.0 - f.x) + (hz - h) * (1.0 - f.y);
  }`;
}

/** A disturbance laid over the ocean that floating things should feel. */
export interface SurfaceDisturbance {
  /** Extra height at a point, in metres. `featureLength` scales hull filtering. */
  heightAt(x: number, z: number, time: number, hullLength: number): number;
  /** Largest height it can currently produce anywhere. */
  maxRelief(): number;
}

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    /** World offset of the plane, so waves stay locked to the world as it follows the boat. */
    uOffset: { value: new THREE.Vector2(0, 0) },
  };
  private intensity = 1;
  /** World-space spacing between vertices; the plane only ever moves in whole steps. */
  readonly gridStep: number;
  /** Wakes and splashes laid over the swell, felt by everything that floats. */
  private readonly disturbances: SurfaceDisturbance[] = [];
  /** Per-wave response by hull length, cached per vessel size. */
  private readonly hullWeights = new Map<number, number[]>();

  constructor(size = 2800, segments = 260) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    this.gridStep = size / segments;

    this.material = new THREE.MeshStandardMaterial({
      color: '#1c4a66',
      roughness: 0.32,
      metalness: 0.04,
      flatShading: false,
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uIntensity = this.uniforms.uIntensity;
      shader.uniforms.uOffset = this.uniforms.uOffset;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform float uIntensity;
           uniform vec2 uOffset;
           varying vec2 vWaveXZ;
           ${WAVE_FUNCTIONS}`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           {
             // Wave phase is world-space, so sliding the plane along with the
             // boat does not drag the swell with it.
             vec2 worldXZ = transformed.xz + uOffset;
             float waveHeight;
             vec2 waveGradient;
             sampleSwell(worldXZ, uTime, uIntensity, waveHeight, waveGradient);
             transformed.y += waveHeight;
             vWaveXZ = worldXZ;
             objectNormal = normalize(vec3(-waveGradient.x, 1.0, -waveGradient.y));
             vNormal = normalize(normalMatrix * objectNormal);
           }`,
        );

      // Vertices sit ~11 m apart, far coarser than the swell they carry, so
      // interpolated vertex normals facet and crawl as the plane scrolls.
      // Re-deriving the gradient per pixel makes the shading smooth and adds
      // ripple detail the geometry could never resolve.
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform float uIntensity;
           varying vec2 vWaveXZ;
           ${WAVE_FUNCTIONS}`,
        )
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
           {
             float swellHeight;
             vec2 swellGrad;
             sampleSwell(vWaveXZ, uTime, uIntensity, swellHeight, swellGrad);
             float detailHeight;
             vec2 detailGrad;
             sampleDetail(vWaveXZ, uTime, uIntensity, detailHeight, detailGrad);

             // Fine slopes alias into sparkle noise once a pixel spans several
             // ripples, so fade them out with distance instead.
             float viewDist = length(vViewPosition);
             float detailFade = 1.0 - smoothstep(40.0, 260.0, viewDist);
             float swellFade = mix(1.0, 0.35, smoothstep(220.0, 1100.0, viewDist));

             vec2 grad = swellGrad * swellFade + detailGrad * detailFade;
             // The plane's world matrix is a pure translation, so the surface
             // normal is already world-space; viewMatrix takes it to view space.
             vec3 worldNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
             normal = normalize(mat3(viewMatrix) * worldNormal);
             nonPerturbedNormal = normal;
           }`,
        );
    };

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.receiveShadow = true;
  }

  /**
   * Recentre the ocean under the boat. The plane is finite, but the course now
   * runs kilometres out, so it follows the player instead of trying to cover
   * the whole world at usable wave resolution. Movement is quantised to the
   * vertex grid: every vertex then stays pinned to the same world position, so
   * the coarse tessellation no longer swims through the swell as the boat runs.
   */
  setCenter(x: number, z: number): void {
    const snappedX = Math.round(x / this.gridStep) * this.gridStep;
    const snappedZ = Math.round(z / this.gridStep) * this.gridStep;
    this.mesh.position.set(snappedX, 0, snappedZ);
    this.uniforms.uOffset.value.set(snappedX, snappedZ);
  }

  setIntensity(value: number): void {
    this.intensity = value;
    this.uniforms.uIntensity.value = value;
  }

  /** Uniforms a surface effect must share to stay in step with the ocean. */
  get sharedUniforms(): { uTime: { value: number }; uIntensity: { value: number } } {
    return this.uniforms;
  }

  /**
   * Register a wake or splash field. Its relief is added to every height query,
   * so buoys, wildlife and moored hulls all ride it without knowing it exists.
   */
  addDisturbance(disturbance: SurfaceDisturbance): void {
    this.disturbances.push(disturbance);
  }

  /** Drop a field whose owner has gone, so height queries stop paying for it. */
  removeDisturbance(disturbance: SurfaceDisturbance): void {
    const at = this.disturbances.indexOf(disturbance);
    if (at >= 0) this.disturbances.splice(at, 1);
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  /** Highest crest the current settings can produce. */
  maxAmplitude(): number {
    return NORMALIZED.reduce((sum, wave) => sum + wave.amplitude, 0) * this.intensity;
  }

  /**
   * Height of the surface as it is actually drawn, used for buoyancy.
   *
   * The vertex grid is far coarser than the swell it carries, so the rendered
   * surface is a faceted approximation that sits up to half a metre off the
   * smooth wave sum. Sampling the smooth sum would float hulls below what the
   * player can see — water inside the boat. So this samples the same grid the
   * GPU displaces and interpolates across the same triangles.
   *
   * Pass `hullLength` to get the surface a hull of that size answers to: a
   * long ship bridges chop shorter than itself instead of tracing it.
   */
  heightAt(x: number, z: number, time: number, hullLength = 0): number {
    const weights = hullLength > 0 ? this.weightsFor(hullLength) : null;
    const step = this.gridStep;
    const cellX = Math.floor(x / step) * step;
    const cellZ = Math.floor(z / step) * step;
    const fx = (x - cellX) / step;
    const fz = (z - cellZ) / step;

    // PlaneGeometry cuts each cell along the diagonal from (0,1) to (1,0);
    // which triangle the point lands in decides the three corners it reads.
    let height: number;
    if (fx + fz <= 1) {
      const corner = this.waveSum(cellX, cellZ, time, weights);
      height =
        corner +
        (this.waveSum(cellX + step, cellZ, time, weights) - corner) * fx +
        (this.waveSum(cellX, cellZ + step, time, weights) - corner) * fz;
    } else {
      const corner = this.waveSum(cellX + step, cellZ + step, time, weights);
      height =
        corner +
        (this.waveSum(cellX, cellZ + step, time, weights) - corner) * (1 - fx) +
        (this.waveSum(cellX + step, cellZ, time, weights) - corner) * (1 - fz);
    }

    // Wake and splash relief is drawn at its own, much finer tessellation, so
    // it rides on top of the grid sample rather than through it.
    for (let i = 0; i < this.disturbances.length; i += 1) {
      height += this.disturbances[i].heightAt(x, z, time, hullLength);
    }
    return height;
  }

  /** Highest the surface can reach above the still waterline, wake included. */
  maxRelief(): number {
    let relief = this.maxAmplitude();
    for (const disturbance of this.disturbances) relief += disturbance.maxRelief();
    return relief;
  }

  /** The GPU's wave sum at one point, optionally weighted per wave. */
  private waveSum(x: number, z: number, time: number, weights: number[] | null): number {
    let height = 0;
    for (let i = 0; i < NORMALIZED.length; i += 1) {
      const weight = weights ? weights[i] : 1;
      if (weight <= 0) continue;
      const wave = NORMALIZED[i];
      const k = (Math.PI * 2) / wave.wavelength;
      const phase = (wave.dirX * x + wave.dirZ * z) * k + time * wave.speed;
      height += wave.amplitude * this.intensity * weight * Math.sin(phase);
    }
    return height;
  }

  /**
   * How much of each wave a hull of this length actually rides. Waves longer
   * than the hull lift it whole; ones much shorter pass under it.
   */
  private weightsFor(hullLength: number): number[] {
    let weights = this.hullWeights.get(hullLength);
    if (!weights) {
      weights = NORMALIZED.map((wave) =>
        THREE.MathUtils.smoothstep(wave.wavelength / hullLength, 0.35, 1),
      );
      this.hullWeights.set(hullLength, weights);
    }
    return weights;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
