/**
 * The flat look.
 *
 * Every source of glow in the scene is switched off and the whole world is lit
 * by a single full-strength ambient, so each surface renders as its own colour
 * with no bloom, specular highlight, reflection or falloff anywhere.
 *
 * There are four separate causes of glow, and all of them have to go or the
 * others still show:
 *
 *  1. Metalness. A metallic surface has no diffuse colour at all — it renders
 *     purely as reflected environment. Every generated asset in this project
 *     ships at metalness 1, which is why rooms and the cab read as milky
 *     mirrors rather than painted surfaces.
 *  2. The environment map. It is what those metals reflect, and it adds a
 *     sheen to smooth dielectrics too.
 *  3. Emissive. A surface that emits cannot be darkened by removing lights.
 *  4. Point lights. Their inverse-square falloff is what pools hotspots.
 *
 * The cost, accepted deliberately: with no directional light there is no
 * shading, so form comes only from each surface's own colour. Corners and
 * curves flatten out.
 */

import * as THREE from "three";

/**
 * Ambient is the only light left, so it carries the whole exposure.
 *
 * Tuned by eye. Dropping metalness to 0 makes each asset's albedo do the work
 * that reflected environment used to, and these albedos are darker than the
 * old mirror finish implied, so the ambient has to be well above 1 to hold the
 * previous brightness. Past about 8 the light clothing and the dog clip to
 * pure white and lose their detail.
 */
export const FLAT_AMBIENT_INTENSITY = 6.0;

type AnyMaterial = THREE.Material & {
  metalness?: number;
  roughness?: number;
  envMapIntensity?: number;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  envMap?: THREE.Texture | null;
  map?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
};

/**
 * Sharpen a texture. Generated room textures arrive at anisotropy 1, which is
 * what makes surfaces seen at a grazing angle — a counter top, a floor —
 * dissolve into mipmap blur.
 */
function sharpen(tex: THREE.Texture | null | undefined, maxAniso: number): void {
  if (!tex) return;
  if (tex.anisotropy >= maxAniso) return;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
}

function flattenMaterial(mat: AnyMaterial, maxAniso: number): void {
  // MeshBasicMaterial is already unlit; it only needs its textures sharpened.
  if (mat.metalness !== undefined) mat.metalness = 0;
  if (mat.roughness !== undefined) mat.roughness = 1;
  if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0;
  if (mat.envMap !== undefined) mat.envMap = null;
  if (mat.emissive) mat.emissive.setHex(0x000000);
  if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0;

  sharpen(mat.map, maxAniso);
  sharpen(mat.roughnessMap, maxAniso);
  sharpen(mat.metalnessMap, maxAniso);
  sharpen(mat.bumpMap, maxAniso);
  sharpen(mat.emissiveMap, maxAniso);
  mat.needsUpdate = true;
}

/**
 * Walk everything under `root`, flatten every material and switch off every
 * light except a single ambient. Safe to call more than once.
 */
export function flattenLook(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
): void {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const done = new Set<THREE.Material>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as THREE.Points).isPoints) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || done.has(m)) continue;
        done.add(m);
        flattenMaterial(m as AnyMaterial, maxAniso);
      }
    }

    const light = obj as THREE.Light;
    if (!light.isLight) return;
    if ((light as THREE.AmbientLight).isAmbientLight) {
      // The one surviving light. Neutral white, so nothing is tinted and every
      // surface reads as the colour it actually is.
      light.color.setHex(0xffffff);
      light.intensity = FLAT_AMBIENT_INTENSITY;
    } else {
      // Directional, hemisphere, point and spot all produce either shading
      // gradients or hotspots, which is exactly what is being removed.
      light.intensity = 0;
    }
  });
}
