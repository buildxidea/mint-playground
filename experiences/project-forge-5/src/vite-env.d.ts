/// <reference types="vite/client" />

import type { CameraMode, ControlMode, RobotId, RoomId } from './config/catalog';
import type { RobotSensorSnapshot } from './sensors/RobotSensorSuite';
import type { RobotTaskSnapshot, RobotTaskVerb } from './tasks/RobotTaskController';
import type { OutdoorFreeplaySnapshot } from './freeplay/OutdoorFreeplayObjects';
import type { CarryableObjectId } from './robots/RobotCarryRigContract';
import type {
  TaskFixtureObservation,
  TaskObjectObservation,
  WorldContainmentDiagnostics,
} from './physics/PhysicsWorld';

declare type Forge5Diagnostics = {
  frame: number;
  elapsed: number;
  phase: string;
  robotId: RobotId;
  roomId: RoomId;
  controlMode: ControlMode;
  cameraMode: string;
  robot: {
    position: { x: number; y: number; z: number };
    yaw: number;
    speed: number;
    grounded: boolean;
    battery: number;
    collisions: number;
    emergencyStopped: boolean;
    mobilityPosture: 'standing' | 'crouched' | 'crawling';
    taskAction: RobotTaskSnapshot;
    capabilities: {
      taskVerbs: readonly RobotTaskVerb[];
      secondaryAction: 'release-or-cancel';
      supportsPrecisionMotion: true;
      supportsPostureCycle: boolean;
    };
    sensors: RobotSensorSnapshot;
    visual: {
      status: 'fallback-loading' | 'production' | 'fallback-error';
      source: 'fallback' | 'production';
      error: string | null;
      visibleMintComponents: number;
      expectedVisibleMintComponents: number;
      taskAnimation: {
        active: boolean;
        verb: RobotTaskVerb;
        phase: number;
        profile: string;
      } | null;
      jumpAnimation: {
        active: boolean;
        phase: 'grounded' | 'takeoff' | 'ascent' | 'apex' | 'descent' | 'landing';
        phaseProgress: number;
        verticalVelocity: number;
        sequence: number;
        profile: string;
        articulatedJoints?: number;
      } | null;
      groundClearanceMeters: number;
    };
    articulation: {
      source: 'mint-axiom-h1-24-joint-rig';
      joints: number;
      sockets: number;
      limitStatus: 'runtime-engineering-envelope-v1';
      socketStatus: 'runtime-calibrated-offsets-v1';
      actuation: {
        sequence: number;
        mode: 'idle' | 'bimanual-reach';
        phase: number;
        reachTarget: readonly [number, number, number];
        reachErrorMeters: number;
        jointDeltas: Record<string, readonly [number, number, number]>;
        endEffectors: {
          left: {
            target: readonly [number, number, number];
            actual: readonly [number, number, number];
            errorMeters: number;
          };
          right: {
            target: readonly [number, number, number];
            actual: readonly [number, number, number];
            errorMeters: number;
          };
        } | null;
      };
    } | null;
  };
  episode: {
    status: string;
    tick: number;
    elapsedSeconds: number;
    objectiveIndex: number;
    pathDistance: number;
    maxHorizontalDisplacementFromStart: number;
    dockHoldSeconds: number;
    requiresInteraction: boolean;
    requiredTaskVerb: RobotTaskVerb | null;
    currentGoal: { x: number; y: number; z: number } | null;
  } | null;
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  physics: {
    bodies: number;
    colliders: number;
    sensors: number;
    ccdBodies: number;
  };
  containment: WorldContainmentDiagnostics;
  physicsMotion: {
    desired: { x: number; y: number; z: number };
    computed: { x: number; y: number; z: number };
    grounded: boolean;
    collisions: readonly {
      normal: { x: number; y: number; z: number };
      witness: { x: number; y: number; z: number };
      timeOfImpact: number;
    }[];
  };
  physicsContacts: {
    sequence: number;
    profile: 'none' | 'axiom-biped-feet-v1';
    leftFoot: boolean;
    rightFoot: boolean;
    supportCount: number;
    grounded: boolean;
  };
  taskObject: TaskObjectObservation | null;
  taskFixtures: {
    'control-panel-east': TaskFixtureObservation | null;
    'dock-south': TaskFixtureObservation | null;
  };
  replay: {
    version: 4 | null;
    frame: number;
    divergences: number;
    lastDivergence: string | null;
  };
  dynamicGate: {
    physicsY: number | null;
    visualY: number | null;
  };
  navigation: {
    worker: boolean;
    mode: 'commissioning-grid' | 'collider-navmesh' | 'blocked';
    profile: string | null;
    sourceMeshes: number;
    buildMilliseconds: number;
    routePointsProjected: number;
    cachedSegments: number;
    pathPoints: number;
    pathIndex: number;
    pathPreview: { x: number; y: number; z: number }[];
  };
  world: {
    status: 'commissioning' | 'loading' | 'production' | 'fallback-error' | 'sandbox';
    roomId: RoomId | 'outdoor-freeplay';
    assetId: string | null;
    colliderMeshes: number;
    colliderTriangles: number;
    error: string | null;
    containmentContract: {
      sourceSplatSha256: string;
      envelope: 'shared-root-collider-aabb' | 'reviewed-visual-safe-aabb';
      reviewStatus:
        | 'coordinate-alignment-reviewed'
        | 'collider-envelope-reviewed'
        | 'visual-splat-safe-volume-reviewed';
      semanticAuthority: false;
    };
    visualGuard: {
      status: 'active' | 'inactive' | 'blocked';
      id: string | null;
      contractSha256: string | null;
      sourceAssetId: string | null;
      bounds: {
        min: readonly [number, number, number];
        max: readonly [number, number, number];
      } | null;
      renderedEnvelopePolicy: 'per-robot-turn-clearance' | null;
      maximumRobotHorizontalMarginMeters: number | null;
      failurePolicy: 'block-outdoor-world' | null;
    };
    visualSource: 'mint-rad' | 'commissioning-proxy' | 'qualification-blocked';
    semantics: 'pending-analyzer' | 'commissioning' | 'unavailable';
  };
  props: {
    status: 'inactive' | 'loading' | 'ready' | 'error';
    instances: number;
    colliders: number;
    movingBodies: number;
    error: string | null;
  };
  freeplay: OutdoorFreeplaySnapshot;
  calibration: {
    roomId: RoomId | null;
    candidateOnly: boolean;
    rawBoxes: number;
    mappedBoxes: number;
    labels: number;
    routePoints: number;
    colliderMeshes: number;
  };
  layers: Record<string, boolean>;
  audio: {
    activeEmitters: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
  scene: {
    directChildren: readonly {
      name: string;
      type: string;
      visible: boolean;
    }[];
    robotWorldBounds: {
      min: number[];
      max: number[];
    };
    robotMatrixWorld: number[];
  };
};

declare type Forge5TestHooks = {
  seed(value: number): void;
  setState(name: 'intro' | 'robot-select' | 'sandbox' | 'active-play' | 'results'): void;
  setPausedForScreenshot(paused: boolean): void;
  setReducedMotion(enabled: boolean): void;
  setRenderScaleForTest(scale: number): void;
  setRobot(robotId: RobotId): void;
  setRoom(roomId: RoomId): void;
  setControlMode(mode: ControlMode): void;
  setRobotPoseForTest(surfacePosition: [number, number, number], yaw: number): void;
  teleportRobotForTest(surfacePosition: [number, number, number], yaw: number): void;
  advanceRobotForTest(translation: [number, number, number], ticks: number): void;
  advanceLiveForTest(ticks: number): void;
  advanceSandboxForTest(translation: [number, number, number], ticks: number): void;
  flushSandboxInputForTest(ticks: number): void;
  resetSandbox(): void;
  diagnosticReport(): unknown;
  advanceReplayForTest(ticks: number): void;
  triggerTaskAction(verb?: RobotTaskVerb): boolean;
  startReplay(): void;
  hideDebugUi(hidden: boolean): void;
  setDebugLayer(
    layer: 'colliders' | 'navigation' | 'semantics' | 'triggers',
    enabled: boolean,
  ): void;
  setCalibrationView(view: 0 | 1 | 2 | 3): void;
  setCameraForTest(position: [number, number, number], target: [number, number, number]): void;
  setCameraModeForTest(mode: CameraMode): void;
  inspectionViewState(): {
    owner: 'none' | 'inspection' | 'sandbox';
    claimed: boolean;
    enabled: boolean;
    autoRotate: boolean;
    position: number[];
    target: number[];
  };
  stageFreeplayObjectForTest(objectId: CarryableObjectId): boolean;
  captureCalibrationFrame(): string;
  sampleVisualSurfaceForTest(position: [number, number, number]): readonly {
    point: { x: number; y: number; z: number };
    distanceMeters: number;
  }[];
};

declare global {
  interface Window {
    __FORGE5_DIAGNOSTICS__?: Forge5Diagnostics;
    __FORGE5_TEST_HOOKS__?: Forge5TestHooks;
    __THREE_APP_DIAGNOSTICS__?: Forge5Diagnostics;
    __THREE_APP_TEST_HOOKS__?: Forge5TestHooks;
  }
}

export {};
