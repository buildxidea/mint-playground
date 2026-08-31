import { CUBE_SIZES, Axis, coordsOf } from "../cube/constants";
import { CubeState, Move, Turns, parseAlg, moveToString } from "../cube/state";
import { randomScramble, seededRandom } from "../cube/scramble";
import { solve as solve3x3 } from "../solver/layerByLayer";
import { solve2x2, ensureTables } from "../solver/twoByTwo";
import { canSolve, solveCube, UnsupportedSizeError } from "../solver";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

const FACES = ["U", "D", "R", "L", "F", "B"] as const;

/* ------------------------------------------------ move engine invariants */

console.log("\nMove engine (all sizes)");

{
  // n^3 minus the hidden core.
  const expected: Record<number, number> = { 2: 8, 3: 26, 4: 56, 5: 98, 6: 152 };
  for (const n of CUBE_SIZES) {
    const s = new CubeState(n);
    check(
      `${n}x${n} has ${expected[n]} visible cubies`,
      s.cubies.length === expected[n],
      `got ${s.cubies.length}`,
    );
  }
}

for (const n of CUBE_SIZES) {
  const s = new CubeState(n);
  check(`${n}x${n} starts solved`, s.isSolved());
}

for (const n of CUBE_SIZES) {
  let ok = true;
  for (const face of FACES) {
    const s = new CubeState(n);
    s.applyMoves(parseAlg(n, `${face} ${face} ${face} ${face}`));
    if (!s.isSolved()) ok = false;
  }
  check(`${n}x${n}: every face turned 4x is identity`, ok);
}

for (const n of CUBE_SIZES) {
  let ok = true;
  for (const face of FACES) {
    const s = new CubeState(n);
    s.applyMoves(parseAlg(n, `${face} ${face}'`));
    if (!s.isSolved()) ok = false;
  }
  check(`${n}x${n}: face then its inverse is identity`, ok);
}

for (const n of CUBE_SIZES) {
  // Every layer, including inner slices, must be a valid 4-fold rotation.
  let ok = true;
  for (const axis of [0, 1, 2] as Axis[]) {
    for (const layer of coordsOf(n)) {
      const s = new CubeState(n);
      for (let i = 0; i < 4; i++) s.applyMove({ axis, layer, turns: 1 });
      if (!s.isSolved()) ok = false;
    }
  }
  check(`${n}x${n}: every slice turned 4x is identity`, ok);
}

for (const n of CUBE_SIZES) {
  const rng = seededRandom(n * 77 + 5);
  const s = new CubeState(n);
  const scramble = randomScramble(n, { random: rng });
  s.applyMoves(scramble);
  const scrambled = !s.isSolved();
  const inverse: Move[] = [...scramble].reverse().map((m) => ({
    axis: m.axis,
    layer: m.layer,
    turns: (m.turns === 2 ? 2 : m.turns === 1 ? -1 : 1) as Turns,
  }));
  s.applyMoves(inverse);
  check(`${n}x${n}: scramble then inverse returns to solved`, scrambled && s.isSolved());
}

{
  const s = new CubeState(3);
  s.applyMoves(parseAlg(3, "R U F' L2 B D'"));
  const centres = s.cubies.filter(
    (c) => [c.home[0], c.home[1], c.home[2]].filter((v) => v !== 0).length === 1,
  );
  check(
    "3x3 centres never leave home",
    centres.length === 6 &&
      centres.every(
        (c) =>
          c.pos[0] === c.home[0] &&
          c.pos[1] === c.home[1] &&
          c.pos[2] === c.home[2],
      ),
  );
}

{
  const round = parseAlg(3, "R U' F2 B' D L2")
    .map((m) => moveToString(3, m))
    .join(" ");
  check("3x3 notation round-trips", round === "R U' F2 B' D L2", `got "${round}"`);
}

{
  const s = new CubeState(3);
  const identities = new Set(s.cubies);
  const first = s.cubies[0];
  s.applyMoves(parseAlg(3, "R U F' L2 B D'"));
  s.reset();
  check(
    "reset preserves cubie identity",
    s.cubies.length === identities.size &&
      s.cubies.every((c) => identities.has(c)) &&
      s.cubies[0] === first,
  );
  check("reset returns to solved", s.isSolved());
}

{
  // Scrambles must actually scramble, at every size.
  let ok = true;
  for (const n of CUBE_SIZES) {
    for (let seed = 1; seed <= 20; seed++) {
      const s = new CubeState(n);
      s.applyMoves(randomScramble(n, { random: seededRandom(seed * 31 + n) }));
      if (s.isSolved()) ok = false;
    }
  }
  check("scrambles never leave a cube solved", ok);
}

{
  // 3x3 scrambles must not use inner slices - the solver could not undo them.
  let ok = true;
  for (let seed = 1; seed <= 40; seed++) {
    for (const m of randomScramble(3, { random: seededRandom(seed) })) {
      if (Math.abs(m.layer) !== 2) ok = false;
    }
  }
  check("3x3 scrambles use outer faces only", ok);
}

{
  // 2x2 scrambles must fix the DBL corner, which the solver's coordinates need.
  let ok = true;
  for (let seed = 1; seed <= 40; seed++) {
    const s = new CubeState(2);
    s.applyMoves(randomScramble(2, { random: seededRandom(seed) }));
    const fixed = s.piece([-1, -1, -1]);
    if (fixed.pos[0] !== -1 || fixed.pos[1] !== -1 || fixed.pos[2] !== -1) ok = false;
  }
  check("2x2 scrambles keep the DBL corner home", ok);
}

