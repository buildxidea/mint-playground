/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  /** Boat Park: hull damage percentage. */
  damage?: number;
  /** Boat Park: piers and moored hulls currently collidable. */
  obstacleCount?: number;
  /** Boat Park: live hazards on the course. */
  hazards?: { kind: string; x: number; z: number; radius: number; damage: number }[];
  /** Boat Park: slalom progress and gate layout. */
  course?: {
    cleared: number;
    missed: number;
    total: number;
    penaltySeconds: number;
    startZ: number;
    gates: { x: number; z: number; halfWidth: number; cleared: boolean | null }[];
  };
  /** Boat Park: the berth the player is aiming for. */
  berth?: {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
    mode: 'slip' | 'alongside';
    targetHeading: number;
    entranceZ: number;
  };
  score: number;
  targetScore: number;
  complete: boolean;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
    /** Degrees between the bow and the hull's actual course — the drift. */
    slipAngleDeg?: number;
    headingDeg?: number;
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
  /** Boat Park: world-space bounding box of the active boat, for QA. */
  measureBoat?(): { x: number; y: number; z: number; heading: number };
  /** Boat Park: advance the hull at a fixed timestep, independent of frame rate. */
  stepPhysics?(options?: {
    seconds?: number;
    dt?: number;
    throttle?: number;
    rudder?: number;
    boost?: boolean;
    /** Set false to advance the hull without pier/neighbour collisions. */
    collide?: boolean;
  }): {
    speed: number;
    courseSpeed: number;
    slipAngleDeg: number;
    heading: number;
    x: number;
    z: number;
    damage: number;
  };
  /** Boat Park: drop the hull at a pose, at rest. */
  placeBoat?(pose: { x: number; z: number; heading?: number }): void;
  /** Boat Park: live positions of the sea life, for animation QA. */
  wildlife?(): {
    whale: { x: number; y: number; z: number; phase: string; visible: boolean } | null;
    dolphins: {
      x: number;
      y: number;
      z: number;
      behaviour: string;
      visible: boolean;
      size: { x: number; y: number; z: number };
    }[];
  };
  /** Boat Park: audio mixer state, for QA. */
  audioState?(): {
    supported: boolean;
    contextState: string;
    buffersLoaded: number;
    loopsRunning: number;
    masterGain: number;
    muted: boolean;
  };
  /** Boat Park: hull and pier heights relative to the waterline, for QA. */
  measureWaterline?(): {
    boatKeel: number;
    boatTop: number;
    boatY: number;
    usingModel: boolean;
    dockBottom: number;
    dockTop: number;
    maxWave: number;
  };
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
