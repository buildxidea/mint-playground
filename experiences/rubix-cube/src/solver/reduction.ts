import { Axis, Vec3i, coordsOf, extentOf } from "../cube/constants";
import {
  Cubie,
  CubeState,
  Move,
  Turns,
  invertMove,
  pieceSolvedFast,
} from "../cube/state";

/**
 * INCOMPLETE - NOT WIRED INTO THE APP.
 *
 * Groundwork for an NxN solver by reduction: group the centre pieces, pair the
 * edge wings, then treat the result as a 3x3 using outer face turns only, with
 * even-cube parity repaired before the 3x3 phase.
 *
 * WHAT WORKS: the centre phase solves 4x4 reliably (~50 moves, under a
 * second). On 5x5 it completes three or four of the six faces before it
 * stalls; 6x6 is worse. The edge-pairing and parity phases are not written.
 * `solveCube` still reports 4x4 and up as unsupported, and nothing here is
 * reachable from the UI.
 *
 * WHERE IT BREAKS, and why it is not a small fix: the phases are bounded
 * searches over an alphabet of slice turns, commutators [S,F], and conjugates
 * A[S,F]A'. That generic alphabet runs out of reach on the last piece or two
 * of a face once other faces are locked - a plain commutator swaps one correct
 * piece out as it brings another in, and even a conjugated one cannot express
 * the last-two-centres case, where a piece must trade between opposite faces
 * while five other faces stay intact. Hill-climbing on the total count,
 * per-piece guards, random restarts to escape plateaus, and face-by-face
 * ordering were each tried; each moved the wall without removing it.
 *
 * Finishing this needs the constructive approach instead of a generic search:
 * explicit commutators chosen from the geometry of the specific piece being
 * moved, in the style of big-cube blindfolded methods, plus the standard
 * last-two-centres, edge-pairing, and OLL/PLL parity algorithms. That is a
 * substantially larger and more delicate build than what is here.
 */

export class ReductionError extends Error {}

export type Kind = "corner" | "edge" | "center";

export function kindOf(home: Vec3i, extent: number): Kind {
  let outer = 0;
  for (let a = 0; a < 3; a++) if (Math.abs(home[a]) === extent) outer++;
  return outer === 3 ? "corner" : outer === 2 ? "edge" : "center";
}

/* ---------------------------------------------------------------- moves */

export interface Entry {
  name: string;
  moves: Move[];
}

const TURNS: Turns[] = [1, -1, 2];
const AXES: Axis[] = [0, 1, 2];

function turnLabel(t: Turns): string {
  return t === 2 ? "2" : t === 1 ? "" : "'";
}

function moveLabel(m: Move): string {
  return `${"xyz"[m.axis]}${m.layer}${turnLabel(m.turns)}`;
}

/** Every single-slice turn: all axes, all layers, all amounts. */
export function allSliceMoves(n: number): Move[] {
  const out: Move[] = [];
  for (const axis of AXES) {
    for (const layer of coordsOf(n)) {
      for (const turns of TURNS) out.push({ axis, layer, turns });
    }
  }
  return out;
}

function outerMoves(n: number): Move[] {
  const extent = extentOf(n);
  return allSliceMoves(n).filter((m) => Math.abs(m.layer) === extent);
}

function innerMoves(n: number): Move[] {
  const extent = extentOf(n);
  return allSliceMoves(n).filter((m) => Math.abs(m.layer) !== extent);
}

function asEntries(moves: Move[]): Entry[] {
  return moves.map((m) => ({ name: moveLabel(m), moves: [m] }));
}

/**
 * Commutators [S, F] = S F S' F'.
 *
 * A slice turn paired with a perpendicular face turn cycles a small number of
 * pieces and leaves everything else alone, which is exactly what is needed
 * once most of a phase is already correct and blunt turns would wreck it.
 */
