import {
  Axis,
  FACE_COLORS,
  FACE_NORMAL_LIST,
  FaceId,
  Vec3i,
  X,
  Y,
  Z,
  axisOfNormal,
  coordsOf,
  extentOf,
} from "./constants";

/**
 * Logical cube state for any size N.
 *
 * Everything here is INTEGER arithmetic. Positions are doubled grid
 * coordinates and orientations are signed unit basis vectors, so no amount of
 * turning can introduce floating point drift. The Three.js scene is rendered
 * FROM this state after every move, never the other way around.
 */

/** A quarter turn count: 1 = +90 deg about the axis, -1 = -90, 2 = 180. */
export type Turns = 1 | -1 | 2;

export interface Move {
  axis: Axis;
  /** Doubled grid coordinate of the slice being turned. */
  layer: number;
  turns: Turns;
}

export interface Cubie {
  /** Solved-state grid position. Identifies the piece for all time. */
  readonly home: Vec3i;
  /** Current grid position. */
  pos: Vec3i;
  /**
   * Orientation as the world directions of the cubie's local +X, +Y, +Z axes.
   * Identity is [[1,0,0],[0,1,0],[0,0,1]].
   */
  orient: [Vec3i, Vec3i, Vec3i];
}

/** Rotate a vector +90 degrees about an axis (right-hand rule). */
export function rotateVec(v: Vec3i, axis: Axis, turns: Turns): Vec3i {
  const out: Vec3i = [v[0], v[1], v[2]];
  rotateVecInPlace(out, axis, turns);
  return out;
}

/**
 * In-place rotation. The solver applies and un-applies millions of moves, so
 * the hot path must not allocate.
 */
export function rotateVecInPlace(v: Vec3i, axis: Axis, turns: Turns): void {
  const steps = turns === 2 ? 2 : 1;
  const forward = turns !== -1;
  for (let i = 0; i < steps; i++) {
    const x = v[0];
    const y = v[1];
    const z = v[2];
    if (axis === X) {
      // (x, y, z) -> (x, -z, y)
      v[1] = forward ? -z : z;
      v[2] = forward ? y : -y;
    } else if (axis === Y) {
      // (x, y, z) -> (z, y, -x)
      v[0] = forward ? z : -z;
      v[2] = forward ? -x : x;
    } else {
      // (x, y, z) -> (-y, x, z)
      v[0] = forward ? -y : y;
      v[1] = forward ? x : -x;
    }
  }
}

