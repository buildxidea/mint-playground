import type { Atom, Bond, Molecule } from "../types";

// Coordinates are in Angstrom. Small molecules use hand-placed geometry from
// standard bond lengths/angles; larger ones use the helpers below so hydrogen
// positions stay geometrically valid. Anything not bundled here can be fetched
// live from PubChem (see data/pubchem.ts).

type V3 = [number, number, number];

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function len(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function norm(a: V3): V3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Add `count` sp3 hydrogens to a carbon that has a single heavy neighbour. */
function addSp3Hydrogens(
  atoms: Atom[],
  bonds: Bond[],
  centerIdx: number,
  neighborIdx: number,
  count: number,
  bondLen = 1.09,
): void {
  const center: V3 = [atoms[centerIdx].x, atoms[centerIdx].y, atoms[centerIdx].z];
  const neighbor: V3 = [
    atoms[neighborIdx].x,
    atoms[neighborIdx].y,
    atoms[neighborIdx].z,
  ];
  const axis = norm(sub(center, neighbor)); // points away from the neighbour
  const t: V3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = norm(cross(axis, t));
  const v = cross(axis, u);
  const along = 0.3333; // cos(180 - 109.47)
  const radial = 0.9428; // sin(109.47)
  for (let j = 0; j < count; j++) {
    const ang = (2 * Math.PI * j) / 3 + (count === 3 ? 0 : Math.PI / 2);
    const dir: V3 = [
      axis[0] * along + (u[0] * Math.cos(ang) + v[0] * Math.sin(ang)) * radial,
      axis[1] * along + (u[1] * Math.cos(ang) + v[1] * Math.sin(ang)) * radial,
      axis[2] * along + (u[2] * Math.cos(ang) + v[2] * Math.sin(ang)) * radial,
    ];
    const h = add(center, scale(norm(dir), bondLen));
    atoms.push({ element: "H", x: h[0], y: h[1], z: h[2] });
    bonds.push({ a: centerIdx, b: atoms.length - 1, order: 1 });
  }
}

/** Add two hydrogens to a carbon bonded to two heavy neighbours (methylene). */
function addMethyleneHydrogens(
  atoms: Atom[],
  bonds: Bond[],
  centerIdx: number,
  n1Idx: number,
  n2Idx: number,
  bondLen = 1.09,
): void {
  const c: V3 = [atoms[centerIdx].x, atoms[centerIdx].y, atoms[centerIdx].z];
  const d1 = norm(sub([atoms[n1Idx].x, atoms[n1Idx].y, atoms[n1Idx].z], c));
  const d2 = norm(sub([atoms[n2Idx].x, atoms[n2Idx].y, atoms[n2Idx].z], c));
  const bis = norm(scale(add(d1, d2), -1)); // bisector away from neighbours
  const perp = norm(cross(d1, d2));
  const s = Math.sin((54.75 * Math.PI) / 180);
  const co = Math.cos((54.75 * Math.PI) / 180);
  for (const sign of [1, -1]) {
    const dir: V3 = [
      bis[0] * co + perp[0] * s * sign,
      bis[1] * co + perp[1] * s * sign,
      bis[2] * co + perp[2] * s * sign,
    ];
    const h = add(c, scale(norm(dir), bondLen));
    atoms.push({ element: "H", x: h[0], y: h[1], z: h[2] });
    bonds.push({ a: centerIdx, b: atoms.length - 1, order: 1 });
  }
}

function atom(element: string, x: number, y: number, z: number): Atom {
  return { element, x, y, z };
}

// ----- Diatomics & tiny molecules -----------------------------------------

const water: Molecule = {
  name: "Water",
  formula: "H₂O",
  category: "Inorganic",
  atoms: [atom("O", 0, 0, 0), atom("H", 0.757, 0.586, 0), atom("H", -0.757, 0.586, 0)],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
  ],
};

const carbonDioxide: Molecule = {
  name: "Carbon dioxide",
  formula: "CO₂",
  category: "Inorganic",
  atoms: [atom("C", 0, 0, 0), atom("O", 1.16, 0, 0), atom("O", -1.16, 0, 0)],
  bonds: [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 2 },
  ],
};

