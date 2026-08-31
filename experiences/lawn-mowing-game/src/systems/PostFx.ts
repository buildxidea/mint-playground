import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Separable blur whose strength ramps up away from a horizontal focus band.
 * This is what makes the yard read as a tabletop model rather than a location.
 */
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDirection: { value: new THREE.Vector2(1, 0) },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uFocusCenter: { value: 0.52 },
    uFocusWidth: { value: 0.22 },
    uStrength: { value: 2.6 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uDirection;
    uniform vec2 uTexel;
    uniform float uFocusCenter;
    uniform float uFocusWidth;
    uniform float uStrength;

    void main() {
      float distanceFromFocus = abs(vUv.y - uFocusCenter);
      float blur = smoothstep(uFocusWidth, uFocusWidth + 0.34, distanceFromFocus) * uStrength;

      if (blur < 0.01) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 step = uDirection * uTexel * blur;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.204164;
      sum += texture2D(tDiffuse, vUv + step * 1.407333) * 0.304005;
      sum += texture2D(tDiffuse, vUv - step * 1.407333) * 0.304005;
      sum += texture2D(tDiffuse, vUv + step * 3.294215) * 0.093913;
      sum += texture2D(tDiffuse, vUv - step * 3.294215) * 0.093913;
      gl_FragColor = sum;
    }
  `,
};

/** Final grade: a little extra saturation and a soft vignette. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSaturation: { value: 1.18 },
    uVignette: { value: 0.26 },
  },
  vertexShader: TiltShiftShader.vertexShader,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uVignette;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luma), color.rgb, uSaturation);

      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - uVignette * dot(centered, centered) * 2.6;
      color.rgb *= clamp(vignette, 0.0, 1.0);

      gl_FragColor = color;
    }
  `,
};

export class PostFx {
  enabled = true;

  private readonly composer: EffectComposer;
  private readonly horizontal: ShaderPass;
  private readonly vertical: ShaderPass;
  private readonly grade: ShaderPass;
  private readonly target: THREE.WebGLRenderTarget;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    // Materials already write display-referred colour, so the composer works in
    // sRGB and no OutputPass is needed.
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      samples: 4,
    });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;

    this.composer = new EffectComposer(renderer, this.target);
    this.composer.addPass(new RenderPass(scene, camera));

    this.horizontal = new ShaderPass(TiltShiftShader);
    this.vertical = new ShaderPass(TiltShiftShader);
    this.vertical.uniforms.uDirection.value = new THREE.Vector2(0, 1);
    this.grade = new ShaderPass(GradeShader);
    this.grade.renderToScreen = true;

    this.composer.addPass(this.horizontal);
    this.composer.addPass(this.vertical);
    this.composer.addPass(this.grade);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    const texel = new THREE.Vector2(1 / Math.max(1, width), 1 / Math.max(1, height));
    this.horizontal.uniforms.uTexel.value.copy(texel);
    this.vertical.uniforms.uTexel.value.copy(texel);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.enabled) {
      this.renderer.render(scene, camera);
      return;
    }
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.target.dispose();
  }
}
