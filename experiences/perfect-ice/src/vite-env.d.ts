/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  phase: 'intro' | 'playing' | 'paused' | 'complete' | 'failed';
  level: string;
  score: number;
  complete: boolean;
  failed: boolean;
  objective: { coverage: number; target: number };
  resources: { water: number; fuel: number };
  penalties: { collisions: number; overlapRatio: number; wastedWater: number };
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
    heading: number;
    renderHeading: number;
    steeringAngle: number;
    resurfacing: boolean;
  };
  ice: {
    visualRevision: number;
    tool: { x: number; z: number; heading: number };
    toolCell: { playable: boolean; passCount: number; roughness: number; finishAlpha: number } | null;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    materials: number;
  };
  simulation: {
    engine: string;
    timestep: number;
    bodies: number;
    colliders: number;
    ccdBodies: number;
    sensors: number;
  };
  rink: {
    halfWidth: number;
    halfDepth: number;
    cornerRadius: number;
    continuousBoards: boolean;
    continuousGlass: boolean;
    mintModulesReady: boolean;
    mintDisplayOutsideIce: boolean;
    mintArchiveInactive: boolean;
    mintVehicleReady: boolean;
  };
  audio: {
    unlocked: boolean;
    contextState: string;
    muted: boolean;
    engineActive: boolean;
    resurfacingActive: boolean;
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
  seed(value: number): void;
  setState(name: string): void;
  setPausedForScreenshot(paused: boolean): void;
  setReducedMotion(enabled: boolean): void;
  hideDebugUi(hidden: boolean): void;
  setCoverage(value: number): void;
  setResurfacing(active: boolean): void;
  setVehiclePose(x: number, z: number, heading: number): void;
  setInspectionView(view: 'overview' | 'north-east' | 'north-west' | 'south-east' | 'south-west' | 'chase'): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