const dihydrogen: Molecule = {
  name: "Hydrogen",
  formula: "H₂",
  category: "Diatomic",
  atoms: [atom("H", -0.37, 0, 0), atom("H", 0.37, 0, 0)],
  bonds: [{ a: 0, b: 1, order: 1 }],
};

const dioxygen: Molecule = {
  name: "Oxygen",
  formula: "O₂",
  category: "Diatomic",
  atoms: [atom("O", -0.605, 0, 0), atom("O", 0.605, 0, 0)],
  bonds: [{ a: 0, b: 1, order: 2 }],
};

const dinitrogen: Molecule = {
  name: "Nitrogen",
  formula: "N₂",
  category: "Diatomic",
  atoms: [atom("N", -0.55, 0, 0), atom("N", 0.55, 0, 0)],
  bonds: [{ a: 0, b: 1, order: 3 }],
};

const hydrogenChloride: Molecule = {
  name: "Hydrogen chloride",
  formula: "HCl",
  category: "Inorganic",
  atoms: [atom("Cl", 0, 0, 0), atom("H", 1.27, 0, 0)],
  bonds: [{ a: 0, b: 1, order: 1 }],
};

const ammonia: Molecule = {
  name: "Ammonia",
  formula: "NH₃",
  category: "Inorganic",
  atoms: [
    atom("N", 0, 0, 0),
    atom("H", 0.937, 0, -0.381),
    atom("H", -0.469, 0.812, -0.381),
    atom("H", -0.469, -0.812, -0.381),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
  ],
};

const methane: Molecule = {
  name: "Methane",
  formula: "CH₄",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, 0),
    atom("H", 0.629, 0.629, 0.629),
    atom("H", 0.629, -0.629, -0.629),
    atom("H", -0.629, 0.629, -0.629),
    atom("H", -0.629, -0.629, 0.629),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
  ],
};

const formaldehyde: Molecule = {
  name: "Formaldehyde",
  formula: "CH₂O",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, 0),
    atom("O", 0, 1.21, 0),
    atom("H", 0.94, -0.56, 0),
    atom("H", -0.94, -0.56, 0),
  ],
  bonds: [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
  ],
};

const acetylene: Molecule = {
  name: "Acetylene",
  formula: "C₂H₂",
  category: "Organic",
  atoms: [
    atom("C", -0.6, 0, 0),
    atom("C", 0.6, 0, 0),
    atom("H", -1.66, 0, 0),
    atom("H", 1.66, 0, 0),
  ],
  bonds: [
    { a: 0, b: 1, order: 3 },
    { a: 0, b: 2, order: 1 },
    { a: 1, b: 3, order: 1 },
  ],
};

const ethylene: Molecule = {
  name: "Ethylene",
  formula: "C₂H₄",
  category: "Organic",
  atoms: [
    atom("C", -0.665, 0, 0),
    atom("C", 0.665, 0, 0),
    atom("H", -1.23, 0.92, 0),
    atom("H", -1.23, -0.92, 0),
    atom("H", 1.23, 0.92, 0),
    atom("H", 1.23, -0.92, 0),
  ],
  bonds: [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 1, b: 4, order: 1 },
    { a: 1, b: 5, order: 1 },
  ],
};

const ethane: Molecule = {
  name: "Ethane",
  formula: "C₂H₆",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, -0.77),
    atom("C", 0, 0, 0.77),
    atom("H", 1.028, 0, -1.133),
    atom("H", -0.514, 0.89, -1.133),
    atom("H", -0.514, -0.89, -1.133),
    atom("H", -1.028, 0, 1.133),
    atom("H", 0.514, 0.89, 1.133),
    atom("H", 0.514, -0.89, 1.133),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
    { a: 1, b: 5, order: 1 },
    { a: 1, b: 6, order: 1 },
    { a: 1, b: 7, order: 1 },
  ],
};

const methanol: Molecule = {
  name: "Methanol",
  formula: "CH₃OH",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, 0),
    atom("O", 1.41, 0, 0),
    atom("H", 1.9, 0.82, 0),
    atom("H", -0.363, 1.028, 0),
    atom("H", -0.363, -0.514, 0.89),
    atom("H", -0.363, -0.514, -0.89),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
    { a: 0, b: 5, order: 1 },
  ],
};

