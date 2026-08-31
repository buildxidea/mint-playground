import * as THREE from 'three';
import { EnemyDirector } from '../ai/EnemyDirector';
import type { Enemy, EnemyFireEvent, EnemyState } from '../ai/Enemy';
import {
  MintAssetRuntime,
  type MintWorldRecord,
} from '../assets/MintAssetRuntime';
import { modelHeadfrontYawOffsetToActorForward } from '../assets/mintCharacterFacing';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { PerformanceTelemetry } from '../core/PerformanceTelemetry';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import type {
  ZombiesEditor,
  EditorSplatLayer,
  ZombiesEditorSavePayload,
} from '../editor/ZombiesEditor';
import {
  getWeapon,
  isOpsLoadoutWeapon,
  WEAPONS,
  type WeaponDefinition,
} from '../data/weapons';
import {
  MissionController,
  type MissionEvent,
  type MissionSnapshot,
} from '../mission/MissionController';
import { PlayerController, type PlayerSnapshot } from '../player/PlayerController';
import { AudioSystem } from '../systems/AudioSystem';
import { PersistenceSystem } from '../systems/PersistenceSystem';
import { PhysicsWorld } from '../systems/PhysicsWorld';
import { VfxSystem } from '../systems/VfxSystem';
import { GameUI, type UiActions } from '../ui/GameUI';
import { createSeededRandom } from '../utils/random';
import { WeaponSystem, type WeaponEvent } from '../weapons/WeaponSystem';
import { ArmoryPreview } from '../weapons/ArmoryPreview';
import {
  installMintAttachments,
  normalizeMintModel,
  FIRST_PERSON_VIEWMODEL_LAYER,
  WeaponViewModel,
} from '../weapons/WeaponViewModel';
import { prepareMintWeaponModel } from '../weapons/WeaponPresentation';
import { FacilityWorld } from '../world/FacilityWorld';
import {
  fpViewmodelOverlayScene,
  MINT_PRIMARY_SPLAT_LAYER,
  MintWorldLayer,
  type MintContinuousSplatPortal,
} from '../world/MintWorldLayer';
import { SplatCampus } from '../world/SplatCampus';
import { SplatContainment } from '../world/SplatContainment';
import {
  reseatCutsAboveFloor,
  type SplatCutVolume,
} from '../world/SplatCutVolume';
import type { SplatTrimPlane } from '../world/SplatTrimPlane';
import { SplatPreloadCoordinator } from '../world/SplatPreloadCoordinator';
import {
  SplatFrameCompletion,
  type SplatFrameTransition,
} from '../world/SplatFrameCompletion';
import {
  SplatNavigationSurface,
  syncZombiesSplatModuleAssets,
  zombiesSplatNavigationBake,
  type SplatNavigationBakeAsset,
  type SplatWorldPortal,
} from '../world/SplatNavigationSurface';
import { ZombiesController } from '../zombies/ZombiesController';
import {
  ZOMBIES_PLACEMENT_LAYOUT,
  replaceZombiesPlacementLayout,
  validateZombiesPlacementLayout,
} from '../zombies/ZombiesPlacementLayout';
import {
  RoomTransitSystem,
  type RoomTransitDestination,
} from '../zombies/RoomTransitSystem';
import { buildZombiePresentation } from '../zombies/ZombiePresentation';
import { zombiePresentationFor } from '../zombies/zombiesData';
import {
  applyMapsOutbreakWalkableFromCollider,
  assertMapsRuntimeSupportsWalkableBake,
  beginMapsOutbreakFromUrl,
  buildMapsCampusPack,
  cancelMapsOutbreakPrefetch,
  draftPrefetchTarget,
  ensureMapsFeaturedServiceWorker,
  getFeaturedMapsArena,
  getMapsOutbreakDraft,
  installFeaturedMapsArena,
  isMapsOutbreakPrefetchWarming,
  listFeaturedMapsArenas,
  listMapsOutbreakDrafts,
  mapsCompassYawToPlayerYaw,
  mapsOutbreakPrefetchStatus,
  pollMapsOutbreakGeneration,
  prefetchFeaturedMapsArenas,
  prefetchMapsOutbreakRuntime,
  runtimePrefetchTarget,
} from '../maps-zombies';
import type { ZombiesResult } from './types';
import {
  DIFFICULTY_TUNING,
  type AppMode,
  type GameSettings,
  type MissionResult,
  type MissionStats,
  type PlayMode,
} from './types';

const FIXED_TIMESTEP = 1 / 60;
const SPAWN_PROTECTION_SECONDS = 6;
// Approach distance must cover hub cuts before the player reaches the seam so
// Spark can page destination RADs while the owner still owns the frame.
const ZOMBIES_PORTAL_PREFETCH_DISTANCE = 96;
// Every campus room has at most two exits. Keep both neighbors in the
// predictive set so nearly collinear doors (far-north -> hub/north) cannot
// starve the intended sequential room until the capsule reaches the seam.
// The first target receives the primary prefetch LoD and the second uses the
// existing reduced secondary scale, avoiding an all-campus load spike.
const ZOMBIES_PORTAL_MAX_PREFETCH = 2;
// A prefetched room only needs enough coarse coverage to avoid a clear-color
// doorway. Giving it owner-level detail caused the shared LoD frontier to
// redistribute hundreds of thousands of splats whenever the player turned.
const ZOMBIES_PRIMARY_PREFETCH_LOD_SCALE = 0.55;
const ZOMBIES_SECONDARY_PREFETCH_LOD_SCALE = 0.2;
const ZOMBIES_PREDICTIVE_WARM_TIMEOUT_MS = 2_400;
// Loading may begin far ahead, but the expensive dual-splat compositor only
// belongs to a nearby, owner-side doorway that is actually in the camera.
const ZOMBIES_PORTAL_RENDER_DISTANCE = 24;
const ZOMBIES_PORTAL_FACING_COSINE = Math.cos(THREE.MathUtils.degToRad(65));
const ZOMBIES_PORTAL_OWNER_SIDE_GRACE = 2.4;
const ZOMBIES_PORTAL_MIN_COMPOSITE_DISTANCE = 0;
// Portal pairs farther apart than this are separate physical scan captures,
// not opposite sides of one thin wall. Rendering them as a virtual window
// creates a warped floating rectangle. Those spans use the authored, lit
// connector while both RADs stay resident for the eventual room handoff.
// Any scan-to-scan gap large enough to expose the renderer background owns a
// local Gaussian connector. This replaces the former 12 m threshold that left
// shorter folded joins staring directly into a captured closed wall.
const ZOMBIES_AUTHORED_CONNECTOR_MIN_SPAN = 0.75;
// Physics settling and autostep can move a capsule slightly beyond a cached
// landing after a crossing. Keep connector ownership through a short physical
// landing cap instead of using a floating-point-only endpoint epsilon.
const ZOMBIES_CONNECTOR_ENDPOINT_GRACE = 1.25;
const ZOMBIES_CONNECTOR_TRAVERSAL_LATCH_DISTANCE = 0.72;
const ZOMBIES_PORTAL_MAX_SPLAT_BUDGET = 420_000;
// Measured owner-specific motion render budgets. East's 4.25 authored scale
// creates ~2.9x the reference projected area; Far North and South also expose
// two expensive exits. Stationary views always return to full fidelity, and
// the exact editor-authored splat transforms remain untouched.
const ZOMBIES_ROOM_MOVING_LOD_SCALES = {
  'world-zombies-arena-east': 0.62,
  'world-zombies-arena-far-north': 0.74,
  'world-zombies-arena-south': 0.78,
} as const;
const zombiesSplatLookDirection = new THREE.Vector3();
const zombiesPortalCameraPosition = new THREE.Vector3();
const zombiesPortalCenter = new THREE.Vector3();
const zombiesPortalInterior = new THREE.Vector3();
const zombiesPortalOutward = new THREE.Vector3();
const zombiesPortalToAperture = new THREE.Vector3();
const zombiesPortalRight = new THREE.Vector3();
const zombiesPortalCorner = new THREE.Vector3();
const zombiesPortalWorldUp = new THREE.Vector3(0, 1, 0);
const zombiesPortalVirtualTarget = new THREE.Vector3();
const zombiesPortalVirtualLookMatrix = new THREE.Matrix4();
const zombiesPortalVirtualQuaternion = new THREE.Quaternion();
const zombiesSplatPreloadKey = (ownerId: string, destinationId: string) =>
  `${ownerId}->${destinationId}`;
type MintWorldRole = 'operations' | 'mission' | 'zombies';
type ZombiesWorldEntry = {
  world: MintWorldRecord;
  index: number;
  layer: MintWorldLayer;
};
type ZombiesWorldStream = {
  firstReady: Promise<ZombiesWorldEntry>;
  allReady: Promise<ZombiesWorldEntry[]>;
  settled: boolean;
};
const raycaster = new THREE.Raycaster();
const shotDirection = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();
const enemyOrigin = new THREE.Vector3();
const playerTarget = new THREE.Vector3();
const localRight = new THREE.Vector3();
const localUp = new THREE.Vector3();

