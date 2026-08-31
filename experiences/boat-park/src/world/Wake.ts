import * as THREE from 'three';
import { waterSurfaceGlsl, type SurfaceDisturbance, type Water } from './Water';

/**
 * The V a hull leaves behind it.
 *
 * A moving hull throws a circular wavelet every instant, and because it outruns
 * them the envelope of those circles is a wedge trailing astern at a fixed
 * 19.47° — the Kelvin angle, the same for a dinghy and an aircraft carrier.
 * Rather than sum wavelets, this lays a ribbon of geometry along the path the
 * boat actually took and shapes it in that ribbon's own coordinates: `age`
 * running astern, `u` running across. The wedge, the breaking arms along its
 * edges and the churned trail down the middle all fall out of those two
 * numbers, and the ribbon follows a turning boat for free.
 *
 * The same profile is evaluated on the GPU for drawing and here on the CPU for
 * {@link heightAt}, so anything afloat rides the wake it can see.
 */

/** tan(19.47°): how fast the wedge opens out behind the hull. */
const KELVIN = 0.3536;
/** The ribbon runs past the envelope, so the arm crest sits inboard of its edge. */
const OVERHANG = 1.3;
const ARM_U = 1 / OVERHANG;

/** Seconds of trail held. At 30 m/s that is most of a kilometre astern. */
const LIFE = 18;
/** Path samples per second, and how many are kept. */
const SAMPLE_HZ = 12;
const ROWS = Math.ceil(LIFE * SAMPLE_HZ);
/** Vertices across the ribbon. Odd, so one of them rides the centreline. */
const CROSS = 15;

/** Below this the hull is only nudging the water and leaves nothing behind. */
const MIN_SPEED = 1.2;

export const FOAM_NOISE = `
  float foamHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float foamNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(foamHash(i), foamHash(i + vec2(1.0, 0.0)), w.x),
      mix(foamHash(i + vec2(0.0, 1.0)), foamHash(i + vec2(1.0, 1.0)), w.x),
      w.y
    );
  }

  float foamFbm(vec2 p) {
    return foamNoise(p) * 0.6 + foamNoise(p * 2.3 + 17.0) * 0.29 + foamNoise(p * 5.7 + 43.0) * 0.11;
  }`;

/** Ribbon-space profile of the wake. Mirrored by the CPU functions below. */
const WAKE_PROFILE = `
  const float KELVIN = ${KELVIN};
  const float OVERHANG = ${OVERHANG};
  const float ARM_U = ${ARM_U.toFixed(6)};
  const float LIFE = ${LIFE.toFixed(1)};

  float wakeHalfWidth(float age, float speed, float beam) {
    return max(beam * 0.8, KELVIN * speed * age) * OVERHANG;
  }

  float wakeRelief(float age, float u, float speed, float beam) {
    float halfWidth = wakeHalfWidth(age, speed, beam);
    float across = abs(u);

    // The breaking crest riding the edge of the wedge.
    float arm = exp(-pow((across - ARM_U) / 0.15, 2.0));
    // Transverse crests strung between the arms — the herringbone inside the V.
    float transverse = sin((age * 0.9 - u * u * 0.4) * 6.2831853) * smoothstep(1.0, 0.5, across);
    // The churned trail. It holds the hull's own width in metres, so in ribbon
    // coordinates it pinches to nothing as the wedge opens.
    float middleU = clamp(beam * 1.1 / max(halfWidth, 0.001), 0.03, 1.0);
    float middle = exp(-pow(u / middleU, 2.0));

    float size = min(0.45, 0.17 * sqrt(beam));
    float way = clamp(speed / 12.0, 0.0, 1.0);
    // Nothing right at the stern: the hull is standing there.
    float born = smoothstep(0.0, 0.4, age);
    float spent = exp(-age / 6.0) * (1.0 - smoothstep(LIFE * 0.7, LIFE, age));

    return size * way * born * spent * (arm * 1.25 + transverse * 0.15 + middle * 0.6);
  }

  float wakeFoam(float age, float u, float speed, float beam, vec2 world) {
    float halfWidth = wakeHalfWidth(age, speed, beam);
    float across = abs(u);

    // Two things, with open water between them: the wash boiling astern, and
    // the wake — the arms riding the edge of the wedge.
    //
    // The arms hold a width in metres rather than a share of the wedge, so as
    // the V opens they stay lines instead of smearing out with it. They are
    // allowed to thicken slowly with age, or the far end goes sub-pixel and
    // crawls.
    float armU = clamp((beam * 1.2 + age * 0.8) / max(halfWidth, 0.001), 0.02, 0.5);
    float arm = exp(-pow((across - ARM_U) / armU, 2.0));
    float middleU = clamp(beam * 0.8 / max(halfWidth, 0.001), 0.02, 0.9);
    float middle = exp(-pow(u / middleU, 2.0));

    // Long striations combed out along the path — the streaks a torn wake
    // leaves — over patchy aeration read in world space, so the patches hold
    // still as the boat runs on through them.
    float streak =
      foamNoise(vec2(u * 7.0, age * 0.7)) * 0.6 + foamNoise(vec2(u * 19.0, age * 1.9)) * 0.4;
    float grain = foamFbm(world * 0.3);
    float broken = smoothstep(0.4, 0.68, grain * 0.5 + streak * 0.5);

    // The wash is violent and short-lived over a longer, softer tail.
    float wash = middle * (exp(-age / 1.1) * 1.5 + exp(-age / 6.5) * 0.45);
    // The wake carries the whole length of the trail, only softening with
    // distance — that reach is what lets the V read as a V. It is also torn up
    // far less than the wash, so it stays a line rather than a dashed one.
    float crest = arm * mix(1.15, 0.5, smoothstep(0.0, LIFE * 0.85, age));

    float mass = wash * mix(0.18, 1.1, broken) + crest * mix(0.6, 1.15, broken);
    float born = smoothstep(0.0, 0.1, age);
    float spent = 1.0 - smoothstep(LIFE * 0.72, LIFE, age);
    float edge = 1.0 - smoothstep(0.9, 1.0, across);
    float way = clamp((speed - ${MIN_SPEED.toFixed(1)}) / 6.0, 0.0, 1.0);
    return clamp(mass, 0.0, 0.95) * born * spent * edge * way;
  }`;

