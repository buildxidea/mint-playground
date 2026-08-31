import { Vec3i, extentOf } from "../cube/constants";
import {
  Cubie,
  CubeState,
  Move,
  invertMove,
  parseAlg,
  pieceSolvedFast,
  upStickerUp,
} from "../cube/state";

/** This solver is 3x3 only. */
export const SOLVER_SIZE = 3;
const E = extentOf(SOLVER_SIZE);

/**
 * Layer-by-layer ("beginner method") solver.
 *
 * Rather than a hand-written case table for every orientation of every piece,
 * each stage runs a bounded search over an alphabet of face turns and standard
 * algorithms. Every candidate sequence is applied to the working state and
 * checked against the stage goal AND a guard that earlier stages are still
 * intact, so an incorrect assumption about what an algorithm does can never
 * produce a wrong solution - it fails the check and is discarded.
 *
 * The trade-off is longer solutions than a two-phase solver. That is the
 * deliberate choice: correctness is verifiable.
 */

/* ------------------------------------------------------------ piece groups */

const D_EDGES: Vec3i[] = [
  [E, -E, 0],
  [-E, -E, 0],
  [0, -E, E],
  [0, -E, -E],
];

const D_CORNERS: Vec3i[] = [
  [E, -E, E],
  [E, -E, -E],
  [-E, -E, E],
  [-E, -E, -E],
];

const MID_EDGES: Vec3i[] = [
  [E, 0, E],
  [E, 0, -E],
  [-E, 0, E],
  [-E, 0, -E],
];

const U_EDGES: Vec3i[] = [
  [E, E, 0],
  [-E, E, 0],
  [0, E, E],
  [0, E, -E],
];

const U_CORNERS: Vec3i[] = [
  [E, E, E],
  [E, E, -E],
  [-E, E, E],
  [-E, E, -E],
];

/**
 * Resolve homes to live cubie objects once. The search mutates the working
 * state in place, so these references stay valid for the whole solve and the
 * hot path never does a lookup.
 */
function refs(state: CubeState, homes: Vec3i[]): Cubie[] {
  return homes.map((h) => state.piece(h));
}

function countSolved(group: Cubie[]): number {
  let n = 0;
  for (let i = 0; i < group.length; i++) if (pieceSolvedFast(group[i], E)) n++;
  return n;
}

function allSolved(group: Cubie[]): boolean {
  for (let i = 0; i < group.length; i++) {
    if (!pieceSolvedFast(group[i], E)) return false;
  }
  return true;
}

function allUp(group: Cubie[]): boolean {
  for (let i = 0; i < group.length; i++) {
    if (!upStickerUp(group[i])) return false;
  }
  return true;
}

