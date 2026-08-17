import * as THREE from "three";

export type PatternId = "camo-woodland" | "camo-desert" | "camo-urban";

/**
 * Base colour first, then each successive layer painted over it. Values are
 * kept deliberately dark: the bloom pass threshold sits at 0.82, and a lighter
 * desert or urban palette pushes the whole frame over it and blooms out.
 */
const PALETTES: Record<PatternId, string[]> = {
  "camo-woodland": ["#4a5730", "#2f3a22", "#6d7845", "#232a19"],
  "camo-desert": ["#9c8a5e", "#6f6040", "#b9a97e", "#4f452c"],
  "camo-urban": ["#5f656c", "#3a3f45", "#828891", "#212529"],
};

const SIZE = 512;
/** Offsets used to redraw each blob across the seams so the texture tiles. */
const WRAP: [number, number][] = [
  [0, 0],
  [SIZE, 0],
  [-SIZE, 0],
  [0, SIZE],
  [0, -SIZE],
];

const cache = new Map<PatternId, THREE.CanvasTexture>();

/**
 * Builds a tiling camo pattern on a canvas. The models carry a single painted
 * base-colour texture, so a pattern finish replaces that texture outright —
 * there is no way to overlay one without a custom shader.
 */
export function patternTexture(id: PatternId): THREE.CanvasTexture {
  const cached = cache.get(id);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const palette = PALETTES[id];

  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let layer = 1; layer < palette.length; layer += 1) {
    ctx.fillStyle = palette[layer];
    for (let patch = 0; patch < 13; patch += 1) {
      const cx = Math.random() * SIZE;
      const cy = Math.random() * SIZE;
      // Each patch is a cluster of overlapping discs, which reads as an
      // organic blob rather than a circle.
      const lobes = 8 + Math.floor(Math.random() * 6);
      for (let lobe = 0; lobe < lobes; lobe += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 44;
        const radius = 15 + Math.random() * 25;
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance;
        for (const [ox, oy] of WRAP) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  texture.anisotropy = 4;
  cache.set(id, texture);
  return texture;
}
