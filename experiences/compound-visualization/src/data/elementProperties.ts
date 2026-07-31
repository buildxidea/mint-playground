import type { Element, MatterState } from "../types";
import { ELEMENTS } from "./elements";

/**
 * A selectable colouring mode for the periodic table. Modes without a `value`
 * accessor are not numeric heat maps — they colour by category or by phase.
 */
export interface PropertyMode {
  key: string;
  label: string;
  unit?: string;
  /** undefined => categorical mode (see `kind`) */
  value?: (el: Element) => number | undefined;
  /** Values spanning orders of magnitude read better on a log scale. */
  log?: boolean;
  format?: (v: number) => string;
}

const round = (digits: number) => (v: number) => v.toFixed(digits);

export const PROPERTY_MODES: PropertyMode[] = [
  { key: "category", label: "Category" },
  { key: "state", label: "State at temperature" },
  {
    key: "mass",
    label: "Atomic mass",
    unit: "u",
    value: (e) => e.mass,
    format: round(2),
  },
  {
    key: "electronegativity",
    label: "Electronegativity",
    value: (e) => e.electronegativity,
    format: round(2),
  },
  {
    key: "melting",
    label: "Melting point",
    unit: "K",
    value: (e) => e.meltingPoint,
    format: round(0),
  },
  {
    key: "boiling",
    label: "Boiling point",
    unit: "K",
    value: (e) => e.boilingPoint,
    format: round(0),
  },
  {
    key: "density",
    label: "Density",
    unit: "g/cm³",
    value: (e) => e.density,
    log: true,
    format: (v) => (v < 0.01 ? v.toExponential(1) : v.toFixed(2)),
  },
  {
    key: "covalent",
    label: "Covalent radius",
    unit: "Å",
    value: (e) => e.covalentRadius,
    format: round(2),
  },
  {
    key: "vdw",
    label: "Van der Waals radius",
    unit: "Å",
    value: (e) => e.vdwRadius,
    format: round(2),
  },
  {
    key: "discovered",
    label: "Year discovered",
    value: (e) => e.discovered,
    format: (v) => (v < 0 ? `${Math.abs(Math.round(v))} BCE` : String(Math.round(v))),
  },
];

/** Min and max of a numeric mode across every element that has a value. */
export function extentOf(mode: PropertyMode): { min: number; max: number } | null {
  if (!mode.value) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const el of ELEMENTS) {
    const v = mode.value(el);
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

/** Gradient stops, cool -> warm. */
const RAMP: Array<[number, number, number]> = [
  [46, 58, 103], // deep indigo
  [46, 143, 184], // teal blue
  [82, 201, 160], // green
  [242, 209, 107], // sand
  [232, 114, 74], // warm red
];

/** Map t in [0,1] onto the ramp and return a CSS colour. */
export function rampColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  const ch = (n: number) => Math.round(a[n] + (b[n] - a[n]) * f);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

/**
 * Normalise a value to [0,1] within an extent, optionally on a log scale.
 * Log mode ignores non-positive values (returns null) since log is undefined.
 */
export function normalize(
  v: number,
  min: number,
  max: number,
  log: boolean,
): number | null {
  if (log) {
    if (v <= 0 || min <= 0) return null;
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    return hi === lo ? 0.5 : (Math.log10(v) - lo) / (hi - lo);
  }
  return max === min ? 0.5 : (v - min) / (max - min);
}

/** Neutral fill for elements whose value is unknown in the current mode. */
export const UNKNOWN_COLOR = "#4a4d55";

export const STATE_COLORS: Record<MatterState, string> = {
  solid: "#6c7a91",
  liquid: "#3f9fd4",
  gas: "#e0794c",
  unknown: UNKNOWN_COLOR,
};

export const STATE_LABELS: Record<MatterState, string> = {
  solid: "Solid",
  liquid: "Liquid",
  gas: "Gas",
  unknown: "Unknown",
};

export const kelvinTo = {
  K: (k: number) => k,
  C: (k: number) => k - 273.15,
  F: (k: number) => (k - 273.15) * 1.8 + 32,
};

export type TempUnit = keyof typeof kelvinTo;