function dot(a: Vec3i, b: Vec3i): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function eq(a: Vec3i, b: Vec3i): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function identityOrient(): [Vec3i, Vec3i, Vec3i] {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

/**
 * Colour of the sticker on the given LOCAL direction, or null if the cubie
 * carries no sticker there. A cubie has a sticker wherever its home position
 * was on the outside.
 */
export function stickerColorOnLocalDir(
  home: Vec3i,
  dir: Vec3i,
  extent: number,
): number | null {
  for (const [face, normal] of FACE_NORMAL_LIST) {
    if (!eq(normal, dir)) continue;
    const axis = axisOfNormal(normal);
    const sign = normal[axis];
    return home[axis] === sign * extent ? FACE_COLORS[face] : null;
  }
  return null;
}

/**
 * Allocation-free "is this piece showing the right colours" test.
 *
 * Solvedness is judged by VISIBLE STICKERS, not by piece identity. A cubie
 * shows a sticker on axis `a` only while it sits on that outer layer, and that
 * sticker is correct exactly when the cubie's local axis a still maps to world
 * axis a (orient[a][a] === 1) and it came from that same layer.
 *
 * Two consequences, both of them the real puzzle's behaviour rather than a
 * relaxation of it:
 *  - a centre can spin about its own axis and still be indistinguishable from
 *    solved, which several standard algorithms rely on;
 *  - on a 4x4 and up the same-coloured centre pieces of one face are truly
 *    interchangeable, so demanding each return to its exact original slot
 *    would be stricter than the puzzle and could reject a solved cube.
 *
 * On a 3x3 or 2x2 every piece is uniquely coloured, so this coincides exactly
 * with "the piece is home and oriented".
 */
export function pieceSolvedFast(c: Cubie, extent: number): boolean {
  const { pos, home, orient } = c;
  for (let a = 0; a < 3; a++) {
    // The cubie only shows a sticker on axis `a` when it currently sits on
    // that outer layer. Axes where it shows nothing are unconstrained.
    if (pos[a] !== extent && pos[a] !== -extent) continue;
    if (home[a] !== pos[a]) return false;
    if (orient[a][a] !== 1) return false;
  }
  return true;
}

/** Is this piece's up-facing sticker the U colour? Allocation free. */
export function upStickerUp(c: Cubie): boolean {
  return c.orient[1][1] === 1;
}

export class CubeState {
  readonly n: number;
  readonly extent: number;
  cubies: Cubie[] = [];
  /** home key -> cubie. Piece identity never changes, so this is built once. */
  private homeIndex = new Map<string, Cubie>();

  constructor(n: number) {
    this.n = n;
    this.extent = extentOf(n);
    this.build();
  }

  private reindex(): void {
    this.homeIndex.clear();
    for (const c of this.cubies) {
      this.homeIndex.set(`${c.home[0]},${c.home[1]},${c.home[2]}`, c);
    }
  }

  private build(): void {
    this.cubies = [];
    const coords = coordsOf(this.n);
    const extent = this.extent;
    for (const x of coords) {
      for (const y of coords) {
        for (const z of coords) {
          // Skip the invisible core: a cubie is visible only if it touches at
          // least one outer face.
          if (
            Math.abs(x) !== extent &&
            Math.abs(y) !== extent &&
            Math.abs(z) !== extent
          ) {
            continue;
          }
          const home: Vec3i = [x, y, z];
          this.cubies.push({
            home,
            pos: [x, y, z],
            orient: identityOrient(),
          });
        }
      }
    }
    this.reindex();
  }

  /**
   * Return to solved by restoring each cubie IN PLACE.
   *
   * Cubie identity must survive a reset: CubeView keys its scene objects by
   * cubie reference, so replacing the objects here would orphan every entry in
   * that map and the view could no longer find anything to move.
   */
  reset(): void {
    if (this.cubies.length === 0) {
      this.build();
      return;
    }
    for (const c of this.cubies) {
      c.pos[0] = c.home[0];
      c.pos[1] = c.home[1];
      c.pos[2] = c.home[2];
      c.orient[0][0] = 1; c.orient[0][1] = 0; c.orient[0][2] = 0;
      c.orient[1][0] = 0; c.orient[1][1] = 1; c.orient[1][2] = 0;
      c.orient[2][0] = 0; c.orient[2][1] = 0; c.orient[2][2] = 1;
    }
  }

  clone(): CubeState {
    const copy = new CubeState(this.n);
    copy.cubies = this.cubies.map((c) => ({
      home: c.home,
      pos: [...c.pos] as Vec3i,
      orient: [
        [...c.orient[0]] as Vec3i,
        [...c.orient[1]] as Vec3i,
        [...c.orient[2]] as Vec3i,
      ],
    }));
    copy.reindex();
    return copy;
  }

  /** Every distinct layer coordinate on an axis. */
  layerCoords(): number[] {
    return coordsOf(this.n);
  }

  applyMove(move: Move): void {
    const { axis, layer, turns } = move;
    for (let i = 0; i < this.cubies.length; i++) {
      const c = this.cubies[i];
      if (c.pos[axis] !== layer) continue;
      rotateVecInPlace(c.pos, axis, turns);
      rotateVecInPlace(c.orient[0], axis, turns);
      rotateVecInPlace(c.orient[1], axis, turns);
      rotateVecInPlace(c.orient[2], axis, turns);
    }
  }

  applyMoves(moves: Move[]): void {
    for (const m of moves) this.applyMove(m);
  }

  /** Convert a world direction into the cubie's local frame. */
  localDirOf(c: Cubie, world: Vec3i): Vec3i {
    return [
      dot(c.orient[0], world),
      dot(c.orient[1], world),
      dot(c.orient[2], world),
    ];
  }

  /** Colour of the sticker on `cubie` currently pointing along `world`. */
  colorFacing(c: Cubie, world: Vec3i): number | null {
    return stickerColorOnLocalDir(c.home, this.localDirOf(c, world), this.extent);
  }

  /** Find the piece whose home is `home`, wherever it currently sits. */
  piece(home: Vec3i): Cubie {
    const found = this.homeIndex.get(`${home[0]},${home[1]},${home[2]}`);
    if (!found) throw new Error(`No cubie with home ${home.join(",")}`);
    return found;
  }

  pieceSolved(c: Cubie): boolean {
    return pieceSolvedFast(c, this.extent);
  }

  isSolved(): boolean {
    return this.cubies.every((c) => pieceSolvedFast(c, this.extent));
  }
}

/* -------------------------------------------------------------------------
 * Move notation
 *
 * A face turn is clockwise as seen from OUTSIDE that face. In this right
 * handed frame that means the positive faces (U, R, F) turn -90 about their
 * axis and the negative faces (D, L, B) turn +90.
 * ---------------------------------------------------------------------- */

interface FaceSpec {
  axis: Axis;
  /** Sign of the outer layer this face refers to. */
  sign: 1 | -1;
  cw: Turns;
}

export const FACE_SPECS: Record<FaceId, FaceSpec> = {
  U: { axis: Y, sign: 1, cw: -1 },
  D: { axis: Y, sign: -1, cw: 1 },
  R: { axis: X, sign: 1, cw: -1 },
  L: { axis: X, sign: -1, cw: 1 },
  F: { axis: Z, sign: 1, cw: -1 },
  B: { axis: Z, sign: -1, cw: 1 },
};

export type Modifier = "" | "'" | "2";

/**
 * A face turn on a cube of size n.
 *
 * `depth` selects how far in from that face the slice sits: 0 is the outer
 * face, 1 the slice behind it, and so on.
 */
export function faceMove(
  n: number,
  face: FaceId,
  modifier: Modifier = "",
  depth = 0,
): Move {
  const spec = FACE_SPECS[face];
  const extent = extentOf(n);
  const layer = spec.sign * (extent - 2 * depth);

  let turns: Turns = spec.cw;
  if (modifier === "'") turns = (spec.cw === 1 ? -1 : 1) as Turns;
  else if (modifier === "2") turns = 2;

  return { axis: spec.axis, layer, turns };
}

/** Parse a whitespace-separated algorithm such as "R U R' U'". */
export function parseAlg(n: number, alg: string): Move[] {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const face = token[0] as FaceId;
      if (!(face in FACE_SPECS)) throw new Error(`Unknown move "${token}"`);
      const modifier = token.slice(1);
      if (modifier !== "" && modifier !== "'" && modifier !== "2") {
        throw new Error(`Unknown modifier in "${token}"`);
      }
      return faceMove(n, face, modifier);
    });
}

