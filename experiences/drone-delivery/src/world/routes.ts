import type { PackageColorId } from '../sim/config';

/**
 * The delivery routes. Everything the world builder needs is data here:
 * building placements, which rooftops take pads, wires, hazards, wind, and
 * the scoring pars. Coordinates are metres on the ground plane (x east,
 * z south); the dispatch pad is always on the ground.
 *
 * Convention: pad-hosting buildings come first in `buildings` (deliveries
 * index into the array), filler skyline follows.
 */

export type BuildingKind = 'aptSmall' | 'aptMedium' | 'tower';

export interface BuildingDef {
  kind: BuildingKind;
  pos: [number, number];
  rotY?: number;
  /** Multiplies the building's fitted height (and footprint). */
  scale?: number;
  /** Rooftop dressing that also becomes an obstacle. */
  roof?: Array<'antenna' | 'waterTower'>;
}

export interface DeliveryDef {
  color: PackageColorId;
  /** Pad size multiplier: smaller = tighter landing zone. */
  padScale: number;
  /** Rooftop destination: index into `buildings`. */
  building?: number;
  /** Ground destination (park corner, plaza): world position. */
  ground?: [number, number];
  /** Bridge destination: index into `bridges`; the pad sits mid-span. */
  bridge?: number;
}

export interface ParkDef {
  pos: [number, number];
  radius: number;
}

export interface BridgeDef {
  from: [number, number];
  to: [number, number];
  /** Deck height above the ground. */
  height: number;
}

export interface WireDef {
  from: [number, number];
  to: [number, number];
  /** Fraction of pylon height where the wire hangs. */
  sag: number;
}

export type HazardDef =
  | { kind: 'crane'; pos: [number, number]; jib: number; speed: number; height: number }
  | { kind: 'blimp'; center: [number, number, number]; radius: number; speed: number };

export interface RouteDef {
  id: number;
  name: string;
  tagline: string;
  parTime: number;
  batterySeconds: number;
  wind: { base: [number, number]; variability: number; gust: number };
  dispatch: [number, number];
  buildings: BuildingDef[];
  deliveries: DeliveryDef[];
  parks?: ParkDef[];
  bridges?: BridgeDef[];
  trees: Array<[number, number]>;
  /** Pylon positions; wires connect the listed pairs. */
  pylons: Array<[number, number]>;
  wires: WireDef[];
  hazards: HazardDef[];
  clouds: number;
}

