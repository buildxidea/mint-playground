/**
 * Per-leg scene palettes for THE MARS TRAIL.
 *
 * Each leg gets its own colour temperature, exactly as the reference art shifts
 * from bright prairie to dusk snow to night. The sky gradient drives everything
 * else in the frame, so these values are the single source of scene mood.
 */

import * as THREE from 'three';

export interface ScenePalette {
  key: string;
  /** Vertical sky gradient, top to bottom. */
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  /** Distant silhouette band colour. */
  farLayer: string;
  midLayer: string;
  nearLayer: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /** Direction the key light comes from. */
  sunPosition: [number, number, number];
  /** Star density, 0 disables the starfield. */
  starDensity: number;
  /** Drifting particulate colour and density — snow, dust, ice, pollen. */
  particleColor: string;
  particleDensity: number;
  /** Optional large celestial body on the horizon. */
  body?: {
    color: string;
    rimColor: string;
    radius: number;
    position: [number, number];
  };
}

export const PALETTES: Record<string, ScenePalette> = {
  'earth-orbit': {
    key: 'earth-orbit',
    skyTop: '#12275a',
    skyMid: '#2a63a8',
    skyBottom: '#5ba3c9',
    farLayer: '#2b6b96',
    midLayer: '#1b4a6e',
    nearLayer: '#0e2841',
    fog: '#163a5e',
    fogNear: 42,
    fogFar: 120,
    sunColor: '#fff4d6',
    sunIntensity: 4.19,
    hemiSky: '#8fc7e8',
    hemiGround: '#123048',
    hemiIntensity: 2.4,
    sunPosition: [8, 6, 5],
    starDensity: 0.35,
    particleColor: '#cfe6f5',
    particleDensity: 0.25,
    body: { color: '#2f7bb5', rimColor: '#9fd4f0', radius: 26, position: [-14, -14] },
  },

  'debris-belt': {
    key: 'debris-belt',
    skyTop: '#0d1426',
    skyMid: '#1e2f4c',
    skyBottom: '#3c5372',
    farLayer: '#42597a',
    midLayer: '#2a3a54',
    nearLayer: '#161f30',
    fog: '#1d2b42',
    fogNear: 34,
    fogFar: 105,
    sunColor: '#e8ecf5',
    sunIntensity: 3.24,
    hemiSky: '#5a708f',
    hemiGround: '#0a0f18',
    hemiIntensity: 1.6,
    sunPosition: [10, 4, 4],
    starDensity: 0.9,
    particleColor: '#8d9cb0',
    particleDensity: 0.55,
    body: { color: '#8e9099', rimColor: '#d6dae2', radius: 12, position: [16, 7] },
  },

  'deep-quiet': {
    key: 'deep-quiet',
    skyTop: '#1b1d3d',
    skyMid: '#2e2c60',
    skyBottom: '#473c7e',
    farLayer: '#514686',
    midLayer: '#393163',
    nearLayer: '#232041',
    fog: '#2a2650',
    fogNear: 30,
    fogFar: 95,
    sunColor: '#fff8e8',
    sunIntensity: 3.4,
    hemiSky: '#6f66a8',
    hemiGround: '#181530',
    hemiIntensity: 2.1,
    sunPosition: [14, 2, 2],
    // The emptiest leg gets the most stars: nothing else is out there.
    starDensity: 1,
    particleColor: '#b9b4e0',
    particleDensity: 0.18,
  },

  'asteroid-fringe': {
    key: 'asteroid-fringe',
    skyTop: '#0f0c18',
    skyMid: '#281c33',
    skyBottom: '#4e3640',
    farLayer: '#6b4a44',
    midLayer: '#432f31',
    nearLayer: '#241a1d',
    fog: '#2e2128',
    fogNear: 26,
    fogFar: 88,
    sunColor: '#ffe7bd',
    sunIntensity: 2.56,
    hemiSky: '#6b4f42',
    hemiGround: '#0d0809',
    hemiIntensity: 1.36,
    sunPosition: [12, 5, 3],
    starDensity: 0.8,
    particleColor: '#c9a887',
    particleDensity: 0.7,
  },

  'mars-approach': {
    key: 'mars-approach',
    skyTop: '#2a1519',
    skyMid: '#5f2f20',
    skyBottom: '#a55c33',
    farLayer: '#8a4d2c',
    midLayer: '#5c3220',
    nearLayer: '#2c1a13',
    fog: '#6b3a22',
    fogNear: 22,
    fogFar: 80,
    sunColor: '#ffd9a0',
    sunIntensity: 2.97,
    hemiSky: '#c97f4d',
    hemiGround: '#1a0f0a',
    hemiIntensity: 2.08,
    sunPosition: [-9, 5, 4],
    starDensity: 0.25,
    particleColor: '#d9a877',
    particleDensity: 1,
    body: { color: '#b2542a', rimColor: '#f0a76d', radius: 30, position: [12, -10] },
  },
  // --- flight sequences ---------------------------------------------------

  'launch-ascent': {
    key: 'launch-ascent',
    // Dawn over a dry lakebed. Warm low sun, cold fill: that contrast is what
    // makes it read as sunrise rather than overcast noon.
    skyTop: '#20305e',
    skyMid: '#7a6a8e',
    skyBottom: '#d8a071',
    farLayer: '#9a7c74',
    midLayer: '#6b5450',
    nearLayer: '#3d3029',
    fog: '#c08a63',
    fogNear: 70,
    fogFar: 320,
    sunColor: '#ffb877',
    sunIntensity: 2.5,
    hemiSky: '#8ea6c8',
    hemiGround: '#6a4a30',
    hemiIntensity: 1.4,
    // Low enough for raking shadows, high enough that a flat pan still lights.
    sunPosition: [18, 6.5, 9],
    starDensity: 0,
    particleColor: '#f0d2b0',
    particleDensity: 0.5,
  },

  'mars-descent': {
    key: 'mars-descent',
    skyTop: '#3a1d1c',
    skyMid: '#8a4526',
    skyBottom: '#d0854a',
    farLayer: '#a85f31',
    midLayer: '#70401f',
    nearLayer: '#3d2415',
    fog: '#a15c30',
    fogNear: 40,
    fogFar: 200,
    sunColor: '#ffd9a0',
    sunIntensity: 3.6,
    hemiSky: '#e0a06a',
    hemiGround: '#3a2216',
    hemiIntensity: 2.5,
    sunPosition: [-8, 10, 6],
    starDensity: 0.12,
    particleColor: '#e3b184',
    particleDensity: 1.1,
  },
};

