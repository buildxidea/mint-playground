/**
 * Solvane — an entirely fictional marque. Founded 1946 in the (fictional)
 * foundry town of Valmerre by sisters Elena and Maud Solvane. One flagship
 * line, the Vela, across six generations.
 *
 * Design DNA shared by every generation:
 *  - the "Meridian Arc": one unbroken beltline arc rising from the front
 *    fender through the tail
 *  - the "Twin Meridian": a split horizontal two-bar grille motif that
 *    becomes a light signature in the electric era
 *  - a forward-leaning C-pillar
 */

export interface EraSpec {
  label: string;
  value: string;
}

export interface Era {
  /** stable key — also the mint-assets.json logical key prefix */
  key: string;
  index: number;
  year: string;
  chapter: string;
  model: string;
  positioning: string;
  adHeadline: string;
  adBody: string;
  adFootnote?: string;
  specs: EraSpec[];
  /** hex paint color the pack was generated with (customizer baseline) */
  paint: string;
  accent: string;
}

export const BRAND = {
  name: "Solvane",
  line: "Vela",
  founded: 1946,
  town: "Valmerre",
  heroTagline: "One car. Eighty years.",
  heroSub:
    "Founded 1946 between the foundry and the sea, Solvane has built one idea " +
    "six times. Scroll to watch the Vela cross eighty years without ever " +
    "leaving the room.",
  finaleHeadline: "The whole arc, in one room.",
  finaleSub:
    "Six generations of the Vela, nose to tail. The beltline never broke; " +
    "everything else was allowed to change.",
} as const;

export const ERAS: Era[] = [
  {
    key: "car-1948",
    index: 0,
    year: "1948",
    chapter: "01",
    model: "Vela 100",
    positioning: "Motoring, returned to the people.",
    adHeadline: "After the long dark years, a light on the road.",
    adBody:
      "The Solvane works at Valmerre respectfully announce the Vela 100 — " +
      "an honest motorcar of sound steel and quiet manners, built for the " +
      "roads we may now travel freely.",
    adFootnote: "Solvane of Valmerre · Est. 1946",
    specs: [
      { label: "Engine", value: "1.9 L inline-four" },
      { label: "Output", value: "52 hp" },
      { label: "Top speed", value: "118 km/h" },
    ],
    paint: "#1a1c22",
    accent: "#b8965a",
  },
  {
    key: "car-1965",
    index: 1,
    year: "1965",
    chapter: "02",
    model: "Vela 240 GT",
    positioning: "The grand tour, democratized.",
    adHeadline: "Goes like Monday morning never happened.",
    adBody:
      "Six cylinders, two carburettors, and a shape your neighbours will " +
      "pretend not to stare at. The new Vela 240 GT holds the road the way " +
      "you hold an opinion — firmly, and at speed.",
    adFootnote: "Yours from $2,395 at your Solvane dealer.",
    specs: [
      { label: "Engine", value: "2.4 L straight-six" },
      { label: "Output", value: "130 hp" },
      { label: "Top speed", value: "185 km/h" },
    ],
    paint: "#b3121c",
    accent: "#d9a441",
  },
  {
    key: "car-1987",
    index: 2,
    year: "1987",
    chapter: "03",
    model: "Vela Turbo X",
    positioning: "Zero compromise. Maximum forward.",
    adHeadline: "TURBO X.",
    adBody:
      "Intercooled. Digital. Wind-cheating at Cd 0.31. The Vela Turbo X " +
      "doesn't follow the decade — it overtakes it on the inside.",
    adFootnote: "Boost is not a luxury. It is a policy.",
    specs: [
      { label: "Engine", value: "2.2 L turbo four" },
      { label: "Output", value: "205 hp" },
      { label: "0–100 km/h", value: "6.9 s" },
    ],
    paint: "#5a5f66",
    accent: "#e83e8c",
  },
  {
    key: "car-2004",
    index: 3,
    year: "2004",
    chapter: "04",
    model: "Vela VS4",
    positioning: "Intelligence in motion.",
    adHeadline: "Intelligence in motion.",
    adBody:
      "Thirty-two valves. Adaptive damping. Surfaces shaped in the wind " +
      "tunnel and finished like jewellery. The VS4 is what happens when the " +
      "future gets a corner office.",
    adFootnote: "The new Vela VS4. Drive the upgrade.",
    specs: [
      { label: "Engine", value: "3.0 L V6 32v" },
      { label: "Output", value: "260 hp" },
      { label: "Top speed", value: "250 km/h (lim.)" },
    ],
    paint: "#c8ccd2",
    accent: "#3b7dd8",
  },
  {
    key: "car-2026",
    index: 4,
    year: "2026",
    chapter: "05",
    model: "Vela E",
    positioning: "Quiet, considered, quick.",
    adHeadline: "Quiet, considered, quick.",
    adBody:
      "Dual motors. One unbroken line. The Twin Meridian grille is now a " +
      "signature of light. The Vela E carries eighty years lightly.",
    specs: [
      { label: "Drive", value: "Dual motor AWD, 400 kW" },
      { label: "Range", value: "620 km (WLTP)" },
      { label: "0–100 km/h", value: "3.8 s" },
    ],
    paint: "#f2f3f5",
    accent: "#17181a",
  },
  {
    key: "car-2040",
    index: 5,
    year: "2040s",
    chapter: "06",
    model: "Vela Aeon Concept",
    positioning: "Where the arc leads.",
    adHeadline: "Where the arc leads.",
    adBody:
      "A study in what remains when everything optional is removed: one " +
      "canopy, one light blade, one Meridian Arc drawn at four hundred " +
      "kilometres an hour of intent.",
    specs: [
      { label: "Cell", value: "Solid-state, 1,200 km" },
      { label: "Autonomy", value: "Level 5, retractable yoke" },
      { label: "Body", value: "Woven composite monocoque" },
    ],
    paint: "#101820",
    accent: "#5de0c8",
  },
];

export const CUSTOMIZER_PAINTS: { name: string; hex: string }[] = [
  { name: "Valmerre Pearl", hex: "#f2f3f5" },
  { name: "Foundry Grey", hex: "#6b7077" },
  { name: "Riviera Teal", hex: "#1f6f74" },
  { name: "Meridian Crimson", hex: "#8e1f2f" },
  { name: "Aeon Midnight", hex: "#101820" },
  { name: "Archive Cream", hex: "#e8e0cc" },
];

export const CUSTOMIZER_WHEELS: { name: string; hex: string }[] = [
  { name: "Polished Silver", hex: "#c9ccd1" },
  { name: "Gloss Graphite", hex: "#2a2d31" },
];