const ethanol: Molecule = {
  name: "Ethanol",
  formula: "C₂H₅OH",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, 0),
    atom("C", 1.52, 0, 0),
    atom("O", 2.1, 1.3, 0),
    atom("H", 3.06, 1.3, 0),
    atom("H", -0.36, 1.03, 0),
    atom("H", -0.36, -0.51, 0.89),
    atom("H", -0.36, -0.51, -0.89),
    atom("H", 1.62, -0.75, 0.75),
    atom("H", 1.62, -0.75, -0.75),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
    { a: 0, b: 5, order: 1 },
    { a: 0, b: 6, order: 1 },
    { a: 1, b: 7, order: 1 },
    { a: 1, b: 8, order: 1 },
  ],
};

const aceticAcid: Molecule = {
  name: "Acetic acid",
  formula: "CH₃COOH",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, 0),
    atom("C", 1.5, 0, 0),
    atom("O", 2.1, 1.05, 0),
    atom("O", 2.1, -1.15, 0),
    atom("H", 3.06, -1.15, 0),
    atom("H", -0.36, 1.03, 0),
    atom("H", -0.36, -0.51, 0.89),
    atom("H", -0.36, -0.51, -0.89),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 2 },
    { a: 1, b: 3, order: 1 },
    { a: 3, b: 4, order: 1 },
    { a: 0, b: 5, order: 1 },
    { a: 0, b: 6, order: 1 },
    { a: 0, b: 7, order: 1 },
  ],
};

// ----- Rings ---------------------------------------------------------------

function makeBenzene(): Molecule {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const rc = 1.39;
  const rh = 2.46;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    atoms.push(atom("C", rc * Math.cos(a), rc * Math.sin(a), 0));
  }
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    atoms.push(atom("H", rh * Math.cos(a), rh * Math.sin(a), 0));
  }
  for (let i = 0; i < 6; i++) {
    bonds.push({ a: i, b: (i + 1) % 6, order: i % 2 === 0 ? 2 : 1 });
    bonds.push({ a: i, b: i + 6, order: 1 });
  }
  return { name: "Benzene", formula: "C₆H₆", category: "Aromatic", atoms, bonds };
}

function makeCyclohexane(): Molecule {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const r = 1.46;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    atoms.push(atom("C", r * Math.cos(a), r * Math.sin(a), i % 2 === 0 ? 0.25 : -0.25));
  }
  for (let i = 0; i < 6; i++) bonds.push({ a: i, b: (i + 1) % 6, order: 1 });
  for (let i = 0; i < 6; i++) {
    addMethyleneHydrogens(atoms, bonds, i, (i + 5) % 6, (i + 1) % 6);
  }
  return {
    name: "Cyclohexane",
    formula: "C₆H₁₂",
    category: "Organic",
    atoms,
    bonds,
  };
}

function makePropane(): Molecule {
  const atoms: Atom[] = [
    atom("C", 0, 0, 0),
    atom("C", 1.53, 0, 0),
    atom("C", 2.04, 1.44, 0),
  ];
  const bonds: Bond[] = [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
  ];
  addSp3Hydrogens(atoms, bonds, 0, 1, 3);
  addSp3Hydrogens(atoms, bonds, 2, 1, 3);
  addMethyleneHydrogens(atoms, bonds, 1, 0, 2);
  return { name: "Propane", formula: "C₃H₈", category: "Organic", atoms, bonds };
}

