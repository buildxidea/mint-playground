import { Axis, Vec3i, axisOfNormal } from "../cube/constants";
import { CubeState, Move, Turns, faceMove } from "../cube/state";

/**
 * Optimal 2x2 solver.
 *
 * The 2x2 is small enough to solve exactly. Fixing the DBL corner removes the
 * whole-cube rotation symmetry and leaves 7 movable corners, so a breadth
 * first search from the solved state can label every reachable position with
 * its true distance. Solving is then a greedy walk down that gradient, which
 * yields a provably shortest solution and cannot get the answer wrong.
 *
 * Positions and orientations are stored per SLOT rather than per piece, which
 * makes the permutation and orientation coordinates transform independently.
 * That is what allows small move tables (5040x9 and 2187x9) instead of
 * re-simulating the cube for all 33 million transitions.
 */

export const SIZE = 2;
const EXTENT = 1;

/** The corner held fixed. Every move used here leaves it alone. */
const FIXED: Vec3i = [-EXTENT, -EXTENT, -EXTENT];

/** The seven movable corner slots, in a fixed order. */
const SLOTS: Vec3i[] = (() => {
  const out: Vec3i[] = [];
  for (const x of [-EXTENT, EXTENT]) {
    for (const y of [-EXTENT, EXTENT]) {
      for (const z of [-EXTENT, EXTENT]) {
        if (x === FIXED[0] && y === FIXED[1] && z === FIXED[2]) continue;
        out.push([x, y, z]);
      }
    }
  }
  return out;
})();

const SLOT_COUNT = 7;
const PERM_COUNT = 5040; // 7!
const ORI_COUNT = 2187; // 3^7
const STATE_COUNT = PERM_COUNT * ORI_COUNT;

/** U, R and F only: these are exactly the moves that fix the DBL corner. */
const MOVE_LIST: Move[] = (["U", "R", "F"] as const).flatMap((face) =>
  (["", "'", "2"] as const).map((mod) => faceMove(SIZE, face, mod)),
);
const MOVE_COUNT = MOVE_LIST.length; // 9

/* ------------------------------------------------------------- coordinates */

function slotIndexOf(v: Vec3i): number {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = SLOTS[i];
    if (s[0] === v[0] && s[1] === v[1] && s[2] === v[2]) return i;
  }
  return -1;
}

/**
 * A corner's twist, as the world axis its Y-facing sticker points along.
 * Three values, and unique for a given slot, which is all an index needs.
 */
function twistOf(orientY: Vec3i): number {
  return axisOfNormal(orientY);
}

function encodePerm(arr: number[]): number {
  let index = 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    let smaller = 0;
    for (let j = i + 1; j < SLOT_COUNT; j++) if (arr[j] < arr[i]) smaller++;
    index = index * (SLOT_COUNT - i) + smaller;
  }
  return index;
}

function decodePerm(index: number): number[] {
  const digits: number[] = new Array(SLOT_COUNT);
  let rest = index;
  for (let i = SLOT_COUNT - 1; i >= 0; i--) {
    const radix = SLOT_COUNT - i;
    digits[i] = rest % radix;
    rest = Math.floor(rest / radix);
  }
  const pool: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) pool.push(i);
  const out: number[] = new Array(SLOT_COUNT);
  for (let i = 0; i < SLOT_COUNT; i++) out[i] = pool.splice(digits[i], 1)[0];
  return out;
}

function encodeOri(arr: number[]): number {
  let index = 0;
  for (let i = SLOT_COUNT - 1; i >= 0; i--) index = index * 3 + arr[i];
  return index;
}

function decodeOri(index: number): number[] {
  const out: number[] = new Array(SLOT_COUNT);
  let rest = index;
  for (let i = 0; i < SLOT_COUNT; i++) {
    out[i] = rest % 3;
    rest = Math.floor(rest / 3);
  }
  return out;
}

