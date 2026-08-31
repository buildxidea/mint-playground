/**
 * Level data. Adding a level must be a new entry here and nothing else.
 *
 * World space: XZ plane, +X east, +Z south. Y is up.
 * "NS" stripes run along Z, "EW" stripes run along X.
 */

export type Rect = {
  /** center */
  x: number;
  z: number;
  /** full size */
  w: number;
  d: number;
};

export type Circle = {
  x: number;
  z: number;
  r: number;
};

export type ObstacleKind = 'tree' | 'bush' | 'gnome' | 'fence' | 'patio' | 'pool';

export type Obstacle =
  | ({ kind: ObstacleKind; shape: 'circle' } & Circle)
  | ({ kind: ObstacleKind; shape: 'rect' } & Rect);

export type PatternTarget = 'ns' | 'ew' | 'cross';

export type Level = {
  id: string;
  name: string;
  /** Union of mowable rectangles. Supports rectangles and L shapes. */
  yard: Rect[];
  /** Non-mowable, non-blocking cutouts (excluded from the coverage denominator). */
  holes: Rect[];
  /** Props. All are blocking and are excluded from the coverage denominator. */
  obstacles: Obstacle[];
  target: PatternTarget;
  /** Litres in the tank. */
  fuel: number;
  spawn: { x: number; z: number; heading: 'north' | 'south' | 'east' | 'west' };
  pass: { coverage: number; pattern: number };
  hint: string;
};

export const LEVELS: Level[] = [
  {
    id: 'l1',
    name: 'The Easy Rectangle',
    yard: [{ x: 0, z: 0, w: 16, d: 12 }],
    holes: [],
    obstacles: [],
    target: 'ns',
    fuel: 75,
    spawn: { x: -7, z: 5, heading: 'north' },
    pass: { coverage: 0.92, pattern: 0.6 },
    hint: 'Mow north to south. Straight lanes, no gaps.',
  },
  {
    id: 'l2',
    name: 'Around the Oak',
    yard: [{ x: 0, z: 0, w: 18, d: 13 }],
    holes: [],
    obstacles: [
      { kind: 'tree', shape: 'circle', x: -2.5, z: -1.5, r: 1.5 },
      { kind: 'bush', shape: 'rect', x: 5.5, z: 3.2, w: 3.4, d: 2.2 },
      { kind: 'gnome', shape: 'circle', x: -6.4, z: 4.2, r: 0.45 },
    ],
    target: 'ns',
    fuel: 82,
    spawn: { x: -8, z: 5.5, heading: 'north' },
    pass: { coverage: 0.95, pattern: 0.7 },
    hint: 'Keep the lanes going after you steer around something.',
  },
  {
    id: 'l3',
    name: 'The Side Yard',
    yard: [
      { x: 0, z: 4, w: 18, d: 8 },
      { x: -4.5, z: -4, w: 9, d: 8 },
    ],
    holes: [],
    obstacles: [
      { kind: 'fence', shape: 'rect', x: 4.5, z: -0.2, w: 9, d: 0.4 },
      { kind: 'gnome', shape: 'circle', x: -7, z: -6, r: 0.45 },
      { kind: 'gnome', shape: 'circle', x: 6.5, z: 6, r: 0.45 },
      { kind: 'bush', shape: 'rect', x: -1.5, z: -6.4, w: 2.6, d: 1.8 },
    ],
    target: 'ew',
    fuel: 70,
    spawn: { x: -8, z: 7, heading: 'east' },
    pass: { coverage: 0.95, pattern: 0.7 },
    hint: 'East to west this time. The corner is where fuel goes to die.',
  },
  {
    id: 'l4',
    name: 'Poolside',
    yard: [{ x: 0, z: 0, w: 24, d: 16 }],
    holes: [],
    obstacles: [
      { kind: 'patio', shape: 'rect', x: -8, z: -5, w: 7, d: 4.5 },
      { kind: 'pool', shape: 'circle', x: 6, z: 2, r: 2.8 },
      { kind: 'tree', shape: 'circle', x: 2.5, z: -5, r: 1.5 },
      { kind: 'bush', shape: 'rect', x: -6, z: 6, w: 4, d: 2 },
      { kind: 'gnome', shape: 'circle', x: 10.5, z: -6, r: 0.45 },
    ],
    target: 'ns',
    fuel: 88,
    spawn: { x: -11, z: 7, heading: 'north' },
    pass: { coverage: 0.95, pattern: 0.72 },
    hint: 'Big yard, tight tank. Wasted overlap is wasted fuel.',
  },
  {
    id: 'l5',
    name: 'Crosshatch',
    yard: [{ x: 0, z: 0, w: 18, d: 12 }],
    holes: [],
    obstacles: [
      { kind: 'tree', shape: 'circle', x: 4, z: -2, r: 1.4 },
      { kind: 'gnome', shape: 'circle', x: -7, z: 4.5, r: 0.45 },
    ],
    target: 'cross',
    fuel: 105,
    spawn: { x: -8, z: 5, heading: 'north' },
    pass: { coverage: 0.95, pattern: 0.6 },
    hint: 'Mow it twice: once north-south, then again east-west.',
  },
];

export function levelIndexById(id: string): number {
  return LEVELS.findIndex((level) => level.id === id);
}

export const PATTERN_LABEL: Record<PatternTarget, string> = {
  ns: 'North / South',
  ew: 'East / West',
  cross: 'Crosshatch',
};