function createZombiesAtmosphereBackdrop(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create Zombies atmosphere backdrop');

  const vertical = context.createLinearGradient(0, 0, 0, canvas.height);
  // Sparse RAD / trim discard should read as open dark space, not a chalky
  // grey panel that competes with the captured splat colors.
  vertical.addColorStop(0, '#0c1411');
  vertical.addColorStop(0.52, '#152019');
  vertical.addColorStop(1, '#0a100e');
  context.fillStyle = vertical;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const haze = context.createRadialGradient(
    canvas.width * 0.5,
    canvas.height * 0.48,
    10,
    canvas.width * 0.5,
    canvas.height * 0.48,
    canvas.width * 0.54,
  );
  haze.addColorStop(0, 'rgba(70, 92, 82, 0.1)');
  haze.addColorStop(0.58, 'rgba(40, 56, 48, 0.06)');
  haze.addColorStop(1, 'rgba(12, 18, 14, 0.08)');
  context.fillStyle = haze;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Fixed-seed low-contrast grain keeps sparse RAD pixels from resolving to
  // a flat screen-space rectangle while remaining visually quiet in motion.
  let seed = 0x6d2b79f5;
  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let index = 0; index < 1_100; index += 1) {
    const light = random() > 0.5;
    const alpha = 0.015 + random() * 0.035;
    context.fillStyle = light
      ? `rgba(174, 199, 188, ${alpha})`
      : `rgba(21, 31, 27, ${alpha})`;
    const size = 1 + Math.floor(random() * 3);
    context.fillRect(
      Math.floor(random() * canvas.width),
      Math.floor(random() * canvas.height),
      size,
      size,
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'zombies-sparse-rad-atmosphere';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

type CheckpointSnapshot = {
  player: PlayerSnapshot;
  ammo: Record<string, { magazine: number; reserve: number }>;
  mission: MissionSnapshot;
  equipmentCount: number;
  segment: 0 | 1 | 2;
  stats: MissionStats;
};

/**
 * Vite preview serves immutable bundled JSON, while the editor save endpoint
 * writes the project assets beside the build. Hydrate those authoritative
 * files before constructing gameplay so Save -> reload/playtest has identical
 * behavior in dev and in a production preview server.
 */
async function hydrateSavedZombiesEditorAssets(): Promise<void> {
  try {
    const response = await fetch('/__zombies-editor/assets', {
      cache: 'no-store',
    });
    if (!response.ok) return;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return;
    const payload = (await response.json()) as ZombiesEditorSavePayload;
    if (
      payload.layout?.version !== 1 ||
      payload.navigation?.version !== 1 ||
      payload.placements?.version !== 1
    ) {
      return;
    }
    syncZombiesSplatModuleAssets(
      payload.layout,
      payload.navigation as unknown as SplatNavigationBakeAsset,
    );
    replaceZombiesPlacementLayout(payload.placements);
  } catch {
    // Static hosts do not expose the editor middleware. Their bundled assets
    // remain the valid read-only fallback.
  }
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly telemetry: PerformanceTelemetry;
  private readonly scene = new THREE.Scene();
  private readonly operationsBackground = new THREE.Color('#0b100e');
  // Near-black clear keeps cut/sparse RAD holes from reading as a solid grey
  // fog wall in front of the camera. Atmosphere texture still softens seams.
  private readonly zombiesClearColor = new THREE.Color('#0a100e');
  private readonly zombiesBackground = createZombiesAtmosphereBackdrop();
  private readonly camera = new THREE.PerspectiveCamera(82, 1, 0.06, 280);
  private readonly input: InputController;
  private readonly persistence = new PersistenceSystem();
  private readonly assets = new MintAssetRuntime();
  private readonly audio: AudioSystem;
  private readonly world: FacilityWorld;
  private readonly player: PlayerController;
  private readonly weapon: WeaponSystem;
  private readonly weaponView: WeaponViewModel;
  private readonly armoryPreview: ArmoryPreview;
  private readonly enemies: EnemyDirector;
  private readonly mission: MissionController;
  private readonly vfx: VfxSystem;
  private readonly loop: Loop;
  private readonly mintWorldLayers = new Map<string, MintWorldLayer>();
  private readonly mintWorldRoles = new Map<string, MintWorldRole>();
  private readonly splatCampus = new SplatCampus();
  private readonly zombiesCampus = new SplatCampus();
  private zombiesNavigationSurface = new SplatNavigationSurface();
  private zombiesContainment = new SplatContainment(
    this.zombiesNavigationSurface,
  );
  private mapsOutbreakContainment: SplatContainment | null = null;
  private readonly zombiesSplatCompletion = new SplatFrameCompletion();
  private readonly zombiesSplatPreload = new SplatPreloadCoordinator();
  private mintMissionRoomIds: string[] = [];
  private mintZombiesRoomIds: string[] = [];
  private zombiesPlayspaceReady = false;
  private zombiesSplatBounds: THREE.Box3 | null = null;
  private zombiesPlayableBounds: THREE.Box3 | null = null;
  private readonly zombiesRoomContracts = new Map<
    string,
    { walkableBounds: THREE.Box3; anchor: THREE.Vector3; floorY: number }
  >();
  private zombiesSplatFrameOwner: string | null = null;
  private zombiesPreviousSplatFrameOwner: string | null = null;
  private zombiesPreviousSplatSeamCleared = true;
  private zombiesSplatPrefetch: string | null = null;
  private zombiesSplatPrefetchIds: string[] = [];
  private readonly zombiesPredictiveReadyRoomIds = new Set<string>();
  private zombiesPredictiveWarmTarget: string | null = null;
  private zombiesPredictiveWarmStatus = 'idle';
  private zombiesPredictiveHandoffTarget: string | null = null;
  private zombiesPredictiveHandoffSortReady = false;
  private zombiesPredictiveHandoffSortStatus = 'idle';
  private zombiesActivePortalId: string | null = null;
  private zombiesConnectorPresentationCandidateId: string | null = null;
  private zombiesConnectorPresentationCandidateOwnerId: string | null = null;
  private zombiesConnectorTraversalId: string | null = null;
  private zombiesConnectorTraversalState = 'idle';
  private getZombiesPortalCandidateDiagnostics(): Array<{
    id: string;
    destinationId: string;
    distance: number;
    ownerSideDistance: number;
    facingDot: number;
    ndc: { x: number; y: number; z: number };
    ready: boolean;
    prefetched: boolean;
  }> {
    const ownerId = this.zombiesSplatFrameOwner;
    const ownerRoom = ownerId
      ? this.zombiesNavigationSurface.room(ownerId)
      : null;
    if (!ownerId || !ownerRoom) return [];
    const cameraPosition = this.camera.getWorldPosition(new THREE.Vector3());
    const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3());
    return this.zombiesNavigationSurface.portals.flatMap((portal) => {
      const ownerIsFrom = portal.source.fromRoomId === ownerId;
      if (!ownerIsFrom && portal.source.toRoomId !== ownerId) return [];
      const destinationId = ownerIsFrom
        ? portal.source.toRoomId
        : portal.source.fromRoomId;
      const aperture =
        this.zombiesNavigationSurface.portalPresentationPoint(
          portal.source.id,
          ownerId,
        ) ?? (ownerIsFrom ? portal.from : portal.to).clone();
      const interior = this.zombiesNavigationSurface.portalApproachPoint(
        portal.source.id,
        ownerId,
        1.4,
      );
      if (!interior) return [];
      const center = aperture.clone();
      center.y = ownerRoom.floorY + 1.6;
      const outward = center
        .clone()
        .sub(new THREE.Vector3(interior.x, center.y, interior.z))
        .setY(0)
        .normalize();
      const cameraToAperture = center.clone().sub(cameraPosition);
      const distance = cameraToAperture.length();
      const projected = center.clone().project(this.camera);
      return [{
        id: portal.source.id,
        destinationId,
        distance,
        ownerSideDistance: cameraPosition
          .clone()
          .sub(center)
          .dot(outward),
        facingDot:
          distance > 0
            ? cameraDirection.dot(cameraToAperture.multiplyScalar(1 / distance))
            : -1,
        ndc: { x: projected.x, y: projected.y, z: projected.z },
        ready: this.isZombiesSplatPortalPreloadReady(ownerId, destinationId),
        prefetched: this.zombiesSplatPrefetchIds.includes(destinationId),
      }];
    });
  }
  private zombiesSplatClipKey = '*';
  private readonly zombiesSplatEvalPosition = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    0,
    Number.POSITIVE_INFINITY,
  );
  private readonly zombiesSplatEvalLook = new THREE.Vector3(0, 0, 1);
  private readonly zombiesPlayerStepPrevious = new THREE.Vector3();
  private readonly zombiesClipRoomIds = new Set<string>();
  private zombiesSplatOwnershipDirty = true;
  private readonly zombiesViewPacePosition = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    0,
    Number.POSITIVE_INFINITY,
  );
  private readonly zombiesViewPaceQuaternion = new THREE.Quaternion();
  private readonly zombiesContinuousPortal: MintContinuousSplatPortal = {
    center: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    halfWidth: 0.75,
    halfHeight: 1.35,
    destinationAperture: {
      center: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(-1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      halfWidth: 0.75,
      halfHeight: 1.35,
    },
    destinationCameraPosition: new THREE.Vector3(),
    destinationCameraQuaternion: new THREE.Quaternion(),
    lodCameraPosition: new THREE.Vector3(),
    lodCameraQuaternion: new THREE.Quaternion(),
    lodSplatCount: ZOMBIES_PORTAL_MAX_SPLAT_BUDGET,
  };
  private zombiesSplatAnalysisRoom: number | null = null;
  private zombiesSplatIsolationVisibility: Map<THREE.Mesh, boolean> | null =
    null;
  private zombiesSplatFrameHoldActivations = 0;
  private zombiesPortalsForcedReady: boolean | null = null;
  private loadingTarget: 'mission' | 'zombies' | 'maps-zombies' | 'editor' | null =
    null;
  private mapsOutbreakDraftId: string | null = null;
  private readonly mapsOutbreakPollTimers = new Map<string, number>();
  private mapsOutbreakPrefetchUiTimer: number | null = null;
  private missionAssetsReady = false;
  private missionAssetsPromise: Promise<void> | null = null;
  private missionDeploymentRevision = 0;
  private readonly installedMintProductionModels = new Set<string>();
  private zombiesViewAssetsPromise: Promise<void> | null = null;
  private zombiesHordeAssetsPromise: Promise<void> | null = null;
  private zombiesSecondaryAssetsPromise: Promise<void> | null = null;
  private zombiesAudioPromise: Promise<void> | null = null;
  private zombiesPrefetchStarted = false;
  /** Bumped to cancel an in-flight campus RAD stream (e.g. Maps deploy). */
  private zombiesWorldStreamGeneration = 0;
  private operationsVisualsPromise: Promise<void> | null = null;
  private zombiesWorldStream: ZombiesWorldStream | null = null;
  private readonly zombiesStreamProgressListeners = new Set<
    (completed: number, total: number, label: string) => void
  >();

  private mode: AppMode = 'loading';
  private settingsReturnMode: 'operations' | 'paused' = 'operations';
  private inspectedWeaponId = 'arx-7';
  private rng = createSeededRandom(9417);
  private frame = 0;
  private elapsed = 0;
  private smoothedFrameMs = 16.7;
  private shadowUpdateAccumulator = 0;
  private shadowUpdateMode: AppMode | null = null;
  private sceneMeshCount = 0;
  private sceneInstancedMeshCount = 0;
  private sceneMaterialCount = 0;
  private fixedAccumulator = 0;
  private pausedForScreenshot = false;
  private renderDisabledForTests = false;
  private reducedMotionTest = false;
  private hasLockedOnce = false;
  private equipmentCount = 2;
  private lastCheckpoint: CheckpointSnapshot | null = null;
  private stats: MissionStats = this.createStats();
  private shotSequence = 0;
  private operationsWeaponRevision = 0;
  private mintWorldLoadFailures = 0;
  private mintProductionColliderMeshes = 0;
  private footstepTimer = 0;
  private enemyAlertPlayed = false;
  private spawnProtectionRemaining = 0;
  private playMode: PlayMode = 'mission';
  private readonly zombies = new ZombiesController();
  private readonly zombiesRoomTransit = new RoomTransitSystem();
  private zombiesActive = false;
  private previousZombiesLastStand = false;
  private zombiesEditor: ZombiesEditor | null = null;
  private readonly editorPreviewRoots: THREE.Group[] = [];
  private zombiesDeathPresentation: {
    result: ZombiesResult;
    elapsed: number;
    startedAt: number;
    duration: number;
    cameraPosition: THREE.Vector3;
    yaw: number;
    pitch: number;
  } | null = null;
  private campusTour: {
    waypoints: Array<{ x: number; y: number; z: number; lookYaw?: number }>;
    index: number;
    segmentElapsed: number;
    segmentDuration: number;
    done: boolean;
  } | null = null;
  private lastBallistic: {
    source: 'player' | 'enemy' | 'probe';
    blocked: boolean;
    distance: number;
  } = { source: 'probe', blocked: false, distance: 0 };
  private disposed = false;

  static async create(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
  ): Promise<Game> {
    let game: Game | null = null;
    const actions: UiActions = {
      onAction: (action, value) => game?.handleUiAction(action, value),
      onSetting: (path, value) => game?.handleSetting(path, value),
    };
    const ui = new GameUI(uiRoot, actions);
    ui.updateLoading(0.12, 'Initializing WebGL 2');
    const rendererSupported = Game.supportsWebGL2();
    if (!rendererSupported) {
      uiRoot.innerHTML = `
        <section class="screen webgl-error">
          <div>
            <p class="eyebrow">Compatibility failure</p>
            <h1>WebGL 2 is required</h1>
            <p>Use a current desktop browser with hardware acceleration enabled.</p>
          </div>
        </section>`;
      throw new Error('WebGL 2 is unavailable.');
    }
    await hydrateSavedZombiesEditorAssets();
    ui.updateLoading(0.32, 'Starting fixed-step physics');
    const physics = await PhysicsWorld.create();
    ui.updateLoading(0.52, 'Assembling Site Nadir-12');
    game = new Game(canvas, ui, physics);
    game.telemetry.begin('startup.operations');
    // Menu-first: do not block Operations on the ops RAD / prop GLBs. Those
    // hydrate in the background while zombies hub bytes can use the pipe.
    game.world.setGeneratedOperationsActive(true);
    game.telemetry.end('startup.operations');
    ui.updateLoading(0.86, 'Indexing weapon platforms');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    ui.updateLoading(1, 'Secure channel ready');
    const boot = new URLSearchParams(window.location.search).get('boot');
    const bootZombies =
      boot === 'zombies' ||
      sessionStorage.getItem('blacksite:zombies-editor-playtest') === '1';
    if (boot === 'maps-zombies') {
      game.handleUiAction('ops-maps-zombies');
    } else if (bootZombies) {
      sessionStorage.removeItem('blacksite:zombies-editor-playtest');
      // Deep-link / playtest: skip Operations dwell and go straight to Deploy.
      void game.prefetchZombiesDeployment();
      void game.deployZombies();
    } else {
      game.showOperations();
      // Prefer zombies hub cache warm over ops RAD when the player deploys
      // immediately. Ops visuals fill in after a short dwell if still in menu.
      void game.prefetchZombiesDeployment();
      window.setTimeout(() => {
        void game.bootstrapOperationsVisuals();
      }, 2_000);
    }
    return game;
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: GameUI,
    private readonly physics: PhysicsWorld,
  ) {
    this.renderer = createRenderer(canvas);
    this.telemetry = new PerformanceTelemetry(this.renderer);
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.input = new InputController(canvas);
    this.zombies.setRandomSource(() => this.rng());
    this.audio = new AudioSystem(this.persistence.state.settings.audio, this.assets);
    this.scene.background = this.operationsBackground;
    this.scene.fog = new THREE.FogExp2('#101714', 0.011);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enable(MINT_PRIMARY_SPLAT_LAYER);
    this.camera.layers.enable(FIRST_PERSON_VIEWMODEL_LAYER);
    this.scene.add(this.camera);
    this.createLighting();
    // Cut cubes / trim planes own doorway apertures. They are applied when the
    // zombies campus loads; leaving them empty here avoids punching operations.
    MintWorldLayer.setGlobalCutVolumes([]);
    MintWorldLayer.setGlobalTrimPlanes([]);
    MintWorldLayer.setRoomMovingLodScales(ZOMBIES_ROOM_MOVING_LOD_SCALES);

    const bootZombies =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('boot') === 'zombies';
    this.world = new FacilityWorld(this.scene, physics, {
      minimal: bootZombies,
    });
    this.physics.completeFacilityColliderRegistration();
    if (!bootZombies && !this.assets.visibleFallbacksAllowed) {
      this.world.setGeneratedOperationsActive(true);
      this.world.setGeneratedMissionActive(true);
    }
    this.player = new PlayerController(physics, this.camera);
    this.weapon = new WeaponSystem(this.persistence.state.loadout);
    this.weaponView = new WeaponViewModel(
      this.camera,
      (weaponId) => this.persistence.state.loadout.attachments[weaponId],
      this.assets,
    );
    this.armoryPreview = new ArmoryPreview(this.ui.getArmoryViewport(), this.assets);
    this.enemies = new EnemyDirector(this.scene, this.world, this.physics);
    this.mission = new MissionController(this.world);
    this.vfx = new VfxSystem(this.scene, this.assets);
    this.loop = new Loop(
      (delta, elapsed, rawDelta) => this.update(delta, elapsed, rawDelta),
      () => this.render(),
    );

    this.ui.applyMintImages({
      keyArt: this.assets.getPublicUrl('image-mission-key-art', 'image'),
      tacticalMap: this.assets.getPublicUrl('image-tactical-map', 'image'),
      briefing: this.assets.getPublicUrl('image-briefing', 'image'),
      insignia: this.assets.getPublicUrl('image-faction-insignia', 'image'),
      loading: this.assets.getPublicUrl('image-loading-screen', 'image'),
      signage: this.assets.getPublicUrl('image-facility-signage', 'image'),
      weaponThumbnails: Object.fromEntries(
        ['arx-7', 'kestrel-9', 'morrow-dmr12', 'brimstone-lmg6', 'talon-m4', 'aegis-p11']
          .map((id) => [id, this.assets.getPublicUrl(`image-weapon-${id}`, 'image')]),
      ),
    });
    this.applySettings();
    this.publishDiagnostics();
    window.addEventListener('blacksite:pointer-lock', this.onPointerLock);
  }

  start(): void {
    if (this.disposed) return;
    this.installTestHooks();
    this.loop.start();
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    this.zombiesEditor?.dispose(false);
    this.zombiesEditor = null;
    this.clearEditorPreviewRoots();
    window.removeEventListener('blacksite:pointer-lock', this.onPointerLock);
    this.input.dispose();
    this.audio.dispose();
    this.enemies.dispose();
    this.vfx.dispose();
    this.weaponView.setVisible(false);
    this.armoryPreview.dispose();
    for (const world of this.mintWorldLayers.values()) {
      world.dispose();
    }
    this.mintWorldLayers.clear();
    this.mintWorldRoles.clear();
    this.mintMissionRoomIds = [];
    this.mintZombiesRoomIds = [];
    this.splatCampus.dispose(this.scene);
    this.zombiesCampus.dispose(this.scene);
    this.world.dispose();
    this.physics.dispose();
    this.assets.dispose();
    this.telemetry.dispose();
    this.ui.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  handleUiAction(action: string, value?: string): void {
    void this.audio.unlock();
    this.audio.ui();
    switch (action) {
      case 'ops-loadout':
        this.mode = 'loadout';
        for (const world of this.mintWorldLayers.values()) {
          world.setVisible(false);
        }
        this.splatCampus.setVisible(false);
        this.zombiesCampus.setVisible(false);
        this.ui.setMode('loadout');
        this.ui.renderLoadout(this.persistence.state.loadout);
        this.updateArmoryWeapon();
        break;
      case 'ops-briefing':
        this.mode = 'briefing';
        this.ui.setMode('briefing');
        this.ui.renderDifficulty(this.persistence.state.selectedDifficulty);
        break;
      case 'ops-zombies':
        // Skip the intermediate briefing screen — go straight into deployment.
        void this.prefetchZombiesDeployment();
        void this.beginZombiesMintWorldStream();
        this.deployZombies();
        break;
      case 'ops-maps-zombies':
        this.openMapsOutbreakCreate();
        break;
      case 'maps-zombies-play-featured':
        void this.playFeaturedMapsArena(value ?? '');
        break;
      case 'maps-zombies-prefetch-featured':
        this.prefetchMapsOutbreakFeatured(value ?? '');
        break;
      case 'maps-zombies-select-draft':
        this.selectMapsOutbreakDraft(value ?? '');
        break;
      case 'maps-zombies-prefetch-draft':
        this.prefetchMapsOutbreakDraft(value ?? '');
        break;
      case 'maps-zombies-generate':
        void this.beginMapsOutbreakGeneration();
        break;
      case 'maps-zombies-deploy':
        void this.deployMapsZombiesAsync();
        break;
      case 'ops-editor':
        void this.openZombiesEditor();
        break;
      case 'deploy-zombies':
        this.deployZombies();
        break;
      case 'retry-loading':
        if (this.loadingTarget === 'mission') this.deployMission();
        else if (this.loadingTarget === 'zombies') this.deployZombies();
        else if (this.loadingTarget === 'maps-zombies') {
          void this.deployMapsZombiesAsync();
        } else if (this.loadingTarget === 'editor') void this.openZombiesEditor();
        break;
      case 'back-ops':
      case 'return-ops':
        cancelMapsOutbreakPrefetch();
        this.stopMapsOutbreakPolling();
        this.teardownZombies();
        this.showOperations();
        break;
      case 'select-weapon':
        if (value && isOpsLoadoutWeapon(value)) {
          this.inspectedWeaponId = value;
          this.ui.setInspectedWeapon(value, this.persistence.state.loadout);
          this.updateOperationsWeapon();
          this.updateArmoryWeapon();
        }
        break;
      case 'select-attachment':
        if (value) this.selectAttachment(value);
        break;
      case 'equip-primary':
        if (
          isOpsLoadoutWeapon(this.inspectedWeaponId) &&
          this.inspectedWeaponId !== 'aegis-p11'
        ) {
          this.persistence.state.loadout.primaryId = this.inspectedWeaponId;
          this.saveLoadout();
        }
        break;
      case 'select-equipment':
        if (value === 'murk-smoke' || value === 'volt-disruptor') {
          this.persistence.state.loadout.equipmentId = value;
          this.saveLoadout();
        }
        break;
      case 'save-preset':
        this.persistence.savePreset();
        break;
      case 'set-difficulty':
        if (value === 'recruit' || value === 'operative' || value === 'blacksite') {
          this.persistence.state.selectedDifficulty = value;
          this.persistence.save();
          this.ui.renderDifficulty(value);
        }
        break;
      case 'deploy':
        this.deployMission();
        break;
      case 'open-settings':
        this.settingsReturnMode = 'operations';
        this.mode = 'settings';
        this.ui.renderSettings(this.persistence.state.settings);
        this.ui.setMode('settings');
        break;
      case 'open-pause-settings':
        this.settingsReturnMode = 'paused';
        this.mode = 'settings';
        this.ui.renderSettings(this.persistence.state.settings);
        this.ui.setMode('settings');
        break;
      case 'close-settings':
        this.mode = this.settingsReturnMode;
        this.ui.setMode(this.mode);
        break;
      case 'reset-data':
        if (window.confirm('Reset all Blacksite: Echo loadouts, settings, and records?')) {
          this.persistence.reset();
          this.applySettings();
          this.updateOperationsWeapon();
          this.showOperations();
        }
        break;
      case 'resume':
      case 'lock-pointer':
        if (this.isZombiesPlayMode()) this.resumeZombies();
        else this.resumeMission();
        break;
      case 'restart':
        if (this.isZombiesPlayMode()) this.redeployActiveZombiesMode();
        else this.restartCheckpoint();
        break;
      case 'replay':
        if (this.isZombiesPlayMode()) this.redeployActiveZombiesMode();
        else this.deployMission();
        break;
      default:
        break;
    }
  }

  handleSetting(path: string, value: string | number | boolean): void {
    const settings = this.persistence.state.settings;
    const accessibility = settings.accessibility as unknown as Record<
      string,
      string | number | boolean
    >;
    const audio = settings.audio as unknown as Record<string, number>;
    if (path === 'quality' && ['low', 'medium', 'high'].includes(String(value))) {
      settings.quality = value as GameSettings['quality'];
    } else if (path in settings.accessibility) {
      accessibility[path] = value;
    } else if (path in settings.audio) {
      audio[path] = Number(value);
    }
    this.persistence.save();
    this.applySettings();
  }

  private update(
    delta: number,
    elapsed: number,
    rawDelta = delta,
  ): void {
    const updateStarted = performance.now();
    this.frame += 1;
    this.elapsed = elapsed;
    this.smoothedFrameMs = THREE.MathUtils.lerp(
      this.smoothedFrameMs,
      Math.min(250, rawDelta * 1000),
      0.08,
    );
    this.telemetry.recordFrame(rawDelta * 1000);
    const commonStarted = performance.now();
    if (resizeRenderer(this.renderer, this.camera, this.getMaxDpr())) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.scheduleShadowUpdate(delta);
    const reducedMotion =
      this.reducedMotionTest || this.persistence.state.settings.accessibility.reducedShake;
    if (!this.isZombiesHudMode()) {
      this.world.update(delta, elapsed, reducedMotion);
    }
    this.armoryPreview.update(delta, reducedMotion);
    this.vfx.update(delta, elapsed);
    this.telemetry.recordWork(
      'frame.common-update',
      performance.now() - commonStarted,
    );

    if (this.updateZombiesDeathPresentation(delta)) {
      const diagnosticsStarted = performance.now();
      this.publishDiagnostics();
      this.telemetry.recordWork(
        'frame.diagnostics',
        performance.now() - diagnosticsStarted,
      );
      this.input.endFrame();
      this.telemetry.recordWork(
        'frame.update-total',
        performance.now() - updateStarted,
      );
      return;
    }

    if (this.pausedForScreenshot) {
      const diagnosticsStarted = performance.now();
      this.publishDiagnostics();
      this.telemetry.recordWork(
        'frame.diagnostics',
        performance.now() - diagnosticsStarted,
      );
      this.input.endFrame();
      this.telemetry.recordWork(
        'frame.update-total',
        performance.now() - updateStarted,
      );
      return;
    }

    const modeAtStart = this.mode;
    const modeStarted = performance.now();
    if (
      this.mode === 'operations' ||
      this.mode === 'loadout' ||
      this.mode === 'briefing'
    ) {
      this.updateOperationsCamera(delta);
    } else if (this.mode === 'editor') {
      this.zombiesEditor?.update(delta);
    } else if (this.mode === 'mission') {
      this.updateMission(delta, elapsed);
    } else if (this.isZombiesHudMode()) {
      this.updateZombies(delta, elapsed);
    }
    this.telemetry.recordWork(
      `mode.${modeAtStart}`,
      performance.now() - modeStarted,
    );
    const diagnosticsStarted = performance.now();
    this.publishDiagnostics();
    this.telemetry.recordWork(
      'frame.diagnostics',
      performance.now() - diagnosticsStarted,
    );
    this.input.endFrame();
    this.telemetry.recordWork(
      'frame.update-total',
      performance.now() - updateStarted,
    );
  }

  private updateMission(delta: number, elapsed: number): void {
    if (this.input.wasPressed('Escape')) {
      this.pauseMission();
      return;
    }
    if (this.hasLockedOnce && this.spawnProtectionRemaining > 0) {
      const wasProtected = this.isSpawnProtected();
      this.spawnProtectionRemaining = Math.max(
        0,
        this.spawnProtectionRemaining - delta,
      );
      if (wasProtected && !this.isSpawnProtected()) {
        this.ui.caption('Insertion shield offline // Hostiles can engage');
      }
    }
    this.player.updateLook(this.input, this.persistence.state.settings.accessibility);
    this.fixedAccumulator += Math.min(delta, 0.08);
    while (this.fixedAccumulator >= FIXED_TIMESTEP) {
      this.player.updateFixed(
        FIXED_TIMESTEP,
        this.input,
        this.persistence.state.settings.accessibility,
      );
      this.fixedAccumulator -= FIXED_TIMESTEP;
    }

    const weaponEvents = this.weapon.update(
      delta,
      this.input,
      this.player.isSprinting,
      this.player.wantsAim(),
    );
    for (const event of weaponEvents) this.handleWeaponEvent(event);
    this.player.updateCamera(
      delta,
      elapsed,
      this.persistence.state.settings.accessibility,
      this.weapon.adsFactor,
    );
    this.weaponView.update(
      delta,
      this.weapon,
      elapsed,
      this.player.locomotionSample(),
    );
    this.footstepTimer -= delta;
    if (this.player.speed > 1.6 && this.footstepTimer <= 0) {
      const surface =
        this.player.position.z < -52 && this.player.position.z > -82
          ? 'metal'
          : this.player.position.z < -16 && this.player.position.z > -54
            ? 'wet'
            : 'concrete';
      this.audio.footstep(surface);
      this.footstepTimer = this.player.isSprinting ? 0.31 : 0.48;
    }
    this.stats.elapsedMs += delta * 1000;

    const fireEvents = this.enemies.update(
      delta,
      elapsed,
      this.player.position,
      this.persistence.state.selectedDifficulty,
      !this.isSpawnProtected(),
      (enemy) => this.enemyCanSeePlayer(enemy),
      this.rng,
    );
    for (const event of fireEvents) this.handleEnemyFire(event);

    const missionEvents = this.mission.update(
      delta,
      this.player.position,
      this.input,
      this.enemies.getAliveCount(),
    );
    this.handleMissionEvents(missionEvents);
    this.ui.setInteractionPrompt(this.mission.interactionPrompt);
    const equipment =
      this.persistence.state.loadout.equipmentId === 'murk-smoke'
        ? 'Murk-3 smoke'
        : 'Volt-9 disruptor';
    this.ui.updateHud(
      delta,
      this.mission.getObjective(),
      this.player,
      this.weapon,
      equipment,
      this.equipmentCount,
      this.spawnProtectionRemaining,
      !this.hasLockedOnce,
      {
        objective: (() => {
          const point = this.mission.getObjectivePosition();
          return { x: point.x, y: point.y, z: point.z };
        })(),
        bounds: this.player.playableArea
          ? {
              min: {
                x: this.player.playableArea.min.x,
                z: this.player.playableArea.min.z,
              },
              max: {
                x: this.player.playableArea.max.x,
                z: this.player.playableArea.max.z,
              },
            }
          : null,
      },
    );
    this.canvas.style.filter =
      this.persistence.state.settings.accessibility.motionBlur &&
      this.player.isSprinting &&
      !this.weapon.adsFactor
        ? 'blur(0.35px)'
        : '';

    if (!this.player.isAlive()) this.failMission();
  }

  private handleMissionEvents(missionEvents: MissionEvent[]): void {
    for (const event of missionEvents) {
      if (event.type === 'checkpoint') {
        this.captureCheckpoint(event.segment, event.position);
        this.ui.caption(`Checkpoint ${event.id} secured`);
      } else if (event.type === 'array-disabled') {
        this.audio.alarm();
        this.ui.caption('Array offline // Facility alarm active');
      } else if (event.type === 'intel-retrieved') {
        this.audio.equipment();
        this.ui.caption('Echo Ledger secured');
      } else if (event.type === 'complete') {
        this.completeMission();
      }
    }
  }

  private handleWeaponEvent(event: WeaponEvent): void {
    if (event.type === 'shot') {
      this.fireWeapon(event.weapon);
    } else if (event.type === 'reload') {
      this.audio.reload();
    } else if (event.type === 'dry') {
      this.audio.ammoWarning(true);
      if (this.persistence.state.settings.accessibility.combatCaptions) {
        this.ui.caption('[Weapon dry]');
      }
    } else if (event.type === 'melee') {
      this.performMelee();
    } else if (event.type === 'equipment') {
      this.useEquipment();
    }
  }

  private fireWeapon(weapon: WeaponDefinition): void {
    this.stats.shotsFired += 1;
    this.shotSequence += 1;
    const cameraDirection = this.camera.getWorldDirection(shotDirection);
    this.camera.getWorldPosition(shotOrigin);
    localRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    localUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const spread =
      weapon.spread *
      THREE.MathUtils.lerp(1, 0.34, this.weapon.adsFactor) *
      (1 + this.player.suppression * 1.5);
    let hitAny = false;
    let criticalAny = false;
    let killedAny = false;
    let pointsAwarded = 0;
    for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
      const x = (this.rng() - 0.5) * spread;
      const y = (this.rng() - 0.5) * spread;
      const direction = cameraDirection
        .clone()
        .addScaledVector(localRight, x)
        .addScaledVector(localUp, y)
        .normalize();
      const result = this.castPlayerShot(weapon, shotOrigin, direction);
      hitAny ||= result.hit;
      criticalAny ||= result.critical;
      killedAny ||= result.killed;
      pointsAwarded += result.points;
    }
    if (hitAny) {
      this.stats.shotsHit += 1;
      this.ui.flashHit(criticalAny);
      this.audio.hit(criticalAny, killedAny);
      if (this.isZombiesPlayMode()) {
        this.ui.zombiesCombatFeedback({
          critical: criticalAny,
          killed: killedAny,
          points: pointsAwarded,
        });
      }
    }
    const lateral = (this.rng() - 0.5) * weapon.recoil * 0.44;
    this.player.addRecoil(weapon.recoil, lateral);
    const kind =
      weapon.fireMode === 'shotgun'
        ? 'shotgun'
        : weapon.id === 'brimstone-lmg6'
          ? 'heavy'
          : weapon.id === 'aegis-p11' || weapon.id === 'kestrel-9'
            ? 'light'
            : 'rifle';
    this.audio.gunshot(kind, weapon.suppressed);
    this.enemies.emitSound(this.player.position, weapon.suppressed ? 9 : 38);
    const shellPosition = shotOrigin
      .clone()
      .addScaledVector(localRight, 0.24)
      .addScaledVector(localUp, -0.18);
    this.vfx.spawnShell(shellPosition, this.camera, this.shotSequence);
    if (this.isZombiesPlayMode()) {
      const ammo = this.weapon.ammoState;
      const lowThreshold = Math.max(
        2,
        Math.ceil(this.weapon.current.magazineSize * 0.25),
      );
      if (ammo.magazine === 0 || ammo.magazine === lowThreshold) {
        this.audio.ammoWarning(ammo.magazine === 0);
      }
    }
  }

  private castPlayerShot(
    weapon: WeaponDefinition,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
  ): { hit: boolean; critical: boolean; killed: boolean; points: number } {
    raycaster.set(origin, direction);
    raycaster.far = weapon.falloffEnd * 1.25;
    const zombieTargets =
      this.isZombiesPlayMode()
        ? this.zombies.horde.zombies.flatMap((z) =>
            z.isDefeated() ? [] : z.hitTargets,
          )
        : [];
    const hitTargets =
      this.isZombiesPlayMode() ? zombieTargets : this.enemies.getHitTargets();
    const intersections = raycaster.intersectObjects(hitTargets, false);
    let intersection = intersections.find((item) => item.object.visible);
    if (this.isZombiesPlayMode() && intersection) {
      const nearestZombieId = this.findZombieIdFromObject(
        intersection.object,
      );
      const headIntersection = intersections.find((candidate) => {
        if (!candidate.object.visible) return false;
        const isHead =
          candidate.object.userData.hitZone === 'head' ||
          /head|face|skull/i.test(candidate.object.name);
        return (
          isHead &&
          candidate.distance <= intersection!.distance + 0.26 &&
          this.findZombieIdFromObject(candidate.object) === nearestZombieId
        );
      });
      if (headIntersection) intersection = headIntersection;
    }
    const worldHit = this.physics.castBallisticRay(origin, direction, raycaster.far);
    if (worldHit && (!intersection || worldHit.distance <= intersection.distance + 0.015)) {
      this.lastBallistic = {
        source: 'player',
        blocked: true,
        distance: worldHit.distance,
      };
      this.vfx.spawnImpact(worldHit.point, worldHit.normal);
      this.audio.impact(Math.abs(worldHit.normal.y) < 0.7 ? 'metal' : 'concrete');
      return { hit: false, critical: false, killed: false, points: 0 };
    }
    if (!intersection) {
      this.lastBallistic = {
        source: 'player',
        blocked: false,
        distance: raycaster.far,
      };
      return { hit: false, critical: false, killed: false, points: 0 };
    }

    if (this.isZombiesPlayMode()) {
      const directZombieId = intersection.object.userData.zombieId as
        | string
        | undefined;
      const zombieId =
        directZombieId && directZombieId !== 'pending'
          ? directZombieId
          : this.findZombieIdFromObject(intersection.object);
      if (!zombieId) {
        return { hit: false, critical: false, killed: false, points: 0 };
      }
      const critical =
        intersection.object.userData.hitZone === 'head' ||
        /head|face|skull/i.test(intersection.object.name);
      const falloff = THREE.MathUtils.clamp(
        (intersection.distance - weapon.falloffStart) /
          Math.max(0.01, weapon.falloffEnd - weapon.falloffStart),
        0,
        1,
      );
      const papMult = this.zombies.packAPunch.damageMultiplier(weapon.id);
      const baseDamage =
        THREE.MathUtils.lerp(weapon.damage, weapon.minimumDamage, falloff) * papMult;
      const result = this.zombies.onZombieDamaged(
        zombieId,
        baseDamage,
        { headshot: critical },
      );
      if (result.defeated && this.persistence.state.settings.accessibility.combatCaptions) {
        this.ui.caption(critical ? '[Infected down // precision hit]' : '[Infected down]');
      }
      this.vfx.spawnCombatImpact(
        intersection.point,
        direction.clone().multiplyScalar(-1),
        { critical, killed: result.defeated },
      );
      this.lastBallistic = {
        source: 'player',
        blocked: false,
        distance: intersection.distance,
      };
      return {
        hit: true,
        critical,
        killed: result.defeated,
        points: result.points,
      };
    }

    const enemyId = intersection.object.userData.enemyId as string | undefined;
    if (enemyId) {
      const enemy = this.enemies.getEnemyById(enemyId);
      if (!enemy || enemy.isDefeated()) {
        return { hit: false, critical: false, killed: false, points: 0 };
      }
      const critical = intersection.object.userData.hitZone === 'head';
      const falloff = THREE.MathUtils.clamp(
        (intersection.distance - weapon.falloffStart) /
          Math.max(0.01, weapon.falloffEnd - weapon.falloffStart),
        0,
        1,
      );
      const baseDamage = THREE.MathUtils.lerp(weapon.damage, weapon.minimumDamage, falloff);
      const result = enemy.hit(baseDamage * (critical ? 1.82 : 1));
      if (result.defeated) {
        this.stats.defeated += 1;
        if (this.persistence.state.settings.accessibility.combatCaptions) {
          this.ui.caption(critical ? '[Hostile down // precision hit]' : '[Hostile down]');
        }
      }
      this.vfx.spawnCombatImpact(
        intersection.point,
        direction.clone().multiplyScalar(-1),
        { critical, killed: result.defeated },
      );
      this.lastBallistic = {
        source: 'player',
        blocked: false,
        distance: intersection.distance,
      };
      return {
        hit: true,
        critical,
        killed: result.defeated,
        points: 0,
      };
    }
    return { hit: false, critical: false, killed: false, points: 0 };
  }

  private findZombieIdFromObject(object: THREE.Object3D): string | undefined {
    let current: THREE.Object3D | null = object;
    while (current) {
      const id = current.userData.zombieId as string | undefined;
      if (id && id !== 'pending') return id;
      current = current.parent;
    }
    return undefined;
  }

  private performMelee(): void {
    if (this.isZombiesPlayMode()) {
      // At melee distance the player camera often begins inside the same
      // collision volume as the target. The ballistic occlusion probe then
      // reports that close contact as a blocker, even when the zombie is
      // directly in front of the player. Range and facing still gate hits.
      const target = this.findMeleeTarget(false);
      if (!target) return;
      const result = this.zombies.onZombieDamaged(target.id, 115, true);
      this.ui.flashHit(false);
      this.audio.hit(false, result.defeated);
      this.ui.zombiesCombatFeedback({
        critical: false,
        killed: result.defeated,
        points: result.points,
        melee: true,
      });
      if (this.persistence.state.settings.accessibility.combatCaptions) {
        this.ui.caption(result.defeated ? '[Melee kill]' : '[Melee hit]');
      }
      return;
    }
    this.camera.getWorldPosition(shotOrigin);
    this.camera.getWorldDirection(shotDirection);
    raycaster.set(shotOrigin, shotDirection);
    raycaster.far = 2.35;
    const hit = raycaster
      .intersectObjects(this.enemies.getHitTargets(), false)
      .find((intersection) => intersection.object.visible);
    const enemyId = hit?.object.userData.enemyId as string | undefined;
    if (!enemyId) return;
    const enemy = this.enemies.getEnemyById(enemyId);
    if (!enemy) return;
    const result = enemy.hit(48);
    if (result.defeated) this.stats.defeated += 1;
    this.ui.flashHit(false);
    this.audio.hit(false);
  }

  private findMeleeTarget(
    checkOcclusion = true,
  ): { id: string; distance: number } | null {
    if (!this.isZombiesPlayMode()) return null;
    this.camera.getWorldPosition(shotOrigin);
    this.camera.getWorldDirection(shotDirection);
    let best: { id: string; distance: number; score: number } | null = null;

    for (const zombie of this.zombies.horde.zombies) {
      if (zombie.isDefeated()) continue;
      const target = zombie.group.position
        .clone()
        // Aim at the upper torso, which remains inside the melee cone for
        // a standing player and matches the playable zombie visual height.
        .add(new THREE.Vector3(0, 1.75, 0));
      const toTarget = target.sub(shotOrigin);
      const distance = toTarget.length();
      if (distance > 2.8 || distance < 0.05) continue;
      const direction = toTarget.clone().normalize();
      const facing = shotDirection.dot(direction);
      if (facing < 0.72) continue;
      if (checkOcclusion) {
        const obstruction = this.physics.castBallisticRay(
          shotOrigin,
          direction,
          distance,
        );
        if (obstruction && obstruction.distance < distance - 0.22) continue;
      }
      const score = distance + (1 - facing) * 3.2;
      if (!best || score < best.score) {
        best = { id: zombie.id, distance, score };
      }
    }

    return best ? { id: best.id, distance: best.distance } : null;
  }

  private useEquipment(): void {
    if (this.equipmentCount <= 0) {
      this.audio.ui(170);
      this.ui.caption('[Tactical equipment depleted]');
      return;
    }
    this.equipmentCount -= 1;
    this.camera.getWorldDirection(shotDirection);
    const target = this.player.position
      .clone()
      .addScaledVector(shotDirection.setY(0).normalize(), 6);
    target.y = 0.4;
    if (this.persistence.state.loadout.equipmentId === 'murk-smoke') {
      this.vfx.deploySmoke(target);
      this.ui.caption('[Smoke deployed // enemy sightlines blocked]');
    } else {
      const affected = this.enemies.disruptNear(target, 7.2);
      if (!this.persistence.state.settings.accessibility.reducedFlashing) this.ui.flashScreen();
      this.ui.caption(`[Disruptor pulse // ${affected} targets staggered]`);
    }
    this.audio.equipment();
  }

  private handleEnemyFire(event: EnemyFireEvent): void {
    if (this.isSpawnProtected()) return;
    const origin = event.enemy.getFireOrigin(enemyOrigin);
    playerTarget.copy(this.player.position).add(new THREE.Vector3(0, 1.2, 0));
    const direction = playerTarget.clone().sub(origin);
    const distance = direction.length();
    direction.normalize();
    const blocked = this.physics.castBallisticRay(origin, direction, distance);
    this.lastBallistic = {
      source: 'enemy',
      blocked: Boolean(blocked && blocked.distance < distance - 0.08),
      distance: blocked?.distance ?? distance,
    };
    this.audio.enemyFire(origin, this.player.position);
    if (blocked && blocked.distance < distance - 0.08) {
      this.vfx.spawnImpact(blocked.point, blocked.normal);
      return;
    }
    if (!this.enemyAlertPlayed) {
      this.enemyAlertPlayed = true;
      this.audio.enemyAlert();
    }
    this.player.addSuppression(event.suppressing ? 0.2 : 0.1);
    const tuning = DIFFICULTY_TUNING[this.persistence.state.selectedDifficulty];
    const roleScale =
      event.enemy.spawn.role === 'breacher' ? 0.82 : event.enemy.spawn.role === 'suppressor' ? 0.88 : 1;
    const distancePenalty = THREE.MathUtils.clamp(1 - Math.max(0, distance - 9) / 58, 0.35, 1);
    const movementPenalty = this.player.isSprinting ? 0.78 : 1;
    const accuracy = tuning.enemyAccuracy * roleScale * distancePenalty * movementPenalty;
    if (this.rng() > accuracy) return;
    const baseDamage =
      event.enemy.spawn.role === 'breacher' ? 19 : event.enemy.spawn.role === 'suppressor' ? 8 : 12;
    const damage = baseDamage * tuning.playerDamageScale;
    const healthDamage = this.player.damage(damage);
    this.stats.damageTaken += healthDamage;
    this.ui.flashDamage();
    this.audio.hurt();
    if (this.persistence.state.settings.accessibility.combatCaptions) {
      this.ui.caption('[Incoming fire // armor impact]');
    }
  }

  private enemyCanSeePlayer(enemy: Enemy): boolean {
    const origin = enemy.getFireOrigin(enemyOrigin);
    const target = playerTarget.copy(this.player.position).add(new THREE.Vector3(0, 1.2, 0));
    const toPlayer = target.clone().sub(origin);
    const distance = toPlayer.length();
    if (distance > 36) return false;
    if (this.vfx.isLineObscured(origin, target)) return false;
    const forward = new THREE.Vector3(
      Math.sin(enemy.group.rotation.y),
      0,
      Math.cos(enemy.group.rotation.y),
    );
    const flatDirection = toPlayer.clone().setY(0).normalize();
    const requiredDot = enemy.alert > 0.7 ? -0.2 : 0.18;
    if (forward.dot(flatDirection) < requiredDot) return false;
    raycaster.set(origin, toPlayer.normalize());
    const obstruction = this.physics.castBallisticRay(origin, toPlayer, distance);
    return !obstruction || obstruction.distance >= distance - 0.08;
  }

  private deployMission(onReady?: () => void): void {
    const revision = ++this.missionDeploymentRevision;
    void (async () => {
      if (!this.missionAssetsReady) {
        this.playMode = 'mission';
        this.teardownZombies();
        this.mode = 'loading';
        this.loadingTarget = 'mission';
        this.input.setGameplayEnabled(false);
        this.weaponView.setVisible(false);
        this.ui.setMode('loading');
        this.ui.updateLoading(0.08, 'Preparing mission deployment');
        try {
          await this.ensureMissionAssets();
        } catch (error) {
          if (revision !== this.missionDeploymentRevision) return;
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown mission loading failure';
          console.error('Mission deployment failed before readiness.', error);
          this.ui.showLoadingError(message);
          return;
        }
      }
      if (revision !== this.missionDeploymentRevision) return;
      this.loadingTarget = null;
      this.startMission();
      onReady?.();
    })();
  }

  private startMission(): void {
    this.applySceneAtmosphere('operations');
    this.playMode = 'mission';
    this.teardownZombies();
    this.mode = 'mission';
    this.world.showMission();
    this.setMintWorldVisibility('mission');
    this.weaponView.setVisible(true);
    this.input.setGameplayEnabled(true);
    this.hasLockedOnce = false;
    this.fixedAccumulator = 0;
    this.stats = this.createStats();
    this.equipmentCount = 2;
    this.enemyAlertPlayed = false;
    this.spawnProtectionRemaining = SPAWN_PROTECTION_SECONDS;
    this.footstepTimer = 0;
    this.player.reset();
    this.weapon.setLoadout(this.persistence.state.loadout);
    this.enemies.setCheckpointSegment(0);
    this.mission.start();
    this.vfx.reset();
    this.captureCheckpoint(0, this.player.spawnPosition);
    this.ui.setMode('mission');
    this.ui.setPointerPrompt(true);
    this.ui.caption('Insertion shield active // Hostiles cannot engage');
    this.audio.deploy();
  }

  private deployZombies(): void {
    void this.deployZombiesAsync();
  }

  private stopMapsOutbreakPolling(draftId?: string): void {
    if (draftId) {
      const timer = this.mapsOutbreakPollTimers.get(draftId);
      if (timer != null) {
        window.clearTimeout(timer);
        this.mapsOutbreakPollTimers.delete(draftId);
      }
      return;
    }
    for (const timer of this.mapsOutbreakPollTimers.values()) {
      window.clearTimeout(timer);
    }
    this.mapsOutbreakPollTimers.clear();
  }

  private mapsOutbreakWarmingKeys(): Set<string> {
    const keys = new Set<string>();
    const status = mapsOutbreakPrefetchStatus();
    if (status.state === 'warming' && status.key) {
      keys.add(status.key);
    }
    return keys;
  }

  private refreshMapsOutbreakDraftUi(): void {
    const warming = this.mapsOutbreakWarmingKeys();
    this.ui.renderMapsFeaturedArenas(listFeaturedMapsArenas(), warming);
    this.ui.renderMapsOutbreakDrafts(
      listMapsOutbreakDrafts(),
      this.mapsOutbreakDraftId,
      warming,
    );
  }

  private scheduleMapsOutbreakPrefetchUiRefresh(): void {
    if (this.mapsOutbreakPrefetchUiTimer != null) return;
    this.mapsOutbreakPrefetchUiTimer = window.setTimeout(() => {
      this.mapsOutbreakPrefetchUiTimer = null;
      if (this.mode !== 'maps-zombies-create') return;
      this.refreshMapsOutbreakDraftUi();
      if (isMapsOutbreakPrefetchWarming()) {
        this.scheduleMapsOutbreakPrefetchUiRefresh();
      }
    }, 400);
  }

  private beginMapsOutbreakPrefetch(
    target: Parameters<typeof prefetchMapsOutbreakRuntime>[0],
  ): void {
    this.telemetry.begin('maps.intent-prefetch');
    this.refreshMapsOutbreakDraftUi();
    this.scheduleMapsOutbreakPrefetchUiRefresh();
    void prefetchMapsOutbreakRuntime(target).then((result) => {
      this.telemetry.end(
        'maps.intent-prefetch',
        result.cancelled
          ? 'cancelled'
          : result.ok
            ? result.fromCache
              ? 'cache-hit'
              : `warmed:${Math.round(result.radBytes / 1024)}kb`
            : result.error ?? 'failed',
      );
      if (this.mode === 'maps-zombies-create') {
        this.refreshMapsOutbreakDraftUi();
      }
    });
  }

  private prefetchMapsOutbreakFeatured(catalogId: string): void {
    if (this.mode !== 'maps-zombies-create') return;
    const id = catalogId.trim() || listFeaturedMapsArenas()[0]?.id || '';
    const entry = id ? getFeaturedMapsArena(id) : null;
    if (!entry) return;
    this.beginMapsOutbreakPrefetch({
      key: `featured:${entry.id}`,
      title: entry.title,
      runtimeUrl: entry.runtime.runtimeUrl,
      colliderUrl: entry.runtime.colliderUrl,
      byteSize: entry.runtime.byteSize,
      persistToCacheApi: true,
    });
  }

  private prefetchMapsOutbreakDraft(draftId: string): void {
    if (this.mode !== 'maps-zombies-create') return;
    const draft = getMapsOutbreakDraft(draftId.trim());
    if (!draft?.runtime || draft.status !== 'ready') return;
    this.beginMapsOutbreakPrefetch(
      draftPrefetchTarget({
        draftId: draft.id,
        title: draft.title,
        runtime: draft.runtime,
      }),
    );
  }

  private openMapsOutbreakCreate(): void {
    this.stopMapsOutbreakPolling();
    this.mode = 'maps-zombies-create';
    this.ui.setMode('maps-zombies-create');
    void ensureMapsFeaturedServiceWorker();
    this.refreshMapsOutbreakDraftUi();
    this.scheduleMapsOutbreakPrefetchUiRefresh();

    // Resume every in-flight draft — not only the last selected id — so a
    // page refresh or sidebar click cannot leave Mint jobs stuck as GENERATING.
    const inFlight = listMapsOutbreakDrafts().filter(
      (draft) =>
        draft.status === 'queued' ||
        draft.status === 'generating' ||
        draft.status === 'installing',
    );
    for (const draft of inFlight) {
      void this.pollMapsOutbreakUntilReady(draft.id);
    }

    const active = this.mapsOutbreakDraftId
      ? getMapsOutbreakDraft(this.mapsOutbreakDraftId)
      : null;

    // Intent prefetch: selected READY draft wins; otherwise featured → newest.
    this.telemetry.begin('maps.create-prefetch');
    if (active?.status === 'ready' && active.runtime) {
      this.beginMapsOutbreakPrefetch(
        draftPrefetchTarget({
          draftId: active.id,
          title: active.title,
          runtime: active.runtime,
        }),
      );
      this.telemetry.end('maps.create-prefetch', 'active-draft');
      this.ui.setMapsOutbreakStatus(
        'Arena ready — deploy outbreak, play a featured map, or paste a new link.',
        true,
      );
      return;
    }
    void prefetchFeaturedMapsArenas()
      .then(() => {
        if (this.mode !== 'maps-zombies-create') return;
        const readyDrafts = listMapsOutbreakDrafts().filter(
          (draft) => draft.status === 'ready' && draft.runtime,
        );
        const newest = readyDrafts[0];
        if (newest?.runtime) {
          this.beginMapsOutbreakPrefetch(
            draftPrefetchTarget({
              draftId: newest.id,
              title: newest.title,
              runtime: newest.runtime,
            }),
          );
        }
      })
      .finally(() => {
        this.telemetry.end('maps.create-prefetch');
        if (this.mode === 'maps-zombies-create') {
          this.refreshMapsOutbreakDraftUi();
        }
      });
    if (
      active &&
      (active.status === 'queued' ||
        active.status === 'generating' ||
        active.status === 'installing')
    ) {
      this.ui.setMapsOutbreakStatus(
        active.error
          ? `Generating… ${active.error}`
          : `Generating Street View arena… ${active.title}`,
        false,
      );
      return;
    }
    if (active?.status === 'failed') {
      this.ui.setMapsOutbreakStatus(
        active.error ?? `Generation failed // ${active.title}.`,
        false,
      );
      return;
    }
    if (inFlight.length > 0) {
      const newest = inFlight[0]!;
      this.ui.setMapsOutbreakStatus(
        newest.error
          ? `Generating… ${newest.error}`
          : `Generating Street View arena… ${newest.title}`,
        false,
      );
      return;
    }
    this.ui.setMapsOutbreakStatus(
      'Play a featured arena, or paste a Street View URL to generate your own.',
      false,
    );
  }

  private selectMapsOutbreakDraft(draftId: string): void {
    const draft = getMapsOutbreakDraft(draftId.trim());
    if (!draft) {
      this.ui.setMapsOutbreakStatus('Draft not found in this browser.', false);
      this.refreshMapsOutbreakDraftUi();
      return;
    }

    this.mapsOutbreakDraftId = draft.id;
    this.ui.setMapsOutbreakForm({
      mapsUrl: draft.pose.sourceUrl,
      title: draft.title,
    });
    this.refreshMapsOutbreakDraftUi();

    if (draft.status === 'ready' && draft.runtime) {
      this.ui.setMapsOutbreakStatus(
        `Opening arena // ${draft.title}…`,
        true,
      );
      void this.deployMapsZombiesAsync();
      return;
    }
    if (draft.status === 'failed') {
      this.ui.setMapsOutbreakStatus(
        draft.error ?? `Generation failed // ${draft.title}.`,
        false,
      );
      return;
    }
    if (
      draft.status === 'queued' ||
      draft.status === 'generating' ||
      draft.status === 'installing'
    ) {
      this.ui.setMapsOutbreakStatus(
        draft.error
          ? `Generating… ${draft.error}`
          : `Generating Street View arena… ${draft.title}`,
        false,
      );
      void this.pollMapsOutbreakUntilReady(draft.id);
      return;
    }

    this.ui.setMapsOutbreakStatus(`Draft selected // ${draft.title}.`, false);
  }

  private async playFeaturedMapsArena(catalogId: string): Promise<void> {
    const id = catalogId.trim() || listFeaturedMapsArenas()[0]?.id || '';
    if (!id) {
      this.ui.setMapsOutbreakStatus('No featured arenas in the shared catalog.', false);
      return;
    }
    this.prefetchMapsOutbreakFeatured(id);
    const installed = installFeaturedMapsArena(id);
    if (!installed.ok) {
      this.ui.setMapsOutbreakStatus(installed.error, false);
      return;
    }
    this.mapsOutbreakDraftId = installed.draft.id;
    this.refreshMapsOutbreakDraftUi();
    this.ui.setMapsOutbreakStatus(
      `Featured arena ready // ${installed.draft.title}. Deploying…`,
      true,
    );
    this.ui.setMapsOutbreakForm({
      mapsUrl: installed.draft.pose.sourceUrl,
      title: installed.draft.title,
    });
    await this.deployMapsZombiesAsync();
  }

  private async beginMapsOutbreakGeneration(): Promise<void> {
    const form = this.ui.getMapsOutbreakForm();
    const started = beginMapsOutbreakFromUrl(form);
    if (!started.ok) {
      this.ui.setMapsOutbreakStatus(started.error, false);
      this.refreshMapsOutbreakDraftUi();
      return;
    }
    this.mapsOutbreakDraftId = started.draft.id;
    this.refreshMapsOutbreakDraftUi();
    this.ui.setMapsOutbreakStatus('Starting Mint world generation…', false);
    await this.pollMapsOutbreakUntilReady(started.draft.id);
  }

  private async pollMapsOutbreakUntilReady(draftId: string): Promise<void> {
    if (this.mode !== 'maps-zombies-create') return;
    this.stopMapsOutbreakPolling(draftId);
    const result = await pollMapsOutbreakGeneration(draftId);
    this.refreshMapsOutbreakDraftUi();
    const stillSelected = this.mapsOutbreakDraftId === draftId;
    if (!result.ok) {
      if (stillSelected) this.ui.setMapsOutbreakStatus(result.error, false);
      return;
    }
    const draft = result.draft;
    if (draft.status === 'ready' && draft.runtime) {
      this.beginMapsOutbreakPrefetch(
        draftPrefetchTarget({
          draftId: draft.id,
          title: draft.title,
          runtime: draft.runtime,
        }),
      );
      if (stillSelected) {
        this.ui.setMapsOutbreakStatus(
          `Arena ready // ${draft.title}. Warming splat cache — deploy when you are set.`,
          true,
        );
      }
      return;
    }
    if (draft.status === 'failed') {
      if (stillSelected) {
        this.ui.setMapsOutbreakStatus(
          draft.error ?? `Generation failed // ${draft.title}.`,
          false,
        );
      }
      return;
    }
    if (stillSelected) {
      this.ui.setMapsOutbreakStatus(
        draft.error
          ? `Generating… ${draft.error}`
          : 'Generating Street View arena… this can take several minutes.',
        false,
      );
    }
    // Keep polling even if another draft is selected so sidebar jobs finish.
    const timer = window.setTimeout(() => {
      this.mapsOutbreakPollTimers.delete(draftId);
      if (this.mode !== 'maps-zombies-create') return;
      void this.pollMapsOutbreakUntilReady(draftId);
    }, 4000);
    this.mapsOutbreakPollTimers.set(draftId, timer);
  }

  private async deployMapsZombiesAsync(): Promise<void> {
    const draftId = this.mapsOutbreakDraftId;
    const draft = draftId ? getMapsOutbreakDraft(draftId) : null;
    if (!draft?.runtime) {
      this.ui.setMapsOutbreakStatus(
        'Generate or install a ready arena before deploying.',
        false,
      );
      this.mode = 'maps-zombies-create';
      this.ui.setMode('maps-zombies-create');
      return;
    }

    this.stopMapsOutbreakPolling();
    // Keep HTTP/Cache warm alive for this runtime; cancel only unrelated jobs.
    this.beginMapsOutbreakPrefetch(
      runtimePrefetchTarget({
        key: `draft:${draft.id}`,
        title: draft.title,
        runtime: draft.runtime,
        persistToCacheApi: false,
      }),
    );

    this.playMode = 'maps-zombies';
    this.applySceneAtmosphere('zombies');
    this.teardownZombies();
    this.loadingTarget = 'maps-zombies';
    // Campus prefetch shares the Spark pager; dispose it before the Street
    // View RAD attaches so Maps never inherits campus cuts/owners/mappings.
    this.disposeOperationsMintWorlds();
    this.disposeZombiesMintWorlds();
    this.zombiesPrefetchStarted = false;
    this.zombiesPlayspaceReady = false;
    this.zombiesSplatBounds = null;
    this.zombiesPlayableBounds = null;
    this.previousZombiesLastStand = false;
    this.zombiesSplatCompletion.clear();
    this.mode = 'loading';
    this.zombiesActive = true;
    this.world.hideFacilityRoots();
    this.physics.setFacilityCollidersEnabled(false);
    this.splatCampus.setVisible(false);
    this.zombiesCampus.setVisible(false);
    this.enemies.enemies.forEach((enemy) => {
      enemy.group.visible = false;
    });
    this.weaponView.setVisible(false);
    this.input.setGameplayEnabled(false);
    this.hasLockedOnce = false;
    this.fixedAccumulator = 0;
    this.footstepTimer = 0;
    this.spawnProtectionRemaining = SPAWN_PROTECTION_SECONDS;
    this.weapon.setZombiesStarter();
    this.zombies.setCallbacks({
      grantWeapon: (weaponId, ammoOnly) =>
        this.weapon.grantWeapon(weaponId as import('../data/weapons').WeaponId, ammoOnly),
      refillAllAmmo: () => this.weapon.refillAllAmmo(),
      upgradeWeapon: (_weaponId) => this.weapon.upgradeHeldWeapon(),
      getHeldWeaponId: () => this.weapon.current.id,
      onRoundStart: (round) => {
        this.audio.zombiesRoundStart(round);
        this.ui.caption(`Round ${round}`);
      },
      onPurchase: () => this.audio.zombiesPurchase(),
      onPowerOn: () => {
        this.audio.zombiesPowerOn();
        this.ui.caption('Power online');
      },
      onBoxSpin: () => this.audio.zombiesBoxSpin(),
      onPowerUp: () => this.audio.zombiesPowerUp(),
      onZombieAttack: () => {
        this.audio.zombiesAttack();
        this.ui.flashDamage();
      },
      onZombieDeath: () => this.audio.zombiesDeath(),
      onGameOver: (result) => this.failZombies(result),
    });
    this.zombies.horde.setVisibleFallbacksAllowed(
      this.assets.visibleFallbacksAllowed,
    );
    this.hordeMintFactory();
    this.ui.setMode('loading');
    this.ui.updateLoading(0.04, 'Preparing Maps Outbreak deployment');

    try {
      this.telemetry.begin('maps.deploy');
      this.telemetry.begin('maps.first-playable');
      const pack = buildMapsCampusPack({
        draftId: draft.id,
        runtime: draft.runtime,
        chatUrl: draft.mintChatUrl,
        placements: draft.placements,
      });
      this.ui.updateLoading(0.1, 'Streaming Street View arena');
      // Critical path: RAD+collider + starter FP kit. Audio/horde warm in
      // background like campus Zombies — round 1 still has time before spawns.
      void this.ensureZombiesAudio();
      void this.ensureZombiesHordeAssets();
      this.telemetry.begin('maps.rad-ready');
      const viewAssetsPromise = this.ensureZombiesViewAssets();
      const layer = await MintWorldLayer.load(
        this.scene,
        this.renderer,
        this.physics,
        pack.world,
        ({ progress, label }) => {
          this.ui.updateLoading(0.1 + progress * 0.4, label);
        },
        { registerCollision: true, skipCollider: false },
      );
      this.telemetry.end('maps.rad-ready', pack.world.id);

      this.mintWorldLayers.set(pack.world.id, layer);
      this.mintWorldRoles.set(pack.world.id, 'zombies');
      this.mintZombiesRoomIds = [pack.world.id];
      layer.setRenderState('primary');
      layer.setVisible(true);

      const bounds = layer.bounds.clone();
      if (bounds.isEmpty()) {
        bounds.set(
          new THREE.Vector3(-8, -1, -8),
          new THREE.Vector3(8, 4, 8),
        );
      }
      // Every Maps draft (proof install, URL generate, or future import) seats
      // walkable space through the same editor-navmesh policy — never the old
      // 9m quality pocket.
      assertMapsRuntimeSupportsWalkableBake(draft.runtime);
      this.telemetry.begin('maps.nav-bake');
      this.ui.updateLoading(
        0.52,
        'Baking collider navigation (editor walkable model)',
      );
      const walkable = applyMapsOutbreakWalkableFromCollider(
        layer.getColliderRoot(),
        pack.roomId,
      );
      this.telemetry.end(
        'maps.nav-bake',
        `${walkable.bake.areaSquareMetres.toFixed(0)}m2`,
      );
      this.mapsOutbreakContainment = walkable.containment;
      draft.placements = walkable.placements;
      const { saveMapsOutbreakDraft } = await import('../maps-zombies');
      saveMapsOutbreakDraft(draft);

      const ignored = this.zombies.arena.configureMapsOutbreak(
        walkable.placements,
      );
      if (ignored.length > 0) {
        throw new Error(
          `Maps placement ignored unknown anchors: ${ignored.join(', ')}`,
        );
      }

      this.zombiesSplatBounds = bounds.clone();
      this.zombiesPlayableBounds = walkable.bake.bounds.clone();
      this.zombiesCampus.buildFromSurface(
        walkable.surface,
        this.physics,
        this.scene,
      );
      this.zombiesCampus.setVisible(false);
      this.arenaBuildZombies({ skipWorldBoundary: true, compactRooms: true });
      this.zombies.arena.setBlockoutVisible(false);
      this.physics.clearWorldBoundary();

      const spawn = walkable.spawn.clone();
      this.player.reset(spawn);
      this.player.configureSplatContainment(
        this.mapsOutbreakContainment,
        spawn,
      );
      const lookYaw =
        draft.pose.yaw != null
          ? mapsCompassYawToPlayerYaw(draft.pose.yaw)
          : 0;
      const lookPitch =
        draft.pose.pitch != null
          ? THREE.MathUtils.degToRad(draft.pose.pitch)
          : 0;
      this.player.setLook(lookYaw, lookPitch);

      this.zombiesRoomContracts.set(pack.world.id, {
        walkableBounds: walkable.bake.bounds.clone(),
        anchor: spawn.clone(),
        floorY: walkable.bake.footY,
      });
      const routeBySpawnId = new Map(
        walkable.spawnRoutes.map((route) => [route.spawnId, route] as const),
      );
      this.zombies.horde.setMapsFullMapPursuit(true);
      this.zombies.horde.configureSpawnPoints(
        this.zombies.arena.anchors.spawnPoints.map((spawnPoint) => {
          const route = routeBySpawnId.get(spawnPoint.id);
          return {
            ...spawnPoint,
            roomId: pack.world.id,
            outsidePosition: route?.outside.clone(),
            landingPosition: route?.landing.clone(),
          };
        }),
      );
      this.zombies.horde.setEntryTarget(spawn);
      this.zombies.horde.configureCampusNavigation(
        [
          {
            id: pack.world.id,
            anchor: spawn.clone(),
            walkableBounds: walkable.bake.bounds.clone(),
          },
        ],
        [],
        walkable.surface,
        this.mapsOutbreakContainment,
      );
      this.zombiesSplatFrameOwner = pack.world.id;

      // Overlap prop attach with spawn-view RAD warm + starter FP kit.
      this.ui.updateLoading(0.62, 'Seating arena machines and painting first view');
      MintWorldLayer.setGlobalCutVolumes([]);
      MintWorldLayer.setGlobalTrimPlanes([]);
      MintWorldLayer.setRenderOwners(pack.world.id);
      MintWorldLayer.ensureLiveSparkCamera();

      this.telemetry.begin('maps.warm');
      const warmPromise = (async (): Promise<void> => {
        const pagerAttached = await layer.waitForPagerAttached(5_000);
        if (!pagerAttached) {
          throw new Error(
            'Maps Outbreak splat pager failed to attach before play.',
          );
        }
        if (!layer.markWarmedIfResident()) {
          const eye = spawn.clone();
          eye.y += 1.62;
          const warmQuaternion = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(lookPitch, lookYaw, 0, 'YXZ'),
          );
          const warmed = await layer.warmPagedView(
            eye,
            warmQuaternion,
            12_000,
            undefined,
            { stealLodCamera: true, publishDisplayMapping: true },
          );
          if (!warmed && !layer.markWarmedIfResident()) {
            throw new Error(
              `Maps Outbreak splat did not become resident before play: ${JSON.stringify(layer.diagnostics())}`,
            );
          }
        }
      })();

      const machinesPromise = this.zombies.arena.attachMintMachines(
        this.assets,
        (completed, total, artifactId) => {
          const ratio = total > 0 ? completed / total : 1;
          this.ui.updateLoading(
            0.62 + ratio * 0.12,
            `Loading prop ${artifactId} (${completed}/${total})`,
          );
        },
        { concurrency: 4 },
      );

      const [machineResult] = await Promise.all([
        machinesPromise,
        warmPromise,
        viewAssetsPromise,
      ]);
      this.telemetry.end('maps.warm', 'resident');

      if (
        !this.assets.visibleFallbacksAllowed &&
        machineResult.failures.length > 0
      ) {
        throw new Error(
          `Maps Outbreak props failed to load: ${machineResult.failures.join(', ')}`,
        );
      }

      MintWorldLayer.ensureLiveSparkCamera();
      layer.setRenderState('primary');
      layer.setVisible(true);
      MintWorldLayer.setRenderOwners(pack.world.id);
      this.zombiesSplatFrameOwner = pack.world.id;
      this.zombiesSplatOwnershipDirty = true;

      MintWorldLayer.applyQualityTier(this.persistence.state.settings.quality);
      this.telemetry.begin('maps.shader-compile');
      void this.renderer
        .compileAsync(this.scene, this.camera)
        .then(() => this.telemetry.end('maps.shader-compile'))
        .catch((error) => {
          this.telemetry.end('maps.shader-compile', 'skipped');
          console.warn('Maps Outbreak shader compile skipped.', error);
        });

      this.ui.updateLoading(0.92, 'Equipping first-person gun and knife');
      await this.ensureMapsOutbreakViewmodelReady();

      this.zombiesPlayspaceReady = true;
      this.telemetry.end('maps.first-playable', draft.title);
      this.telemetry.end('maps.deploy', draft.title);
      this.ui.updateLoading(1, 'Maps Outbreak ready');
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      this.mode = 'maps-zombies';
      this.loadingTarget = null;
      this.applySettings();
      this.weaponView.setVisible(true);
      this.input.setGameplayEnabled(true);
      this.ui.setMode('maps-zombies');
      this.ui.setPointerPrompt(true);
      this.audio.deploy();
      this.ui.caption(
        `Maps Outbreak // ${draft.title} · ${walkable.bake.areaSquareMetres.toFixed(0)} m² nav`,
      );
      if (this.playMode === 'maps-zombies') {
        this.zombies.start(this.scene);
      }
      // Secondary wall-buy weapons are not needed for the opening frame.
      void this.ensureZombiesSecondaryAssets().catch((error) => {
        console.warn('Optional Maps Outbreak weapon prefetch failed.', error);
      });
    } catch (error) {
      this.telemetry.end('maps.first-playable', 'failed');
      this.telemetry.end('maps.deploy', 'failed');
      const message =
        error instanceof Error ? error.message : 'Maps Outbreak deploy failed';
      this.ui.showLoadingError(message);
      console.error('Maps Outbreak deployment failed.', error);
    }
  }

  private async deployZombiesAsync(): Promise<void> {
    this.playMode = 'zombies';
    this.applySceneAtmosphere('zombies');
    this.teardownZombies();
    this.loadingTarget = 'zombies';
    // Drop any in-flight Operations RAD so the hub pager is not competing for
    // the shared Spark page pool / fetcher threads. Also drop a prior Maps
    // Outbreak RAD so campus ownership/cuts are not mixed with Street View.
    this.disposeOperationsMintWorlds();
    if (this.mintWorldLayers.has('world-maps-outbreak')) {
      this.disposeZombiesMintWorlds();
      this.zombiesPrefetchStarted = false;
    }
    MintWorldLayer.ensureLiveSparkCamera();
    this.zombiesPlayspaceReady = false;
    this.zombiesSplatBounds = null;
    this.zombiesPlayableBounds = null;
    this.previousZombiesLastStand = false;
    this.zombiesSplatCompletion.clear();
    this.mode = 'loading';
    this.zombiesActive = true;
    // Facility meshes stay off the Zombies render/compile path; the splat
    // campus owns the playspace.
    this.world.hideFacilityRoots();
    this.physics.setFacilityCollidersEnabled(false);
    this.setMintWorldVisibility('zombies');
    this.splatCampus.setVisible(false);
    this.zombiesCampus.setVisible(false);
    this.enemies.enemies.forEach((enemy) => {
      enemy.group.visible = false;
    });
    this.weaponView.setVisible(false);
    this.input.setGameplayEnabled(false);
    this.hasLockedOnce = false;
    this.fixedAccumulator = 0;
    this.footstepTimer = 0;
    this.spawnProtectionRemaining = SPAWN_PROTECTION_SECONDS;
    this.weapon.setZombiesStarter();
    this.zombies.setCallbacks({
      grantWeapon: (weaponId, ammoOnly) =>
        this.weapon.grantWeapon(weaponId as import('../data/weapons').WeaponId, ammoOnly),
      refillAllAmmo: () => this.weapon.refillAllAmmo(),
      upgradeWeapon: (_weaponId) => this.weapon.upgradeHeldWeapon(),
      getHeldWeaponId: () => this.weapon.current.id,
      onRoundStart: (round) => {
        this.audio.zombiesRoundStart(round);
        this.ui.caption(`Round ${round}`);
      },
      onPurchase: () => this.audio.zombiesPurchase(),
      onPowerOn: () => {
        this.audio.zombiesPowerOn();
        this.ui.caption('Facility power restored');
      },
      onBoxSpin: () => this.audio.zombiesBoxSpin(),
      onPowerUp: () => this.audio.zombiesPowerUp(),
      onZombieAttack: () => {
        this.audio.zombiesAttack();
        this.ui.flashDamage();
      },
      onZombieDeath: () => this.audio.zombiesDeath(),
      onGameOver: (result) => this.failZombies(result),
    });
    this.zombies.horde.setVisibleFallbacksAllowed(
      this.assets.visibleFallbacksAllowed,
    );
    this.hordeMintFactory();
    this.ui.setMode('loading');
    this.ui.updateLoading(0.03, 'Preparing containment deployment');

    let rooms: Array<{ id: string; layer: MintWorldLayer }>;
    let roomStream: ZombiesWorldStream;
    try {
      this.telemetry.begin('zombies.deploy');
      this.telemetry.begin('zombies.first-room-ready');
      roomStream = this.beginZombiesMintWorldStream((completed, total, label) => {
        const ratio = total > 0 ? completed / total : 1;
        this.ui.updateLoading(
          0.3 + ratio * 0.38,
          `${label} // room ${Math.min(Math.floor(completed) + 1, total)}/${total}`,
        );
      });
      this.ui.updateLoading(0.08, 'Opening start-room containment stream');
      // Audio is non-blocking for first playable. View assets (arms/gun/knife)
      // stay on the gate so the first frame has a usable weapon presentation.
      void this.ensureZombiesAudio();
      const [firstRoom] = await Promise.all([
        roomStream.firstReady,
        this.ensureZombiesViewAssets(),
      ]);
      // Horde models warm while layout/machines finish; round 1 still has them
      // before the first spawn interval fires in practice.
      void this.ensureZombiesHordeAssets();
      rooms = [{ id: firstRoom.world.id, layer: firstRoom.layer }];
      this.telemetry.end('zombies.first-room-ready', firstRoom.world.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown containment loading failure';
      this.ui.showLoadingError(message);
      console.error('Zombies deployment failed before readiness.', error);
      return;
    }

    const fallbackBounds = new THREE.Box3(
      new THREE.Vector3(-12, -1, -2),
      new THREE.Vector3(22, 4, 40),
    );

    if (rooms.length > 0) {
      if (!this.zombiesNavigationSurface.validation.runtimeSafe) {
        const message = `Zombies splat layout is structurally invalid: ${this.zombiesNavigationSurface.validation.errors.join('; ')}`;
        this.ui.showLoadingError(message);
        console.error('Zombies deployment failed layout validation.', message);
        return;
      }
      for (const room of rooms) {
        this.configureZombiesRoomLayer(room.id, room.layer);
      }
      this.ui.updateLoading(0.735, 'Aligning full-room source colliders');

      this.zombiesSplatCompletion.buildFromSurface(
        this.zombiesNavigationSurface,
      );
      this.zombiesCampus.buildFromSurface(
        this.zombiesNavigationSurface,
        this.physics,
        this.scene,
      );
      this.zombiesCampus.setVisible(true);

      const startRoom = this.zombiesNavigationSurface.startRoom();
      const floorY = startRoom.floorY;
      const playable = startRoom.bounds.clone();
      const splatUnion = new THREE.Box3();
      for (const room of rooms) {
        room.layer.root.updateMatrixWorld(true);
        const visual = new THREE.Box3().setFromObject(room.layer.root);
        splatUnion.union(!visual.isEmpty() ? visual : room.layer.bounds);
      }
      this.zombiesSplatBounds = !splatUnion.isEmpty()
        ? splatUnion
        : playable.clone();
      this.zombiesPlayableBounds = this.zombiesNavigationSurface.rooms.reduce(
        (union, room) => union.union(room.bounds),
        new THREE.Box3(),
      );
      for (const connector of this.zombiesNavigationSurface.connectors) {
        this.zombiesPlayableBounds.union(connector.bounds);
      }

      // Establish the compact hub layout first, then author the actual
      // six-room distribution. The relay system makes each isolated RAD room
      // playable, so concentrating every reward in the start room defeats the
      // campus route and leaves five finished rooms without decisions.
      const hubPlayable = startRoom.bounds.clone();
      hubPlayable.min.y = floorY - 0.5;
      hubPlayable.max.y = floorY + 3.8;
      this.zombies.arena.fitLayoutToBounds(hubPlayable, floorY);
      this.zombies.arena.distributeAcrossRooms(
        this.zombiesNavigationSurface.rooms,
      );
      const authoredEntrySockets =
        this.zombiesNavigationSurface.allWallCrawlSockets();
      this.zombies.arena.useAuthoredDoorEntries(authoredEntrySockets);
      this.ui.updateLoading(0.75, 'Analyzing object-to-splat surfaces');
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const surfacePlacement =
        this.zombies.arena.seatAnchorsOnSurfaces(
          this.zombiesNavigationSurface.rooms,
          (roomId, requests) => {
            // The connected campus uses its audited navigation polygons as
            // the stable placement contract. Rebuilding six dense collider
            // BVHs here added several minutes to every deployment and is
            // redundant once the concourse/layout has passed release
            // validation; the arena's analyzer fallback seats the same wall
            // and floor requests deterministically.
            if (this.zombiesNavigationSurface.validation.releaseReady) {
              return new Map();
            }
            return (
              this.mintWorldLayers
                .get(roomId)
                ?.nearestColliderSurfaces(requests) ?? new Map()
            );
          },
        );
      if (surfacePlacement.failures.length > 0) {
        throw new Error(
          `Splat surface placement failed: ${surfacePlacement.failures.join(', ')}`,
        );
      }
      const placementValidation = validateZombiesPlacementLayout(
        ZOMBIES_PLACEMENT_LAYOUT,
        this.zombiesNavigationSurface.rooms.map((room) => room.source.id),
      );
      if (!placementValidation.valid) {
        throw new Error(
          `Zombies placement layout is invalid: ${placementValidation.errors.join('; ')}`,
        );
      }
      const ignoredPlacements = this.zombies.arena.applyPlacementLayout(
        ZOMBIES_PLACEMENT_LAYOUT,
      );
      if (ignoredPlacements.length > 0) {
        throw new Error(
          `Zombies placement layout contains unknown anchors: ${ignoredPlacements.join(', ')}`,
        );
      }
      this.zombies.arena.resolveProgressionInteractionAnchors(
        this.zombiesNavigationSurface,
      );
      this.ui.updateLoading(0.79, 'Splat surface placement verified');
      this.arenaBuildZombies({ skipWorldBoundary: true, compactRooms: true });
      this.zombies.arena.setBlockoutVisible(false);
      // Navigation edges and source geometry define the campus. Do not wrap
      // the connected splats in the old global playable-area AABB.
      this.physics.clearWorldBoundary();
      const fittedSpawn = this.zombies.arena.anchors.playerStart.clone();
      fittedSpawn.y = floorY + 0.98;
      this.player.reset(fittedSpawn);
      this.player.configurePlayableArea(playable, fittedSpawn, 0.85);
      this.player.configureSplatContainment(
        this.zombiesContainment,
        fittedSpawn,
      );
    } else {
      this.zombiesPlayableBounds = fallbackBounds.clone();
      this.arenaBuildZombies({ skipWorldBoundary: false, compactRooms: false });
      const spawn = this.zombies.arena.anchors.playerStart.clone();
      this.physics.setWorldBoundary(fallbackBounds, 0.5);
      this.player.reset(spawn);
      this.player.configurePlayableArea(fallbackBounds, spawn, 0.8);
    }

    const startRoomId = this.zombiesNavigationSurface.layout.startRoomId;
    this.ui.updateLoading(0.82, 'Seating start-room interactables');
    // Placeholders are already interactive. Mint machine GLBs stream after the
    // mode opens so they never block first playable or contend with hub RAD.
    void this.zombies.arena
      .attachMintMachines(
        this.assets,
        undefined,
        { roomIds: new Set([startRoomId]), concurrency: 4 },
      )
      .then((machineResult) => {
        if (
          !this.assets.visibleFallbacksAllowed &&
          machineResult.failures.length > 0
        ) {
          console.warn(
            `Containment props failed after open: ${machineResult.failures.join(', ')}`,
          );
        }
        return this.zombies.arena.attachMintMachines(this.assets, undefined, {
          concurrency: 3,
        });
      })
      .catch((error) => {
        console.warn('Background containment machine attach failed.', error);
      });
    this.prefetchRemainingZombiesAudio();
    this.configureZombiesHordeNavigation();
    this.zombiesRoomTransit.configure(
      this.zombiesNavigationSurface,
      this.scene,
      {
        powerSwitch: {
          roomId:
            this.zombies.arena.getAnchorRoom('power-switch') ??
            this.zombiesNavigationSurface.layout.startRoomId,
          position: this.zombies.arena.anchors.powerSwitchInteraction,
        },
        doors: this.zombies.arena.anchors.doors.map((door) => ({
          id: door.id,
          roomId:
            this.zombies.arena.getAnchorRoom(door.id) ??
            this.zombiesNavigationSurface.layout.startRoomId,
          position: door.interactionPosition ?? door.position,
        })),
      },
    );
    this.ui.updateLoading(0.96, 'Baking active full-room collision');
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    // Every sequential RAD must be registered with the shared pager before
    // play opens. Page detail remains demand-driven from the live camera, so
    // this bounded gate adds metadata/root readiness without serially sorting
    // twelve hidden doorway views during deployment.
    await roomStream.allReady;
    this.ui.updateLoading(0.975, 'Registering sequential room streams');
    this.zombiesSplatOwnershipDirty = true;
    MintWorldLayer.applyQualityTier(
      this.persistence.state.settings.quality,
    );
    // Climb into the full 2.5M high delivery budget after the opening frames.
    MintWorldLayer.beginDeliveryLodRamp(250_000, 1800);
    this.completeZombiesSplatFrame(this.player.position);
    // Compile in the background — first playable does not need a full scene
    // compile stall when Spark materials are already warm from the hub load.
    this.telemetry.begin('zombies.shader-compile');
    void this.renderer
      .compileAsync(this.scene, this.camera)
      .then(() => this.telemetry.end('zombies.shader-compile'))
      .catch(() => this.telemetry.end('zombies.shader-compile'));
    const crawlSockets = new Map(
      this.zombiesNavigationSurface
        .allWallCrawlSockets()
        .map((socket) => [socket.id, socket] as const),
    );
    this.zombies.horde.configureSpawnPoints(
      this.zombies.arena.anchors.spawnPoints.map((spawn) => {
        const socket = crawlSockets.get(spawn.id);
        const roomId =
          socket?.roomId ??
          this.zombiesNavigationSurface.roomIdForPosition(
            spawn.position,
            0.12,
          ) ??
          undefined;
        return {
          ...spawn,
          roomId,
          ...(socket
            ? {
                position: socket.opening,
                barrierId: socket.barrierId,
                outsidePosition: socket.outside,
                landingPosition: socket.landing,
              }
            : {}),
        };
      }),
    );
    // Seed every authored clip before the first ownership tick so free fringe
    // planes (and doorway cuts) punch splat voxels from the opening frame.
    // Keep door OBBs on the sill so thick floor gaussians are never discarded.
    reseatCutsAboveFloor(
      this.zombiesNavigationSurface.layout.cutVolumes ?? [],
      (roomId) => {
        const room = this.zombiesNavigationSurface.room(roomId);
        return room ? room.floorY : null;
      },
    );
    MintWorldLayer.setGlobalCutVolumes(
      (this.zombiesNavigationSurface.layout.cutVolumes ?? []).filter(
        (cut) => cut.enabled,
      ),
    );
    MintWorldLayer.setGlobalTrimPlanes(
      (this.zombiesNavigationSurface.layout.trimPlanes ?? []).filter(
        (trim) => trim.enabled,
      ),
    );
    this.zombiesSplatClipKey = '';
    // Refuse to open on a resident-but-black frame (owner filter / mapping lag).
    this.ui.updateLoading(0.99, 'Compositing hub splat frame');
    try {
      await this.ensureZombiesHubFirstFrameReady();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Hub splat failed to paint before play.';
      this.ui.showLoadingError(message);
      console.error('Zombies hub paint gate failed.', error);
      return;
    }
    // Open the playspace before horde GLB decode finishes. Round 1 starts
    // immediately after, so we still await presentation before spawning.
    this.zombiesPlayspaceReady = true;
    this.telemetry.end('zombies.deploy');
    void roomStream.allReady.then((readyRooms) => {
      this.telemetry.instant(
        'zombies.background-stream-complete',
        `${readyRooms.length}/${this.assets.listWorlds('zombies').length}`,
      );
      if (!this.isZombiesPlayMode()) return;
      this.refreshZombiesPortalResidency();
      this.configureZombiesHordeNavigation();
      void this.ensureZombiesSecondaryAssets().catch((error) => {
        console.warn('Optional Zombies weapon prefetch failed.', error);
      });
      if (this.isZombiesHudMode() && readyRooms.length > 1) {
        this.ui.caption(
          `Containment stream complete // ${readyRooms.length} arenas resident`,
        );
      }
    });
    this.ui.updateLoading(1, 'Containment campus ready');
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    this.mode = 'zombies';
    this.loadingTarget = null;
    // Re-apply quality so Zombies-specific DPR/shadow caps bind after mode flip.
    this.applySettings();
    this.weaponView.setVisible(true);
    this.input.setGameplayEnabled(true);
    this.ui.setMode('zombies');
    this.ui.setPointerPrompt(true);
    this.audio.deploy();
    const roomCount = this.mintZombiesRoomIds.length;
    const expectedRoomCount = this.assets.listWorlds('zombies').length;
    this.ui.caption(
      roomCount < expectedRoomCount
        ? `Containment breach // ${roomCount}/${expectedRoomCount} arenas ready, streaming adjacent rooms`
        : roomCount > 1 && this.zombiesNavigationSurface.validation.releaseReady
          ? `Containment breach // ${roomCount} arenas / ${this.zombiesCampus.connectorCount} links`
          : roomCount > 1
            ? `Disconnected campus fallback // follow the room navigator`
            : 'Containment breach // Survive the rounds',
    );
    await this.ensureZombiesHordeAssets();
    if (this.isZombiesPlayMode()) {
      this.zombies.start(this.scene);
    }
  }

  private configureZombiesHordeNavigation(): void {
    this.zombies.horde.configureCampusNavigation(
      this.mintZombiesRoomIds.flatMap((id) => {
        const room = this.zombiesRoomContracts.get(id);
        if (!room) return [];
        return [{
          id,
          anchor: room.anchor,
          walkableBounds: room.walkableBounds,
        }];
      }),
      this.zombiesSplatCompletion.portals,
      this.zombiesNavigationSurface,
      this.zombiesContainment,
    );
  }

  private async prefetchZombiesDeployment(): Promise<void> {
    if (this.zombiesPrefetchStarted) return;
    this.zombiesPrefetchStarted = true;
    this.telemetry.begin('zombies.intent-prefetch');
    // Ops RAD is delayed, so the shared Spark pager is free for the hub during
    // menu time. The real paged RAD stream starts now, behind the Operations
    // screen, so metadata/chunk decode/GPU upload overlap player dwell time.
    void this.beginZombiesMintWorldStream();
    await Promise.allSettled([
      this.ensureZombiesAudio(),
      this.ensureZombiesViewAssets(),
      this.ensureZombiesHordeAssets(),
    ]);
    this.telemetry.end('zombies.intent-prefetch');
  }

  /** Portal-graph neighbors for a room (cut/trim doorways, not compositor). */
  private zombiesPortalAdjacentRoomIds(roomId: string): string[] {
    const ids = new Set<string>();
    for (const portal of this.zombiesNavigationSurface.portals) {
      if (portal.source.fromRoomId === roomId) {
        ids.add(portal.source.toRoomId);
      } else if (portal.source.toRoomId === roomId) {
        ids.add(portal.source.fromRoomId);
      }
    }
    return [...ids];
  }

  /**
   * Stream rooms in portal BFS order from the hub so doorway destinations
   * attach and soft-warm before far-loop rooms.
   */
  private zombiesStreamOrderIndexes(
    worlds: MintWorldRecord[],
    startIndex: number,
  ): number[] {
    const startId = worlds[startIndex]?.id;
    if (!startId) return [];
    const idToIndex = new Map(
      worlds.map((world, index) => [world.id, index] as const),
    );
    const ordered: number[] = [];
    const seen = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const roomId = queue.shift()!;
      for (const neighborId of this.zombiesPortalAdjacentRoomIds(roomId)) {
        if (seen.has(neighborId)) continue;
        seen.add(neighborId);
        queue.push(neighborId);
        const index = idToIndex.get(neighborId);
        if (index !== undefined) ordered.push(index);
      }
    }
    for (let index = 0; index < worlds.length; index += 1) {
      if (index !== startIndex && !seen.has(worlds[index]!.id)) {
        ordered.push(index);
      }
    }
    return ordered;
  }

  private ensureZombiesAudio(): Promise<void> {
    if (!this.zombiesAudioPromise) {
      this.telemetry.begin('zombies.audio');
      // Critical path: only the cues needed for the opening round. Remaining
      // Mint audio fills in after first playable.
      this.zombiesAudioPromise = this.audio
        .prepareCriticalMintAudio([
          'audio-zombies-round-start',
          'audio-zombies-attack',
          'audio-zombies-purchase',
          'audio-zombies-power-on',
          'audio-zombies-powerup-grab',
          'audio-zombies-box-spin',
          'audio-deploy',
          'audio-ui',
        ])
        .then(() => {
          this.telemetry.end('zombies.audio');
        })
        .catch((error) => {
          this.zombiesAudioPromise = null;
          throw error;
        });
    }
    return this.zombiesAudioPromise;
  }

  private prefetchRemainingZombiesAudio(): void {
    void this.audio.prepareMintAudio().catch((error) => {
      console.warn('Background Mint audio prefetch failed.', error);
    });
  }

  private ensureZombiesViewAssets(): Promise<void> {
    if (!this.zombiesViewAssetsPromise) {
      this.telemetry.begin('zombies.view-assets');
      this.zombiesViewAssetsPromise = this.preloadZombiesViewAssets()
        .then(() => {
          this.telemetry.end('zombies.view-assets');
        })
        .catch((error) => {
          this.zombiesViewAssetsPromise = null;
          throw error;
        });
    }
    return this.zombiesViewAssetsPromise;
  }

  private ensureZombiesHordeAssets(): Promise<void> {
    if (!this.zombiesHordeAssetsPromise) {
      this.telemetry.begin('zombies.horde-assets');
      this.zombiesHordeAssetsPromise = this.preloadZombiesHordeAssets()
        .then(() => {
          this.telemetry.end('zombies.horde-assets');
        })
        .catch((error) => {
          this.zombiesHordeAssetsPromise = null;
          throw error;
        });
    }
    return this.zombiesHordeAssetsPromise;
  }

  private async preloadZombiesViewAssets(): Promise<void> {
    // Install into the live viewmodel — a throwaway instantiateModel() decode
    // does not attach meshes to the camera, so play could open gunless.
    await this.weaponView.ensureMintWeaponReady(this.weapon.current);
    if (
      !this.weaponView.hasEquippedWeaponModel ||
      this.weaponView.weaponMeshCount <= 0 ||
      !this.weaponView.armsVisible
    ) {
      throw new Error('Required Zombies first-person gun/arms failed to attach');
    }
  }

  /** Force the equipped Mint FP kit after starter weapon swaps / cached preloads. */
  private async ensureMapsOutbreakViewmodelReady(): Promise<void> {
    this.zombiesViewAssetsPromise = null;
    await this.weaponView.ensureMintWeaponReady(this.weapon.current);
    this.weaponView.setVisible(true);
    if (
      !this.weaponView.hasEquippedWeaponModel ||
      this.weaponView.weaponMeshCount <= 0 ||
      !this.weaponView.armsVisible
    ) {
      throw new Error(
        `Maps Outbreak viewmodel incomplete // weaponMeshes=${this.weaponView.weaponMeshCount} arms=${this.weaponView.armsVisible}`,
      );
    }
  }

  private async preloadZombiesHordeAssets(): Promise<void> {
    const requiredSemantics = [
      'idle',
      'walk_forward',
      'run_forward',
      'attack',
      'stagger',
      'defeat',
    ];
    const [walker, walkerClips] = await Promise.all([
      this.assets.instantiateModel('zombie-walker'),
      this.assets.loadRoleAnimationSet('animation-zombie-horde', 'walker'),
    ]);
    if (!walker) {
      throw new Error('Required zombie model failed to decode');
    }
    const missingClips = requiredSemantics
      .filter((semantic) => !walkerClips[semantic])
      .map((semantic) => `walker:${semantic}`);
    if (missingClips.length > 0) {
      throw new Error(`Required zombie animations missing: ${missingClips.join(', ')}`);
    }
  }

  private ensureZombiesSecondaryAssets(): Promise<void> {
    if (!this.zombiesSecondaryAssetsPromise) {
      this.telemetry.begin('zombies.secondary-assets');
      this.zombiesSecondaryAssetsPromise = Promise.all(
        WEAPONS.filter((weapon) => weapon.id !== 'aegis-p11').map((weapon) =>
          this.assets.instantiateModel(`weapon-${weapon.id}`),
        ),
      )
        .then((models) => {
          const missing = WEAPONS.filter(
            (weapon) => weapon.id !== 'aegis-p11',
          ).filter((_weapon, index) => !models[index]);
          this.telemetry.end(
            'zombies.secondary-assets',
            missing.length > 0 ? `missing:${missing.length}` : 'ready',
          );
        })
        .catch((error) => {
          this.zombiesSecondaryAssetsPromise = null;
          throw error;
        });
    }
    return this.zombiesSecondaryAssetsPromise;
  }

  private getZombiesCampusWaypoints(): Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    z: number;
    index: number;
  }> {
    if (!this.isZombiesPlayMode() || !this.zombiesPlayspaceReady) return [];
    const floorY =
      (this.zombiesPlayableBounds?.min.y ?? this.player.position.y - 1.48) + 0.5;
    return this.mintZombiesRoomIds.map((id, index) => {
      const layer = this.mintWorldLayers.get(id);
      if (!layer) {
        return { id, label: id, x: 0, y: floorY + 0.98, z: 0, index };
      }
      const contract = this.zombiesRoomContracts.get(id);
      layer.recomputeBounds();
      const center =
        contract?.anchor.clone() ??
        layer.bounds.getCenter(new THREE.Vector3());
      const label =
        (layer.root.name.replace(/^mint-world-/, '') || id).replace(
          /^world-zombies-arena-?/,
          '',
        ) || 'hub';
      return {
        id,
        label,
        x: center.x,
        y: floorY + 0.98,
        z: center.z,
        index,
      };
    });
  }

  private getZombiesHubResidency(): {
    roomId: string;
    rootPageResident: boolean;
    rootPageWarmed: boolean;
    activeSplats: number;
    pagerAttached: boolean;
    lodTreeRegistered: boolean;
    renderState: string;
  } | null {
    const roomId = this.mintZombiesRoomIds[0] ?? 'world-zombies-arena';
    const layer = this.mintWorldLayers.get(roomId);
    if (!layer) return null;
    const splat = layer.diagnostics();
    return {
      roomId,
      rootPageResident: splat.rootPageResident,
      rootPageWarmed: splat.rootPageWarmed,
      activeSplats: splat.activeSplats,
      pagerAttached: splat.pagerAttached,
      lodTreeRegistered: splat.lodTreeRegistered,
      renderState: splat.renderState,
    };
  }

  private getZombiesWalkProbe(): {
    timestamp: number;
    roomId: string | null;
    frameOwner: string | null;
    containmentRoomId: string | null;
    player: { x: number; y: number; z: number; yaw: number; pitch: number };
    containment: {
      signedDistance: number;
      recoveries: number;
      inMesh: boolean;
    };
    collisions: { labels: string[]; maxCount: number };
    nav: {
      areaSquareMetres: number;
    };
    splat: {
      rootPageResident: boolean;
      rootPageWarmed: boolean;
      activeSplats: number;
      renderState: string | null;
    };
    issueCode:
      | 'OK'
      | 'RAD-DARK'
      | 'NAV-CLIP'
      | 'PHYS-BLOCK'
      | 'OWNER-STUCK'
      | 'UNKNOWN';
  } {
    const roomId =
      this.zombiesContainment.roomId('player') ??
      this.currentZombiesRoomId();
    const position = this.player.position;
    const capsuleRadius = 0.34;
    const inMesh = roomId
      ? this.zombiesNavigationSurface.containsCapsuleInRoom(
          roomId,
          position,
          capsuleRadius,
        )
      : this.zombiesNavigationSurface.containsCapsule(position, capsuleRadius);
    const signedDistance = roomId
      ? this.zombiesNavigationSurface.signedDistanceForRoom(
          roomId,
          position,
          capsuleRadius,
        )
      : this.zombiesNavigationSurface.signedDistance(position, capsuleRadius);
    const collisions = this.physics
      .diagnostics()
      .characterCollisions.map((collision) => collision.label);
    const layer = roomId ? this.mintWorldLayers.get(roomId) : null;
    const splat = layer?.diagnostics() ?? null;
    const bakeRoom = this.zombiesNavigationSurface
      .navigationDiagnostics()
      .rooms.find((entry) => entry.id === roomId);
    let issueCode:
      | 'OK'
      | 'RAD-DARK'
      | 'NAV-CLIP'
      | 'PHYS-BLOCK'
      | 'OWNER-STUCK'
      | 'UNKNOWN' = 'OK';
    if (splat && !splat.rootPageResident && splat.activeSplats <= 0) {
      issueCode = 'RAD-DARK';
    } else if (!inMesh) {
      issueCode = 'NAV-CLIP';
    } else if (
      collisions.some((label) => {
        // Nav / portal pads are intentional ground contact. Only treat them as
        // a block when the contact normal is not floor-like (a curb/wall).
        if (
          !label.includes('navigation-floor') &&
          !label.includes('portal-floor')
        ) {
          return false;
        }
        const hit = this.physics
          .diagnostics()
          .characterCollisions.find((entry) => entry.label === label);
        return Boolean(hit && Math.abs(hit.normal.y) < 0.55);
      })
    ) {
      issueCode = 'PHYS-BLOCK';
    } else if (
      this.zombiesSplatFrameOwner &&
      roomId &&
      this.zombiesSplatFrameOwner !== roomId
    ) {
      issueCode = 'OWNER-STUCK';
    }
    return {
      timestamp: Date.now(),
      roomId,
      frameOwner: this.zombiesSplatFrameOwner,
      containmentRoomId: this.zombiesContainment.roomId('player'),
      player: {
        x: position.x,
        y: position.y,
        z: position.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
      },
      containment: {
        signedDistance,
        recoveries: this.player.recoveryCount,
        inMesh,
      },
      collisions: {
        labels: collisions,
        maxCount: collisions.length,
      },
      nav: {
        areaSquareMetres: bakeRoom?.areaSquareMetres ?? 0,
      },
      splat: {
        rootPageResident: splat?.rootPageResident ?? false,
        rootPageWarmed: splat?.rootPageWarmed ?? false,
        activeSplats: splat?.activeSplats ?? 0,
        renderState: splat?.renderState ?? null,
      },
      issueCode,
    };
  }

  private getZombiesCampusFloorPlan(): Array<{
    id: string;
    index: number;
    floorY: number;
    bounds: {
      min: { x: number; z: number };
      max: { x: number; z: number };
    };
    corners: Array<{
      name: 'north-west' | 'north-east' | 'south-east' | 'south-west';
      x: number;
      y: number;
      z: number;
    }>;
  }> {
    return this.mintZombiesRoomIds.flatMap((id, index) => {
      const contract = this.zombiesRoomContracts.get(id);
      if (!contract) return [];
      const { walkableBounds, floorY } = contract;
      const perimeter =
        this.zombiesNavigationSurface.perimeterCornerWaypoints(id);
      if (perimeter.length !== 4) return [];
      return [{
        id,
        index,
        floorY,
        bounds: {
          min: { x: walkableBounds.min.x, z: walkableBounds.min.z },
          max: { x: walkableBounds.max.x, z: walkableBounds.max.z },
        },
        corners: [
          { name: 'north-west', ...perimeter[0]! },
          { name: 'north-east', ...perimeter[1]! },
          { name: 'south-east', ...perimeter[2]! },
          { name: 'south-west', ...perimeter[3]! },
        ],
      }];
    });
  }

  /**
   * Completes every rendered frame with one owning RAD capture. The old campus
   * rendered all six large capture volumes at once; their fringes overlap by
   * tens of metres and create the blurry double-exposure visible in the audit.
   *
   * The nearest analyzed room owns the frame. At delivery quality, the next
   * portal room stays registered at zero opacity so its pages and sort are warm
   * before the physical seam is crossed; lower analysis budgets keep only one
   * room resident to avoid starving the owning source.
   */
  private completeZombiesSplatFrame(
    position: THREE.Vector3,
    selectNearest = false,
  ): void {
    // Spark's cleanup timeout is shorter than a worst-case software-WebGL
    // sort. Refresh every registered room from the game frame, not only from
    // the LoD worker, so the active owner cannot be collected mid-sort.
    MintWorldLayer.touchResidentPagers();
    MintWorldLayer.ensureLiveSparkCamera();

    // Maps Outbreak is a single Street View RAD. Never apply campus cuts,
    // doorway ownership, or multi-room prefetch to it.
    if (this.playMode === 'maps-zombies') {
      const mapsId = this.mintZombiesRoomIds[0] ?? null;
      const mapsLayer = mapsId ? this.mintWorldLayers.get(mapsId) : null;
      if (!mapsLayer || !mapsId) return;
      if (this.zombiesSplatClipKey !== 'maps:none') {
        MintWorldLayer.setGlobalCutVolumes([]);
        MintWorldLayer.setGlobalTrimPlanes([]);
        this.zombiesSplatClipKey = 'maps:none';
      }
      mapsLayer.setRenderState('primary');
      MintWorldLayer.setRenderOwners(mapsId);
      this.zombiesSplatFrameOwner = mapsId;
      this.zombiesSplatPrefetch = null;
      this.zombiesSplatPrefetchIds = [];
      this.zombiesActivePortalId = null;
      this.zombiesSplatOwnershipDirty = false;
      return;
    }

    // Connected campus keeps one visual owner. Neighbors warm via prefetch /
    // residency instead of competing as additional full-opacity primary RADs.
    this.camera.getWorldDirection(zombiesSplatLookDirection);
    const ownershipMovedSq =
      (position.x - this.zombiesSplatEvalPosition.x) ** 2 +
      (position.z - this.zombiesSplatEvalPosition.z) ** 2;
    const lookChanged =
      this.zombiesSplatEvalLook.dot(zombiesSplatLookDirection) < 0.94;
    const ownerStillPrimary =
      this.zombiesSplatFrameOwner !== null &&
      this.mintWorldLayers.get(this.zombiesSplatFrameOwner)
        ?.splatRenderState === 'primary';
    const canReuseOwnership =
      !selectNearest &&
      !this.zombiesSplatOwnershipDirty &&
      this.zombiesSplatAnalysisRoom === null &&
      ownerStillPrimary &&
      ownershipMovedSq < 0.75 * 0.75 &&
      !lookChanged;
    if (canReuseOwnership) {
      // Readiness can change while containment holds the player at a cold
      // seam. Refresh every frame so completed pager uploads open it without
      // requiring additional player movement or camera rotation.
      this.refreshZombiesPortalResidency();
      this.scheduleZombiesPredictiveWarm(
        this.zombiesSplatFrameOwner,
        this.zombiesSplatPrefetchIds.find(
          (id) =>
            !this.zombiesSplatPreload.isReady(
              zombiesSplatPreloadKey(this.zombiesSplatFrameOwner!, id),
            ),
        ) ?? null,
      );
      const readyPrefetch = this.zombiesSplatPrefetchIds.some((id) =>
        this.isZombiesSplatPortalPreloadReady(
          this.zombiesSplatFrameOwner!,
          id,
        ),
      );
      // A preload commonly becomes ready while the player is standing still
      // at the cut. Re-evaluate once so the visual aperture opens immediately
      // instead of waiting for another movement / look delta.
      if (this.zombiesActivePortalId || !readyPrefetch) return;
      this.zombiesSplatOwnershipDirty = true;
    }

    this.refreshZombiesPortalResidency();
    const rooms = this.mintZombiesRoomIds.flatMap((id, index) => {
      const layer = this.mintWorldLayers.get(id);
      const contract = this.zombiesRoomContracts.get(id);
      if (!layer || !contract) return [];
      const physicalCenter = contract.anchor;
      return [
        {
          id,
          index,
          layer,
          distanceSq:
            (position.x - physicalCenter.x) ** 2 +
            (position.z - physicalCenter.z) ** 2,
        },
      ];
    });
    if (rooms.length === 0) {
      this.zombiesSplatFrameOwner = null;
      this.zombiesSplatPrefetch = null;
      this.zombiesSplatPrefetchIds = [];
      this.zombiesActivePortalId = null;
      this.zombiesSplatOwnershipDirty = true;
      return;
    }

    rooms.sort((a, b) => a.distanceSq - b.distanceSq);
    const forced =
      this.zombiesSplatAnalysisRoom === null
        ? null
        : rooms.find((room) => room.index === this.zombiesSplatAnalysisRoom);
    const retainedOwner =
      !forced && !selectNearest
        ? rooms.find((room) => room.id === this.zombiesSplatFrameOwner)
        : null;
    const owner = forced ?? retainedOwner ?? rooms[0]!;
    const next = forced ? null : rooms[1];
    const ownerDistance = Math.sqrt(owner.distanceSq);
    const nextDistance = next ? Math.sqrt(next.distanceSq) : Infinity;
    // Cut cubes / trim planes remain the physical doorway apertures. The
    // frame-only completion pass may be armed once the destination is warm;
    // it fills capture gaps without changing physical player traversal.
    this.zombiesActivePortalId = null;
    const neighborIds = new Set(this.zombiesPortalAdjacentRoomIds(owner.id));
    const portalPrefetchIds = forced
      ? []
      : this.zombiesSplatCompletion.prefetchTargets(
          position,
          owner.id,
          ZOMBIES_PORTAL_PREFETCH_DISTANCE,
          {
            lookDirection: zombiesSplatLookDirection,
            limit: ZOMBIES_PORTAL_MAX_PREFETCH,
          },
        );
    const prefetchRoomIds: string[] = [];
    for (const id of portalPrefetchIds) {
      if (
        rooms.some((room) => room.id === id) &&
        !prefetchRoomIds.includes(id)
      ) {
        prefetchRoomIds.push(id);
      }
    }
    if (
      prefetchRoomIds.length < ZOMBIES_PORTAL_MAX_PREFETCH &&
      next &&
      nextDistance - ownerDistance < 4.5 &&
      neighborIds.has(next.id) &&
      !prefetchRoomIds.includes(next.id)
    ) {
      prefetchRoomIds.push(next.id);
    }
    for (const neighborId of neighborIds) {
      if (prefetchRoomIds.length >= ZOMBIES_PORTAL_MAX_PREFETCH) break;
      if (
        rooms.some((room) => room.id === neighborId) &&
        !prefetchRoomIds.includes(neighborId)
      ) {
        prefetchRoomIds.push(neighborId);
      }
    }
    const occupiedAuthoredConnector =
      this.zombiesAuthoredConnectorAt(position);
    if (occupiedAuthoredConnector) {
      const connectorNeighborId =
        occupiedAuthoredConnector.source.fromRoomId === owner.id
          ? occupiedAuthoredConnector.source.toRoomId
          : occupiedAuthoredConnector.source.toRoomId === owner.id
            ? occupiedAuthoredConnector.source.fromRoomId
            : null;
      if (connectorNeighborId && !prefetchRoomIds.includes(connectorNeighborId)) {
        prefetchRoomIds.unshift(connectorNeighborId);
        prefetchRoomIds.length = Math.min(
          prefetchRoomIds.length,
          ZOMBIES_PORTAL_MAX_PREFETCH,
        );
      }
    }
    // Immediately after a crossing the source room is already hot. Once the
    // player has moved away from that seam, prioritize the other exit so a
    // sequential room run warms forward instead of repeatedly paging behind.
    const previousOwner = this.zombiesPreviousSplatFrameOwner;
    if (previousOwner && !this.zombiesPreviousSplatSeamCleared) {
      const previousPortal = this.zombiesNavigationSurface.portals.find(
        (portal) =>
          (portal.source.fromRoomId === owner.id &&
            portal.source.toRoomId === previousOwner) ||
          (portal.source.toRoomId === owner.id &&
            portal.source.fromRoomId === previousOwner),
      );
      const ownerLanding = previousPortal
        ? this.zombiesNavigationSurface.portalLandingPoint(
            previousPortal.source.id,
            owner.id,
            0.34,
          )
        : null;
      if (
        ownerLanding &&
        this.zombiesNavigationSurface.containsCapsuleInRoom(
          owner.id,
          position,
          0.34,
        ) &&
        Math.hypot(
          position.x - ownerLanding.x,
          position.z - ownerLanding.z,
        ) > 14
      ) {
        this.zombiesPreviousSplatSeamCleared = true;
      }
    }
    if (
      previousOwner &&
      prefetchRoomIds[0] === previousOwner &&
      prefetchRoomIds.length > 1
    ) {
      const previousPortal = this.zombiesNavigationSurface.portalBetween(
        owner.id,
        previousOwner,
      );
      const ownerSocket = previousPortal
        ? this.zombiesNavigationSurface.portalApproachPoint(
            previousPortal.source.id,
            owner.id,
            0,
          ) ??
          (previousPortal.source.fromRoomId === owner.id
            ? previousPortal.from
            : previousPortal.to)
        : null;
      if (
        ownerSocket &&
        Math.hypot(
          position.x - ownerSocket.x,
          position.z - ownerSocket.z,
        ) > 14
      ) {
        prefetchRoomIds.shift();
        prefetchRoomIds.push(previousOwner);
      }
    }
    const prefetchRoomId = prefetchRoomIds[0] ?? null;
    // A room can expose two nearby exits (far-north is the important case).
    // Prefetch priority is a paging concern; it must not decide which visible
    // doorway receives the compositor. Evaluate every warm neighbor and pick
    // the nearest owner-side aperture that is actually in the current view.
    const portalCandidatesForOwner = (
      destinationIds: readonly string[],
      requirePreload: boolean,
    ) =>
      destinationIds
        .flatMap((destinationId) => {
          const portal = this.zombiesNavigationSurface.portalBetween(
            owner.id,
            destinationId,
          );
          if (!portal) return [];
          const aperture =
            this.zombiesNavigationSurface.portalPresentationPoint(
              portal.source.id,
              owner.id,
            ) ??
            (portal.source.fromRoomId === owner.id ? portal.from : portal.to);
          const distance = Math.hypot(
            position.x - aperture.x,
            position.z - aperture.z,
          );
          if (
            distance < ZOMBIES_PORTAL_MIN_COMPOSITE_DISTANCE ||
            distance > ZOMBIES_PORTAL_RENDER_DISTANCE ||
            (requirePreload &&
              !this.isZombiesSplatPortalPreloadReady(owner.id, destinationId)) ||
            !this.isZombiesPortalVisibleFromOwner(portal, owner.id, aperture)
          ) {
            return [];
          }
          return [{ portal, destinationId, distance }];
        })
        .sort((left, right) => left.distance - right.distance);
    const activePortalCandidate =
      portalCandidatesForOwner(prefetchRoomIds, true)[0] ?? null;
    // Owner-wall cutouts must arm even before the neighbor RAD is warm. Scan
    // every doorway from this room (not only prefetched destinations).
    const ownerDoorwayDestinationIds = this.zombiesNavigationSurface.portals
      .filter(
        (portal) =>
          portal.source.fromRoomId === owner.id ||
          portal.source.toRoomId === owner.id,
      )
      .map((portal) =>
        portal.source.fromRoomId === owner.id
          ? portal.source.toRoomId
          : portal.source.fromRoomId,
      );
    const cutPortalCandidate =
      portalCandidatesForOwner(ownerDoorwayDestinationIds, false)[0] ??
      activePortalCandidate;
    const activePortal = activePortalCandidate?.portal ?? null;
    this.zombiesActivePortalId =
      activePortal?.source.id ?? cutPortalCandidate?.portal.source.id ?? null;
    const activeAuthoredConnector =
      activePortal &&
      this.zombiesPortalLandingSpan(activePortal) >
        ZOMBIES_AUTHORED_CONNECTOR_MIN_SPAN
        ? activePortal
        : null;
    const strictlyOccupiedAuthoredConnector =
      this.zombiesAuthoredConnectorAt(position, false);

    // Facing a doorway arms (but does not yet latch) its connector. Latching
    // occurs only at the physical landing, so merely turning around near an
    // overlapping scan socket cannot expose the corridor through another
    // wall. Once latched, the connector survives folded/overlapping room
    // volumes until the player reaches the destination's interior approach.
    if (activeAuthoredConnector && !this.zombiesConnectorTraversalId) {
      if (
        this.zombiesConnectorPresentationCandidateId !==
        activeAuthoredConnector.source.id
      ) {
        this.zombiesConnectorTraversalId = null;
        this.zombiesConnectorTraversalState = 'armed-new-connector';
      }
      this.zombiesConnectorPresentationCandidateId =
        activeAuthoredConnector.source.id;
      this.zombiesConnectorPresentationCandidateOwnerId = owner.id;
    }
    if (
      this.zombiesConnectorPresentationCandidateId &&
      strictlyOccupiedAuthoredConnector?.source.id ===
        this.zombiesConnectorPresentationCandidateId
    ) {
      const candidateOwnerId =
        this.zombiesConnectorPresentationCandidateOwnerId;
      const candidateLanding = candidateOwnerId
        ? this.zombiesNavigationSurface.portalLandingPoint(
            this.zombiesConnectorPresentationCandidateId,
            candidateOwnerId,
            this.zombiesNavigationSurface.layout.largestActorCapsuleRadius,
          )
        : null;
      if (
        candidateLanding &&
        Math.hypot(
          position.x - candidateLanding.x,
          position.z - candidateLanding.z,
        ) <= ZOMBIES_CONNECTOR_TRAVERSAL_LATCH_DISTANCE
      ) {
        this.zombiesConnectorTraversalId =
          this.zombiesConnectorPresentationCandidateId;
        this.zombiesConnectorTraversalState = 'latched-at-source-landing';
      }
    }
    if (
      this.zombiesConnectorTraversalId &&
      strictlyOccupiedAuthoredConnector?.source.id !==
        this.zombiesConnectorTraversalId
    ) {
      this.zombiesConnectorTraversalId = null;
      this.zombiesConnectorTraversalState = `left-connector:${strictlyOccupiedAuthoredConnector?.source.id ?? 'none'}`;
      this.zombiesConnectorPresentationCandidateId = null;
      this.zombiesConnectorPresentationCandidateOwnerId = null;
    }
    if (
      this.zombiesConnectorTraversalId &&
      this.zombiesConnectorPresentationCandidateOwnerId &&
      owner.id !== this.zombiesConnectorPresentationCandidateOwnerId
    ) {
      const destinationApproach =
        this.zombiesNavigationSurface.portalApproachPoint(
          this.zombiesConnectorTraversalId,
          owner.id,
          1.4,
        );
      if (
        destinationApproach &&
        Math.hypot(
          position.x - destinationApproach.x,
          position.z - destinationApproach.z,
        ) <= ZOMBIES_CONNECTOR_TRAVERSAL_LATCH_DISTANCE
      ) {
        this.zombiesConnectorTraversalId = null;
        this.zombiesConnectorTraversalState = `released-at-destination:${owner.id}`;
        this.zombiesConnectorPresentationCandidateId = null;
        this.zombiesConnectorPresentationCandidateOwnerId = null;
      }
    }
    const latchedAuthoredConnector =
      this.zombiesConnectorTraversalId &&
      strictlyOccupiedAuthoredConnector?.source.id ===
        this.zombiesConnectorTraversalId
        ? strictlyOccupiedAuthoredConnector
        : null;
    if (
      !activeAuthoredConnector &&
      !latchedAuthoredConnector &&
      this.zombiesConnectorPresentationCandidateId
    ) {
      this.zombiesConnectorPresentationCandidateId = null;
      this.zombiesConnectorPresentationCandidateOwnerId = null;
      if (this.zombiesConnectorTraversalId === null) {
        this.zombiesConnectorTraversalState = 'cancelled-before-latch';
      }
    }

    // Endpoint grace is useful for predictive warming, but it must not keep a
    // connector painting behind the player while they are still inside the
    // source room. Facing owns the room-side presentation; the latch owns the
    // physical crossing; outside-room occupancy covers cold/debug entry.
    const insideOwnerRoom =
      this.zombiesNavigationSurface.containsCapsuleInRoom(
        owner.id,
        position,
        this.zombiesNavigationSurface.layout.largestActorCapsuleRadius,
      );
    const outsideRoomAuthoredConnector = insideOwnerRoom
      ? null
      : strictlyOccupiedAuthoredConnector;
    const authoredConnector =
      latchedAuthoredConnector ??
      activeAuthoredConnector ??
      outsideRoomAuthoredConnector;
    const authoredConnectorNeighborId = authoredConnector
      ? authoredConnector.source.fromRoomId === owner.id
        ? authoredConnector.source.toRoomId
        : authoredConnector.source.toRoomId === owner.id
          ? authoredConnector.source.fromRoomId
          : null
      : null;
    const connectorSplatOwnerId = authoredConnector
      ? this.zombiesCampus.connectorSplatOwnerId(authoredConnector.source.id)
      : null;
    // Adjacent RADs already live in one authored campus coordinate system.
    // Reveal the warm, viewed neighbor in the same Spark pass and let the
    // owner-scoped cut volumes form the opening. Prefer the destination RAD
    // over any synthetic connector splat so the doorway reads as a clean cut
    // instead of a procedural tunnel around the aperture.
    const visibleNeighborId =
      activePortalCandidate?.destinationId ??
      authoredConnectorNeighborId ??
      connectorSplatOwnerId;
    const visibleTertiaryId =
      connectorSplatOwnerId &&
      visibleNeighborId !== null &&
      visibleNeighborId !== connectorSplatOwnerId
        ? connectorSplatOwnerId
        : null;
    MintWorldLayer.setRenderOwners(
      owner.id,
      visibleNeighborId,
      visibleTertiaryId,
    );
    const connectorCutRoomIds = authoredConnector
      ? [owner.id, authoredConnectorNeighborId].filter(
          (id): id is string => id !== null,
        )
      : [];
    const connectorCuts = authoredConnector
      ? connectorCutRoomIds.flatMap((roomId) =>
          this.zombiesConnectorCutVolumes(authoredConnector, roomId),
        )
      : [];
    const connectorTrims =
      authoredConnector && authoredConnectorNeighborId
        ? [
            this.zombiesConnectorTrimPlane(
              authoredConnector,
              authoredConnectorNeighborId,
            ),
          ].filter((trim): trim is SplatTrimPlane => trim !== null)
        : [];
    // Every enabled authored cut/trim must stay active in play (not only the
    // facing doorway). Connector synthetics layer on top for seam span gaps.
    const authoredCuts = (
      this.zombiesNavigationSurface.layout.cutVolumes ?? []
    ).filter((cut) => cut.enabled);
    const authoredTrims = (
      this.zombiesNavigationSurface.layout.trimPlanes ?? []
    ).filter((trim) => trim.enabled);
    const runtimeCutById = new Map(
      authoredCuts.map((cut) => [cut.id, cut] as const),
    );
    for (const cut of connectorCuts) runtimeCutById.set(cut.id, cut);
    const runtimeTrimById = new Map(
      authoredTrims.map((trim) => [trim.id, trim] as const),
    );
    for (const trim of connectorTrims) runtimeTrimById.set(trim.id, trim);
    const runtimeCuts = [...runtimeCutById.values()];
    const runtimeTrims = [...runtimeTrimById.values()];
    const clipKey = `all-clips:${runtimeCuts.map((cut) => cut.id).join(',') || 'none'}:${runtimeTrims.map((trim) => trim.id).join(',') || 'none'}:conn:${authoredConnector?.source.id ?? 'none'}`;
    if (clipKey !== this.zombiesSplatClipKey) {
      this.zombiesClipRoomIds.clear();
      for (const cut of runtimeCuts) this.zombiesClipRoomIds.add(cut.roomId);
      for (const trim of runtimeTrims) this.zombiesClipRoomIds.add(trim.roomId);
      MintWorldLayer.setGlobalCutVolumes(runtimeCuts);
      MintWorldLayer.setGlobalTrimPlanes(runtimeTrims);
      this.zombiesSplatClipKey = clipKey;
    }

    const prefetchEnabled =
      (MintWorldLayer.qualityDiagnostics()?.lodSplatCount ?? 0) >= 700_000;
    const connectedCampus =
      this.zombiesNavigationSurface.validation.releaseReady;
    const prefetchRoomIdSet = new Set(prefetchRoomIds);
    // Only the owning room needs a live Rapier mesh. Registering all six dense
    // source colliders in one loading task stalls software WebGL clients and
    // wastes broadphase memory. Each owner still receives its complete,
    // post-transform source mesh, while the campus pad remains a gap-repair
    // fallback for sparse reconstruction.
    for (const room of rooms) {
      if (
        room.layer.colliderCount > 0 &&
        (connectedCampus || room.id !== owner.id)
      ) {
        room.layer.unregisterCollision();
      }
    }
    if (
      !connectedCampus &&
      owner.layer.colliderCount === 0
    ) {
      owner.layer.registerCollision();
    }
    for (const room of rooms) {
      // Single visual owner: even in connectors/concourse the nearest room stays
      // primary so Spark keeps a full-opacity LoD driver. Up to two doorway
      // neighbors warm as near-invisible prefetch instead of sharing that
      // budget at full opacity.
      const renderState =
        room.id === owner.id
          ? 'primary'
          : prefetchEnabled && prefetchRoomIdSet.has(room.id)
            ? 'prefetch'
            : 'resident';
      const prefetchLodScale =
        room.id === prefetchRoomId
          ? ZOMBIES_PRIMARY_PREFETCH_LOD_SCALE
          : ZOMBIES_SECONDARY_PREFETCH_LOD_SCALE;
      // Apply role and LoD weight together. At a ready seam the old primary
      // becomes a scale-1 prefetch while the scale-1 destination becomes the
      // primary; an atomic no-op at renderer level preserves both published
      // mappings across the ownership flip.
      room.layer.setRenderState(renderState, prefetchLodScale);
      room.layer.setPhysicalConnectorPrefetchVisible(
        room.id === authoredConnectorNeighborId,
      );
    }
    if (this.zombiesSplatFrameOwner !== owner.id) {
      if (this.zombiesSplatFrameOwner) {
        this.telemetry.setRoomState(
          this.zombiesSplatFrameOwner,
          'resident',
        );
      }
      this.telemetry.setRoomState(owner.id, 'owner');
      // Zombies environments are baked-lit splats and do not receive Three.js
      // dynamic shadows. Refresh the full-resolution map when room ownership
      // changes instead of redrawing the same 2048² map every gameplay frame.
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.zombiesSplatFrameOwner = owner.id;
    this.zombiesSplatPrefetch = prefetchRoomId;
    this.zombiesSplatPrefetchIds = prefetchRoomIds;
    this.zombiesSplatEvalPosition.set(position.x, position.y, position.z);
    this.zombiesSplatEvalLook.copy(zombiesSplatLookDirection);
    this.zombiesSplatOwnershipDirty = false;
    this.updateZombiesPredictiveHandoffLod(
      owner.id,
      prefetchRoomId,
      position,
    );
    this.scheduleZombiesPredictiveWarm(
      owner.id,
      prefetchRoomIds.find(
        (id) =>
          !this.zombiesSplatPreload.isReady(
            zombiesSplatPreloadKey(owner.id, id),
          ),
      ) ?? null,
    );
  }

  /**
   * Preserve the destination sort only for the last metres of an approach.
   * The source and landing cameras are spatially close here, so the current
   * room remains covered while the first destination frame is already mapped.
   */
  private updateZombiesPredictiveHandoffLod(
    ownerId: string,
    destinationId: string | null,
    _playerPosition: THREE.Vector3,
  ): void {
    // The shared Spark display must remain sorted from the live gameplay
    // camera. The previous destination-camera override could remove the source
    // room from the display for seconds, producing the recorded black frame.
    MintWorldLayer.clearHandoffLodCamera();
    this.zombiesPredictiveHandoffTarget = destinationId;
    if (!destinationId) {
      this.zombiesPredictiveHandoffSortReady = false;
      this.zombiesPredictiveHandoffSortStatus = 'idle';
      return;
    }
    const ready = this.isZombiesSplatPortalPreloadReady(
      ownerId,
      destinationId,
    );
    this.zombiesPredictiveHandoffSortReady = ready;
    this.zombiesPredictiveHandoffSortStatus = ready
      ? `live-ready:${destinationId}`
      : `live-warming:${destinationId}`;
  }

  /**
   * Page the forward room from the destination landing pose while the player
   * is still safely inside the current owner. Only one global Spark LoD camera
   * override may run at a time; an ownership refresh schedules the next target
   * after the current warm finishes.
   */
  private scheduleZombiesPredictiveWarm(
    ownerId: string | null,
    destinationId: string | null,
  ): void {
    if (!ownerId) {
      this.zombiesPredictiveWarmStatus = 'blocked:no-owner';
      return;
    }
    if (!destinationId) {
      this.zombiesPredictiveWarmStatus = 'blocked:no-destination';
      return;
    }
    if (ownerId === destinationId) {
      this.zombiesPredictiveWarmStatus = 'blocked:self';
      return;
    }
    // The player is still standing in the same authored seam immediately
    // after an ownership flip. The forward preload that opened the crossing
    // already proves both RADs and their shared display mapping; launching a
    // new reverse warm here steals Spark's one LoD camera back into the room
    // behind the player and produces a visible black handoff.
    if (this.isZombiesSplatPortalPreloadReady(ownerId, destinationId)) {
      this.zombiesPredictiveReadyRoomIds.add(destinationId);
      this.zombiesPredictiveWarmStatus = `live-ready:${destinationId}`;
      return;
    }
    const worldCount = this.assets.listWorlds('zombies').length;
    if (this.mintZombiesRoomIds.length < worldCount) {
      this.zombiesPredictiveWarmStatus =
        `blocked:rooms-${this.mintZombiesRoomIds.length}/${worldCount}`;
      return;
    }
    const preloadKey = zombiesSplatPreloadKey(ownerId, destinationId);
    // Predictive warm is what makes the portal eligible to open, so lookup
    // must use the authored graph rather than `portalBetween`, which filters
    // out closed portals and would create a readiness deadlock.
    const portal = this.zombiesNavigationSurface.portals.find(
      (candidate) =>
        (candidate.source.fromRoomId === ownerId &&
          candidate.source.toRoomId === destinationId) ||
        (candidate.source.toRoomId === ownerId &&
          candidate.source.fromRoomId === destinationId),
    );
    const destination = this.mintWorldLayers.get(destinationId);
    const contract = this.zombiesRoomContracts.get(destinationId);
    const landing = portal
      ? this.zombiesNavigationSurface.portalLandingPoint(
          portal.source.id,
          destinationId,
          0.34,
        )
      : null;
    if (!portal || !destination || !contract || !landing) {
      this.zombiesPredictiveWarmStatus =
        `blocked:contract-${Boolean(portal)}-${Boolean(destination)}-${Boolean(contract)}-${Boolean(landing)}`;
      return;
    }

    // Cache the destination's exact first view through Spark's LoD-only path,
    // then prove that the restored live camera has published it. Page preload
    // never takes over the visible display mapping.
    const warmPosition = landing.clone();
    warmPosition.y += 1.62;
    const warmDirection = contract.anchor.clone().sub(warmPosition);
    warmDirection.y = 0;
    if (warmDirection.lengthSq() <= 1e-6) warmDirection.set(0, 0, -1);
    warmDirection.normalize();
    const warmQuaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      warmDirection,
    );
    const livePosition = this.camera.getWorldPosition(new THREE.Vector3());
    const liveQuaternion = this.camera.getWorldQuaternion(
      new THREE.Quaternion(),
    );
    this.zombiesPredictiveWarmTarget = destinationId;
    this.zombiesPredictiveWarmStatus = `live-warming:${destinationId}`;
    this.telemetry.instant(
      `zombies.predictive-warm.${destinationId}`,
      `${ownerId} -> ${destinationId}`,
    );
    this.zombiesSplatPreload.request({
      key: preloadKey,
      ownerId,
      destinationId,
      priority: 100,
      run: async (signal) => {
        const cached = await destination.warmPagedView(
          warmPosition,
          warmQuaternion,
          ZOMBIES_PREDICTIVE_WARM_TIMEOUT_MS,
          signal,
          {
            stealLodCamera: true,
            publishDisplayMapping: true,
          },
        );
        if (!cached || signal.aborted) return false;
        return destination.warmPagedView(
          livePosition,
          liveQuaternion,
          ZOMBIES_PREDICTIVE_WARM_TIMEOUT_MS,
          signal,
        );
      },
      onSettled: (ready, record) => {
        if (ready && this.isZombiesPlayMode()) {
          this.zombiesPredictiveReadyRoomIds.add(destinationId);
          this.zombiesPredictiveWarmStatus = `live-ready:${destinationId}`;
          this.telemetry.setRoomState(
            destinationId,
            'resident',
            'live-view-ready',
          );
        } else {
          this.zombiesPredictiveWarmStatus =
            `${record.stage}:${destinationId}`;
        }
        this.zombiesPredictiveWarmTarget = null;
        this.zombiesSplatOwnershipDirty = true;
      },
    });
  }

  private resolveZombiesSplatFrameTransition(
    previous: THREE.Vector3,
    current: THREE.Vector3,
  ): SplatFrameTransition | null {
    const owner = this.zombiesSplatFrameOwner;
    const crossed = this.zombiesSplatCompletion.resolve(
      previous,
      current,
      owner,
    );
    if (crossed || !owner) return crossed;

    // Fixed-step samples can enter and leave a narrow seam between frames.
    // Containment changes room ownership only inside a ready authored portal,
    // so it is a safe portal-specific fallback without restoring nearest-room
    // or graph-jump ownership.
    const containedRoomId = this.zombiesContainment.roomId('player');
    if (!containedRoomId || containedRoomId === owner) return null;
    const portal = this.zombiesNavigationSurface.portalBetween(
      owner,
      containedRoomId,
    );
    const ready = portal
      ? this.zombiesSplatCompletion.portals.find(
          (candidate) => candidate.id === portal.source.id,
        )?.ready === true
      : false;
    return portal && ready
      ? {
          fromId: owner,
          toId: containedRoomId,
          destination: current.clone(),
          continuous: true,
        }
      : null;
  }

  private isZombiesSplatPortalPreloadReady(
    ownerId: string,
    destinationId: string,
  ): boolean {
    if (
      this.zombiesSplatPreload.isReady(
        zombiesSplatPreloadKey(ownerId, destinationId),
      )
    ) {
      return true;
    }
    // The preload task is an optimization signal, not the visual truth. On a
    // moving approach Spark can finish every requested destination page while
    // the short landing-camera warm is still awaiting its stability timer.
    // Keeping the aperture closed in that state leaves the authored wall in
    // front of a physically open navigation seam. Actual stable pager
    // residency is sufficient to let the isolated portal renderer begin its
    // own destination mapping; renderContinuousPortal keeps the source intact
    // until that mapping is drawable.
    const portal = this.zombiesNavigationSurface.portals.find(
      (candidate) =>
        (candidate.source.fromRoomId === ownerId &&
          candidate.source.toRoomId === destinationId) ||
        (candidate.source.toRoomId === ownerId &&
          candidate.source.fromRoomId === destinationId),
    );
    const destination = this.mintWorldLayers.get(destinationId);
    if (
      portal &&
      destination?.meetsResidency(
        portal.source.residency.minimumActiveSplats,
      )
    ) {
      return true;
    }
    return Boolean(
      !this.zombiesPreviousSplatSeamCleared &&
        this.zombiesPreviousSplatFrameOwner === destinationId &&
        this.zombiesSplatFrameOwner === ownerId &&
        this.zombiesSplatPreload.isReady(
          zombiesSplatPreloadKey(destinationId, ownerId),
        ),
    );
  }

  private refreshZombiesPortalResidency(): void {
    for (const portal of this.zombiesNavigationSurface.portals) {
      const destinationId =
        portal.source.fromRoomId === this.zombiesSplatFrameOwner
          ? portal.source.toRoomId
          : portal.source.toRoomId === this.zombiesSplatFrameOwner
            ? portal.source.fromRoomId
            : null;
      const preloadKey = destinationId
        ? zombiesSplatPreloadKey(this.zombiesSplatFrameOwner!, destinationId)
        : null;
      const assetsReady =
        destinationId !== null &&
        portal.source.residency.requiredAssetIds.every((assetId) => {
          const layer = this.mintWorldLayers.get(assetId);
          return Boolean(
            layer?.meetsResidency(
              portal.source.residency.minimumActiveSplats,
            ),
          );
        });
      if (preloadKey && this.zombiesSplatPreload.isReady(preloadKey) && !assetsReady) {
        this.zombiesSplatPreload.invalidate(
          preloadKey,
          'destination root or live mapping was evicted',
        );
      }
      const ready =
        this.zombiesPortalsForcedReady !== null
          ? this.zombiesPortalsForcedReady
          : (() => {
              // Navigation and presentation must open from the same measured
              // condition. The preload record can remain in its landing-view
              // stability timer after every required RAD already satisfies
              // the pager contract; requiring that bookkeeping flag here
              // made a visibly open doorway behave like a collision wall.
              const directReady = assetsReady;
              const previousOwner = this.zombiesPreviousSplatFrameOwner;
              const currentOwner = this.zombiesSplatFrameOwner;
              const wasOpenAtPreviousRefresh =
                this.zombiesNavigationSurface.isPortalOpen(
                  portal.source.id,
                );
              const isRecentCrossing = Boolean(
                previousOwner &&
                  currentOwner &&
                  !this.zombiesPreviousSplatSeamCleared &&
                  ((portal.source.fromRoomId === previousOwner &&
                    portal.source.toRoomId === currentOwner) ||
                    (portal.source.toRoomId === previousOwner &&
                      portal.source.fromRoomId === currentOwner)),
              );
              // Ownership can flip while the capsule is still on the sloped
              // landing ramp. Keep the forward preload contract open until
              // the player clears that seam; otherwise selecting the next
              // exit removes the physical containment corridor mid-step. A
              // portal that was open when the crossing began is itself the
              // authoritative handoff contract: the destination pager may
              // briefly remap its requested chunks as it becomes primary,
              // but that refinement must never close collision underneath
              // an actor already traversing the doorway.
              const recentCrossingReady = Boolean(
                isRecentCrossing &&
                  (wasOpenAtPreviousRefresh ||
                    this.zombiesSplatPreload.isReady(
                      zombiesSplatPreloadKey(previousOwner!, currentOwner!),
                    )),
              );
              return directReady || recentCrossingReady;
            })();
      this.zombiesSplatCompletion.setPortalReady(portal.source.id, ready);
    }
  }

  /**
   * Handoffs are allowed only after the destination has completed its pager
   * warm. This replaces the old WebGL-to-2D canvas copy/readback path.
   */
  private beginZombiesSplatFrameHold(
    _seconds = 0.95,
    destinationId = this.zombiesSplatPrefetch,
  ): boolean {
    if (!this.isZombiesPlayMode() || !this.isZombiesHudMode()) return false;
    if (!destinationId || !this.mintZombiesRoomIds.includes(destinationId)) {
      return false;
    }
    const destination = this.mintWorldLayers.get(destinationId);
    if (!destination?.meetsResidency(0)) return false;
    this.zombiesSplatFrameHoldActivations += 1;
    this.telemetry.instant(
      `zombies.handoff.${this.zombiesSplatFrameHoldActivations}`,
      `${this.zombiesSplatFrameOwner ?? 'none'} -> ${destinationId}`,
    );
    return true;
  }

  private releaseZombiesSplatFrameHold(): void {
    // Backwards-compatible test hook: pager-ready handoffs have no held frame.
  }

  private setZombiesSplatAnalysisRoom(index: number | null): string | null {
    this.zombiesSplatAnalysisRoom =
      index === null || (index >= 0 && index < this.mintZombiesRoomIds.length)
        ? index
        : null;
    this.completeZombiesSplatFrame(this.player.position);
    return this.zombiesSplatFrameOwner;
  }

  private getZombiesSplatAnalysis(): {
    frameOwner: string | null;
    activePortalId: string | null;
    connectorPresentationCandidateId: string | null;
    connectorPresentationCandidateOwnerId: string | null;
    connectorTraversalId: string | null;
    connectorTraversalState: string;
    strictConnectorAtPlayer: string | null;
    activePortalApertureNdc: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      corners: Array<{ x: number; y: number }>;
    } | null;
    portalPresentation: ReturnType<SplatCampus['portalPresentationDiagnostics']>;
    portalCandidates: ReturnType<Game['getZombiesPortalCandidateDiagnostics']>;
    prefetch: string | null;
    prefetchIds: string[];
    predictiveWarmTarget: string | null;
    predictiveWarmStatus: string;
    predictiveReadyRoomIds: string[];
    predictiveHandoffTarget: string | null;
    predictiveHandoffSortReady: boolean;
    predictiveHandoffSortStatus: string;
    preload: ReturnType<SplatPreloadCoordinator['diagnostics']>;
    portalLandings: Array<{
      id: string;
      fromId: string;
      toId: string;
      from: { x: number; y: number; z: number } | null;
      to: { x: number; y: number; z: number } | null;
    }>;
    forcedRoom: number | null;
    quality: ReturnType<typeof MintWorldLayer.qualityDiagnostics>;
    rooms: Array<{
      id: string;
      index: number;
      anchor: { x: number; y: number; z: number };
      rootPosition: { x: number; y: number; z: number };
      activeSplats: number;
      displayName: string;
      runtimeBytes: number;
      splat: ReturnType<MintWorldLayer['diagnostics']>;
    }>;
  } {
    const worlds = new Map(
      this.assets.listWorlds('zombies').map((world) => [world.id, world]),
    );
    const waypoints = new Map(
      this.getZombiesCampusWaypoints().map((waypoint) => [
        waypoint.id,
        waypoint,
      ]),
    );
    const activePortalApertureNdc = (() => {
      if (!this.zombiesActivePortalId) return null;
      this.camera.updateMatrixWorld(true);
      const aperture = this.zombiesContinuousPortal;
      const worldCorners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([right, up]) =>
        aperture.center
          .clone()
          .addScaledVector(aperture.right, right! * aperture.halfWidth)
          .addScaledVector(aperture.up, up! * aperture.halfHeight),
      );
      const corners = worldCorners
        .filter(
          (point) =>
            point.clone().applyMatrix4(this.camera.matrixWorldInverse).z <
            -this.camera.near,
        )
        .map((point) => point.clone().project(this.camera));
      if (corners.length < 2) return null;
      const minX = Math.max(-1, Math.min(...corners.map((point) => point.x)));
      const maxX = Math.min(1, Math.max(...corners.map((point) => point.x)));
      const minY = Math.max(-1, Math.min(...corners.map((point) => point.y)));
      const maxY = Math.min(1, Math.max(...corners.map((point) => point.y)));
      if (minX >= maxX || minY >= maxY) return null;
      return {
        minX,
        minY,
        maxX,
        maxY,
        corners: corners.map((point) => ({ x: point.x, y: point.y })),
      };
    })();
    return {
      frameOwner: this.zombiesSplatFrameOwner,
      activePortalId: this.zombiesActivePortalId,
      connectorPresentationCandidateId:
        this.zombiesConnectorPresentationCandidateId,
      connectorPresentationCandidateOwnerId:
        this.zombiesConnectorPresentationCandidateOwnerId,
      connectorTraversalId: this.zombiesConnectorTraversalId,
      connectorTraversalState: this.zombiesConnectorTraversalState,
      strictConnectorAtPlayer:
        this.zombiesAuthoredConnectorAt(this.player.position, false)?.source.id ??
        null,
      activePortalApertureNdc,
      portalPresentation: this.zombiesCampus.portalPresentationDiagnostics(),
      portalCandidates: this.getZombiesPortalCandidateDiagnostics(),
      prefetch: this.zombiesSplatPrefetch,
      prefetchIds: [...this.zombiesSplatPrefetchIds],
      predictiveWarmTarget: this.zombiesPredictiveWarmTarget,
      predictiveWarmStatus: this.zombiesPredictiveWarmStatus,
      predictiveReadyRoomIds: [...this.zombiesPredictiveReadyRoomIds],
      predictiveHandoffTarget: this.zombiesPredictiveHandoffTarget,
      predictiveHandoffSortReady: this.zombiesPredictiveHandoffSortReady,
      predictiveHandoffSortStatus: this.zombiesPredictiveHandoffSortStatus,
      preload: this.zombiesSplatPreload.diagnostics(),
      portalLandings: this.zombiesNavigationSurface.portals.map((portal) => {
        const from = this.zombiesNavigationSurface.portalLandingPoint(
          portal.source.id,
          portal.source.fromRoomId,
          0.34,
        );
        const to = this.zombiesNavigationSurface.portalLandingPoint(
          portal.source.id,
          portal.source.toRoomId,
          0.34,
        );
        return {
          id: portal.source.id,
          fromId: portal.source.fromRoomId,
          toId: portal.source.toRoomId,
          from: from ? { x: from.x, y: from.y, z: from.z } : null,
          to: to ? { x: to.x, y: to.y, z: to.z } : null,
        };
      }),
      forcedRoom: this.zombiesSplatAnalysisRoom,
      quality: MintWorldLayer.qualityDiagnostics(),
      rooms: this.mintZombiesRoomIds.flatMap((id, index) => {
        const layer = this.mintWorldLayers.get(id);
        const world = worlds.get(id);
        const anchor = this.zombiesRoomContracts.get(id)?.anchor;
        const waypoint = waypoints.get(id);
        if (!layer || !world || !anchor) return [];
        return [
          {
            id,
            index,
            displayName:
              typeof world.metadata?.displayName === 'string'
                ? world.metadata.displayName
                : id,
            runtimeBytes:
              typeof world.metadata?.runtimeBytes === 'number'
                ? world.metadata.runtimeBytes
                : 0,
            anchor: {
              x: anchor.x,
              y: waypoint?.y ?? this.player.position.y,
              z: anchor.z,
            },
            rootPosition: {
              x: layer.root.position.x,
              y: layer.root.position.y,
              z: layer.root.position.z,
            },
            activeSplats: layer.activeSplats,
            splat: layer.diagnostics(),
          },
        ];
      }),
    };
  }

  private getZombiesPortalDiagnostics(): {
    id: string;
    ownerId: string;
    destinationId: string;
    distanceToOwnerSocket: number;
    width: number;
    usableWidth: number;
    height: number;
    sourceVisualWidth: number;
    sourceVisualHeight: number;
    destinationSocketWidth: number;
    destinationSocketHeight: number;
    visualToTraversalWidthRatio: number;
    prefetchDistance: number;
    renderDistance: number;
    sourceAperture: {
      center: { x: number; y: number; z: number };
      halfWidth: number;
      halfHeight: number;
      ndcCorners: Array<{ x: number; y: number; z: number }>;
    };
    compositor: {
      requestedSplatBudget: number;
      compositeFrames: number;
      fallbackFrames: number;
      behindActiveSplats: number;
      behindSourceSplats: number;
    };
    containmentSignedDistance: number;
    ready: boolean;
    destinationResident: boolean;
    destinationRenderState: string | null;
    compositorDestinationReady: boolean;
    authoredClipIds: string[];
    authoredCutWidths: number[];
    gameplayClipBindings: string[];
  } | null {
    const ownerId = this.zombiesSplatFrameOwner;
    const portalId = this.zombiesActivePortalId;
    if (!ownerId || !portalId) return null;
    const portal = this.zombiesNavigationSurface.portals.find(
      (candidate) => candidate.source.id === portalId,
    );
    if (!portal) return null;
    const ownerIsFrom = portal.source.fromRoomId === ownerId;
    const destinationId = ownerIsFrom
      ? portal.source.toRoomId
      : portal.source.fromRoomId;
    const ownerSocket = ownerIsFrom ? portal.from : portal.to;
    const destinationLayer = this.mintWorldLayers.get(destinationId);
    const destinationRoom =
      this.zombiesNavigationSurface.room(destinationId);
    const sourceSocketId = ownerIsFrom
      ? portal.source.fromSocketId
      : portal.source.toSocketId;
    const destinationSocketId = ownerIsFrom
      ? portal.source.toSocketId
      : portal.source.fromSocketId;
    const sourceSocket =
      this.zombiesNavigationSurface.room(ownerId)?.source.doorwaySockets.find(
        (socket) => socket.id === sourceSocketId,
      );
    const destinationSocket =
      destinationRoom?.source.doorwaySockets.find(
        (socket) => socket.id === destinationSocketId,
      );
    const quality = MintWorldLayer.qualityDiagnostics();
    const clipIds = [
      portal.source.fromClipId,
      portal.source.toClipId,
    ].filter((id): id is string => Boolean(id));
    const clipIdSet = new Set(clipIds);
    const sourceVisualWidth = Math.max(
      portal.source.width,
      sourceSocket?.width ?? 0,
    );
    const sourceVisualHeight = Math.max(
      1.8,
      sourceSocket?.height ?? 0,
    );
    const aperture = this.zombiesContinuousPortal;
    const ndcCorners = ([-1, 1] as const).flatMap((horizontal) =>
      ([-1, 1] as const).map((vertical) =>
        aperture.center
          .clone()
          .addScaledVector(
            aperture.right,
            horizontal * aperture.halfWidth,
          )
          .addScaledVector(
            aperture.up,
            vertical * aperture.halfHeight,
          )
          .project(this.camera),
      ),
    );
    return {
      id: portalId,
      ownerId,
      destinationId,
      distanceToOwnerSocket: Math.hypot(
        this.player.position.x - ownerSocket.x,
        this.player.position.z - ownerSocket.z,
      ),
      width: portal.source.width,
      usableWidth: Math.max(0, portal.source.width - 0.34 * 2),
      height: sourceVisualHeight,
      sourceVisualWidth,
      sourceVisualHeight,
      destinationSocketWidth: destinationSocket?.width ?? 0,
      destinationSocketHeight: destinationSocket?.height ?? 0,
      visualToTraversalWidthRatio:
        sourceVisualWidth / Math.max(0.001, portal.source.width),
      prefetchDistance: ZOMBIES_PORTAL_PREFETCH_DISTANCE,
      renderDistance: ZOMBIES_PORTAL_RENDER_DISTANCE,
      sourceAperture: {
        center: {
          x: aperture.center.x,
          y: aperture.center.y,
          z: aperture.center.z,
        },
        halfWidth: aperture.halfWidth,
        halfHeight: aperture.halfHeight,
        ndcCorners: ndcCorners.map((corner) => ({
          x: corner.x,
          y: corner.y,
          z: corner.z,
        })),
      },
      compositor: {
        requestedSplatBudget: aperture.lodSplatCount,
        compositeFrames:
          quality?.continuousPortalCompositeFrames ?? 0,
        fallbackFrames:
          quality?.continuousPortalFallbackFrames ?? 0,
        behindActiveSplats:
          quality?.continuousPortalBehindActiveSplats ?? 0,
        behindSourceSplats:
          quality?.continuousPortalBehindSourceSplats ?? 0,
      },
      containmentSignedDistance:
        this.zombiesNavigationSurface.signedDistance(
          this.player.position,
          0.34,
        ),
      ready:
        this.zombiesSplatCompletion.portals.find(
          (candidate) => candidate.id === portalId,
        )?.ready ?? false,
      destinationResident:
        destinationLayer?.meetsResidency(
          portal.source.residency.minimumActiveSplats,
        ) ?? false,
      destinationRenderState:
        destinationLayer?.diagnostics().renderState ?? null,
      compositorDestinationReady:
        quality?.continuousPortalDestinationId === destinationId &&
        quality.continuousPortalDestinationReady,
      authoredClipIds: clipIds,
      authoredCutWidths: (
        this.zombiesNavigationSurface.layout.cutVolumes ?? []
      )
        .filter((cut) => clipIdSet.has(cut.id))
        // SplatCutVolume is through-wall depth × height × opening width.
        .map((cut) => cut.size[2]),
      gameplayClipBindings:
        quality?.clipBindings.map((binding) => binding.id) ?? [],
    };
  }

  private setZombiesSplatIsolation(enabled: boolean): {
    enabled: boolean;
    hiddenOrdinaryMeshes: number;
    visibleOrdinaryMeshes: number;
    sparkRendererVisible: boolean;
  } {
    if (enabled && !this.zombiesSplatIsolationVisibility) {
      this.zombiesSplatIsolationVisibility = new Map();
      this.scene.traverse((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          object.name === 'mint-world-spark-renderer'
        ) {
          return;
        }
        this.zombiesSplatIsolationVisibility!.set(object, object.visible);
        object.visible = false;
      });
    } else if (!enabled && this.zombiesSplatIsolationVisibility) {
      for (const [mesh, visible] of this.zombiesSplatIsolationVisibility) {
        mesh.visible = visible;
      }
      this.zombiesSplatIsolationVisibility = null;
    }

    let visibleOrdinaryMeshes = 0;
    let sparkRendererVisible = false;
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.name === 'mint-world-spark-renderer') {
        sparkRendererVisible = object.visible;
      } else if (object.visible) {
        visibleOrdinaryMeshes += 1;
      }
    });
    return {
      enabled: this.zombiesSplatIsolationVisibility !== null,
      hiddenOrdinaryMeshes:
        this.zombiesSplatIsolationVisibility?.size ?? 0,
      visibleOrdinaryMeshes,
      sparkRendererVisible,
    };
  }

  private getZombiesCampusConnectivity(): {
    connected: boolean;
    roomCount: number;
    linkCount: number;
    reachableRoomIds: string[];
    isolatedRoomIds: string[];
    links: Array<{ fromId: string; toId: string }>;
  } {
    const roomIds = [...this.mintZombiesRoomIds];
    const links = this.zombiesSplatCompletion.portals.map((portal) => ({
      fromId: portal.fromId,
      toId: portal.toId,
    }));
    const neighbors = new Map<string, Set<string>>(
      roomIds.map((id) => [id, new Set<string>()]),
    );
    for (const link of links) {
      neighbors.get(link.fromId)?.add(link.toId);
      neighbors.get(link.toId)?.add(link.fromId);
    }
    const reachable = new Set<string>();
    const queue = roomIds.length > 0 ? [roomIds[0]!] : [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const neighbor of neighbors.get(id) ?? []) {
        if (!reachable.has(neighbor)) queue.push(neighbor);
      }
    }
    const isolatedRoomIds = roomIds.filter((id) => !reachable.has(id));
    return {
      connected: roomIds.length > 0 && isolatedRoomIds.length === 0,
      roomCount: roomIds.length,
      linkCount: links.length,
      reachableRoomIds: roomIds.filter((id) => reachable.has(id)),
      isolatedRoomIds,
      links,
    };
  }

  private getZombiesSpatialContracts(): Array<{
    id: string;
    index: number;
    floorY: number;
    rootPosition: { x: number; y: number; z: number };
    colliderBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
    objectBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
    radBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
  }> {
    const toBounds = (bounds: THREE.Box3) => ({
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    });
    return this.mintZombiesRoomIds.flatMap((id, index) => {
      const layer = this.mintWorldLayers.get(id);
      if (!layer) return [];
      layer.recomputeBounds();
      const objectBounds = new THREE.Box3().setFromObject(layer.root);
      const radBounds = layer.getVisualBounds();
      return [
        {
          id,
          index,
          floorY: this.estimateZombiesFloorY(layer),
          rootPosition: {
            x: layer.root.position.x,
            y: layer.root.position.y,
            z: layer.root.position.z,
          },
          colliderBounds: toBounds(layer.bounds),
          objectBounds: toBounds(objectBounds),
          radBounds: radBounds.isEmpty() ? null : toBounds(radBounds),
        },
      ];
    });
  }

  private startZombiesCampusTour(): boolean {
    const rooms = this.getZombiesCampusWaypoints();
    if (rooms.length < 2) return false;
    const byIndex = new Map(rooms.map((room) => [room.index, room]));
    const hub = byIndex.get(0);
    const north = byIndex.get(1);
    const south = byIndex.get(2);
    const east = byIndex.get(3);
    const west = byIndex.get(4);
    const farNorth = byIndex.get(5);
    const sequence = [
      hub,
      north,
      farNorth,
      north,
      hub,
      east,
      hub,
      west,
      hub,
      south,
      hub,
    ].filter((room): room is NonNullable<typeof room> => Boolean(room));
    if (sequence.length < 2) return false;

    const waypoints: Array<{ x: number; y: number; z: number; lookYaw?: number }> =
      [];
    for (let index = 0; index < sequence.length; index += 1) {
      const room = sequence[index]!;
      waypoints.push({ x: room.x, y: room.y, z: room.z });
      // Hold a quick look when arriving at a distinct room.
      const prev = sequence[index - 1];
      if (!prev || prev.index !== room.index) {
        for (const yaw of [0, Math.PI * 0.66, Math.PI * 1.33]) {
          waypoints.push({
            x: room.x,
            y: room.y,
            z: room.z,
            lookYaw: yaw,
          });
        }
      }
    }

    this.spawnProtectionRemaining = 300;
    this.campusTour = {
      waypoints,
      index: 0,
      segmentElapsed: 0,
      segmentDuration: 0.2,
      done: false,
    };
    const start = waypoints[0]!;
    this.player.restore({
      ...this.player.snapshot(),
      position: new THREE.Vector3(start.x, start.y, start.z),
      yaw: 0,
      pitch: -0.06,
    });
    this.ui.caption('Campus tour // walking all containment rooms');
    return true;
  }

  private updateCampusTour(delta: number, elapsed: number): void {
    const tour = this.campusTour;
    if (!tour || tour.done) return;
    this.spawnProtectionRemaining = Math.max(this.spawnProtectionRemaining, 30);

    const from = tour.waypoints[tour.index];
    const to = tour.waypoints[tour.index + 1];
    if (!from || !to) {
      tour.done = true;
      this.ui.caption('Campus tour complete');
      return;
    }

    if (tour.segmentElapsed === 0) {
      const isLook =
        to.lookYaw !== undefined && from.x === to.x && from.z === to.z;
      const distance = Math.hypot(to.x - from.x, to.z - from.z);
      tour.segmentDuration = isLook
        ? 0.18
        : Math.max(0.55, Math.min(1.4, distance * 0.035));
    }

    tour.segmentElapsed += delta;
    const t = Math.min(1, tour.segmentElapsed / tour.segmentDuration);
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    const yaw =
      to.lookYaw !== undefined && from.x === to.x && from.z === to.z
        ? to.lookYaw
        : Math.atan2(-(to.x - from.x), -(to.z - from.z));
    this.player.restore({
      ...this.player.snapshot(),
      position: new THREE.Vector3(x, y, z),
      yaw,
      pitch: to.lookYaw !== undefined ? -0.08 : -0.06,
    });
    this.player.updateCamera(
      delta,
      elapsed,
      this.persistence.state.settings.accessibility,
      this.weapon.adsFactor,
    );

    if (t >= 1) {
      tour.index += 1;
      tour.segmentElapsed = 0;
      if (tour.index >= tour.waypoints.length - 1) {
        tour.done = true;
        this.ui.caption('Campus tour complete');
      }
    }
  }

  private arenaBuildZombies(
    options: { skipWorldBoundary?: boolean; compactRooms?: boolean } = {},
  ): void {
    this.zombies.arena.build(this.scene, this.physics, options);
  }

  /**
   * World Labs' production placement calibrates local y=0 to the walk deck at
   * root y=1.5. Preserve that semantic origin instead of sampling noisy bounds.
   */
  private estimateZombiesFloorY(layer: MintWorldLayer): number {
    return layer.root.position.y - 1.5;
  }

  private async ensureZombiesMintWorlds(
    onProgress?: (completed: number, total: number, label: string) => void,
  ): Promise<Array<{ id: string; layer: MintWorldLayer }>> {
    const stream = this.beginZombiesMintWorldStream(onProgress);
    const rooms = await stream.allReady;
    return rooms.map(({ world, layer }) => ({ id: world.id, layer }));
  }

  private beginZombiesMintWorldStream(
    onProgress?: (completed: number, total: number, label: string) => void,
  ): ZombiesWorldStream {
    const worlds = this.assets.listWorlds('zombies');
    const readyCount = worlds.filter((world) =>
      this.mintZombiesRoomIds.includes(world.id),
    ).length;
    if (onProgress) {
      onProgress(
        readyCount,
        worlds.length,
        readyCount >= worlds.length
          ? 'Restoring cached containment rooms'
          : 'Opening prioritized containment stream',
      );
      if (!this.zombiesWorldStream?.settled) {
        this.zombiesStreamProgressListeners.add(onProgress);
      }
    }
    if (this.zombiesWorldStream) return this.zombiesWorldStream;
    const streamGeneration = this.zombiesWorldStreamGeneration;

    if (worlds.length === 0) {
      const missing = Promise.reject(
        new Error('No finalized Zombies worlds are present in the manifest'),
      );
      this.zombiesWorldStream = {
        firstReady: missing,
        allReady: missing.then(() => []),
        settled: true,
      };
      void this.zombiesWorldStream.allReady.catch(() => undefined);
      return this.zombiesWorldStream;
    }

    this.telemetry.begin('zombies.world-stream');
    const roomProgress = new Map<string, number>(
      worlds.map((world) => [
        world.id,
        this.mintWorldLayers.has(world.id) ? 1 : 0,
      ]),
    );
    const publishAggregateProgress = (label: string): void => {
      const completed = Array.from(roomProgress.values()).reduce(
        (total, progress) => total + progress,
        0,
      );
      for (const listener of this.zombiesStreamProgressListeners) {
        listener(completed, worlds.length, label);
      }
    };
    publishAggregateProgress(
      readyCount > 0
        ? 'Restoring cached containment rooms'
        : 'Opening prioritized containment stream',
    );

    const startIndex = Math.max(
      0,
      worlds.findIndex(
        (world) =>
          world.id === this.zombiesNavigationSurface.layout.startRoomId,
      ),
    );
    // Isolate start-room RAD bandwidth until the hub is loaded and warmed.
    // Neighbors stream after the hub gate so Deploy stays hub-first.
    const firstReady = (async () => {
      if (streamGeneration !== this.zombiesWorldStreamGeneration) {
        throw new Error('Zombies world stream cancelled');
      }
      const entry = await this.loadZombiesWorldWithRetry(
        worlds[startIndex]!,
        startIndex,
        worlds.length,
        roomProgress,
        publishAggregateProgress,
      );
      if (streamGeneration !== this.zombiesWorldStreamGeneration) {
        entry?.layer.dispose();
        throw new Error('Zombies world stream cancelled');
      }
      if (!entry) {
        throw new Error(
          `Starting containment room ${worlds[startIndex]!.id} failed to load`,
        );
      }
      const registered = this.registerZombiesWorld(
        entry,
        roomProgress,
        publishAggregateProgress,
        streamGeneration,
      );
      if (
        !registered.layer.markWarmedIfResident() &&
        !registered.layer.diagnostics().rootPageWarmed
      ) {
        // A paged RAD can keep its root record absent until the gameplay
        // camera owns the room. The previous 4s + 8s + 12s residency retry
        // ladder therefore waited 24 seconds and then accepted pager attach
        // anyway. Bound the pre-play gate to pager readiness; ownership below
        // drives the real root-page fill while the first frame is composed.
        const pagerAttached = await registered.layer.waitForPagerAttached(1_500);
        if (
          !pagerAttached ||
          !registered.layer.markWarmedFromPagerAttach()
        ) {
          try {
            await this.warmZombiesWorld(
              registered,
              roomProgress,
              publishAggregateProgress,
              8_000,
            );
          } catch (error) {
            console.warn(
              `Zombies hub ${registered.world.id} warm incomplete; retrying exact anchor view.`,
              error,
            );
            // Never open gameplay on chunk zero alone. A second bounded pass
            // is cheaper than exposing a permanent one-splat doorway, and on
            // hardware this normally resolves in the first pass.
            await this.warmZombiesWorld(
              registered,
              roomProgress,
              publishAggregateProgress,
              12_000,
            );
          }
        }
      }
      return registered;
    })();
    const loadAllRooms = (async () => {
      // Spark 2.1 disposes an LoD tree after three seconds without a visible
      // traversal. Rooms are intentionally hidden while their six RAD headers
      // register, so keep existing records alive until the gameplay camera
      // takes over. Without this, the cached root page survives but its tree
      // does not, and a later doorway can remain a one-splat black opening.
      const pagerKeepAlive = window.setInterval(
        () => MintWorldLayer.touchResidentPagers(),
        500,
      );
      try {
        const hub = await firstReady;
        // Portal BFS from the hub so doorway destinations attach before far rooms.
        const neighborIndexes = this.zombiesStreamOrderIndexes(
          worlds,
          startIndex,
        );
        const hubAdjacentIds = new Set(
          this.zombiesPortalAdjacentRoomIds(hub.world.id),
        );
        const adjacentIndexes = neighborIndexes.filter((index) =>
          hubAdjacentIds.has(worlds[index]!.id),
        );
        const farIndexes = neighborIndexes.filter(
          (index) => !hubAdjacentIds.has(worlds[index]!.id),
        );
        const neighbors: ZombiesWorldEntry[] = [];
        const loadNeighborBatch = async (
          indexes: number[],
          concurrency: number,
          softWarm: boolean,
        ): Promise<void> => {
        let cursor = 0;
        const worker = async () => {
          while (cursor < indexes.length) {
            const index = indexes[cursor]!;
            cursor += 1;
            const entry = await this.loadZombiesWorldWithRetry(
              worlds[index]!,
              index,
              worlds.length,
              roomProgress,
              publishAggregateProgress,
            );
            if (!entry) continue;
            try {
              const registered = this.registerZombiesWorld(
                entry,
                roomProgress,
                publishAggregateProgress,
                streamGeneration,
              );
              // Residents do not keep Spark root pages under owner-only paging.
              // Soft-warm portal-adjacent rooms without stealing the hub owner
              // so cut doorways already have root pages when looked through.
              registered.layer.markWarmedFromPagerAttach();
              if (softWarm) {
                try {
                  await registered.layer.warmPagedSource(4_000, {
                    stealLodCamera: false,
                  });
                } catch (error) {
                  console.warn(
                    `Zombies neighbor ${registered.world.id} soft-warm incomplete.`,
                    error,
                  );
                }
                registered.layer.setRenderState('resident');
                this.zombiesSplatOwnershipDirty = true;
                if (this.zombiesPlayspaceReady) {
                  this.completeZombiesSplatFrame(this.player.position, true);
                }
              }
              roomProgress.set(registered.world.id, 1);
              neighbors.push(registered);
            } catch (error) {
              this.mintWorldLoadFailures += 1;
              this.telemetry.setRoomState(
                entry.world.id,
                'failed',
                error instanceof Error ? error.message : String(error),
              );
              console.warn(
                `Zombies Mint world ${entry.world.id} failed during register.`,
                error,
              );
            }
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(concurrency, indexes.length) },
            () => worker(),
          ),
        );
        };
        // Soft-warm hub doorway destinations one at a time so LoD camera
        // overrides do not fight. Far rooms attach afterward without warm steal.
        await loadNeighborBatch(adjacentIndexes, 1, true);
        await loadNeighborBatch(farIndexes, 2, false);
        this.zombiesSplatOwnershipDirty = true;
        const ready = [hub, ...neighbors];
        this.telemetry.end(
          'zombies.world-stream',
          `${ready.length}/${worlds.length}`,
        );
        return ready;
      } finally {
        window.clearInterval(pagerKeepAlive);
      }
    })();
    const stream: ZombiesWorldStream = {
      firstReady,
      allReady: loadAllRooms,
      settled: false,
    };
    stream.allReady = loadAllRooms
      .then((ready) => {
        stream.settled = true;
        this.zombiesStreamProgressListeners.clear();
        return ready;
      })
      .catch((error) => {
        stream.settled = true;
        this.zombiesStreamProgressListeners.clear();
        this.telemetry.end(
          'zombies.world-stream',
          error instanceof Error ? error.message : String(error),
        );
        if (this.zombiesWorldStream === stream) {
          this.zombiesWorldStream = null;
        }
        throw error;
      });
    // `firstReady` is the deployment gate. Consume a possible background
    // rejection here as well so prefetch failures never become unhandled.
    void stream.allReady.catch(() => undefined);
    this.zombiesWorldStream = stream;
    return stream;
  }

  private async loadZombiesWorldWithRetry(
    world: MintWorldRecord,
    index: number,
    total: number,
    roomProgress: Map<string, number>,
    publishProgress: (label: string) => void,
  ): Promise<ZombiesWorldEntry | null> {
    const existing = this.mintWorldLayers.get(world.id);
    if (existing) {
      this.telemetry.setRoomState(world.id, 'resident', 'cached');
      return { world, index, layer: existing };
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        this.telemetry.setRoomState(
          world.id,
          'loading',
          `attempt ${attempt}`,
        );
        const layer = await MintWorldLayer.load(
          this.scene,
          this.renderer,
          this.physics,
          world,
          ({ progress, label }) => {
            roomProgress.set(
              world.id,
              THREE.MathUtils.clamp(progress, 0, 1) * 0.7,
            );
            if (progress >= 0.8) {
              this.telemetry.setRoomState(world.id, 'collider-ready', label);
            } else if (progress >= 0.06) {
              this.telemetry.setRoomState(world.id, 'header-ready', label);
            }
            publishProgress(
              `${label} // room ${index + 1}/${total}`,
            );
          },
          {
            // Authored navigation owns containment physics. Still decode the
            // hub collider GLB so bounds/diagnostics are real; neighbors stay
            // deferred so six-room deploy does not pay ~21 MB × 5 up front.
            registerCollision: false,
            skipCollider:
              world.id !==
              this.zombiesNavigationSurface.layout.startRoomId,
          },
        );
        roomProgress.set(world.id, 0.7);
        publishProgress(
          `Containment room ${index + 1} stream ready`,
        );
        return { world, index, layer };
      } catch (error) {
        if (attempt < 2) {
          publishProgress(
            `Retrying containment room ${index + 1}`,
          );
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 250),
          );
          continue;
        }
        this.mintWorldLoadFailures += 1;
        roomProgress.set(world.id, 1);
        this.telemetry.setRoomState(
          world.id,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
        publishProgress(`Containment room ${index + 1} failed`);
        console.warn(`Zombies Mint world ${world.id} unavailable.`, error);
        return null;
      }
    }
    return null;
  }

  private registerZombiesWorld(
    entry: ZombiesWorldEntry,
    roomProgress: Map<string, number>,
    publishProgress: (label: string) => void,
    streamGeneration?: number,
  ): ZombiesWorldEntry {
    if (
      streamGeneration !== undefined &&
      streamGeneration !== this.zombiesWorldStreamGeneration
    ) {
      entry.layer.dispose();
      throw new Error('Zombies world stream cancelled');
    }
    // Maps Outbreak owns the pager — never re-attach campus rooms over it.
    if (this.playMode === 'maps-zombies') {
      entry.layer.dispose();
      throw new Error('Zombies world stream cancelled');
    }
    const { world, index, layer } = entry;
    this.telemetry.setRoomState(world.id, 'root-ready');
    layer.setRenderState('resident');
    this.zombiesSplatOwnershipDirty = true;
    this.mintWorldLayers.set(world.id, layer);
    this.mintWorldRoles.set(world.id, 'zombies');
    if (!this.mintZombiesRoomIds.includes(world.id)) {
      this.mintZombiesRoomIds.push(world.id);
    }
    this.configureZombiesRoomLayer(world.id, layer);
    // Many paged RADs already expose a root page at stream-ready. Count that
    // as warmed so background soft-warm is not required for release gates.
    const alreadyWarmed = layer.markWarmedIfResident();
    this.telemetry.setRoomState(world.id, 'resident');
    roomProgress.set(world.id, alreadyWarmed ? 1 : 0.9);
    publishProgress(
      alreadyWarmed
        ? `Containment room ${index + 1} ready`
        : `Containment room ${index + 1} stream ready`,
    );
    return entry;
  }

  private async warmZombiesWorld(
    entry: ZombiesWorldEntry,
    roomProgress: Map<string, number>,
    publishProgress: (label: string) => void,
    timeoutMs = 800,
  ): Promise<ZombiesWorldEntry> {
    const { world, index, layer } = entry;
    if (layer.markWarmedIfResident() || layer.diagnostics().rootPageWarmed) {
      roomProgress.set(world.id, 1);
      publishProgress(`Containment room ${index + 1} ready`);
      return entry;
    }
    roomProgress.set(world.id, 0.82);
    publishProgress(`Warming containment room ${index + 1} splats`);
    // Spark only materializes a usable LoD tree under a real in-room camera.
    // The layer origin can sit in sparse capture space, so warm from the
    // authored navigation anchor toward a connected doorway instead.
    for (const loadedId of this.mintZombiesRoomIds) {
      if (loadedId === world.id) continue;
      this.mintWorldLayers.get(loadedId)?.setRenderState('resident');
    }
    this.zombiesSplatOwnershipDirty = true;
    const contract = this.zombiesRoomContracts.get(world.id);
    const connectedPortal = this.zombiesNavigationSurface.portals.find(
      (portal) =>
        portal.source.fromRoomId === world.id ||
        portal.source.toRoomId === world.id,
    );
    const doorway = connectedPortal
      ? connectedPortal.source.fromRoomId === world.id
        ? connectedPortal.from
        : connectedPortal.to
      : null;
    const warmPosition = (
      contract?.anchor ?? layer.root.getWorldPosition(new THREE.Vector3())
    ).clone();
    warmPosition.y += 1.62;
    const warmDirection = doorway
      ? doorway.clone().sub(warmPosition)
      : new THREE.Vector3(0, 0, -1);
    warmDirection.y = 0;
    if (warmDirection.lengthSq() <= 1e-6) warmDirection.set(0, 0, -1);
    warmDirection.normalize();
    const warmQuaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      warmDirection,
    );
    layer.setRenderState('prefetch');
    layer.setPrefetchLodScale(1);
    const warmed = await layer.warmPagedView(
      warmPosition,
      warmQuaternion,
      timeoutMs,
      undefined,
      {
        stealLodCamera: true,
        // Match Maps Outbreak: driveLod alone requests chunk 0 but never
        // consumes the fetch. spark.update publishes the display mapping.
        publishDisplayMapping: true,
      },
    );
    layer.setRenderState('resident');
    this.zombiesSplatOwnershipDirty = true;
    if (this.zombiesPlayspaceReady) {
      this.completeZombiesSplatFrame(this.player.position, true);
    }
    if (!warmed && !layer.markWarmedIfResident()) {
      const failedDiagnostics = layer.diagnostics();
      throw new Error(
        `${world.id} paged RAD did not become resident: ${JSON.stringify(failedDiagnostics)}`,
      );
    }
    roomProgress.set(world.id, 1);
    publishProgress(`Containment room ${index + 1} ready`);
    return entry;
  }

  /**
   * Gate first playable on a hub that is both pager-resident and present in
   * Spark's published display mapping with the owner filter able to paint.
   * Residency alone can still yield a black void for one or more frames.
   */
  private async ensureZombiesHubFirstFrameReady(
    timeoutMs = 12_000,
  ): Promise<void> {
    const hubId = this.zombiesNavigationSurface.layout.startRoomId;
    const layer = this.mintWorldLayers.get(hubId);
    if (!layer) return;

    layer.setRenderState('primary');
    MintWorldLayer.setRenderOwners(hubId);
    MintWorldLayer.ensureLiveSparkCamera();
    this.zombiesSplatFrameOwner = hubId;
    this.zombiesSplatOwnershipDirty = true;
    this.completeZombiesSplatFrame(this.player.position, true);

    const minSplats = 10_000;
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      MintWorldLayer.ensureLiveSparkCamera();
      this.completeZombiesSplatFrame(this.player.position, true);
      MintWorldLayer.prepareCutRendering(this.camera);
      // Drive one live Spark update so residency can become a painted frame.
      this.renderer.render(this.scene, this.camera);
      const diagnostics = layer.diagnostics();
      const ownerReady = MintWorldLayer.ownerMappingReady(hubId);
      const sparkLive = MintWorldLayer.isSparkAutoUpdateEnabled();
      if (
        diagnostics.rootPageResident &&
        diagnostics.activeSplats >= minSplats &&
        diagnostics.mappedSplats >= minSplats &&
        diagnostics.handoffReady &&
        ownerReady &&
        diagnostics.splatVisible &&
        diagnostics.splatOpacity > 0.5 &&
        sparkLive
      ) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        MintWorldLayer.prepareCutRendering(this.camera);
        return;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }

    throw new Error(
      `Zombies hub first-frame paint gate timed out: ${JSON.stringify({
        ...layer.diagnostics(),
        ownerMappingReady: MintWorldLayer.ownerMappingReady(hubId),
        sparkAutoUpdate: MintWorldLayer.isSparkAutoUpdateEnabled(),
      })}`,
    );
  }

  private configureZombiesRoomLayer(
    id: string,
    layer: MintWorldLayer,
  ): void {
    const authored = this.zombiesNavigationSurface.room(id);
    if (!authored) {
      throw new Error(`Missing authored Zombies layout room ${id}`);
    }
    layer.setCutVolumes(
      this.zombiesNavigationSurface.layout.cutVolumes ?? [],
    );
    layer.setTrimPlanes(
      this.zombiesNavigationSurface.layout.trimPlanes ?? [],
    );
    layer.applyAuthoredTransform(
      [
        authored.source.transform.position[0],
        authored.source.transform.position[1] +
          authored.navigationCalibrationY,
        authored.source.transform.position[2],
      ],
      authored.source.transform.rotation,
      authored.source.transform.scale,
    );
    this.zombiesRoomContracts.set(id, {
      walkableBounds: authored.bounds.clone(),
      anchor: authored.anchor.clone(),
      floorY: authored.floorY,
    });
  }

  private hordeMintFactory(): void {
    this.zombies.horde.setMintFactory(async (archetype) => {
      const sprinter = archetype === 'sprinter';
      const requestedId = sprinter ? 'zombie-sprinter' : 'zombie-walker';
      // The finalized sprinter asset has invalid skin weights around its head.
      // Present sprinters with the stable finalized walker rig and distinguish
      // them by a leaner silhouette and red contamination tint.
      const presentationId = sprinter ? 'zombie-walker' : requestedId;
      const [visual, clips] = await Promise.all([
        this.assets.instantiateModel(presentationId),
        this.assets.loadRoleAnimationSet('animation-zombie-horde', 'walker'),
      ]);
      if (!visual) return null;
      const presentationHeight = zombiePresentationFor(archetype).height;
      normalizeMintModel(visual, presentationHeight);
      visual.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(visual);
      if (Number.isFinite(bounds.min.y)) {
        visual.position.y -= bounds.min.y;
      }
      // Normalize from the authored Head -> headfront marker. Hips +Z is not a
      // reliable proxy for the visible face on either generated rig.
      visual.rotation.y = 0;
      visual.updateWorldMatrix(true, true);
      visual.rotation.y = modelHeadfrontYawOffsetToActorForward(visual);
      const presentation = buildZombiePresentation(visual, archetype);
      presentation.traverse((obj) => {
        obj.userData.zombieArchetype = archetype;
        obj.userData.mintZombieSource = presentationId;
        obj.userData.mintZombieRequestedSource = requestedId;
      });
      return { visual: presentation, clips };
    });
  }

  private updateZombies(delta: number, elapsed: number): void {
    if (this.campusTour && !this.campusTour.done) {
      this.updateCampusTour(delta, elapsed);
      this.completeZombiesSplatFrame(this.player.position);
      this.weaponView.update(
        delta,
        this.weapon,
        elapsed,
        this.player.locomotionSample(),
      );
      this.vfx.update(delta, elapsed);
      return;
    }
    if (this.input.wasPressed('Escape')) {
      this.pauseZombies();
      return;
    }
    if (this.hasLockedOnce && this.spawnProtectionRemaining > 0) {
      const wasProtected = this.isSpawnProtected();
      this.spawnProtectionRemaining = Math.max(
        0,
        this.spawnProtectionRemaining - delta,
      );
      if (wasProtected && !this.isSpawnProtected()) {
        this.ui.caption('Insertion shield offline // Hostiles can engage');
      }
    }
    const fixedStarted = performance.now();
    this.player.updateLook(this.input, this.persistence.state.settings.accessibility);
    this.fixedAccumulator += Math.min(delta, 0.08);
    while (this.fixedAccumulator >= FIXED_TIMESTEP) {
      this.zombiesPlayerStepPrevious.copy(this.player.position);
      this.player.updateFixed(
        FIXED_TIMESTEP,
        this.input,
        this.persistence.state.settings.accessibility,
      );
      const transition = this.resolveZombiesSplatFrameTransition(
        this.zombiesPlayerStepPrevious,
        this.player.position,
      );
      if (transition) {
        // Crossing a portal changes only splat ownership. Never cover the
        // moving camera with a static source-room frame: that makes continuous
        // physics look like a teleport when the held image is released.
        this.zombiesPreviousSplatFrameOwner = transition.fromId;
        this.zombiesPreviousSplatSeamCleared = false;
        this.zombiesSplatFrameOwner = transition.toId;
        this.zombiesSplatOwnershipDirty = true;
        this.completeZombiesSplatFrame(this.player.position);
      }
      this.zombies.updateHordeFixed(
        FIXED_TIMESTEP,
        this.player,
        (x, z, preferY) => {
          const sample = this.physics.sampleSurface(x, z, preferY);
          return sample?.point.y ?? preferY;
        },
        {
          invulnerable: this.isSpawnProtected(),
          playerRoomId: this.zombiesSplatFrameOwner,
        },
      );
      this.fixedAccumulator -= FIXED_TIMESTEP;
    }
    this.telemetry.recordWork(
      'zombies.fixed-simulation',
      performance.now() - fixedStarted,
    );
    const presentationStarted = performance.now();
    const weaponEvents = this.weapon.update(
      delta,
      this.input,
      this.player.isSprinting,
      this.player.wantsAim(),
    );
    for (const event of weaponEvents) this.handleWeaponEvent(event);
    this.player.updateCamera(
      delta,
      elapsed,
      this.persistence.state.settings.accessibility,
      this.weapon.adsFactor,
    );
    this.completeZombiesSplatFrame(this.player.position);
    this.weaponView.update(
      delta,
      this.weapon,
      elapsed,
      this.player.locomotionSample(),
    );
    this.footstepTimer -= delta;
    if (this.player.speed > 1.6 && this.footstepTimer <= 0) {
      this.audio.footstep('concrete');
      this.footstepTimer = this.player.isSprinting ? 0.31 : 0.48;
    }
    this.telemetry.recordWork(
      'zombies.player-presentation',
      performance.now() - presentationStarted,
    );

    const systemsStarted = performance.now();
    const roomTransitOwnsInteraction =
      this.zombiesRoomTransitOwnsInteraction();
    this.zombies.update(
      delta,
      this.player,
      this.input,
      (x, z, preferY) => {
        const sample = this.physics.sampleSurface(x, z, preferY);
        return sample?.point.y ?? preferY;
      },
      {
        invulnerable: this.isSpawnProtected(),
        playerRoomId: this.zombiesSplatFrameOwner,
        hordeAlreadyUpdated: true,
        interactionReserved: roomTransitOwnsInteraction,
      },
    );
    this.weapon.setPerkScales(
      this.zombies.perks.reloadScale(),
      this.zombies.perks.fireRateScale(),
    );
    this.telemetry.recordWork(
      'zombies.gameplay-systems',
      performance.now() - systemsStarted,
    );

    const hudStarted = performance.now();
    const hud = this.zombies.getHudState();
    const roomTransitPrompt = this.updateZombiesRoomTransit(
      elapsed,
      Boolean(hud.prompt),
    );
    if (hud.lastStand && !this.previousZombiesLastStand) {
      this.audio.zombiesLastStand();
    }
    this.previousZombiesLastStand = hud.lastStand;
    this.ui.setInteractionPrompt(roomTransitPrompt || hud.prompt);
    const currentRoomId = this.currentZombiesRoomId();
    const roomNavigation = this.zombiesRoomTransit.getNavigation(
      this.player.position,
      currentRoomId,
    );
    this.ui.updateZombiesHud(
      delta,
      this.player,
      this.weapon,
      hud,
      roomNavigation,
      Boolean(this.findMeleeTarget(false)),
    );
    this.telemetry.recordWork(
      'zombies.hud-navigation',
      performance.now() - hudStarted,
    );
  }

  private currentZombiesRoomId(): string | null {
    return (
      this.zombiesNavigationSurface.roomIdForPosition(
        this.player.position,
        0.34,
      ) ?? this.zombiesSplatFrameOwner
    );
  }

  private syncZombiesRoomTransitProgression(): void {
    const progression = this.zombies.buyables.getProgressionState();
    this.zombiesRoomTransit.setProgressionState(
      progression.powerOn,
      progression.openDoorIds,
    );
  }

  private zombiesRoomTransitOwnsInteraction(): boolean {
    if (this.zombies.getHudState().lastStand) return false;
    this.syncZombiesRoomTransitProgression();
    const currentRoomId = this.currentZombiesRoomId();
    const navigation = this.zombiesRoomTransit.getNavigation(
      this.player.position,
      currentRoomId,
    );
    if (navigation.target && navigation.target.kind !== 'relay') {
      return false;
    }
    return Boolean(
      this.zombiesRoomTransit.interaction(
        this.player.position,
        currentRoomId,
        navigation.target?.terminalId ?? null,
        Boolean(navigation.target),
      ),
    );
  }

  private updateZombiesRoomTransit(
    elapsed: number,
    buyableOwnsInteraction: boolean,
  ): string {
    this.syncZombiesRoomTransitProgression();
    const currentRoomId = this.currentZombiesRoomId();
    const navigation = this.zombiesRoomTransit.getNavigation(
      this.player.position,
      currentRoomId,
    );
    this.zombiesRoomTransit.updateVisuals(
      elapsed,
      currentRoomId,
      navigation.target?.terminalId ?? null,
    );
    if (buyableOwnsInteraction) return '';
    const preferredTerminalId =
      navigation.target?.kind === 'relay'
        ? navigation.target.terminalId
        : null;
    const destination = this.zombiesRoomTransit.interaction(
      this.player.position,
      currentRoomId,
      preferredTerminalId,
      Boolean(navigation.target),
    );
    if (!destination) return '';
    if (this.input.wasPressed('KeyE')) {
      return this.useZombiesRoomTransit(destination) ? '' : 'Relay unavailable';
    }
    return `Press E // Transit to ${destination.toLabel}`;
  }

  private useZombiesRoomTransit(
    destination: RoomTransitDestination,
  ): boolean {
    if (
      !this.beginZombiesSplatFrameHold(
        0.16,
        destination.toRoomId,
      )
    ) {
      return false;
    }
    if (
      !this.zombiesContainment.commitEntry(
        'player',
        destination.landing,
        0.34,
        destination.toRoomId,
      )
    ) {
      return false;
    }
    this.player.restore(
      {
        ...this.player.snapshot(),
        position: destination.landing.clone(),
      },
      true,
    );
    this.zombiesPreviousSplatFrameOwner = this.zombiesSplatFrameOwner;
    this.zombiesPreviousSplatSeamCleared = false;
    this.zombiesSplatFrameOwner = destination.toRoomId;
    this.zombiesSplatOwnershipDirty = true;
    this.completeZombiesSplatFrame(this.player.position, true);
    this.zombiesRoomTransit.complete(destination);
    this.spawnProtectionRemaining = Math.max(
      this.spawnProtectionRemaining,
      2,
    );
    this.ui.caption(
      `${destination.toLabel} room reached // Follow the next relay`,
    );
    return true;
  }

  private pauseZombies(): void {
    if (!this.isZombiesHudMode()) return;
    this.mode = 'paused';
    this.input.setGameplayEnabled(false);
    this.audio.pause(true);
    this.ui.setMode('paused');
  }

  private resumeZombies(): void {
    if (!['paused', 'zombies', 'maps-zombies'].includes(this.mode)) return;
    this.mode = this.playMode === 'maps-zombies' ? 'maps-zombies' : 'zombies';
    this.input.setGameplayEnabled(true);
    this.audio.pause(false);
    this.ui.setMode(this.mode);
    this.ui.setPointerPrompt(true);
    this.input.requestPointerLock();
  }

  private failZombies(result: ZombiesResult): void {
    if (this.zombiesDeathPresentation) return;
    this.mode = 'dead';
    this.input.setGameplayEnabled(false);
    this.audio.zombiesLastStand();
    this.ui.beginZombiesDownedPresentation();
    this.zombiesDeathPresentation = {
      result,
      elapsed: 0,
      startedAt: performance.now(),
      duration: 1.05,
      cameraPosition: this.camera.position.clone(),
      yaw: this.player.yaw,
      pitch: this.player.pitch,
    };
  }

  private updateZombiesDeathPresentation(_delta: number): boolean {
    const presentation = this.zombiesDeathPresentation;
    if (!presentation) return false;
    // Use wall-clock time so the down animation remains a one-second terminal
    // transition even when dense splat rendering lowers the frame rate.
    presentation.elapsed = Math.max(
      presentation.elapsed,
      (performance.now() - presentation.startedAt) / 1000,
    );
    const progress = THREE.MathUtils.clamp(
      presentation.elapsed / presentation.duration,
      0,
      1,
    );
    const eased = 1 - (1 - progress) ** 3;
    const floorEye = this.player.position.y + 0.2;
    this.camera.position.lerpVectors(
      presentation.cameraPosition,
      new THREE.Vector3(
        this.player.position.x + Math.sin(presentation.yaw) * 0.16,
        floorEye,
        this.player.position.z + Math.cos(presentation.yaw) * 0.16,
      ),
      eased,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(
      THREE.MathUtils.lerp(presentation.pitch, -0.3, eased),
      presentation.yaw,
      THREE.MathUtils.lerp(0, -1.08, eased),
    );
    this.weaponView.setVisible(progress < 0.58);
    this.ui.updateZombiesDownedPresentation(progress);
    if (progress < 1) return true;

    this.zombiesDeathPresentation = null;
    this.audio.pause(true);
    this.persistence.recordZombiesResult(presentation.result);
    this.ui.endZombiesDownedPresentation();
    this.ui.renderZombiesDebrief(presentation.result);
    this.ui.setMode('dead');
    this.weaponView.setVisible(false);
    return true;
  }

  private teardownZombies(): void {
    this.zombiesDeathPresentation = null;
    this.ui.endZombiesDownedPresentation();
    this.zombiesRoomTransit.clear();
    this.stopMapsOutbreakPolling();
    this.mapsOutbreakContainment = null;
    if (!this.zombiesActive) return;
    this.zombies.horde.reset();
    this.zombies.powerUps.reset();
    this.zombies.arena.dispose(this.scene);
    this.zombies.arena.clearMapsOutbreakMode();
    this.player.clearVoidFallRecovery();
    this.zombiesCampus.dispose(this.scene);
    this.zombiesActive = false;
  }

  private pauseMission(): void {
    if (this.mode !== 'mission') return;
    this.mode = 'paused';
    this.input.setGameplayEnabled(false);
    this.audio.pause(true);
    this.ui.setMode('paused');
  }

  private resumeMission(): void {
    if (!['paused', 'mission'].includes(this.mode)) return;
    this.mode = 'mission';
    this.input.setGameplayEnabled(true);
    this.audio.pause(false);
    this.ui.setMode('mission');
    this.ui.setPointerPrompt(true);
    this.input.requestPointerLock();
  }

  private failMission(): void {
    if (this.mode !== 'mission') return;
    this.mode = 'dead';
    this.input.setGameplayEnabled(false);
    this.audio.pause(true);
    this.ui.setMode('dead');
  }

  private completeMission(): void {
    if (this.mode !== 'mission') return;
    const accuracy =
      this.stats.shotsFired > 0 ? (this.stats.shotsHit / this.stats.shotsFired) * 100 : 0;
    const result: MissionResult = {
      timeMs: Math.round(this.stats.elapsedMs),
      accuracy,
      defeated: this.stats.defeated,
      damageTaken: this.stats.damageTaken,
      objectivesCompleted: 4,
      difficulty: this.persistence.state.selectedDifficulty,
    };
    this.persistence.recordResult(result);
    this.mode = 'complete';
    this.input.setGameplayEnabled(false);
    this.weaponView.setVisible(false);
    this.audio.extraction();
    this.ui.renderDebrief(result, this.persistence.state.progress.bestTimeMs);
    this.ui.setMode('complete');
  }

  private captureCheckpoint(
    segment: 0 | 1 | 2,
    position: THREE.Vector3,
  ): void {
    const difficulty = DIFFICULTY_TUNING[this.persistence.state.selectedDifficulty];
    this.player.healAtCheckpoint(difficulty.checkpointArmor);
    this.weapon.refillAtCheckpoint();
    const player = this.player.snapshot();
    player.position.copy(position);
    this.lastCheckpoint = {
      player,
      ammo: this.weapon.snapshotAmmo(),
      mission: this.mission.snapshot(),
      equipmentCount: Math.max(this.equipmentCount, 1),
      segment,
      stats: { ...this.stats },
    };
  }

  private restartCheckpoint(): void {
    const checkpoint = this.lastCheckpoint;
    if (!checkpoint) {
      this.deployMission();
      return;
    }
    this.mode = 'mission';
    this.world.showMission();
    this.setMintWorldVisibility('mission');
    this.weaponView.setVisible(true);
    this.input.setGameplayEnabled(true);
    this.player.restore(checkpoint.player);
    this.weapon.restoreAmmo(checkpoint.ammo);
    this.mission.restore(checkpoint.mission);
    this.equipmentCount = checkpoint.equipmentCount;
    this.stats = { ...checkpoint.stats };
    this.spawnProtectionRemaining = SPAWN_PROTECTION_SECONDS;
    this.enemies.setCheckpointSegment(checkpoint.segment);
    this.vfx.reset();
    this.audio.pause(false);
    this.ui.setMode('mission');
    this.ui.setPointerPrompt(true);
    this.ui.caption('Spawn protection active // Hostiles cannot engage');
    this.hasLockedOnce = false;
  }

  private async openZombiesEditor(previewOnly = false): Promise<void> {
    if (this.zombiesEditor || this.loadingTarget === 'editor') return;
    this.teardownZombies();
    this.mode = 'loading';
    this.loadingTarget = 'editor';
    this.input.setGameplayEnabled(false);
    this.weaponView.setVisible(false);
    this.audio.pause(true);
    this.ui.setMode('loading');
    this.ui.updateLoading(0.04, 'Opening splat placement editor');

    try {
      const { ZombiesEditor: ZombiesEditorRuntime } = await import(
        '../editor/ZombiesEditor'
      );
      this.clearEditorPreviewRoots();
      const rooms: Array<{ id: string; layer: EditorSplatLayer }> = previewOnly
        ? this.zombiesNavigationSurface.rooms.map((room) => {
            const root = new THREE.Group();
            root.name = `editor-preview-${room.source.id}`;
            this.scene.add(root);
            this.editorPreviewRoots.push(root);
            return {
              id: room.source.id,
              layer: {
                root,
                applyAuthoredTransform: (position, rotation, scale) => {
                  root.position.set(...position);
                  root.rotation.set(...rotation);
                  root.scale.setScalar(scale);
                  root.updateMatrixWorld(true);
                },
                setRenderState: (state) => {
                  root.visible = state === 'primary';
                },
                refreshTransform: () => root.updateMatrixWorld(true),
              },
            };
          })
        : await this.ensureZombiesMintWorlds((completed, total, label) => {
            const ratio = total > 0 ? completed / total : 1;
            this.ui.updateLoading(
              0.08 + ratio * 0.72,
              `${label} // ${Math.min(Math.floor(completed) + 1, total)}/${total}`,
            );
          });
      if (rooms.length !== this.zombiesNavigationSurface.rooms.length) {
        throw new Error(
          `Editor loaded ${rooms.length}/${this.zombiesNavigationSurface.rooms.length} splat rooms`,
        );
      }
      const calibrationByRoom = new Map<string, number>();
      for (const room of rooms) {
        const authored = this.zombiesNavigationSurface.room(room.id);
        if (!authored) throw new Error(`Missing authored editor room ${room.id}`);
        calibrationByRoom.set(room.id, authored.navigationCalibrationY);
        room.layer.applyAuthoredTransform(
          [
            authored.source.transform.position[0],
            authored.source.transform.position[1] +
              authored.navigationCalibrationY,
            authored.source.transform.position[2],
          ],
          authored.source.transform.rotation,
          authored.source.transform.scale,
        );
      }

      const startRoom = this.zombiesNavigationSurface.startRoom();
      const hubBounds = startRoom.bounds.clone();
      hubBounds.min.y = startRoom.floorY - 0.5;
      hubBounds.max.y = startRoom.floorY + 3.8;
      this.zombies.arena.fitLayoutToBounds(hubBounds, startRoom.floorY);
      this.zombies.arena.distributeAcrossRooms(
        this.zombiesNavigationSurface.rooms,
      );
      this.zombies.arena.useAuthoredDoorEntries(
        this.zombiesNavigationSurface.allWallCrawlSockets(),
      );
      const surfacePlacement = this.zombies.arena.seatAnchorsOnSurfaces(
        this.zombiesNavigationSurface.rooms,
        () => new Map(),
      );
      if (surfacePlacement.failures.length > 0) {
        throw new Error(
          `Editor placement bootstrap failed: ${surfacePlacement.failures.join(', ')}`,
        );
      }
      const placementValidation = validateZombiesPlacementLayout(
        ZOMBIES_PLACEMENT_LAYOUT,
        this.zombiesNavigationSurface.rooms.map((room) => room.source.id),
      );
      if (!placementValidation.valid) {
        throw new Error(
          `Saved placement layout is invalid: ${placementValidation.errors.join('; ')}`,
        );
      }
      const ignored = this.zombies.arena.applyPlacementLayout(
        ZOMBIES_PLACEMENT_LAYOUT,
      );
      if (ignored.length > 0) {
        throw new Error(`Unknown saved editor placements: ${ignored.join(', ')}`);
      }

      this.world.showOperations();
      this.physics.setFacilityCollidersEnabled(false);
      this.setMintWorldVisibility('zombies');
      MintWorldLayer.setGlobalCutVolumes(
        this.zombiesNavigationSurface.layout.cutVolumes ?? [],
      );
      MintWorldLayer.setGlobalTrimPlanes(
        this.zombiesNavigationSurface.layout.trimPlanes ?? [],
      );
      this.zombiesSplatClipKey = '*';
      for (const room of rooms) room.layer.setRenderState('primary');
      this.splatCampus.setVisible(false);
      this.zombiesCampus.dispose(this.scene);
      this.enemies.enemies.forEach((enemy) => {
        enemy.group.visible = false;
      });
      this.ui.updateLoading(0.96, 'Indexing splats and placements');
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      this.mode = 'editor';
      this.loadingTarget = null;
      this.ui.setMode('editor');
      this.zombiesEditor = new ZombiesEditorRuntime({
        scene: this.scene,
        camera: this.camera,
        canvas: this.canvas,
        uiParent: this.rootElement(),
        rooms: new Map(rooms.map((room) => [room.id, room.layer])),
        arena: this.zombies.arena,
        layout: this.zombiesNavigationSurface.layout,
        navigationCalibrationByRoom: calibrationByRoom,
        onExit: () => this.showOperations(),
        onPlaytest: () => {
          this.zombiesEditor?.dispose(false);
          this.zombiesEditor = null;
          this.clearEditorPreviewRoots();
          window.location.reload();
        },
        onProjectSaved: (payload) => {
          this.applySavedZombiesEditorAssets(payload);
        },
      });
      this.audio.pause(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown editor loading failure';
      console.error('Zombies editor failed to open.', error);
      this.ui.showLoadingError(message);
    }
  }

  private showOperations(): void {
    this.applySceneAtmosphere('operations');
    this.missionDeploymentRevision += 1;
    if (this.zombiesEditor) {
      const editor = this.zombiesEditor;
      this.zombiesEditor = null;
      editor.dispose(true);
    }
    this.clearEditorPreviewRoots();
    this.teardownZombies();
    this.playMode = 'mission';
    this.mode = 'operations';
    this.loadingTarget = null;
    this.spawnProtectionRemaining = 0;
    this.input.setGameplayEnabled(false);
    this.weaponView.setVisible(false);
    this.canvas.style.filter = '';
    this.world.showOperations();
    this.setMintWorldVisibility('operations');
    this.updateOperationsWeapon();
    this.ui.renderOperations(this.persistence.state);
    this.ui.renderSettings(this.persistence.state.settings);
    this.ui.setMode('operations');
    this.camera.position.set(104.9, 2.65, 7.2);
    this.camera.lookAt(100.4, 1.25, -0.3);
    this.audio.pause(false);
  }

  /**
   * Hot-reload editor-saved splat/placement assets into the live Game so
   * Save → Exit → Play Zombies works without a full page reload.
   */
  private applySavedZombiesEditorAssets(
    payload: ZombiesEditorSavePayload,
  ): void {
    syncZombiesSplatModuleAssets(
      payload.layout,
      payload.navigation as unknown as SplatNavigationBakeAsset,
    );
    replaceZombiesPlacementLayout(payload.placements);
    this.zombiesNavigationSurface = new SplatNavigationSurface();
    this.zombiesContainment = new SplatContainment(
      this.zombiesNavigationSurface,
    );
    this.zombiesSplatClipKey = '';
    MintWorldLayer.setGlobalCutVolumes(
      this.zombiesNavigationSurface.layout.cutVolumes ?? [],
    );
    MintWorldLayer.setGlobalTrimPlanes(
      this.zombiesNavigationSurface.layout.trimPlanes ?? [],
    );
  }

  private updateOperationsCamera(delta: number): void {
    const target = new THREE.Vector3(104.9, 2.65, 7.2);
    this.camera.position.lerp(target, Math.min(1, delta * 4));
    this.camera.lookAt(100.4, 1.25, -0.3);
  }

  private selectAttachment(value: string): void {
    const [slot, attachmentId] = value.split(':');
    const selection = this.persistence.state.loadout.attachments[this.inspectedWeaponId];
    if (!selection || !slot || !attachmentId) return;
    if (!['optic', 'muzzle', 'magazine', 'grip', 'stock'].includes(slot)) return;
    const attachmentSlot = slot as keyof typeof selection;
    const previousId = selection[attachmentSlot];
    selection[attachmentSlot] = attachmentId;
    this.ui.setAttachmentChange({
      weaponId: this.inspectedWeaponId,
      slot: attachmentSlot,
      previousId,
      currentId: attachmentId,
    });
    this.saveLoadout();
    this.updateArmoryWeapon(attachmentId);
  }

  private saveLoadout(): void {
    this.persistence.save();
    this.weapon.setLoadout(this.persistence.state.loadout);
    this.ui.renderLoadout(this.persistence.state.loadout);
    this.updateOperationsWeapon();
    this.ui.renderOperations(this.persistence.state);
  }

  private updateOperationsWeapon(): void {
    const revision = ++this.operationsWeaponRevision;
    const weapon = getWeapon(this.inspectedWeaponId);
    if (this.assets.visibleFallbacksAllowed) {
      this.world.setOperationsWeapon(
        weapon,
        this.persistence.state.loadout.attachments[weapon.id],
      );
    } else {
      this.world.clearOperationsWeapon();
    }
    void this.upgradeOperationsWeapon(weapon.id, revision);
  }

  private updateArmoryWeapon(selectedAttachmentId = ''): void {
    const weapon = getWeapon(this.inspectedWeaponId);
    const attachments = this.persistence.state.loadout.attachments[weapon.id];
    if (!attachments) return;
    void this.armoryPreview.setWeapon(weapon, attachments, selectedAttachmentId);
  }

  private async upgradeOperationsWeapon(
    weaponId: string,
    revision: number,
  ): Promise<void> {
    if (!this.assets.getArtifact(`weapon-${weaponId}`, 'model')) return;
    try {
      const source = await this.assets.instantiateModel(`weapon-${weaponId}`);
      if (!source || revision !== this.operationsWeaponRevision) return;
      const weapon = getWeapon(weaponId);
      const model = prepareMintWeaponModel(source, weapon);
      await installMintAttachments(
        model,
        this.persistence.state.loadout.attachments[weapon.id],
        this.assets,
        weapon,
      );
      if (revision !== this.operationsWeaponRevision) return;
      this.world.setOperationsWeaponModel(model);
    } catch (error) {
      console.warn(`Mint operations weapon failed to load: ${weaponId}`, error);
    }
  }

  /**
   * Keep a portal render bound to the room side that physically owns it. Data
   * can be warm from anywhere, but presentation requires an interior camera,
   * a forward-facing view, and a projected aperture on screen. This prevents a
   * destination RAD or connector from appearing through unrelated splat walls.
   */
  private zombiesPortalLandingSpan(portal: SplatWorldPortal): number {
    const connectorRadius =
      this.zombiesNavigationSurface.layout.largestActorCapsuleRadius;
    const from = this.zombiesNavigationSurface.portalLandingPoint(
      portal.source.id,
      portal.source.fromRoomId,
      connectorRadius,
    );
    const to = this.zombiesNavigationSurface.portalLandingPoint(
      portal.source.id,
      portal.source.toRoomId,
      connectorRadius,
    );
    return from && to
      ? Math.hypot(to.x - from.x, to.z - from.z)
      : 0;
  }

  /** Find the physical long connector currently containing the player. */
  private zombiesAuthoredConnectorAt(
    position: THREE.Vector3,
    includeEndpointGrace = true,
  ): SplatWorldPortal | null {
    const connectorRadius =
      this.zombiesNavigationSurface.layout.largestActorCapsuleRadius;
    for (const portal of this.zombiesNavigationSurface.portals) {
      const from = this.zombiesNavigationSurface.portalLandingPoint(
        portal.source.id,
        portal.source.fromRoomId,
        connectorRadius,
      );
      const to = this.zombiesNavigationSurface.portalLandingPoint(
        portal.source.id,
        portal.source.toRoomId,
        connectorRadius,
      );
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSquared = dx * dx + dz * dz;
      if (
        lengthSquared <= ZOMBIES_AUTHORED_CONNECTOR_MIN_SPAN ** 2
      ) {
        continue;
      }
      const rawT =
        ((position.x - from.x) * dx + (position.z - from.z) * dz) /
          lengthSquared;
      // The physical landing planes belong to the connector too. Excluding
      // t===0/1 dropped the secondary splat for one frame at each seam and
      // exposed the source RAD's flat trim/cut colour as a grey door. Keep
      // room-side approaches facing-gated by zombiesActivePortalId, but own
      // the complete closed segment, including both exact endpoints.
      const endpointGraceT = includeEndpointGrace
        ? ZOMBIES_CONNECTOR_ENDPOINT_GRACE / Math.sqrt(lengthSquared)
        : 0;
      if (rawT < -endpointGraceT || rawT > 1 + endpointGraceT) continue;
      const t = THREE.MathUtils.clamp(rawT, 0, 1);
      const nearestX = from.x + dx * t;
      const nearestZ = from.z + dz * t;
      if (
        Math.hypot(position.x - nearestX, position.z - nearestZ) <=
        portal.source.width * 0.5 + 0.9
      ) {
        return portal;
      }
    }
    return null;
  }

  /** Build the owner-side aperture that joins a room RAD to its connector. */
  private zombiesConnectorCutVolumes(
    portal: SplatWorldPortal,
    roomId: string,
  ): SplatCutVolume[] {
    if (
      portal.source.fromRoomId !== roomId &&
      portal.source.toRoomId !== roomId
    ) {
      return [];
    }
    const room = this.zombiesNavigationSurface.room(roomId);
    const connectorRadius =
      this.zombiesNavigationSurface.layout.largestActorCapsuleRadius;
    const landing = this.zombiesNavigationSurface.portalLandingPoint(
      portal.source.id,
      roomId,
      connectorRadius,
    );
    const approach = this.zombiesNavigationSurface.portalApproachPoint(
      portal.source.id,
      roomId,
      2.2,
    );
    const otherRoomId =
      portal.source.fromRoomId === roomId
        ? portal.source.toRoomId
        : portal.source.fromRoomId;
    const otherLanding = this.zombiesNavigationSurface.portalLandingPoint(
      portal.source.id,
      otherRoomId,
      connectorRadius,
    );
    if (!room || !landing || !approach || !otherLanding) return [];
    const outward = landing.clone().sub(approach).setY(0);
    if (outward.lengthSq() <= 1e-6) return [];
    outward.normalize();
    const inside = approach.clone().addScaledVector(outward, -0.8);
    const outside = landing.clone().addScaledVector(outward, 1.25);
    const height = 3.55;
    const width = Math.max(5, portal.source.width) + 0.62;
    const makeCut = (
      suffix: string,
      start: THREE.Vector3,
      end: THREE.Vector3,
    ): SplatCutVolume | null => {
      const direction = end.clone().sub(start).setY(0);
      const depth = direction.length();
      if (depth <= 1e-4) return null;
      direction.multiplyScalar(1 / depth);
      const center = start.clone().lerp(end, 0.5);
      center.y = room.floorY + height * 0.5 + 0.025;
      return {
        id: `connector-aperture:${portal.source.id}:${roomId}:${suffix}`,
        roomId,
        portalId: portal.source.id,
        position: [center.x, center.y, center.z],
        rotation: [0, Math.atan2(direction.x, direction.z), 0],
        // local X = doorway width, local Z = through-wall/approach depth
        size: [width, height, depth],
        enabled: true,
      };
    };
    const spanDirection = otherLanding.clone().sub(landing).setY(0);
    if (spanDirection.lengthSq() <= 1e-6) return [];
    spanDirection.normalize();
    // A local entry cut follows the room's real approach. A second cut follows
    // the landing-to-landing leg. They must be separate because folded joins
    // can turn 30–90 degrees at the seam; one long OBB then misses a wedge of
    // the source RAD and leaves grey splats floating inside the connector.
    return [
      makeCut('entry', inside, outside),
      makeCut(
        'span',
        landing.clone().addScaledVector(spanDirection, -1.25),
        otherLanding.clone().addScaledVector(spanDirection, 1.25),
      ),
    ].filter((cut): cut is SplatCutVolume => cut !== null);
  }

  /** Keep the tertiary destination RAD on the room side of its far landing. */
  private zombiesConnectorTrimPlane(
    portal: SplatWorldPortal,
    roomId: string,
  ): SplatTrimPlane | null {
    const room = this.zombiesNavigationSurface.room(roomId);
    const connectorRadius =
      this.zombiesNavigationSurface.layout.largestActorCapsuleRadius;
    const landing = this.zombiesNavigationSurface.portalLandingPoint(
      portal.source.id,
      roomId,
      connectorRadius,
    );
    const approach = this.zombiesNavigationSurface.portalApproachPoint(
      portal.source.id,
      roomId,
      2.2,
    );
    if (!room || !landing || !approach) return null;
    const interior = approach.clone().sub(landing).setY(0);
    if (interior.lengthSq() <= 1e-6) return null;
    interior.normalize();
    return {
      id: `connector-destination-trim:${portal.source.id}:${roomId}`,
      roomId,
      portalId: portal.source.id,
      position: [landing.x, room.floorY + 1.8, landing.z],
      rotation: [0, Math.atan2(interior.x, interior.z), 0],
      keepSide: 'positive',
      enabled: true,
    };
  }

  private isZombiesPortalVisibleFromOwner(
    portal: SplatWorldPortal,
    ownerId: string,
    ownerAperture: THREE.Vector3,
  ): boolean {
    const ownerIsFrom = portal.source.fromRoomId === ownerId;
    if (!ownerIsFrom && portal.source.toRoomId !== ownerId) return false;
    const ownerRoom = this.zombiesNavigationSurface.room(ownerId);
    if (!ownerRoom) return false;
    const sourceSocketId = ownerIsFrom
      ? portal.source.fromSocketId
      : portal.source.toSocketId;
    const sourceSocket = ownerRoom.source.doorwaySockets.find(
      (socket) => socket.id === sourceSocketId,
    );
    const interior = this.zombiesNavigationSurface.portalApproachPoint(
      portal.source.id,
      ownerId,
      1.4,
    );
    if (!interior) return false;

    const halfHeight =
      THREE.MathUtils.clamp(sourceSocket?.height ?? 3.2, 2.8, 3.6) * 0.5;
    zombiesPortalCenter.copy(ownerAperture);
    zombiesPortalCenter.y = ownerRoom.floorY + halfHeight;
    zombiesPortalInterior.copy(interior);
    zombiesPortalInterior.y = zombiesPortalCenter.y;
    zombiesPortalOutward
      .copy(zombiesPortalCenter)
      .sub(zombiesPortalInterior)
      .setY(0);
    if (zombiesPortalOutward.lengthSq() <= 1e-6) return false;
    zombiesPortalOutward.normalize();

    this.camera.getWorldPosition(zombiesPortalCameraPosition);
    const cameraOnInteriorSide =
      zombiesPortalToAperture
        .copy(zombiesPortalCameraPosition)
        .sub(zombiesPortalCenter)
        .dot(zombiesPortalOutward) <= ZOMBIES_PORTAL_OWNER_SIDE_GRACE;
    zombiesPortalToAperture
      .copy(zombiesPortalCenter)
      .sub(zombiesPortalCameraPosition);
    const distance = zombiesPortalToAperture.length();
    if (
      !cameraOnInteriorSide ||
      distance < 0.05 ||
      distance > ZOMBIES_PORTAL_RENDER_DISTANCE
    ) {
      return false;
    }
    this.camera.getWorldDirection(zombiesSplatLookDirection);
    if (
      zombiesSplatLookDirection.dot(
        zombiesPortalToAperture.multiplyScalar(1 / distance),
      ) < ZOMBIES_PORTAL_FACING_COSINE
    ) {
      return false;
    }
    zombiesPortalRight.set(
      zombiesPortalOutward.z,
      0,
      -zombiesPortalOutward.x,
    );
    let minimumX = Number.POSITIVE_INFINITY;
    let maximumX = Number.NEGATIVE_INFINITY;
    let minimumY = Number.POSITIVE_INFINITY;
    let maximumY = Number.NEGATIVE_INFINITY;
    let hasVisibleDepth = false;
    for (const horizontal of [-1, 1]) {
      for (const vertical of [-1, 1]) {
        zombiesPortalCorner
          .copy(zombiesPortalCenter)
          .addScaledVector(
            zombiesPortalRight,
            horizontal * portal.source.width * 0.5,
          )
          .addScaledVector(
            zombiesPortalWorldUp,
            vertical * halfHeight,
          )
          .project(this.camera);
        minimumX = Math.min(minimumX, zombiesPortalCorner.x);
        maximumX = Math.max(maximumX, zombiesPortalCorner.x);
        minimumY = Math.min(minimumY, zombiesPortalCorner.y);
        maximumY = Math.max(maximumY, zombiesPortalCorner.y);
        hasVisibleDepth ||=
          zombiesPortalCorner.z >= -1 && zombiesPortalCorner.z <= 1;
      }
    }
    return (
      hasVisibleDepth &&
      maximumX >= -1.08 &&
      minimumX <= 1.08 &&
      maximumY >= -1.08 &&
      minimumY <= 1.08
    );
  }

  private applySettings(): void {
    const { settings } = this.persistence.state;
    this.audio?.applySettings(settings.audio);
    this.camera.fov = settings.accessibility.fov;
    this.camera.updateProjectionMatrix();
    // Zombies worlds are baked-lit Gaussian splats; Three.js shadow maps only
    // tax the mesh/viewmodel path and never light the RAD capture.
    this.renderer.shadowMap.enabled =
      !this.isZombiesHudMode() && settings.quality !== 'low';
    this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
    MintWorldLayer.applyQualityTier(settings.quality);
    this.rootElement().classList.toggle(
      'high-contrast',
      settings.accessibility.highContrastReticle,
    );
    this.rootElement().classList.toggle(
      'reduced-flashing',
      settings.accessibility.reducedFlashing,
    );
    resizeRenderer(this.renderer, this.camera, this.getMaxDpr());
  }

  private scheduleShadowUpdate(delta: number): void {
    if (!this.renderer.shadowMap.enabled) return;
    if (this.shadowUpdateMode !== this.mode) {
      this.shadowUpdateMode = this.mode;
      this.shadowUpdateAccumulator = 0;
      this.renderer.shadowMap.needsUpdate = true;
      return;
    }
    const dynamic =
      this.mode === 'mission' ||
      this.mode === 'editor';
    if (!dynamic) return;
    this.shadowUpdateAccumulator += delta;
    if (this.shadowUpdateAccumulator < 1 / 30) return;
    this.shadowUpdateAccumulator %= 1 / 30;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private getMaxDpr(): number {
    const quality = this.persistence.state.settings.quality;
    const qualityCap =
      quality === 'low' ? 1 : quality === 'medium' ? 1.35 : 1.6;
    // Keep the 2.5M splat budget; cap framebuffer resolution in Zombies so
    // fragment cost stays high-FPS without lowering Spark lodSplatCount.
    const zombiesCap = this.isZombiesHudMode() ? 1.25 : qualityCap;
    const desktopCap = Math.min(qualityCap, zombiesCap);
    return window.innerWidth <= 720
      ? Math.min(1.25, desktopCap)
      : desktopCap;
  }

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight('#d6ead8', '#202c26', 2.25);
    // FP gun/arms live on a dedicated layer under Spark's splat composite.
    hemisphere.layers.enable(FIRST_PERSON_VIEWMODEL_LAYER);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight('#e8f4e8', 3.1);
    key.position.set(-8, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    key.shadow.camera.left = -20;
    key.shadow.camera.right = 20;
    key.shadow.camera.top = 20;
    key.shadow.camera.bottom = -100;
    key.shadow.bias = -0.0004;
    key.layers.enable(FIRST_PERSON_VIEWMODEL_LAYER);
    this.scene.add(key);
    // Camera-local fill so the overlay FP pass is never unlit/black.
    const fpFill = new THREE.DirectionalLight('#f2ffe8', 2.4);
    fpFill.name = 'fp-viewmodel-fill';
    fpFill.position.set(0.35, 0.55, 0.8);
    fpFill.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
    this.camera.add(fpFill);
    // Overlay-scene key so the isolated FP pass (no Spark, no main lights)
    // still lights the gun/arms after depth clear.
    if (fpViewmodelOverlayScene.getObjectByName('fp-overlay-key') == null) {
      const overlayKey = new THREE.DirectionalLight('#e8f4e8', 2.8);
      overlayKey.name = 'fp-overlay-key';
      overlayKey.position.set(-0.4, 0.9, 0.6);
      overlayKey.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
      fpViewmodelOverlayScene.add(overlayKey);
      const overlayHemi = new THREE.HemisphereLight('#d6ead8', '#202c26', 1.6);
      overlayHemi.name = 'fp-overlay-hemi';
      overlayHemi.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
      fpViewmodelOverlayScene.add(overlayHemi);
    }
  }

  private applySceneAtmosphere(mode: 'operations' | 'zombies'): void {
    const zombies = mode === 'zombies';
    this.scene.background = zombies
      ? this.zombiesBackground
      : this.operationsBackground;
    // Spark can clear its shared framebuffer directly while changing paged
    // mappings, bypassing Three's textured scene background for sparse RAD
    // pixels. Keep that low-level clear in the same atmospheric palette so a
    // grazing doorway view never exposes the operations-mode near-black as a
    // rectangular hole.
    this.renderer.setClearColor(
      zombies ? this.zombiesClearColor : this.operationsBackground,
      1,
    );
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.set(zombies ? '#121a17' : '#101714');
      // Keep zombies fog light so RAD colors stay readable; heavy green fog
      // made rooms look like a grey wash over the splat capture.
      this.scene.fog.density = zombies ? 0.0045 : 0.011;
    }
  }

  private isZombiesPlayMode(): boolean {
    return this.playMode === 'zombies' || this.playMode === 'maps-zombies';
  }

  private isZombiesHudMode(): boolean {
    return this.mode === 'zombies' || this.mode === 'maps-zombies';
  }

  private isZombiesBootActive(): boolean {
    return (
      this.isZombiesPlayMode() ||
      this.loadingTarget === 'zombies' ||
      this.loadingTarget === 'maps-zombies'
    );
  }

  private redeployActiveZombiesMode(): void {
    if (this.playMode === 'maps-zombies') {
      void this.deployMapsZombiesAsync();
      return;
    }
    this.deployZombies();
  }

  private async bootstrapOperationsVisuals(): Promise<void> {
    if (this.operationsVisualsPromise) return this.operationsVisualsPromise;
    this.operationsVisualsPromise = (async () => {
      // If the player already jumped into Zombies, skip ops RAD attach so the
      // hub pager owns the shared Spark allocation.
      if (this.isZombiesBootActive()) return;
      await Promise.allSettled([
        this.initializeMintWorlds(),
        this.initializeMintProductionModels('operations'),
      ]);
    })();
    return this.operationsVisualsPromise;
  }

  private async initializeMintWorlds(): Promise<void> {
    const operationsWorlds = this.assets.listWorlds('operations');
    // Operations RAD is background-only after menu-first startup. Mission and
    // Zombies worlds still hydrate after explicit mode intent.
    const requested = operationsWorlds;
    if (requested.length === 0) {
      if (!this.assets.visibleFallbacksAllowed) {
        this.world.setGeneratedOperationsActive(true);
      }
      return;
    }
    if (this.isZombiesBootActive()) return;
    const { MintWorldLayer: WorldLayer } = await import('../world/MintWorldLayer');
    // Bootstrap worlds share the same GPU pager allocation. Keep ops RAD
    // sequential; parallel bootstrap can starve Spark's first pager.
    for (let index = 0; index < requested.length; index += 1) {
      if (this.isZombiesBootActive()) return;
      const world = requested[index];
      try {
        const layer = await WorldLayer.load(
          this.scene,
          this.renderer,
          this.physics,
          world,
          () => undefined,
        );
        if (this.isZombiesBootActive()) {
          layer.dispose();
          return;
        }
        this.mintWorldLayers.set(world.id, layer);
        this.mintWorldRoles.set(world.id, 'operations');
        this.world.setGeneratedOperationsActive(true);
      } catch (error) {
        this.mintWorldLoadFailures += 1;
        console.warn(
          `World Labs ${world.id} (operations) environment unavailable.`,
          error,
        );
        const keepProceduralHidden = !this.assets.visibleFallbacksAllowed;
        this.world.setGeneratedOperationsActive(keepProceduralHidden);
      }
    }

    if (!this.isZombiesBootActive()) {
      this.setMintWorldVisibility('operations');
    }
  }

  private disposeOperationsMintWorlds(): void {
    const opsIds = [...this.mintWorldRoles.entries()]
      .filter(([, role]) => role === 'operations')
      .map(([id]) => id);
    for (const id of opsIds) {
      this.mintWorldLayers.get(id)?.dispose();
      this.mintWorldLayers.delete(id);
      this.mintWorldRoles.delete(id);
    }
  }

  /** Drop every zombies-role RAD (campus prefetch + play) from the shared Spark pager. */
  private disposeZombiesMintWorlds(): void {
    // Invalidate any boot-time campus stream so it cannot re-register rooms
    // after Maps Outbreak has claimed the Spark pager.
    this.zombiesWorldStreamGeneration += 1;
    this.zombiesWorldStream = null;
    this.zombiesStreamProgressListeners.clear();
    const zombiesIds = [...this.mintWorldRoles.entries()]
      .filter(([, role]) => role === 'zombies')
      .map(([id]) => id);
    for (const id of zombiesIds) {
      this.mintWorldLayers.get(id)?.dispose();
      this.mintWorldLayers.delete(id);
      this.mintWorldRoles.delete(id);
    }
    this.mintZombiesRoomIds = [];
    this.zombiesRoomContracts.clear();
    this.zombiesSplatFrameOwner = null;
    this.zombiesSplatPrefetch = null;
    this.zombiesSplatPrefetchIds = [];
    this.zombiesActivePortalId = null;
    this.zombiesSplatClipKey = '';
    MintWorldLayer.setRenderOwners(null);
    MintWorldLayer.setGlobalCutVolumes([]);
    MintWorldLayer.setGlobalTrimPlanes([]);
    MintWorldLayer.ensureLiveSparkCamera();
  }

  private async ensureMissionAssets(): Promise<void> {
    if (this.missionAssetsReady) return;
    if (!this.missionAssetsPromise) {
      this.telemetry.begin('mission.assets');
      this.missionAssetsPromise = (async () => {
        await Promise.all([
          this.ensureMissionWorld(),
          this.initializeMintCharacters(),
        ]);
        await this.initializeMintProductionModels('mission');
        this.missionAssetsReady = true;
        this.telemetry.end('mission.assets');
      })().catch((error) => {
        this.missionAssetsPromise = null;
        throw error;
      });
    }
    await this.missionAssetsPromise;
  }

  private async ensureMissionWorld(): Promise<void> {
    const world = this.assets.getWorld('mission');
    if (!world) {
      if (!this.assets.visibleFallbacksAllowed) {
        this.world.setGeneratedMissionActive(true);
      }
      return;
    }
    const existing = this.mintWorldLayers.get(world.id);
    if (existing) {
      this.configureMissionWorld(world, existing);
      return;
    }
    this.telemetry.begin('mission.world');
    const layer = await MintWorldLayer.load(
      this.scene,
      this.renderer,
      this.physics,
      world,
      ({ progress, label }) => {
        this.ui.updateLoading(0.12 + progress * 0.52, label);
      },
    );
    this.configureMissionWorld(world, layer);
    this.telemetry.end('mission.world');
  }

  private configureMissionWorld(
    world: MintWorldRecord,
    layer: MintWorldLayer,
  ): void {
    this.mintWorldLayers.set(world.id, layer);
    this.mintWorldRoles.set(world.id, 'mission');
    if (!this.mintMissionRoomIds.includes(world.id)) {
      this.mintMissionRoomIds.push(world.id);
    }
    this.world.setGeneratedMissionActive(true);
    this.physics.setFacilityCollidersEnabled(false);
    this.splatCampus.dispose(this.scene);
    const center = layer.bounds.getCenter(new THREE.Vector3());
    const playableBounds = layer.bounds.clone();
    playableBounds.min.x = Math.max(playableBounds.min.x, center.x - 13);
    playableBounds.max.x = Math.min(playableBounds.max.x, center.x + 13);
    playableBounds.min.z = Math.max(playableBounds.min.z, center.z - 23);
    playableBounds.max.z = Math.min(playableBounds.max.z, center.z + 3);
    this.physics.addWorldBoundary(playableBounds);
    const spawn = this.physics.findGroundedSpawn(center.x, center.z - 1, 1);
    this.player.configurePlayableArea(playableBounds, spawn);
    this.world.configureMissionLayout(spawn, playableBounds);
    this.enemies.configurePlayableArea(spawn, playableBounds);
    this.ui.updateLoading(0.66, 'Mission splat ready // center insertion');
  }

  private async initializeMintCharacters(): Promise<void> {
    const [enemyCount, armsReady, knifeReady] = await Promise.all([
      this.enemies.initializeMintVisuals(this.assets),
      this.weaponView.initializeMintArms(),
      this.weaponView.initializeMintKnife(),
    ]);
    if (enemyCount > 0 || armsReady || knifeReady) {
      this.ui.updateLoading(
        0.82,
        `Mint character assets ready // ${enemyCount + (armsReady ? 1 : 0) + (knifeReady ? 1 : 0)}`,
      );
    }
  }

  private async initializeMintProductionModels(
    target: 'operations' | 'mission',
  ): Promise<void> {
    const placements: Array<{
      id: string;
      target: 'operations' | 'mission';
      position: [number, number, number];
      longestAxis: number;
      materialRole?: string;
      mount?: 'floor' | 'center' | 'table';
    }> = [
      {
        id: 'tactical-murk-3-smoke',
        target: 'operations',
        position: [-1.85, 1.18, -0.35],
        longestAxis: 0.28,
        materialRole: 'polymer',
      },
      {
        id: 'tactical-volt-9-disruptor',
        target: 'operations',
        position: [-2.35, 1.18, -0.35],
        longestAxis: 0.3,
        materialRole: 'gunmetal',
      },
      {
        id: 'interactable-comms-terminal',
        target: 'mission',
        position: [
          this.world.commsTerminalPosition.x,
          this.world.commsTerminalPosition.y,
          this.world.commsTerminalPosition.z,
        ],
        longestAxis: 1.6,
        materialRole: 'gunmetal',
      },
      {
        id: 'interactable-echo-ledger',
        target: 'mission',
        position: [
          this.world.intelPosition.x,
          this.world.intelPosition.y,
          this.world.intelPosition.z,
        ],
        longestAxis: 0.52,
      },
      {
        id: 'interactable-extraction-beacon',
        target: 'mission',
        position: [
          this.world.extractionPosition.x,
          this.world.extractionPosition.y,
          this.world.extractionPosition.z,
        ],
        longestAxis: 1.9,
      },
      {
        id: 'door-security',
        target: 'mission',
        position: [
          this.world.securityCheckpointPosition.x,
          this.world.securityCheckpointPosition.y,
          this.world.securityCheckpointPosition.z,
        ],
        longestAxis: 3.2,
        materialRole: 'warningPaint',
      },
      {
        id: 'door-blast',
        target: 'mission',
        position: [
          this.world.blastDoorPosition.x,
          this.world.blastDoorPosition.y,
          this.world.blastDoorPosition.z,
        ],
        longestAxis: 4.2,
        materialRole: 'damagedArchitecture',
        mount: 'floor' as const,
      },
    ];
    let loaded = 0;
    await Promise.all(
      placements
        .filter((placement) => placement.target === target)
        .map(async (placement) => {
        if (this.installedMintProductionModels.has(placement.id)) return;
        if (!this.assets.getArtifact(placement.id, 'model')) return;
        try {
          const model = await this.assets.instantiateModel(placement.id);
          if (!model) return;
          normalizeMintModel(model, placement.longestAxis);
          if (placement.materialRole) {
            const material = await this.assets.createPbrMaterial(
              placement.materialRole,
            );
            if (material) {
              model.traverse((object) => {
                if (object instanceof THREE.Mesh) object.material = material;
              });
            }
          }
          const position = new THREE.Vector3(...placement.position);
          if (placement.target === 'operations') {
            this.world.installMintOperationsModel(placement.id, model, position);
          } else {
            const mount =
              placement.mount ??
              (placement.id === 'interactable-echo-ledger' ? 'table' : 'floor');
            this.world.installMintMissionModel(
              placement.id,
              model,
              position,
              1,
              0,
              mount,
            );
            this.mintProductionColliderMeshes +=
              this.physics.addTrimeshScene(model);
          }
          this.installedMintProductionModels.add(placement.id);
          loaded += 1;
        } catch (error) {
          console.warn(
            `Mint production model failed to load: ${placement.id}`,
            error,
          );
        }
        }),
    );
    if (loaded > 0) {
      this.ui.updateLoading(0.84, `Mint production props ready // ${loaded}`);
    }
  }

  private prepareZombiesDoorwayDiagnostics(): boolean {
    if (!this.isZombiesPlayMode() || !this.zombiesActivePortalId) return false;
    const ownerId = this.zombiesSplatFrameOwner;
    if (!ownerId) return false;
    const portal = this.zombiesNavigationSurface.portals.find(
      (candidate) => candidate.source.id === this.zombiesActivePortalId,
    );
    if (!portal) return false;
    const ownerIsFrom = portal.source.fromRoomId === ownerId;
    if (!ownerIsFrom && portal.source.toRoomId !== ownerId) return false;
    const ownerAperture =
      this.zombiesNavigationSurface.portalPresentationPoint(
        portal.source.id,
        ownerId,
      ) ?? (ownerIsFrom ? portal.from : portal.to);
    if (!this.isZombiesPortalVisibleFromOwner(portal, ownerId, ownerAperture)) {
      return false;
    }
    const destinationId = ownerIsFrom
      ? portal.source.toRoomId
      : portal.source.fromRoomId;
    if (!this.isZombiesSplatPortalPreloadReady(ownerId, destinationId)) {
      return false;
    }
    const ownerLayer = this.mintWorldLayers.get(ownerId);
    const destinationLayer = this.mintWorldLayers.get(destinationId);
    const ownerRoom = this.zombiesNavigationSurface.room(ownerId);
    const destinationRoom = this.zombiesNavigationSurface.room(destinationId);
    const destinationLanding =
      this.zombiesNavigationSurface.portalLandingPoint(
        portal.source.id,
        destinationId,
        0.34,
      );
    const ownerLanding =
      this.zombiesNavigationSurface.portalLandingPoint(
        portal.source.id,
        ownerId,
        0.34,
      );
    if (
      !ownerLayer ||
      !destinationLayer ||
      !ownerRoom ||
      !destinationRoom ||
      !destinationLanding ||
      !ownerLanding
    ) {
      return false;
    }

    const sourceSocket = ownerRoom.source.doorwaySockets.find(
      (socket) =>
        socket.id ===
        (ownerIsFrom
          ? portal.source.fromSocketId
          : portal.source.toSocketId),
    );
    const destinationSocket = destinationRoom.source.doorwaySockets.find(
      (socket) =>
        socket.id ===
        (ownerIsFrom
          ? portal.source.toSocketId
          : portal.source.fromSocketId),
    );
    // The compositor, cut, frame, and traversal use one shared doorway width.
    // A hidden 2.4 m cap previously made a 3.2 m authored opening look narrow
    // and left the presentation frame visibly disconnected from the aperture.
    const apertureHalfHeight =
      THREE.MathUtils.clamp(
        Math.min(
          sourceSocket?.height ?? 3.2,
          destinationSocket?.height ?? 3.2,
        ),
        3.2,
        3.6,
      ) * 0.5;
    const sourceCenter =
      this.zombiesNavigationSurface.portalPresentationPoint(
        portal.source.id,
        ownerId,
      ) ?? (ownerIsFrom ? portal.from : portal.to).clone();
    const destinationCenter =
      this.zombiesNavigationSurface.portalPresentationPoint(
        portal.source.id,
        destinationId,
      ) ?? (ownerIsFrom ? portal.to : portal.from).clone();
    // Navigation endpoints sit at capsule-center height. Derive the visual
    // plane from each room's actual floor so an enlarged doorway never clips
    // below the floor or puts the virtual destination eye inside floor splats.
    sourceCenter.y = ownerRoom.floorY + apertureHalfHeight;
    destinationCenter.y = destinationRoom.floorY + apertureHalfHeight;
    const portalOutwardDirection = (
      roomId: string,
      center: THREE.Vector3,
      room: typeof ownerRoom,
      socket: typeof sourceSocket,
    ) => {
      // Aim the visual plane through the same reachable approach corridor used
      // by players and agents. Some scan sockets have useful placement data but
      // an authored yaw that does not match the baked navigable threshold.
      const interior = this.zombiesNavigationSurface.portalApproachPoint(
        portal.source.id,
        roomId,
        1.4,
      );
      const direction = interior
        ? center.clone().sub(interior).setY(0)
        : new THREE.Vector3();
      if (direction.lengthSq() <= 1e-6) {
        const socketYaw =
          room.source.transform.authoredYaw + (socket?.yaw ?? 0);
        direction.set(Math.sin(socketYaw), 0, Math.cos(socketYaw));
      }
      return direction.normalize();
    };
    const sourceForward = portalOutwardDirection(
      ownerId,
      sourceCenter,
      ownerRoom,
      sourceSocket,
    );
    // The virtual camera looks from the destination cut into that room, so it
    // uses the inverse of the destination room's reachable outward direction.
    const destinationForward = portalOutwardDirection(
      destinationId,
      destinationCenter,
      destinationRoom,
      destinationSocket,
    ).multiplyScalar(-1);
    const up = new THREE.Vector3(0, 1, 0);
    const sourceRight = new THREE.Vector3(
      sourceForward.z,
      0,
      -sourceForward.x,
    );
    const destinationRight = new THREE.Vector3(
      destinationForward.z,
      0,
      -destinationForward.x,
    );
    const cameraPosition = this.camera.getWorldPosition(new THREE.Vector3());
    const cameraDirection = this.camera.getWorldDirection(
      new THREE.Vector3(),
    );
    const sourceOffset = cameraPosition.clone().sub(sourceCenter);
    const sourcePortalDistance = Math.max(
      0.25,
      Math.abs(sourceOffset.dot(sourceForward)),
    );
    const apertureHalfWidth = portal.source.width * 0.5;
    // RADs are interior scans. Mirroring a 1.4m source offset can place the
    // virtual camera well outside the destination capture and expose a clear
    // floor wedge even though every requested chunk is resident. Keep the
    // sampling eye just outside the destination cut and shrink its clip plane
    // by the same ratio so the projected source aperture is unchanged.
    const clampToCaptureBoundary =
      portal.source.id === 'portal-far-north-hub';
    const destinationPortalDistance = clampToCaptureBoundary
      ? Math.min(sourcePortalDistance, 0.45)
      : sourcePortalDistance;
    const destinationApertureScale =
      destinationPortalDistance / sourcePortalDistance;
    const virtualPosition = destinationCenter
      .clone()
      .addScaledVector(destinationForward, -destinationPortalDistance)
      .addScaledVector(
        destinationRight,
        sourceOffset.dot(sourceRight) * destinationApertureScale,
      )
      .addScaledVector(
        up,
        sourceOffset.dot(up) * destinationApertureScale,
      );
    const virtualDirection = destinationForward
      .clone()
      .multiplyScalar(cameraDirection.dot(sourceForward))
      .addScaledVector(
        destinationRight,
        cameraDirection.dot(sourceRight),
      )
      .addScaledVector(up, cameraDirection.dot(up));
    if (virtualDirection.lengthSq() <= 1e-6) return false;
    virtualDirection.normalize();
    zombiesPortalVirtualTarget
      .copy(virtualPosition)
      .add(virtualDirection);
    zombiesPortalVirtualLookMatrix.lookAt(
      virtualPosition,
      zombiesPortalVirtualTarget,
      up,
    );
    zombiesPortalVirtualQuaternion.setFromRotationMatrix(
      zombiesPortalVirtualLookMatrix,
    );
    const lodPosition = destinationLanding.clone();
    lodPosition.y += 1.62;
    const lodDirection = destinationRoom.anchor
      .clone()
      .sub(lodPosition)
      .setY(0);
    if (lodDirection.lengthSq() <= 1e-6) lodDirection.copy(destinationForward);
    lodDirection.normalize();

    const aperture = this.zombiesContinuousPortal;
    aperture.center.copy(sourceCenter);
    aperture.normal.copy(sourceForward);
    aperture.right.copy(sourceRight);
    aperture.up.copy(up);
    aperture.halfWidth = apertureHalfWidth;
    aperture.halfHeight = apertureHalfHeight;
    aperture.destinationAperture.center.copy(destinationCenter);
    aperture.destinationAperture.normal.copy(destinationForward);
    aperture.destinationAperture.right.copy(destinationRight);
    aperture.destinationAperture.up.copy(up);
    aperture.destinationAperture.halfWidth =
      aperture.halfWidth * destinationApertureScale;
    aperture.destinationAperture.halfHeight =
      aperture.halfHeight * destinationApertureScale;
    aperture.destinationCameraPosition.copy(virtualPosition);
    aperture.destinationCameraQuaternion.copy(
      zombiesPortalVirtualQuaternion,
    );
    aperture.lodCameraPosition.copy(lodPosition);
    aperture.lodCameraQuaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      lodDirection,
    );
    const landingSpan = this.zombiesPortalLandingSpan(portal);
    if (landingSpan > ZOMBIES_AUTHORED_CONNECTOR_MIN_SPAN) return false;
    // Retain the aperture geometry for diagnostics and all-angle verification.
    // Rendering itself is shared-world depth composition in render().
    void destinationLayer;
    return true;
  }

  private render(): void {
    if (this.renderDisabledForTests) return;
    const renderStarted = performance.now();
    if (this.isZombiesHudMode() || this.isZombiesPlayMode()) {
      // Recover if a warm/handoff left Spark with autoUpdate=false (black RAD).
      MintWorldLayer.ensureLiveSparkCamera();
      const positionMoved =
        this.camera.position.distanceToSquared(this.zombiesViewPacePosition) >
        0.0004;
      const rotationMoved =
        1 -
          Math.abs(
            this.camera.quaternion.dot(this.zombiesViewPaceQuaternion),
          ) >
        1e-5;
      MintWorldLayer.updateFramePacing(positionMoved || rotationMoved);
      if (positionMoved || rotationMoved) {
        this.zombiesViewPacePosition.copy(this.camera.position);
        this.zombiesViewPaceQuaternion.copy(this.camera.quaternion);
      }
      // Keep portal presentation/doorway diagnostics out of the critical paint
      // path when they are idle. A second renderer.render() for the FP
      // viewmodel still runs below; Spark's lastFrame is frozen across that
      // pass so it cannot publish an empty display against the viewmodel
      // camera layer mask.
      this.zombiesCampus.updatePortalPresentation(
        this.zombiesSplatFrameOwner,
        this.camera,
        this.player.position,
        this.zombiesActivePortalId,
      );
      MintWorldLayer.prepareCutRendering(this.camera);
      MintWorldLayer.prepareWorldSpacePortal(this.camera, null);
      this.prepareZombiesDoorwayDiagnostics();
    } else {
      MintWorldLayer.prepareCutRendering(this.camera);
    }
    const timingGpu = this.telemetry.beginGpuFrame(this.frame);
    try {
      this.renderer.setRenderTarget(null);
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera);
      // Spark's splat composite writes fullscreen color/depth after ordinary
      // meshes. Re-draw the FP gun/arms/knife with a cleared depth buffer so
      // RAD pages cannot erase them.
      //
      // Never second-pass the gameplay scene: Spark treats that as a new
      // frame, can publish an empty display (viewmodel-only layer mask / sort),
      // and leaves every later loop frame on the clear color. Reparent the
      // camera (and its FP children) into an isolated overlay scene instead.
      if (this.weaponView.group.visible) {
        const cameraParent = this.camera.parent;
        const previousLayerMask = this.camera.layers.mask;
        this.renderer.autoClear = false;
        try {
          fpViewmodelOverlayScene.add(this.camera);
          this.camera.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
          this.renderer.clearDepth();
          this.renderer.render(fpViewmodelOverlayScene, this.camera);
        } finally {
          this.camera.layers.mask = previousLayerMask;
          if (cameraParent) cameraParent.add(this.camera);
          else this.scene.add(this.camera);
          this.renderer.autoClear = true;
        }
      }
    } finally {
      this.telemetry.endGpuFrame(timingGpu);
      this.renderer.autoClear = true;
    }
    if (this.mode === 'loadout') this.armoryPreview.render(this.renderer);
    this.telemetry.recordWork(
      'frame.render-submit',
      performance.now() - renderStarted,
    );
  }

  private setMintWorldVisibility(active: MintWorldRole): void {
    if (active !== 'zombies') {
      MintWorldLayer.setRenderOwners(null);
    } else if (this.zombiesSplatFrameOwner) {
      MintWorldLayer.setRenderOwners(this.zombiesSplatFrameOwner);
    }
    for (const [id, layer] of this.mintWorldLayers) {
      const role = this.mintWorldRoles.get(id);
      if (role !== active) {
        layer.setRenderState('hidden');
        if (layer.colliderCount > 0) layer.unregisterCollision();
      } else if (active === 'zombies') {
        // Campus ownership chooses the one opaque room below. Keeping the
        // remaining RADs resident prevents Spark from discarding their paged
        // LoD trees and degrading revisits to the coarse root page.
        layer.setRenderState('resident');
      } else {
        layer.setRenderState('primary');
        if (layer.colliderCount === 0) layer.registerCollision();
      }
    }
    // Mission mode stays splat-only; campus geometry is zombies-only.
    this.splatCampus.setVisible(false);
    this.zombiesCampus.setVisible(active === 'zombies');
    if (active !== 'zombies') {
      this.zombiesSplatFrameOwner = null;
      this.zombiesPreviousSplatFrameOwner = null;
      this.zombiesPreviousSplatSeamCleared = true;
      this.zombiesSplatPrefetch = null;
      this.zombiesSplatPrefetchIds = [];
      this.zombiesPredictiveReadyRoomIds.clear();
      this.zombiesSplatPreload.reset();
      this.zombiesPredictiveWarmTarget = null;
      this.zombiesPredictiveHandoffTarget = null;
      this.zombiesPredictiveHandoffSortReady = false;
      this.zombiesPredictiveHandoffSortStatus = 'idle';
      MintWorldLayer.clearHandoffLodCamera();
      this.zombiesActivePortalId = null;
      this.zombiesSplatAnalysisRoom = null;
      MintWorldLayer.setGlobalCutVolumes([]);
      MintWorldLayer.setGlobalTrimPlanes([]);
      this.zombiesSplatClipKey = 'portal-mask:none';
    }
  }

  private createStats(): MissionStats {
    return {
      startedAt: performance.now(),
      elapsedMs: 0,
      shotsFired: 0,
      shotsHit: 0,
      defeated: 0,
      damageTaken: 0,
    };
  }

  private isSpawnProtected(): boolean {
    return this.spawnProtectionRemaining > 0;
  }

  private updateSceneQualityCounts(): void {
    const materials = new Set<THREE.Material>();
    let meshes = 0;
    let instancedMeshes = 0;
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes += 1;
      if (object instanceof THREE.InstancedMesh) instancedMeshes += 1;
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) {
        if (material) materials.add(material);
      }
    });
    this.sceneMeshCount = meshes;
    this.sceneInstancedMeshCount = instancedMeshes;
    this.sceneMaterialCount = materials.size;
  }

  private publishDiagnostics(): void {
    if (this.isZombiesPlayMode()) {
      this.syncZombiesRoomTransitProgression();
    }
    const rendererInfo = this.renderer.info;
    if (this.frame % 60 === 1) this.updateSceneQualityCounts();
    const playableArea = this.player?.playableArea ?? null;
    const safeSpawn = this.player?.spawnPosition ?? new THREE.Vector3(0, 1, 0);
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.stats.defeated,
      targetScore: 8,
      complete: this.mode === 'complete',
      mode: this.mode,
      zombiesPlayspaceReady: this.zombiesPlayspaceReady,
      editor: this.zombiesEditor?.diagnostics() ?? null,
      objective: this.mission?.getObjective().id ?? 'infiltrate',
      enemiesAlive: this.enemies?.getAliveCount() ?? 0,
      player: {
        position: {
          x: this.player?.position.x ?? 0,
          y: this.player?.position.y ?? 0,
          z: this.player?.position.z ?? 0,
        },
        speed: this.player?.speed ?? 0,
        health: this.player?.health ?? 100,
        armor: this.player?.armor ?? 0,
      },
      spawnProtection: {
        active: this.isSpawnProtected(),
        remainingSeconds: this.spawnProtectionRemaining,
        awaitingControl: this.isSpawnProtected() && !this.hasLockedOnce,
      },
      weapon: {
        id: this.weapon?.current.id ?? 'arx-7',
        state: this.weapon?.state ?? 'idle',
        magazine: this.weapon?.ammoState.magazine ?? 0,
        reserve: this.weapon?.ammoState.reserve ?? 0,
      },
      armory: this.armoryPreview.diagnostics(),
      spatial: {
        safeSpawn: { x: safeSpawn.x, y: safeSpawn.y, z: safeSpawn.z },
        playableBounds: playableArea
          ? {
              min: {
                x: playableArea.min.x,
                y: playableArea.min.y,
                z: playableArea.min.z,
              },
              max: {
                x: playableArea.max.x,
                y: playableArea.max.y,
                z: playableArea.max.z,
              },
            }
          : null,
        boundaryColliders: this.physics.diagnostics().boundaryColliders,
        containmentRecoveries: this.player?.containmentRecoveryCount ?? 0,
        voidFallRecoveries: this.player?.voidFallRecoveryCount ?? 0,
        voidFallRecoveryEnabled:
          this.player?.voidFallRecoveryEnabled ?? false,
        missionAnchors: {
          security: {
            x: this.world.securityCheckpointPosition.x,
            y: this.world.securityCheckpointPosition.y,
            z: this.world.securityCheckpointPosition.z,
          },
          comms: {
            x: this.world.commsTerminalPosition.x,
            y: this.world.commsTerminalPosition.y,
            z: this.world.commsTerminalPosition.z,
          },
          intel: {
            x: this.world.intelPosition.x,
            y: this.world.intelPosition.y,
            z: this.world.intelPosition.z,
          },
          extraction: {
            x: this.world.extractionPosition.x,
            y: this.world.extractionPosition.y,
            z: this.world.extractionPosition.z,
          },
          blastDoor: {
            x: this.world.blastDoorPosition.x,
            y: this.world.blastDoorPosition.y,
            z: this.world.blastDoorPosition.z,
          },
        },
      },
      enemies: this.enemies?.diagnostics() ?? {
        generatedVisuals: 0,
        armedEnemies: 0,
        weaponIds: [],
        minimumWeaponForwardAlignment: -1,
        maximumSupportHandDistance: Infinity,
        maximumPrimaryGripDistance: Infinity,
        maximumFootSurfaceError: 0,
        groundedSampleCount: 0,
        weaponPoses: [],
        animationActions: 0,
        activeAnimations: [],
      },
      viewmodel: {
        armsMeshCount: this.weaponView.armsMeshCount,
        knifeMeshCount: this.weaponView.knifeMeshCount,
        ...this.weaponView.handAttachmentDiagnostics(),
      },
      tacticalMap: (() => {
        const objective = this.mission?.getObjectivePosition() ?? new THREE.Vector3();
        const playerPos = this.player?.position ?? new THREE.Vector3();
        const yaw = this.player?.yaw ?? 0;
        const dx = objective.x - playerPos.x;
        const dz = objective.z - playerPos.z;
        const relativeBearing = Math.atan2(dx, dz) - yaw;
        const bearingDegrees = Math.round(
          (((relativeBearing * 180) / Math.PI + 540) % 360) - 180,
        );
        return {
          distanceMeters: Math.hypot(dx, dz),
          bearingDegrees,
          objectiveId: this.mission?.getObjective().id ?? 'infiltrate',
        };
      })(),
      ballistics: {
        ...this.lastBallistic,
        queries: this.physics.diagnostics().ballisticQueries,
        blocks: this.physics.diagnostics().ballisticBlocks,
      },
      audio: this.audio.diagnostics(),
      renderer: {
        calls: rendererInfo.render.calls,
        triangles: rendererInfo.render.triangles,
        geometries: rendererInfo.memory.geometries,
        textures: rendererInfo.memory.textures,
        materials: this.sceneMaterialCount,
        meshes: this.sceneMeshCount,
        instancedMeshes: this.sceneInstancedMeshCount,
        frameTimeMs: Number(this.smoothedFrameMs.toFixed(2)),
        fps: Number((1000 / Math.max(0.01, this.smoothedFrameMs)).toFixed(1)),
        dpr: this.renderer.getPixelRatio(),
        dprCap: this.getMaxDpr(),
        shadowsEnabled: this.renderer.shadowMap.enabled,
        shadowMapType: this.renderer.shadowMap.type,
        shadowUpdateHz: this.isZombiesHudMode() ? 0 : 30,
        postPasses: 0,
      },
      performance: this.telemetry.snapshot(),
      physics: this.physics.diagnostics(),
      assets: {
        ...this.assets.diagnostics(),
        generatedProductionModels: this.world.mintProductionModelCount,
        worldLoadFailures: this.mintWorldLoadFailures,
        worldColliderMeshes: Array.from(this.mintWorldLayers.values()).reduce(
          (total, world) => total + world.colliderCount,
          0,
        ),
        missionRoomsReady: this.mintMissionRoomIds.length,
        campusConnectors: this.splatCampus.connectorCount,
        zombiesRoomsReady: this.mintZombiesRoomIds.length,
        zombiesCampusConnectors: this.zombiesCampus.connectorCount,
        zombiesCampusRoomPads: this.zombiesCampus.roomPadCount,
        zombiesCampusPerimeterWalls: this.zombiesCampus.perimeterWallCount,
        zombiesCampusDoorwayGuides: this.zombiesCampus.doorwayGuideCount,
        zombiesCampusVisibleMeshes: this.zombiesCampus.visibleMeshCount,
        productionColliderMeshes: this.mintProductionColliderMeshes,
        audioLoadedEvents: this.audio.loadedMintEventCount,
        audioExpectedEvents: this.audio.expectedMintEventCount,
        audibleFallbackActive: this.audio.audibleFallbackActive,
        vfx: this.vfx.diagnostics(),
      },
      splatLayout: {
        status: this.zombiesNavigationSurface.layout.status,
        validation: this.zombiesNavigationSurface.validation,
        navigation:
          this.zombiesNavigationSurface.navigationDiagnostics(),
        containment: this.zombiesContainment.diagnostics(),
        roomTransit: this.zombiesRoomTransit.snapshot(
          this.player.position,
          this.currentZombiesRoomId(),
        ),
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: window.devicePixelRatio || 1,
      },
    };
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => this.setTestState(name),
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setRenderDisabledForTests: (disabled: boolean) => {
        this.renderDisabledForTests = disabled;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotionTest = enabled;
      },
      hideDebugUi: () => {},
      openZombiesEditor: async (previewOnly = false) => {
        await this.openZombiesEditor(previewOnly);
        return this.mode === 'editor' && this.zombiesEditor !== null;
      },
      zombiesEditorDiagnostics: () =>
        this.zombiesEditor?.diagnostics() ?? null,
      zombiesEditorClipVisualDiagnostics: (clipId: string) =>
        this.zombiesEditor?.clipVisualDiagnostics(clipId) ?? null,
      zombiesEditorPlacements: () =>
        this.zombiesEditor?.placementSnapshot() ?? null,
      zombiesEditorAuthoringSnapshot: () =>
        this.zombiesEditor?.authoringSnapshot() ?? null,
      zombiesEditorSelect: (id: string) =>
        this.zombiesEditor?.selectById(id) ?? false,
      zombiesEditorSetView: (view: 'perspective' | 'top') => {
        this.zombiesEditor?.setView(view);
      },
      zombiesEditorSetClipEnabled: (clipId: string, enabled: boolean) =>
        this.zombiesEditor?.setClipEnabled(clipId, enabled) ?? null,
      zombiesEditorNudgeTrimPlane: (
        trimId: string,
        delta: [number, number, number],
      ) => this.zombiesEditor?.nudgeTrimPlane(trimId, delta) ?? null,
      zombiesEditorSetTrimPlanePosition: (
        trimId: string,
        position: [number, number, number],
      ) => this.zombiesEditor?.setTrimPlanePosition(trimId, position) ?? null,
      zombiesEditorSetOverlays: (flags: {
        splats?: boolean;
        navigation?: boolean;
        doorways?: boolean;
        trims?: boolean;
        labels?: boolean;
        placements?: boolean;
        grid?: boolean;
        connective?: boolean;
      }) => {
        this.zombiesEditor?.setOverlayVisibilityFlags(flags);
      },
      zombiesEditorSaveProject: () =>
        this.zombiesEditor?.saveProjectForTests() ?? Promise.resolve(false),
      zombiesEditorAddWalkablePatch: (roomId?: string) =>
        this.zombiesEditor?.addWalkablePatchForTests(roomId) ?? null,
      zombiesEditorEditWalkablePatch: (patchId: string) =>
        this.zombiesEditor?.editWalkablePatchForTests(patchId) ?? false,
      zombiesEditorWalkablePatches: () =>
        this.zombiesEditor?.walkablePatchSnapshotForTests() ?? [],
      zombiesEditorNudgeWalkablePoint: (
        index: number,
        delta: [number, number],
      ) =>
        this.zombiesEditor?.nudgeWalkablePointForTests(index, delta) ?? false,
      zombiesEditorFrameClip: (
        clipId: string,
        view: 'perspective' | 'top' = 'perspective',
      ) => this.zombiesEditor?.frameClip(clipId, view) ?? false,
      zombiesEditorFrameCutLookThrough: (cutId: string, leadIn = 6) =>
        this.zombiesEditor?.frameCutLookThrough(cutId, leadIn) ?? false,
      zombiesEditorFrameTrimLookThrough: (trimId: string, leadIn = 6) =>
        this.zombiesEditor?.frameTrimLookThrough(trimId, leadIn) ?? false,
      zombiesActiveSplatClips: () => {
        const quality = MintWorldLayer.qualityDiagnostics();
        return {
          clipKey: this.zombiesSplatClipKey,
          clipRoomIds: [...this.zombiesClipRoomIds],
          clipBindings: quality?.clipBindings ?? [],
          cutIds:
            quality?.clipBindings
              .filter((binding) => binding.kind === 'cut')
              .map((binding) => binding.id) ?? [],
          trimIds:
            quality?.clipBindings
              .filter((binding) => binding.kind === 'trim')
              .map((binding) => binding.id) ?? [],
        };
      },
      zombiesRuntimeLayoutClips: () => ({
        cutVolumes: (this.zombiesNavigationSurface.layout.cutVolumes ?? []).map(
          (cut) => ({
            id: cut.id,
            roomId: cut.roomId,
            portalId: cut.portalId ?? null,
            enabled: cut.enabled,
            position: [...cut.position] as [number, number, number],
            size: [...cut.size] as [number, number, number],
          }),
        ),
        trimPlanes: (
          this.zombiesNavigationSurface.layout.trimPlanes ?? []
        ).map((trim) => ({
          id: trim.id,
          roomId: trim.roomId,
          enabled: trim.enabled,
          position: [...trim.position] as [number, number, number],
        })),
      }),
      zombiesRuntimeAuthoringSnapshot: () => ({
        layout: structuredClone(this.zombiesNavigationSurface.layout),
        navigation: structuredClone(zombiesSplatNavigationBake),
        placements: structuredClone(ZOMBIES_PLACEMENT_LAYOUT),
        roomRoots: this.zombiesNavigationSurface.layout.rooms.map((room) => {
          const root = this.mintWorldLayers.get(room.id)?.root ?? null;
          return {
            id: room.id,
            position: root
              ? [root.position.x, root.position.y, root.position.z]
              : null,
            rotation: root
              ? [root.rotation.x, root.rotation.y, root.rotation.z]
              : null,
            scale: root
              ? [root.scale.x, root.scale.y, root.scale.z]
              : null,
          };
        }),
        arenaPlacements: this.zombies.arena.editorPlacements(),
      }),
      teleportPlayer: (x: number, y: number, z: number) => {
        const grounded = this.physics.findGroundedSpawn(x, z, y);
        this.player.restore({
          ...this.player.snapshot(),
          position: grounded,
        });
        if (this.isZombiesPlayMode()) {
          this.completeZombiesSplatFrame(this.player.position, true);
        }
      },
      setKeyDown: (code: string, down: boolean) => {
        this.input.setTestKey(code, down);
      },
      setPlayerLook: (yaw: number, pitch: number) => {
        this.player.setLook(yaw, pitch);
        this.player.updateCamera(
          FIXED_TIMESTEP,
          this.elapsed,
          this.persistence.state.settings.accessibility,
          this.weapon.adsFactor,
        );
      },
      resetPlayerMotionDiagnostics: () => {
        this.physics.resetPlayerMotionDiagnostics();
      },
      advancePlayerMovement: (seconds: number) => {
        const steps = Math.max(1, Math.ceil(seconds / FIXED_TIMESTEP));
        for (let step = 0; step < steps; step += 1) {
          const previousPosition = this.player.position.clone();
          this.player.updateFixed(
            FIXED_TIMESTEP,
            this.input,
            this.persistence.state.settings.accessibility,
          );
          if (!this.isZombiesPlayMode()) continue;
          const transition = this.resolveZombiesSplatFrameTransition(
            previousPosition,
            this.player.position,
          );
          if (!transition) continue;
          this.zombiesPreviousSplatFrameOwner = transition.fromId;
          this.zombiesPreviousSplatSeamCleared = false;
          this.zombiesSplatFrameOwner = transition.toId;
          this.zombiesSplatOwnershipDirty = true;
          this.completeZombiesSplatFrame(this.player.position);
        }
        return {
          position: {
            x: this.player.position.x,
            y: this.player.position.y,
            z: this.player.position.z,
          },
          recoveries: this.player.recoveryCount,
          collisions: this.physics
            .diagnostics()
            .characterCollisions.map((collision) => collision.label),
        };
      },
      setMouseButtonDown: (button: number, down: boolean) => {
        this.input.setTestMouseButton(button, down);
      },
      advanceWeaponCombat: (seconds: number) => {
        const steps = Math.max(1, Math.ceil(seconds / FIXED_TIMESTEP));
        for (let step = 0; step < steps; step += 1) {
          const events = this.weapon.update(
            FIXED_TIMESTEP,
            this.input,
            false,
            false,
          );
          for (const event of events) this.handleWeaponEvent(event);
          this.weaponView.update(
            FIXED_TIMESTEP,
            this.weapon,
            this.elapsed + step * FIXED_TIMESTEP,
            this.player.locomotionSample(),
          );
          this.input.endFrame();
        }
        return {
          knifeMeshCount: this.weaponView.knifeMeshCount,
          weaponId: this.weapon.current.id,
          weaponState: this.weapon.state,
          ...this.weaponView.handAttachmentDiagnostics(),
        };
      },
      advanceInteraction: (seconds: number) => {
        const steps = Math.max(1, Math.ceil(seconds / FIXED_TIMESTEP));
        this.input.setTestKey('KeyE', true);
        for (let step = 0; step < steps; step += 1) {
          if (this.mode === 'mission') {
            this.handleMissionEvents(
              this.mission.update(
                FIXED_TIMESTEP,
                this.player.position,
                this.input,
                this.enemies.getAliveCount(),
              ),
            );
          } else if (this.isZombiesHudMode()) {
            this.zombies.update(FIXED_TIMESTEP, this.player, this.input, undefined, {
              invulnerable: this.isSpawnProtected(),
              playerRoomId: this.zombiesSplatFrameOwner,
            });
          } else {
            break;
          }
        }
        this.input.setTestKey('KeyE', false);
      },
      advanceZombieNavigation: (seconds: number) => {
        if (!this.isZombiesPlayMode() || !this.isZombiesHudMode()) return;
        const steps = Math.max(1, Math.ceil(seconds / FIXED_TIMESTEP));
        for (let step = 0; step < steps; step += 1) {
          this.zombies.update(
            FIXED_TIMESTEP,
            this.player,
            this.input,
            (x, z, preferY) => {
              const sample = this.physics.sampleSurface(x, z, preferY);
              return sample?.point.y ?? preferY;
            },
            {
              invulnerable: true,
              playerRoomId: this.zombiesSplatFrameOwner,
            },
          );
        }
      },
      zombiesForcePortalsReady: (ready = true) => {
        this.zombiesPortalsForcedReady = ready;
        this.refreshZombiesPortalResidency();
      },
      defeatAllEnemies: () => {
        for (const enemy of this.enemies.enemies) {
          if (enemy.group.visible && !enemy.isDefeated()) enemy.hit(10_000);
        }
      },
      probeBallistics: (
        origin: { x: number; y: number; z: number },
        target: { x: number; y: number; z: number },
      ) => {
        const from = new THREE.Vector3(origin.x, origin.y, origin.z);
        const to = new THREE.Vector3(target.x, target.y, target.z);
        const direction = to.clone().sub(from);
        const distance = direction.length();
        const hit = this.physics.castBallisticRay(from, direction, distance);
        this.lastBallistic = {
          source: 'probe',
          blocked: Boolean(hit && hit.distance < distance - 0.01),
          distance: hit?.distance ?? distance,
        };
        return {
          source: 'probe' as const,
          blocked: this.lastBallistic.blocked,
          distance: this.lastBallistic.distance,
        };
      },
      captureAudioStress: (seconds = 4) => this.audio.captureStressMix(seconds),
      teleportEnemy: (id: string, x: number, y: number, z: number) => {
        this.enemies.teleportEnemy(id, x, y, z);
      },
      fireEnemyAtPlayer: (id: string) => {
        const enemy = this.enemies.getEnemyById(id);
        if (!enemy) return null;
        const healthBefore = this.player.health;
        const armorBefore = this.player.armor;
        const previousRng = this.rng;
        this.rng = () => 0;
        this.handleEnemyFire({ enemy, suppressing: false });
        this.rng = previousRng;
        return {
          healthBefore,
          healthAfter: this.player.health,
          armorBefore,
          armorAfter: this.player.armor,
          blocked: this.lastBallistic.blocked,
        };
      },
      poseEnemies: (semantic: string, time = 0.35) => {
        for (const enemy of this.enemies.enemies) {
          enemy.setEvidencePose(semantic, time);
        }
      },
      poseEnemiesState: (state: string, time = 0.35) => {
        const allowed: EnemyState[] = [
          'patrol',
          'suspicious',
          'investigate',
          'search',
          'cover',
          'flank',
          'firing',
          'suppressing',
          'stagger',
          'defeated',
        ];
        if (!allowed.includes(state as EnemyState)) return;
        for (const enemy of this.enemies.enemies) {
          enemy.setEvidenceState(state as EnemyState, time);
        }
      },
      setPlayerView: (
        x: number,
        y: number,
        z: number,
        yaw: number,
        pitch: number,
      ) => {
        const debugPosition = new THREE.Vector3(x, y, z);
        if (this.playMode === 'maps-zombies' && this.mapsOutbreakContainment) {
          this.mapsOutbreakContainment.commitEntry(
            'player',
            debugPosition,
            0.34,
            this.mapsOutbreakContainment.surface.layout.startRoomId,
          );
        } else if (this.isZombiesPlayMode()) {
          const roomId =
            this.zombiesNavigationSurface.roomIdForPosition(
              debugPosition,
              0.34,
            );
          if (roomId) {
            this.zombiesContainment.commitEntry(
              'player',
              debugPosition,
              0.34,
              roomId,
            );
          }
        }
        this.player.restore({
          ...this.player.snapshot(),
          position: debugPosition,
          yaw,
          pitch,
        }, true);
        this.player.updateCamera(
          FIXED_TIMESTEP,
          this.elapsed,
          this.persistence.state.settings.accessibility,
          this.weapon.adsFactor,
        );
        if (this.playMode === 'zombies') {
          this.completeZombiesSplatFrame(this.player.position, true);
        }
      },
      teleportZombie: (id: string, x: number, y: number, z: number) => {
        if (!this.isZombiesPlayMode()) return;
        const zombie = this.zombies.horde.zombies.find((entry) => entry.id === id);
        if (!zombie) return;
        zombie.setFootPosition(x, y, z);
        this.zombies.horde.assignZombieNavigationRoom(zombie);
      },
      zombiesAimDiagnostics: (id: string) => {
        const zombie = this.zombies.horde.zombies.find((entry) => entry.id === id);
        if (!zombie) return null;
        this.camera.updateMatrixWorld(true);
        const origin = this.camera.getWorldPosition(new THREE.Vector3());
        const direction = this.camera
          .getWorldDirection(new THREE.Vector3())
          .normalize();
        raycaster.set(origin, direction);
        raycaster.far = 50;
        const intersections = raycaster
          .intersectObjects(zombie.hitTargets, false)
          .filter((entry) => entry.object.visible)
          .slice(0, 5)
          .map((entry) => ({
            name: entry.object.name,
            hitZone: String(entry.object.userData.hitZone ?? ''),
            distance: entry.distance,
          }));
        const headTarget = zombie.headTargetWorld;
        const closestApproach = headTarget
          ? new THREE.Vector3(headTarget.x, headTarget.y, headTarget.z)
              .sub(origin)
              .cross(direction)
              .length()
          : null;
        return {
          origin: { x: origin.x, y: origin.y, z: origin.z },
          direction: { x: direction.x, y: direction.y, z: direction.z },
          headTarget,
          closestApproach,
          intersections,
        };
      },
      poseZombie: (id: string, semantic: string, time = 0.35) => {
        if (!this.isZombiesPlayMode()) return;
        const zombie = this.zombies.horde.zombies.find(
          (entry) => entry.id === id,
        );
        if (!zombie) return;
        const direction = this.player.position
          .clone()
          .sub(zombie.group.position);
        direction.y = 0;
        if (direction.lengthSq() > 1e-6) {
          zombie.group.rotation.y = Math.atan2(direction.x, direction.z);
        }
        zombie.setEvidenceAnimation(semantic, time);
      },
      characterFacingDiagnostics: () => {
        const enemies = this.enemies.enemies.map((enemy) => ({
          id: enemy.spawn.id,
          role: enemy.spawn.role,
          living: !enemy.isDefeated(),
          hasMintVisual: enemy.hasGeneratedVisual,
          yaw: enemy.group.rotation.y,
          headfrontDotActorForward: enemy.headfrontDotActorForward ?? -1,
        }));
        const zombies =
          this.isZombiesPlayMode()
            ? this.zombies.horde.zombies.map((zombie) => ({
                id: zombie.id,
                archetype: zombie.archetype,
                sprinter: zombie.sprinter,
                living: !zombie.isDefeated(),
                hasMintVisual: zombie.hasMintVisual,
                yaw: zombie.group.rotation.y,
                visualYaw: zombie.visualYaw,
                headfrontDotActorForward: zombie.headfrontDotActorForward ?? -1,
                x: zombie.group.position.x,
                y: zombie.group.position.y,
                z: zombie.group.position.z,
              }))
            : [];
        return { enemies, zombies };
      },
      zombiesGrantPoints: (amount: number) => {
        if (this.isZombiesPlayMode()) this.zombies.grantPoints(amount);
      },
      zombiesEquipWeapon: (weaponId) => {
        if (
          this.isZombiesPlayMode() &&
          WEAPONS.some((weapon) => weapon.id === weaponId)
        ) {
          this.weapon.grantWeapon(
            weaponId as import('../data/weapons').WeaponId,
            false,
          );
          return this.weapon.current.id;
        }
        return null;
      },
      zombiesForcePowerOn: () => {
        if (this.isZombiesPlayMode()) this.zombies.forcePowerOn();
      },
      zombiesForceClearRound: () => {
        if (this.isZombiesPlayMode()) this.zombies.forceClearRound();
      },
      zombiesForceBeginNextRound: () => {
        if (!this.isZombiesPlayMode()) return;
        this.mode = 'zombies';
        this.player.health = Math.max(this.player.health, 100);
        this.spawnProtectionRemaining = 60;
        this.zombies.forceBeginNextRound();
      },
      zombiesForceLethalHit: () => {
        if (this.isZombiesPlayMode()) {
          this.zombies.forceLethalHitForTest(this.player);
        }
      },
      zombiesArmSpawnProtection: (seconds = 60) => {
        if (!this.isZombiesPlayMode()) return;
        this.mode = 'zombies';
        this.spawnProtectionRemaining = Math.max(0, seconds);
        this.player.health = Math.max(this.player.health, 100);
      },
      zombiesResetNavigationDiagnostics: () => {
        if (!this.isZombiesPlayMode()) return;
        this.zombies.horde.resetNavigationDiagnostics();
      },
      zombiesSpawnPowerUp: (kind) => {
        if (this.isZombiesPlayMode()) this.zombies.forceSpawnPowerUp(kind);
      },
      zombiesPurchasePerk: (perkId) => {
        if (this.isZombiesPlayMode()) this.zombies.forcePurchasePerk(perkId);
      },
      zombiesFreezeInteractablePeak: (id) =>
        this.isZombiesPlayMode()
          ? this.zombies.freezeInteractableAtPeak(id)
          : false,
      zombiesInteractableVisuals: () =>
        this.isZombiesPlayMode()
          ? this.zombies.arena.getInteractableVisualDiagnostics()
          : [],
      zombiesSnapshot: () => {
        if (!this.isZombiesPlayMode()) return null;
        return this.zombies.getDebugSnapshot();
      },
      zombiesMintCoverage: () => {
        let machinePlaceholders = 0;
        this.scene.traverse((obj) => {
          if (typeof obj.userData.mintArtifactId === 'string') machinePlaceholders += 1;
        });
        return {
          zombieWalker: Boolean(this.assets.getArtifact('zombie-walker', 'model')),
          zombieSprinter: Boolean(this.assets.getArtifact('zombie-sprinter', 'model')),
          zombieAnimations: Boolean(
            this.assets.getArtifact('animation-zombie-horde', 'animation'),
          ),
          audioRoundStart: Boolean(
            this.assets.getArtifact('audio-zombies-round-start', 'audio'),
          ),
          proceduralZombieFallbacks:
            this.zombies.horde.proceduralFallbackCount,
          zombieMintAttachFailures: this.zombies.horde.mintFailureCount,
          machinePlaceholders,
        };
      },
      zombiesContainmentAudit: () => this.auditZombiesContainment(),
      zombiesContainmentPlayerRoom: () =>
        this.zombiesContainment.roomId('player'),
      zombiesSurfacePlacement: () =>
        this.zombies.arena.getSurfacePlacementDiagnostics(),
      zombiesCampusWaypoints: () => this.getZombiesCampusWaypoints(),
      zombiesCampusFloorPlan: () => this.getZombiesCampusFloorPlan(),
      zombiesWalkProbe: () => this.getZombiesWalkProbe(),
      zombiesHubResidency: () => this.getZombiesHubResidency(),
      zombiesRoomTransitSnapshot: () => {
        this.syncZombiesRoomTransitProgression();
        return this.zombiesRoomTransit.snapshot(
          this.player.position,
          this.currentZombiesRoomId(),
        );
      },
      zombiesActivateRoomTransit: () => {
        this.syncZombiesRoomTransitProgression();
        const navigation = this.zombiesRoomTransit.getNavigation(
          this.player.position,
          this.currentZombiesRoomId(),
        );
        const destination = this.zombiesRoomTransit.interaction(
          this.player.position,
          this.currentZombiesRoomId(),
          navigation.target?.kind === 'relay'
            ? navigation.target.terminalId
            : null,
          Boolean(navigation.target),
        );
        return destination
          ? this.useZombiesRoomTransit(destination)
          : false;
      },
      zombiesSpatialContracts: () => this.getZombiesSpatialContracts(),
      zombiesSetSplatAnalysisRoom: (index) =>
        this.setZombiesSplatAnalysisRoom(index),
      zombiesSplatAnalysis: () => this.getZombiesSplatAnalysis(),
      zombiesPortalDiagnostics: () =>
        this.getZombiesPortalDiagnostics(),
      zombiesSetDebugSplatPaint: (enabled: boolean) => {
        MintWorldLayer.setDebugSplatPaint(enabled);
        return MintWorldLayer.liveShaderUniforms();
      },
      zombiesLiveSparkUniforms: () => MintWorldLayer.liveShaderUniforms(),
      zombiesSparkMeshDiagnostics: () =>
        MintWorldLayer.sparkMeshDiagnostics(),
      zombiesProbeOrderingGpu: () =>
        MintWorldLayer.probeOrderingGpuUpload(this.renderer),
      zombiesProbeDisplayTextures: () =>
        MintWorldLayer.probeDisplayTextures(this.renderer),
      zombiesProbePaintedLuminance: () =>
        MintWorldLayer.probePaintedLuminance(
          this.renderer,
          this.scene,
          this.camera,
        ),
      zombiesProbeCanvasLuminance: () => {
        MintWorldLayer.ensureLiveSparkCamera();
        MintWorldLayer.prepareCutRendering(this.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.autoClear = true;
        this.renderer.render(this.scene, this.camera);
        const gl = this.renderer.getContext();
        const width = Math.min(64, this.renderer.domElement.width);
        const height = Math.min(64, this.renderer.domElement.height);
        const x = Math.max(
          0,
          Math.floor((this.renderer.domElement.width - width) / 2),
        );
        const y = Math.max(
          0,
          Math.floor((this.renderer.domElement.height - height) / 2),
        );
        const buffer = new Uint8Array(width * height * 4);
        gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
        let sum = 0;
        let max = 0;
        let nonClear = 0;
        for (let i = 0; i < buffer.length; i += 4) {
          const lum = (buffer[i]! + buffer[i + 1]! + buffer[i + 2]!) / 3;
          sum += lum;
          if (lum > max) max = lum;
          if (lum > 8) nonClear += 1;
        }
        const n = buffer.length / 4;
        return {
          mean: sum / n,
          max,
          nonClearPct: (100 * nonClear) / n,
          drawingBuffer: {
            width: this.renderer.domElement.width,
            height: this.renderer.domElement.height,
          },
          readRect: { x, y, width, height },
          renderTarget: this.renderer.getRenderTarget()?.texture.uuid ?? null,
        };
      },
      zombiesSetSplatIsolation: (enabled) =>
        this.setZombiesSplatIsolation(enabled),
      zombiesSetSplatAnalysisBudget: (splatCount) =>
        MintWorldLayer.setAnalysisSplatBudget(splatCount),
      zombiesSplatPortals: () => this.zombiesSplatCompletion.diagnostics(),
      zombiesCampusConnectivity: () =>
        this.getZombiesCampusConnectivity(),
      zombiesBeginSplatFrameHold: (seconds) =>
        this.beginZombiesSplatFrameHold(seconds),
      zombiesReleaseSplatFrameHold: () =>
        this.releaseZombiesSplatFrameHold(),
      zombiesSplatFrameHoldState: () => ({
        active: false,
        holding: false,
        primed: Boolean(
          this.zombiesSplatPrefetch &&
            this.mintZombiesRoomIds.includes(this.zombiesSplatPrefetch) &&
            this.mintWorldLayers
              .get(this.zombiesSplatPrefetch)
              ?.meetsResidency(0),
        ),
        activations: this.zombiesSplatFrameHoldActivations,
        remaining: 0,
      }),
      debugCenterRaycast: (x = 0, y = 0) => {
        this.camera.updateMatrixWorld(true);
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
        return raycaster
          .intersectObjects(this.scene.children, true)
          .slice(0, 24)
          .map((hit) => {
            const object = hit.object as THREE.Mesh;
            const material = object.material;
            const materials = Array.isArray(material)
              ? material
              : material
                ? [material]
                : [];
            const hierarchy: string[] = [];
            let ancestor: THREE.Object3D | null = object;
            while (ancestor) {
              hierarchy.push(
                `${ancestor.type}:${ancestor.name || '(unnamed)'}`,
              );
              ancestor = ancestor.parent;
            }
            return {
              name: object.name,
              parentName: object.parent?.name ?? '',
              distance: hit.distance,
              type: object.type,
              hierarchy,
              materials: materials.map((entry) => ({
                name: entry.name,
                type: entry.type,
                transparent: entry.transparent,
                opacity: entry.opacity,
                color:
                  'color' in entry &&
                  entry.color instanceof THREE.Color
                    ? `#${entry.color.getHexString()}`
                    : null,
              })),
            };
          });
      },
      zombiesStartCampusTour: () => this.startZombiesCampusTour(),
      zombiesCampusTourStatus: () => {
        const tour = this.campusTour;
        if (!tour) return { active: false, done: false, progress: 0 };
        return {
          active: !tour.done,
          done: tour.done,
          progress:
            tour.waypoints.length <= 1
              ? 1
              : tour.index / (tour.waypoints.length - 1),
        };
      },
    };
  }

  private auditZombiesContainment(): {
    ready: boolean;
    playerInsideSplat: boolean;
    playerInsidePlayable: boolean;
    player: { x: number; y: number; z: number };
    splatBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
    playableBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
    objects: Array<{
      id: string;
      roomId: string | null;
      x: number;
      y: number;
      z: number;
      insideSplat: boolean;
      insidePlayable: boolean;
    }>;
    outsideSplat: string[];
    outsidePlayable: string[];
  } {
    const toBox = (box: THREE.Box3 | null) =>
      box
        ? {
            min: { x: box.min.x, y: box.min.y, z: box.min.z },
            max: { x: box.max.x, y: box.max.y, z: box.max.z },
          }
        : null;
    const containsXZ = (box: THREE.Box3 | null, x: number, z: number) =>
      Boolean(box && x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z);
    const insideRoomSplat = (
      position: THREE.Vector3,
      roomId: string | null,
    ) => {
      if (!roomId) {
        return containsXZ(
          this.zombiesSplatBounds,
          position.x,
          position.z,
        );
      }
      // The live render union only contains the current owner and its warm
      // neighbors. Test authored containment against the object's own
      // source-derived room polygon so objects in resident sequential rooms
      // are not falsely reported outside the splat.
      return (
        this.zombiesNavigationSurface.signedDistanceForRoom(
          roomId,
          position,
          0,
        ) >= -0.2
      );
    };

    const splat = this.zombiesSplatBounds;
    const playable = this.zombiesPlayableBounds;
    const player = {
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
    };
    const objects: Array<{
      id: string;
      roomId: string | null;
      x: number;
      y: number;
      z: number;
      insideSplat: boolean;
      insidePlayable: boolean;
    }> = [];

    const pushObject = (
      id: string,
      position: THREE.Vector3,
      authoredRoomId: string | null = null,
    ) => {
      const roomId =
        authoredRoomId ??
        this.zombiesNavigationSurface.roomIdForPosition(position, 0);
      objects.push({
        id,
        roomId,
        x: position.x,
        y: position.y,
        z: position.z,
        insideSplat: insideRoomSplat(position, roomId),
        insidePlayable: containsXZ(playable, position.x, position.z),
      });
    };

    const anchors = this.zombies.arena.anchors;
    pushObject('playerStart', anchors.playerStart);
    pushObject(
      'powerSwitch',
      anchors.powerSwitch,
      this.zombies.arena.getAnchorRoom('power-switch'),
    );
    pushObject(
      'packAPunch',
      anchors.packAPunch,
      this.zombies.arena.getAnchorRoom('pack-a-punch'),
    );
    for (const door of anchors.doors) {
      pushObject(
        door.id,
        door.position,
        this.zombies.arena.getAnchorRoom(door.id),
      );
    }
    for (const wall of anchors.wallBuys) {
      pushObject(
        wall.id,
        wall.position,
        this.zombies.arena.getAnchorRoom(wall.id),
      );
    }
    for (const barrier of anchors.barriers) {
      pushObject(
        barrier.id,
        barrier.position,
        this.zombies.arena.getAnchorRoom(barrier.id),
      );
    }
    for (const perk of anchors.perks) {
      const id = `perk-${perk.perkId}`;
      pushObject(id, perk.position, this.zombies.arena.getAnchorRoom(id));
    }
    for (const [index, box] of anchors.mysteryBoxLocations.entries()) {
      const id = `mystery-box-${index}`;
      pushObject(id, box, this.zombies.arena.getAnchorRoom(id));
    }
    for (const spawn of anchors.spawnPoints) {
      pushObject(
        spawn.id,
        spawn.position,
        this.zombies.arena.getAnchorRoom(spawn.id),
      );
    }

    this.zombies.arena.group.traverse((obj) => {
      if (!(obj instanceof THREE.Object3D)) return;
      const artifactId = obj.userData.mintArtifactId;
      if (typeof artifactId !== 'string') return;
      // Only root-ish placed props (skip nested meshes without unique placement).
      if (obj.parent !== this.zombies.arena.group) return;
      const world = new THREE.Vector3();
      obj.getWorldPosition(world);
      pushObject(`mesh:${artifactId}`, world);
    });

    const outsideSplat = objects
      .filter((entry) => splat && !entry.insideSplat)
      .map((entry) => entry.id);
    const outsidePlayable = objects
      .filter((entry) => playable && !entry.insidePlayable)
      .map((entry) => entry.id);

    return {
      ready: this.zombiesPlayspaceReady,
      playerInsideSplat: insideRoomSplat(
        this.player.position,
        this.zombiesNavigationSurface.roomIdForPosition(
          this.player.position,
          0,
        ),
      ),
      playerInsidePlayable: containsXZ(playable, player.x, player.z),
      player,
      splatBounds: toBox(splat),
      playableBounds: toBox(playable),
      objects,
      outsideSplat,
      outsidePlayable,
    };
  }

  private setTestState(name: string): void {
    if (name === 'operations') {
      this.showOperations();
    } else if (name === 'loadout') {
      this.showOperations();
      this.handleUiAction('ops-loadout');
    } else if (name === 'briefing') {
      this.showOperations();
      this.handleUiAction('ops-briefing');
    } else if (name === 'active-play') {
      this.deployMission(() => {
        this.spawnProtectionRemaining = 0;
        this.hasLockedOnce = true;
        this.ui.setPointerPrompt(false);
      });
    } else if (name === 'zombies-play') {
      this.deployZombies();
      this.hasLockedOnce = true;
      this.ui.setPointerPrompt(false);
    } else if (name === 'maps-zombies-create') {
      this.handleUiAction('ops-maps-zombies');
    } else if (name === 'maps-zombies-play') {
      void this.playFeaturedMapsArena('golden-gate-overlook').then(() => {
        this.hasLockedOnce = true;
        this.ui.setPointerPrompt(false);
      });
    } else if (name === 'editor') {
      void this.openZombiesEditor();
    } else if (name === 'final-arena') {
      this.deployMission(() => {
        this.spawnProtectionRemaining = 0;
        this.hasLockedOnce = true;
        this.mission.setState('final-arena');
        this.player.restore({
          ...this.player.snapshot(),
          position: this.world.intelPosition
            .clone()
            .add(new THREE.Vector3(-2.5, 0, 2.5)),
        });
        this.enemies.setCheckpointSegment(2);
        this.ui.setPointerPrompt(false);
      });
    } else if (name === 'complete') {
      this.deployMission(() => {
        this.spawnProtectionRemaining = 0;
        this.hasLockedOnce = true;
        this.stats.elapsedMs = 184_230;
        this.stats.shotsFired = 58;
        this.stats.shotsHit = 37;
        this.stats.defeated = 8;
        this.completeMission();
      });
    }
  }

  private rootElement(): HTMLElement {
    return this.canvas.parentElement ?? document.body;
  }

  private clearEditorPreviewRoots(): void {
    while (this.editorPreviewRoots.length > 0) {
      this.scene.remove(this.editorPreviewRoots.pop()!);
    }
  }

  private readonly onPointerLock = (event: Event): void => {
    const detail = (event as CustomEvent<{ locked: boolean; gameplayEnabled: boolean }>).detail;
    if (detail.locked) {
      this.hasLockedOnce = true;
      this.ui.setPointerPrompt(false);
    } else if (this.mode === 'mission' && this.hasLockedOnce && detail.gameplayEnabled) {
      this.pauseMission();
    } else if (this.isZombiesHudMode() && this.hasLockedOnce && detail.gameplayEnabled) {
      this.pauseZombies();
    }
  };

  private static supportsWebGL2(): boolean {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return context !== null;
  }
}
