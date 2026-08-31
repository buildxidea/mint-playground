/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  score: number;
  targetScore: number;
  complete: boolean;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
    yaw: number;
    velocity: { x: number; z: number };
    presentation: { pitch: number; roll: number };
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    frameTimeMs: number;
    fps: number;
    waterVertices: number;
    postPasses: number;
    shadowMapSize: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
  level?: number;
  damage?: number;
  holdProgress?: number;
  phase?: string;
  dockingInside?: boolean;
  dockingAligned?: boolean;
  autopilot?: boolean;
  input?: { throttle: number; steer: number; brake: number };
  marinaMinY?: number | null;
  boatMinY?: number | null;
  obstacleCount?: number;
  selectedBoat?: string;
  sinkingProgress?: number;
  playerWake?: {
    active: boolean;
    emitterSpeed: number;
    sampleCount: number;
    trailLength: number;
    sprayParticles: number;
    froude: number;
    emitterCount: number;
  };
  traffic?: {
    boats: number;
    wakeEmitters: number;
    nearestDistance: number | null;
  };
  environment?: {
    windStrength: number;
    gustFactor: number;
    swellEnergy: number;
    waveComponents: number;
    wakeAtPlayer: number;
    heave: number;
    pitch: number;
    roll: number;
    force: { x: number; z: number };
    torque: number;
  };
  floating?: {
    total: number;
    byKind: {
      player: number;
      traffic: number;
      'moored-boat': number;
      buoy: number;
      pontoon: number;
    };
    maxHeave: number;
    maxPitch: number;
    maxRoll: number;
  };
  physics?: {
    engine: 'custom-arcade';
    timestep: number;
    staticColliders: number;
    movingColliders: number;
    ccdBodies: number;
    sweptHits: number;
    maxPenetration: number;
    unresolvedContacts: number;
    debugVisible: boolean;
    debugMeshes: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void;
  /** Jump to a named state for baselines (scaffold: 'active-play' | 'complete'). */
  setState(name: string): void;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Move the camera to a deterministic wake-inspection angle. */
  setWakeInspectionView?(view: 'chase' | 'elevated' | 'side'): void;
  /** Freeze ambient/idle animation time so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Switch the water renderer between final, foam-mask, and normal views. */
  setWaterDebugMode?(mode: 'composite' | 'foam' | 'normal'): void;
  /** Hide debug UI (lil-gui) before capturing. */
  hideDebugUi(hidden: boolean): void;
  /** Optional bot helper: apply a one-frame boat command override. */
  setCommand?(command: { throttle: number; steer: number; brake: number }): void;
  /** Advance a deterministic player command through the fixed-step simulation. */
  runCommandFor?(
    simSeconds: number,
    command: { throttle: number; steer: number; brake: number },
  ): void;
  /** Load a level index (0-14) and enter play. */
  setLevel?(index: number): void;
  /** Select a player hull id and rebuild the current level mesh. */
  setBoat?(boatId: string): boolean;
  /** Force the current hull into the damage-failure sinking sequence. */
  sinkBoat?(): void;
  /** Enable docking autopilot for completability sweeps. */
  startAutopilot?(): void;
  stopAutopilot?(): void;
  /**
   * Advance the sim with autopilot for up to maxSimSeconds (fixed dt),
   * bypassing rAF throttling. Returns true if the slip completed.
   */
  runAutopilotFor?(maxSimSeconds: number): boolean;
  sampleAutopilot?(
    maxSimSeconds: number,
    everySec?: number,
  ): Array<{ t: number; x: number; z: number; yaw: number; speed: number; dmg: number }>;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
