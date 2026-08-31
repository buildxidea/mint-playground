import * as THREE from 'three';
import type { Bounds } from './YardGeometry';

const STAMP_VERTEX = /* glsl */ `
  varying vec2 vMask;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vMask = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const STAMP_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vMask;
  uniform vec2 uMaskMin;
  uniform vec2 uMaskSize;
  uniform vec2 uFrom;
  uniform vec2 uTo;
  uniform vec2 uDir;
  uniform float uRadius;

  void main() {
    vec2 world = uMaskMin + vMask * uMaskSize;
    vec2 ab = uTo - uFrom;
    float lengthSq = dot(ab, ab);
    float t = lengthSq > 1e-9 ? clamp(dot(world - uFrom, ab) / lengthSq, 0.0, 1.0) : 0.0;
    vec2 closest = uFrom + ab * t;
    if (distance(world, closest) > uRadius) discard;
    gl_FragColor = vec4(1.0, uDir * 0.5 + 0.5, 1.0);
  }
`;

/**
 * The lawn's visual state, as one texture.
 *
 * R = cut (0 shaggy, 1 cut). G/B = the direction the mower was travelling when
 * it cut, remapped to 0..1. That direction is the whole reason stripes exist:
 * grass laid toward the sun reads pale, grass laid away reads dark.
 *
 * The target is never cleared during a level, so each pass paints on top of the
 * last and the newest pass owns the lay direction.
 */
export class LawnMask {
  readonly target: THREE.WebGLRenderTarget;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private readonly quad: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly bounds: Bounds;

  constructor(bounds: Bounds, resolution = 1024) {
    this.bounds = bounds;
    this.target = new THREE.WebGLRenderTarget(resolution, resolution, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.target.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.material = new THREE.ShaderMaterial({
      vertexShader: STAMP_VERTEX,
      fragmentShader: STAMP_FRAGMENT,
      uniforms: {
        uMaskMin: { value: new THREE.Vector2(bounds.minX, bounds.minZ) },
        uMaskSize: { value: new THREE.Vector2(bounds.width, bounds.depth) },
        uFrom: { value: new THREE.Vector2() },
        uTo: { value: new THREE.Vector2() },
        uDir: { value: new THREE.Vector2(0, 1) },
        uRadius: { value: 0.6 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: THREE.NoBlending,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** Wipes the lawn back to fully overgrown. */
  clear(renderer: THREE.WebGLRenderer): void {
    const previousTarget = renderer.getRenderTarget();
    const previousClear = new THREE.Color();
    renderer.getClearColor(previousClear);
    const previousAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(this.target);
    // G/B of 0.5 decodes to a zero lay direction.
    renderer.setClearColor(new THREE.Color(0, 0.5, 0.5), 1);
    renderer.clear(true, false, false);
    renderer.setClearColor(previousClear, previousAlpha);
    renderer.setRenderTarget(previousTarget);
  }

  /**
   * Paint the deck's swept footprint from one simulation step into the mask.
   * `dirX`/`dirZ` is the mower's heading, which becomes the lay direction.
   */
  stamp(
    renderer: THREE.WebGLRenderer,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    dirX: number,
    dirZ: number,
    radius: number,
  ): void {
    const uniforms = this.material.uniforms;
    uniforms.uFrom.value.set(fromX, fromZ);
    uniforms.uTo.value.set(toX, toZ);
    uniforms.uDir.value.set(dirX, dirZ);
    uniforms.uRadius.value = radius;

    // Cover only the swept capsule's bounding box, in normalized mask space.
    const pad = radius + this.bounds.width / 512;
    const minX = Math.min(fromX, toX) - pad;
    const maxX = Math.max(fromX, toX) + pad;
    const minZ = Math.min(fromZ, toZ) - pad;
    const maxZ = Math.max(fromZ, toZ) + pad;

    const u0 = (minX - this.bounds.minX) / this.bounds.width;
    const u1 = (maxX - this.bounds.minX) / this.bounds.width;
    const v0 = (minZ - this.bounds.minZ) / this.bounds.depth;
    const v1 = (maxZ - this.bounds.minZ) / this.bounds.depth;

    this.quad.position.set((u0 + u1) / 2, (v0 + v1) / 2, 0);
    this.quad.scale.set(Math.max(1e-4, u1 - u0), Math.max(1e-4, v1 - v0), 1);
    this.quad.updateMatrixWorld(true);

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