/** Read the permutation and orientation coordinates out of a live cube. */
function readCoords(state: CubeState): { perm: number[]; ori: number[] } {
  const perm: number[] = new Array(SLOT_COUNT).fill(-1);
  const ori: number[] = new Array(SLOT_COUNT).fill(0);

  for (const cubie of state.cubies) {
    const slot = slotIndexOf(cubie.pos);
    if (slot < 0) continue; // the fixed corner
    const home = slotIndexOf(cubie.home);
    if (home < 0) continue;
    perm[slot] = home;
    ori[slot] = twistOf(cubie.orient[1]);
  }
  return { perm, ori };
}

/* ------------------------------------------------------------- move tables */

interface Tables {
  permTable: Int16Array;
  oriTable: Int16Array;
  distance: Uint8Array;
  solvedIndex: number;
}

let tables: Tables | null = null;

/**
 * Derive each move's slot permutation and axis permutation by applying it to a
 * solved cube and reading the result, rather than hand-writing the tables.
 */
function deriveMoveEffects(): { slotSrc: number[][]; axisMap: number[][] } {
  const slotSrc: number[][] = [];
  const axisMap: number[][] = [];

  for (const move of MOVE_LIST) {
    const probe = new CubeState(SIZE);
    probe.applyMove(move);

    const src: number[] = new Array(SLOT_COUNT).fill(0);
    let axes: number[] | null = null;

    for (const cubie of probe.cubies) {
      const slot = slotIndexOf(cubie.pos);
      if (slot < 0) continue;
      const home = slotIndexOf(cubie.home);
      if (home < 0) continue;
      // Starting solved, the piece now in `slot` came from slot `home`.
      src[slot] = home;

      // orient[a] is the world direction of local axis a, so for any moved
      // piece it reveals the move's rotation and thus its axis permutation.
      if (!axes && home !== slot) {
        axes = [
          axisOfNormal(cubie.orient[0]),
          axisOfNormal(cubie.orient[1]),
          axisOfNormal(cubie.orient[2]),
        ];
      }
    }

    slotSrc.push(src);
    axisMap.push(axes ?? [0, 1, 2]);
  }

  return { slotSrc, axisMap };
}

function buildTables(): Tables {
  const { slotSrc, axisMap } = deriveMoveEffects();

  // A turn rotates ONLY the pieces in its layer. Slots outside the layer keep
  // their orientation untouched, so the move's axis permutation must not be
  // applied to them.
  const inLayer: boolean[][] = MOVE_LIST.map((mv) =>
    SLOTS.map((slot) => slot[mv.axis] === mv.layer),
  );

  const permTable = new Int16Array(PERM_COUNT * MOVE_COUNT);
  for (let p = 0; p < PERM_COUNT; p++) {
    const arr = decodePerm(p);
    for (let m = 0; m < MOVE_COUNT; m++) {
      const src = slotSrc[m];
      const next: number[] = new Array(SLOT_COUNT);
      for (let i = 0; i < SLOT_COUNT; i++) next[i] = arr[src[i]];
      permTable[p * MOVE_COUNT + m] = encodePerm(next);
    }
  }

  const oriTable = new Int16Array(ORI_COUNT * MOVE_COUNT);
  for (let o = 0; o < ORI_COUNT; o++) {
    const arr = decodeOri(o);
    for (let m = 0; m < MOVE_COUNT; m++) {
      const src = slotSrc[m];
      const map = axisMap[m];
      const layer = inLayer[m];
      const next: number[] = new Array(SLOT_COUNT);
      for (let i = 0; i < SLOT_COUNT; i++) {
        const carried = arr[src[i]];
        next[i] = layer[i] ? map[carried] : carried;
      }
      oriTable[o * MOVE_COUNT + m] = encodeOri(next);
    }
  }

  const solved = readCoords(new CubeState(SIZE));
  const solvedIndex =
    encodePerm(solved.perm) * ORI_COUNT + encodeOri(solved.ori);

  // Breadth first over every reachable position.
  const distance = new Uint8Array(STATE_COUNT).fill(255);
  const queue = new Int32Array(STATE_COUNT);
  let head = 0;
  let tail = 0;

  distance[solvedIndex] = 0;
  queue[tail++] = solvedIndex;

  while (head < tail) {
    const index = queue[head++];
    const d = distance[index];
    const p = (index / ORI_COUNT) | 0;
    const o = index % ORI_COUNT;

    for (let m = 0; m < MOVE_COUNT; m++) {
      const next =
        permTable[p * MOVE_COUNT + m] * ORI_COUNT + oriTable[o * MOVE_COUNT + m];
      if (distance[next] !== 255) continue;
      distance[next] = d + 1;
      queue[tail++] = next;
    }
  }

  return { permTable, oriTable, distance, solvedIndex };
}

