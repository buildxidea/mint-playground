import { Axis, coordsOf, extentOf } from "./constants";
import { Move, Turns } from "./state";

const TURNS: Turns[] = [1, -1, 2];

export interface ScrambleOptions {
  length?: number;
  random?: () => number;
}

/** Sensible scramble length for each cube size. */
function defaultLength(n: number, rng: () => number): number {
  const base = { 2: 11, 3: 20, 4: 40, 5: 60, 6: 80 }[n] ?? 20 * n;
  return base + Math.floor(rng() * 6);
}

/**
 * Which layers a scramble may turn.
 *
 * Sizes up to 3x3 use ONLY the outer faces. That is not a shortcut: a slice
 * move permutes the centre pieces, and a solver built from face turns alone
 * can never put them back, so an inner-slice scramble could hand the 3x3
 * solver a position it cannot finish. Outer-face-only is also what standard
 * 3x3 competition scrambles use.
 *
 * From 4x4 up, inner slices are required - without them the inner centre
 * blocks never move and the cube is only partly scrambled.
 */
function scrambleLayers(n: number): number[] {
  const coords = coordsOf(n);
  const extent = extentOf(n);

  // 2x2: only U, R and F. The solver fixes the DBL corner to remove whole-cube
  // rotation symmetry, and these are exactly the turns that leave it alone.
  // This is also what standard 2x2 scrambles use.
  if (n === 2) return [extent];

  if (n === 3) return coords.filter((c) => Math.abs(c) === extent);

  return coords;
}

/**
 * Random scramble for a cube of size n.
 *
 * Rejects turning the same slice twice in a row, and a third consecutive move
 * on one axis, which is what produces obviously redundant scrambles.
 */
export function randomScramble(
  n: number,
  options: ScrambleOptions = {},
): Move[] {
  const rng = options.random ?? Math.random;
  const length = options.length ?? defaultLength(n, rng);
  const layers = scrambleLayers(n);

  const moves: Move[] = [];
  let guard = 0;

  while (moves.length < length && guard < length * 100) {
    guard++;

    const axis = Math.floor(rng() * 3) as Axis;
    const layer = layers[Math.floor(rng() * layers.length)];
    const turns = TURNS[Math.floor(rng() * TURNS.length)];

    const last = moves[moves.length - 1];
    const secondLast = moves[moves.length - 2];

    if (last && last.axis === axis && last.layer === layer) continue;
    if (
      last &&
      secondLast &&
      last.axis === axis &&
      secondLast.axis === axis
    ) {
      continue;
    }

    moves.push({ axis, layer, turns });
  }

  return moves;
}

/** Deterministic RNG so tests can reproduce a failing scramble exactly. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