/** Render a move back to standard notation, for the on-screen move list. */
export function moveToString(n: number, m: Move): string {
  const extent = extentOf(n);
  const sign = Math.sign(m.layer) as 1 | -1 | 0;

  if (sign !== 0) {
    const depth = (extent - Math.abs(m.layer)) / 2;
    for (const face of Object.keys(FACE_SPECS) as FaceId[]) {
      const spec = FACE_SPECS[face];
      if (spec.axis !== m.axis || spec.sign !== sign) continue;
      const suffix = m.turns === 2 ? "2" : m.turns === spec.cw ? "" : "'";
      // Depth 0 is the plain face; deeper slices use the "2U" style prefix.
      const prefix = depth === 0 ? "" : String(depth + 1);
      return `${prefix}${face}${suffix}`;
    }
  }

  // An odd cube's middle slice has no sign, so no face claims it. Name it
  // from that axis's positive face, which is how big-cube notation reads it:
  // the middle of a 5x5 is "3R", three layers in from the right.
  for (const face of Object.keys(FACE_SPECS) as FaceId[]) {
    const spec = FACE_SPECS[face];
    if (spec.axis !== m.axis || spec.sign !== 1) continue;
    const depth = extent / 2;
    const suffix = m.turns === 2 ? "2" : m.turns === spec.cw ? "" : "'";
    return `${depth + 1}${face}${suffix}`;
  }

  const axisName = ["x", "y", "z"][m.axis];
  const suffix = m.turns === 2 ? "2" : m.turns === 1 ? "" : "'";
  return `${axisName}${suffix}`;
}

export function invertMove(m: Move): Move {
  return {
    axis: m.axis,
    layer: m.layer,
    turns: m.turns === 2 ? 2 : ((m.turns === 1 ? -1 : 1) as Turns),
  };
}
