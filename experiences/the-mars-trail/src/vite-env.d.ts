/// <reference types="vite/client" />

/** JSON module import for the Mint asset registry. */
declare module '*.json' {
  const value: unknown;
  export default value;
}

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  score: number;
  targetScore: number;
  complete: boolean;
  phase: string;
  outcome: string;
  mission: {
    day: number;
    windowDaysLeft: number;
    leg: number;
    routeId: string | null;
    kmTotal: number;
    kmTotalLabel: string;
    driveCores: number;
    hullIntegrity: number;
    livingCrew: number;
    rationsKg: number;
  };
  flight: {
    active: boolean;
    sequence?: string;
    progress?: number;
    hits?: number;
  };
  pipeline: {
    internalWidth: number;
    internalHeight: number;
    phosphor: boolean;
    exposure: number;
    /** Near-band scroll offset; rises while travelling. */
    scrollX: number;
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
  /**
   * Jump to a named state for baselines:
   * 'title' | 'active-play' | 'deep-space' | 'mars-approach' | 'event' | 'complete'
   */
  setState(name: string): void;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Freeze ambient/idle animation time so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Hide non-game chrome (filter toggle, boot status) before capturing. */
  hideDebugUi(hidden: boolean): void;
  /** Toggle the monochrome CRT filter directly, for filter baselines. */
  setPhosphor(enabled: boolean): void;
  /** Set the pixelation buffer height, for display-settings checks. */
  setInternalHeight(height: number): void;
  /**
   * Play a complete run under a named policy and stop on the score screen.
   * Styles: 'careful' | 'reckless' | 'starve' | 'dawdle'.
   */
  /** Start a flight sequence directly, for browser coverage. */
  startFlight(sequence: string, seed: number): void;
  /** Drive the live sequence with a scripted pilot; null returns control. */
  setFlightAutopilot(skill: number | null): void;
  /** Read the live sequence state. */
  flightSnapshot(): {
    active: boolean;
    sequence?: string;
    seconds?: number;
    progress?: number;
    hits?: number;
    shipX?: number;
    shipY?: number;
    /** True during the scripted liftoff, before control hands over. */
    cinematic?: boolean;
    liftoff?: number;
    /** Launch sequence stage: pad, ignition, boost, staged, flying. */
    stage?: string;
    throttle?: number;
    twr?: number;
    altitude?: number;
    health?: number;
    climb?: number;
    prelaunch?: number;
    hazardWarning?: boolean;
  };
  /** Abandon the live sequence. */
  abortFlight(): void;
  /** Step the live sequence forward without rendering, for fast coverage. */
  fastForwardFlight(seconds: number): void;
  playToEnd(
    style: string,
    seed: number,
  ): { outcome: string; steps: number; day: number; leg: number; survivors: number };
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