function makeCaffeine(): Molecule {
  // Planar purine skeleton (matches the classic 2D drawing); methyl hydrogens
  // are added in 3D by the sp3 helper so the model reads as a real structure.
  const atoms: Atom[] = [
    atom("N", -1.34, 0.72, 0), // 0  N1
    atom("C", -1.34, -0.68, 0), // 1  C2
    atom("N", -0.13, -1.38, 0), // 2  N3
    atom("C", 1.08, -0.68, 0), // 3  C4
    atom("C", 1.08, 0.72, 0), // 4  C5
    atom("C", -0.13, 1.42, 0), // 5  C6
    atom("N", 2.42, 1.13, 0), // 6  N7
    atom("C", 3.24, 0.02, 0), // 7  C8
    atom("N", 2.42, -1.09, 0), // 8  N9
    atom("O", -2.39, -1.29, 0), // 9  O on C2
    atom("O", -0.13, 2.64, 0), // 10 O on C6
    atom("C", -2.65, 1.4, 0), // 11 CH3 on N1
    atom("C", -0.13, -2.85, 0), // 12 CH3 on N3
    atom("C", 3.72, 1.88, 0), // 13 CH3 on N7
    atom("H", 4.32, 0.02, 0), // 14 H on C8
  ];
  const bonds: Bond[] = [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
    { a: 3, b: 4, order: 2 },
    { a: 4, b: 5, order: 1 },
    { a: 5, b: 0, order: 1 },
    { a: 4, b: 6, order: 1 },
    { a: 6, b: 7, order: 1 },
    { a: 7, b: 8, order: 2 },
    { a: 8, b: 3, order: 1 },
    { a: 1, b: 9, order: 2 },
    { a: 5, b: 10, order: 2 },
    { a: 0, b: 11, order: 1 },
    { a: 2, b: 12, order: 1 },
    { a: 6, b: 13, order: 1 },
    { a: 7, b: 14, order: 1 },
  ];
  addSp3Hydrogens(atoms, bonds, 11, 0, 3);
  addSp3Hydrogens(atoms, bonds, 12, 2, 3);
  addSp3Hydrogens(atoms, bonds, 13, 6, 3);
  return {
    name: "Caffeine",
    formula: "C₈H₁₀N₄O₂",
    category: "Alkaloid",
    atoms,
    bonds,
  };
}

// ----- More molecular compounds -------------------------------------------

const carbonMonoxide: Molecule = {
  name: "Carbon monoxide",
  formula: "CO",
  category: "Inorganic",
  atoms: [atom("C", -0.565, 0, 0), atom("O", 0.565, 0, 0)],
  bonds: [{ a: 0, b: 1, order: 3 }],
};

const hydrogenSulfide: Molecule = {
  name: "Hydrogen sulfide",
  formula: "H₂S",
  category: "Inorganic",
  atoms: [atom("S", 0, 0, 0), atom("H", 0.964, 0.931, 0), atom("H", -0.964, 0.931, 0)],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
  ],
};

const sulfurDioxide: Molecule = {
  name: "Sulfur dioxide",
  formula: "SO₂",
  category: "Inorganic",
  atoms: [atom("S", 0, 0, 0), atom("O", 1.232, 0.726, 0), atom("O", -1.232, 0.726, 0)],
  bonds: [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 2 },
  ],
};

const ozone: Molecule = {
  name: "Ozone",
  formula: "O₃",
  category: "Inorganic",
  atoms: [atom("O", 0, 0, 0), atom("O", 1.088, 0.67, 0), atom("O", -1.088, 0.67, 0)],
  bonds: [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 1 },
  ],
};

const hydrogenPeroxide: Molecule = {
  name: "Hydrogen peroxide",
  formula: "H₂O₂",
  category: "Inorganic",
  atoms: [
    atom("O", -0.7375, 0, 0),
    atom("O", 0.7375, 0, 0),
    atom("H", -0.906, 0.955, 0),
    atom("H", 0.906, -0.373, 0.879),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 1, b: 3, order: 1 },
  ],
};

const nitrousOxide: Molecule = {
  name: "Nitrous oxide",
  formula: "N₂O",
  category: "Inorganic",
  atoms: [atom("N", -1.128, 0, 0), atom("N", 0, 0, 0), atom("O", 1.184, 0, 0)],
  bonds: [
    { a: 0, b: 1, order: 3 },
    { a: 1, b: 2, order: 1 },
  ],
};

const hydrogenCyanide: Molecule = {
  name: "Hydrogen cyanide",
  formula: "HCN",
  category: "Inorganic",
  atoms: [atom("C", 0, 0, 0), atom("N", 1.153, 0, 0), atom("H", -1.066, 0, 0)],
  bonds: [
    { a: 0, b: 1, order: 3 },
    { a: 0, b: 2, order: 1 },
  ],
};