export const ROUTES: RouteDef[] = [
  {
    id: 1,
    name: 'First Flight',
    tagline: 'One easy drop across the park.',
    parTime: 55,
    batterySeconds: 150,
    wind: { base: [0.4, 0.2], variability: 0.25, gust: 0 },
    dispatch: [0, 18],
    buildings: [
      { kind: 'aptSmall', pos: [-14, -12] },
      { kind: 'aptSmall', pos: [14, -14] },
      { kind: 'aptMedium', pos: [0, -26], scale: 0.85 },
      { kind: 'aptSmall', pos: [26, 2], scale: 0.9 },
      { kind: 'aptMedium', pos: [-28, -2], scale: 0.8 },
      { kind: 'aptSmall', pos: [-26, -24], scale: 0.85 },
    ],
    deliveries: [{ color: 'coral', building: 0, padScale: 1.25 }],
    parks: [{ pos: [12, 6], radius: 7 }],
    trees: [
      [-6, 4],
      [7, 2],
      [-2, -6],
      [12, -2],
      [22, -6],
    ],
    pylons: [],
    wires: [],
    hazards: [],
    clouds: 4,
  },
  {
    id: 2,
    name: 'Cross Town',
    tagline: 'Two drops, mind the power lines.',
    parTime: 125,
    batterySeconds: 185,
    wind: { base: [0.8, -0.4], variability: 0.4, gust: 0.4 },
    dispatch: [0, 26],
    buildings: [
      { kind: 'aptSmall', pos: [-20, 2] },
      { kind: 'aptMedium', pos: [22, -8] },
      { kind: 'aptSmall', pos: [-16, -24], roof: ['antenna'] },
      { kind: 'aptMedium', pos: [4, -30], scale: 0.9 },
      { kind: 'aptSmall', pos: [-32, -10], scale: 0.9 },
      { kind: 'aptSmall', pos: [32, 8], scale: 0.85 },
      { kind: 'aptSmall', pos: [16, -28], scale: 0.95 },
      { kind: 'aptMedium', pos: [-30, 14], scale: 0.75 },
    ],
    deliveries: [
      { color: 'teal', building: 0, padScale: 1.05 },
      { color: 'gold', building: 1, padScale: 1.0 },
      { color: 'coral', ground: [22, 18], padScale: 1.0 },
    ],
    parks: [{ pos: [22, 18], radius: 6 }],
    bridges: [{ from: [-6, 8], to: [10, 8], height: 6 }],
    trees: [
      [-8, 12],
      [10, 10],
      [16, 6],
      [-4, -10],
      [26, 18],
    ],
    pylons: [
      [-6, -4],
      [10, -6],
    ],
    wires: [{ from: [-6, -4], to: [10, -6], sag: 0.82 }],
    hazards: [],
    clouds: 5,
  },
  {
    id: 3,
    name: 'Windy Rooftops',
    tagline: 'Gusts, antennas, and higher drops.',
    parTime: 120,
    batterySeconds: 180,
    wind: { base: [1.6, 0.9], variability: 0.9, gust: 0.9 },
    dispatch: [-4, 30],
    buildings: [
      { kind: 'aptMedium', pos: [-22, -2], roof: ['waterTower'] },
      { kind: 'aptMedium', pos: [18, -6], scale: 1.1, roof: ['antenna'] },
      { kind: 'tower', pos: [-4, -26], scale: 0.8 },
      { kind: 'aptSmall', pos: [24, -26], roof: ['antenna'] },
      { kind: 'aptSmall', pos: [-28, -24] },
      { kind: 'aptMedium', pos: [8, -36], scale: 0.85 },
      { kind: 'aptSmall', pos: [-34, 10], scale: 0.9 },
      { kind: 'aptSmall', pos: [34, -14], scale: 0.85 },
      { kind: 'aptMedium', pos: [30, 8], scale: 0.75 },
    ],
    deliveries: [
      { color: 'coral', building: 1, padScale: 0.95 },
      { color: 'violet', building: 2, padScale: 0.9 },
    ],
    parks: [{ pos: [-14, 22], radius: 6 }],
    bridges: [{ from: [-28, -24], to: [-4, -26], height: 7 }],
    trees: [
      [6, 14],
      [-12, 10],
      [14, 8],
      [-18, 18],
    ],
    pylons: [
      [-14, -12],
      [4, -14],
    ],
    wires: [{ from: [-14, -12], to: [4, -14], sag: 0.8 }],
    hazards: [{ kind: 'crane', pos: [0, -4], jib: 20, speed: 0.22, height: 30 }],
    clouds: 7,
  },
  {
    id: 4,
    name: 'Crane Alley',
    tagline: 'Thread the gap, dodge the jib.',
    parTime: 185,
    batterySeconds: 215,
    wind: { base: [1.0, -1.2], variability: 0.7, gust: 0.7 },
    dispatch: [0, 34],
    buildings: [
      { kind: 'tower', pos: [-14, -4], scale: 0.85 },
      { kind: 'tower', pos: [13, -6], scale: 0.9, roof: ['antenna'] },
      { kind: 'aptMedium', pos: [-26, -22], roof: ['waterTower'] },
      { kind: 'aptMedium', pos: [26, -24], scale: 1.05 },
      { kind: 'aptSmall', pos: [0, -38] },
      { kind: 'aptSmall', pos: [-30, 6] },
      { kind: 'aptSmall', pos: [-16, 20], scale: 0.9 },
      { kind: 'aptSmall', pos: [34, -6], scale: 0.85 },
      { kind: 'aptMedium', pos: [-38, -8], scale: 0.9 },
      { kind: 'aptSmall', pos: [16, 22], scale: 0.8 },
    ],
    deliveries: [
      { color: 'teal', building: 0, padScale: 0.85 },
      { color: 'gold', building: 3, padScale: 0.85 },
      { color: 'coral', building: 4, padScale: 0.9 },
      { color: 'violet', bridge: 0, padScale: 0.8 },
    ],
    bridges: [{ from: [-14, -4], to: [13, -6], height: 13 }],
    trees: [
      [8, 16],
      [-8, 18],
      [18, 4],
      [-22, 14],
    ],
    pylons: [
      [-8, -30],
      [10, -32],
    ],
    wires: [{ from: [-8, -30], to: [10, -32], sag: 0.8 }],
    hazards: [
      { kind: 'crane', pos: [-6, 2], jib: 20, speed: 0.28, height: 30 },
      { kind: 'blimp', center: [0, 16, 14], radius: 12, speed: 0.16 },
    ],
    clouds: 7,
  },
  {
    id: 5,
    name: 'Summit Rush',
    tagline: 'Tight pads, tall towers, thin battery.',
    parTime: 180,
    batterySeconds: 190,
    wind: { base: [2.0, 1.4], variability: 1.1, gust: 1.1 },
    dispatch: [4, 38],
    buildings: [
      { kind: 'tower', pos: [-18, -2], scale: 1.0, roof: ['antenna'] },
      { kind: 'tower', pos: [16, -8], scale: 1.15, roof: ['antenna'] },
      { kind: 'tower', pos: [-2, -30], scale: 1.3, roof: ['waterTower'] },
      { kind: 'aptMedium', pos: [-30, -20], roof: ['waterTower'] },
      { kind: 'aptMedium', pos: [30, -26], scale: 0.95 },
      { kind: 'aptSmall', pos: [-12, 16] },
      { kind: 'aptSmall', pos: [22, 12] },
      { kind: 'aptMedium', pos: [12, 24], scale: 0.8 },
      { kind: 'aptSmall', pos: [-34, 24], scale: 0.9 },
      { kind: 'aptMedium', pos: [36, 4], scale: 0.85 },
      { kind: 'aptSmall', pos: [-36, 2], scale: 0.8 },
    ],
    deliveries: [
      { color: 'violet', building: 0, padScale: 0.7 },
      { color: 'teal', building: 1, padScale: 0.65 },
      { color: 'gold', building: 2, padScale: 0.62 },
    ],
    parks: [{ pos: [18, 26], radius: 7 }],
    bridges: [{ from: [-18, -2], to: [16, -8], height: 26 }],
    trees: [
      [2, 20],
      [-22, 8],
      [28, 20],
    ],
    pylons: [
      [-10, -14],
      [6, -16],
      [-24, 10],
    ],
    wires: [
      { from: [-10, -14], to: [6, -16], sag: 0.8 },
      { from: [-24, 10], to: [-10, -14], sag: 0.78 },
    ],
    hazards: [
      { kind: 'crane', pos: [2, 22], jib: 20, speed: 0.36, height: 30 },
      { kind: 'blimp', center: [4, 18, 14], radius: 12, speed: 0.2 },
    ],
    clouds: 9,
  },
  {
    id: 6,
    name: 'Downtown Sprint',
    tagline: 'A packed grid and no straight lines.',
    parTime: 200,
    batterySeconds: 225,
    wind: { base: [1.2, 0.6], variability: 0.8, gust: 0.8 },
    dispatch: [0, 40],
    buildings: [
      { kind: 'aptMedium', pos: [-18, 8] },
      { kind: 'tower', pos: [14, -2], scale: 0.9, roof: ['antenna'] },
      { kind: 'aptMedium', pos: [-6, -24], scale: 1.05, roof: ['waterTower'] },
      { kind: 'aptSmall', pos: [22, -22] },
      { kind: 'aptSmall', pos: [-32, 14], scale: 0.9 },
      { kind: 'aptMedium', pos: [30, 14], scale: 0.9 },
      { kind: 'aptSmall', pos: [-24, -10] },
      { kind: 'tower', pos: [-34, -26], scale: 0.75 },
      { kind: 'aptSmall', pos: [8, 18], scale: 0.85 },
      { kind: 'aptMedium', pos: [36, -8], scale: 0.85 },
      { kind: 'aptSmall', pos: [-12, -40], scale: 0.9 },
      { kind: 'aptMedium', pos: [12, -38], scale: 0.8 },
    ],
    deliveries: [
      { color: 'teal', building: 0, padScale: 0.9 },
      { color: 'coral', building: 1, padScale: 0.8 },
      { color: 'violet', building: 2, padScale: 0.8 },
      { color: 'gold', ground: [-20, 30], padScale: 0.85 },
    ],
    parks: [{ pos: [-20, 30], radius: 8 }],
    bridges: [{ from: [-18, 8], to: [14, -2], height: 12 }],
    trees: [
      [-8, 26],
      [12, 28],
      [-20, 28],
      [24, 4],
    ],
    pylons: [
      [-12, -8],
      [4, -12],
    ],
    wires: [{ from: [-12, -8], to: [4, -12], sag: 0.8 }],
    hazards: [
      { kind: 'crane', pos: [-10, -8], jib: 20, speed: 0.3, height: 30 },
      { kind: 'blimp', center: [-14, 16, 12], radius: 20, speed: 0.24 },
    ],
    clouds: 8,
  },
  {
    id: 7,
    name: 'Twin Peaks',
    tagline: 'Two summits, one jib between them.',
    parTime: 240,
    batterySeconds: 235,
    wind: { base: [1.8, -1.0], variability: 1.0, gust: 1.0 },
    dispatch: [-2, 42],
    buildings: [
      { kind: 'tower', pos: [-16, -6], scale: 1.1, roof: ['antenna'] },
      { kind: 'tower', pos: [18, -10], scale: 1.2, roof: ['waterTower'] },
      { kind: 'aptMedium', pos: [0, -34], scale: 1.1, roof: ['antenna'] },
      { kind: 'aptMedium', pos: [-32, -18], scale: 0.95 },
      { kind: 'aptSmall', pos: [-28, 10] },
      { kind: 'aptSmall', pos: [26, 12] },
      { kind: 'aptMedium', pos: [34, -24], scale: 0.9 },
      { kind: 'aptSmall', pos: [-8, 16] },
      { kind: 'tower', pos: [36, 6], scale: 0.7 },
      { kind: 'aptSmall', pos: [12, -42], scale: 0.9 },
      { kind: 'aptSmall', pos: [-40, -2], scale: 0.85 },
    ],
    deliveries: [
      { color: 'gold', building: 0, padScale: 0.7 },
      { color: 'violet', building: 1, padScale: 0.65 },
      { color: 'teal', building: 2, padScale: 0.75 },
      { color: 'coral', bridge: 0, padScale: 0.7 },
    ],
    bridges: [{ from: [-16, -6], to: [18, -10], height: 18 }],
    trees: [
      [4, 24],
      [-18, 24],
      [30, -2],
    ],
    pylons: [
      [-10, -20],
      [8, -22],
      [22, 2],
    ],
    wires: [
      { from: [-10, -20], to: [8, -22], sag: 0.8 },
      { from: [8, -22], to: [22, 2], sag: 0.78 },
    ],
    hazards: [
      { kind: 'crane', pos: [2, 20], jib: 20, speed: 0.34, height: 30 },
      { kind: 'blimp', center: [2, 16, 14], radius: 14, speed: 0.18 },
    ],
    clouds: 9,
  },
  {
    id: 8,
    name: 'Rush Hour',
    tagline: 'Four drops. Two cranes. Every hazard at once.',
    parTime: 240,
    batterySeconds: 230,
    wind: { base: [2.2, 1.2], variability: 1.2, gust: 1.2 },
    dispatch: [4, 44],
    buildings: [
      { kind: 'tower', pos: [-20, 0], scale: 1.05, roof: ['antenna'] },
      { kind: 'tower', pos: [16, -6], scale: 1.25, roof: ['antenna'] },
      { kind: 'tower', pos: [-4, -32], scale: 1.35, roof: ['waterTower'] },
      { kind: 'aptMedium', pos: [32, -24], scale: 1.0, roof: ['waterTower'] },
      { kind: 'aptMedium', pos: [-34, -12], scale: 0.95 },
      { kind: 'aptSmall', pos: [-30, 16] },
      { kind: 'aptSmall', pos: [28, 12] },
      { kind: 'aptMedium', pos: [8, 20], scale: 0.85 },
      { kind: 'tower', pos: [-36, -32], scale: 0.8 },
      { kind: 'aptSmall', pos: [40, -4], scale: 0.9 },
      { kind: 'aptMedium', pos: [22, -40], scale: 0.9 },
      { kind: 'aptSmall', pos: [-14, -14], scale: 0.9 },
      { kind: 'aptSmall', pos: [-44, 4], scale: 0.85 },
    ],
    deliveries: [
      { color: 'coral', building: 0, padScale: 0.65 },
      { color: 'teal', building: 1, padScale: 0.6 },
      { color: 'gold', building: 2, padScale: 0.6 },
      { color: 'violet', building: 3, padScale: 0.7 },
    ],
    parks: [{ pos: [-10, 30], radius: 8 }],
    bridges: [{ from: [-20, 0], to: [16, -6], height: 15 }],
    trees: [
      [-6, 28],
      [18, 28],
      [-24, 28],
    ],
    pylons: [
      [-8, -18],
      [10, -20],
      [-26, 8],
    ],
    wires: [
      { from: [-8, -18], to: [10, -20], sag: 0.8 },
      { from: [-26, 8], to: [-8, -18], sag: 0.78 },
    ],
    hazards: [
      { kind: 'crane', pos: [2, 24], jib: 20, speed: 0.4, height: 30 },
      { kind: 'crane', pos: [-32, 30], jib: 20, speed: 0.3, height: 30 },
      { kind: 'blimp', center: [14, 21, -2], radius: 20, speed: 0.22 },
    ],
    clouds: 10,
  },
];
