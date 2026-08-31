/// <reference types="vite/client" />

interface ThreeGameDriveMapObstacle {
  kind: string;
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
}

interface ThreeGameDriveMapBay {
  x: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
}

interface ThreeGameDriveMapSpawn {
  x: number;
  z: number;
  yaw: number;
}

interface ThreeGameDriveRoutePoint {
  x: number;
  z: number;
  yaw?: number;
  reverse?: boolean;
  positionTolerance?: number;
  yawTolerance?: number;
}

interface ThreeGameDriveMap {
  halfW: number;
  halfD: number;
  asphalt: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  } | null;
  obstacles: ThreeGameDriveMapObstacle[];
  bay: ThreeGameDriveMapBay;
  spawn: ThreeGameDriveMapSpawn;
  driveRoute: ThreeGameDriveRoutePoint[];
  challengeIndex: number;
  vehicleId: string;
}

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
  align?: number;
  fitClearance?: number;
  challengeIndex?: number;
  phase?: string;
  collisions?: number;
  lineViolations?: number;
  groundClearance?: number;
  asphaltClearance?: number;
  steerAngle?: number;
  heading?: {
    physicsX: number;
    physicsZ: number;
    sizeX: number;
    sizeZ: number;
    lengthAlongHeading: boolean;
  };
  insideBay?: boolean;
  successHold?: number;
  vehicleId?: string;
  scene?: {
    parkedCars: number;
    genericCars: number;
    parkingSpaces: number;
    environmentAssets: number;
    minParkedGroundClearance: number;
    maxParkedGroundClearance: number;
    minParkedAsphaltClearance: number;
    parkedGroundClearances: Array<{ label: string; clearance: number }>;
    minPlacementClearance: number;
    placementConflictCount: number;
  };
  physics?: {
    engine: 'rapier';
    timestep: number;
    bodies: number;
    colliders: number;
    sensors: number;
    ccdBodies: number;
    contacts: string[];
  };
}

interface ThreeGameTestHooks {
  seed(value: number): void;
  setState(name: string): void;
  setPausedForScreenshot(paused: boolean): void;
  setReducedMotion(enabled: boolean): void;
  hideDebugUi(hidden: boolean): void;
  setChallenge?(index: number): void;
  forceParkSuccess?(): void;
  setPose?(x: number, z: number, yaw?: number): void;
  setVehicle?(id: 'compact' | 'sports' | 'van'): void;
  getDriveMap?(): ThreeGameDriveMap;
  setCameraOrbit?(yaw: number, pitch?: number, distance?: number): void;
  /** Override drive axes for bots; pass null to clear. */
  injectAxes?(axes: { throttle?: number; steer?: number; brake?: number } | null): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
