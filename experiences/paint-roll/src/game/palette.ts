import { Color } from 'three';

export interface Swatch {
  readonly id: string;
  readonly name: string;
  /** sRGB hex as authored. Converted to the linear working space on demand. */
  readonly hex: number;
}

/**
 * Eight swatches is the whole colour system. It sits behind `paletteFor` so a
 * v2 colour wheel / eyedropper can replace the source without touching the
 * paint pipeline, which only ever sees a linear Color.
 */
export const DEFAULT_PALETTE: readonly Swatch[] = [
  { id: 'cloud', name: 'Cloud White', hex: 0xf4f1ea },
  { id: 'mint', name: 'Fresh Mint', hex: 0x5fe3b4 },
  { id: 'sky', name: 'Pool Blue', hex: 0x3fb8f5 },
  { id: 'grape', name: 'Grape Soda', hex: 0x8b5cf6 },
  { id: 'bubble', name: 'Bubblegum', hex: 0xff5fa8 },
  { id: 'sunset', name: 'Sunset Coral', hex: 0xff6b4a },
  { id: 'lemon', name: 'Lemon Pop', hex: 0xffd23f },
  { id: 'lime', name: 'Lime Zest', hex: 0x9ee037 },
];

const linearCache = new Map<number, Color>();

/**
 * The paint render target stores linear premultiplied colour, so swatches have
 * to leave sRGB before they reach the stamp shader.
 */
export function linearSwatchColor(hex: number): Color {
  let color = linearCache.get(hex);
  if (!color) {
    color = new Color().setHex(hex, 'srgb');
    linearCache.set(hex, color);
  }
  return color;
}

export function paletteFor(ids?: readonly string[]): readonly Swatch[] {
  if (!ids || ids.length === 0) return DEFAULT_PALETTE;
  const byId = new Map(DEFAULT_PALETTE.map((swatch) => [swatch.id, swatch]));
  const picked = ids
    .map((id) => byId.get(id))
    .filter((swatch): swatch is Swatch => Boolean(swatch));
  return picked.length > 0 ? picked : DEFAULT_PALETTE;
}