function commutators(inner: Move[], outer: Move[]): Entry[] {
  const out: Entry[] = [];
  for (const s of inner) {
    for (const f of outer) {
      if (s.axis === f.axis) continue;
      out.push({
        name: `[${moveLabel(s)},${moveLabel(f)}]`,
        moves: [s, f, invertMove(s), invertMove(f)],
      });
    }
  }
  return out;
}

/**
 * Conjugates A C A' of a commutator C.
 *
 * Conjugation slides a commutator's small "affected set" somewhere else on the
 * cube, which is what reaches the last few pieces once plain commutators have
 * run out of room. Expensive, so this is only ever the final fallback tier.
 */
function conjugates(comms: Entry[], setups: Move[]): Entry[] {
  const out: Entry[] = [];
  for (const setup of setups) {
    const undo = invertMove(setup);
    for (const c of comms) {
      out.push({
        name: `${moveLabel(setup)}:${c.name}`,
        moves: [setup, ...c.moves, undo],
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------- search */

interface Tier {
  alphabet: Entry[];
  maxDepth: number;
}

interface StageSpec {
  label: string;
  /** Tried in order; later tiers are richer but far more expensive. */
  tiers: Tier[];
  goal: () => boolean;
  guard: () => boolean;
}

function undoMoves(state: CubeState, moves: Move[]): void {
  for (let i = moves.length - 1; i >= 0; i--) {
    state.applyMove(invertMove(moves[i]));
  }
}

function search(state: CubeState, spec: StageSpec): Move[] | null {
  if (spec.guard() && spec.goal()) return [];
  for (const tier of spec.tiers) {
    for (let depth = 1; depth <= tier.maxDepth; depth++) {
      const found = dfs(state, spec, tier.alphabet, depth, []);
      if (found) return found;
    }
  }
  return null;
}

function dfs(
  state: CubeState,
  spec: StageSpec,
  alphabet: Entry[],
  depth: number,
  acc: Entry[],
): Move[] | null {
  if (depth === 0) return null;

  for (const entry of alphabet) {
    const prev = acc[acc.length - 1];
    if (prev && prev.name === entry.name) continue;

    state.applyMoves(entry.moves);
    acc.push(entry);

    let result: Move[] | null = null;
    if (spec.guard() && spec.goal()) {
      result = acc.flatMap((e) => e.moves);
    } else {
      result = dfs(state, spec, alphabet, depth - 1, acc);
    }

    acc.pop();
    undoMoves(state, entry.moves);

    if (result) return result;
  }
  return null;
}

/* -------------------------------------------------------------- helpers */

function allStillSolved(group: Cubie[], extent: number): boolean {
  for (let i = 0; i < group.length; i++) {
    if (!pieceSolvedFast(group[i], extent)) return false;
  }
  return true;
}

/* ------------------------------------------------------- phase: centres */

export interface PhaseAlphabets {
  singles: Entry[];
  comms: Entry[];
  conj: Entry[];
  outers: Entry[];
}

export function buildAlphabets(n: number): PhaseAlphabets {
  const inner = innerMoves(n);
  const outer = outerMoves(n);
  const comms = commutators(inner, outer);
  // Quarter turns only as setups: half turns are their own inverse and add
  // little reach for double the alphabet.
  const setups = allSliceMoves(n).filter((m) => m.turns !== 2);
  return {
    singles: asEntries(allSliceMoves(n)),
    comms,
    conj: conjugates(comms, setups),
    outers: asEntries(outer),
  };
}

/**
 * Bring the six fixed centres of an odd cube home.
 *
 * On an odd cube the true centres form a rigid frame that no sequence can
 * permute internally - it can only be rotated as a whole, into one of 24
 * orientations. If that frame starts misaligned, fixing it costs a large
 * temporary loss of correct centres, which a hill-climbing search will never
 * accept, and the centre phase deadlocks. Rotating the whole cube first costs
 * nothing and removes the problem entirely.
 */
export function normalizeFrame(work: CubeState, out: Move[]): void {
  if (work.n % 2 === 0) return;
  const extent = work.extent;

  const trueCentres = work.cubies.filter((c) => {
    let outer = 0;
    let zeros = 0;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(c.home[a]) === extent) outer++;
      else if (c.home[a] === 0) zeros++;
    }
    return outer === 1 && zeros === 2;
  });

  const aligned = () => allStillSolved(trueCentres, extent);
  if (aligned()) return;

  const rotations: Move[][] = [];
  for (const axis of AXES) {
    for (const turns of TURNS) {
      rotations.push(coordsOf(work.n).map((layer) => ({ axis, layer, turns })));
    }
  }

  for (const first of rotations) {
    work.applyMoves(first);
    if (aligned()) {
      out.push(...first);
      return;
    }
    for (const second of rotations) {
      work.applyMoves(second);
      if (aligned()) {
        out.push(...first, ...second);
        return;
      }
      undoMoves(work, second);
    }
    undoMoves(work, first);
  }

  throw new ReductionError("Could not align the fixed centres.");
}

/**
 * Group the centre pieces, one slot at a time.
 *
 * Corners and edges are allowed to scramble freely here - they are solved in
 * later phases - so the only guard is that centres already placed stay placed.
 * That keeps the search cheap early and correctly tight late.
 */
/**
 * Group the centre pieces, one face at a time.
 *
 * Face order matters and the guard is the whole trick: while building a face,
 * only the faces already FINISHED are protected. Guarding every correct centre
 * - including the half-built face's own pieces - forbids the shuffling that
 * building a face requires, and the search deadlocks well short of the end.
 * Corners and edges are free to scramble; later phases fix them.
 */
export function solveCenters(
  work: CubeState,
  alphabets: PhaseAlphabets,
  out: Move[],
): void {
  const extent = work.extent;
  const n = work.n;
  const perFace = (n - 2) * (n - 2);
  const centers = work.cubies.filter((c) => kindOf(c.home, extent) === "center");

  const countOnFace = (axis: Axis, sign: number): number => {
    let hits = 0;
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      if (c.pos[axis] !== sign * extent) continue;
      if (c.home[axis] === c.pos[axis] && c.orient[axis][axis] === 1) hits++;
    }
    return hits;
  };

  // Opposite pairs first: the second face of a pair is much easier once its
  // partner is fixed, and the last two faces are the hardest either way.
  const order: Array<[Axis, number]> = [
    [1, 1], [1, -1],
    [2, 1], [2, -1],
    [0, 1], [0, -1],
  ];

  const plain = [...alphabets.singles, ...alphabets.comms];
  const done: Array<[Axis, number]> = [];

  const guard = (): boolean => {
    for (let i = 0; i < done.length; i++) {
      if (countOnFace(done[i][0], done[i][1]) !== perFace) return false;
    }
    return true;
  };

  for (const [axis, sign] of order) {
    let budget = perFace * 12;
    while (countOnFace(axis, sign) < perFace) {
      const target = countOnFace(axis, sign) + 1;

      const found = search(work, {
        label: `centres ${"xyz"[axis]}${sign > 0 ? "+" : "-"}`,
        // A plain commutator tends to swap one correct piece out as it
        // brings another in, netting zero. Conjugating it with a setup move
        // is what actually reaches the last pieces of a face, so it comes
        // before the much more expensive depth-2 sweep.
        tiers: [
          { alphabet: plain, maxDepth: 1 },
          { alphabet: alphabets.conj, maxDepth: 1 },
          { alphabet: plain, maxDepth: 2 },
        ],
        goal: () => countOnFace(axis, sign) >= target,
        guard,
      });

      if (!found) {
        throw new ReductionError(
          `Stalled building the ${"xyz"[axis]}${sign > 0 ? "+" : "-"} centre ` +
            `(${target - 1}/${perFace}, ${done.length} faces done).`,
        );
      }

      work.applyMoves(found);
      out.push(...found);

      if (budget-- <= 0) {
        throw new ReductionError("Centre phase failed to converge.");
      }
    }
    done.push([axis, sign]);
  }
}
