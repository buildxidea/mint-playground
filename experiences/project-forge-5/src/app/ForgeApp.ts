import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AppStateMachine, type AppPhase } from './AppStateMachine';
import {
  getRobot,
  getScenario,
  type CameraMode,
  type RobotId,
  type RoomId,
} from '../config/catalog';
import {
  FORGE_PROP_PACK_BY_ROOM,
  FORGE_PROP_PLACEMENTS_BY_ROOM,
  MintPropSession,
} from '../assets/props';
import { getScenarioNavigationApproach } from '../config/scenarioRoutes';
import { InputController, type InputIntent } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { SimulationClock } from '../core/SimulationClock';
import { PathPlanningService } from '../navigation/PathPlanningService';
import { DiagnosticRecorder } from '../diagnostics/DiagnosticRecorder';
import type { PhysicsWorld, TaskFixtureObservation } from '../physics/PhysicsWorld';
import { computeReplayStateHash, ReplayRecorder, type ReplayData } from '../replay/ReplayRecorder';
import { RobotRuntime, type RobotMobilityPosture } from '../robots/RobotRuntime';
import {
  formatRobotTaskVerb,
  getRobotCapabilityProfile,
  supportsRobotTaskVerb,
} from '../robots/RobotCapabilities';
import type { ScoreBreakdown } from '../scoring/ScoreCalculator';
import { SplatCalibrationDebugOverlay } from '../splats/SplatCalibrationDebugOverlay';
import { assertRuntimeBoundsMatchContainment } from '../splats/SplatContainmentManifest';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraDirector } from '../systems/CameraDirector';
import { SandboxViewDriveController } from '../systems/SandboxViewDriveController';
import { TrainingEpisode } from '../training/TrainingEpisode';
import {
  defaultRobotTaskVerb,
  resolveScenarioTaskVerb,
  type RobotTaskVerb,
} from '../tasks/RobotTaskController';
import { KINETIC_HALL_TASK_FIXTURES } from '../tasks/KineticHallPhysicalTaskContract';
import {
  OperatorInterface,
  type LiveUiSnapshot,
  type SandboxUiSnapshot,
} from '../ui/OperatorInterface';
import { CommissioningWorld } from '../worlds/CommissioningWorld';
import {
  getForgeMintScenarioRoute,
  getForgeMintContainmentManifest,
  getForgeMintWorld,
  getForgeMintWorldBounds,
  MINT_WORLD_EXPERIENCE_SCALE,
  scaleMintWorldPropPlacements,
} from '../worlds/ForgeMintWorldCatalog';
import { MintWorldSession } from '../worlds/MintWorldSession';
import { getObjectiveGuidance } from '../training/TrainingGuidance';
import { OUTDOOR_FREEPLAY_OBJECTS } from '../freeplay/OutdoorFreeplayCatalog';
import { OutdoorFreeplayObjects } from '../freeplay/OutdoorFreeplayObjects';
import type { CarryableObjectId } from '../robots/RobotCarryRigContract';
import {
  OUTDOOR_FREEPLAY_WORLD,
  getOutdoorFreeplayReviewedBounds,
} from '../freeplay/OutdoorFreeplayWorld';
import {
  OUTDOOR_VISUAL_GUARD,
  OUTDOOR_VISUAL_GUARD_SHA256,
  assertOutdoorVisualGuardCompatible,
  createOutdoorVisualGuardDebugHelper,
  getOutdoorVisualSafeBounds,
} from '../freeplay/OutdoorVisualGuard';

const MAX_PERSISTED_REPLAY_CHARACTERS = 4_000_000;

const CAMERA_MODES: readonly CameraMode[] = [
  'chase',
  'follow',
  'first-person',
  'sensor',
  'orbit',
  'carry',
  'fixed',
  'overhead',
];

type DebugLayerState = {
  colliders: boolean;
  navigation: boolean;
  semantics: boolean;
  triggers: boolean;
};

type WorldRuntimeState = {
  status: 'commissioning' | 'loading' | 'production' | 'fallback-error' | 'sandbox';
  roomId: RoomId | 'outdoor-freeplay';
  assetId: string | null;
  colliderMeshes: number;
  colliderTriangles: number;
  error: string | null;
};

type PropRuntimeState = {
  status: 'inactive' | 'loading' | 'ready' | 'error';
  instances: number;
  colliders: number;
  movingBodies: number;
  error: string | null;
};

type ViewControlOwner = 'none' | 'inspection' | 'sandbox';

