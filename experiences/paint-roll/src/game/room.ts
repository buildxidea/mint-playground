import { Vector3 } from 'three';

/**
 * The room. One room is the whole game now, so this is the only level data.
 *
 * Deliberately small: each wall should feel finishable in a pass or two rather
 * than being a chore, and there are five surfaces to get through.
 */
export const ROOM = {
  /** Along world X. */
  width: 3.0,
  /** Along world Z. */
  depth: 3.0,
  height: 2.4,
  /** Full roller load, in paint units. */
  capacity: 100,
  /** Paint units consumed per square metre rolled. */
  drainPerSquareMetre: 9,
  /** Seconds for an empty roller to come back to full. */
  refillSeconds: 1.1,
  /** Paint render-target resolution on each surface's long axis. */
  paintResolution: 1024,
} as const;

/**
 * Where a paintable surface sits in the room.
 *
 * `origin` is the world position of surface-local (0, 0); `right` and `up` are
 * its in-plane axes; `normal` points into the room. Everything else — the
 * roller's orientation, edge crossings, camera framing — is derived from these,
 * so no system needs to special-case which wall it is looking at.
 */
export interface SurfacePlacement {
  readonly id: string;
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly origin: Vector3;
  readonly right: Vector3;
  readonly up: Vector3;
  readonly normal: Vector3;
  /** Registry key for the Mint grime material. */
  readonly grimeKey: string;
  /** Metres of wall covered by one tile of that material. */
  readonly textureMetres: number;
}

const { width: W, depth: D, height: H } = ROOM;

/**
 * Walls are ordered so that moving right along wall N leads onto wall N+1.
 * Each wall's right edge is the next wall's left edge, which is what makes the
 * edge-crossing rule a single line of code instead of four special cases.
 */
export const SURFACES: readonly SurfacePlacement[] = [
  {
    id: 'north',
    index: 0,
    width: W,
    height: H,
    origin: new Vector3(-W / 2, 0, -D / 2),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    normal: new Vector3(0, 0, 1),
    grimeKey: 'mat-plaster-damp',
    textureMetres: 2.4,
  },
  {
    id: 'east',
    index: 1,
    width: D,
    height: H,
    origin: new Vector3(W / 2, 0, -D / 2),
    right: new Vector3(0, 0, 1),
    up: new Vector3(0, 1, 0),
    normal: new Vector3(-1, 0, 0),
    grimeKey: 'mat-concrete-graffiti',
    textureMetres: 2.8,
  },
  {
    id: 'south',
    index: 2,
    width: W,
    height: H,
    origin: new Vector3(W / 2, 0, D / 2),
    right: new Vector3(-1, 0, 0),
    up: new Vector3(0, 1, 0),
    normal: new Vector3(0, 0, -1),
    grimeKey: 'mat-plaster-damp',
    textureMetres: 2.4,
  },
  {
    id: 'west',
    index: 3,
    width: D,
    height: H,
    origin: new Vector3(-W / 2, 0, D / 2),
    right: new Vector3(0, 0, -1),
    up: new Vector3(0, 1, 0),
    normal: new Vector3(1, 0, 0),
    grimeKey: 'mat-brick-grimy',
    textureMetres: 2.3,
  },
];

export const WALL_COUNT = 4;

/** The ceiling is scenery, not a paintable surface. */
export const CEILING_Y = H;

/** Total paintable area, used to weight the room-wide coverage percentage. */
export const TOTAL_AREA = SURFACES.reduce(
  (sum, surface) => sum + surface.width * surface.height,
  0,
);