interface WakeNode {
  x: number;
  z: number;
  /** Unit vector across the path, to port. */
  sideX: number;
  sideZ: number;
  birth: number;
  speed: number;
}

export class Wake implements SurfaceDisturbance {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly path = new Float32Array(ROWS * CROSS * 3);
  private readonly side = new Float32Array(ROWS * CROSS * 2);
  private readonly born = new Float32Array(ROWS * CROSS * 2);
  /** One entry per row, newest last — the CPU's copy for height queries. */
  private readonly nodes: WakeNode[] = [];
  private sinceSample = 0;
  private beam = 2;
  private time = 0;
  private minX = Infinity;
  private maxX = -Infinity;
  private minZ = Infinity;
  private maxZ = -Infinity;

  constructor(private readonly water: Water) {
    this.geometry = new THREE.BufferGeometry();
    const across = new Float32Array(ROWS * CROSS);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < CROSS; col += 1) {
        across[row * CROSS + col] = (col / (CROSS - 1)) * 2 - 1;
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.path, 3));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(this.side, 2));
    this.geometry.setAttribute('aBorn', new THREE.BufferAttribute(this.born, 2));
    this.geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));

    const indices = new Uint32Array((ROWS - 1) * (CROSS - 1) * 6);
    let at = 0;
    for (let row = 0; row < ROWS - 1; row += 1) {
      for (let col = 0; col < CROSS - 1; col += 1) {
        const a = row * CROSS + col;
        const b = a + CROSS;
        indices[at++] = a;
        indices[at++] = b;
        indices[at++] = a + 1;
        indices[at++] = b;
        indices[at++] = b + 1;
        indices[at++] = a + 1;
      }
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uIntensity: { value: 1 },
          uBeam: { value: 2 },
          uCeiling: { value: 1e9 },
          uSun: { value: new THREE.Vector3(-120, 180, 90).normalize() },
          uLit: { value: new THREE.Color('#ffffff') },
          uShade: { value: new THREE.Color('#a8c4d2') },
        },
      ]),
      vertexShader: `
        attribute vec2 aSide;
        attribute vec2 aBorn;
        attribute float aAcross;

        uniform float uTime;
        uniform float uIntensity;
        uniform float uBeam;
        uniform float uCeiling;

        varying vec3 vSurfaceNormal;
        varying vec2 vWorld;
        varying vec3 vRibbon;

        #include <fog_pars_vertex>

        ${waterSurfaceGlsl(water.gridStep)}
        ${FOAM_NOISE}
        ${WAKE_PROFILE}

        void main() {
          float age = max(uTime - aBorn.x, 0.0);
          float speed = aBorn.y;
          float halfWidth = wakeHalfWidth(age, speed, uBeam);
          vec2 world = position.xz + aSide * (aAcross * halfWidth);

          float relief = wakeRelief(age, aAcross, speed, uBeam);
          // Sits on the ocean as it is drawn, faceting included, then a hair
          // above so foam never sinks through the surface it belongs to.
          // Never above the dock deck, whatever the swell and the crest add
          // up to: foam drawn over the planking reads as a flooded pier.
          float height = min(sampleSurface(world, uTime, uIntensity) + relief + 0.05, uCeiling);

          // Slope of the wake, by finite difference in ribbon coordinates, plus
          // the slope of the water carrying it.
          float du = 0.04;
          float da = 0.15;
          float dLat =
            (wakeRelief(age, aAcross + du, speed, uBeam) -
             wakeRelief(age, aAcross - du, speed, uBeam)) /
            (2.0 * du * max(halfWidth, 0.5));
          float dAlong =
            (wakeRelief(age + da, aAcross, speed, uBeam) -
             wakeRelief(max(age - da, 0.0), aAcross, speed, uBeam)) /
            (2.0 * da * max(speed, 1.0));
          vec2 ahead = vec2(-aSide.y, aSide.x);
          vec2 slope = aSide * dLat - ahead * dAlong;

          float swellHeight;
          vec2 swellSlope;
          sampleSwell(world, uTime, uIntensity, swellHeight, swellSlope);
          slope += swellSlope;

          vSurfaceNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
          // Foam is resolved per pixel: a ribbon fifteen vertices across cannot
          // carry grain this fine, and interpolating it just smears it away.
          vWorld = world;
          vRibbon = vec3(age, aAcross, speed);

          vec4 mvPosition = modelViewMatrix * vec4(world.x, height, world.y, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #ifdef USE_FOG
            vFogDepth = -mvPosition.z;
          #endif
        }`,
      fragmentShader: `
        uniform vec3 uSun;
        uniform vec3 uLit;
        uniform vec3 uShade;
        uniform float uBeam;

        varying vec3 vSurfaceNormal;
        varying vec2 vWorld;
        varying vec3 vRibbon;

        #include <fog_pars_fragment>

        ${FOAM_NOISE}
        ${WAKE_PROFILE}

        void main() {
          float foam = wakeFoam(vRibbon.x, vRibbon.y, vRibbon.z, uBeam, vWorld);
          if (foam <= 0.01) discard;
          float lambert = clamp(dot(normalize(vSurfaceNormal), normalize(uSun)), 0.0, 1.0);
          vec3 colour = mix(uShade, uLit, lambert * 0.7 + 0.3);
          gl_FragColor = vec4(colour, clamp(foam, 0.0, 1.0));
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    // Rows carry the path point, not the drawn point, so the bounds three would
    // compute are meaningless — and the wake is always near the camera anyway.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    water.addDisturbance(this);
  }

  /** Bind the wake to the hull leaving it. */
  configure(beam: number): void {
    this.beam = beam;
    this.material.uniforms.uBeam.value = beam;
  }

  /** Highest this foam may ever be drawn, in world units. */
  setCeiling(height: number): void {
    this.material.uniforms.uCeiling.value = height;
  }

  /** Clear the trail — a respawn or a level change should not drag one along. */
  reset(): void {
    this.nodes.length = 0;
    this.sinceSample = 0;
    this.path.fill(0);
    this.side.fill(0);
    this.born.fill(0);
    this.mesh.visible = false;
    this.minX = Infinity;
    this.maxX = -Infinity;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
  }

  /**
   * Lay another length of wake. `x, z` is the stern, `heading` the way the bow
   * points, `speed` the way on. The newest row tracks the hull every frame so
   * the foam stays welded to the transom between samples.
   */
  update(delta: number, time: number, x: number, z: number, heading: number, speed: number): void {
    this.time = time;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uIntensity.value = this.water.sharedUniforms.uIntensity.value;

    const making = Math.abs(speed) > MIN_SPEED;
    if (making) {
      const sideX = Math.cos(heading);
      const sideZ = -Math.sin(heading);
      const node: WakeNode = { x, z, sideX, sideZ, birth: time, speed: Math.abs(speed) };

      this.sinceSample += delta;
      if (this.nodes.length === 0 || this.sinceSample >= 1 / SAMPLE_HZ) {
        this.sinceSample = 0;
        this.pushRow(node);
      } else {
        this.writeRow(ROWS - 1, node);
        this.nodes[this.nodes.length - 1] = node;
      }
    }

    // A trail left behind fades on its own: `wakeFoam` and `wakeRelief` both
    // run out at LIFE, and the ring holds exactly that many rows.
    this.mesh.visible = this.nodes.length > 1;
    if (this.mesh.visible) {
      const quads = (CROSS - 1) * 6;
      this.geometry.setDrawRange((ROWS - this.nodes.length) * quads, (this.nodes.length - 1) * quads);
      this.updateBounds();
    }
  }

  /**
   * Height the wake adds at a point — the CPU mirror of `wakeRelief`. Finding
   * the nearest bit of path is enough: the ribbon is narrow compared with how
   * far apart its rows are laid.
   */
  heightAt(x: number, z: number, time: number, hullLength: number): number {
    const count = this.nodes.length;
    if (count < 2) return 0;
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return 0;

    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < count; i += 1) {
      const node = this.nodes[i];
      const dx = x - node.x;
      const dz = z - node.z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best < 0) return 0;

    const node = this.nodes[best];
    const age = time - node.birth;
    if (age < 0 || age > LIFE) return 0;
    const halfWidth = wakeHalfWidth(age, node.speed, this.beam);
    const across = ((x - node.x) * node.sideX + (z - node.z) * node.sideZ) / halfWidth;
    if (Math.abs(across) >= 1) return 0;

    return wakeRelief(age, across, node.speed, this.beam) * this.hullResponse(hullLength);
  }

  maxRelief(): number {
    return Math.min(0.45, 0.17 * Math.sqrt(this.beam)) * 2.0;
  }

  dispose(): void {
    this.water.removeDisturbance(this);
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * A hull only answers a wake whose crests are long next to itself, the same
   * way it answers the swell — a container ship does not rock to a dinghy.
   */
  private hullResponse(hullLength: number): number {
    if (hullLength <= 0) return 1;
    return THREE.MathUtils.smoothstep((this.beam * 4) / hullLength, 0.35, 1);
  }

  private pushRow(node: WakeNode): void {
    const stride3 = CROSS * 3;
    const stride2 = CROSS * 2;
    this.path.copyWithin(0, stride3);
    this.side.copyWithin(0, stride2);
    this.born.copyWithin(0, stride2);
    this.writeRow(ROWS - 1, node);
    this.nodes.push(node);
    if (this.nodes.length > ROWS) this.nodes.shift();
  }

  private writeRow(row: number, node: WakeNode): void {
    const base3 = row * CROSS * 3;
    const base2 = row * CROSS * 2;
    for (let col = 0; col < CROSS; col += 1) {
      const p = base3 + col * 3;
      this.path[p] = node.x;
      this.path[p + 1] = 0;
      this.path[p + 2] = node.z;
      const s = base2 + col * 2;
      this.side[s] = node.sideX;
      this.side[s + 1] = node.sideZ;
      this.born[s] = node.birth;
      this.born[s + 1] = node.speed;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aSide').needsUpdate = true;
    this.geometry.getAttribute('aBorn').needsUpdate = true;
  }

  private updateBounds(): void {
    this.minX = Infinity;
    this.maxX = -Infinity;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
    for (const node of this.nodes) {
      const age = this.time - node.birth;
      if (age > LIFE) continue;
      const reach = wakeHalfWidth(age, node.speed, this.beam);
      if (node.x - reach < this.minX) this.minX = node.x - reach;
      if (node.x + reach > this.maxX) this.maxX = node.x + reach;
      if (node.z - reach < this.minZ) this.minZ = node.z - reach;
      if (node.z + reach > this.maxZ) this.maxZ = node.z + reach;
    }
  }
}

/** CPU mirror of the GLSL of the same name. Keep the two in step. */
function wakeHalfWidth(age: number, speed: number, beam: number): number {
  return Math.max(beam * 0.8, KELVIN * speed * age) * OVERHANG;
}

/** CPU mirror of the GLSL of the same name. Keep the two in step. */
function wakeRelief(age: number, u: number, speed: number, beam: number): number {
  const halfWidth = wakeHalfWidth(age, speed, beam);
  const across = Math.abs(u);

  const arm = Math.exp(-(((across - ARM_U) / 0.15) ** 2));
  const transverse =
    Math.sin((age * 0.9 - u * u * 0.4) * Math.PI * 2) *
    (1 - THREE.MathUtils.smoothstep(across, 0.5, 1));
  const middleU = THREE.MathUtils.clamp((beam * 1.1) / Math.max(halfWidth, 0.001), 0.03, 1);
  const middle = Math.exp(-((u / middleU) ** 2));

  const size = Math.min(0.45, 0.17 * Math.sqrt(beam));
  const way = THREE.MathUtils.clamp(speed / 12, 0, 1);
  const born = THREE.MathUtils.smoothstep(age, 0, 0.4);
  const spent = Math.exp(-age / 6) * (1 - THREE.MathUtils.smoothstep(age, LIFE * 0.7, LIFE));

  return size * way * born * spent * (arm * 1.25 + transverse * 0.15 + middle * 0.6);
}