function allHome(group: Cubie[]): boolean {
  for (let i = 0; i < group.length; i++) {
    const c = group[i];
    if (
      c.pos[0] !== c.home[0] ||
      c.pos[1] !== c.home[1] ||
      c.pos[2] !== c.home[2]
    ) {
      return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------- alphabets */

interface Entry {
  name: string;
  moves: Move[];
}

const alg = (name: string, notation: string): Entry => ({
  name,
  moves: parseAlg(SOLVER_SIZE, notation),
});

const FACE_TURNS: Entry[] = [
  "U", "U'", "U2",
  "D", "D'", "D2",
  "R", "R'", "R2",
  "L", "L'", "L2",
  "F", "F'", "F2",
  "B", "B'", "B2",
].map((t) => alg(t, t));

const U_TURNS: Entry[] = ["U", "U'", "U2"].map((t) => alg(t, t));

/**
 * First-layer corner insertions, one family per slot. These double as
 * extractors: applying one to a slot that holds a wrong corner lifts it back
 * into the U layer without disturbing the cross.
 */
const CORNER_INSERTS: Entry[] = [
  alg("ins-R", "R U R'"),
  alg("ins-R'", "R U' R'"),
  alg("ins-R2", "R U2 R'"),
  alg("ins-F", "F' U' F"),
  alg("ins-F'", "F' U F"),
  alg("ins-F2", "F' U2 F"),
  alg("ins-L", "L' U' L"),
  alg("ins-L'", "L' U L"),
  alg("ins-L2", "L' U2 L"),
  alg("ins-B", "B' U' B"),
  alg("ins-B'", "B' U B"),
  alg("ins-B2", "B' U2 B"),
  alg("ins-Rb", "R' U' R"),
  alg("ins-Fb", "F U F'"),
  alg("ins-Lb", "L U L'"),
  alg("ins-Bb", "B U B'"),
];

/** Second-layer edge insertions, written out for all four slots. */
const MIDDLE_INSERTS: Entry[] = [
  alg("mid-FR", "U R U' R' U' F' U F"),
  alg("mid-RB", "U B U' B' U' R' U R"),
  alg("mid-BL", "U L U' L' U' B' U B"),
  alg("mid-LF", "U F U' F' U' L' U L"),
  alg("mid-FL", "U' L' U L U F U' F'"),
  alg("mid-RF", "U' F' U F U R U' R'"),
  alg("mid-BR", "U' R' U R U B U' B'"),
  alg("mid-LB", "U' B' U B U L U' L'"),
];

/** Last-layer edge orientation (building the U cross). */
const OLL_EDGES: Entry[] = [
  alg("cross-F", "F R U R' U' F'"),
  alg("cross-f", "F U R U' R' F'"),
  alg("cross-B", "B U L U' L' B'"),
  alg("cross-R", "R U B U' B' R'"),
];

/** Last-layer corner orientation. Preserves the U cross. */
const OLL_CORNERS: Entry[] = [
  alg("sune", "R U R' U R U2 R'"),
  alg("antisune", "R U2 R' U' R U' R'"),
  alg("sune-L", "L' U' L U' L' U2 L"),
  alg("antisune-L", "L' U2 L U L' U L"),
];

/** Pure last-layer corner 3-cycles. */
const PLL_CORNERS: Entry[] = [
  alg("Aa", "R B' R F2 R' B R F2 R2"),
  alg("Ab", "R2 F2 R' B' R F2 R' B R'"),
];

/** Pure last-layer edge 3-cycles. */
const PLL_EDGES: Entry[] = [
  alg("Ua", "R U' R U R U R U' R' U' R2"),
  alg("Ub", "R2 U R U R' U' R' U' R' U R'"),
];

/* ----------------------------------------------------------------- search */

interface StageSpec {
  label: string;
  alphabet: Entry[];
  goal: () => boolean;
  guard: () => boolean;
  maxDepth: number;
}

function search(state: CubeState, spec: StageSpec): Move[] | null {
  if (spec.guard() && spec.goal()) return [];
  for (let depth = 1; depth <= spec.maxDepth; depth++) {
    const found = dfs(state, spec, depth, []);
    if (found) return found;
  }
  return null;
}

function dfs(
  state: CubeState,
  spec: StageSpec,
  depth: number,
  acc: Entry[],
): Move[] | null {
  if (depth === 0) return null;

  for (const entry of spec.alphabet) {
    const prev = acc[acc.length - 1];
    if (prev && prev.name === entry.name) continue;

    state.applyMoves(entry.moves);
    acc.push(entry);

    let result: Move[] | null = null;
    if (spec.guard() && spec.goal()) {
      result = acc.flatMap((e) => e.moves);
    } else {
      result = dfs(state, spec, depth - 1, acc);
    }

    acc.pop();
    undoMoves(state, entry.moves);

    if (result) return result;
  }
  return null;
}

function undoMoves(state: CubeState, moves: Move[]): void {
  for (let i = moves.length - 1; i >= 0; i--) {
    state.applyMove(invertMove(moves[i]));
  }
}

/* --------------------------------------------------------- centre frame */

const CENTRES: Vec3i[] = [
  [E, 0, 0], [-E, 0, 0],
  [0, E, 0], [0, -E, 0],
  [0, 0, E], [0, 0, -E],
];

/**
 * Bring the six centres home with a whole-cube rotation.
 *
 * Every stage below is built from face turns, and no face turn moves a centre
 * - so if the centres start misaligned the solver can never fix them and
 * stalls at the very end. A slice turn misaligns them, and a slice turn is one
 * drag of the middle layer away, so this is reachable in normal play.
 *
 * The six centres form a rigid frame: a slice turn rotates four of them about
 * an axis while the two poles stay put, which is exactly a rotation of the
 * whole frame. So the frame is always in one of 24 orientations and a single
 * whole-cube rotation - all layers of an axis turning together - restores it.
 */
function alignCentres(work: CubeState): Move[] {
  const centres = refs(work, CENTRES);
  const aligned = () => allSolved(centres);
  if (aligned()) return [];

  const rotations: Move[][] = [];
  for (const axis of [0, 1, 2] as const) {
    for (const turns of [1, -1, 2] as const) {
      rotations.push(
        work.layerCoords().map((layer) => ({ axis, layer, turns }) as Move),
      );
    }
  }

  // Leaves `work` exactly as it found it: the caller applies the result, so
  // returning with the trial rotation still on would apply it twice and undo
  // the very alignment it just found.
  for (const first of rotations) {
    work.applyMoves(first);
    if (aligned()) {
      undoMoves(work, first);
      return first;
    }
    for (const second of rotations) {
      work.applyMoves(second);
      if (aligned()) {
        undoMoves(work, second);
        undoMoves(work, first);
        return [...first, ...second];
      }
      undoMoves(work, second);
    }
    undoMoves(work, first);
  }

  throw new SolveError("Could not align the centres.");
}

/* ----------------------------------------------------------------- stages */

export class SolveError extends Error {}

export function solve(input: CubeState): Move[] {
  if (input.n !== SOLVER_SIZE) {
    throw new SolveError(
      `The layer-by-layer solver only handles ${SOLVER_SIZE}x${SOLVER_SIZE}.`,
    );
  }
  const work = input.clone();
  const out: Move[] = [];

  // Must come first: every stage below assumes the centres define the faces.
  const align = alignCentres(work);
  work.applyMoves(align);
  out.push(...align);

  const dEdges = refs(work, D_EDGES);
  const dCorners = refs(work, D_CORNERS);
  const midEdges = refs(work, MID_EDGES);
  const uEdges = refs(work, U_EDGES);
  const uCorners = refs(work, U_CORNERS);

  const run = (spec: StageSpec) => {
    const found = search(work, spec);
    if (!found) throw new SolveError(`Solver stalled during: ${spec.label}`);
    work.applyMoves(found);
    out.push(...found);
  };

  const always = () => true;
  const crossOk = () => allSolved(dEdges);
  const f2lOk = () =>
    allSolved(dEdges) && allSolved(dCorners) && allSolved(midEdges);
  const llOriented = () => allUp(uCorners) && allUp(uEdges);

  // Stage 1: first-layer cross, one edge at a time.
  while (countSolved(dEdges) < 4) {
    const target = countSolved(dEdges) + 1;
    run({
      label: "first layer cross",
      alphabet: FACE_TURNS,
      goal: () => countSolved(dEdges) >= target,
      guard: always,
      maxDepth: 5,
    });
  }

  // Stage 2: first-layer corners, keeping the cross intact.
  while (countSolved(dCorners) < 4) {
    const target = countSolved(dCorners) + 1;
    run({
      label: "first layer corners",
      alphabet: [...U_TURNS, ...CORNER_INSERTS],
      goal: () => countSolved(dCorners) >= target,
      guard: crossOk,
      maxDepth: 5,
    });
  }

  // Stage 3: second-layer edges.
  while (countSolved(midEdges) < 4) {
    const target = countSolved(midEdges) + 1;
    run({
      label: "second layer edges",
      alphabet: [...U_TURNS, ...MIDDLE_INSERTS],
      goal: () => countSolved(midEdges) >= target,
      guard: () => allSolved(dEdges) && allSolved(dCorners),
      maxDepth: 4,
    });
  }

  // Stage 4: orient last-layer edges (the U cross).
  run({
    label: "last layer cross",
    alphabet: [...U_TURNS, ...OLL_EDGES],
    goal: () => allUp(uEdges),
    guard: f2lOk,
    maxDepth: 4,
  });

  // Stage 5: orient last-layer corners, preserving the cross.
  run({
    label: "last layer corner orientation",
    alphabet: [...U_TURNS, ...OLL_CORNERS],
    goal: () => allUp(uCorners) && allUp(uEdges),
    guard: f2lOk,
    maxDepth: 5,
  });

  // Stage 6: permute last-layer corners.
  run({
    label: "last layer corner permutation",
    alphabet: [...U_TURNS, ...PLL_CORNERS],
    goal: () => allHome(uCorners) && allSolved(uCorners),
    guard: () => f2lOk() && llOriented(),
    maxDepth: 4,
  });

  // Stage 7: permute last-layer edges - the cube is now solved.
  run({
    label: "last layer edge permutation",
    alphabet: [...U_TURNS, ...PLL_EDGES],
    goal: () => work.isSolved(),
    guard: always,
    maxDepth: 5,
  });

  if (!work.isSolved()) {
    throw new SolveError("Solver finished but the cube is not solved.");
  }

  const tidied = compressMoves(out);

  // Compression must never change what the solution does.
  const check = input.clone();
  check.applyMoves(tidied);
  if (!check.isSolved()) {
    throw new SolveError("Compressed solution no longer solves the cube.");
  }
  return tidied;
}

/**
 * Merge consecutive turns of the same face. Stitching fixed algorithms
 * together leaves a lot of redundancy at the seams; this typically removes a
 * meaningful slice of the moves without changing the result.
 */
export function compressMoves(moves: Move[]): Move[] {
  const out: Move[] = [];
  for (const m of moves) {
    const prev = out[out.length - 1];
    if (!prev || prev.axis !== m.axis || prev.layer !== m.layer) {
      out.push({ ...m });
      continue;
    }
    const total = (turnValue(prev) + turnValue(m)) % 4;
    out.pop();
    if (total === 0) continue;
    out.push({
      axis: m.axis,
      layer: m.layer,
      turns: total === 3 ? -1 : total === 2 ? 2 : 1,
    });
  }
  return out;
}

function turnValue(m: Move): number {
  return m.turns === 2 ? 2 : m.turns === 1 ? 1 : 3;
}
