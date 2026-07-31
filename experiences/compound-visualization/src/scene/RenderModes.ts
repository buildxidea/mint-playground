import type { RenderMode, AtomFinish } from "../types";

export interface FinishStyle {
  roughness: number;
  metalness: number;
}

export const ATOM_FINISHES: Record<AtomFinish, FinishStyle> = {
  matte: { roughness: 0.92, metalness: 0.0 },
  satin: { roughness: 0.45, metalness: 0.0 },
  glossy: { roughness: 0.1, metalness: 0.0 },
  metallic: { roughness: 0.28, metalness: 0.85 },
};

export const ATOM_FINISH_LABELS: Record<AtomFinish, string> = {
  matte: "Matte",
  satin: "Satin",
  glossy: "Glossy",
  metallic: "Metallic",
};

export const ATOM_FINISH_HINTS: Record<AtomFinish, string> = {
  matte: "Flat, no shine",
  satin: "Soft highlight (default)",
  glossy: "Polished, reflective",
  metallic: "Colored metal sheen",
};

export interface RenderStyle {
  /** Multiplier applied to covalent radius for atom spheres. */
  atomScale: number;
  /** When true, use van der Waals radius instead of covalent radius. */
  useVdw: boolean;
  /** Bond cylinder radius in Angstrom. 0 hides bonds. */
  bondRadius: number;
  /** Whether atom spheres should show (space-filling always does). */
  showBonds: boolean;
}

export const RENDER_STYLES: Record<RenderMode, RenderStyle> = {
  "ball-and-stick": {
    atomScale: 0.42,
    useVdw: false,
    bondRadius: 0.07,
    showBonds: true,
  },
  "space-filling": {
    atomScale: 1.0,
    useVdw: true,
    bondRadius: 0,
    showBonds: false,
  },
  wireframe: {
    atomScale: 0.12,
    useVdw: false,
    bondRadius: 0.045,
    showBonds: true,
  },
};

export const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  "ball-and-stick": "Ball & stick",
  "space-filling": "Space-filling",
  wireframe: "Wireframe",
};
