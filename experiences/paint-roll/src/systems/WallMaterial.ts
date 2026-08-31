import type { MeshStandardMaterial, Texture } from 'three';

export interface PaintCompositeHandle {
  /**
   * World X of the before/after wipe plane. Paint is hidden left of it, so a
   * value below the room's minimum X is normal play (all paint showing).
   *
   * This is deliberately a world plane rather than a per-surface UV cut: with
   * five surfaces facing four directions, a UV wipe would read as five separate
   * wipes instead of one line travelling across the room.
   */
  setWipeWorldX(x: number): void;
  setWetRoughness(value: number): void;
}

/**
 * Composites the paint render target on top of a surface's grime material.
 *
 * This is a shader *injection* into MeshStandardMaterial, not a post-process
 * pass — the surface keeps its full PBR lighting, and the paint simply replaces
 * the grime's albedo and roughness wherever coverage exists.
 *
 * Two details matter:
 *  - the paint texture is premultiplied, so compositing is
 *    `grime * (1 - a) + paint.rgb` with no divide;
 *  - roughness drops toward `uWetRoughness` with coverage, which is the wet
 *    sheen that does most of the work in selling the before/after.
 */
export function attachPaintComposite(
  material: MeshStandardMaterial,
  paintTexture: Texture,
  options: { wetRoughness?: number; wipeStartX?: number } = {},
): PaintCompositeHandle {
  const uniforms = {
    uPaintTex: { value: paintTexture },
    uWipeWorldX: { value: options.wipeStartX ?? -1e6 },
    uWetRoughness: { value: options.wetRoughness ?? 0.28 },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintTex = uniforms.uPaintTex;
    shader.uniforms.uWipeWorldX = uniforms.uWipeWorldX;
    shader.uniforms.uWetRoughness = uniforms.uWetRoughness;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vPaintUv;
varying float vPaintWorldX;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPaintUv = uv;
vPaintWorldX = (modelMatrix * vec4(position, 1.0)).x;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uPaintTex;
uniform float uWipeWorldX;
uniform float uWetRoughness;
varying vec2 vPaintUv;
varying float vPaintWorldX;
vec4 gPaint = vec4(0.0);`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
gPaint = texture2D(uPaintTex, vPaintUv) * step(uWipeWorldX, vPaintWorldX);
diffuseColor.rgb = diffuseColor.rgb * (1.0 - gPaint.a) + gPaint.rgb;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uWetRoughness, gPaint.a);`,
      );
  };

  material.needsUpdate = true;

  return {
    setWipeWorldX(x) {
      uniforms.uWipeWorldX.value = x;
    },
    setWetRoughness(value) {
      uniforms.uWetRoughness.value = value;
    },
  };
}
