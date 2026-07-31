import type { CategoryKey } from './types';

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  alkali: 'Alkali metal',
  alkaline: 'Alkaline earth metal',
  transition: 'Transition metal',
  postTransition: 'Post-transition metal',
  metalloid: 'Metalloid',
  nonmetal: 'Reactive nonmetal',
  halogen: 'Halogen',
  nobleGas: 'Noble gas',
  lanthanide: 'Lanthanide',
  actinide: 'Actinide',
  unknown: 'Unknown properties',
};

/**
 * Vivid but still light: the tile labels are baked dark into the atlas, so
 * these carry high saturation without dropping the luminance needed to read
 * black text on them.
 */
export const CATEGORY_COLOR: Record<CategoryKey, number> = {
  alkali: 0xef3b3b,
  alkaline: 0xf67f0c,
  transition: 0xf2bd00,
  postTransition: 0x00c896,
  metalloid: 0x93d419,
  nonmetal: 0x18c04f,
  halogen: 0x00bcd9,
  nobleGas: 0x2183eb,
  lanthanide: 0x9457ff,
  actinide: 0xf03d87,
  unknown: 0x9aa3ae,
};

export const MONO_TILE_COLOR = 0xd6d6dc;
export const MONO_ACCENT = 0x7fd4ff;
