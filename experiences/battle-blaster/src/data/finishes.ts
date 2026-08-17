import type { PatternId } from "../scene/patterns";

/**
 * Every model in the pack is one merged mesh with a single material, so a
 * finish is a uniform treatment of that material rather than a per-part
 * repaint. `tint` multiplies the authored base-colour texture, which means it
 * can darken and colour-shift but never brighten — finishes that need a
 * different surface entirely supply a `pattern` instead.
 */
export interface FinishDef {
  id: string;
  name: string;
  /** Chip swatch colour, approximating the result on screen. */
  swatch: string;
  /** Multiplied over the base-colour texture, whether authored or patterned. */
  tint: number;
  /**
   * Replaces the painted base texture with a generated pattern. Necessary for
   * camo, which cannot be reached by tinting mustard paint.
   */
  pattern?: PatternId;
  metalness?: number;
  roughness?: number;
  /**
   * When set, the base-colour texture is reused as the emissive map, so only
   * the already-bright parts of the texture glow.
   */
  emissive?: number;
  emissiveIntensity?: number;
}

/** Sentinel for modules: inherit whatever the host frame is wearing. */
export const MATCH_FINISH_ID = "match";

export const FINISHES: FinishDef[] = [
  {
    id: "factory",
    name: "Factory",
    swatch: "#b8993f",
    tint: 0xffffff,
  },
  {
    id: "gunmetal",
    name: "Gunmetal",
    swatch: "#6d757d",
    tint: 0x8a929a,
    metalness: 0.9,
    roughness: 0.35,
  },
  {
    id: "oxide",
    name: "Oxide",
    swatch: "#a8552f",
    tint: 0xa8552f,
    metalness: 0.3,
    roughness: 0.85,
  },
  {
    id: "acid",
    name: "Acid",
    swatch: "#c7ff1a",
    tint: 0xa8d43a,
    metalness: 0.5,
    roughness: 0.45,
    emissive: 0x3d5c0a,
    emissiveIntensity: 0.35,
  },
  {
    id: "midnight",
    name: "Midnight",
    swatch: "#2b3138",
    tint: 0x39414a,
    metalness: 0.85,
    roughness: 0.22,
  },
  {
    id: "woodland",
    name: "Woodland",
    swatch: "#4a5730",
    tint: 0xffffff,
    pattern: "camo-woodland",
    metalness: 0.15,
    roughness: 0.85,
  },
  {
    id: "desert",
    name: "Desert",
    swatch: "#9c8a5e",
    tint: 0xffffff,
    pattern: "camo-desert",
    metalness: 0.15,
    roughness: 0.85,
  },
  {
    id: "urban",
    name: "Urban",
    swatch: "#5f656c",
    tint: 0xffffff,
    pattern: "camo-urban",
    metalness: 0.2,
    roughness: 0.8,
  },
];

export const DEFAULT_FINISH_ID = FINISHES[0].id;

export function finishById(id: string): FinishDef {
  return FINISHES.find((finish) => finish.id === id) ?? FINISHES[0];
}

/** Resolves the module finish, following the frame when set to match. */
export function resolveModuleFinishId(
  frameFinishId: string,
  moduleFinishId: string,
): string {
  return moduleFinishId === MATCH_FINISH_ID ? frameFinishId : moduleFinishId;
}