/** Built once, on the first 2x2 solve. */
export function ensureTables(): void {
  if (!tables) tables = buildTables();
}

export function tablesReady(): boolean {
  return tables !== null;
}

/* -------------------------------------------------------------- rotations */

/** A whole-cube rotation, expressible as turning both layers of one axis. */
function wholeCubeRotation(axis: Axis, turns: Turns): Move[] {
  return [
    { axis, layer: EXTENT, turns },
    { axis, layer: -EXTENT, turns },
  ];
}

/**
 * Bring the fixed corner home.
 *
 * Scrambles only use U, R and F, but a player can drag any layer, which can
 * carry the DBL corner away. The solver's coordinates assume that corner is
 * home, so re-orient the whole cube first - a whole-cube rotation is just both
 * layers of an axis turning together, so it costs nothing in correctness.
 */
function normalizeOrientation(state: CubeState): Move[] {
  const isHome = (s: CubeState) => {
    const c = s.piece(FIXED);
    return (
      c.pos[0] === FIXED[0] &&
      c.pos[1] === FIXED[1] &&
      c.pos[2] === FIXED[2] &&
      c.orient[0][0] === 1 &&
      c.orient[1][1] === 1 &&
      c.orient[2][2] === 1
    );
  };

  if (isHome(state)) return [];

  const generators: Move[][] = [];
  for (const axis of [0, 1, 2] as Axis[]) {
    for (const turns of [1, -1, 2] as Turns[]) {
      generators.push(wholeCubeRotation(axis, turns));
    }
  }

  // Every cube orientation is at most two axis rotations from any other.
  for (const first of generators) {
    const once = state.clone();
    once.applyMoves(first);
    if (isHome(once)) return first;

    for (const second of generators) {
      const twice = once.clone();
      twice.applyMoves(second);
      if (isHome(twice)) return [...first, ...second];
    }
  }

  return [];
}

/* ------------------------------------------------------------------ solve */

export class TwoByTwoError extends Error {}

export function solve2x2(input: CubeState): Move[] {
  if (input.n !== SIZE) {
    throw new TwoByTwoError(`This solver only handles ${SIZE}x${SIZE}.`);
  }

  ensureTables();
  const t = tables;
  if (!t) throw new TwoByTwoError("Solver tables unavailable.");

  const work = input.clone();
  const out: Move[] = [];

  const rotation = normalizeOrientation(work);
  work.applyMoves(rotation);
  out.push(...rotation);

  const coords = readCoords(work);
  if (coords.perm.some((v) => v < 0)) {
    throw new TwoByTwoError("Could not read the cube's corners.");
  }

  let p = encodePerm(coords.perm);
  let o = encodeOri(coords.ori);
  let index = p * ORI_COUNT + o;

  if (t.distance[index] === 255) {
    throw new TwoByTwoError("This position is not reachable.");
  }

  // Greedy descent: at every step take a move that reduces the true distance.
  let guard = 0;
  while (index !== t.solvedIndex) {
    if (guard++ > 64) throw new TwoByTwoError("Descent failed to converge.");
    const d = t.distance[index];
    let advanced = false;

    for (let m = 0; m < MOVE_COUNT; m++) {
      const np = t.permTable[p * MOVE_COUNT + m];
      const no = t.oriTable[o * MOVE_COUNT + m];
      const next = np * ORI_COUNT + no;
      if (t.distance[next] !== d - 1) continue;
      out.push(MOVE_LIST[m]);
      p = np;
      o = no;
      index = next;
      advanced = true;
      break;
    }

    if (!advanced) throw new TwoByTwoError("No descending move found.");
  }

  const check = input.clone();
  check.applyMoves(out);
  if (!check.isSolved()) {
    throw new TwoByTwoError("Solution did not solve the cube.");
  }
  return out;
}