/* -------------------------------------------------------------- solvers */

console.log("\n2x2 solver");

{
  const started = Date.now();
  ensureTables();
  console.log(`  table build ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

{
  const TRIALS = Number(process.env.TRIALS_2 ?? 400);
  let solved = 0;
  let total = 0;
  let longest = 0;
  const started = Date.now();

  for (let seed = 1; seed <= TRIALS; seed++) {
    const state = new CubeState(2);
    state.applyMoves(randomScramble(2, { random: seededRandom(seed) }));
    try {
      const solution = solve2x2(state);
      const verify = state.clone();
      verify.applyMoves(solution);
      if (verify.isSolved()) {
        solved++;
        total += solution.length;
        longest = Math.max(longest, solution.length);
      }
    } catch (error) {
      if (solved < 3) console.log(`  seed ${seed}: ${(error as Error).message}`);
    }
  }

  check(`solves ${TRIALS}/${TRIALS} random 2x2 scrambles`, solved === TRIALS, `solved ${solved}`);
  check(
    "2x2 solutions are within God's number (11)",
    longest <= 11,
    `longest ${longest}`,
  );
  if (solved > 0) {
    console.log(
      `  average ${(total / solved).toFixed(1)} moves, longest ${longest}, ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }
}

{
  // A player can drag any layer, which can carry the fixed corner away.
  // The solver must re-orient the whole cube and still finish.
  let solved = 0;
  const TRIALS = 120;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const rng = seededRandom(seed * 13 + 1);
    const state = new CubeState(2);
    for (let i = 0; i < 14; i++) {
      const axis = Math.floor(rng() * 3) as Axis;
      const layer = rng() < 0.5 ? -1 : 1;
      const turns = ([1, -1, 2] as Turns[])[Math.floor(rng() * 3)];
      state.applyMove({ axis, layer, turns });
    }
    try {
      const solution = solve2x2(state);
      const verify = state.clone();
      verify.applyMoves(solution);
      if (verify.isSolved()) solved++;
    } catch {
      /* counted as a failure below */
    }
  }
  check(
    `2x2 solves ${TRIALS}/${TRIALS} positions reached by dragging any layer`,
    solved === TRIALS,
    `solved ${solved}`,
  );
}

{
  const solution = solve2x2(new CubeState(2));
  check("already-solved 2x2 returns an empty solution", solution.length === 0);
}

console.log("\n3x3 solver");

{
  const TRIALS = Number(process.env.TRIALS ?? 300);
  let solved = 0;
  let stalled = 0;
  let total = 0;
  let longest = 0;
  const started = Date.now();

  for (let seed = 1; seed <= TRIALS; seed++) {
    const state = new CubeState(3);
    state.applyMoves(randomScramble(3, { random: seededRandom(seed) }));
    try {
      const solution = solve3x3(state);
      const verify = state.clone();
      verify.applyMoves(solution);
      if (verify.isSolved()) {
        solved++;
        total += solution.length;
        longest = Math.max(longest, solution.length);
      }
    } catch (error) {
      stalled++;
      if (stalled <= 3) console.log(`  seed ${seed}: ${(error as Error).message}`);
    }
  }

  check(
    `solves ${TRIALS}/${TRIALS} random 3x3 scrambles`,
    solved === TRIALS,
    `solved ${solved}, stalled ${stalled}`,
  );
  if (solved > 0) {
    console.log(
      `  average ${(total / solved).toFixed(1)} moves, longest ${longest}, ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }
}

{
  const solution = solve3x3(new CubeState(3));
  check("already-solved 3x3 returns an empty solution", solution.length === 0);
}

{
  // Dragging the middle layer of a 3x3 is a slice turn, which permutes the
  // centres - and no face turn can put a centre back. The solver has to
  // re-orient the whole cube first or it stalls at the very last stage.
  let solved = 0;
  const TRIALS = 25;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const s = new CubeState(3);
    s.applyMoves(randomScramble(3, { random: seededRandom(seed) }));
    s.applyMove({ axis: (seed % 3) as Axis, layer: 0, turns: 1 });
    try {
      const solution = solve3x3(s);
      const verify = s.clone();
      verify.applyMoves(solution);
      if (verify.isSolved()) solved++;
    } catch {
      /* counted as a failure */
    }
  }
  check(
    `3x3 solves ${TRIALS}/${TRIALS} positions reached by a middle-slice drag`,
    solved === TRIALS,
    `solved ${solved}`,
  );
}

/* ------------------------------------------------------------ dispatcher */

console.log("\nSolver dispatch");

for (const n of CUBE_SIZES) {
  const supported = n === 2 || n === 3;
  check(`canSolve(${n}) is ${supported}`, canSolve(n) === supported);
}

for (const n of [4, 5, 6]) {
  const state = new CubeState(n);
  state.applyMoves(randomScramble(n, { random: seededRandom(n) }));
  let threw = false;
  try {
    solveCube(state);
  } catch (error) {
    threw = error instanceof UnsupportedSizeError;
  }
  check(`solveCube(${n}x${n}) reports unsupported rather than failing`, threw);
}

console.log(
  failures === 0 ? `\nAll checks passed.\n` : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
