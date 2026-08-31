import {
  AddEquation,
  ClampToEdgeWrapping,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

/**
 * How many stamps go out in a single instanced draw. Strokes are interpolated
 * so a fast swipe becomes many stamps; anything past this flushes in chunks.
 */
const MAX_STAMPS_PER_DRAW = 512;

const VERTEX_SHADER = /* glsl */ `
attribute vec2 iCenter;
attribute vec2 iSize;
attribute float iRot;
attribute vec3 iColor;
attribute float iAlpha;

uniform vec2 uWallSize;

varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vLocal = position.xy;
  vColor = iColor;
  vAlpha = iAlpha;

  // Rotate in wall metres, not UV, so a non-square wall does not shear the
  // roller footprint. Only the final divide moves us into UV space.
  vec2 p = position.xy * iSize;
  float c = cos(iRot);
  float s = sin(iRot);
  vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 uv = (iCenter + r) / uWallSize;

  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uRound;
uniform float uFeather;

varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  // Rounded-rect signed distance in the stamp's own local space.
  vec2 d = abs(vLocal) - vec2(0.5 - uRound);
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - uRound;
  float a = 1.0 - smoothstep(-uFeather, 0.0, dist);

  // Sleeve nap. Keyed to the across-sleeve coordinate so the streaks stay
  // registered along the whole stroke instead of crawling stamp to stamp.
  float streak = 0.9 + 0.1 * hash11(floor(vLocal.x * 46.0));
  a *= streak * vAlpha;

  if (a <= 0.002) discard;

  // Premultiplied: lets fixed-function blending do a correct "over" composite
  // without a divide, and lets the wall shader read it back with a single mix.
  gl_FragColor = vec4(vColor * a, a);
}
`;

export interface StampInput {
  /** Centre in wall metres, origin at the wall's bottom-left corner. */
  readonly x: number;
  readonly y: number;
  /** Full extents in metres: width across the sleeve, depth along travel. */
  readonly width: number;
  readonly depth: number;
  /** Radians. The sleeve axis is perpendicular to the direction of travel. */
  readonly rotation: number;
  readonly color: Color;
  readonly alpha: number;
}

/**
 * The paint layer for one surface: an RGBA render target holding linear
 * premultiplied paint, written by instanced roller stamps.
 *
 * The target is the only paint state in the game, which is what makes the
 * time-lapse replay a matter of clearing it and re-stamping the log.
 */
export class PaintTarget {
  readonly target: WebGLRenderTarget;

  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;

  private readonly centers = new Float32Array(MAX_STAMPS_PER_DRAW * 2);
  private readonly sizes = new Float32Array(MAX_STAMPS_PER_DRAW * 2);
  private readonly rotations = new Float32Array(MAX_STAMPS_PER_DRAW);
  private readonly colors = new Float32Array(MAX_STAMPS_PER_DRAW * 3);
  private readonly alphas = new Float32Array(MAX_STAMPS_PER_DRAW);

  private readonly centerAttr: InstancedBufferAttribute;
  private readonly sizeAttr: InstancedBufferAttribute;
  private readonly rotationAttr: InstancedBufferAttribute;
  private readonly colorAttr: InstancedBufferAttribute;
  private readonly alphaAttr: InstancedBufferAttribute;

  private pending = 0;
  private dirty = false;

  constructor(
    readonly wallWidth: number,
    readonly wallHeight: number,
    resolution: number,
  ) {
    const aspect = wallHeight / wallWidth;
    const texWidth = resolution;
    const texHeight = Math.max(
      256,
      Math.round((resolution * aspect) / 4) * 4,
    );

    this.target = new WebGLRenderTarget(texWidth, texHeight, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    // The target stores linear premultiplied data, not an sRGB image, so no
    // decode should happen when the wall shader samples it.
    this.target.texture.colorSpace = NoColorSpace;

    const base = new PlaneGeometry(1, 1);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.attributes.position = base.attributes.position;
    this.geometry.attributes.uv = base.attributes.uv;
    this.geometry.attributes.normal = base.attributes.normal;

    this.centerAttr = new InstancedBufferAttribute(this.centers, 2);
    this.sizeAttr = new InstancedBufferAttribute(this.sizes, 2);
    this.rotationAttr = new InstancedBufferAttribute(this.rotations, 1);
    this.colorAttr = new InstancedBufferAttribute(this.colors, 3);
    this.alphaAttr = new InstancedBufferAttribute(this.alphas, 1);
    this.centerAttr.setUsage(DynamicDrawUsage);
    this.sizeAttr.setUsage(DynamicDrawUsage);
    this.rotationAttr.setUsage(DynamicDrawUsage);
    this.colorAttr.setUsage(DynamicDrawUsage);
    this.alphaAttr.setUsage(DynamicDrawUsage);

    this.geometry.setAttribute('iCenter', this.centerAttr);
    this.geometry.setAttribute('iSize', this.sizeAttr);
    this.geometry.setAttribute('iRot', this.rotationAttr);
    this.geometry.setAttribute('iColor', this.colorAttr);
    this.geometry.setAttribute('iAlpha', this.alphaAttr);
    this.geometry.instanceCount = 0;

    this.material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uWallSize: { value: new Vector2(wallWidth, wallHeight) },
        uRound: { value: 0.26 },
        uFeather: { value: 0.13 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    base.dispose();
  }

  get texture() {
    return this.target.texture;
  }

  /** Queue one stamp. Call `flush` once per frame to actually draw them. */
  queue(stamp: StampInput): void {
    if (this.pending >= MAX_STAMPS_PER_DRAW) return;
    const i = this.pending;
    this.centers[i * 2] = stamp.x;
    this.centers[i * 2 + 1] = stamp.y;
    this.sizes[i * 2] = stamp.width;
    this.sizes[i * 2 + 1] = stamp.depth;
    this.rotations[i] = stamp.rotation;
    this.colors[i * 3] = stamp.color.r;
    this.colors[i * 3 + 1] = stamp.color.g;
    this.colors[i * 3 + 2] = stamp.color.b;
    this.alphas[i] = stamp.alpha;
    this.pending += 1;
    this.dirty = true;
  }

  get queued(): number {
    return this.pending;
  }

  /** Whether the target has room for more stamps this frame. */
  get hasRoom(): boolean {
    return this.pending < MAX_STAMPS_PER_DRAW;
  }

  flush(renderer: WebGLRenderer): void {
    if (!this.dirty || this.pending === 0) {
      this.pending = 0;
      return;
    }

    this.centerAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.rotationAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.geometry.instanceCount = this.pending;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;

    this.pending = 0;
    this.dirty = false;
  }

  clear(renderer: WebGLRenderer): void {
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new Color());
    const previousAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);

    this.pending = 0;
    this.dirty = false;
  }

  dispose(): void {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
