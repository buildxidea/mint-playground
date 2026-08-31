/** Cube sizes the app offers. */
export const CUBE_SIZES = [2, 3, 4, 5, 6] as const;
export type CubeSize = (typeof CUBE_SIZES)[number];
export const DEFAULT_SIZE: CubeSize = 3;

export function isCubeSize(value: unknown): value is CubeSize {
  return CUBE_SIZES.includes(value as CubeSize);
}

/**
 * Grid coordinates are DOUBLED integers.
 *
 * An even cube's layers sit at half-integer offsets from the centre (a 4x4 has
 * layers at -1.5, -0.5, 0.5, 1.5), which would force floats into the one place
 * that must stay exact. Doubling makes every coordinate an integer for every
 * size: a 3x3 uses -2, 0, 2 and a 4x4 uses -3, -1, 1, 3. Rotation is linear, so
 * the same integer rotation applies to positions and orientation vectors alike.
 */
export function extentOf(n: number): number {
  return n - 1;
}

/** The doubled coordinates for a cube of size n, low to high. */
export function coordsOf(n: number): number[] {
  const extent = extentOf(n);
  const out: number[] = [];
  for (let c = -extent; c <= extent; c += 2) out.push(c);
  return out;
}

/**
 * Every size occupies the same world extent, so the camera framing and the
 * cube's apparent size never change when switching tabs.
 */
export const WORLD_EXTENT = 3.18;

/** Fraction of a cell filled by the cubie; the remainder is the black gap. */
const FILL = 1 / 1.06;

/** Centre-to-centre spacing between cubies, in world units. */
export function spacingOf(n: number): number {
  return WORLD_EXTENT / n;
}

/** Edge length of one cubie, in world units. */
export function cubieSizeOf(n: number): number {
  return spacingOf(n) * FILL;
}

/** Sticker tile size as a fraction of the cubie face. */
export const STICKER_SCALE = 0.82;

/** Sticker corner radius as a fraction of the tile width. */
export const STICKER_RADIUS = 0.14;

/** How far a sticker floats above the cubie surface, relative to cubie size. */
export const STICKER_OFFSET_RATIO = 0.006;

export type Axis = 0 | 1 | 2;
export const X: Axis = 0;
export const Y: Axis = 1;
export const Z: Axis = 2;

export type Vec3i = [number, number, number];

export type FaceId = "U" | "D" | "F" | "B" | "R" | "L";

export const FACE_NORMALS: Record<FaceId, Vec3i> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};

/**
 * Standard Western / BOY scheme. Flat opaque paint colours - no emissive,
 * no sheen. The reference screenshot fixes the palette; the face assignment
 * is the conventional one.
 */
export const FACE_COLORS: Record<FaceId, number> = {
  U: 0xffffff, // white
  D: 0xffd500, // yellow
  F: 0x009b48, // green
  B: 0x0045ad, // blue
  R: 0xb90000, // red
  L: 0xff5900, // orange
};

export const FACE_IDS: FaceId[] = ["U", "D", "F", "B", "R", "L"];

/**
 * Precomputed [face, normal] pairs. The solver walks this millions of times,
 * so it must not rebuild an array on every call.
 */
export const FACE_NORMAL_LIST: ReadonlyArray<readonly [FaceId, Vec3i]> =
  FACE_IDS.map((id) => [id, FACE_NORMALS[id]] as const);

/** Which axis a signed unit vector points along. */
export function axisOfNormal(v: Vec3i): Axis {
  return (v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2) as Axis;
}

export const BACKGROUNDS = {
  black: 0x000000,
  white: 0xffffff,
} as const;

export type BackgroundName = keyof typeof BACKGROUNDS;
