import {
  ACESFilmicToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
  type WebGLRenderTarget,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * Sole owner of the renderer, scene, camera, animation frame, resize handling
 * and teardown. Nothing else in the app constructs a renderer or starts a
 * frame loop.
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  /**
   * Reflection probe for metallic surfaces.
   *
   * Deliberately *not* installed as `scene.environment`. Doing that lights
   * every material in the world — the ground, the city, the terrain all pick
   * up its irradiance and the whole scene washes out. This is handed to the
   * aircraft materials individually instead, so only the metal that needs
   * something to reflect gets it and the world is left exactly as it was.
   */
  readonly environmentMap: Texture;

  private readonly environmentTarget: WebGLRenderTarget;

  private frameHandle = 0;
  private onFrame: ((nowSeconds: number) => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;

    // Something for metal to reflect.
    //
    // Every generated airframe arrives as `metalness: 1` with the real values
    // in a metalness *map*, which is correct — but a metallic surface has no
    // diffuse response at all, it only mirrors its surroundings. With no
    // environment there is nothing to mirror, so anything the map marks as
    // genuinely metal renders black. Most of the fleet hides this because most
    // of their texels are dielectric; a bare stainless rocket does not, and
    // showed up on the pad as a silhouette.
    //
    // A neutral room rather than a sky texture: it costs nothing to ship, and
    // the sun and sky already do all the directional lighting.
    const pmrem = new PMREMGenerator(this.renderer);
    this.environmentTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.environmentMap = this.environmentTarget.texture;
    pmrem.dispose();

    this.camera = new PerspectiveCamera(60, 1, 0.05, 2000);
    this.camera.position.set(0, 2, 5);

    this.resize();
    window.addEventListener("resize", this.resize);
  }

  start(onFrame: (nowSeconds: number) => void) {
    this.onFrame = onFrame;
    const tick = (nowMs: number) => {
      this.frameHandle = requestAnimationFrame(tick);
      this.onFrame?.(nowMs / 1000);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  stop() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    this.environmentTarget.dispose();
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
  }

  private resize = () => {
    // Never size to zero. A hidden container (or a tab that starts in the
    // background) reports a 0x0 canvas, and a 0-sized framebuffer is
    // incomplete — every subsequent draw raises INVALID_FRAMEBUFFER_OPERATION
    // until something resizes it. Clamping costs nothing and keeps the
    // renderer valid until real dimensions arrive.
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);

    // Cap DPR: a 5-inch quad on a 4K display does not need 3x supersampling.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);

    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  };
}
