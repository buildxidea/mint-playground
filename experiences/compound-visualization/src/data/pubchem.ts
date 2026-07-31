import type { Atom, Bond, BondOrder, Molecule } from "../types";
import { getElement } from "./elements";

const BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";

export class PubChemError extends Error {}

interface FetchResult {
  sdf: string;
  is3d: boolean;
}

async function fetchSdf(name: string): Promise<FetchResult> {
  const q = encodeURIComponent(name.trim());
  // Prefer a real 3D conformer; fall back to the 2D record if none exists.
  const attempts: Array<{ url: string; is3d: boolean }> = [
    { url: `${BASE}/compound/name/${q}/record/SDF?record_type=3d`, is3d: true },
    { url: `${BASE}/compound/name/${q}/record/SDF?record_type=2d`, is3d: false },
  ];
  let lastStatus = 0;
  for (const { url, is3d } of attempts) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new PubChemError(
        "Could not reach PubChem — check your internet connection.",
      );
    }
    if (res.ok) {
      const sdf = await res.text();
      if (sdf.trim()) return { sdf, is3d };
    }
    lastStatus = res.status;
    if (res.status === 404) continue;
  }
  if (lastStatus === 404) {
    throw new PubChemError(`No compound named "${name}" was found on PubChem.`);
  }
  throw new PubChemError(`PubChem request failed (status ${lastStatus}).`);
}

/** Parse a V2000 MOL/SDF connection table into a Molecule. */
export function parseSdf(sdf: string, name: string, is3d: boolean): Molecule {
  const lines = sdf.split(/\r?\n/);
  // Line 4 (index 3) is the counts line: aaabbb...
  const counts = lines[3];
  if (!counts) throw new PubChemError("Malformed SDF: missing counts line.");
  const atomCount = parseInt(counts.slice(0, 3), 10);
  const bondCount = parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount)) {
    throw new PubChemError("Malformed SDF: unreadable counts line.");
  }

  const atoms: Atom[] = [];
  for (let i = 0; i < atomCount; i++) {
    const line = lines[4 + i];
    const x = parseFloat(line.slice(0, 10));
    const y = parseFloat(line.slice(10, 20));
    const z = parseFloat(line.slice(20, 30));
    const element = line.slice(31, 34).trim();
    atoms.push({ element, x, y, z });
  }

  const bonds: Bond[] = [];
  const bondStart = 4 + atomCount;
  for (let i = 0; i < bondCount; i++) {
    const line = lines[bondStart + i];
    const a = parseInt(line.slice(0, 3), 10) - 1;
    const b = parseInt(line.slice(3, 6), 10) - 1;
    let order = parseInt(line.slice(6, 9), 10);
    if (order < 1 || order > 3) order = 1; // treat aromatic/other as single
    bonds.push({ a, b, order: order as BondOrder });
  }

  const formula = buildFormula(atoms);
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  return {
    name: displayName,
    formula,
    category: "PubChem",
    atoms,
    bonds,
    source: is3d ? "PubChem (3D)" : "PubChem (2D layout)",
  };
}

function buildFormula(atoms: Atom[]): string {
  const counts = new Map<string, number>();
  for (const a of atoms) counts.set(a.element, (counts.get(a.element) ?? 0) + 1);
  // Hill system: C first, H second, then the rest alphabetically.
  const order = (sym: string) => (sym === "C" ? 0 : sym === "H" ? 1 : 2);
  const syms = [...counts.keys()].sort(
    (x, y) => order(x) - order(y) || x.localeCompare(y),
  );
  return syms
    .map((s) => (counts.get(s)! > 1 ? `${s}${counts.get(s)}` : s))
    .join("");
}

/** Molar mass in g/mol from the element table. */
export function molarMass(mol: Molecule): number {
  return mol.atoms.reduce((sum, a) => sum + getElement(a.element).mass, 0);
}

export async function fetchMolecule(name: string): Promise<Molecule> {
  const { sdf, is3d } = await fetchSdf(name);
  const mol = parseSdf(sdf, name, is3d);
  if (mol.atoms.length === 0) {
    throw new PubChemError("PubChem returned a record with no atoms.");
  }
  return mol;
}
