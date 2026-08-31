/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  state: 'title' | 'intro' | 'playing' | 'paused' | 'results';
  levelId: string;
  levelIndex: number;
  /** Fraction of the mowable yard that has been cut. */
  coverage: number;
  /** Fraction of the tank remaining. */
  fuel: number;
  grade: 'S' | 'A' | 'B' | 'C' | null;
  passed: boolean;
  bestScore: number;
  muted: boolean;
  blades: number;
  /** The mower. Named `player` so the shared QA scripts keep working. */
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void;
  /** Jump to a named state for baselines: 'title' | 'intro' | 'active-play' | 'complete'. */
  setState(name: string): void;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Freeze wind and particles so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Kept for the shared QA scripts; this build ships no debug UI. */
  hideDebugUi(hidden: boolean): void;
  /** Jump straight to a level index. */
  loadLevel(index: number): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
