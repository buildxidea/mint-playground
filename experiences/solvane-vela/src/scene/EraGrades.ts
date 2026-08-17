import * as THREE from "three";

/**
 * Everything the studio restyles per era: light rig state, surface colors,
 * fog, bloom, and the film grade. Adjacent eras are lerped during the
 * scroll-scrubbed handoff.
 */
export interface EraGrade {
  key: THREE.Color;
  keyIntensity: number;
  fill: THREE.Color;
  fillIntensity: number;
  rimA: THREE.Color;
  rimB: THREE.Color;
  rimIntensity: number;
  ambient: number;
  floor: THREE.Color;
  floorRoughness: number;
  cyc: THREE.Color;
  fog: THREE.Color;
  fogDensity: number;
  bloom: number;
  envIntensity: number;
  /** film grade uniforms */
  tint: THREE.Color;
  tintAmount: number;
  mono: number;
  saturation: number;
  grain: number;
  vignette: number;
}

const c = (hex: string) => new THREE.Color(hex);

export const ERA_GRADES: EraGrade[] = [
  // 1948 — warm tungsten over desert dust, muted period color
  {
    key: c("#ffc97e"), keyIntensity: 160,
    fill: c("#8a7859"), fillIntensity: 0.28,
    rimA: c("#f5cf94"), rimB: c("#9d7c4c"), rimIntensity: 55,
    ambient: 0.14,
    floor: c("#241f18"), floorRoughness: 0.55,
    cyc: c("#171410"), fog: c("#0d0b08"), fogDensity: 0.06,
    bloom: 0.028, envIntensity: 0.22,
    tint: c("#d9ab68"), tintAmount: 0.42, mono: 0.42, saturation: 1.0,
    grain: 0.16, vignette: 0.68,
  },
  // 1965 — old money: brighter champagne Kodachrome afternoon
  {
    key: c("#ffd9a0"), keyIntensity: 205,
    fill: c("#7a97a8"), fillIntensity: 0.5,
    rimA: c("#f2bc6e"), rimB: c("#5aa8ad"), rimIntensity: 85,
    ambient: 0.24,
    floor: c("#372c20"), floorRoughness: 0.45,
    cyc: c("#2a2016"), fog: c("#14100a"), fogDensity: 0.05,
    bloom: 0.035, envIntensity: 0.3,
    tint: c("#e8a75c"), tintAmount: 0.3, mono: 0.0, saturation: 1.55,
    grain: 0.1, vignette: 0.58,
  },
  // 1987 — night street, but the white car must clearly read; neon = accent
  {
    key: c("#c3ceea"), keyIntensity: 200,
    fill: c("#3c425e"), fillIntensity: 0.5,
    rimA: c("#e0248c"), rimB: c("#18b6e0"), rimIntensity: 110,
    ambient: 0.16,
    floor: c("#0b0d15"), floorRoughness: 0.16,
    cyc: c("#070811"), fog: c("#06040e"), fogDensity: 0.055,
    bloom: 0.084, envIntensity: 0.35,
    tint: c("#8f2fd6"), tintAmount: 0.16, mono: 0.0, saturation: 1.45,
    grain: 0.1, vignette: 0.5,
  },
  // 2004 — clean modern daylight over a Japanese road, cool and simple
  {
    key: c("#e6eef8"), keyIntensity: 235,
    fill: c("#8ba3ba"), fillIntensity: 0.62,
    rimA: c("#c4d6ec"), rimB: c("#7d9cc0"), rimIntensity: 85,
    ambient: 0.32,
    floor: c("#33373b"), floorRoughness: 0.55,
    cyc: c("#2c3138"), fog: c("#171b21"), fogDensity: 0.038,
    bloom: 0.028, envIntensity: 0.5,
    tint: c("#7da4cc"), tintAmount: 0.14, mono: 0.0, saturation: 1.25,
    grain: 0.04, vignette: 0.42,
  },
  // 2026 — Tesla studio: bright even white-grey, controlled (never clipping).
  // Rig pulled down 30% — it was the brightest chapter on the page.
  {
    key: c("#f4f7fa"), keyIntensity: 203,
    fill: c("#c9ced3"), fillIntensity: 0.595,
    rimA: c("#eef1f4"), rimB: c("#b9c0c6"), rimIntensity: 49,
    ambient: 0.35,
    floor: c("#95999e"), floorRoughness: 0.4,
    cyc: c("#b4b8bc"), fog: c("#84898e"), fogDensity: 0.022,
    bloom: 0.014, envIntensity: 0.455,
    tint: c("#aeb8c2"), tintAmount: 0.06, mono: 0.0, saturation: 1.15,
    grain: 0.01, vignette: 0.26,
  },
  // 2040s — neon night. Rig pulled down 30%: the rim pair especially was
  // blowing out the hover car's own neon streaks.
  {
    key: c("#d4f5ea"), keyIntensity: 217,
    fill: c("#265058"), fillIntensity: 0.434,
    // The teal rim was the source of every green hotspot — its speculars on
    // the glossy car and the wet floor were what flared. Halved; the car's
    // own emissive neon streaks carry the colour instead.
    rimA: c("#3fd9bb"), rimB: c("#3a80b8"), rimIntensity: 80,
    ambient: 0.21,
    floor: c("#0a1219"), floorRoughness: 0.1,
    cyc: c("#08121a"), fog: c("#04101a"), fogDensity: 0.042,
    // bloom is what turned teal speculars into blown-out green blobs here —
    // this is the lowest of any era, so the neon streaks glow without flaring
    bloom: 0.045, envIntensity: 0.35,
    tint: c("#2fc9ac"), tintAmount: 0.15, mono: 0.0, saturation: 1.35,
    grain: 0.06, vignette: 0.52,
  },
];