function makeAcetone(): Molecule {
  const atoms: Atom[] = [
    atom("C", 0, 0, 0),
    atom("O", 0, 1.22, 0),
    atom("C", 1.303, -0.783, 0),
    atom("C", -1.303, -0.783, 0),
  ];
  const bonds: Bond[] = [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
  ];
  addSp3Hydrogens(atoms, bonds, 2, 0, 3);
  addSp3Hydrogens(atoms, bonds, 3, 0, 3);
  return { name: "Acetone", formula: "C₃H₆O", category: "Organic", atoms, bonds };
}

const chloroform: Molecule = {
  name: "Chloroform",
  formula: "CHCl₃",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, 0),
    atom("H", 0, 0, 1.09),
    atom("Cl", 1.668, 0, -0.59),
    atom("Cl", -0.834, 1.445, -0.59),
    atom("Cl", -0.834, -1.445, -0.59),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
  ],
};

const carbonTetrachloride: Molecule = {
  name: "Carbon tetrachloride",
  formula: "CCl₄",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, 0),
    atom("Cl", 1.022, 1.022, 1.022),
    atom("Cl", 1.022, -1.022, -1.022),
    atom("Cl", -1.022, 1.022, -1.022),
    atom("Cl", -1.022, -1.022, 1.022),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
  ],
};

const dichloromethane: Molecule = {
  name: "Dichloromethane",
  formula: "CH₂Cl₂",
  category: "Organic",
  atoms: [
    atom("C", 0, 0, 0),
    atom("Cl", 1.022, 1.022, 1.022),
    atom("Cl", 1.022, -1.022, -1.022),
    atom("H", -0.629, 0.629, -0.629),
    atom("H", -0.629, -0.629, 0.629),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
  ],
};

function makeButane(): Molecule {
  const atoms: Atom[] = [
    atom("C", 0, 0, 0),
    atom("C", 1.26, 0.89, 0),
    atom("C", 2.52, 0, 0),
    atom("C", 3.78, 0.89, 0),
  ];
  const bonds: Bond[] = [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
  ];
  addSp3Hydrogens(atoms, bonds, 0, 1, 3);
  addSp3Hydrogens(atoms, bonds, 3, 2, 3);
  addMethyleneHydrogens(atoms, bonds, 1, 0, 2);
  addMethyleneHydrogens(atoms, bonds, 2, 1, 3);
  return { name: "Butane", formula: "C₄H₁₀", category: "Organic", atoms, bonds };
}

function makeToluene(): Molecule {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const rc = 1.39;
  const rh = 2.46;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    atoms.push(atom("C", rc * Math.cos(a), rc * Math.sin(a), 0));
  }
  // Methyl replaces the hydrogen on ring carbon 0.
  const methylIdx = atoms.length;
  atoms.push(atom("C", rc + 1.51, 0, 0));
  for (let i = 1; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    atoms.push(atom("H", rh * Math.cos(a), rh * Math.sin(a), 0));
  }
  for (let i = 0; i < 6; i++) {
    bonds.push({ a: i, b: (i + 1) % 6, order: i % 2 === 0 ? 2 : 1 });
  }
  bonds.push({ a: 0, b: methylIdx, order: 1 });
  for (let i = 1; i < 6; i++) bonds.push({ a: i, b: methylIdx + i, order: 1 });
  addSp3Hydrogens(atoms, bonds, methylIdx, 0, 3);
  return { name: "Toluene", formula: "C₇H₈", category: "Aromatic", atoms, bonds };
}

function makeUrea(): Molecule {
  const atoms: Atom[] = [
    atom("C", 0, 0, 0),
    atom("O", 0, 1.26, 0),
    atom("N", 1.16, -0.67, 0),
    atom("N", -1.16, -0.67, 0),
  ];
  const bonds: Bond[] = [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
  ];
  addSp3Hydrogens(atoms, bonds, 2, 0, 2, 1.01);
  addSp3Hydrogens(atoms, bonds, 3, 0, 2, 1.01);
  return { name: "Urea", formula: "CH₄N₂O", category: "Organic", atoms, bonds };
}

