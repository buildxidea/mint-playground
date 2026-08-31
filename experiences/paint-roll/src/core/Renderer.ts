import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

/**
 * Owns the WebGL context, sizing, and tone mapping. Nothing else in the game
 * touches renderer configuration.
 */
export class RendererHost {
  readonly renderer: WebGLRenderer;
  private width = 1;
  private height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // The paint target is written between frames, so the drawing buffer must
      // survive; letting the browser clear it would flicker the composite.
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.resize();
  }

  get aspect(): number {
    return this.width / this.height;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  resize(): boolean {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    if (width === this.width && height === this.height) return false;

    this.width = width;
    this.height = height;
    // Cap DPR: a 2048-wide paint target plus a 3x backing store is a lot of
    // fill rate for no visible gain.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    return true;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