/** page background per era, mirrored to CSS so DOM chrome blends */
export const ERA_PAGE_BG = [
  "#0d0b08", "#14100a", "#06040e", "#171b21", "#84898e", "#04101a",
];

const scratch = {
  grade: null as EraGrade | null,
};

function lerpColor(out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number) {
  out.copy(a).lerp(b, t);
  return out;
}

/** Interpolated grade between adjacent eras. Reuses one scratch object. */
export function sampleGrade(eraFloat: number): EraGrade {
  const i = Math.max(0, Math.min(ERA_GRADES.length - 1, Math.floor(eraFloat)));
  const j = Math.min(ERA_GRADES.length - 1, i + 1);
  const t = THREE.MathUtils.clamp(eraFloat - i, 0, 1);
  const a = ERA_GRADES[i];
  const b = ERA_GRADES[j];

  if (!scratch.grade) {
    scratch.grade = {
      ...a,
      key: new THREE.Color(), fill: new THREE.Color(),
      rimA: new THREE.Color(), rimB: new THREE.Color(),
      floor: new THREE.Color(), cyc: new THREE.Color(),
      fog: new THREE.Color(), tint: new THREE.Color(),
    };
  }
  const g = scratch.grade;
  lerpColor(g.key, a.key, b.key, t);
  lerpColor(g.fill, a.fill, b.fill, t);
  lerpColor(g.rimA, a.rimA, b.rimA, t);
  lerpColor(g.rimB, a.rimB, b.rimB, t);
  lerpColor(g.floor, a.floor, b.floor, t);
  lerpColor(g.cyc, a.cyc, b.cyc, t);
  lerpColor(g.fog, a.fog, b.fog, t);
  lerpColor(g.tint, a.tint, b.tint, t);
  g.keyIntensity = THREE.MathUtils.lerp(a.keyIntensity, b.keyIntensity, t);
  g.fillIntensity = THREE.MathUtils.lerp(a.fillIntensity, b.fillIntensity, t);
  g.rimIntensity = THREE.MathUtils.lerp(a.rimIntensity, b.rimIntensity, t);
  g.ambient = THREE.MathUtils.lerp(a.ambient, b.ambient, t);
  g.floorRoughness = THREE.MathUtils.lerp(a.floorRoughness, b.floorRoughness, t);
  g.fogDensity = THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, t);
  g.bloom = THREE.MathUtils.lerp(a.bloom, b.bloom, t);
  g.envIntensity = THREE.MathUtils.lerp(a.envIntensity, b.envIntensity, t);
  g.tintAmount = THREE.MathUtils.lerp(a.tintAmount, b.tintAmount, t);
  g.mono = THREE.MathUtils.lerp(a.mono, b.mono, t);
  g.saturation = THREE.MathUtils.lerp(a.saturation, b.saturation, t);
  g.grain = THREE.MathUtils.lerp(a.grain, b.grain, t);
  g.vignette = THREE.MathUtils.lerp(a.vignette, b.vignette, t);
  return g;
}