const sulfuricAcid: Molecule = {
  name: "Sulfuric acid",
  formula: "H₂SO₄",
  category: "Inorganic",
  atoms: [
    atom("S", 0, 0, 0),
    atom("O", 0.831, 0.831, 0.831),
    atom("O", 0.831, -0.831, -0.831),
    atom("O", -0.906, 0.906, -0.906),
    atom("O", -0.906, -0.906, 0.906),
    atom("H", -1.466, 1.466, -1.466),
    atom("H", -1.466, -1.466, 1.466),
  ],
  bonds: [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 2 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
    { a: 3, b: 5, order: 1 },
    { a: 4, b: 6, order: 1 },
  ],
};

// ----- Crystal lattices (solids, metals, ionic & covalent networks) --------

function distanceBonds(
  atoms: Atom[],
  min: number,
  max: number,
  unlikeOnly = false,
): Bond[] {
  const bonds: Bond[] = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const d = Math.hypot(
        atoms[i].x - atoms[j].x,
        atoms[i].y - atoms[j].y,
        atoms[i].z - atoms[j].z,
      );
      if (d < min || d > max) continue;
      if (unlikeOnly && atoms[i].element === atoms[j].element) continue;
      bonds.push({ a: i, b: j, order: 1 });
    }
  }
  return bonds;
}

interface CrystalOpts {
  name: string;
  formula: string;
  category: string;
  a: number; // cubic lattice constant (Angstrom)
  basis: Array<[string, number, number, number]>; // [element, fx, fy, fz]
  nCells: number;
  bondMin: number;
  bondMax: number;
  unlikeOnly?: boolean;
  formulaWeight: number;
}

