/**
 * Final composite pass for THE MARS TRAIL.
 *
 * The 2021 Oregon Trail was made by modelling in 3D, rendering each frame, and
 * hand-refining it to pixels. That is not a real-time pipeline, so this pass
 * reproduces the same result in-engine: the scene is rendered small, sampled
 * with nearest filtering, then posterised through an ordered-dither palette
 * clamp so the whole frame reads as one limited colour system.
 *
 * `uPhosphor` swaps the palette clamp for a single-hue CRT green ramp with
 * scanlines — the unlockable monochrome filter.
 */

import * as THREE from 'three';

export const RetroShader = {
  name: 'RetroShader',

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Colour steps per channel. Lower is chunkier. */
    uLevels: { value: 14 },
    /** 0 = raw render, 1 = fully posterised. */
    uPaletteStrength: { value: 1 },
    /** 0 = colour, 1 = monochrome phosphor green. */
    uPhosphor: { value: 0 },
    /** Overall brightness multiplier applied before posterisation. */
    uExposure: { value: 1.6 },
    /** Black-level lift, so shadowed areas do not crush to pure black. */
    uLift: { value: 0.07 },
    /** Scanline darkening amount, applied in both modes. */
    uScanline: { value: 0.09 },
    /** Corner falloff. */
    uVignette: { value: 0.16 },
    /** Low-res buffer size, needed for scanline and dither alignment. */
    uResolution: { value: new THREE.Vector2(480, 270) },
    /**
     * Size, in buffer pixels, of one retro "pixel".
     *
     * The dither grid and scanlines were authored against a 270px buffer where
     * one buffer pixel was one visible pixel. Rendering at 540p or higher with
     * a cell of 1 collapses the scanline into a shimmering one-pixel comb and
     * makes the dither invisible noise. Scaling the cell with the buffer keeps
     * the effect the same apparent size at any resolution.
     */
    uRetroCell: { value: 1 },
    /** Phosphor hue. Defaults to the HUD's green. */
    uPhosphorColor: { value: new THREE.Color('#4ae24a') },
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
    uniform float uLevels;
    uniform float uExposure;
    uniform float uLift;
    uniform float uPaletteStrength;
    uniform float uPhosphor;
    uniform float uScanline;
    uniform float uVignette;
    uniform vec2 uResolution;
    uniform float uRetroCell;
    uniform vec3 uPhosphorColor;

    varying vec2 vUv;

    // Ordered 4x4 Bayer dither. Breaks up posterisation banding into the
    // stipple texture that reads as hand-placed pixels rather than gradient
    // steps, which is exactly what the reference art does in its skies.
    float bayer(vec2 pixel) {
      int x = int(mod(pixel.x, 4.0));
      int y = int(mod(pixel.y, 4.0));
      int index = x + y * 4;
      float values[16];
      values[0]  =  0.0; values[1]  =  8.0; values[2]  =  2.0; values[3]  = 10.0;
      values[4]  = 12.0; values[5]  =  4.0; values[6]  = 14.0; values[7]  =  6.0;
      values[8]  =  3.0; values[9]  = 11.0; values[10] =  1.0; values[11] =  9.0;
      values[12] = 15.0; values[13] =  7.0; values[14] = 13.0; values[15] =  5.0;
      for (int i = 0; i < 16; i++) {
        if (i == index) return values[i] / 16.0 - 0.5;
      }
      return 0.0;
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      // Quantise to retro-cell space so the dither and scanline period stay a
      // constant apparent size however large the buffer is.
      vec2 pixel = floor(vUv * uResolution / uRetroCell);

      // Exposure and black lift happen before quantisation so the palette
      // steps land on the brightened values rather than being stretched after.
      vec3 graded = clamp(source.rgb * uExposure + uLift, 0.0, 1.0);

      float dither = bayer(pixel) / uLevels;
      vec3 quantized = floor((graded + dither) * uLevels + 0.5) / uLevels;
      vec3 color = mix(graded, quantized, uPaletteStrength);

      if (uPhosphor > 0.5) {
        // Rec. 709 luminance, then a hard 6-step ramp up the phosphor hue.
        float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        float steps = 6.0;
        luma = floor((luma + bayer(pixel) / steps) * steps + 0.5) / steps;
        color = uPhosphorColor * clamp(luma * 1.15, 0.0, 1.0);
      }

      // Scanlines run on the low-res grid so they scale with the pixel size.
      float scan = 1.0 - uScanline * step(1.0, mod(pixel.y, 2.0));
      color *= scan;

      // Vignette, measured from centre in UV space.
      vec2 centered = vUv - 0.5;
      float falloff = 1.0 - uVignette * dot(centered, centered) * 2.4;
      color *= clamp(falloff, 0.0, 1.0);

      gl_FragColor = vec4(color, source.a);
    }
  `,
};
