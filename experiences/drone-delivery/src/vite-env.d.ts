/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  score: number;
  targetScore: number;
  complete: boolean;
  mission?: {
    phase: string;
    step: string;
    carrying: boolean;
    battery: number;
    hull: number;
    condition: number;
    landed: boolean;
    armed: boolean;
    target: { x: number; y: number; z: number; radius: number } | null;
  };
  player: {
    position: { x: number; y: number; z: number };
    velocity?: { x: number; y: number; z: number };
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
  /** Jump to a named state for baselines (scaffold: 'active-play' | 'complete'). */
  setState(name: string): void;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Freeze ambient/idle animation time so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Hide debug UI (lil-gui) before capturing. */
  hideDebugUi(hidden: boolean): void;
  /** Test-only: multiply game time so slow headless runs finish routes. */
  setTimeScale?(scale: number): void;
  /** Test-only: current route's static colliders, for layout tooling. */
  dumpColliders?(): Array<{
    label: string;
    min: [number, number, number];
    max: [number, number, number];
  }>;
  /** Test-only: current positions of moving and linear colliders. */
  dumpHazards?(): {
    spheres: Array<{ label: string; center: [number, number, number] }>;
    segments: Array<{
      label: string;
      start: [number, number, number];
      end: [number, number, number];
    }>;
  };
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