export function paletteFor(sceneKey: string): ScenePalette {
  return PALETTES[sceneKey] ?? PALETTES['deep-quiet'];
}

/** Blend two palettes so a leg change can cross-fade rather than cut. */
export function lerpPalette(a: ScenePalette, b: ScenePalette, t: number): ScenePalette {
  const mixColor = (x: string, y: string) =>
    `#${new THREE.Color(x).lerp(new THREE.Color(y), t).getHexString()}`;
  const mixNumber = (x: number, y: number) => x + (y - x) * t;

  return {
    ...b,
    skyTop: mixColor(a.skyTop, b.skyTop),
    skyMid: mixColor(a.skyMid, b.skyMid),
    skyBottom: mixColor(a.skyBottom, b.skyBottom),
    farLayer: mixColor(a.farLayer, b.farLayer),
    midLayer: mixColor(a.midLayer, b.midLayer),
    nearLayer: mixColor(a.nearLayer, b.nearLayer),
    fog: mixColor(a.fog, b.fog),
    fogNear: mixNumber(a.fogNear, b.fogNear),
    fogFar: mixNumber(a.fogFar, b.fogFar),
    sunColor: mixColor(a.sunColor, b.sunColor),
    sunIntensity: mixNumber(a.sunIntensity, b.sunIntensity),
    hemiSky: mixColor(a.hemiSky, b.hemiSky),
    hemiGround: mixColor(a.hemiGround, b.hemiGround),
    hemiIntensity: mixNumber(a.hemiIntensity, b.hemiIntensity),
    starDensity: mixNumber(a.starDensity, b.starDensity),
    particleColor: mixColor(a.particleColor, b.particleColor),
    particleDensity: mixNumber(a.particleDensity, b.particleDensity),
  };
}
