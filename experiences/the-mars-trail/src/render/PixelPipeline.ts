/**
 * Low-resolution render pipeline for THE MARS TRAIL.
 *
 * The scene renders into a small nearest-filtered buffer, gets a chunky bloom
 * pass at that resolution, then upscales through `RetroShader`. Rendering small
 * and scaling up is what turns Mint's 3D models into crisp sprites with real
 * volume and animation weight, instead of hand-drawn sprites approximating 3D.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RetroShader } from './RetroShader';

/**
 * Default internal buffer height. This is the resolution the palette clamp,
 * dither grid, and 2px scanlines were tuned against; the player can raise it
 * for a sharper picture through display settings.
 */
const DEFAULT_INTERNAL_HEIGHT = 1080;

/** Buffer height the retro treatment was authored against. */
const RETRO_REFERENCE_HEIGHT = 270;

/**
 * Widest aspect the buffer will cover before it stops growing, so an ultrawide
 * window cannot blow up the render target. Scales with the chosen height
 * rather than being a fixed pixel count.
 */
const MAX_ASPECT = 2.85;

/** Luminance a pixel must clear before it blooms, unless a scene overrides it. */
const DEFAULT_BLOOM_THRESHOLD = 0.72;

export interface PixelPipelineOptions {
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
}

export class PixelPipeline {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly retroPass: ShaderPass;
  private readonly internalSize = new THREE.Vector2(480, DEFAULT_INTERNAL_HEIGHT);
  private internalHeight = DEFAULT_INTERNAL_HEIGHT;
  /** Last canvas size seen, so a height change can recompute width itself. */
  private lastCanvas = { width: 1280, height: 720 };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    options: PixelPipelineOptions = {},
  ) {
    // A nearest-filtered target is the whole trick: the upscale must not
    // interpolate, or the result is a blurry small render rather than pixel art.
    const target = new THREE.WebGLRenderTarget(this.internalSize.x, this.internalSize.y, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(1);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      this.internalSize.clone(),
      options.bloomStrength ?? 0.42,
      options.bloomRadius ?? 0.5,
      options.bloomThreshold ?? DEFAULT_BLOOM_THRESHOLD,
    );
    this.composer.addPass(this.bloomPass);

    this.retroPass = new ShaderPass(RetroShader);
    this.retroPass.renderToScreen = true;
    this.composer.addPass(this.retroPass);

    this.applyInternalSize();
  }

  /** Swap the rendered scene and camera without rebuilding the pipeline. */
  setSceneAndCamera(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  /** Toggle the unlockable monochrome CRT filter. */
  setPhosphor(enabled: boolean): void {
    this.retroPass.uniforms.uPhosphor.value = enabled ? 1 : 0;
  }

  get phosphorEnabled(): boolean {
    return this.retroPass.uniforms.uPhosphor.value > 0.5;
  }

  /** 0 disables posterisation, 1 is the authored look. */
  setPaletteStrength(value: number): void {
    this.retroPass.uniforms.uPaletteStrength.value = THREE.MathUtils.clamp(value, 0, 1);
  }

  /** Overall scene brightness. 1 is the raw render; the authored look is 1.45. */
  setExposure(value: number): void {
    this.retroPass.uniforms.uExposure.value = THREE.MathUtils.clamp(value, 0.2, 4);
  }

  get exposure(): number {
    return this.retroPass.uniforms.uExposure.value as number;
  }

  setBloomStrength(value: number): void {
    this.bloomPass.strength = value;
  }

  /** Raise to stop merely-white surfaces haloing while hot ones still glow. */
  setBloomThreshold(value: number): void {
    this.bloomPass.threshold = THREE.MathUtils.clamp(value, 0, 1);
  }

  /** Put bloom back to whatever the current retro setting asks for. */
  restoreBloom(): void {
    this.bloomPass.strength = this.retroEnabled ? 0.42 : 0.28;
    this.bloomPass.threshold = DEFAULT_BLOOM_THRESHOLD;
  }

  /**
   * Change the pixelation level. Lower is chunkier; the authored look is 270.
   * The width is recomputed from the last known canvas aspect.
   */
  setInternalHeight(height: number): void {
    const clamped = Math.max(120, Math.min(1080, Math.round(height / 2) * 2));
    if (clamped === this.internalHeight) return;
    this.internalHeight = clamped;
    this.recomputeSize();
  }

  get internalHeightSetting(): number {
    return this.internalHeight;
  }

  /** Recompute the internal buffer from the canvas aspect ratio. */
  resize(canvasWidth: number, canvasHeight: number): void {
    this.lastCanvas = { width: canvasWidth, height: Math.max(1, canvasHeight) };
    this.recomputeSize();
  }

  private recomputeSize(): void {
    const aspect = Math.min(MAX_ASPECT, this.lastCanvas.width / this.lastCanvas.height);
    // Keep the buffer width even so the 4x4 dither and 2px scanlines tile cleanly.
    const width = Math.round((this.internalHeight * aspect) / 2) * 2;
    if (width === this.internalSize.x && this.internalHeight === this.internalSize.y) return;
    this.internalSize.set(width, this.internalHeight);
    this.applyInternalSize();
  }

  private applyInternalSize(): void {
    this.composer.setSize(this.internalSize.x, this.internalSize.y);
    this.bloomPass.setSize(this.internalSize.x, this.internalSize.y);
    this.retroPass.uniforms.uResolution.value.copy(this.internalSize);
    // Keep one retro cell the same apparent size at every buffer height.
    this.retroPass.uniforms.uRetroCell.value = Math.max(
      1,
      Math.round(this.internalSize.y / RETRO_REFERENCE_HEIGHT),
    );
  }

  /**
   * Turn the authored retro treatment on or off. Off is the modern look: no
   * palette clamp, no dither, no scanlines, just the grade and a light vignette.
   */
  setRetro(enabled: boolean): void {
    this.retroPass.uniforms.uPaletteStrength.value = enabled ? 1 : 0;
    this.retroPass.uniforms.uScanline.value = enabled ? 0.09 : 0;
    this.retroPass.uniforms.uVignette.value = enabled ? 0.16 : 0.1;
    this.bloomPass.strength = enabled ? 0.42 : 0.28;
  }

  get retroEnabled(): boolean {
    return this.retroPass.uniforms.uPaletteStrength.value > 0.5;
  }

  render(): void {
    this.composer.render();
  }

  /** Internal buffer size, surfaced for diagnostics and QA evidence. */
  get bufferSize(): { width: number; height: number } {
    return { width: this.internalSize.x, height: this.internalSize.y };
  }

  dispose(): void {
    this.bloomPass.dispose();
    this.retroPass.dispose?.();
    this.composer.dispose();
    // The renderer is owned by the caller; only pipeline resources are freed.
    void this.renderer;
  }
}
