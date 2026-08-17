import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/**
 * Single film-grade pass: tint, mono mix, saturation, animated grain,
 * vignette. Kept as one pass so the whole grade lerps as a unit per era.
 */
const GradeShader = {
  name: "SolvaneGradeShader",
  uniforms: {
    tDiffuse: { value: null },
    tint: { value: new THREE.Color(1, 1, 1) },
    tintAmount: { value: 0 },
    mono: { value: 0 },
    saturation: { value: 1 },
    grain: { value: 0 },
    vignette: { value: 0.3 },
    contrast: { value: 1.12 },
    time: { value: 0 },
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
    uniform vec3 tint;
    uniform float tintAmount;
    uniform float mono;
    uniform float saturation;
    uniform float grain;
    uniform float vignette;
    uniform float contrast;
    uniform float time;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));

      // saturation
      color.rgb = mix(vec3(luma), color.rgb, saturation);
      // monochrome mix (keeps the tint pass useful for sepia)
      color.rgb = mix(color.rgb, vec3(luma), mono);
      // tint toward era color, luma-preserving-ish
      color.rgb = mix(color.rgb, color.rgb * tint * 1.35, tintAmount);
      // contrast around mid grey: deepens shadows, keeps color off the white point
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;
      color.rgb = max(color.rgb, vec3(0.0));
      // animated grain
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(time) * 43.0) - 0.5;
      color.rgb += g * grain * 0.35;
      // vignette
      float d = distance(vUv, vec2(0.5));
      color.rgb *= 1.0 - smoothstep(0.42, 0.92, d) * vignette;

      gl_FragColor = color;
    }
  `,
};

export function createGradePass() {
  return new ShaderPass(GradeShader);
}
