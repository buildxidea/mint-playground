/**
 * Solvane mark, redrawn per era. All variants share the Meridian Arc (the
 * rising sweep) and the Twin Meridian bars. Inline SVG, currentColor-driven
 * so each era layer tints its own mark.
 */

const svg = (body: string, viewBox = "0 0 64 64") =>
  `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** 1948 — engraved crest: ring, arc, twin bars, serif S */
const crest1948 = svg(`
  <circle cx="32" cy="32" r="29" stroke="currentColor" stroke-width="2"/>
  <circle cx="32" cy="32" r="24.5" stroke="currentColor" stroke-width="0.75"/>
  <path d="M10 40 Q30 18 54 26" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M18 46 H46 M22 50 H42" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <text x="32" y="35" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="15" fill="currentColor" font-weight="bold">S</text>
`);

/** 1965 — open badge: bold arc over twin chrome bars */
const badge1965 = svg(`
  <path d="M6 40 Q30 12 58 24" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
  <path d="M12 46 H52" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
  <path d="M18 53 H46" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
`);

/** 1987 — geometric: arc sheared into a speed wedge, hard bars */
const wedge1987 = svg(`
  <path d="M6 44 L34 16 L58 22 L34 24 Z" fill="currentColor"/>
  <rect x="12" y="48" width="40" height="4" fill="currentColor" transform="skewX(-18)" transform-origin="32 50"/>
  <rect x="18" y="55" width="28" height="4" fill="currentColor" transform="skewX(-18)" transform-origin="32 57"/>
`);

/** 2004 — glossy ellipse badge */
const gloss2004 = svg(`
  <ellipse cx="32" cy="32" rx="28" ry="20" stroke="currentColor" stroke-width="3"/>
  <path d="M10 38 Q30 18 54 26" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M20 44 H44" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
`);

/** 2026 — flat minimal: the arc alone over one thin bar */
const flat2026 = svg(`
  <path d="M8 40 Q30 16 56 25" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <path d="M16 48 H48" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
`);

/** 2040s — a single continuous light blade */
const blade2040 = svg(`
  <path d="M6 42 Q32 12 58 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M6 42 Q32 12 58 24" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity="0.25"/>
`);

export const ERA_MARKS: Record<string, string> = {
  "car-1948": crest1948,
  "car-1965": badge1965,
  "car-1987": wedge1987,
  "car-2004": gloss2004,
  "car-2026": flat2026,
  "car-2040": blade2040,
};

/** master mark used by nav / preloader (modern flat) */
export const MASTER_MARK = flat2026;
