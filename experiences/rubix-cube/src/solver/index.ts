import { CubeState, Move } from "../cube/state";
import { SolveError, solve as solve3x3 } from "./layerByLayer";
import { TwoByTwoError, solve2x2 } from "./twoByTwo";

export { SolveError } from "./layerByLayer";

/** Raised when a size has no solver yet, as opposed to a solver failing. */
export class UnsupportedSizeError extends Error {}

/** Sizes the Solve button can actually handle. */
export const SOLVABLE_SIZES = [2, 3];

export function canSolve(n: number): boolean {
  return SOLVABLE_SIZES.includes(n);
}

/**
 * Why a size is unsupported, in words a user can act on.
 *
 * 4x4 and up need the reduction method - group the centre pieces, pair the
 * edge wings, then treat the result as a 3x3 - plus the parity algorithms that
 * only exist on even cubes. That is a substantially larger piece of work than
 * the 3x3 solver, so those sizes are playable but not yet solvable.
 */
export function unsupportedReason(n: number): string {
  return `${n}x${n} solving needs a reduction solver - not built yet`;
}

export function solveCube(state: CubeState): Move[] {
  if (state.n === 2) return solve2x2(state);
  if (state.n === 3) return solve3x3(state);
  throw new UnsupportedSizeError(unsupportedReason(state.n));
}

export function describeSolveFailure(error: unknown): string {
  if (error instanceof UnsupportedSizeError) return error.message;
  if (error instanceof SolveError) return "Could not find a solution";
  if (error instanceof TwoByTwoError) return "Could not find a solution";
  return "Something went wrong while solving";
}