export class ForgeApp {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.05, 180);
  private readonly viewControls: OrbitControls;
  private readonly sandboxViewDrive = new SandboxViewDriveController();
  private readonly input: InputController;
  private readonly state = new AppStateMachine();
  private readonly clock = new SimulationClock(60, 4);
  private readonly world: CommissioningWorld;
  private readonly cameraDirector = new CameraDirector(this.camera);
  private readonly planner = new PathPlanningService();
  private readonly audio = new AudioSystem();
  private readonly diagnostics = new DiagnosticRecorder(
    1_024,
    new URLSearchParams(window.location.search).get('diagnostics') === 'verbose',
  );
  private readonly calibrationDebug = new SplatCalibrationDebugOverlay(this.scene);
  private readonly outdoorVisualGuardDebug = createOutdoorVisualGuardDebugHelper();
  private readonly ui: OperatorInterface;
  private readonly loop: Loop;
  private readonly mintWorlds: MintWorldSession;
  private readonly props: MintPropSession;
  private readonly freeplayObjects: OutdoorFreeplayObjects;
  private readonly productionWorldsEnabled: boolean;
  private robot: RobotRuntime;
  private episode: TrainingEpisode | null = null;
  private recorder: ReplayRecorder | null = null;
  private replayData: ReplayData | null = null;
  private replayFrame = 0;
  private replayDivergences = 0;
  private replayLastDivergence: string | null = null;
  private finalScore: ScoreBreakdown | null = null;
  private cameraMode: CameraMode = 'chase';
  private path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private planGeneration = 0;
  private frame = 0;
  private elapsed = 0;
  private sandboxElapsed = 0;
  private viewControlOwner: ViewControlOwner = 'none';
  private inspectionViewClaimed = false;
  private activePhase: AppPhase | null = null;
  private readonly outdoorSpawn = new THREE.Vector3();
  private readonly carryCameraFocus = new THREE.Vector3();
  private readonly prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly renderInterval = navigator.webdriver
    ? 1
    : window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 1 / 15
      : 0;
  private lastRenderElapsed = Number.NEGATIVE_INFINITY;
  private readonly dynamicGatePosition = new THREE.Vector3();
  private readonly visualGatePosition = new THREE.Vector3();
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private disposed = false;
  private worldRuntime: WorldRuntimeState = {
    status: 'commissioning',
    roomId: 'kinetic-hall',
    assetId: null,
    colliderMeshes: 0,
    colliderTriangles: 0,
    error: null,
  };
  private propRuntime: PropRuntimeState = {
    status: 'inactive',
    instances: 0,
    colliders: 0,
    movingBodies: 0,
    error: null,
  };
  private readonly liveIntent: InputIntent = {
    translation: new THREE.Vector3(),
    yaw: 0,
    jump: false,
    interact: false,
    secondaryAction: false,
    postureCycle: false,
    precision: false,
    boost: false,
    emergencyStop: false,
  };
  private manualPostureOverride: RobotMobilityPosture | null = null;
  private readonly episodeSpawn = new THREE.Vector3(-13.5, 0, 7.5);
  private readonly debugLayers: DebugLayerState = {
    colliders: false,
    navigation: false,
    semantics: false,
    triggers: false,
  };

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly physics: PhysicsWorld,
    operatorRoot: HTMLElement,
  ) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor('#050b0e');
    this.scene.background = new THREE.Color('#081116');
    this.scene.fog = new THREE.FogExp2('#081116', 0.018);
    this.configureLights();
    this.viewControls = new OrbitControls(this.camera, canvas);
    this.viewControls.enabled = false;
    this.viewControls.enableDamping = true;
    this.viewControls.dampingFactor = 0.08;
    this.viewControls.enablePan = true;
    this.viewControls.enableRotate = true;
    this.viewControls.enableZoom = true;
    this.viewControls.screenSpacePanning = true;
    this.viewControls.minDistance = 1.5;
    this.viewControls.maxDistance = 40;
    this.viewControls.minPolarAngle = 0.05;
    this.viewControls.maxPolarAngle = Math.PI - 0.05;
    this.viewControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.viewControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.viewControls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.viewControls.addEventListener('start', this.onViewControlStart);
    this.viewControls.addEventListener('end', this.onViewControlEnd);
    canvas.addEventListener('contextmenu', this.onSandboxContextMenu);
    this.physics.buildCommissioningCourse(this.state.snapshot.roomId);
    this.world = new CommissioningWorld(this.scene);
    this.world.build(this.state.snapshot.roomId, this.state.snapshot.robotId);
    this.mintWorlds = new MintWorldSession(this.scene, this.renderer, this.physics);
    this.props = new MintPropSession(this.scene);
    this.freeplayObjects = new OutdoorFreeplayObjects(this.scene, this.physics);
    this.scene.add(this.outdoorVisualGuardDebug);
    const e2eControlsEnabled = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
    this.productionWorldsEnabled = e2eControlsEnabled
      ? new URLSearchParams(window.location.search).get('world') !== 'commissioning'
      : true;
    this.robot = new RobotRuntime(getRobot(this.state.snapshot.robotId), physics, this.scene);
    this.cameraDirector.snapTo(this.robot.visual.root.position);
    this.input = new InputController(canvas, operatorRoot);
    this.ui = new OperatorInterface(operatorRoot, {
      onContinue: () => {
        this.state.transition('robot-select');
        void this.robot.loadProductionVisual();
      },
      onOpenRoster: () => this.advanceSelection(),
      onOpenSandbox: () => void this.prepareSandbox(),
      onExitSandbox: () => this.exitSandbox(),
      onResetSandbox: () => this.resetSandbox(),
      onRecenterSandboxView: () => this.recenterSandboxView(),
      onResetInspectionView: () => this.resetInspectionView(),
      onCopyDiagnostics: () => void this.copyDiagnostics(),
      onDownloadDiagnostics: () => this.downloadDiagnostics(),
      onBack: () => this.goBack(),
      onRobotSelected: (robotId) => this.selectRobot(robotId),
      onRoomSelected: (roomId) => this.selectRoom(roomId),
      onControlMode: (mode) => this.state.updateSelection({ controlMode: mode }),
      onLaunch: () => void this.prepareEpisode(),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onAbort: () => this.abort(),
      onRetry: () => void this.prepareEpisode(),
      onReplay: () => this.startReplay(),
      onCameraMode: (mode) => this.setCameraMode(mode),
      onCameraCycle: () => this.cycleCamera(),
      onDebugLayer: (layer, enabled) => this.setDebugLayer(layer, enabled),
      onClearEstop: () => this.robot.clearEmergencyStop(),
    });
    this.state.subscribe((state) => {
      this.syncViewControlPhase(state.phase);
      this.diagnostics.recordChanged('app-phase', 'info', 'application', 'phase-changed', state);
      this.ui.render(state, this.finalScore);
    });
    this.diagnostics.record('info', 'application', 'application-started', {
      productionWorldsEnabled: this.productionWorldsEnabled,
      robotId: this.state.snapshot.robotId,
      roomId: this.state.snapshot.roomId,
    });
    this.loop = new Loop(
      (delta, elapsed) => this.update(delta, elapsed),
      () => this.render(),
    );
    resizeRenderer(this.renderer, this.camera, 1.65);
    if (e2eControlsEnabled) {
      const hooks = {
        seed: (seed: number) => this.state.updateSelection({ seed }),
        setState: (state: 'intro' | 'robot-select' | 'sandbox' | 'active-play' | 'results') => {
          if (state === 'intro') this.state.forceForTest({ phase: 'intro' });
          else if (state === 'robot-select') {
            this.state.forceForTest({ phase: 'robot-select' });
          } else if (state === 'sandbox') {
            this.state.forceForTest({ phase: 'robot-select' });
            void this.prepareSandbox();
          } else if (state === 'active-play') {
            this.state.forceForTest({ phase: 'scenario-config' });
            void this.prepareEpisode();
          } else if (state === 'results') {
            this.state.forceForTest({ phase: 'live' });
            this.episode?.fail(this.robot.telemetry);
            this.finishEpisode();
          }
        },
        setPausedForScreenshot: (paused: boolean) => {
          this.pausedForScreenshot = paused;
          if (paused) {
            if (
              (this.state.snapshot.phase === 'robot-select' &&
                this.viewControlOwner === 'inspection') ||
              (this.state.snapshot.phase === 'sandbox' && this.viewControlOwner === 'sandbox')
            ) {
              this.viewControls.update(0);
            } else {
              this.cameraDirector.update(
                0,
                this.state.snapshot.phase,
                this.cameraMode,
                this.robot.telemetry,
                this.robot.visual.root,
                true,
                this.currentCarryCameraFocus(),
              );
            }
            this.render(true);
          }
        },
        setReducedMotion: (enabled: boolean) => {
          this.reducedMotion = enabled;
          this.syncInspectionAutoRotate();
        },
        setRenderScaleForTest: (scale: number) => {
          const pixelRatio = THREE.MathUtils.clamp(scale, 0.35, 1.65);
          this.renderer.setPixelRatio(pixelRatio);
          this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
          this.render(true);
        },
        setRobot: (robotId: RobotId) => this.selectRobot(robotId),
        setRoom: (roomId: RoomId) => this.selectRoom(roomId),
        setControlMode: (controlMode: 'manual' | 'assisted' | 'autonomous') =>
          this.state.updateSelection({ controlMode }),
        setRobotPoseForTest: (surfacePosition: [number, number, number], yaw: number) => {
          this.robot.setPoseForTest(new THREE.Vector3(...surfacePosition), yaw);
          this.cameraDirector.snapTo(this.robot.visual.root.position, yaw);
          this.publishDiagnostics();
        },
        teleportRobotForTest: (surfacePosition: [number, number, number], yaw: number) => {
          this.robot.teleportForTest(new THREE.Vector3(...surfacePosition), yaw);
          this.cameraDirector.snapTo(this.robot.visual.root.position, yaw);
          this.publishDiagnostics();
        },
        advanceRobotForTest: (translation: [number, number, number], ticks: number) => {
          if (!Number.isInteger(ticks) || ticks < 1 || ticks > 600) {
            throw new Error('Test physics advance must contain 1–600 fixed ticks');
          }
          const intent: InputIntent = {
            translation: new THREE.Vector3(...translation),
            yaw: 0,
            interact: false,
            secondaryAction: false,
            postureCycle: false,
            precision: false,
            boost: false,
            emergencyStop: false,
          };
          for (let tick = 0; tick < ticks; tick += 1) {
            this.robot.fixedUpdate(this.clock.fixedDt, intent, 'manual', null);
            this.physics.step(this.clock.fixedDt);
            this.robot.syncAfterPhysicsStep(this.clock.fixedDt);
            this.syncDynamicWorld();
          }
          this.publishDiagnostics();
        },
        advanceLiveForTest: (ticks: number) => {
          if (!Number.isInteger(ticks) || ticks < 1 || ticks > 600) {
            throw new Error('Test live advance must contain 1–600 fixed ticks');
          }
          const objectiveIndex = this.episode?.getEpisodeState().objectiveIndex ?? null;
          for (let tick = 0; tick < ticks; tick += 1) {
            if (this.state.snapshot.phase !== 'live') break;
            this.stepLive(this.clock.fixedDt);
            if (this.episode?.getEpisodeState().objectiveIndex !== objectiveIndex) break;
          }
          this.publishDiagnostics();
        },
        advanceSandboxForTest: (translation: [number, number, number], ticks: number) => {
          if (!Number.isInteger(ticks) || ticks < 1 || ticks > 600) {
            throw new Error('Test sandbox advance must contain 1–600 fixed ticks');
          }
          this.liveIntent.translation.set(...translation);
          for (let tick = 0; tick < ticks; tick += 1) this.stepSandbox(this.clock.fixedDt);
          this.liveIntent.translation.set(0, 0, 0);
          this.publishDiagnostics();
        },
        flushSandboxInputForTest: (ticks: number) => {
          if (
            this.state.snapshot.phase !== 'sandbox' ||
            !Number.isInteger(ticks) ||
            ticks < 1 ||
            ticks > 600
          ) {
            throw new Error('Input flush requires sandbox state and 1–600 fixed ticks');
          }
          for (let tick = 0; tick < ticks; tick += 1) {
            const pendingJump = this.liveIntent.jump;
            const pendingInteract = this.liveIntent.interact;
            const pendingSecondaryAction = this.liveIntent.secondaryAction;
            const pendingPostureCycle = this.liveIntent.postureCycle;
            const pendingEmergencyStop = this.liveIntent.emergencyStop;
            this.input.readIntent(this.liveIntent);
            this.liveIntent.jump = this.liveIntent.jump === true || pendingJump === true;
            this.liveIntent.interact ||= pendingInteract;
            this.liveIntent.secondaryAction ||= pendingSecondaryAction;
            this.liveIntent.postureCycle ||= pendingPostureCycle;
            this.liveIntent.emergencyStop ||= pendingEmergencyStop;
            this.sandboxViewDrive.applyCameraRelativeIntent(
              this.liveIntent,
              this.camera,
              this.robot.telemetry.yaw,
            );
            this.stepSandbox(this.clock.fixedDt);
          }
          this.liveIntent.jump = false;
          this.liveIntent.interact = false;
          this.liveIntent.secondaryAction = false;
          this.liveIntent.postureCycle = false;
          this.liveIntent.emergencyStop = false;
          this.publishDiagnostics();
        },
        resetSandbox: () => this.resetSandbox(),
        diagnosticReport: () => this.createDiagnosticReport(),
        advanceReplayForTest: (ticks: number) => {
          if (!Number.isInteger(ticks) || ticks < 1 || ticks > 600) {
            throw new Error('Test replay advance must contain 1–600 fixed ticks');
          }
          for (let tick = 0; tick < ticks; tick += 1) {
            if (this.state.snapshot.phase !== 'replay') break;
            this.stepReplay(this.clock.fixedDt);
          }
          this.publishDiagnostics();
        },
        triggerTaskAction: (verb?: RobotTaskVerb) => {
          const accepted = this.robot.triggerTaskAction(verb);
          this.publishDiagnostics();
          return accepted;
        },
        startReplay: () => this.startReplay(),
        hideDebugUi: () => {
          for (const layer of Object.keys(this.debugLayers)) this.setDebugLayer(layer, false);
        },
        setDebugLayer: (layer: keyof DebugLayerState, enabled: boolean) =>
          this.setDebugLayer(layer, enabled),
        setCalibrationView: (view: 0 | 1 | 2 | 3) => this.setCalibrationView(view),
        setCameraForTest: (
          position: [number, number, number],
          target: [number, number, number],
        ) => {
          this.camera.position.set(...position);
          if (this.viewControls.enabled) {
            this.viewControls.target.set(...target);
            this.viewControls.update(0);
          } else {
            this.camera.lookAt(new THREE.Vector3(...target));
          }
          this.render(true);
        },
        inspectionViewState: () => ({
          owner: this.viewControlOwner,
          claimed: this.inspectionViewClaimed,
          enabled: this.viewControls.enabled,
          autoRotate: this.viewControls.autoRotate,
          position: this.camera.position.toArray(),
          target: this.viewControls.target.toArray(),
        }),
        setCameraModeForTest: (mode: CameraMode) => {
          this.setCameraMode(mode, true);
        },
        stageFreeplayObjectForTest: (objectId: CarryableObjectId) => {
          const staged = this.freeplayObjects.stageObjectForTest(
            objectId,
            this.robot.telemetry.position,
            this.robot.telemetry.yaw,
          );
          this.publishDiagnostics();
          return staged;
        },
        captureCalibrationFrame: () => {
          this.render(true);
          return this.canvas.toDataURL('image/png');
        },
        sampleVisualSurfaceForTest: (position: [number, number, number]) =>
          this.mintWorlds
            .sampleVisualSurface(
              new THREE.Vector3(position[0], position[1] + 12, position[2]),
              new THREE.Vector3(0, -1, 0),
              24,
            )
            .slice(0, 32),
      };
      window.__FORGE5_TEST_HOOKS__ = hooks;
      window.__THREE_APP_TEST_HOOKS__ = hooks;
    }
    this.publishDiagnostics();
  }

  static async create(canvas: HTMLCanvasElement, operatorRoot: HTMLElement): Promise<ForgeApp> {
    const { PhysicsWorld } = await import('../physics/PhysicsWorld');
    const physics = await PhysicsWorld.create();
    return new ForgeApp(canvas, physics, operatorRoot);
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.canvas.removeEventListener('contextmenu', this.onSandboxContextMenu);
    this.viewControls.removeEventListener('start', this.onViewControlStart);
    this.viewControls.removeEventListener('end', this.onViewControlEnd);
    this.viewControls.dispose();
    this.input.dispose();
    this.robot.dispose(this.scene);
    this.freeplayObjects.dispose();
    this.props.dispose();
    this.mintWorlds.dispose();
    this.world.dispose(this.scene);
    this.planner.dispose();
    this.audio.dispose();
    this.calibrationDebug.dispose();
    this.outdoorVisualGuardDebug.removeFromParent();
    this.outdoorVisualGuardDebug.geometry.dispose();
    (this.outdoorVisualGuardDebug.material as THREE.Material).dispose();
    this.physics.dispose();
    this.ui.dispose();
    this.renderer.dispose();
    window.__FORGE5_DIAGNOSTICS__ = undefined;
    window.__THREE_APP_DIAGNOSTICS__ = undefined;
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
      window.__FORGE5_TEST_HOOKS__ = undefined;
      window.__THREE_APP_TEST_HOOKS__ = undefined;
    }
  }

  private configureLights(): void {
    const hemisphere = new THREE.HemisphereLight('#bedee8', '#11171a', 1.25);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight('#e8f5f6', 3.2);
    key.position.set(-8, 13, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 55;
    key.shadow.camera.left = -22;
    key.shadow.camera.right = 22;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -18;
    key.shadow.bias = -0.00012;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight('#3e9fc4', 1.25);
    fill.position.set(9, 8, -11);
    this.scene.add(fill);

    const warm = new THREE.PointLight('#ffad55', 22, 14, 2);
    warm.position.set(-11, 3.2, -5);
    this.scene.add(warm);
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    this.elapsed = elapsed;
    resizeRenderer(this.renderer, this.camera, 1.65);
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    this.handleGlobalKeys();
    const phase = this.state.snapshot.phase;
    if (phase === 'live' || phase === 'sandbox') {
      const pendingJump = this.liveIntent.jump;
      const pendingInteract = this.liveIntent.interact;
      const pendingSecondaryAction = this.liveIntent.secondaryAction;
      const pendingPostureCycle = this.liveIntent.postureCycle;
      const pendingEmergencyStop = this.liveIntent.emergencyStop;
      this.input.readIntent(this.liveIntent);
      if (phase === 'sandbox') {
        this.sandboxViewDrive.applyCameraRelativeIntent(
          this.liveIntent,
          this.camera,
          this.robot.telemetry.yaw,
        );
      }
      this.liveIntent.jump = this.liveIntent.jump === true || pendingJump === true;
      this.liveIntent.interact ||= pendingInteract;
      this.liveIntent.secondaryAction ||= pendingSecondaryAction;
      this.liveIntent.postureCycle ||= pendingPostureCycle;
      this.liveIntent.emergencyStop ||= pendingEmergencyStop;
      let consumedEdgeActions = false;
      this.clock.advance(delta, (fixedDt) => {
        if (phase === 'live') this.stepLive(fixedDt);
        else this.stepSandbox(fixedDt);
        if (!consumedEdgeActions) {
          this.liveIntent.interact = false;
          this.liveIntent.jump = false;
          this.liveIntent.secondaryAction = false;
          this.liveIntent.postureCycle = false;
          this.liveIntent.emergencyStop = false;
          consumedEdgeActions = true;
        }
      });
    } else if (phase === 'replay') {
      this.clock.advance(delta, (fixedDt) => this.stepReplay(fixedDt));
    }

    const animationDelta = this.reducedMotion ? 0 : delta;
    this.world.update(animationDelta);
    if (phase === 'robot-select' && this.viewControlOwner === 'inspection') {
      this.syncInspectionAutoRotate();
      this.viewControls.update(animationDelta);
    } else if (
      phase === 'sandbox' &&
      this.cameraMode === 'orbit' &&
      this.viewControlOwner === 'sandbox'
    ) {
      this.sandboxViewDrive.followSubject(
        this.robot.visual.root.position,
        this.camera,
        this.viewControls.target,
      );
      this.viewControls.update(animationDelta);
    } else {
      this.cameraDirector.update(
        animationDelta,
        phase,
        this.cameraMode,
        this.robot.telemetry,
        this.robot.visual.root,
        false,
        phase === 'sandbox' ? this.currentCarryCameraFocus() : null,
      );
    }
    this.audio.updateEngine(
      this.robot.telemetry.speed / Math.max(0.1, this.robot.definition.maxSpeed),
      this.robot.telemetry.emergencyStopped,
    );
    this.publishDiagnostics();
  }

  private render(force = false): void {
    if (this.pausedForScreenshot && !force) return;
    if (!force && this.elapsed - this.lastRenderElapsed < this.renderInterval) return;
    this.lastRenderElapsed = this.elapsed;
    this.renderer.render(this.scene, this.camera);
  }

  private stepLive(fixedDt: number): void {
    if (this.state.snapshot.phase !== 'live' || !this.episode) return;
    this.liveIntent.jump = false;
    const wasEmergencyStopped = this.robot.telemetry.emergencyStopped;
    const before = this.episode.getEpisodeState();
    const beforeObservation = this.episode.getObservation(
      this.robot.telemetry.position,
      this.robot.telemetry.battery,
      this.robot.telemetry.collisions,
    );
    this.configureScenarioMobilityPosture(beforeObservation.requiredTaskVerb);
    if (
      this.liveIntent.postureCycle &&
      this.state.snapshot.controlMode === 'manual' &&
      this.robot.definition.id === 'axiom-h1'
    ) {
      this.manualPostureOverride = this.robot.cycleMobilityPosture();
    }
    const target = this.state.snapshot.controlMode === 'manual' ? null : this.getNavigationTarget();
    const navigationYawTarget =
      this.state.snapshot.controlMode !== 'manual' &&
      this.state.snapshot.robotId === 'axiom-h1' &&
      this.state.snapshot.roomId === 'kinetic-hall'
        ? beforeObservation.requiredTaskVerb === 'dock'
          ? KINETIC_HALL_TASK_FIXTURES['dock-south'].desiredYawRadians
          : beforeObservation.requiredTaskVerb === 'press'
            ? KINETIC_HALL_TASK_FIXTURES['control-panel-east'].desiredYawRadians
            : null
        : null;
    if (this.state.snapshot.controlMode === 'autonomous') {
      const completedCurrentTask =
        this.robot.taskAction.status === 'completed' &&
        this.robot.taskAction.verb === beforeObservation.requiredTaskVerb;
      this.liveIntent.interact =
        beforeObservation.requiresInteraction &&
        beforeObservation.currentGoal !== null &&
        this.robot.telemetry.position.distanceTo(beforeObservation.currentGoal) <= 1.2 &&
        !completedCurrentTask;
    }
    if (this.liveIntent.interact) {
      const scenario = getScenario(this.state.snapshot.robotId, this.state.snapshot.roomId);
      this.robot.triggerTaskAction(
        resolveScenarioTaskVerb(
          scenario.robotId,
          scenario.objectives[beforeObservation.objectiveIndex - 1],
        ),
      );
    }
    this.robot.fixedUpdate(
      fixedDt,
      this.liveIntent,
      this.state.snapshot.controlMode,
      target,
      navigationYawTarget,
    );
    this.physics.step(fixedDt);
    this.robot.syncAfterPhysicsStep(fixedDt);
    if (!wasEmergencyStopped && this.robot.telemetry.emergencyStopped) {
      this.audio.cue('estop');
    }
    this.syncDynamicWorld();
    this.episode.submitAction(this.liveIntent);
    const taskFixtures = this.getTaskFixtureObservations();
    const observation = this.episode.stepSimulation(
      fixedDt,
      this.robot.telemetry,
      this.robot.taskAction,
      {
        fixtures: {
          'control-panel-east':
            taskFixtures.find((fixture) => fixture.id === 'control-panel-east') ?? null,
          'dock-south': taskFixtures.find((fixture) => fixture.id === 'dock-south') ?? null,
        },
      },
    );
    this.recorder?.record(
      observation.tick,
      this.liveIntent,
      this.robot.telemetry,
      this.robot.mobilityPosture,
      this.robot.taskAction,
      this.physics.getTaskObjectObservation('instrument-case'),
      taskFixtures,
    );

    if (observation.objectiveIndex !== before.objectiveIndex) {
      if (observation.status === 'running') this.robot.acknowledgeTaskCompletion();
      this.world.setObjectiveIndex(observation.objectiveIndex);
      this.audio.cue('objective');
      void this.replan();
    }

    const estimatedScore = Math.max(
      0,
      Math.min(
        99,
        (observation.objectiveIndex / Math.max(1, observation.objectiveCount + 1)) * 84 +
          15 -
          observation.collisionCount * 3,
      ),
    );
    this.updateLiveUi(observation, estimatedScore);

    if (observation.status === 'success' || observation.status === 'timeout') {
      this.finishEpisode();
    }
  }

  private stepSandbox(fixedDt: number): void {
    if (this.state.snapshot.phase !== 'sandbox') return;
    if (
      this.liveIntent.postureCycle &&
      this.state.snapshot.robotId === 'axiom-h1' &&
      !this.robot.telemetry.emergencyStopped
    ) {
      this.robot.cycleMobilityPosture();
    }
    const wasEmergencyStopped = this.robot.telemetry.emergencyStopped;
    if (this.liveIntent.interact && !this.robot.telemetry.emergencyStopped) {
      const freeplayBefore = this.freeplayObjects.snapshot;
      const wasHolding = freeplayBefore.heldId !== null;
      const target = freeplayBefore.targetId
        ? freeplayBefore.objects.find((object) => object.id === freeplayBefore.targetId)
        : null;
      const interacted = this.freeplayObjects.interact(
        this.camera,
        this.robot.telemetry.position,
        this.robot.telemetry.yaw,
        this.state.snapshot.robotId,
      );
      if (interacted) {
        this.robot.setTaskInteractionTarget(target?.position ?? null);
        if (this.robot.taskAction.active) this.robot.triggerSecondaryAction();
        if (!this.robot.triggerTaskAction(wasHolding ? 'release' : 'grasp')) {
          this.freeplayObjects.cancelPendingPickup();
        }
      }
      this.liveIntent.interact = false;
    }
    if (this.liveIntent.secondaryAction && !this.robot.telemetry.emergencyStopped) {
      if (this.freeplayObjects.throwHeld(this.camera, this.robot.telemetry.position)) {
        if (this.robot.taskAction.active) this.robot.triggerSecondaryAction();
        this.robot.triggerTaskAction('release');
      }
      this.liveIntent.secondaryAction = false;
    }
    const interactionSnapshot = this.freeplayObjects.snapshot;
    const interactionId = interactionSnapshot.heldId ?? interactionSnapshot.targetId;
    const interactionObject = interactionId
      ? interactionSnapshot.objects.find((object) => object.id === interactionId)
      : null;
    this.robot.setTaskInteractionTarget(interactionObject?.position ?? null);
    this.freeplayObjects.beforePhysics(
      this.state.snapshot.robotId,
      this.robot.visual.carrySocket,
      this.robot.taskAction,
    );
    this.robot.setCarryVisualState(this.freeplayObjects.carryVisualState);
    this.robot.fixedUpdate(fixedDt, this.liveIntent, 'manual', null);
    this.physics.step(fixedDt);
    this.robot.syncAfterPhysicsStep(fixedDt);
    this.freeplayObjects.afterPhysics(
      this.camera,
      this.robot.telemetry.position,
      this.robot.telemetry.yaw,
    );
    this.sandboxElapsed += fixedDt;
    if (!wasEmergencyStopped && this.robot.telemetry.emergencyStopped) this.audio.cue('estop');
    this.updateSandboxUi();
  }

  private readonly onSandboxContextMenu = (event: MouseEvent): void => {
    if (this.state.snapshot.phase === 'sandbox' || this.state.snapshot.phase === 'robot-select') {
      event.preventDefault();
    }
  };

  private readonly onViewControlStart = (): void => {
    this.canvas.dataset.viewActive = 'true';
    if (this.viewControlOwner !== 'inspection' || this.inspectionViewClaimed) return;
    this.inspectionViewClaimed = true;
    this.viewControls.autoRotate = false;
  };

  private readonly onViewControlEnd = (): void => {
    delete this.canvas.dataset.viewActive;
  };

  private syncViewControlPhase(phase: AppPhase): void {
    if (phase === this.activePhase) return;
    const previousPhase = this.activePhase;
    this.activePhase = phase;
    if (phase === 'robot-select') this.enableInspectionView();
    else if (previousPhase === 'robot-select') this.disableInspectionView();
  }

  private enableInspectionView(): void {
    this.sandboxViewDrive.stopFollowing();
    this.viewControlOwner = 'inspection';
    this.inspectionViewClaimed = false;
    this.viewControls.enabled = true;
    this.viewControls.enableDamping = true;
    this.viewControls.dampingFactor = 0.08;
    this.viewControls.enablePan = false;
    this.viewControls.enableRotate = true;
    this.viewControls.enableZoom = true;
    this.viewControls.minDistance = 1.8;
    this.viewControls.maxDistance = 7.5;
    this.viewControls.minPolarAngle = 0.2;
    this.viewControls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.viewControls.autoRotateSpeed = 1.15;
    this.viewControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.viewControls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.viewControls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.viewControls.touches.ONE = THREE.TOUCH.ROTATE;
    this.viewControls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    this.canvas.dataset.viewControl = 'inspection';
    this.canvas.setAttribute('aria-describedby', 'inspection-view-help');
    this.reframeInspectionView();
  }

  private disableInspectionView(): void {
    if (this.viewControlOwner !== 'inspection') return;
    this.viewControls.autoRotate = false;
    this.viewControls.enabled = false;
    this.viewControlOwner = 'none';
    delete this.canvas.dataset.viewControl;
    delete this.canvas.dataset.viewActive;
    this.canvas.removeAttribute('aria-describedby');
  }

  private resetInspectionView(): void {
    if (this.state.snapshot.phase !== 'robot-select') return;
    this.inspectionViewClaimed = true;
    this.reframeInspectionView();
    this.canvas.focus({ preventScroll: true });
    this.render(true);
  }

  private reframeInspectionView(): void {
    const subject = this.robot.visual.root.position;
    this.camera.position.set(subject.x, subject.y + 1.9, subject.z + 3.4);
    this.viewControls.target.set(subject.x, subject.y + 0.9, subject.z);
    this.syncInspectionAutoRotate();
    this.viewControls.update(0);
    this.camera.updateMatrixWorld(true);
  }

  private syncInspectionAutoRotate(): void {
    if (this.viewControlOwner !== 'inspection') return;
    this.viewControls.autoRotate =
      !this.inspectionViewClaimed && !this.reducedMotion && !this.prefersReducedMotion.matches;
  }

  private enableSandboxFreeView(): void {
    this.viewControlOwner = 'sandbox';
    this.viewControls.autoRotate = false;
    this.viewControls.enableDamping = true;
    this.viewControls.dampingFactor = 0.08;
    this.viewControls.enablePan = true;
    this.viewControls.enableRotate = true;
    this.viewControls.enableZoom = true;
    this.viewControls.minDistance = 1.5;
    this.viewControls.minPolarAngle = 0.05;
    this.viewControls.maxPolarAngle = Math.PI - 0.05;
    this.viewControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.viewControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.viewControls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.viewControls.touches.ONE = THREE.TOUCH.ROTATE;
    this.viewControls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.viewControls.target
      .copy(this.robot.visual.root.position)
      .add(new THREE.Vector3(0, 0.8, 0));
    this.sandboxViewDrive.beginFollowing(this.robot.visual.root.position);
    this.viewControls.enabled = true;
    this.canvas.dataset.viewControl = 'sandbox';
    this.canvas.removeAttribute('aria-describedby');
    this.viewControls.update(0);
  }

  private disableSandboxFreeView(): void {
    this.sandboxViewDrive.stopFollowing();
    if (this.viewControlOwner !== 'sandbox') return;
    this.viewControls.enabled = false;
    this.viewControlOwner = 'none';
    delete this.canvas.dataset.viewControl;
    delete this.canvas.dataset.viewActive;
  }

  private recenterSandboxView(): void {
    if (this.state.snapshot.phase !== 'sandbox') return;
    if (this.cameraMode !== 'orbit') {
      this.cameraDirector.update(
        0,
        'sandbox',
        this.cameraMode,
        this.robot.telemetry,
        this.robot.visual.root,
        true,
        this.currentCarryCameraFocus(),
      );
      this.render(true);
      return;
    }
    this.sandboxViewDrive.recenter(
      this.robot.visual.root.position,
      this.robot.telemetry.yaw,
      this.camera,
      this.viewControls.target,
    );
    this.viewControls.update(0);
  }

  private stepReplay(fixedDt: number): void {
    if (
      this.state.snapshot.phase !== 'replay' ||
      !this.replayData ||
      this.replayFrame >= this.replayData.frames.length
    ) {
      return;
    }
    const frame = this.replayData.frames[this.replayFrame];
    this.robot.setMobilityPosture(frame.mobilityPosture);
    this.liveIntent.translation.set(...frame.action.translation);
    this.liveIntent.yaw = frame.action.yaw;
    this.liveIntent.interact = frame.action.interact;
    this.liveIntent.secondaryAction = frame.action.secondaryAction ?? false;
    this.liveIntent.postureCycle = frame.action.postureCycle ?? false;
    this.liveIntent.precision = frame.action.precision ?? false;
    this.liveIntent.boost = frame.action.boost;
    this.liveIntent.emergencyStop = frame.action.emergencyStop;
    if (
      frame.task.status === 'idle' &&
      frame.task.sequence === this.robot.taskAction.sequence &&
      this.robot.taskAction.status === 'completed'
    ) {
      this.robot.acknowledgeTaskCompletion();
    }
    if (frame.task.sequence > this.robot.taskAction.sequence && frame.task.status !== 'idle') {
      this.robot.triggerTaskAction(frame.task.verb);
    }
    this.robot.fixedUpdate(fixedDt, this.liveIntent, 'manual', null);
    this.physics.step(fixedDt);
    this.robot.syncAfterPhysicsStep(fixedDt);
    this.syncDynamicWorld();
    if (frame.keyframe) {
      const taskObject = this.physics.getTaskObjectObservation('instrument-case');
      const taskFixtures = this.getTaskFixtureObservations();
      const actualHash = computeReplayStateHash(
        this.robot.telemetry,
        this.robot.taskAction,
        taskObject,
        taskFixtures,
        frame.mobilityPosture,
      );
      const positionError = this.robot.telemetry.position.distanceTo(
        new THREE.Vector3(...frame.keyframe.position),
      );
      const yawError = Math.abs(
        Math.atan2(
          Math.sin(this.robot.telemetry.yaw - frame.keyframe.yaw),
          Math.cos(this.robot.telemetry.yaw - frame.keyframe.yaw),
        ),
      );
      const taskMatches =
        this.robot.taskAction.verb === frame.task.verb &&
        this.robot.taskAction.status === frame.task.status &&
        this.robot.taskAction.sequence === frame.task.sequence &&
        this.robot.taskAction.completedSequence === frame.task.completedSequence;
      const taskObjectMatches =
        frame.taskObject === null
          ? taskObject === null
          : taskObject !== null &&
            taskObject.instanceId === frame.taskObject.instanceId &&
            taskObject.state === frame.taskObject.state &&
            taskObject.ownerRobotId === frame.taskObject.ownerRobotId &&
            taskObject.sequence === frame.taskObject.sequence &&
            new THREE.Vector3(
              taskObject.position.x,
              taskObject.position.y,
              taskObject.position.z,
            ).distanceTo(new THREE.Vector3(...frame.taskObject.position)) <= 0.02;
      const fixturesMatch =
        frame.taskFixtures.length === taskFixtures.length &&
        frame.taskFixtures.every((expected) => {
          const observed = taskFixtures.find((fixture) => fixture.id === expected.id);
          return (
            observed?.state === expected.state &&
            observed.sequence === expected.sequence &&
            observed.ownerRobotId === expected.ownerRobotId
          );
        });
      const boundedPhysicalMatch =
        positionError <= 0.02 &&
        yawError <= 0.001 &&
        Math.abs(this.robot.telemetry.battery - frame.keyframe.battery) <= 0.001 &&
        // Rapier can reorder adjacent contact begin/end events after an
        // in-place World reset even when the bounded pose, task, and fixture
        // state reproduce. Keep that derived counter bounded while retaining
        // strict checks for every authoritative task and object transition.
        Math.abs(this.robot.telemetry.collisions - frame.keyframe.collisions) <= 3 &&
        taskMatches &&
        taskObjectMatches &&
        fixturesMatch;
      if (actualHash !== frame.keyframe.stateHash && !boundedPhysicalMatch) {
        this.replayDivergences += 1;
        this.replayLastDivergence = JSON.stringify({
          tick: frame.tick,
          expectedHash: frame.keyframe.stateHash,
          observedHash: actualHash,
          expected: {
            position: frame.keyframe.position,
            yaw: frame.keyframe.yaw,
            battery: frame.keyframe.battery,
            collisions: frame.keyframe.collisions,
            task: frame.task,
            taskObject: frame.taskObject,
            taskFixtures: frame.taskFixtures,
          },
          observed: {
            position: [
              this.robot.telemetry.position.x,
              this.robot.telemetry.position.y,
              this.robot.telemetry.position.z,
            ],
            yaw: this.robot.telemetry.yaw,
            battery: this.robot.telemetry.battery,
            collisions: this.robot.telemetry.collisions,
            task: this.robot.taskAction,
            taskObject: this.physics.getTaskObjectObservation('instrument-case'),
            taskFixtures: this.getTaskFixtureObservations(),
          },
        });
      }
      const target = new THREE.Vector3(...frame.keyframe.position);
      if (this.robot.telemetry.position.distanceTo(target) > 0.3) {
        this.physics.placeRobotSafely(target);
      }
    }
    this.replayFrame += 1;
    if (this.replayFrame >= this.replayData.frames.length) {
      this.state.transition('results');
      this.input.setEnabled(false);
      this.audio.stopEngine();
    }
  }

  private handleGlobalKeys(): void {
    const phase = this.state.snapshot.phase;
    if (this.input.consume('Escape')) {
      if (phase === 'live') this.pause();
      else if (phase === 'paused') this.resume();
      else if (phase === 'sandbox') this.exitSandbox();
    }
    if (this.input.consume('KeyC')) {
      if (phase === 'sandbox' || phase === 'live') this.cycleCamera();
    }
    if (phase === 'results' && this.input.consume('KeyR')) void this.prepareEpisode();
    else if (phase === 'sandbox' && this.input.consume('KeyR')) this.resetSandbox();
  }

  private advanceSelection(): void {
    const phase = this.state.snapshot.phase;
    if (phase === 'robot-select') this.state.transition('room-select');
    else if (phase === 'room-select') this.state.transition('scenario-config');
  }

  private goBack(): void {
    const phase = this.state.snapshot.phase;
    if (phase === 'robot-select') this.state.transition('intro');
    else if (phase === 'room-select') this.state.transition('robot-select');
    else if (phase === 'scenario-config') this.state.transition('room-select');
    else if (phase === 'replay') this.state.transition('results');
  }

  private selectRobot(robotId: RobotId): void {
    if (this.state.snapshot.phase === 'sandbox') this.freeplayObjects.releaseForRobotSwitch();
    this.state.updateSelection({ robotId });
    this.swapRobot(robotId);
    if (this.state.snapshot.phase === 'sandbox') {
      this.robot.reset(this.outdoorSpawn);
      this.cameraDirector.snapTo(this.robot.visual.root.position);
      if (this.cameraMode === 'orbit') this.enableSandboxFreeView();
      else this.setCameraMode(this.cameraMode, true);
      this.diagnostics.record('info', 'sandbox', 'sandbox-robot-switched', { robotId });
      this.updateSandboxUi();
    } else {
      this.world.build(this.state.snapshot.roomId, robotId);
      if (this.state.snapshot.phase === 'robot-select') this.reframeInspectionView();
    }
  }

  private selectRoom(roomId: RoomId): void {
    this.state.updateSelection({ roomId });
    this.world.build(roomId, this.state.snapshot.robotId);
  }

  private swapRobot(robotId: RobotId): void {
    this.robot.dispose(this.scene);
    this.robot = new RobotRuntime(getRobot(robotId), this.physics, this.scene);
    this.manualPostureOverride = null;
    void this.robot.loadProductionVisual();
    this.audio.setRobot(robotId);
    this.cameraDirector.snapTo(this.robot.visual.root.position);
    this.diagnostics.record('info', 'robot', 'robot-runtime-swapped', {
      robotId,
      visualStatus: this.robot.visualStatus,
    });
  }

  private async prepareSandbox(): Promise<void> {
    if (this.state.snapshot.phase !== 'robot-select') return;
    this.state.transition('sandbox-loading');
    this.input.setEnabled(false);
    this.audio.stopEngine();
    this.ui.setLaunchError(null);
    this.diagnostics.record('info', 'sandbox', 'sandbox-load-started', {
      robotId: this.state.snapshot.robotId,
    });
    try {
      this.ui.showLoadingProgress(0.18, 'Clearing qualification runtime…');
      await this.nextPaint();
      this.episode = null;
      this.recorder = null;
      this.replayData = null;
      this.path = [];
      this.props.unload();
      this.freeplayObjects.unload();
      this.mintWorlds.unload();
      this.calibrationDebug.clear();
      this.physics.clearProps();

      this.ui.showLoadingProgress(0.35, 'Streaming outdoor valley and collision terrain…');
      this.world.root.visible = false;
      this.worldRuntime = {
        status: 'loading',
        roomId: 'outdoor-freeplay',
        assetId: OUTDOOR_FREEPLAY_WORLD.manifest.mintWorldAssetId,
        colliderMeshes: 0,
        colliderTriangles: 0,
        error: null,
      };
      const activeWorld = await this.mintWorlds.load(OUTDOOR_FREEPLAY_WORLD.manifest);
      const bounds = activeWorld.world.bounds.clone();
      const size = bounds.getSize(new THREE.Vector3());
      if (size.x < 80 || size.z < 80 || size.y < 8) {
        throw new Error(
          `Outdoor World is smaller than its reviewed freeplay envelope: ${size
            .toArray()
            .map((value) => value.toFixed(1))
            .join(' × ')} m`,
        );
      }
      const reviewedBounds = getOutdoorFreeplayReviewedBounds();
      if (
        bounds.min.distanceTo(reviewedBounds.min) > 0.1 ||
        bounds.max.distanceTo(reviewedBounds.max) > 0.1
      ) {
        throw new Error('Outdoor World collider bounds no longer match the reviewed Mint artifact');
      }
      assertOutdoorVisualGuardCompatible({
        bounds,
        colliderMeshes: activeWorld.physics.meshes,
        colliderTriangles: activeWorld.physics.triangles,
      });
      const visualSafeBounds = getOutdoorVisualSafeBounds();
      this.physics.setRobotMovementBounds(visualSafeBounds);
      this.cameraDirector.setWorldBounds(bounds);
      this.cameraDirector.setWorldCollider(activeWorld.world.collider);
      this.outdoorSpawn.copy(this.resolveOutdoorSpawn(bounds));
      if (!visualSafeBounds.containsPoint(this.outdoorSpawn)) {
        throw new Error('Outdoor spawn lies outside the reviewed visual-splat safe volume');
      }
      this.camera.far = 900;
      this.camera.updateProjectionMatrix();
      this.viewControls.maxDistance = 80;
      this.scene.background = new THREE.Color('#a9d8e8');
      this.scene.fog = null;
      this.worldRuntime = {
        status: 'sandbox',
        roomId: 'outdoor-freeplay',
        assetId: OUTDOOR_FREEPLAY_WORLD.manifest.mintWorldAssetId,
        colliderMeshes: activeWorld.physics.meshes,
        colliderTriangles: activeWorld.physics.triangles,
        error: null,
      };
      this.outdoorVisualGuardDebug.visible = this.debugLayers.colliders;

      this.ui.showLoadingProgress(0.68, 'Loading six interactive freeplay objects…');
      this.propRuntime = {
        status: 'loading',
        instances: 0,
        colliders: 0,
        movingBodies: 0,
        error: null,
      };
      await this.freeplayObjects.load(
        OUTDOOR_FREEPLAY_OBJECTS,
        this.outdoorSpawn,
        visualSafeBounds,
      );
      this.propRuntime = {
        status: 'ready',
        instances: OUTDOOR_FREEPLAY_OBJECTS.length,
        colliders: OUTDOOR_FREEPLAY_OBJECTS.length,
        movingBodies: OUTDOOR_FREEPLAY_OBJECTS.length,
        error: null,
      };

      this.ui.showLoadingProgress(0.86, 'Loading robot and freeplay controls…');
      if (this.robot.definition.id !== this.state.snapshot.robotId) {
        this.swapRobot(this.state.snapshot.robotId);
      }
      this.robot.reset(this.outdoorSpawn);
      await this.robot.loadProductionVisual();
      this.sandboxElapsed = 0;
      this.clock.reset();
      this.cameraMode = 'orbit';
      this.cameraDirector.snapTo(this.robot.visual.root.position, this.robot.telemetry.yaw);
      this.ui.showLoadingProgress(1, 'Outdoor freeplay World ready.');
      await this.nextPaint();
      this.state.transition('sandbox');
      this.enableSandboxFreeView();
      this.input.setEnabled(true);
      this.audio.startEngine();
      this.updateSandboxUi();
      this.diagnostics.record('info', 'sandbox', 'sandbox-ready', {
        robotId: this.state.snapshot.robotId,
        colliderBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
        visualSafeBounds: {
          min: visualSafeBounds.min.toArray(),
          max: visualSafeBounds.max.toArray(),
        },
        visualGuardId: OUTDOOR_VISUAL_GUARD.id,
        visualGuardSha256: OUTDOOR_VISUAL_GUARD_SHA256,
        spawn: this.outdoorSpawn.toArray(),
        objects: OUTDOOR_FREEPLAY_OBJECTS.length,
        visualStatus: this.robot.visualStatus,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.diagnostics.record('error', 'sandbox', 'sandbox-load-failed', { message });
      this.outdoorVisualGuardDebug.visible = false;
      this.freeplayObjects.unload();
      this.mintWorlds.unload();
      this.world.build(this.state.snapshot.roomId, this.state.snapshot.robotId);
      this.world.root.visible = true;
      this.physics.buildCommissioningCourse(this.state.snapshot.roomId);
      this.camera.far = 180;
      this.camera.updateProjectionMatrix();
      this.viewControls.maxDistance = 40;
      this.scene.background = new THREE.Color('#081116');
      this.scene.fog = new THREE.FogExp2('#081116', 0.018);
      this.worldRuntime = {
        status: 'fallback-error',
        roomId: 'outdoor-freeplay',
        assetId: null,
        colliderMeshes: 0,
        colliderTriangles: 0,
        error: message,
      };
      this.propRuntime = {
        status: 'error',
        instances: 0,
        colliders: 0,
        movingBodies: 0,
        error: message,
      };
      this.ui.setLaunchError(`Outdoor World unavailable: ${message}`);
      if (String(this.state.snapshot.phase) === 'sandbox-loading') {
        this.state.transition('robot-select');
      }
    }
  }

  private resolveOutdoorSpawn(bounds: THREE.Box3): THREE.Vector3 {
    const probeHeight = bounds.max.y + 4;
    const probeDistance = bounds.getSize(new THREE.Vector3()).y + 12;
    const candidates = [
      [0, 0],
      [-5, 0],
      [5, 0],
      [0, -5],
      [0, 5],
      [-10, -10],
      [10, -10],
      [-10, 10],
      [10, 10],
    ] as const;
    for (const [x, z] of candidates) {
      const surface = this.physics.sampleStaticSurface(
        new THREE.Vector3(x, probeHeight, z),
        new THREE.Vector3(0, -1, 0),
        probeDistance,
      );
      if (surface && surface.normal.y >= 0.72) return surface.point;
    }
    throw new Error('Outdoor World collider has no safe spawn surface near its authored origin');
  }

  private resetSandbox(): void {
    if (this.state.snapshot.phase !== 'sandbox') return;
    this.robot.reset(this.outdoorSpawn);
    this.freeplayObjects.reset();
    this.robot.acknowledgeTaskCompletion();
    this.sandboxElapsed = 0;
    this.clock.reset();
    this.cameraDirector.snapTo(this.robot.visual.root.position, this.robot.telemetry.yaw);
    if (this.cameraMode === 'orbit') this.enableSandboxFreeView();
    else this.setCameraMode(this.cameraMode, true);
    this.diagnostics.record('info', 'sandbox', 'sandbox-reset', {
      robotId: this.state.snapshot.robotId,
      spawn: this.outdoorSpawn.toArray(),
    });
    this.updateSandboxUi();
  }

  private exitSandbox(): void {
    if (this.state.snapshot.phase !== 'sandbox') return;
    this.input.setEnabled(false);
    this.disableSandboxFreeView();
    this.audio.stopEngine();
    this.outdoorVisualGuardDebug.visible = false;
    this.freeplayObjects.unload();
    this.mintWorlds.unload();
    this.world.build(this.state.snapshot.roomId, this.state.snapshot.robotId);
    this.world.root.visible = true;
    this.physics.buildCommissioningCourse(this.state.snapshot.roomId);
    this.cameraDirector.setWorldBounds(null);
    this.cameraDirector.setWorldCollider(null);
    this.scene.background = new THREE.Color('#081116');
    this.scene.fog = new THREE.FogExp2('#081116', 0.018);
    this.camera.far = 180;
    this.camera.updateProjectionMatrix();
    this.viewControls.maxDistance = 40;
    this.worldRuntime = {
      status: 'commissioning',
      roomId: this.state.snapshot.roomId,
      assetId: null,
      colliderMeshes: 0,
      colliderTriangles: 0,
      error: null,
    };
    this.state.transition('robot-select');
    this.diagnostics.record('info', 'sandbox', 'sandbox-exited', {
      robotId: this.state.snapshot.robotId,
    });
  }

  private updateSandboxUi(): void {
    const requestedVerb = defaultRobotTaskVerb(this.state.snapshot.robotId);
    const freeplay = this.freeplayObjects.snapshot;
    const target = freeplay.targetId
      ? freeplay.objects.find((object) => object.id === freeplay.targetId)
      : null;
    const primaryLabel = freeplay.heldId
      ? 'PLACE'
      : freeplay.targetId
        ? 'PICK UP'
        : 'AIM AT OBJECT';
    const emergencyStopped = this.robot.telemetry.emergencyStopped;
    const containment = this.physics.containmentDiagnostics;
    const boundaryHold = containment.robot.lastViolation !== 'none';
    const snapshot: SandboxUiSnapshot = {
      elapsedSeconds: this.sandboxElapsed,
      battery: this.robot.telemetry.battery,
      speed: this.robot.telemetry.speed,
      collisions: this.robot.telemetry.collisions,
      cameraMode: this.cameraMode,
      safety: emergencyStopped ? 'E-STOP' : boundaryHold ? 'CAUTION' : 'NOMINAL',
      fault: emergencyStopped
        ? 'MOTION INHIBITED'
        : boundaryHold
          ? 'WORLD BOUNDARY HOLD — ROBOT RECOVERED'
          : freeplay.heldLabel
            ? `CARRYING ${freeplay.heldLabel.toUpperCase()}`
            : 'OUTDOOR FREEPLAY READY',
      containmentCorrections:
        containment.robot.correctionCount +
        containment.props.correctionCount +
        freeplay.corrections,
      targetLabel: freeplay.targetLabel,
      heldLabel: freeplay.heldLabel,
      carryMode: freeplay.carry?.mode.replaceAll('-', ' ').toUpperCase() ?? null,
      objectState: freeplay.heldId
        ? 'HELD'
        : (target?.state.toUpperCase() ?? freeplay.lastAction.replaceAll('-', ' ').toUpperCase()),
      objectCount: freeplay.objects.length,
      action: {
        primaryVerb: requestedVerb,
        primaryLabel,
        primaryStatus: emergencyStopped
          ? 'BLOCKED BY E-STOP'
          : freeplay.heldId
            ? 'PLACE ON THE SURFACE AHEAD'
            : freeplay.targetId
              ? `READY — ${freeplay.targetLabel?.toUpperCase()}`
              : 'CENTER AN OBJECT IN THE RETICLE',
        primaryAvailable:
          !emergencyStopped && (freeplay.heldId !== null || freeplay.targetId !== null),
        secondaryLabel: freeplay.heldId ? 'THROW' : 'NOT HOLDING',
        secondaryAvailable: !emergencyStopped && Boolean(freeplay.heldId),
        posture: this.robot.mobilityPosture.toUpperCase(),
        postureAvailable: !emergencyStopped && this.state.snapshot.robotId === 'axiom-h1',
        precisionActive: this.liveIntent.precision,
      },
    };
    this.ui.updateSandbox(snapshot);
  }

  private createDiagnosticReport(): ReturnType<DiagnosticRecorder['report']> {
    return this.diagnostics.report(
      window.__FORGE5_DIAGNOSTICS__ ?? {
        phase: this.state.snapshot.phase,
        message: 'No runtime snapshot has been published yet',
      },
    );
  }

  private async copyDiagnostics(): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.createDiagnosticReport(), null, 2));
      this.diagnostics.record('info', 'application', 'diagnostics-copied');
    } catch (error) {
      this.diagnostics.record('error', 'application', 'diagnostics-copy-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private downloadDiagnostics(): void {
    const report = this.createDiagnosticReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `forge5-diagnostics-${new Date().toISOString().replaceAll(':', '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
    this.diagnostics.record('info', 'application', 'diagnostics-downloaded', {
      events: report.events.length,
    });
  }

  private async prepareEpisode(): Promise<void> {
    const phase = this.state.snapshot.phase;
    if (phase !== 'scenario-config' && phase !== 'results') return;
    this.state.transition('loading');
    this.input.setEnabled(false);
    this.audio.stopEngine();
    this.finalScore = null;
    this.ui.setLaunchError(null);
    try {
      this.ui.showLoadingProgress(0.08, 'Initializing fixed-step physics…');
      await this.nextPaint();
      this.ui.showLoadingProgress(0.22, 'Resolving final Mint World manifest…');
      await this.nextPaint();
      this.world.build(this.state.snapshot.roomId, this.state.snapshot.robotId);
      const route = await this.prepareWorldRuntime();

      this.ui.showLoadingProgress(0.48, 'Validating robot envelope and contacts…');
      await this.nextPaint();
      if (this.robot.definition.id !== this.state.snapshot.robotId) {
        this.swapRobot(this.state.snapshot.robotId);
      }
      this.episodeSpawn.copy(route[0]);
      this.robot.reset(this.episodeSpawn);
      this.props.reset();
      this.physics.resetProps();
      this.manualPostureOverride = null;
      this.configureScenarioMobilityPosture();
      this.ui.showLoadingProgress(0.57, 'Loading validated Mint robot assembly…');
      await this.robot.visualReady;
      if (this.robot.visualStatus !== 'production') {
        await this.robot.loadProductionVisual();
      }
      if (this.robot.visualStatus !== 'production') {
        throw new Error(
          `Validated Mint robot assembly did not load: ${this.robot.visualError ?? 'unknown error'}`,
        );
      }

      this.ui.showLoadingProgress(0.67, 'Generating morphology-aware route…');
      const scenario = getScenario(this.state.snapshot.robotId, this.state.snapshot.roomId);
      this.episode = new TrainingEpisode(
        scenario,
        route,
        this.worldRuntime.status === 'production',
      );
      const initialObservation = this.episode.resetEpisode({
        seed: this.state.snapshot.seed,
        position: this.robot.telemetry.position,
      });
      this.recorder = new ReplayRecorder({
        seed: this.state.snapshot.seed,
        robotId: this.state.snapshot.robotId,
        roomId: this.state.snapshot.roomId,
        scenarioId: scenario.id,
        fixedDt: this.clock.fixedDt,
        identity: {
          runtimeContract: 'forge5-authoritative-fixture-task-v2',
          environmentMode:
            this.worldRuntime.status === 'production' ? 'production' : 'commissioning',
          worldAssetId:
            this.worldRuntime.status === 'production'
              ? getForgeMintWorld(this.state.snapshot.roomId).manifest.mintWorldAssetId
              : null,
          propAssetPackId:
            this.propRuntime.status === 'ready'
              ? FORGE_PROP_PACK_BY_ROOM[this.state.snapshot.roomId].assetPackId
              : null,
        },
      });
      this.world.setObjectiveIndex(1);
      await this.replan();

      this.ui.showLoadingProgress(0.88, 'Arming telemetry and replay recorder…');
      await this.nextPaint();
      this.clock.reset();
      this.cameraMode = 'chase';
      this.cameraDirector.snapTo(this.robot.visual.root.position, this.robot.telemetry.yaw);
      this.ui.showLoadingProgress(1, 'Qualification stack ready.');
      await this.nextPaint();
      this.state.transition('live');
      this.updateLiveUi(initialObservation, 15);
      this.input.setEnabled(true);
      this.audio.startEngine();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Production qualification gate blocked episode launch', error);
      this.episode = null;
      this.recorder = null;
      this.replayData = null;
      this.path = [];
      this.props.unload();
      this.mintWorlds.unload();
      this.physics.clearEnvironment();
      this.world.root.visible = false;
      this.ui.setLaunchError(message);
      if (this.state.snapshot.phase === 'loading') this.state.transition('scenario-config');
    }
  }

  private async prepareWorldRuntime(): Promise<readonly THREE.Vector3[]> {
    const { roomId, robotId } = this.state.snapshot;
    if (!this.productionWorldsEnabled) {
      this.mintWorlds.unload();
      this.calibrationDebug.clear();
      this.physics.buildCommissioningCourse(roomId);
      this.planner.useCommissioningBounds();
      this.cameraDirector.setWorldBounds(null);
      this.cameraDirector.setWorldCollider(null);
      this.world.root.visible = true;
      this.worldRuntime = {
        status: 'commissioning',
        roomId,
        assetId: null,
        colliderMeshes: 0,
        colliderTriangles: 0,
        error: null,
      };
      this.diagnostics.record('info', 'world-load', 'commissioning-world-ready', {
        roomId,
        robotId,
      });
      this.clearPropRuntime();
      this.ui.showLoadingProgress(0.38, 'Commissioning World override active…');
      return this.world.getRoute(robotId);
    }

    const record = getForgeMintWorld(roomId);
    this.worldRuntime = {
      status: 'loading',
      roomId,
      assetId: record.manifest.mintWorldAssetId,
      colliderMeshes: 0,
      colliderTriangles: 0,
      error: null,
    };
    this.diagnostics.record('info', 'world-load', 'mint-world-load-started', {
      roomId,
      robotId,
      assetId: record.manifest.mintWorldAssetId,
    });
    this.ui.showLoadingProgress(0.3, 'Streaming final RAD and physics collider…');
    await this.nextPaint();
    try {
      const active = await this.mintWorlds.load(record.manifest);
      this.world.root.visible = false;
      const containmentManifest = getForgeMintContainmentManifest(roomId);
      assertRuntimeBoundsMatchContainment(active.world.bounds, containmentManifest);
      const containmentBounds = getForgeMintWorldBounds(roomId);
      this.physics.setRobotMovementBounds(containmentBounds);
      this.cameraDirector.setWorldBounds(containmentBounds);
      this.cameraDirector.setWorldCollider(active.world.collider);
      this.ui.showLoadingProgress(0.4, 'Deriving morphology navigation from collider…');
      const desiredRoute = getForgeMintScenarioRoute(roomId, robotId);
      const route = (
        await this.planner.useProductionCollider(active.world.collider, robotId, desiredRoute)
      ).map((point) => point.clone());
      if (roomId === 'kinetic-hall' && robotId === 'axiom-h1') {
        route.forEach((point, index) => {
          if (index > 0) point.copy(desiredRoute[index]);
        });
      }
      this.robot.reset(route[0]);
      this.calibrationDebug.load(roomId, active.world, route);
      this.calibrationDebug.setLayerState({
        colliders: this.debugLayers.colliders,
        navigation: this.debugLayers.navigation,
        semantics: this.debugLayers.semantics,
      });
      await this.preparePropRuntime(roomId);
      this.worldRuntime = {
        status: 'production',
        roomId,
        assetId: record.manifest.mintWorldAssetId,
        colliderMeshes: active.physics.meshes,
        colliderTriangles: active.physics.triangles,
        error: null,
      };
      this.diagnostics.record('info', 'world-load', 'mint-world-ready', {
        roomId,
        robotId,
        assetId: record.manifest.mintWorldAssetId,
        physics: active.physics,
        alignment: active.world.alignment,
      });
      this.ui.showLoadingProgress(0.44, 'Mint World, Rapier, and Recast navigation online.');
      return route;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load production Mint World for ${roomId}`, error);
      this.props.unload();
      this.mintWorlds.unload();
      this.calibrationDebug.clear();
      this.physics.clearEnvironment();
      this.cameraDirector.setWorldBounds(null);
      this.cameraDirector.setWorldCollider(null);
      this.world.root.visible = false;
      this.worldRuntime = {
        status: 'fallback-error',
        roomId,
        assetId: record.manifest.mintWorldAssetId,
        colliderMeshes: 0,
        colliderTriangles: 0,
        error: message,
      };
      this.diagnostics.record('error', 'world-load', 'mint-world-load-failed', {
        roomId,
        robotId,
        assetId: record.manifest.mintWorldAssetId,
        message,
      });
      throw new Error(`Final Mint World failed to load; qualification is blocked: ${message}`, {
        cause: error,
      });
    }
  }

  private async preparePropRuntime(roomId: RoomId): Promise<void> {
    const definition = FORGE_PROP_PACK_BY_ROOM[roomId];
    const placements = scaleMintWorldPropPlacements(FORGE_PROP_PLACEMENTS_BY_ROOM[roomId]);
    this.propRuntime = {
      status: 'loading',
      instances: 0,
      colliders: 0,
      movingBodies: 0,
      error: null,
    };
    this.ui.showLoadingProgress(0.43, `Placing final ${definition.name}…`);
    await this.nextPaint();
    try {
      const active = await this.props.load(placements, definition);
      const physics = this.physics.buildPropColliders(active.instances);
      this.physics.configureTaskFixtures(roomId);
      this.propRuntime = {
        status: 'ready',
        instances: active.instances.length,
        colliders: physics.colliders,
        movingBodies: physics.movingBodies,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.physics.clearProps();
      this.props.unload();
      this.propRuntime = {
        status: 'error',
        instances: 0,
        colliders: 0,
        movingBodies: 0,
        error: message,
      };
      throw new Error(`Final ${definition.name} failed to load: ${message}`, { cause: error });
    }
  }

  private clearPropRuntime(): void {
    this.physics.clearProps();
    this.props.unload();
    this.propRuntime = {
      status: 'inactive',
      instances: 0,
      colliders: 0,
      movingBodies: 0,
      error: null,
    };
  }

  private pause(): void {
    if (this.state.snapshot.phase !== 'live') return;
    this.state.transition('paused');
    this.input.setEnabled(false);
    this.audio.stopEngine();
  }

  private resume(): void {
    if (this.state.snapshot.phase !== 'paused') return;
    this.state.transition('live');
    this.input.setEnabled(true);
    this.audio.startEngine();
  }

  private abort(): void {
    const phase = this.state.snapshot.phase;
    if (phase === 'paused') {
      this.episode?.fail(this.robot.telemetry);
      this.finalScore = this.episode?.getRewardBreakdown() ?? null;
      this.state.transition('scenario-config');
    } else if (phase === 'results') {
      this.state.transition('robot-select');
    }
    this.input.setEnabled(false);
    this.audio.stopEngine();
  }

  private finishEpisode(): void {
    if (!this.episode || this.state.snapshot.phase !== 'live') return;
    this.finalScore = this.episode.getRewardBreakdown();
    if (!this.finalScore) return;
    this.ui.setScore(this.finalScore);
    this.replayData = this.recorder?.export(this.episode.exportEpisodeLog()) ?? null;
    this.audio.cue(this.episode.getEpisodeState().status === 'success' ? 'success' : 'failure');
    this.audio.stopEngine();
    this.input.setEnabled(false);
    this.state.transition('results');
    this.persistBestScore(this.finalScore);
  }

  private startReplay(): void {
    if (this.state.snapshot.phase !== 'results' || !this.replayData) return;
    this.robot.reset(this.episodeSpawn);
    this.props.reset();
    this.physics.resetProps();
    this.manualPostureOverride = null;
    this.configureScenarioMobilityPosture();
    this.replayFrame = 0;
    this.replayDivergences = 0;
    this.replayLastDivergence = null;
    this.clock.reset();
    this.cameraMode = 'chase';
    this.state.transition('replay');
    this.audio.startEngine();
  }

  private configureScenarioMobilityPosture(requiredTaskVerb: RobotTaskVerb | null = null): void {
    const crouched =
      this.state.snapshot.robotId === 'axiom-h1' && this.state.snapshot.roomId === 'kinetic-hall';
    if (
      this.state.snapshot.robotId === 'axiom-h1' &&
      this.state.snapshot.controlMode === 'manual' &&
      this.manualPostureOverride
    ) {
      this.robot.setMobilityPosture(this.manualPostureOverride);
      return;
    }
    this.robot.setMobilityPosture(
      crouched ? (requiredTaskVerb === 'dock' ? 'crawling' : 'crouched') : 'standing',
    );
  }

  private async replan(): Promise<void> {
    if (!this.episode) return;
    const generation = ++this.planGeneration;
    const observation = this.episode.getObservation(
      this.robot.telemetry.position,
      this.robot.telemetry.battery,
      this.robot.telemetry.collisions,
    );
    if (!observation.currentGoal) {
      this.path = [];
      return;
    }
    try {
      const { robotId, roomId } = this.state.snapshot;
      if (
        this.worldRuntime.status === 'production' &&
        roomId === 'kinetic-hall' &&
        robotId === 'axiom-h1'
      ) {
        if (observation.objectiveIndex === 4) {
          const easternGantryBypass = new THREE.Vector3(
            2 * MINT_WORLD_EXPERIENCE_SCALE,
            0,
            -5.08 * MINT_WORLD_EXPERIENCE_SCALE,
          );
          const planned = await this.planner.plan(
            this.robot.telemetry.position,
            easternGantryBypass,
            robotId,
            roomId,
          );
          if (generation !== this.planGeneration) return;
          this.path = [
            ...(planned.length > 0 ? planned : [this.robot.telemetry.position.clone()]),
            easternGantryBypass.clone(),
            new THREE.Vector3(observation.currentGoal.x, 0, -5.08 * MINT_WORLD_EXPERIENCE_SCALE),
            observation.currentGoal.clone(),
          ];
          this.pathIndex = Math.min(1, this.path.length - 1);
          return;
        }
        const bypass = this.getAxiomKineticPhysicalPath(
          observation.objectiveIndex,
          observation.currentGoal,
        );
        if (generation !== this.planGeneration) return;
        this.path = [this.robot.telemetry.position.clone(), ...bypass];
        this.pathIndex = Math.min(1, this.path.length - 1);
        return;
      }
      const approach =
        this.worldRuntime.status === 'production'
          ? null
          : getScenarioNavigationApproach(roomId, robotId, observation.objectiveIndex);
      const path = approach
        ? [
            ...(await this.planner.plan(this.robot.telemetry.position, approach, robotId, roomId)),
            ...(await this.planner.plan(approach, observation.currentGoal, robotId, roomId)).slice(
              1,
            ),
          ]
        : await this.planner.plan(
            this.robot.telemetry.position,
            observation.currentGoal,
            robotId,
            roomId,
          );
      if (generation !== this.planGeneration) return;
      this.path = path.length > 0 ? path : [observation.currentGoal];
      const finalPathPoint = this.path.at(-1);
      if (
        finalPathPoint &&
        finalPathPoint.distanceTo(observation.currentGoal) > 0.02 &&
        finalPathPoint.distanceTo(observation.currentGoal) <= 0.3
      ) {
        this.path.push(observation.currentGoal.clone());
      }
      if (this.state.snapshot.robotId === 'kestrel-d5') {
        const startY = this.robot.telemetry.position.y;
        this.path.forEach((point, index) => {
          const progress = this.path.length <= 1 ? 1 : index / (this.path.length - 1);
          point.y = THREE.MathUtils.lerp(startY, observation.currentGoal!.y, progress);
        });
      }
      this.pathIndex = Math.min(1, this.path.length - 1);
    } catch (error) {
      console.error('Path planning failed', error);
      if (generation === this.planGeneration) {
        this.path = [observation.currentGoal];
        this.pathIndex = 0;
      }
    }
  }

  private getAxiomKineticPhysicalPath(
    objectiveIndex: number,
    goal: THREE.Vector3,
  ): THREE.Vector3[] {
    if (objectiveIndex === 1) {
      return [goal.clone()];
    }
    if (objectiveIndex === 2) {
      return [goal.clone()];
    }
    if (objectiveIndex === 3) {
      return [
        new THREE.Vector3(this.robot.telemetry.position.x, 0, -2.5 * MINT_WORLD_EXPERIENCE_SCALE),
        new THREE.Vector3(goal.x, 0, -2.5 * MINT_WORLD_EXPERIENCE_SCALE),
        new THREE.Vector3(goal.x, 0, goal.z),
        goal.clone(),
      ];
    }
    return [goal.clone()];
  }

  private getNavigationTarget(): THREE.Vector3 | null {
    if (!this.episode) return null;
    if (this.path.length === 0) {
      const goal = this.episode.getObservation().currentGoal;
      return goal;
    }
    let target = this.path[Math.min(this.pathIndex, this.path.length - 1)];
    const horizontalDistance = Math.hypot(
      this.robot.telemetry.position.x - target.x,
      this.robot.telemetry.position.z - target.z,
    );
    const axiomKineticProductionRoute =
      this.worldRuntime.status === 'production' &&
      this.state.snapshot.roomId === 'kinetic-hall' &&
      this.state.snapshot.robotId === 'axiom-h1';
    const waypointTolerance = axiomKineticProductionRoute
      ? this.episode.getObservation().objectiveIndex === 4
        ? 0.08
        : 0.12
      : 0.55;
    if (horizontalDistance < waypointTolerance && this.pathIndex < this.path.length - 1) {
      this.pathIndex += 1;
      target = this.path[this.pathIndex];
    }
    const result = target.clone();
    return result;
  }

  private syncDynamicWorld(): void {
    const position = this.physics.getDynamicGatePosition(this.dynamicGatePosition);
    if (position) this.world.setDynamicGatePosition(position);
  }

  private updateLiveUi(
    observation: ReturnType<TrainingEpisode['getObservation']>,
    score: number,
  ): void {
    const scenario = getScenario(this.state.snapshot.robotId, this.state.snapshot.roomId);
    const objectiveArrayIndex = Math.max(
      0,
      Math.min(scenario.objectives.length - 1, observation.objectiveIndex - 1),
    );
    const requestedVerb =
      observation.requiredTaskVerb ?? defaultRobotTaskVerb(this.state.snapshot.robotId);
    const primaryLabel = formatRobotTaskVerb(requestedVerb);
    const taskAction = this.robot.taskAction;
    const supportsPrimary = supportsRobotTaskVerb(this.state.snapshot.robotId, requestedVerb);
    const atTaskTarget =
      !observation.requiresInteraction ||
      (observation.currentGoal !== null &&
        this.robot.telemetry.position.distanceTo(observation.currentGoal) <= 1.2);
    const taskObject = this.physics.getTaskObjectObservation('instrument-case');
    const ownsTaskObject =
      taskObject?.state === 'grasped' && taskObject.ownerRobotId === this.state.snapshot.robotId;
    const emergencyStopped = this.robot.telemetry.emergencyStopped;
    const boundaryHold = this.physics.containmentDiagnostics.robot.lastViolation !== 'none';
    const snapshot: LiveUiSnapshot = {
      objective: scenario.objectives[objectiveArrayIndex],
      objectiveInstruction: getObjectiveGuidance(scenario, objectiveArrayIndex + 1).instruction,
      objectiveIndex: Math.min(observation.objectiveIndex, observation.objectiveCount),
      objectiveCount: observation.objectiveCount,
      elapsedSeconds: observation.elapsedSeconds,
      score,
      battery: observation.battery,
      speed: this.robot.telemetry.speed,
      collisions: observation.collisionCount,
      mode: this.state.snapshot.controlMode,
      cameraMode: this.cameraMode,
      safety: emergencyStopped
        ? 'E-STOP'
        : observation.collisionCount > 3 || boundaryHold
          ? 'CAUTION'
          : 'NOMINAL',
      fault: emergencyStopped
        ? 'MOTION INHIBITED'
        : boundaryHold
          ? 'WORLD BOUNDARY HOLD — COMMAND REJECTED'
          : observation.collisionCount > 3
            ? 'CONTACT LIMIT APPROACHING'
            : '',
      action: {
        primaryVerb: requestedVerb,
        primaryLabel,
        primaryStatus: emergencyStopped
          ? 'BLOCKED BY E-STOP'
          : !supportsPrimary
            ? 'ACTION NOT AVAILABLE FOR THIS PLATFORM'
            : taskAction.active
              ? `${primaryLabel} IN PROGRESS`
              : !atTaskTarget
                ? 'MOVE TO THE TASK MARKER'
                : 'READY',
        primaryAvailable:
          !emergencyStopped && !taskAction.active && supportsPrimary && atTaskTarget,
        secondaryLabel: ownsTaskObject
          ? 'RELEASE PAYLOAD'
          : taskAction.active
            ? 'CANCEL ACTION'
            : 'RELEASE / CANCEL',
        secondaryAvailable: !emergencyStopped && (ownsTaskObject || taskAction.active),
        posture: this.robot.mobilityPosture.toUpperCase(),
        postureAvailable:
          !emergencyStopped &&
          this.state.snapshot.controlMode === 'manual' &&
          this.state.snapshot.robotId === 'axiom-h1',
        precisionActive: this.liveIntent.precision,
      },
    };
    this.ui.updateLive(snapshot);
  }

  private cycleCamera(): void {
    const index = CAMERA_MODES.indexOf(this.cameraMode);
    this.setCameraMode(CAMERA_MODES[(index + 1) % CAMERA_MODES.length]);
  }

  private setCameraMode(mode: CameraMode, immediate = false): void {
    if (!CAMERA_MODES.includes(mode)) return;
    if (this.state.snapshot.phase === 'sandbox') {
      this.cameraMode = mode;
      if (mode === 'orbit') {
        this.enableSandboxFreeView();
        if (immediate) {
          this.sandboxViewDrive.recenter(
            this.robot.visual.root.position,
            this.robot.telemetry.yaw,
            this.camera,
            this.viewControls.target,
          );
          this.viewControls.update(0);
        }
      } else {
        this.disableSandboxFreeView();
        this.cameraDirector.update(
          0,
          'sandbox',
          mode,
          this.robot.telemetry,
          this.robot.visual.root,
          immediate,
          this.currentCarryCameraFocus(),
        );
      }
      this.updateSandboxUi();
      if (immediate) {
        this.render(true);
        this.publishDiagnostics();
      }
      return;
    }
    this.cameraMode = mode;
    if (immediate) {
      this.cameraDirector.update(
        0,
        this.state.snapshot.phase,
        this.cameraMode,
        this.robot.telemetry,
        this.robot.visual.root,
        true,
      );
      this.render(true);
      this.publishDiagnostics();
    }
  }

  private currentCarryCameraFocus(): THREE.Vector3 | null {
    return this.freeplayObjects.getHeldWorldPosition(this.carryCameraFocus);
  }

  private setDebugLayer(layer: string, enabled: boolean): void {
    if (!(layer in this.debugLayers)) return;
    this.debugLayers[layer as keyof DebugLayerState] = enabled;
    this.world.setLayerState({
      splat: true,
      colliders: this.debugLayers.colliders,
      navigation: this.debugLayers.navigation,
      semantics: this.debugLayers.semantics,
      triggers: this.debugLayers.triggers,
    });
    this.calibrationDebug.setLayerState({
      colliders: this.debugLayers.colliders,
      navigation: this.debugLayers.navigation,
      semantics: this.debugLayers.semantics,
    });
    this.outdoorVisualGuardDebug.visible =
      this.debugLayers.colliders && this.worldRuntime.status === 'sandbox';
  }

  private setCalibrationView(view: 0 | 1 | 2 | 3): void {
    const bounds = getForgeMintWorldBounds(this.state.snapshot.roomId);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const sideDistance = Math.max(size.x, size.z) * 0.64;
    const longitudinalDistance = size.z * 0.72;
    const overheadHeight = Math.max(10, size.z * 0.76);
    const positions: readonly THREE.Vector3[] = [
      center.clone().add(new THREE.Vector3(0, size.y * 0.35, longitudinalDistance)),
      center.clone().add(new THREE.Vector3(sideDistance, size.y * 0.28, 0)),
      center.clone().add(new THREE.Vector3(-sideDistance, size.y * 0.28, 0)),
      center.clone().add(new THREE.Vector3(0, overheadHeight, 0.01)),
    ];
    this.camera.position.copy(positions[view]);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    this.render(true);
  }

  private persistBestScore(score: ScoreBreakdown): void {
    const key = `forge5:best:${this.state.snapshot.robotId}:${this.state.snapshot.roomId}`;
    try {
      const existing = Number(localStorage.getItem(key) ?? 0);
      if (score.total > existing) localStorage.setItem(key, String(score.total));
    } catch (error) {
      console.warn('Best-score persistence is unavailable for this session', error);
    }
    if (this.replayData) {
      const serialized = JSON.stringify(this.replayData);
      if (serialized.length > MAX_PERSISTED_REPLAY_CHARACTERS) {
        console.warn(
          `Replay remains available in memory but exceeds the ${MAX_PERSISTED_REPLAY_CHARACTERS}-character persistence limit`,
        );
        return;
      }
      try {
        localStorage.setItem(
          `forge5:replay:${this.state.snapshot.robotId}:${this.state.snapshot.roomId}`,
          serialized,
        );
      } catch (error) {
        console.warn('Replay persistence is unavailable for this session', error);
      }
    }
  }

  private getTaskFixtureObservations(): TaskFixtureObservation[] {
    return (
      [
        this.physics.getTaskFixtureObservation('control-panel-east', this.robot.telemetry.yaw),
        this.physics.getTaskFixtureObservation('dock-south', this.robot.telemetry.yaw),
      ] as const
    ).filter((fixture): fixture is TaskFixtureObservation => fixture !== null);
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    if (
      this.frame % 60 === 0 &&
      this.mintWorlds.alignmentDiagnostics?.status === 'aligned-pending-visual-bounds'
    ) {
      this.mintWorlds.refreshAlignment();
    }
    const alignment = this.mintWorlds.alignmentDiagnostics;
    this.diagnostics.recordChanged(
      'world-alignment',
      alignment?.status === 'blocked' ? 'error' : 'info',
      'world-alignment',
      'alignment-status',
      alignment,
    );
    const containment = this.physics.containmentDiagnostics;
    const desiredMotion = this.physics.robotMotionDiagnostics.desired;
    const computedMotion = this.physics.robotMotionDiagnostics.computed;
    const motionClamped =
      Math.hypot(
        desiredMotion.x - computedMotion.x,
        desiredMotion.y - computedMotion.y,
        desiredMotion.z - computedMotion.z,
      ) > 0.001;
    this.diagnostics.recordChanged(
      'motion-boundary-clamp',
      motionClamped ? 'warning' : 'debug',
      'containment',
      motionClamped ? 'motion-command-clamped' : 'motion-command-clear',
      {
        clamped: motionClamped,
        desired: desiredMotion,
        computed: computedMotion,
        robotPosition: this.robot.telemetry.position,
      },
    );
    this.diagnostics.recordChanged(
      'robot-containment',
      containment.robot.valid ? 'info' : 'warning',
      'containment',
      'robot-containment-status',
      containment.robot,
    );
    this.diagnostics.recordChanged(
      'prop-containment',
      containment.props.invalid === 0 ? 'info' : 'warning',
      'containment',
      'prop-containment-status',
      containment.props,
    );
    const containmentManifest = getForgeMintContainmentManifest(this.state.snapshot.roomId);
    const robotCapabilities = getRobotCapabilityProfile(this.state.snapshot.robotId);
    const episodeState = this.episode?.getEpisodeState() ?? null;
    const episodeObservation = this.episode?.getObservation() ?? null;
    const episode =
      episodeState && episodeObservation
        ? {
            ...episodeState,
            requiresInteraction: episodeObservation.requiresInteraction,
            requiredTaskVerb: episodeObservation.requiredTaskVerb,
            currentGoal: episodeObservation.currentGoal
              ? {
                  x: episodeObservation.currentGoal.x,
                  y: episodeObservation.currentGoal.y,
                  z: episodeObservation.currentGoal.z,
                }
              : null,
          }
        : null;
    const articulation = this.robot.articulation;
    let visibleMintComponents = 0;
    this.robot.visual.root.traverse((object) => {
      if (object.userData.articulatedMintComponent === true) visibleMintComponents += 1;
    });
    const taskAnimation =
      (
        this.robot.visual.root.userData as {
          taskAnimation?: {
            active: boolean;
            verb: RobotTaskVerb;
            phase: number;
            profile: string;
          };
        }
      ).taskAnimation ?? null;
    const jumpAnimation =
      (
        this.robot.visual.root.userData as {
          jumpAnimation?: {
            active: boolean;
            phase: 'grounded' | 'takeoff' | 'ascent' | 'apex' | 'descent' | 'landing';
            phaseProgress: number;
            verticalVelocity: number;
            sequence: number;
            profile: string;
            articulatedJoints?: number;
          };
        }
      ).jumpAnimation ?? null;
    const diagnostics = {
      frame: this.frame,
      elapsed: this.elapsed,
      phase: this.state.snapshot.phase,
      robotId: this.state.snapshot.robotId,
      roomId: this.state.snapshot.roomId,
      controlMode: this.state.snapshot.controlMode,
      cameraMode: this.cameraMode,
      robot: {
        position: {
          x: this.robot.telemetry.position.x,
          y: this.robot.telemetry.position.y,
          z: this.robot.telemetry.position.z,
        },
        yaw: this.robot.telemetry.yaw,
        speed: this.robot.telemetry.speed,
        grounded: this.robot.telemetry.grounded,
        battery: this.robot.telemetry.battery,
        collisions: this.robot.telemetry.collisions,
        emergencyStopped: this.robot.telemetry.emergencyStopped,
        mobilityPosture: this.robot.mobilityPosture,
        taskAction: this.robot.taskAction,
        capabilities: robotCapabilities,
        sensors: this.robot.sensorSnapshot,
        visual: {
          status: this.robot.visualStatus,
          source: this.robot.visual.source,
          error: this.robot.visualError,
          visibleMintComponents,
          expectedVisibleMintComponents:
            typeof this.robot.visual.root.userData.expectedVisibleComponentCount === 'number'
              ? this.robot.visual.root.userData.expectedVisibleComponentCount
              : 0,
          taskAnimation,
          jumpAnimation,
          metricEnvelope:
            (
              this.robot.visual.root.userData as {
                metricEnvelope?: unknown;
              }
            ).metricEnvelope ?? null,
          groundClearanceMeters: this.robot.visualGroundClearanceMeters,
        },
        articulation: articulation
          ? {
              source: articulation.source,
              joints: Object.keys(articulation.joints).length,
              sockets: Object.keys(articulation.sockets).length,
              limitStatus: articulation.limitStatus,
              socketStatus: articulation.socketStatus,
              actuation: articulation.actuation,
            }
          : null,
      },
      episode,
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      physics: this.physics.diagnostics,
      containment,
      physicsMotion: this.physics.robotMotionDiagnostics,
      physicsContacts: this.physics.robotContactObservation,
      taskObject: this.physics.getTaskObjectObservation('instrument-case'),
      taskFixtures: {
        'control-panel-east': this.physics.getTaskFixtureObservation(
          'control-panel-east',
          this.robot.telemetry.yaw,
        ),
        'dock-south': this.physics.getTaskFixtureObservation(
          'dock-south',
          this.robot.telemetry.yaw,
        ),
      },
      replay: {
        version: this.replayData?.version ?? null,
        frame: this.replayFrame,
        divergences: this.replayDivergences,
        lastDivergence: this.replayLastDivergence,
      },
      dynamicGate: {
        physicsY: this.physics.getDynamicGatePosition(this.dynamicGatePosition)?.y ?? null,
        visualY: this.world.getDynamicGatePosition(this.visualGatePosition)?.y ?? null,
      },
      navigation: {
        worker: this.worldRuntime.status === 'commissioning',
        mode:
          this.worldRuntime.status === 'production'
            ? ('collider-navmesh' as const)
            : this.worldRuntime.status === 'commissioning'
              ? ('commissioning-grid' as const)
              : ('blocked' as const),
        profile: this.planner.productionDiagnostics?.profile ?? null,
        sourceMeshes: this.planner.productionDiagnostics?.sourceMeshes ?? 0,
        buildMilliseconds: this.planner.productionDiagnostics?.buildMilliseconds ?? 0,
        routePointsProjected:
          this.planner.productionDiagnostics?.routePointsProjected ?? this.path.length,
        cachedSegments: this.planner.productionDiagnostics?.cachedSegments ?? 0,
        pathPoints: this.path.length,
        pathIndex: this.pathIndex,
        pathPreview: this.path.slice(0, 6).map((point) => ({
          x: point.x,
          y: point.y,
          z: point.z,
        })),
      },
      world: {
        ...this.worldRuntime,
        containmentContract:
          this.worldRuntime.status === 'sandbox'
            ? {
                sourceSplatSha256: 'remote-rad-runtime-manifest',
                envelope: 'reviewed-visual-safe-aabb' as const,
                reviewStatus: 'visual-splat-safe-volume-reviewed' as const,
                semanticAuthority: false as const,
              }
            : {
                sourceSplatSha256: containmentManifest.sourceSplatSha256,
                envelope: containmentManifest.envelope,
                reviewStatus: containmentManifest.reviewStatus,
                semanticAuthority: containmentManifest.semanticAuthority,
              },
        visualSource:
          this.worldRuntime.status === 'production' || this.worldRuntime.status === 'sandbox'
            ? ('mint-rad' as const)
            : this.worldRuntime.status === 'commissioning'
              ? ('commissioning-proxy' as const)
              : ('qualification-blocked' as const),
        semantics:
          this.worldRuntime.status === 'production'
            ? ('pending-analyzer' as const)
            : this.worldRuntime.status === 'commissioning'
              ? ('commissioning' as const)
              : ('unavailable' as const),
        alignment,
        experienceScale:
          this.worldRuntime.status === 'production'
            ? MINT_WORLD_EXPERIENCE_SCALE
            : this.worldRuntime.status === 'sandbox'
              ? OUTDOOR_FREEPLAY_WORLD.manifest.rootTransform.uniformScale
              : 1,
        visualGuard: {
          status:
            this.worldRuntime.status === 'sandbox'
              ? ('active' as const)
              : this.worldRuntime.status === 'fallback-error' &&
                  this.worldRuntime.roomId === 'outdoor-freeplay'
                ? ('blocked' as const)
                : ('inactive' as const),
          id: this.worldRuntime.roomId === 'outdoor-freeplay' ? OUTDOOR_VISUAL_GUARD.id : null,
          contractSha256:
            this.worldRuntime.roomId === 'outdoor-freeplay' ? OUTDOOR_VISUAL_GUARD_SHA256 : null,
          sourceAssetId:
            this.worldRuntime.roomId === 'outdoor-freeplay'
              ? OUTDOOR_VISUAL_GUARD.source.assetId
              : null,
          bounds:
            this.worldRuntime.roomId === 'outdoor-freeplay'
              ? {
                  min: OUTDOOR_VISUAL_GUARD.safeVolume.bounds.min,
                  max: OUTDOOR_VISUAL_GUARD.safeVolume.bounds.max,
                }
              : null,
          renderedEnvelopePolicy:
            this.worldRuntime.roomId === 'outdoor-freeplay'
              ? OUTDOOR_VISUAL_GUARD.safeVolume.renderedEnvelopePolicy
              : null,
          maximumRobotHorizontalMarginMeters:
            this.worldRuntime.roomId === 'outdoor-freeplay'
              ? OUTDOOR_VISUAL_GUARD.safeVolume.maximumRobotHorizontalMarginMeters
              : null,
          failurePolicy:
            this.worldRuntime.roomId === 'outdoor-freeplay'
              ? OUTDOOR_VISUAL_GUARD.failurePolicy
              : null,
        },
      },
      props: { ...this.propRuntime },
      freeplay: this.freeplayObjects.snapshot,
      calibration: this.calibrationDebug.diagnostics,
      layers: { ...this.debugLayers },
      audio: {
        activeEmitters: this.audio.activeEmitters,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: this.renderer.getPixelRatio(),
      },
      camera: {
        position: this.camera.position.toArray(),
        quaternion: this.camera.quaternion.toArray(),
        matrixWorld: this.camera.matrixWorld.toArray(),
        projectionMatrix: this.camera.projectionMatrix.toArray(),
        near: this.camera.near,
        far: this.camera.far,
      },
      scene: {
        directChildren: this.scene.children.map((child) => ({
          name: child.name,
          type: child.type,
          visible: child.visible,
        })),
        robotWorldBounds: (() => {
          const bounds = new THREE.Box3().setFromObject(this.robot.visual.root);
          return { min: bounds.min.toArray(), max: bounds.max.toArray() };
        })(),
        robotMatrixWorld: this.robot.visual.root.matrixWorld.toArray(),
      },
      events: this.diagnostics.snapshot().slice(-200),
    };
    window.__FORGE5_DIAGNOSTICS__ = diagnostics;
    window.__THREE_APP_DIAGNOSTICS__ = diagnostics;
  }

  private nextPaint(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
}