/** Tile a cubic unit cell into an n-cell block, dedup, and bond by distance. */
function crystal(o: CrystalOpts): Molecule {
  const max = o.nCells * o.a;
  const seen = new Set<string>();
  const atoms: Atom[] = [];
  for (let cx = 0; cx <= o.nCells; cx++) {
    for (let cy = 0; cy <= o.nCells; cy++) {
      for (let cz = 0; cz <= o.nCells; cz++) {
        for (const [el, fx, fy, fz] of o.basis) {
          const x = (cx + fx) * o.a;
          const y = (cy + fy) * o.a;
          const z = (cz + fz) * o.a;
          if (x > max + 1e-3 || y > max + 1e-3 || z > max + 1e-3) continue;
          const key = `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          atoms.push({ element: el, x, y, z });
        }
      }
    }
  }
  return {
    name: o.name,
    formula: o.formula,
    category: o.category,
    atoms,
    bonds: distanceBonds(atoms, o.bondMin, o.bondMax, o.unlikeOnly ?? false),
    formulaWeight: o.formulaWeight,
  };
}

const FCC: Array<[number, number, number]> = [
  [0, 0, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
  [0.5, 0.5, 0],
];

function fccBasis(el: string): Array<[string, number, number, number]> {
  return FCC.map(([x, y, z]) => [el, x, y, z]);
}

function makeSodiumChloride(): Molecule {
  return crystal({
    name: "Sodium chloride",
    formula: "NaCl",
    category: "Ionic solid",
    a: 5.64,
    basis: [
      ...fccBasis("Na"),
      ["Cl", 0.5, 0, 0],
      ["Cl", 0, 0.5, 0],
      ["Cl", 0, 0, 0.5],
      ["Cl", 0.5, 0.5, 0.5],
    ],
    nCells: 1,
    bondMin: 2.5,
    bondMax: 2.95,
    unlikeOnly: true,
    formulaWeight: 58.44,
  });
}

function makeCesiumChloride(): Molecule {
  return crystal({
    name: "Cesium chloride",
    formula: "CsCl",
    category: "Ionic solid",
    a: 4.11,
    basis: [
      ["Cs", 0, 0, 0],
      ["Cl", 0.5, 0.5, 0.5],
    ],
    nCells: 2,
    bondMin: 3.4,
    bondMax: 3.7,
    unlikeOnly: true,
    formulaWeight: 168.36,
  });
}

function makeDiamond(): Molecule {
  return crystal({
    name: "Diamond",
    formula: "C",
    category: "Covalent solid",
    a: 3.567,
    basis: [
      ...fccBasis("C"),
      ["C", 0.25, 0.25, 0.25],
      ["C", 0.25, 0.75, 0.75],
      ["C", 0.75, 0.25, 0.75],
      ["C", 0.75, 0.75, 0.25],
    ],
    nCells: 1,
    bondMin: 1.4,
    bondMax: 1.7,
    formulaWeight: 12.01,
  });
}

function makeSphalerite(): Molecule {
  return crystal({
    name: "Zinc blende",
    formula: "ZnS",
    category: "Covalent solid",
    a: 5.41,
    basis: [
      ...fccBasis("Zn"),
      ["S", 0.25, 0.25, 0.25],
      ["S", 0.25, 0.75, 0.75],
      ["S", 0.75, 0.25, 0.75],
      ["S", 0.75, 0.75, 0.25],
    ],
    nCells: 1,
    bondMin: 2.1,
    bondMax: 2.55,
    unlikeOnly: true,
    formulaWeight: 97.47,
  });
}

function makeIron(): Molecule {
  return crystal({
    name: "Iron (BCC)",
    formula: "Fe",
    category: "Metal",
    a: 2.866,
    basis: [
      ["Fe", 0, 0, 0],
      ["Fe", 0.5, 0.5, 0.5],
    ],
    nCells: 2,
    bondMin: 2.3,
    bondMax: 2.6,
    formulaWeight: 55.85,
  });
}

function makeCopper(): Molecule {
  return crystal({
    name: "Copper (FCC)",
    formula: "Cu",
    category: "Metal",
    a: 3.615,
    basis: fccBasis("Cu"),
    nCells: 2,
    bondMin: 2.4,
    bondMax: 2.7,
    formulaWeight: 63.55,
  });
}

function makeGold(): Molecule {
  return crystal({
    name: "Gold (FCC)",
    formula: "Au",
    category: "Metal",
    a: 4.078,
    basis: fccBasis("Au"),
    nCells: 1,
    bondMin: 2.7,
    bondMax: 3.0,
    formulaWeight: 196.97,
  });
}

function makeGraphene(): Molecule {
  const atoms: Atom[] = [];
  const a1 = [2.46, 0];
  const a2 = [1.23, 2.13];
  const nx = 4;
  const ny = 4;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const ox = i * a1[0] + j * a2[0];
      const oy = i * a1[1] + j * a2[1];
      atoms.push(atom("C", ox, oy, 0));
      atoms.push(atom("C", ox + 1.23, oy + 0.71, 0));
    }
  }
  return {
    name: "Graphene (graphite layer)",
    formula: "C",
    category: "Covalent solid",
    atoms,
    bonds: distanceBonds(atoms, 1.3, 1.5),
    formulaWeight: 12.01,
  };
}

export const MOLECULES: Molecule[] = [
  makeCaffeine(),
  water,
  carbonDioxide,
  ammonia,
  methane,
  ethanol,
  methanol,
  aceticAcid,
  formaldehyde,
  ethylene,
  acetylene,
  ethane,
  makePropane(),
  makeButane(),
  makeBenzene(),
  makeToluene(),
  makeCyclohexane(),
  makeAcetone(),
  makeUrea(),
  carbonMonoxide,
  hydrogenSulfide,
  sulfurDioxide,
  ozone,
  hydrogenPeroxide,
  nitrousOxide,
  hydrogenCyanide,
  sulfuricAcid,
  chloroform,
  carbonTetrachloride,
  dichloromethane,
  dihydrogen,
  dioxygen,
  dinitrogen,
  hydrogenChloride,
  // Solids: ionic, covalent networks, and metals.
  makeSodiumChloride(),
  makeCesiumChloride(),
  makeDiamond(),
  makeGraphene(),
  makeSphalerite(),
  makeIron(),
  makeCopper(),
  makeGold(),
].map((m) => ({ ...m, source: m.source ?? "Bundled" }));

export const DEFAULT_MOLECULE = MOLECULES[0];
