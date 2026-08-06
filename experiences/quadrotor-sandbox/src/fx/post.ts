import { Scene, Vector2, WebGLRenderer, type PerspectiveCamera } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/**
 * Post-processing stack.
 *
 * Order matters: ambient occlusion works on scene depth so it must run before
 * anything smears the image, bloom needs linear colour so it runs before the
 * output pass tone-maps, and the vignette is a pure screen-space darkening
 * applied last.
 *
 * SSAO defaults **off**. It is the most expensive pass here by a wide margin
 * and its benefit on an outdoor scene lit by a single sun is modest — the
 * contact shadows it adds under the props are nice but not free. It is wired
 * up and one key away rather than silently omitted.
 */

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.06 },
    darkness: { value: 1.15 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * vec2(offset);
      float falloff = smoothstep(0.8, 0.2, dot(uv, uv) * darkness);
      gl_FragColor = vec4(mix(texel.rgb * 0.72, texel.rgb, falloff), texel.a);
    }
  `,
};

export class PostStack {
  readonly composer: EffectComposer;

  private readonly ssao: SSAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly size = new Vector2();

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
  ) {
    renderer.getSize(this.size);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.ssao = new SSAOPass(scene, camera, this.size.x, this.size.y);
    this.ssao.kernelRadius = 0.35;
    this.ssao.minDistance = 0.0015;
    this.ssao.maxDistance = 0.08;
    this.ssao.enabled = false;
    this.composer.addPass(this.ssao);

    // Threshold sits above the sky so only the sun-facing metal and the sensor
    // overlays bloom; a lower threshold makes the whole overcast sky glow.
    this.bloom = new UnrealBloomPass(this.size.clone(), 0.42, 0.7, 0.92);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(VignetteShader));
  }

  get ambientOcclusion() {
    return this.ssao.enabled;
  }

  set ambientOcclusion(enabled: boolean) {
    this.ssao.enabled = enabled;
  }

  get bloomStrength() {
    return this.bloom.strength;
  }

  set bloomStrength(value: number) {
    this.bloom.strength = value;
  }

  resize() {
    this.renderer.getSize(this.size);
    // Mirrors the clamp in `core/engine.ts`: a 0-sized composer target is an
    // incomplete framebuffer and poisons every draw that follows.
    const width = Math.max(1, this.size.x);
    const height = Math.max(1, this.size.y);
    this.composer.setSize(width, height);
    this.ssao.setSize(width, height);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
