export type ElementCategory =
  | "nonmetal"
  | "noble-gas"
  | "alkali-metal"
  | "alkaline-earth-metal"
  | "metalloid"
  | "halogen"
  | "transition-metal"
  | "post-transition-metal"
  | "lanthanide"
  | "actinide"
  | "unknown";

export type MatterState = "solid" | "liquid" | "gas" | "unknown";

export interface Element {
  symbol: string;
  name: string;
  number: number;
  mass: number;
  /** Pauling electronegativity, undefined when not defined for the element. */
  electronegativity?: number;
  /** Covalent radius in Angstrom (drives ball-and-stick sphere size). */
  covalentRadius: number;
  /** Van der Waals radius in Angstrom (drives space-filling sphere size). */
  vdwRadius: number;
  /** CPK/Jmol hex color, e.g. 0xffffff. */
  cpkColor: number;
  category: ElementCategory;
  /** Periodic-table column 1..18. 0 when placed separately (f-block). */
  group: number;
  /** Periodic-table row 1..7. */
  period: number;
  state: MatterState;
  /**
   * The fields below are optional because they are genuinely unknown for many
   * synthetic elements — undefined must render as "unknown", never as zero.
   */
  meltingPoint?: number; // K
  boilingPoint?: number; // K
  density?: number; // g/cm³ at STP
  configuration?: string; // e.g. "[Ar] 3d⁶ 4s²"
  oxidationStates?: string; // e.g. "+2, +3"
  discovered?: number; // year; negative for BCE
}

export interface Atom {
  element: string;
  x: number;
  y: number;
  z: number;
}

export type BondOrder = 1 | 2 | 3;

export interface Bond {
  a: number;
  b: number;
  order: BondOrder;
}

export interface Molecule {
  name: string;
  formula: string;
  category: string;
  atoms: Atom[];
  bonds: Bond[];
  /** Optional source note, e.g. "Bundled" or "PubChem CID 702". */
  source?: string;
  /**
   * Formula-unit molar mass (g/mol). Set for crystal fragments where summing
   * every displayed atom would be misleading; molecules leave it undefined and
   * the mass is computed from the atoms.
   */
  formulaWeight?: number;
}

export type RenderMode = "ball-and-stick" | "space-filling" | "wireframe";

export type AtomFinish = "matte" | "satin" | "glossy" | "metallic";

export type LabelColor = "white" | "black";

export type BgColor = "white" | "black";
