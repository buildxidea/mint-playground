import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import navigationJson from '../assets/zombies-splat-navigation.json' with { type: 'json' };
import {
  splatNavigationSignedDistanceXZ,
  validateSplatLayout,
  type SplatLayoutAsset,
  type SplatDoorwaySocket,
  type SplatLayoutPortal,
  type SplatLayoutRoom,
  type SplatTransform,
  type SplatWalkablePatch,
  type SplatWorldNavigationMesh,
} from '../world/SplatNavigationSurface';
import { MintWorldLayer } from '../world/MintWorldLayer';
import {
  MAX_SPLAT_CUT_VOLUMES,
  STANDARD_DOOR_CUT_SIZE,
  STANDARD_DOOR_CUT_SILL,
  clampCutAboveFloor,
  doorCutYawForWallEdge,
  pointInsideCutVolume,
  prepareSplatCutVolumes,
  roomFloorY,
  seatedCutCenterY,
  type SplatCutVolume,
} from '../world/SplatCutVolume';
import {
  appendWorldPolygonToNavigation,
  clipNavigationMeshByCuts,
  roomClipFingerprint,
} from '../world/clipNavigationByCuts';
import {
  CUT_DOORWAY_PAIR_MAX_DIST_M,
  appendCutDoorwayAperturesToNavigation,
  normalizeOverlappingDoorwayCuts,
  scoreCutDoorwayOverlap,
} from '../world/splatDoorwayAperture';
import {
  MAX_SPLAT_TRIM_PLANES,
  pointTrimmedByPlane,
  prepareSplatTrimPlanes,
  trimPlaneNormal,
  type SplatTrimPlane,
} from '../world/SplatTrimPlane';
import type { ZombiesArena } from '../zombies/ZombiesArena';
import {
  validateZombiesPlacementLayout,
  type ZombiesPlacementLayout,
  type ZombiesPlacementRecord,
} from '../zombies/ZombiesPlacementLayout';
import {
  EditorUI,
  type EditorEntitySummary,
  type EditorSelectionDetails,
  type EditorSpace,
  type EditorTool,
  type EditorValidationView,
} from './EditorUI';

type NavigationAsset = typeof navigationJson;
export type EditorDataSnapshot = {
  layout: SplatLayoutAsset;
  navigation: NavigationAsset;
  placements: ZombiesPlacementLayout;
};

export type ZombiesEditorSavePayload = {
  layout: SplatLayoutAsset;
  navigation: NavigationAsset;
  placements: ZombiesPlacementLayout;
};

type EditorEntityType =
  | 'room'
  | 'boundary'
  | 'walkable-proxy'
  | 'socket'
  | 'portal'
  | 'cut'
  | 'trim'
  | 'placement';
type EditorEntity = {
  id: string;
  dataId: string;
  type: EditorEntityType;
  label: string;
  kind: string;
  category: EditorEntitySummary['category'];
  roomId: string;
  object: THREE.Object3D;
  pickObject: THREE.Object3D;
  labelSprite: THREE.Sprite | null;
  editable: boolean;
  mount: string;
};

type EditorCommand = {
  label: string;
  before: EditorDataSnapshot;
  after: EditorDataSnapshot;
};

type EntityTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

export type ZombiesEditorOptions = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  uiParent: HTMLElement;
  rooms: Map<string, EditorSplatLayer>;
  arena: ZombiesArena;
  layout: SplatLayoutAsset;
  navigationCalibrationByRoom: Map<string, number>;
  onExit(): void;
  onPlaytest(): void;
  /** Called after a successful project JSON save so gameplay can hot-reload assets. */
  onProjectSaved?(payload: ZombiesEditorSavePayload): void;
};

export type EditorSplatLayer = {
  root: THREE.Group;
  applyAuthoredTransform(
    position: readonly [number, number, number],
    rotation: readonly [number, number, number],
    scale: number,
  ): void;
  setRenderState(state: 'primary' | 'resident'): void;
  /** Refresh paged splat matrices after TransformControls changes root directly. */
  refreshTransform?(): void;
  setCutVolumes?(cuts: readonly SplatCutVolume[]): void;
  setTrimPlanes?(trims: readonly SplatTrimPlane[]): void;
  nearestColliderSurface?(
    reference: THREE.Vector3,
    kind: 'wall' | 'floor',
    maxDistance: number,
  ): { point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null;
  raycastCollider?(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): { point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null;
};

export type ZombiesEditorDiagnostics = {
  active: boolean;
  roomCount: number;
  portalCount: number;
  placementCount: number;
  selectedId: string | null;
  dirty: boolean;
  errors: string[];
  warnings: string[];
  outsideIds: string[];
  connected: boolean;
  connectorCount: number;
  cutCount: number;
  trimCount: number;
  connectiveTissueCount: number;
};

export type ZombiesEditorClipVisualDiagnostics = {
  entityId: string;
  kind: 'cut' | 'trim';
  roomId: string;
  enabled: boolean;
  selected: boolean;
  effectiveVisible: boolean;
  inFrustum: boolean;
  screen: [number, number];
  worldCenter: [number, number, number];
  worldSize: [number, number, number];
  materialOpacity: number;
};

const LEGACY_DRAFT_KEY = 'blacksite:zombies-editor-draft:v1';
/** Bump after wiping AI connective drafts so old localStorage cannot clobber a clean layout. */
const DRAFT_KEY = 'blacksite:zombies-editor-draft:v7';
const ROOM_HANDLE_PREFIX = 'splat:';
const BOUNDARY_HANDLE_PREFIX = 'boundary:';
const WALKABLE_PROXY_PREFIX = 'walkable-proxy:';
const SOCKET_HANDLE_PREFIX = 'doorway:';
const PORTAL_HANDLE_PREFIX = 'portal:';
const CUT_HANDLE_PREFIX = 'cut:';
const TRIM_HANDLE_PREFIX = 'trim:';
const PLACEMENT_HANDLE_PREFIX = 'placement:';
/** Screen-pixel radius for forgiving walkable corner clicks (top-down views). */
const WALKABLE_PICK_SCREEN_PX = 42;
const WALKABLE_HANDLE_RADIUS = 0.72;
const WALKABLE_PROXY_RADIUS = 0.55;
/** Paired cuts farther than this lose their doorway link. */
const CUT_DOORWAY_BREAK_DIST_M = CUT_DOORWAY_PAIR_MAX_DIST_M + 1.5;
const SELECTED_EMISSIVE = new THREE.Color('#b8ff3d');
const HOVER_EMISSIVE = new THREE.Color('#ffb23d');
const CLEAR_EMISSIVE = new THREE.Color('#000000');

const PLACEMENT_COLORS: Record<ZombiesPlacementRecord['kind'], number> = {
  'player-start': 0xffffff,
  'wall-buy': 0x63b6ff,
  door: 0xffa640,
  barrier: 0xb78b63,
  'power-switch': 0x6dff79,
  'mystery-box': 0xc778ff,
  perk: 0xffec63,
  'pack-a-punch': 0xff7f38,
  'zombie-spawn': 0xff5147,
};

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function roomLabel(id: string): string {
  const suffix = id.replace(/^world-zombies-arena-?/, '');
  if (!suffix) return 'Hub';
  return suffix
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function finiteTransform(transform: EntityTransform): boolean {
  return [
    ...transform.position,
    ...transform.rotation,
    ...transform.scale,
  ].every(Number.isFinite);
}

function closestPointOnPolygonBoundary(
  polygon: readonly THREE.Vector2[],
  target: THREE.Vector2,
): THREE.Vector2 | null {
  if (polygon.length < 2) return null;
  let closest: THREE.Vector2 | null = null;
  let closestDistanceSq = Number.POSITIVE_INFINITY;
  const segment = new THREE.Line3();
  const target3 = new THREE.Vector3(target.x, 0, target.y);
  const candidate = new THREE.Vector3();
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    segment.start.set(start.x, 0, start.y);
    segment.end.set(end.x, 0, end.y);
    segment.closestPointToPoint(target3, true, candidate);
    const distanceSq = candidate.distanceToSquared(target3);
    if (distanceSq >= closestDistanceSq) continue;
    closestDistanceSq = distanceSq;
    closest = new THREE.Vector2(candidate.x, candidate.z);
  }
  return closest;
}

function cutCenterDistance(a: SplatCutVolume, b: SplatCutVolume): number {
  return Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  );
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(5, 9, 7, 0.86)';
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.fillRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fillStyle = '#f1f5f1';
    context.font = '600 34px Arial Narrow, Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6.4, 1.2, 1);
  sprite.renderOrder = 60;
  return sprite;
}

function transformPointBetweenRooms(
  point: [number, number, number],
  before: SplatTransform,
  after: SplatTransform,
): [number, number, number] {
  const dx = point[0] - before.position[0];
  const dz = point[2] - before.position[2];
  const beforeCosine = Math.cos(-before.authoredYaw);
  const beforeSine = Math.sin(-before.authoredYaw);
  const localX = dx * beforeCosine - dz * beforeSine;
  const localZ = dx * beforeSine + dz * beforeCosine;
  const ratio = after.scale / Math.max(before.scale, 1e-6);
  const afterCosine = Math.cos(after.authoredYaw);
  const afterSine = Math.sin(after.authoredYaw);
  const scaledX = localX * ratio;
  const scaledZ = localZ * ratio;
  return [
    after.position[0] + scaledX * afterCosine - scaledZ * afterSine,
    after.position[1] + (point[1] - before.position[1]) * ratio,
    after.position[2] + scaledX * afterSine + scaledZ * afterCosine,
  ];
}

function editorPointInTriangleXZ(
  point: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): boolean {
  const v0 = new THREE.Vector2(c.x - a.x, c.z - a.z);
  const v1 = new THREE.Vector2(b.x - a.x, b.z - a.z);
  const v2 = new THREE.Vector2(point.x - a.x, point.z - a.z);
  const dot00 = v0.dot(v0);
  const dot01 = v0.dot(v1);
  const dot02 = v0.dot(v2);
  const dot11 = v1.dot(v1);
  const dot12 = v1.dot(v2);
  const denominator = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denominator) < 1e-9) return false;
  const inverse = 1 / denominator;
  const u = (dot11 * dot02 - dot01 * dot12) * inverse;
  const v = (dot00 * dot12 - dot01 * dot02) * inverse;
  return u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6;
}

function reachableNavigationSupportPoint(
  navigation: SplatWorldNavigationMesh,
  anchorValue: readonly number[],
  target: THREE.Vector3,
  leadInDistance = 5,
): THREE.Vector3 {
  const centroids: THREE.Vector3[] = [];
  const triangleCount = Math.floor(navigation.indices.length / 3);
  const adjacency = Array.from(
    { length: triangleCount },
    () => new Set<number>(),
  );
  const trianglesByEdge = new Map<string, number[]>();
  const anchor = new THREE.Vector3(
    anchorValue[0] ?? target.x,
    anchorValue[1] ?? target.y,
    anchorValue[2] ?? target.z,
  );
  let containingStart = -1;
  let nearestStart = -1;
  let nearestStartDistance = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < navigation.indices.length; offset += 3) {
    const triangleIndex = offset / 3;
    const points = [0, 1, 2].map((corner) => {
      const vertexOffset = navigation.indices[offset + corner]! * 3;
      return new THREE.Vector3(
        navigation.vertices[vertexOffset]!,
        navigation.vertices[vertexOffset + 1]!,
        navigation.vertices[vertexOffset + 2]!,
      );
    });
    const centroid = points
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .multiplyScalar(1 / 3);
    centroids.push(centroid);
    if (editorPointInTriangleXZ(anchor, points[0]!, points[1]!, points[2]!)) {
      containingStart = triangleIndex;
    }
    const startDistance = centroid.distanceToSquared(anchor);
    if (startDistance < nearestStartDistance) {
      nearestStartDistance = startDistance;
      nearestStart = triangleIndex;
    }
    for (let edge = 0; edge < 3; edge += 1) {
      const a = navigation.indices[offset + edge]!;
      const b = navigation.indices[offset + ((edge + 1) % 3)]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const owners = trianglesByEdge.get(key) ?? [];
      owners.push(triangleIndex);
      trianglesByEdge.set(key, owners);
    }
  }
  for (const owners of trianglesByEdge.values()) {
    for (const first of owners) {
      for (const second of owners) {
        if (first !== second) adjacency[first]!.add(second);
      }
    }
  }
  const start = containingStart >= 0 ? containingStart : nearestStart;
  if (start < 0) return target.clone();
  const reachable = new Uint8Array(triangleCount);
  const previous = new Int32Array(triangleCount).fill(-1);
  const queue = [start];
  reachable[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of adjacency[queue[cursor]!]!) {
      if (reachable[neighbor]) continue;
      reachable[neighbor] = 1;
      previous[neighbor] = queue[cursor]!;
      queue.push(neighbor);
    }
  }
  let supportIndex = start;
  let support = centroids[supportIndex]!;
  let supportDistance = support.distanceToSquared(target);
  for (let index = 0; index < centroids.length; index += 1) {
    if (!reachable[index]) continue;
    const distance = centroids[index]!.distanceToSquared(target);
    if (distance < supportDistance) {
      support = centroids[index]!;
      supportIndex = index;
      supportDistance = distance;
    }
  }
  let walked = 0;
  while (previous[supportIndex] >= 0 && walked < leadInDistance) {
    const nextIndex = previous[supportIndex]!;
    walked += centroids[supportIndex]!.distanceTo(centroids[nextIndex]!);
    supportIndex = nextIndex;
  }
  support = centroids[supportIndex]!;
  return support.clone();
}

function bufferedConvexHull(
  points: readonly THREE.Vector3[],
  width: number,
): Array<[number, number]> {
  const halfWidth = width * 0.5;
  const samples = points.flatMap((point) => [
    new THREE.Vector2(point.x - halfWidth, point.z - halfWidth),
    new THREE.Vector2(point.x - halfWidth, point.z + halfWidth),
    new THREE.Vector2(point.x + halfWidth, point.z - halfWidth),
    new THREE.Vector2(point.x + halfWidth, point.z + halfWidth),
  ]);
  samples.sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (
    origin: THREE.Vector2,
    a: THREE.Vector2,
    b: THREE.Vector2,
  ) =>
    (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x);
  const lower: THREE.Vector2[] = [];
  for (const point of samples) {
    while (
      lower.length >= 2 &&
      cross(lower.at(-2)!, lower.at(-1)!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: THREE.Vector2[] = [];
  for (const point of [...samples].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper.at(-2)!, upper.at(-1)!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper].map((point) => [point.x, point.y]);
}

export class ZombiesEditor {
  private readonly ui: EditorUI;
  private readonly orbit: OrbitControls;
  private readonly transform: TransformControls;
  private readonly transformHelper: THREE.Object3D;
  private readonly helperRoot = new THREE.Group();
  private readonly navigationRoot = new THREE.Group();
  private readonly boundaryRoot = new THREE.Group();
  private readonly doorwayRoot = new THREE.Group();
  private readonly connectiveRoot = new THREE.Group();
  private readonly trimRoot = new THREE.Group();
  private readonly placementRoot = new THREE.Group();
  private readonly labelRoot = new THREE.Group();
  private readonly grid = new THREE.GridHelper(120, 120, 0x6f925a, 0x233026);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly entities = new Map<string, EditorEntity>();
  private readonly pickEntityByObject = new Map<THREE.Object3D, string>();
  private readonly originalCamera = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    up: new THREE.Vector3(),
    fov: 0,
    near: 0,
    far: 0,
  };
  private readonly originalFog: THREE.Fog | THREE.FogExp2 | null;
  private readonly originalBackground: THREE.Color | THREE.Texture | null;
  private original: EditorDataSnapshot;
  private data: EditorDataSnapshot;
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private cutClipboard: SplatCutVolume | null = null;
  private trimClipboard: SplatTrimPlane | null = null;
  private clipboardType: 'cut' | 'trim' | null = null;
  private history: EditorCommand[] = [];
  private historyIndex = 0;
  private dragBefore: EditorDataSnapshot | null = null;
  private transformInteractionActive = false;
  private tool: EditorTool = 'translate';
  private space: EditorSpace = 'world';
  private snap = 0.25;
  private dirty = false;
  private saving = false;
  private playtesting = false;
  private status = 'Editor ready // all six splats loaded';
  private disposed = false;
  private validation: EditorValidationView = {
    errors: [],
    warnings: [],
    roomCount: 0,
    portalCount: 0,
    placementCount: 0,
    outsideCount: 0,
    connected: false,
    connectorCount: 0,
    cutCount: 0,
    trimCount: 0,
  };
  private outsideIds: string[] = [];
  private readonly hiddenLayerIds = new Set<string>();
  private readonly lockedLayerIds = new Set<string>();
  private soloLayerId: string | null = null;
  private boundaryEditRoomId: string | null = null;
  private boundaryEditPatchId: string | null = null;
  /** While editing, hide other patches' fills so stacked corners are readable. */
  private walkableFocusActive = true;
  /** Corner = reshape one vertex; patch = drag any handle to translate the whole polygon. */
  private walkableDragMode: 'corner' | 'patch' = 'corner';
  private readonly walkableScreenPoint = new THREE.Vector3();
  private readonly overlays: Record<string, boolean> = {
    splats: true,
    navigation: true,
    doorways: true,
    connective: true,
    trims: true,
    placements: true,
    labels: true,
    grid: true,
  };

  constructor(private readonly options: ZombiesEditorOptions) {
    this.originalCamera.position.copy(options.camera.position);
    this.originalCamera.quaternion.copy(options.camera.quaternion);
    this.originalCamera.up.copy(options.camera.up);
    this.originalCamera.fov = options.camera.fov;
    this.originalCamera.near = options.camera.near;
    this.originalCamera.far = options.camera.far;
    this.originalFog = options.scene.fog;
    this.originalBackground = options.scene.background;
    const placements: ZombiesPlacementLayout = {
      version: 1,
      coordinateSpace: 'three-world-metres',
      placements: options.arena.editorPlacements(),
    };
    this.original = {
      layout: cloneData(options.layout),
      navigation: cloneData(navigationJson),
      placements,
    };
    this.original.layout.cutVolumes ??= [];
    this.original.layout.trimPlanes ??= [];
    this.data = cloneData(this.original);
    // Clip-derived doorway sockets are projected from their authoritative
    // cuts/trims. Normalize that projection before capturing the clean
    // baseline; otherwise the first Undo compares against stale socket
    // metadata and incorrectly leaves an untouched project marked dirty.
    this.syncDerivedPortalSockets();
    this.original = cloneData(this.data);
    // Retired draft keys may still contain wiped or AI-authored cut/door data.
    try {
      localStorage.removeItem(LEGACY_DRAFT_KEY);
      for (const version of [2, 3, 4, 5, 6] as const) {
        localStorage.removeItem(`blacksite:zombies-editor-draft:v${version}`);
      }
    } catch {
      // Storage can be unavailable in hardened browser profiles.
    }
    this.recoverDraft();
    this.data.layout.cutVolumes ??= [];
    this.data.layout.trimPlanes ??= [];
    this.data.layout.walkablePatches ??= [];
    this.original.layout.walkablePatches ??= [];
    normalizeOverlappingDoorwayCuts(this.data.layout);

    this.helperRoot.name = 'zombies-editor-helpers';
    this.navigationRoot.name = 'zombies-editor-navigation';
    this.boundaryRoot.name = 'zombies-editor-boundary-handles';
    this.doorwayRoot.name = 'zombies-editor-doorways';
    this.connectiveRoot.name = 'zombies-editor-connective-tissue';
    this.trimRoot.name = 'zombies-editor-trim-planes';
    this.placementRoot.name = 'zombies-editor-placements';
    this.labelRoot.name = 'zombies-editor-labels';
    this.grid.name = 'zombies-editor-grid';
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.28;
    this.grid.position.y = 0.035;
    this.helperRoot.add(
      this.navigationRoot,
      this.doorwayRoot,
      this.connectiveRoot,
      this.trimRoot,
      this.placementRoot,
      this.labelRoot,
      this.grid,
    );
    options.scene.add(this.helperRoot);

    this.orbit = new OrbitControls(options.camera, options.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.09;
    this.orbit.screenSpacePanning = true;
    this.orbit.maxDistance = 220;
    this.orbit.minDistance = 2;
    this.orbit.maxPolarAngle = Math.PI * 0.495;

    this.transform = new TransformControls(options.camera, options.canvas);
    this.transform.setMode(this.tool);
    this.transform.setSpace(this.space);
    this.transform.setTranslationSnap(this.snap);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(5));
    this.transform.setScaleSnap(0.05);
    this.transform.size = 0.82;
    this.transformHelper = this.transform.getHelper();
    this.transformHelper.name = 'zombies-editor-transform-controls';
    options.scene.add(this.transformHelper);
    this.transform.addEventListener('dragging-changed', this.onDraggingChanged);
    this.transform.addEventListener('mouseDown', this.onTransformMouseDown);
    this.transform.addEventListener('objectChange', this.onTransformChange);
    this.transform.addEventListener('mouseUp', this.onTransformMouseUp);

    options.canvas.addEventListener('pointerdown', this.onPointerDown);
    options.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('beforeunload', this.onBeforeUnload);

    this.ui = new EditorUI(options.uiParent, {
      onAction: (action, value) => this.handleUiAction(action, value),
      onSelect: (id) => this.select(id),
      onField: (field, value) => this.setField(field, value),
      onRoom: (roomId) => this.setSelectedRoom(roomId),
      onImport: (text) => this.importJson(text),
    });

    options.scene.fog = null;
    options.scene.background = new THREE.Color('#07100c');
    options.camera.fov = 55;
    options.camera.near = 0.05;
    options.camera.far = 500;
    options.camera.up.set(0, 1, 0);
    options.camera.updateProjectionMatrix();

    this.rebuildEntities();
    this.applyDataToScene();
    this.frameAll('perspective');
    const startupPairNote = this.reconcileCutDoorwayLinks();
    if (startupPairNote) {
      this.rebuildEntities();
      this.applyDataToScene();
      this.dirty = true;
      this.persistDraft();
      this.refresh(
        `Auto-paired overlapping door cuts · ${startupPairNote}`,
      );
    } else {
      this.refresh('All six splats and every gameplay placement are visible');
    }
  }

  update(delta: number): void {
    if (this.disposed) return;
    this.orbit.update(Math.min(delta, 0.05));
  }

  diagnostics(): ZombiesEditorDiagnostics {
    return {
      active: !this.disposed,
      roomCount: this.validation.roomCount,
      portalCount: this.validation.portalCount,
      placementCount: this.validation.placementCount,
      selectedId: this.selectedId,
      dirty: this.dirty,
      errors: [...this.validation.errors],
      warnings: [...this.validation.warnings],
      outsideIds: [...this.outsideIds],
      connected: this.validation.connected,
      connectorCount: this.validation.connectorCount,
      cutCount: this.validation.cutCount,
      trimCount: this.validation.trimCount,
      connectiveTissueCount: this.connectiveRoot.children.length,
    };
  }

  clipVisualDiagnostics(
    clipId: string,
  ): ZombiesEditorClipVisualDiagnostics | null {
    const cut = this.cut(clipId);
    const trim = this.trim(clipId);
    const entityId = cut
      ? `${CUT_HANDLE_PREFIX}${clipId}`
      : trim
        ? `${TRIM_HANDLE_PREFIX}${clipId}`
        : null;
    if (!entityId) return null;
    const entity = this.entities.get(entityId);
    if (!entity || (!cut && !trim)) return null;

    entity.object.updateWorldMatrix(true, true);
    this.options.camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(entity.object);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const projected = center.clone().project(this.options.camera);
    const canvasBounds = this.options.canvas.getBoundingClientRect();
    const screen: [number, number] = [
      canvasBounds.left + ((projected.x + 1) * canvasBounds.width) / 2,
      canvasBounds.top + ((1 - projected.y) * canvasBounds.height) / 2,
    ];
    const viewProjection = new THREE.Matrix4().multiplyMatrices(
      this.options.camera.projectionMatrix,
      this.options.camera.matrixWorldInverse,
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
    let effectiveVisible = true;
    for (
      let current: THREE.Object3D | null = entity.object;
      current;
      current = current.parent
    ) {
      effectiveVisible &&= current.visible;
    }
    let materialOpacity = 0;
    entity.object.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        materialOpacity = Math.max(materialOpacity, material.opacity);
      }
    });

    return {
      entityId,
      kind: cut ? 'cut' : 'trim',
      roomId: (cut ?? trim)!.roomId,
      enabled: (cut ?? trim)!.enabled,
      selected: this.selectedId === entityId,
      effectiveVisible,
      inFrustum:
        projected.z >= -1 &&
        projected.z <= 1 &&
        frustum.intersectsBox(bounds),
      screen,
      worldCenter: center.toArray(),
      worldSize: size.toArray(),
      materialOpacity,
    };
  }

  placementSnapshot(): ZombiesPlacementLayout {
    return cloneData(this.data.placements);
  }

  authoringSnapshot(): EditorDataSnapshot {
    return this.snapshot();
  }

  selectById(id: string): boolean {
    if (!this.entities.has(id)) return false;
    this.select(id);
    return true;
  }

  setView(view: 'perspective' | 'top'): void {
    this.frameAll(view);
  }

  /**
   * Test/verification helper: translate a trim plane and refresh splat + nav.
   * Returns the new world position, or null if the trim is missing.
   */
  nudgeTrimPlane(
    trimId: string,
    delta: readonly [number, number, number],
  ): { id: string; position: [number, number, number] } | null {
    const trim = this.trim(trimId);
    if (!trim) return null;
    const before = this.snapshot();
    trim.position = [
      trim.position[0] + delta[0],
      trim.position[1] + delta[1],
      trim.position[2] + delta[2],
    ];
    const entity = this.entities.get(`${TRIM_HANDLE_PREFIX}${trimId}`);
    if (entity) this.applyEntityDataToObject(entity);
    this.applyCutVolumes();
    this.rebuildNavigationGeometry();
    this.applyOverlayVisibility();
    this.commit(`Nudge ${trimId}`, before);
    return { id: trimId, position: [...trim.position] };
  }

  /** Test helper: set absolute trim world position. */
  setTrimPlanePosition(
    trimId: string,
    position: readonly [number, number, number],
  ): { id: string; position: [number, number, number] } | null {
    const trim = this.trim(trimId);
    if (!trim) return null;
    const before = this.snapshot();
    trim.position = [position[0], position[1], position[2]];
    const entity = this.entities.get(`${TRIM_HANDLE_PREFIX}${trimId}`);
    if (entity) this.applyEntityDataToObject(entity);
    this.applyCutVolumes();
    this.rebuildNavigationGeometry();
    this.applyOverlayVisibility();
    this.commit(`Set ${trimId} position`, before);
    return { id: trimId, position: [...trim.position] };
  }

  setOverlayVisibilityFlags(
    flags: Partial<{
      splats: boolean;
      navigation: boolean;
      doorways: boolean;
      trims: boolean;
      labels: boolean;
      placements: boolean;
      grid: boolean;
      connective: boolean;
    }>,
  ): void {
    Object.assign(this.overlays, flags);
    this.applyOverlayVisibility();
    this.refresh();
  }

  saveProjectForTests(): Promise<boolean> {
    return this.saveToProject();
  }

  /** Test helper: add a walkable patch and enter edit mode on it. */
  addWalkablePatchForTests(roomId?: string): {
    patchId: string;
    roomId: string;
    count: number;
  } | null {
    const beforeIds = new Set(
      (this.data.layout.walkablePatches ?? []).map((patch) => patch.id),
    );
    if (!this.addWalkablePatch(roomId)) return null;
    const created = (this.data.layout.walkablePatches ?? []).find(
      (patch) => !beforeIds.has(patch.id),
    );
    if (!created) return null;
    return {
      patchId: created.id,
      roomId: created.roomId,
      count: (this.data.layout.walkablePatches ?? []).filter(
        (patch) => patch.roomId === created.roomId,
      ).length,
    };
  }

  /** Test helper: enter edit mode for a specific walkable patch. */
  editWalkablePatchForTests(patchId: string): boolean {
    const patch = this.walkablePatch(patchId);
    if (!patch) return false;
    this.beginBoundaryEdit(patch.roomId, patch.id);
    return this.boundaryEditPatchId === patchId;
  }

  walkablePatchSnapshotForTests(): Array<{
    id: string;
    roomId: string;
    pointCount: number;
    editing: boolean;
  }> {
    return (this.data.layout.walkablePatches ?? []).map((patch) => ({
      id: patch.id,
      roomId: patch.roomId,
      pointCount: patch.polygon.length,
      editing: this.boundaryEditPatchId === patch.id,
    }));
  }

  /** Test helper: nudge the active walkable patch vertex on X/Z. */
  nudgeWalkablePointForTests(
    index: number,
    delta: readonly [number, number],
  ): boolean {
    if (!this.boundaryEditRoomId || !this.boundaryEditPatchId) return false;
    const room = this.room(this.boundaryEditRoomId);
    const patch = this.walkablePatch(this.boundaryEditPatchId);
    if (!room || !patch?.polygon[index]) return false;
    const before = this.snapshot();
    const world = this.walkablePatchWorldPolygon(room, patch)[index]!;
    const local = this.socketLocalPoint(
      room,
      new THREE.Vector2(world.x + delta[0], world.y + delta[1]),
    );
    patch.polygon[index] = [local.x, local.y];
    this.rebuildEntities();
    this.applyDataToScene();
    this.select(`${BOUNDARY_HANDLE_PREFIX}${room.id}:${index}`);
    this.commit(`Nudge ${patch.id} point ${index}`, before);
    return true;
  }

  /** Test/verification helper: enable or disable a cut cube or trim plane. */
  setClipEnabled(
    clipId: string,
    enabled: boolean,
  ): { id: string; kind: 'cut' | 'trim'; enabled: boolean } | null {
    const cut = this.cut(clipId);
    if (cut) {
      if (cut.enabled === enabled) {
        this.applyCutVolumes();
        this.rebuildNavigationGeometry();
        this.applyOverlayVisibility();
        return { id: clipId, kind: 'cut', enabled };
      }
      const before = this.snapshot();
      cut.enabled = enabled;
      this.applyCutVolumes();
      this.rebuildNavigationGeometry();
      this.applyOverlayVisibility();
      this.transform.detach();
      this.commit(
        `${enabled ? 'Enabled' : 'Disabled'} cut ${clipId}`,
        before,
      );
      return { id: clipId, kind: 'cut', enabled };
    }
    const trim = this.trim(clipId);
    if (trim) {
      if (trim.enabled === enabled) {
        this.applyCutVolumes();
        this.rebuildNavigationGeometry();
        this.applyOverlayVisibility();
        return { id: clipId, kind: 'trim', enabled };
      }
      const before = this.snapshot();
      trim.enabled = enabled;
      this.applyCutVolumes();
      this.rebuildNavigationGeometry();
      this.applyOverlayVisibility();
      this.transform.detach();
      this.commit(
        `${enabled ? 'Enabled' : 'Disabled'} trim ${clipId}`,
        before,
      );
      return { id: clipId, kind: 'trim', enabled };
    }
    return null;
  }

  /** Frame a cut/trim doorway for editor screenshot verification. */
  frameClip(clipId: string, view: 'perspective' | 'top' = 'perspective'): boolean {
    const cutEntity = `${CUT_HANDLE_PREFIX}${clipId}`;
    const trimEntity = `${TRIM_HANDLE_PREFIX}${clipId}`;
    const entityId = this.entities.has(cutEntity)
      ? cutEntity
      : this.entities.has(trimEntity)
        ? trimEntity
        : null;
    if (!entityId) return false;
    this.overlays.doorways = true;
    this.applyOverlayVisibility();
    this.select(entityId);
    if (view === 'top') {
      const entity = this.entities.get(entityId)!;
      const center = entity.object.getWorldPosition(new THREE.Vector3());
      this.options.camera.up.set(0, 0, -1);
      this.options.camera.position.set(center.x, center.y + 28, center.z);
      this.orbit.target.copy(center);
      this.options.camera.lookAt(center);
      this.orbit.update();
      this.refresh(`Top framed ${clipId}`);
      return true;
    }
    this.frameSelection();
    return true;
  }

  /** Interior look-through view from the owning room into the cut doorway. */
  frameCutLookThrough(cutId: string, leadIn = 6): boolean {
    const cut = this.cut(cutId);
    if (!cut) return false;
    const room = this.room(cut.roomId);
    if (!room) return false;
    const entityId = `${CUT_HANDLE_PREFIX}${cutId}`;
    if (!this.entities.has(entityId)) return false;
    // Keep splats on; hide doorway gizmos so A/B measures voxels only.
    this.overlays.splats = true;
    this.overlays.doorways = false;
    this.overlays.trims = false;
    this.overlays.labels = false;
    this.overlays.navigation = false;
    this.hiddenLayerIds.clear();
    // A standalone opening only owns one splat. Isolate it for cut proof so
    // another overlapping resident capture cannot redraw the removed wall.
    // Linked doorway clips keep all rooms visible for seam inspection.
    this.soloLayerId = cut.portalId ? null : cut.roomId;
    this.applyOverlayVisibility();
    this.applyRoomTransforms();
    this.select(entityId);

    const center = new THREE.Vector3(...cut.position);
    const roomAnchor = new THREE.Vector3(
      room.transform.position[0],
      center.y,
      room.transform.position[2],
    );
    // Prefer the side that faces the owning room interior so the camera
    // stands inside splat coverage looking into the wall cutout.
    const fromRoom = center.clone().sub(roomAnchor);
    fromRoom.y = 0;
    if (fromRoom.lengthSq() < 1e-4) {
      fromRoom.set(1, 0, 0).applyEuler(new THREE.Euler(...cut.rotation));
    } else {
      fromRoom.normalize();
    }
    const eyeHeight =
      room.transform.position[1] -
      1.5 +
      Math.min(1.7, Math.max(1.2, cut.size[1] * 0.22));
    this.options.camera.up.set(0, 1, 0);
    this.options.camera.position
      .copy(center)
      .addScaledVector(fromRoom, -Math.max(2.5, leadIn));
    this.options.camera.position.y = eyeHeight;
    const target = center.clone();
    target.y = eyeHeight;
    this.orbit.target.copy(target);
    this.options.camera.lookAt(target);
    this.orbit.update();
    this.refresh(`Look-through ${cutId}`);
    return true;
  }

  /** Look-through from the keep half-space into a trim plane for voxel A/B. */
  frameTrimLookThrough(trimId: string, leadIn = 6): boolean {
    const trim = this.trim(trimId);
    if (!trim) return false;
    const room = this.room(trim.roomId);
    if (!room) return false;
    const entityId = `${TRIM_HANDLE_PREFIX}${trimId}`;
    if (!this.entities.has(entityId)) return false;
    this.overlays.splats = true;
    this.overlays.doorways = false;
    this.overlays.trims = false;
    this.overlays.labels = false;
    this.overlays.navigation = false;
    this.hiddenLayerIds.clear();
    this.soloLayerId = trim.portalId ? null : trim.roomId;
    this.applyOverlayVisibility();
    this.applyRoomTransforms();
    this.select(entityId);

    const center = new THREE.Vector3(...trim.position);
    const normal = trimPlaneNormal(trim);
    // Camera stands on the kept half-space looking toward the discarded side
    // so ON/OFF toggles change the voxels in front of the lens.
    const keepDir = normal
      .clone()
      .multiplyScalar(trim.keepSide === 'positive' ? 1 : -1);
    const eyeHeight =
      room.transform.position[1] - 1.5 + 1.55;
    this.options.camera.up.set(0, 1, 0);
    this.options.camera.position
      .copy(center)
      .addScaledVector(keepDir, Math.max(2.5, leadIn));
    this.options.camera.position.y = eyeHeight;
    const target = center.clone();
    target.y = eyeHeight;
    this.orbit.target.copy(target);
    this.options.camera.lookAt(target);
    this.orbit.update();
    this.refresh(`Look-through trim ${trimId}`);
    return true;
  }

  dispose(restoreData = true): void {
    if (this.disposed) return;
    this.disposed = true;
    if (restoreData) {
      this.data = cloneData(this.original);
      this.applyRoomTransforms();
      this.applyPlacementsToArena();
      MintWorldLayer.setGlobalCutVolumes(this.data.layout.cutVolumes ?? []);
      MintWorldLayer.setGlobalTrimPlanes(this.data.layout.trimPlanes ?? []);
      for (const layer of this.options.rooms.values()) {
        layer.setCutVolumes?.(this.data.layout.cutVolumes ?? []);
        layer.setTrimPlanes?.(this.data.layout.trimPlanes ?? []);
      }
    }
    this.transform.detach();
    this.transform.removeEventListener(
      'dragging-changed',
      this.onDraggingChanged,
    );
    this.transform.removeEventListener('mouseDown', this.onTransformMouseDown);
    this.transform.removeEventListener('objectChange', this.onTransformChange);
    this.transform.removeEventListener('mouseUp', this.onTransformMouseUp);
    this.transform.dispose();
    this.orbit.dispose();
    this.options.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.options.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.options.scene.remove(this.transformHelper, this.helperRoot);
    this.disposeObject(this.helperRoot);
    this.ui.dispose();
    this.options.scene.fog = this.originalFog;
    this.options.scene.background = this.originalBackground;
    this.options.camera.position.copy(this.originalCamera.position);
    this.options.camera.quaternion.copy(this.originalCamera.quaternion);
    this.options.camera.up.copy(this.originalCamera.up);
    this.options.camera.fov = this.originalCamera.fov;
    this.options.camera.near = this.originalCamera.near;
    this.options.camera.far = this.originalCamera.far;
    this.options.camera.updateProjectionMatrix();
  }

  private rebuildEntities(): void {
    this.entities.clear();
    this.pickEntityByObject.clear();
    this.clearRoot(this.navigationRoot);
    this.clearRoot(this.boundaryRoot);
    this.clearRoot(this.doorwayRoot);
    this.clearRoot(this.connectiveRoot);
    this.clearRoot(this.trimRoot);
    this.clearRoot(this.placementRoot);
    this.clearRoot(this.labelRoot);

    for (const room of this.data.layout.rooms) {
      const layer = this.options.rooms.get(room.id);
      if (!layer) continue;
      const navigation = this.makeNavigationMesh(room);
      const label = makeLabelSprite(roomLabel(room.id), '#b8ff3d');
      const center = this.navigationCenter(room);
      label.position.set(
        center.x,
        room.transform.position[1] + 4.5,
        center.y,
      );
      this.navigationRoot.add(navigation);
      this.labelRoot.add(label);
      this.addEntity({
        id: `${ROOM_HANDLE_PREFIX}${room.id}`,
        dataId: room.id,
        type: 'room',
        label: roomLabel(room.id),
        kind: 'splat',
        category: 'splats',
        roomId: room.id,
        object: layer.root,
        pickObject: navigation,
        labelSprite: label,
        editable: true,
        mount: 'authored RAD root',
      });
    }

    for (const room of this.data.layout.rooms) {
      for (const socket of room.doorwaySockets) {
        // Clip-derived sockets are runtime metadata projected from the user's
        // cube/plane opening. They are not a second editable doorway.
        if (socket.derivedFromClipId) continue;
        const id = `${SOCKET_HANDLE_PREFIX}${room.id}:${socket.id}`;
        const marker = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 0.16),
          new THREE.MeshStandardMaterial({
            color: 0x6ed6ff,
            emissive: 0x0b2633,
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.82,
            depthTest: false,
          }),
        );
        marker.name = id;
        marker.renderOrder = 40;
        this.doorwayRoot.add(marker);
        const label = makeLabelSprite(socket.id, '#6ed6ff');
        this.labelRoot.add(label);
        this.addEntity({
          id,
          dataId: socket.id,
          type: 'socket',
          label: socket.id.replaceAll('-', ' '),
          kind: 'doorway',
          category: 'doorways',
          roomId: room.id,
          object: marker,
          pickObject: marker,
          labelSprite: label,
          editable: true,
          mount: 'doorway socket',
        });
      }
    }

    // Show the complete connective contract even though the old portal
    // compositor is retired: traversal hull, transition trigger, landing
    // endpoints, room-to-room spine, and the volume filled by the deterministic
    // local Gaussian connector at runtime.
    for (const portal of this.data.layout.portals) {
      const endpoints = this.portalEndpoints(portal.id);
      if (!endpoints) continue;
      const tissue = new THREE.Group();
      tissue.name = `connective:${portal.id}`;
      const floorY = Math.min(endpoints.from.y, endpoints.to.y) + 0.08;
      const makeSurface = (
        polygon: readonly (readonly [number, number])[],
        color: number,
        opacity: number,
        y: number,
      ) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(
            polygon.flatMap(([x, z]) => [x, y, z]),
            3,
          ),
        );
        geometry.setIndex(
          Array.from({ length: Math.max(0, polygon.length - 2) }, (_, index) => [
            0,
            index + 1,
            index + 2,
          ]).flat(),
        );
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
          }),
        );
        mesh.renderOrder = 37;
        return mesh;
      };
      tissue.add(
        makeSurface(portal.traversalPolygon, 0xffb347, 0.22, floorY),
        makeSurface(portal.transitionPolygon, 0xff5c35, 0.38, floorY + 0.04),
      );
      const spineGeometry = new THREE.BufferGeometry().setFromPoints([
        endpoints.from.clone().setY(floorY + 1.2),
        endpoints.to.clone().setY(floorY + 1.2),
      ]);
      tissue.add(
        new THREE.Line(
          spineGeometry,
          new THREE.LineBasicMaterial({
            color: 0xffd27a,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
          }),
        ),
      );
      for (const endpoint of [endpoints.from, endpoints.to]) {
        const landing = new THREE.Mesh(
          new THREE.CylinderGeometry(
            this.data.layout.largestActorCapsuleRadius,
            this.data.layout.largestActorCapsuleRadius,
            0.12,
            18,
          ),
          new THREE.MeshBasicMaterial({
            color: 0xfff08a,
            transparent: true,
            opacity: 0.8,
            depthTest: false,
          }),
        );
        landing.position.copy(endpoint);
        landing.position.y = floorY + 0.08;
        tissue.add(landing);
      }
      const center = endpoints.from.clone().add(endpoints.to).multiplyScalar(0.5);
      center.y = floorY + 2.2;
      const linkVector = endpoints.to.clone().sub(endpoints.from);
      const pickLength = Math.max(1, linkVector.length());
      const pickMarker = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.8, pickLength),
        new THREE.MeshBasicMaterial({
          color: 0xffd27a,
          transparent: true,
          opacity: 0.08,
          depthTest: false,
          depthWrite: false,
        }),
      );
      pickMarker.name = `${PORTAL_HANDLE_PREFIX}${portal.id}`;
      pickMarker.position.copy(endpoints.from).lerp(endpoints.to, 0.5);
      pickMarker.position.y = floorY + 1.2;
      pickMarker.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        linkVector.lengthSq() > 1e-6
          ? linkVector.normalize()
          : new THREE.Vector3(0, 0, 1),
      );
      pickMarker.renderOrder = 39;
      tissue.add(pickMarker);
      const label = makeLabelSprite(
        `${portal.id.replace(/^portal-/, '')} · GAUSSIAN LINK`,
        '#ffd27a',
      );
      label.position.copy(center);
      tissue.add(label);
      this.connectiveRoot.add(tissue);
      this.addEntity({
        id: `${PORTAL_HANDLE_PREFIX}${portal.id}`,
        dataId: portal.id,
        type: 'portal',
        label: portal.id.replace(/^portal-/, '').replaceAll('-', ' '),
        kind: 'connective-tissue',
        category: 'doorways',
        roomId: portal.fromRoomId,
        object: tissue,
        pickObject: pickMarker,
        labelSprite: label,
        editable: false,
        mount: `${roomLabel(portal.fromRoomId)} ↔ ${roomLabel(portal.toRoomId)}`,
      });
    }

    for (const cut of this.data.layout.cutVolumes ?? []) {
      const id = `${CUT_HANDLE_PREFIX}${cut.id}`;
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0xff4f8b,
          emissive: 0x3a071b,
          emissiveIntensity: 0.85,
          transparent: true,
          opacity: 0.34,
          depthTest: false,
          depthWrite: false,
          wireframe: false,
        }),
      );
      marker.name = id;
      marker.renderOrder = 44;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(marker.geometry),
        new THREE.LineBasicMaterial({
          color: 0xffb0ca,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      );
      edges.name = `${id}:edges`;
      marker.add(edges);
      this.doorwayRoot.add(marker);
      const label = makeLabelSprite(cut.id, '#ff6aa1');
      this.labelRoot.add(label);
      this.addEntity({
        id,
        dataId: cut.id,
        type: 'cut',
        label: cut.id.replace(/^cut-/, '').replaceAll('-', ' '),
        kind: 'cut-volume',
        category: 'doorways',
        roomId: cut.roomId,
        object: marker,
        pickObject: marker,
        labelSprite: label,
        editable: true,
        mount: 'subtractive doorway cube',
      });
    }

    for (const trim of this.data.layout.trimPlanes ?? []) {
      const id = `${TRIM_HANDLE_PREFIX}${trim.id}`;
      const room = this.room(trim.roomId);
      const polygon = room ? this.worldPolygon(room) : [];
      const bounds = new THREE.Box2().setFromPoints(polygon);
      const size = bounds.getSize(new THREE.Vector2());
      const previewSize = Math.max(
        7,
        Math.min(14, Math.max(size.x, size.y) * 0.62),
      );
      const marker = new THREE.Mesh(
        new THREE.PlaneGeometry(previewSize, previewSize, 10, 10),
        new THREE.MeshBasicMaterial({
          color: 0x45e6ff,
          transparent: true,
          opacity: 0.28,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          wireframe: true,
        }),
      );
      marker.name = id;
      marker.renderOrder = 45;
      const group = new THREE.Group();
      group.name = `${id}:root`;
      const removedSideArrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, trim.keepSide === 'negative' ? 1 : -1),
        new THREE.Vector3(),
        Math.max(2.5, previewSize * 0.18),
        0xff665f,
        0.65,
        0.34,
      );
      removedSideArrow.name = `${id}:removed-side`;
      group.add(marker, removedSideArrow);
      this.trimRoot.add(group);
      const label = makeLabelSprite(trim.id, '#45e6ff');
      this.labelRoot.add(label);
      this.addEntity({
        id,
        dataId: trim.id,
        type: 'trim',
        label: trim.id.replace(/^trim-/, '').replaceAll('-', ' '),
        kind: 'trim-plane',
        category: 'splats',
        roomId: trim.roomId,
        object: group,
        pickObject: marker,
        labelSprite: label,
        editable: true,
        mount: 'infinite per-splat trim plane',
      });
    }

    for (const placement of this.data.placements.placements) {
      const id = `${PLACEMENT_HANDLE_PREFIX}${placement.id}`;
      const marker = this.makePlacementMarker(placement);
      const label = makeLabelSprite(
        placement.id.replaceAll('-', ' '),
        `#${PLACEMENT_COLORS[placement.kind].toString(16).padStart(6, '0')}`,
      );
      marker.name = id;
      this.placementRoot.add(marker);
      this.labelRoot.add(label);
      this.addEntity({
        id,
        dataId: placement.id,
        type: 'placement',
        label: placement.id.replaceAll('-', ' '),
        kind: placement.kind,
        category:
          placement.kind === 'zombie-spawn' ? 'spawns' : 'gameplay',
        roomId: placement.roomId,
        object: marker,
        pickObject: marker,
        labelSprite: label,
        editable: true,
        mount: placement.mount,
      });
    }

    for (const patch of this.data.layout.walkablePatches ?? []) {
      if (patch.polygon.length < 3) continue;
      const room = this.room(patch.roomId);
      if (!room) continue;
      if (
        this.soloLayerId &&
        this.soloLayerId !== room.id &&
        this.boundaryEditRoomId !== room.id
      ) {
        continue;
      }
      if (this.hiddenLayerIds.has(room.id) && this.boundaryEditRoomId !== room.id) {
        continue;
      }
      const editingRoom = this.boundaryEditRoomId === room.id;
      const active = this.boundaryEditPatchId === patch.id;
      const focusedAway =
        editingRoom && this.walkableFocusActive && !active;
      const worldPoints = this.walkablePatchWorldPolygon(room, patch);
      const y = roomFloorY(room.transform.position[1]) + 0.22;
      if (!focusedAway) {
        const outline = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(
            worldPoints.map((point) => new THREE.Vector3(point.x, y, point.y)),
          ),
          new THREE.LineBasicMaterial({
            color: active ? 0xb8ff3d : 0x6f9a45,
            transparent: true,
            opacity: active ? 0.95 : editingRoom ? 0.4 : 0.45,
            depthTest: false,
          }),
        );
        outline.name = active
          ? `editor-boundary-outline-${room.id}`
          : `editor-walkable-outline-${patch.id}`;
        outline.renderOrder = active ? 55 : 54;
        this.boundaryRoot.add(outline);
      }
      if (active) {
        const handleColor =
          this.walkableDragMode === 'patch' ? 0x63d6ff : 0xb8ff3d;
        worldPoints.forEach((point, index) => {
          const id = `${BOUNDARY_HANDLE_PREFIX}${room.id}:${index}`;
          const handle = new THREE.Mesh(
            new THREE.SphereGeometry(WALKABLE_HANDLE_RADIUS, 16, 12),
            new THREE.MeshBasicMaterial({
              color: handleColor,
              transparent: true,
              opacity: 0.95,
              depthTest: false,
            }),
          );
          // Larger invisible hit target (child so it follows drag transforms).
          const pickTarget = new THREE.Mesh(
            new THREE.SphereGeometry(WALKABLE_HANDLE_RADIUS * 1.85, 12, 10),
            new THREE.MeshBasicMaterial({
              transparent: true,
              opacity: 0,
              depthTest: false,
              depthWrite: false,
            }),
          );
          pickTarget.name = `${id}:pick`;
          handle.name = id;
          handle.renderOrder = 56;
          pickTarget.renderOrder = 55;
          handle.position.set(point.x, y, point.y);
          handle.add(pickTarget);
          this.boundaryRoot.add(handle);
          this.addEntity({
            id,
            dataId: String(index),
            type: 'boundary',
            label: `${patch.id} pt ${index + 1}`,
            kind: 'walkable-boundary',
            category: 'splats',
            roomId: room.id,
            object: handle,
            pickObject: pickTarget,
            labelSprite: null,
            editable: true,
            mount:
              this.walkableDragMode === 'patch'
                ? 'whole walkable patch'
                : 'walkable patch vertex',
          });
        });
        continue;
      }
      if (!editingRoom) continue;
      worldPoints.forEach((point, index) => {
        const id = `${WALKABLE_PROXY_PREFIX}${patch.id}:${index}`;
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(
            focusedAway ? WALKABLE_PROXY_RADIUS * 0.75 : WALKABLE_PROXY_RADIUS,
            12,
            10,
          ),
          new THREE.MeshBasicMaterial({
            color: 0x8fb86a,
            transparent: true,
            opacity: focusedAway ? 0.4 : 0.7,
            depthTest: false,
          }),
        );
        const pickTarget = new THREE.Mesh(
          new THREE.SphereGeometry(WALKABLE_PROXY_RADIUS * 1.9, 10, 8),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
          }),
        );
        pickTarget.name = `${id}:pick`;
        handle.name = id;
        handle.renderOrder = 53;
        pickTarget.renderOrder = 52;
        handle.position.set(point.x, y + 0.04, point.y);
        handle.add(pickTarget);
        this.boundaryRoot.add(handle);
        this.addEntity({
          id,
          dataId: patch.id,
          type: 'walkable-proxy',
          label: `${patch.id} pt ${index + 1}`,
          kind: 'walkable-proxy',
          category: 'splats',
          roomId: room.id,
          object: handle,
          pickObject: pickTarget,
          labelSprite: null,
          editable: false,
          mount: `vertex:${index}`,
        });
      });
    }
  }

  private addEntity(entity: EditorEntity): void {
    this.entities.set(entity.id, entity);
    this.pickEntityByObject.set(entity.pickObject, entity.id);
    entity.pickObject.userData.editorEntityId = entity.id;
  }

  private makeNavigationMesh(room: SplatLayoutRoom): THREE.Mesh {
    const navigation = this.clippedNavigationMesh(room.id);
    const vertices = navigation
      ? [...navigation.vertices]
      : [
          room.transform.position[0] - 0.5,
          room.transform.position[1],
          room.transform.position[2] - 0.5,
          room.transform.position[0] + 0.5,
          room.transform.position[1],
          room.transform.position[2] - 0.5,
          room.transform.position[0],
          room.transform.position[1],
          room.transform.position[2] + 0.5,
        ];
    for (let offset = 1; offset < vertices.length; offset += 3) {
      vertices[offset] = vertices[offset]! + 0.045;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(navigation?.indices ?? [0, 1, 2]);
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({
      color: 0x76bd60,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `editor-navigation-${room.id}`;
    mesh.renderOrder = 12;
    return mesh;
  }

  /** Playable overlay mesh after cut cubes / trim planes are applied. */
  private clippedNavigationMesh(roomId: string): SplatWorldNavigationMesh | null {
    return this.playableNavigationMesh(roomId);
  }

  /** Bake + clips + authored walkable patches (door bridges). */
  private playableNavigationMesh(
    roomId: string,
    options: { focusActivePatch?: boolean } = {},
  ): SplatWorldNavigationMesh | null {
    const navigation = this.navigationMesh(roomId);
    if (!navigation) return null;
    let mesh = clipNavigationMeshByCuts(
      navigation,
      (this.data.layout.cutVolumes ?? []).filter(
        (cut) => cut.enabled && cut.roomId === roomId,
      ),
      (this.data.layout.trimPlanes ?? []).filter(
        (trim) => trim.enabled && trim.roomId === roomId,
      ),
    );
    const room = this.room(roomId);
    if (room) {
      const floorY = roomFloorY(room.transform.position[1]);
      const focusActive =
        options.focusActivePatch === true &&
        this.walkableFocusActive &&
        this.boundaryEditRoomId === roomId &&
        Boolean(this.boundaryEditPatchId);
      for (const patch of this.data.layout.walkablePatches ?? []) {
        if (patch.roomId !== roomId || patch.polygon.length < 3) continue;
        if (focusActive && patch.id !== this.boundaryEditPatchId) continue;
        mesh = appendWorldPolygonToNavigation(
          mesh,
          this.walkablePatchWorldPolygon(room, patch),
          floorY,
        );
      }
      mesh = appendCutDoorwayAperturesToNavigation(
        mesh,
        (this.data.layout.cutVolumes ?? []).filter(
          (cut) => cut.enabled && cut.roomId === roomId,
        ),
        floorY,
      );
    }
    return {
      vertices: mesh.vertices,
      indices: mesh.indices,
      boundaryEdges: mesh.boundaryEdges,
      clearanceRadius:
        mesh.clearanceRadius ?? this.data.navigation.parameters.clearanceRadius,
      areaSquareMetres: mesh.areaSquareMetres,
    };
  }

  private makePlacementMarker(
    placement: ZombiesPlacementRecord,
  ): THREE.Object3D {
    let geometry: THREE.BufferGeometry;
    if (placement.kind === 'zombie-spawn') {
      geometry = new THREE.ConeGeometry(0.36, 1, 5);
    } else if (placement.kind === 'player-start') {
      geometry = new THREE.CapsuleGeometry(0.32, 0.8, 4, 8);
    } else if (
      placement.kind === 'power-switch' ||
      placement.kind === 'perk'
    ) {
      geometry = new THREE.CylinderGeometry(0.34, 0.42, 1.1, 8);
    } else if (placement.kind === 'door') {
      geometry = new THREE.BoxGeometry(1.2, 1.8, 0.22);
    } else {
      geometry = new THREE.BoxGeometry(0.72, 0.72, 0.72);
    }
    const material = new THREE.MeshStandardMaterial({
      color: PLACEMENT_COLORS[placement.kind],
      emissive: 0x000000,
      emissiveIntensity: 0.9,
      roughness: 0.45,
      metalness: 0.15,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 45;
    return mesh;
  }

  private applyDataToScene(): void {
    this.applyCutVolumes();
    this.applyRoomTransforms();
    this.applyPlacementsToArena();
    for (const entity of this.entities.values()) {
      this.applyEntityDataToObject(entity);
    }
    this.rebuildNavigationGeometry();
    this.updatePortalPolygons(false);
    this.applyOverlayVisibility();
  }

  private applyCutVolumes(): void {
    const cuts = this.data.layout.cutVolumes ?? [];
    const trims = this.data.layout.trimPlanes ?? [];
    MintWorldLayer.setGlobalCutVolumes(cuts);
    MintWorldLayer.setGlobalTrimPlanes(trims);
    for (const layer of this.options.rooms.values()) {
      layer.setCutVolumes?.(cuts);
      layer.setTrimPlanes?.(trims);
    }
  }

  private applyRoomTransforms(): void {
    for (const room of this.data.layout.rooms) {
      this.applyRoomTransform(room);
      const layer = this.options.rooms.get(room.id);
      if (!layer) continue;
      const visible =
        this.overlays.splats &&
        !this.hiddenLayerIds.has(room.id) &&
        (!this.soloLayerId || this.soloLayerId === room.id);
      const selectedRoomId = this.selectedId
        ? this.entities.get(this.selectedId)?.roomId ?? null
        : null;
      // While manipulating a transform, keep only the edited RAD driving the
      // shared LoD/sort pipeline. The complete campus returns immediately on
      // mouse-up, preserving the normal alignment overview without making six
      // large RADs fight for the budget on every pointer event.
      const interactionVisible =
        !this.transformInteractionActive || room.id === selectedRoomId;
      layer.setRenderState(
        visible && interactionVisible ? 'primary' : 'resident',
      );
    }
  }

  private applyPlacementsToArena(): void {
    this.options.arena.applyPlacementLayout(this.data.placements);
  }

  /** Applies the persisted room transform to its Three.js/Spark layer. */
  private applyRoomTransform(room: SplatLayoutRoom): void {
    const layer = this.options.rooms.get(room.id);
    if (!layer) return;
    const calibration =
      this.options.navigationCalibrationByRoom.get(room.id) ?? 0;
    layer.applyAuthoredTransform(
      [
        room.transform.position[0],
        room.transform.position[1] + calibration,
        room.transform.position[2],
      ],
      room.transform.rotation,
      room.transform.scale,
    );
  }

  private applyEntityDataToObject(entity: EditorEntity): void {
    if (entity.type === 'room') {
      const room = this.room(entity.dataId);
      if (!room) return;
      this.applyRoomTransform(room);
      return;
    }
    if (entity.type === 'boundary') {
      const room = this.room(entity.roomId);
      const patch = this.boundaryEditPatchId
        ? this.walkablePatch(this.boundaryEditPatchId)
        : null;
      const index = Number(entity.dataId);
      const point =
        room && patch && Number.isInteger(index)
          ? this.walkablePatchWorldPolygon(room, patch)[index]
          : undefined;
      if (!room || !point) return;
      entity.object.position.set(
        point.x,
        roomFloorY(room.transform.position[1]) + 0.22,
        point.y,
      );
      entity.object.rotation.set(0, 0, 0);
      entity.object.scale.set(1, 1, 1);
      return;
    }
    if (entity.type === 'placement') {
      const placement = this.placement(entity.dataId);
      if (!placement) return;
      entity.object.position.set(...placement.position);
      entity.object.rotation.set(...placement.rotation);
      entity.object.scale.set(...placement.scale);
      entity.roomId = placement.roomId;
      if (entity.labelSprite) {
        entity.labelSprite.position
          .copy(entity.object.position)
          .add(new THREE.Vector3(0, 1.15, 0));
      }
      return;
    }
    if (entity.type === 'cut') {
      const cut = this.cut(entity.dataId);
      if (!cut) return;
      entity.object.position.set(...cut.position);
      entity.object.rotation.set(...cut.rotation);
      entity.object.scale.set(...cut.size);
      entity.roomId = cut.roomId;
      entity.object.visible = cut.enabled;
      if (entity.labelSprite) {
        entity.labelSprite.position
          .copy(entity.object.position)
          .add(new THREE.Vector3(0, cut.size[1] * 0.55 + 0.5, 0));
      }
      return;
    }
    if (entity.type === 'trim') {
      const trim = this.trim(entity.dataId);
      if (!trim) return;
      entity.object.position.set(...trim.position);
      entity.object.rotation.set(...trim.rotation);
      entity.object.scale.set(1, 1, 1);
      const removedSideArrow = entity.object.getObjectByName(
        `${entity.id}:removed-side`,
      );
      if (removedSideArrow instanceof THREE.ArrowHelper) {
        removedSideArrow.setDirection(
          new THREE.Vector3(
            0,
            0,
            trim.keepSide === 'negative' ? 1 : -1,
          ),
        );
      }
      entity.roomId = trim.roomId;
      entity.object.visible = trim.enabled;
      if (entity.labelSprite) {
        entity.labelSprite.position
          .copy(entity.object.position)
          .add(new THREE.Vector3(0, 1.2, 0));
      }
      return;
    }
    if (entity.type === 'socket') {
      const socketData = this.socket(entity.roomId, entity.dataId);
      const room = this.room(entity.roomId);
      if (!socketData || !room) return;
      const point = this.socketWorldPoint(room, socketData.position);
      entity.object.position.set(
        point.x,
        room.transform.position[1] - 1.5 + socketData.height * 0.5,
        point.y,
      );
      entity.object.rotation.set(
        0,
        room.transform.authoredYaw + socketData.yaw,
        0,
      );
      entity.object.scale.set(
        socketData.width,
        socketData.height,
        Math.max(0.18, socketData.coverageDepth || 0.18),
      );
      if (entity.labelSprite) {
        entity.labelSprite.position
          .copy(entity.object.position)
          .add(new THREE.Vector3(0, socketData.height * 0.65 + 0.5, 0));
      }
      return;
    }
    const portal = this.data.layout.portals.find(
      (entry) => entry.id === entity.dataId,
    );
    if (!portal) return;
    const endpoints = this.portalEndpoints(portal.id);
    if (!endpoints) return;
    entity.object.position
      .copy(endpoints.from)
      .lerp(endpoints.to, 0.5)
      .setY((endpoints.from.y + endpoints.to.y) * 0.5);
    if (entity.labelSprite) {
      entity.labelSprite.position
        .copy(entity.object.position)
        .add(new THREE.Vector3(0, 1.15, 0));
    }
  }

  private syncEntityFromObject(
    entity: EditorEntity,
    baseline: EditorDataSnapshot,
  ): void {
    if (entity.type === 'boundary') {
      const room = this.room(entity.roomId);
      const patch = this.boundaryEditPatchId
        ? this.walkablePatch(this.boundaryEditPatchId)
        : null;
      const index = Number(entity.dataId);
      if (
        !room ||
        !patch ||
        patch.roomId !== room.id ||
        !Number.isInteger(index) ||
        !patch.polygon[index]
      ) {
        return;
      }
      const floorY = roomFloorY(room.transform.position[1]) + 0.22;
      if (this.walkableDragMode === 'patch') {
        const baselinePatch = (baseline.layout.walkablePatches ?? []).find(
          (entry) => entry.id === patch.id,
        );
        if (
          baselinePatch &&
          baselinePatch.polygon.length === patch.polygon.length
        ) {
          const baselineWorld = this.walkablePatchWorldPolygon(
            room,
            baselinePatch,
          );
          const start = baselineWorld[index];
          if (start) {
            const dx = entity.object.position.x - start.x;
            const dz = entity.object.position.z - start.y;
            for (let pointIndex = 0; pointIndex < baselineWorld.length; pointIndex += 1) {
              const origin = baselineWorld[pointIndex]!;
              const local = this.socketLocalPoint(
                room,
                new THREE.Vector2(origin.x + dx, origin.y + dz),
              );
              patch.polygon[pointIndex] = [local.x, local.y];
            }
            entity.object.position.y = floorY;
            entity.object.rotation.set(0, 0, 0);
            entity.object.scale.set(1, 1, 1);
            return;
          }
        }
      }
      const local = this.socketLocalPoint(
        room,
        new THREE.Vector2(entity.object.position.x, entity.object.position.z),
      );
      patch.polygon[index] = [local.x, local.y];
      entity.object.position.y = floorY;
      entity.object.rotation.set(0, 0, 0);
      entity.object.scale.set(1, 1, 1);
      return;
    }
    if (entity.type === 'placement') {
      const placement = this.placement(entity.dataId);
      if (!placement) return;
      const transform = this.objectTransform(entity.object);
      if (!finiteTransform(transform)) return;
      const previousPosition: [number, number, number] = [
        ...placement.position,
      ];
      placement.position = transform.position;
      placement.rotation = transform.rotation;
      placement.scale = transform.scale.map((value) =>
        Math.max(0.05, value),
      ) as [number, number, number];
      if (
        placement.kind !== 'barrier' &&
        placement.kind !== 'zombie-spawn'
      ) {
        const containing = this.roomForPoint(placement.position);
        if (containing) placement.roomId = containing.id;
      }
      entity.roomId = placement.roomId;
      this.options.arena.setEditorPlacement(placement);
      this.syncEntryPlacementPair(placement, previousPosition);
      return;
    }
    if (entity.type === 'cut') {
      const cut = this.cut(entity.dataId);
      if (!cut) return;
      const transform = this.objectTransform(entity.object);
      if (!finiteTransform(transform)) return;
      cut.position = transform.position;
      cut.rotation = [
        0,
        transform.rotation[1],
        0,
      ];
      cut.size = transform.scale.map((value, index) =>
        Math.max(index === 1 ? 1.7 : index === 2 ? 0.2 : 0.9, Math.abs(value)),
      ) as [number, number, number];
      const room = this.room(cut.roomId);
      if (room) {
        clampCutAboveFloor(cut, roomFloorY(room.transform.position[1]));
      }
      entity.object.position.set(...cut.position);
      entity.object.rotation.set(...cut.rotation);
      entity.object.scale.set(...cut.size);
      const portal = cut.portalId
        ? this.data.layout.portals.find((entry) => entry.id === cut.portalId)
        : null;
      if (portal && room) {
        const socketId =
          portal.fromRoomId === cut.roomId
            ? portal.fromSocketId
            : portal.toRoomId === cut.roomId
              ? portal.toSocketId
              : null;
        const socket = socketId ? this.socket(cut.roomId, socketId) : null;
        if (socket) {
          const local = this.socketLocalPoint(
            room,
            new THREE.Vector2(cut.position[0], cut.position[2]),
          );
          socket.position = [local.x, local.y];
          socket.yaw = cut.rotation[1] - room.transform.authoredYaw;
          socket.width = cut.size[0];
          socket.height = cut.size[1];
          socket.coverageDepth = cut.size[2];
          this.updatePortalPolygons(true, new Set([portal.id]));
        }
      }
      return;
    }
    if (entity.type === 'trim') {
      const trim = this.trim(entity.dataId);
      if (!trim) return;
      const transform = this.objectTransform(entity.object);
      if (!finiteTransform(transform)) return;
      trim.position = transform.position;
      trim.rotation = transform.rotation;
      entity.object.scale.set(1, 1, 1);
      return;
    }
    if (entity.type === 'room') {
      const room = this.room(entity.dataId);
      const beforeRoom = baseline.layout.rooms.find(
        (entry) => entry.id === entity.dataId,
      );
      if (!room || !beforeRoom) return;
      const calibration =
        this.options.navigationCalibrationByRoom.get(room.id) ?? 0;
      const nextPosition: [number, number, number] = [
        entity.object.position.x,
        entity.object.position.y - calibration,
        entity.object.position.z,
      ];
      const nextRotation: [number, number, number] = [
        beforeRoom.transform.rotation[0],
        entity.object.rotation.y,
        beforeRoom.transform.rotation[2],
      ];
      const uniformScale = Math.max(0.25, entity.object.scale.x);
      const yawDelta = nextRotation[1] - beforeRoom.transform.rotation[1];
      room.transform = {
        position: nextPosition,
        rotation: nextRotation,
        scale: uniformScale,
        authoredYaw: beforeRoom.transform.authoredYaw + yawDelta,
      };
      entity.object.scale.setScalar(uniformScale);
      this.moveOwnedPlacements(
        room.id,
        beforeRoom.transform,
        room.transform,
        baseline,
      );
      this.applyPlacementsToArena();
      this.moveOwnedCuts(
        room.id,
        beforeRoom.transform,
        room.transform,
        baseline,
      );
      this.moveOwnedTrims(
        room.id,
        beforeRoom.transform,
        room.transform,
        baseline,
      );
      this.rebuildNavigation();
      this.updatePortalPolygons(true);
      return;
    }
    if (entity.type === 'socket') {
      const room = this.room(entity.roomId);
      const socket = this.socket(entity.roomId, entity.dataId);
      if (!room || !socket) return;
      const local = this.socketLocalPoint(
        room,
        new THREE.Vector2(entity.object.position.x, entity.object.position.z),
      );
      socket.position = [local.x, local.y];
      socket.yaw = entity.object.rotation.y - room.transform.authoredYaw;
      socket.width = Math.max(0.8, Math.abs(entity.object.scale.x));
      socket.height = Math.max(1.6, Math.abs(entity.object.scale.y));
      this.updatePortalPolygons(true);
    }
  }

  private moveOwnedPlacements(
    roomId: string,
    before: SplatTransform,
    after: SplatTransform,
    baseline: EditorDataSnapshot,
  ): void {
    const rotationDelta = after.authoredYaw - before.authoredYaw;
    for (const placement of this.data.placements.placements) {
      if (placement.roomId !== roomId) continue;
      const source = baseline.placements.placements.find(
        (entry) => entry.id === placement.id,
      );
      if (!source) continue;
      placement.position = transformPointBetweenRooms(
        source.position,
        before,
        after,
      );
      placement.rotation = [
        source.rotation[0],
        source.rotation[1] + rotationDelta,
        source.rotation[2],
      ];
      this.options.arena.setEditorPlacement(placement);
    }
  }

  private moveOwnedCuts(
    roomId: string,
    before: SplatTransform,
    after: SplatTransform,
    baseline: EditorDataSnapshot,
  ): void {
    const rotationDelta = after.authoredYaw - before.authoredYaw;
    const ratio = after.scale / Math.max(before.scale, 1e-6);
    for (const cut of this.data.layout.cutVolumes ?? []) {
      if (cut.roomId !== roomId) continue;
      const source = (baseline.layout.cutVolumes ?? []).find(
        (entry) => entry.id === cut.id,
      );
      if (!source) continue;
      cut.position = transformPointBetweenRooms(source.position, before, after);
      cut.rotation = [
        0,
        source.rotation[1] + rotationDelta,
        0,
      ];
      cut.size = source.size.map((value) => value * ratio) as [
        number,
        number,
        number,
      ];
    }
  }

  private moveOwnedTrims(
    roomId: string,
    before: SplatTransform,
    after: SplatTransform,
    baseline: EditorDataSnapshot,
  ): void {
    const rotationDelta = after.authoredYaw - before.authoredYaw;
    for (const trim of this.data.layout.trimPlanes ?? []) {
      if (trim.roomId !== roomId) continue;
      const source = (baseline.layout.trimPlanes ?? []).find(
        (entry) => entry.id === trim.id,
      );
      if (!source) continue;
      trim.position = transformPointBetweenRooms(
        source.position,
        before,
        after,
      );
      trim.rotation = [
        source.rotation[0],
        source.rotation[1] + rotationDelta,
        source.rotation[2],
      ];
    }
  }

  private rebuildNavigation(): void {
    const rebuilt = cloneData(this.original.navigation);
    for (const navigationRoom of rebuilt.rooms) {
      const beforeRoom = this.original.layout.rooms.find(
        (entry) => entry.id === navigationRoom.id,
      );
      const afterRoom = this.room(navigationRoom.id);
      if (!beforeRoom || !afterRoom) continue;
      const transformPoint = (point: [number, number, number]) =>
        transformPointBetweenRooms(
          point,
          beforeRoom.transform,
          afterRoom.transform,
        );
      for (
        let offset = 0;
        offset < navigationRoom.navmesh.vertices.length;
        offset += 3
      ) {
        const next = transformPoint([
          navigationRoom.navmesh.vertices[offset]!,
          navigationRoom.navmesh.vertices[offset + 1]!,
          navigationRoom.navmesh.vertices[offset + 2]!,
        ]);
        navigationRoom.navmesh.vertices[offset] = next[0];
        navigationRoom.navmesh.vertices[offset + 1] = next[1];
        navigationRoom.navmesh.vertices[offset + 2] = next[2];
      }
      navigationRoom.anchor = transformPoint(
        navigationRoom.anchor as [number, number, number],
      );
      navigationRoom.authoredAnchor = transformPoint(
        navigationRoom.authoredAnchor as [number, number, number],
      );
      const corners: [number, number, number][] = [];
      for (const x of [
        navigationRoom.bounds.min[0],
        navigationRoom.bounds.max[0],
      ]) {
        for (const y of [
          navigationRoom.bounds.min[1],
          navigationRoom.bounds.max[1],
        ]) {
          for (const z of [
            navigationRoom.bounds.min[2],
            navigationRoom.bounds.max[2],
          ]) {
            corners.push(transformPoint([x, y, z]));
          }
        }
      }
      navigationRoom.bounds.min = [
        Math.min(...corners.map((point) => point[0])),
        Math.min(...corners.map((point) => point[1])),
        Math.min(...corners.map((point) => point[2])),
      ];
      navigationRoom.bounds.max = [
        Math.max(...corners.map((point) => point[0])),
        Math.max(...corners.map((point) => point[1])),
        Math.max(...corners.map((point) => point[2])),
      ];
      const navigationTransform = {
        position: [...afterRoom.transform.position],
        rotation: [...afterRoom.transform.rotation],
        scale: afterRoom.transform.scale,
        authoredYaw: afterRoom.transform.authoredYaw,
      };
      navigationRoom.transform = navigationTransform;
      navigationRoom.layoutInput.transform = cloneData(navigationTransform);
      navigationRoom.layoutInput.coveragePolygon =
        afterRoom.coveragePolygon.map((point) => [...point]);
      navigationRoom.layoutInput.minPlayableHeight =
        afterRoom.minPlayableHeight;
      navigationRoom.layoutInput.maxPlayableHeight =
        afterRoom.maxPlayableHeight;
      navigationRoom.layoutInput.safeInset = afterRoom.safeInset;
      navigationRoom.layoutInput.anchor = [...afterRoom.anchor];
      (
        navigationRoom.layoutInput as {
          clipFingerprint?: string;
        }
      ).clipFingerprint = roomClipFingerprint(
        navigationRoom.id,
        this.data.layout.cutVolumes ?? [],
        this.data.layout.trimPlanes ?? [],
      );
      const ratio =
        afterRoom.transform.scale /
        Math.max(beforeRoom.transform.scale, 1e-6);
      navigationRoom.navigationCalibration.sampledColliderFloorY =
        afterRoom.transform.position[1] +
        (navigationRoom.navigationCalibration.sampledColliderFloorY -
          beforeRoom.transform.position[1]) *
          ratio;
      navigationRoom.navigationCalibration.authoredFloorY =
        afterRoom.transform.position[1] - 1.5;
      navigationRoom.navigationCalibration.deltaY *= ratio;
      navigationRoom.navigationCalibration.maximumDeviation *= ratio;
    }
    this.data.navigation = rebuilt;
  }

  private updatePortalPolygons(
    rebuildGeometry: boolean,
    onlyPortalIds?: ReadonlySet<string>,
  ): void {
    this.syncDerivedPortalSockets();
    for (const portal of this.data.layout.portals) {
      const endpoints = this.portalEndpoints(portal.id);
      if (!endpoints) continue;
      const start = new THREE.Vector2(endpoints.from.x, endpoints.from.z);
      const end = new THREE.Vector2(endpoints.to.x, endpoints.to.z);
      const direction = end.clone().sub(start);
      if (direction.lengthSq() < 1e-6) direction.set(0, 1);
      direction.normalize();
      const right = new THREE.Vector2(direction.y, -direction.x);
      const makeRectangle = (width: number, extension: number) => {
        const halfWidth = width * 0.5;
        const extendedStart = start
          .clone()
          .addScaledVector(direction, -extension);
        const extendedEnd = end.clone().addScaledVector(direction, extension);
        return [
          extendedStart.clone().addScaledVector(right, halfWidth),
          extendedEnd.clone().addScaledVector(right, halfWidth),
          extendedEnd.clone().addScaledVector(right, -halfWidth),
          extendedStart.clone().addScaledVector(right, -halfWidth),
        ].map((point) => [point.x, point.y] as [number, number]);
      };
      if (
        rebuildGeometry &&
        (!onlyPortalIds || onlyPortalIds.has(portal.id))
      ) {
        const fromNavigationRoom = this.data.navigation.rooms.find(
          (room) => room.id === portal.fromRoomId,
        );
        const toNavigationRoom = this.data.navigation.rooms.find(
          (room) => room.id === portal.toRoomId,
        );
        const fromNavigation = this.navigationMesh(portal.fromRoomId);
        const toNavigation = this.navigationMesh(portal.toRoomId);
        const fromSupport =
          fromNavigation && fromNavigationRoom
            ? reachableNavigationSupportPoint(
                fromNavigation,
                fromNavigationRoom.anchor,
                endpoints.from,
              )
            : endpoints.from;
        const toSupport =
          toNavigation && toNavigationRoom
            ? reachableNavigationSupportPoint(
                toNavigation,
                toNavigationRoom.anchor,
                endpoints.to,
              )
            : endpoints.to;
        portal.traversalPolygon = bufferedConvexHull(
          [fromSupport, endpoints.from, endpoints.to, toSupport],
          Math.max(2.2, portal.width),
        );
        portal.transitionPolygon = makeRectangle(
          Math.max(
            this.data.layout.largestActorCapsuleRadius * 2 +
              this.data.layout.portalSafetyMargin * 2,
            portal.width - this.data.layout.portalSafetyMargin * 2,
          ),
          0.16,
        );
      }
      const entity = this.entities.get(`${PORTAL_HANDLE_PREFIX}${portal.id}`);
      if (entity) this.applyEntityDataToObject(entity);
    }
    if (rebuildGeometry) this.rebuildNavigationGeometry();
  }

  private rebuildNavigationGeometry(): void {
    const selected = this.selectedId;
    for (const room of this.data.layout.rooms) {
      const entity = this.entities.get(`${ROOM_HANDLE_PREFIX}${room.id}`);
      if (!entity) continue;
      const replacement = this.makeNavigationMesh(room);
      this.navigationRoot.add(replacement);
      this.pickEntityByObject.delete(entity.pickObject);
      entity.pickObject.removeFromParent();
      this.disposeObject(entity.pickObject);
      entity.pickObject = replacement;
      replacement.userData.editorEntityId = entity.id;
      this.pickEntityByObject.set(replacement, entity.id);
      const center = this.navigationCenter(room);
      entity.labelSprite?.position.set(
        center.x,
        room.transform.position[1] + 4.5,
        center.y,
      );
    }
    this.updateBoundaryOutline();
    this.selectedId = selected;
  }

  private updateBoundaryOutline(): void {
    const room = this.boundaryEditRoomId
      ? this.room(this.boundaryEditRoomId)
      : null;
    const patch = this.boundaryEditPatchId
      ? this.walkablePatch(this.boundaryEditPatchId)
      : null;
    if (!room) return;
    const outline = this.boundaryRoot.getObjectByName(
      `editor-boundary-outline-${room.id}`,
    );
    if (!(outline instanceof THREE.LineLoop)) return;
    const y = roomFloorY(room.transform.position[1]) + 0.22;
    const points =
      patch && patch.roomId === room.id
        ? this.walkablePatchWorldPolygon(room, patch)
        : this.worldPolygon(room);
    outline.geometry.dispose();
    outline.geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((point) => new THREE.Vector3(point.x, y, point.y)),
    );
  }

  private refresh(status?: string): void {
    if (status) this.status = status;
    this.validation = this.validate();
    this.updateEntityMaterials();
    this.ui.render({
      entities: [...this.entities.values()]
        .filter((entity) => entity.type !== 'walkable-proxy')
        .map((entity) => this.entitySummary(entity)),
      selection: this.selectedDetails(),
      rooms: this.data.layout.rooms.map((room) => ({
        id: room.id,
        label: roomLabel(room.id),
      })),
      walkableFocusActive: this.walkableFocusActive,
      walkableDragMode: this.walkableDragMode,
      layers: this.data.layout.rooms.map((room) => ({
        roomId: room.id,
        label: roomLabel(room.id),
        selected: this.selectedId === `${ROOM_HANDLE_PREFIX}${room.id}`,
        hidden: this.hiddenLayerIds.has(room.id),
        locked: this.lockedLayerIds.has(room.id),
        solo: this.soloLayerId === room.id,
        editingWalkable: this.boundaryEditRoomId === room.id,
        walkablePatchCount: (this.data.layout.walkablePatches ?? []).filter(
          (patch) => patch.roomId === room.id,
        ).length,
        navigationArea:
          this.playableNavigationMesh(room.id)?.areaSquareMetres ?? 0,
        gameplayItemCount: this.data.placements.placements.filter(
          (placement) =>
            placement.roomId === room.id &&
            [
              'wall-buy',
              'power-switch',
              'mystery-box',
              'perk',
              'pack-a-punch',
            ].includes(placement.kind),
        ).length,
        clips: [
          ...(this.data.layout.cutVolumes ?? [])
            .filter((cut) => cut.roomId === room.id)
            .map((cut) => ({
              entityId: `${CUT_HANDLE_PREFIX}${cut.id}`,
              label: cut.id,
              kind: 'cut' as const,
              selected: this.selectedId === `${CUT_HANDLE_PREFIX}${cut.id}`,
            })),
          ...(this.data.layout.trimPlanes ?? [])
            .filter((trim) => trim.roomId === room.id)
            .map((trim) => ({
              entityId: `${TRIM_HANDLE_PREFIX}${trim.id}`,
              label: trim.id,
              kind: 'trim' as const,
              selected: this.selectedId === `${TRIM_HANDLE_PREFIX}${trim.id}`,
            })),
        ],
        walkablePatches: (this.data.layout.walkablePatches ?? [])
          .filter((patch) => patch.roomId === room.id)
          .map((patch, index) => ({
            patchId: patch.id,
            label: `walk ${index + 1}`,
            selected: this.boundaryEditPatchId === patch.id,
          })),
      })),
      validation: this.validation,
      tool: this.tool,
      space: this.space,
      snap: this.snap,
      dirty: this.dirty,
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex < this.history.length,
      saving: this.saving,
      playtesting: this.playtesting,
      status: this.status,
      overlays: { ...this.overlays },
    });
  }

  private validate(): EditorValidationView {
    const layoutValidation = validateSplatLayout(this.data.layout);
    const placementValidation = validateZombiesPlacementLayout(
      this.data.placements,
      this.data.layout.rooms.map((room) => room.id),
    );
    const errors = [
      ...layoutValidation.errors,
      ...placementValidation.errors,
    ];
    const warnings = [...layoutValidation.warnings];
    const preparedCuts = prepareSplatCutVolumes(
      this.data.layout.cutVolumes ?? [],
    );
    const preparedTrims = prepareSplatTrimPlanes(
      this.data.layout.trimPlanes ?? [],
    );
    this.outsideIds = [];
    for (const placement of this.data.placements.placements) {
      const room = this.roomForPoint(placement.position, placement.roomId);
      if (
        placement.mount !== 'socket' &&
        (!room || room.id !== placement.roomId)
      ) {
        this.outsideIds.push(placement.id);
        errors.push(
          `${placement.id} is outside ${placement.roomId} navigation`,
        );
      }
      const point = new THREE.Vector3(...placement.position);
      const intersectingCut = preparedCuts.find(
        (cut) =>
          cut.source.roomId === placement.roomId &&
          pointInsideCutVolume(point, cut),
      );
      if (intersectingCut) {
        errors.push(
          `${placement.id} overlaps ${intersectingCut.source.id}`,
        );
      }
      const intersectingTrim = preparedTrims.find(
        (trim) =>
          trim.source.roomId === placement.roomId &&
          pointTrimmedByPlane(point, trim),
      );
      if (intersectingTrim) {
        errors.push(
          `${placement.id} is removed by ${intersectingTrim.source.id}`,
        );
      }
    }
    const gameplayKinds = new Set<ZombiesPlacementRecord['kind']>([
      'wall-buy',
      'power-switch',
      'mystery-box',
      'perk',
      'pack-a-punch',
    ]);
    for (const room of this.data.layout.rooms) {
      const count = this.data.placements.placements.filter(
        (placement) =>
          placement.roomId === room.id && gameplayKinds.has(placement.kind),
      ).length;
      if (count < 1) {
        errors.push(`${room.id} has no gameplay item`);
      }
    }
    for (const cut of this.data.layout.cutVolumes ?? []) {
      const room = this.room(cut.roomId);
      if (!room) continue;
      const point = new THREE.Vector2(cut.position[0], cut.position[2]);
      const navigation = this.navigationMesh(room.id);
      const clearance = navigation
        ? splatNavigationSignedDistanceXZ(navigation, point)
        : Number.NEGATIVE_INFINITY;
      if (
        !cut.portalId &&
        clearance < -Math.max(1.25, cut.size[2] * 0.75)
      ) {
        errors.push(`${cut.id} is not seated on ${cut.roomId} navigation`);
      }
    }
    const unpairedSeen = new Set<string>();
    for (const cut of this.data.layout.cutVolumes ?? []) {
      if (!cut.enabled || cut.portalId || unpairedSeen.has(cut.id)) continue;
      const match = this.findBestUnpairedOverlap(cut);
      if (!match) continue;
      unpairedSeen.add(cut.id);
      unpairedSeen.add(match.cut.id);
      warnings.push(
        match.ambiguous
          ? `${roomLabel(cut.roomId)} cut overlaps multiple nearby cuts // use Link doorway`
          : `${roomLabel(cut.roomId)} ↔ ${roomLabel(match.cut.roomId)} cuts overlap but are unlinked // Link doorway or drag together`,
      );
    }
    if (this.data.layout.connectors.length > 0) {
      errors.push(
        `Generated hallway/connectors are forbidden (${this.data.layout.connectors.length} found)`,
      );
    }
    for (const portal of this.data.layout.portals.filter(
      (entry) => entry.enabled,
    )) {
      const endpoints = this.portalEndpoints(portal.id);
      if (!endpoints) continue;
      const clippedFrom = preparedTrims.find(
        (trim) =>
          trim.source.roomId === portal.fromRoomId &&
          pointTrimmedByPlane(endpoints.from, trim),
      );
      const clippedTo = preparedTrims.find(
        (trim) =>
          trim.source.roomId === portal.toRoomId &&
          pointTrimmedByPlane(endpoints.to, trim),
      );
      if (clippedFrom || clippedTo) {
        errors.push(
          `${portal.id} doorway is removed by ${
            clippedFrom?.source.id ?? clippedTo?.source.id
          }`,
        );
      }
      const separation = endpoints.from.distanceTo(endpoints.to);
      if (separation > 14) {
        errors.push(
          `${portal.id} user clips are ${separation.toFixed(2)} m apart`,
        );
      }
      const cuts = (this.data.layout.cutVolumes ?? []).filter(
        (cut) => cut.enabled && cut.portalId === portal.id,
      );
      if (cuts.some((cut) => cut.size[0] + 1e-4 < portal.width)) {
        errors.push(`${portal.id} cut cube is narrower than its safe opening`);
      }
    }
    const uniqueErrors = [...new Set(errors)];
    const uniqueWarnings = [...new Set(warnings)];
    return {
      errors: uniqueErrors,
      warnings: uniqueWarnings,
      roomCount: this.data.layout.rooms.length,
      portalCount: [
        ...new Set(
          [
            ...(this.data.layout.cutVolumes ?? []),
            ...(this.data.layout.trimPlanes ?? []),
          ]
            .filter((clip) => clip.enabled && clip.portalId)
            .map((clip) => clip.portalId!),
        ),
      ].length,
      placementCount: this.data.placements.placements.length,
      outsideCount: this.outsideIds.length,
      connected: layoutValidation.isolatedRoomIds.length === 0,
      connectorCount: this.data.layout.connectors.length,
      cutCount: (this.data.layout.cutVolumes ?? []).length,
      trimCount: (this.data.layout.trimPlanes ?? []).length,
    };
  }

  private entitySummary(entity: EditorEntity): EditorEntitySummary {
    const placementInvalid =
      entity.type === 'placement' && this.outsideIds.includes(entity.dataId);
    const portalInvalid =
      entity.type === 'portal' &&
      this.validation.errors.some((error) => error.includes(entity.dataId));
    const cutInvalid =
      entity.type === 'cut' &&
      this.validation.errors.some((error) => error.includes(entity.dataId));
    const trimInvalid =
      entity.type === 'trim' &&
      this.validation.errors.some((error) => error.includes(entity.dataId));
    return {
      id: entity.id,
      label: entity.label,
      kind: entity.kind,
      category: entity.category,
      roomId: entity.roomId,
      selected: entity.id === this.selectedId,
      visible: entity.object.visible,
      valid:
        !placementInvalid &&
        !portalInvalid &&
        !cutInvalid &&
        !trimInvalid,
      editable: entity.editable && !this.lockedLayerIds.has(entity.roomId),
    };
  }

  private selectedDetails(): EditorSelectionDetails | null {
    if (!this.selectedId) return null;
    const entity = this.entities.get(this.selectedId);
    if (!entity) return null;
    const transform = this.entityTransform(entity);
    const containment =
      entity.type === 'placement'
        ? this.outsideIds.includes(entity.dataId)
          ? 'OUTSIDE SPLAT'
          : 'inside'
        : entity.type === 'portal'
          ? this.validation.errors.some((error) =>
              error.includes(entity.dataId),
            )
            ? 'MISALIGNED'
            : 'connected'
          : 'inside';
    return {
      entityId: entity.id,
      id: entity.dataId,
      label: entity.label,
      kind: entity.kind,
      roomId: entity.roomId,
      editable: entity.editable && !this.lockedLayerIds.has(entity.roomId),
      position: transform.position,
      rotation: transform.rotation,
      scale: transform.scale,
      containment,
      mount: entity.mount,
      portalId:
        entity.type === 'cut'
          ? this.cut(entity.dataId)?.portalId
          : entity.type === 'portal'
            ? entity.dataId
            : undefined,
      doorwayLinkLabel:
        entity.type === 'cut'
          ? this.doorwayLinkLabel(this.cut(entity.dataId)?.portalId)
          : entity.type === 'portal'
            ? this.doorwayLinkLabel(entity.dataId)
            : undefined,
      doorwayLinkState: (() => {
        if (entity.type === 'portal') return 'linked' as const;
        if (entity.type !== 'cut') return undefined;
        const cut = this.cut(entity.dataId);
        if (!cut) return undefined;
        if (cut.portalId) return 'linked' as const;
        return this.findBestUnpairedOverlap(cut) ? 'linkable' : 'unlinked';
      })(),
      keepSide:
        entity.type === 'trim'
          ? this.trim(entity.dataId)?.keepSide
          : undefined,
      navigationArea:
        entity.type === 'room'
          ? this.playableNavigationMesh(entity.roomId)?.areaSquareMetres ?? 0
          : undefined,
    };
  }

  private select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id && this.entities.has(id) ? id : null;
    const entity = this.selectedId
      ? this.entities.get(this.selectedId)
      : null;
    this.transform.detach();
    if (entity?.editable && !this.lockedLayerIds.has(entity.roomId)) {
      if (entity.type === 'trim' && this.tool === 'scale') {
        this.tool = 'rotate';
      } else if (entity.type === 'boundary') {
        this.tool = 'translate';
      }
      this.transform.attach(entity.object);
      this.transform.setMode(this.tool);
      this.transform.setSpace(this.space);
      this.configureTransformAxes(entity);
    }
    this.refresh(
      entity
        ? `${entity.label} selected // ${entity.roomId}`
        : 'Selection cleared',
    );
  }

  private setField(field: string, value: number): void {
    if (!this.selectedId) return;
    const entity = this.entities.get(this.selectedId);
    if (!entity?.editable || this.lockedLayerIds.has(entity.roomId)) return;
    const before = this.snapshot();
    const transform = this.entityTransform(entity);
    const [group, axis] = field.split('.') as [
      keyof EntityTransform,
      'x' | 'y' | 'z',
    ];
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const values = transform[group];
    if (
      entity.type === 'boundary' &&
      (group !== 'position' || axis === 'y')
    ) {
      this.refresh('Boundary points move on the X/Z ground plane only');
      return;
    }
    if (
      entity.type === 'room' &&
      group === 'rotation' &&
      axis !== 'y'
    ) {
      this.refresh('Splats rotate around world up only');
      return;
    }
    if (
      entity.type === 'cut' &&
      group === 'rotation' &&
      axis !== 'y'
    ) {
      this.refresh('Cut cubes rotate around world up only');
      return;
    }
    if (
      entity.type === 'socket' &&
      ((group === 'position' && axis === 'y') ||
        (group === 'rotation' && axis !== 'y') ||
        (group === 'scale' && axis === 'z'))
    ) {
      this.refresh('Doorway sockets author X/Z position, yaw, width, and height only');
      return;
    }
    if (entity.type === 'placement' && group === 'scale') {
      this.refresh('Gameplay placement scale is fixed by its runtime asset');
      return;
    }
    if (
      entity.type === 'placement' &&
      group === 'position' &&
      axis === 'y' &&
      (entity.kind === 'player-start' || entity.kind === 'zombie-spawn')
    ) {
      this.refresh(
        entity.kind === 'player-start'
          ? 'Player start height is grounded by the runtime'
          : 'Zombie entry height is grounded by its wall-crawl socket',
      );
      return;
    }
    if (
      entity.type === 'placement' &&
      group === 'rotation' &&
      (axis !== 'y' ||
        entity.kind === 'player-start' ||
        entity.kind === 'zombie-spawn')
    ) {
      this.refresh(
        entity.kind === 'player-start' || entity.kind === 'zombie-spawn'
          ? 'This gameplay anchor has no authored orientation'
          : 'Gameplay props rotate around world up only',
      );
      return;
    }
    if (entity.type === 'trim' && group === 'scale') {
      this.refresh('Trim planes are infinite // move or rotate instead');
      return;
    }
    if (entity.type === 'room' && group === 'scale') {
      values.fill(value);
    } else {
      values[index] = value;
    }
    this.setEditorTransformOnObject(entity, transform);
    this.syncEntityFromObject(entity, before);
    if (entity.type === 'room') {
      const room = this.room(entity.dataId);
      if (room) this.applyRoomTransform(room);
    }
    if (
      entity.type === 'cut' ||
      entity.type === 'trim' ||
      entity.type === 'room'
    ) {
      this.applyCutVolumes();
    }
    if (entity.type === 'cut') {
      const pairNote = this.reconcileCutDoorwayLinks(entity.dataId);
      if (pairNote) {
        this.rebuildEntities();
        this.applyDataToScene();
      }
    }
    for (const current of this.entities.values()) {
      this.applyEntityDataToObject(current);
    }
    this.applyOverlayVisibility();
    this.commit(`Edit ${entity.label}`, before);
  }

  private setSelectedRoom(roomId: string): void {
    if (!this.selectedId) return;
    const entity = this.entities.get(this.selectedId);
    if (entity?.type === 'cut') {
      const cut = this.cut(entity.dataId);
      if (!cut || !this.room(roomId)) return;
      const before = this.snapshot();
      if (cut.portalId) {
        this.detachDoorwayPair(cut.portalId, { keepCuts: true });
      }
      cut.roomId = roomId;
      entity.roomId = roomId;
      this.reconcileCutDoorwayLinks(cut.id);
      this.applyDataToScene();
      this.commit(`Assign ${entity.label} to ${roomLabel(roomId)}`, before);
      return;
    }
    if (entity?.type === 'trim') {
      const trim = this.trim(entity.dataId);
      if (!trim || !this.room(roomId)) return;
      const before = this.snapshot();
      trim.roomId = roomId;
      entity.roomId = roomId;
      this.applyDataToScene();
      this.commit(`Assign ${entity.label} to ${roomLabel(roomId)}`, before);
      return;
    }
    if (entity?.type !== 'placement') return;
    const placement = this.placement(entity.dataId);
    if (!placement || !this.room(roomId)) return;
    if (placement.kind === 'barrier' || placement.kind === 'zombie-spawn') {
      this.refresh('Entry room ownership follows its authored wall-crawl socket');
      return;
    }
    const before = this.snapshot();
    placement.roomId = roomId;
    entity.roomId = roomId;
    this.options.arena.setEditorPlacement(placement);
    this.commit(`Assign ${entity.label} to ${roomLabel(roomId)}`, before);
  }

  private handleUiAction(action: string, value?: string): void {
    if (action === 'tool' && ['translate', 'rotate', 'scale'].includes(value ?? '')) {
      this.setTool(value as EditorTool);
    } else if (action === 'space' && (value === 'world' || value === 'local')) {
      this.space = value;
      this.transform.setSpace(value);
      this.refresh(`Transform space // ${value}`);
    } else if (action === 'snap') {
      this.setSnap(Number(value));
    } else if (action === 'undo') {
      this.undo();
    } else if (action === 'redo') {
      this.redo();
    } else if (action === 'view' && (value === 'perspective' || value === 'top')) {
      this.frameAll(value);
    } else if (action === 'frame-all') {
      this.frameAll('perspective');
    } else if (action === 'frame-selection') {
      this.frameSelection();
    } else if (action === 'revert-selection') {
      this.revertSelection();
    } else if (action === 'add-cut') {
      this.addCutVolume(value);
    } else if (action === 'add-door-cut') {
      this.addCutVolume(value, {
        size: [...STANDARD_DOOR_CUT_SIZE] as [number, number, number],
        label: 'door cut',
      });
    } else if (action === 'delete-cut') {
      this.deleteSelectedCut();
    } else if (action === 'link-doorway') {
      this.linkSelectedCutDoorway();
    } else if (action === 'unlink-doorway') {
      this.unlinkSelectedCutDoorway();
    } else if (action === 'add-trim') {
      this.addTrimPlane(value);
    } else if (action === 'delete-trim') {
      this.deleteSelectedTrim();
    } else if (action === 'add-connective') {
      this.addConnectiveTissue(value);
    } else if (action === 'delete-connective') {
      this.deleteSelectedConnectiveTissue();
    } else if (action === 'flip-trim') {
      this.flipSelectedTrim();
    } else if (
      action === 'add-walkable-patch' ||
      action === 'add-playable-zone'
    ) {
      this.addWalkablePatch(value);
    } else if (
      action === 'edit-walkable' ||
      action === 'edit-playable-zone'
    ) {
      this.beginBoundaryEdit(value);
    } else if (action === 'edit-walkable-patch' && value) {
      this.beginBoundaryEdit(undefined, value);
    } else if (action === 'toggle-walkable-focus') {
      this.toggleWalkableFocus();
    } else if (
      action === 'set-walkable-drag-mode' &&
      (value === 'corner' || value === 'patch')
    ) {
      this.setWalkableDragMode(value);
    } else if (action === 'toggle-walkable-drag-mode') {
      this.setWalkableDragMode(
        this.walkableDragMode === 'corner' ? 'patch' : 'corner',
      );
    } else if (
      action === 'finish-walkable' ||
      action === 'finish-playable-zone'
    ) {
      this.finishBoundaryEdit();
    } else if (
      action === 'delete-walkable-patch' ||
      action === 'delete-playable-zone'
    ) {
      this.deleteWalkablePatch(value);
    } else if (action === 'add-boundary-point') {
      this.addBoundaryPoint();
    } else if (action === 'layer-visible' && value) {
      if (this.hiddenLayerIds.has(value)) this.hiddenLayerIds.delete(value);
      else this.hiddenLayerIds.add(value);
      this.applyOverlayVisibility();
      this.refresh(
        `${roomLabel(value)} layer ${
          this.hiddenLayerIds.has(value) ? 'hidden' : 'visible'
        }`,
      );
    } else if (action === 'layer-lock' && value) {
      if (this.lockedLayerIds.has(value)) this.lockedLayerIds.delete(value);
      else this.lockedLayerIds.add(value);
      const selected = this.selectedId
        ? this.entities.get(this.selectedId)
        : undefined;
      if (selected?.roomId === value && this.lockedLayerIds.has(value)) {
        this.transform.detach();
      }
      if (
        this.boundaryEditRoomId === value &&
        this.lockedLayerIds.has(value)
      ) {
        this.boundaryEditRoomId = null;
        this.boundaryEditPatchId = null;
        this.selectedId = null;
        this.rebuildEntities();
        this.applyDataToScene();
      }
      this.refresh(
        `${roomLabel(value)} layer ${
          this.lockedLayerIds.has(value) ? 'locked' : 'unlocked'
        }`,
      );
    } else if (action === 'layer-solo' && value) {
      this.soloLayerId = this.soloLayerId === value ? null : value;
      this.applyOverlayVisibility();
      this.refresh(
        this.soloLayerId
          ? `Solo layer // ${roomLabel(value)}`
          : 'All splat layers visible',
      );
    } else if (action === 'overlay' && value) {
      const [name, state] = value.split(':');
      if (name) this.overlays[name] = state === 'on';
      this.applyOverlayVisibility();
      this.refresh(`Overlay ${name} ${state}`);
    } else if (action === 'export') {
      this.exportJson();
    } else if (action === 'import') {
      this.ui.openImportPicker();
    } else if (action === 'discard-draft') {
      this.discardDraft();
    } else if (action === 'save') {
      void this.saveToProject();
    } else if (action === 'playtest') {
      void this.playtest();
    } else if (action === 'exit') {
      if (
        !this.dirty ||
        window.confirm('Discard the unsaved editor draft and return to Operations?')
      ) {
        this.options.onExit();
      }
    }
  }

  private addCutVolume(
    requestedRoomId?: string,
    options?: {
      size?: [number, number, number];
      label?: string;
    },
  ): void {
    const selected = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    const cutLabel = options?.label ?? 'cut cube';
    if (!requestedRoomId && !selected) {
      this.refresh(
        `Select a splat, doorway, or cut before adding a ${cutLabel}`,
      );
      return;
    }
    let portalId: string | null = null;
    if (!requestedRoomId && selected?.type === 'portal') {
      portalId = selected.dataId;
    } else if (!requestedRoomId && selected?.type === 'socket') {
      portalId =
        this.data.layout.portals.find(
          (portal) =>
            (portal.fromRoomId === selected.roomId &&
              portal.fromSocketId === selected.dataId) ||
            (portal.toRoomId === selected.roomId &&
              portal.toSocketId === selected.dataId),
        )?.id ?? null;
    }
    if (portalId) {
      this.ensurePortalCuts(portalId);
      return;
    }
    if ((this.data.layout.cutVolumes ?? []).length >= MAX_SPLAT_CUT_VOLUMES) {
      this.refresh(`Cut limit reached // ${MAX_SPLAT_CUT_VOLUMES}`);
      return;
    }
    const roomId = requestedRoomId ?? selected?.roomId;
    if (!roomId) return;
    if (this.lockedLayerIds.has(roomId)) {
      this.refresh(`${roomLabel(roomId)} layer is locked`);
      return;
    }
    const room = this.room(roomId);
    if (!room) return;
    const polygon = this.worldPolygon(room);
    if (polygon.length < 2) return;
    const cameraPoint = new THREE.Vector2(
      this.options.camera.position.x,
      this.options.camera.position.z,
    );
    let edgeIndex = 0;
    let edgeDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < polygon.length; index += 1) {
      const midpoint = polygon[index]!
        .clone()
        .add(polygon[(index + 1) % polygon.length]!)
        .multiplyScalar(0.5);
      const distance = midpoint.distanceToSquared(cameraPoint);
      if (distance >= edgeDistance) continue;
      edgeDistance = distance;
      edgeIndex = index;
    }
    const start = polygon[edgeIndex]!;
    const end = polygon[(edgeIndex + 1) % polygon.length]!;
    const dx = end.x - start.x;
    const dz = end.y - start.y;
    // size[0] is through-wall thickness. Soft gaussian walls need more than
    // ~1.5 m or the OBB can miss reconstructed splat samples. Standard door
    // cuts use a narrower preset that still clears the player capsule.
    const size: [number, number, number] = options?.size
      ? [...options.size]
      : [4, 2.5, 2.2];
    const floorY = roomFloorY(room.transform.position[1]);
    const base = `cut-${roomLabel(roomId).toLowerCase().replaceAll(' ', '-')}`;
    let suffix = 1;
    let id = `${base}-${suffix}`;
    while (this.cut(id)) {
      suffix += 1;
      id = `${base}-${suffix}`;
    }
    const boundaryCenter = new THREE.Vector3(
      (start.x + end.x) * 0.5,
      floorY + size[1] * 0.5,
      (start.y + end.y) * 0.5,
    );
    const splatLayer = this.options.rooms.get(roomId);
    const inward = new THREE.Vector3(
      room.transform.position[0] - boundaryCenter.x,
      0,
      room.transform.position[2] - boundaryCenter.z,
    ).normalize();
    const rayOrigin = boundaryCenter.clone().addScaledVector(inward, -60);
    const rayHit = splatLayer?.raycastCollider?.(rayOrigin, inward, 120) ?? null;
    const wallHit =
      (rayHit && Math.abs(rayHit.normal.y) <= 0.42 ? rayHit : null) ??
      splatLayer?.nearestColliderSurface?.(boundaryCenter, 'wall', 18) ??
      null;
    const wallYaw = wallHit
      ? Math.atan2(-wallHit.normal.z, wallHit.normal.x)
      : doorCutYawForWallEdge(dx, dz);
    const cut: SplatCutVolume = {
      id,
      roomId,
      position: [
        wallHit?.point.x ?? boundaryCenter.x,
        seatedCutCenterY(floorY, size[1], STANDARD_DOOR_CUT_SILL),
        wallHit?.point.z ?? boundaryCenter.z,
      ],
      // Local X is the through-wall axis and local Z is doorway width. Rotate
      // local Z onto the selected wall edge so the deeper X dimension actually
      // penetrates the wall instead of running along it.
      rotation: [0, wallYaw, 0],
      size,
      enabled: true,
    };
    const before = this.snapshot();
    this.data.layout.cutVolumes ??= [];
    // Keep the actively authored aperture at the front of the shader payload.
    // This also preserves its priority after save/reload on constrained WebGL
    // implementations that expose fewer reliable fragment-uniform slots.
    this.data.layout.cutVolumes.unshift(cut);
    const pairNote = this.reconcileCutDoorwayLinks(cut.id);
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Add ${cut.id}`, before);
    this.revealCutVolume(
      cut.id,
      [
        `${cutLabel === 'door cut' ? 'Door cut' : 'Cut cube'} created on ${roomLabel(roomId)} // ${size[2].toFixed(1)}×${size[1].toFixed(1)} m · drag with W/E/R`,
        pairNote,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }

  private addTrimPlane(requestedRoomId?: string): void {
    const selected = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    const roomId = requestedRoomId ?? selected?.roomId;
    if (!roomId || !this.room(roomId)) {
      this.refresh('Select a splat layer before adding a trim plane');
      return;
    }
    if (this.lockedLayerIds.has(roomId)) {
      this.refresh(`${roomLabel(roomId)} layer is locked`);
      return;
    }
    this.data.layout.trimPlanes ??= [];
    if (this.data.layout.trimPlanes.length >= MAX_SPLAT_TRIM_PLANES) {
      this.refresh(`Trim plane limit reached // ${MAX_SPLAT_TRIM_PLANES}`);
      return;
    }
    const room = this.room(roomId)!;
    const polygon = this.worldPolygon(room);
    if (polygon.length < 2) return;
    const center = polygon
      .reduce((sum, point) => sum.add(point), new THREE.Vector2())
      .multiplyScalar(1 / polygon.length);
    const cameraPoint = new THREE.Vector2(
      this.options.camera.position.x,
      this.options.camera.position.z,
    );
    let placement = polygon[0]!.clone();
    let closest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < polygon.length; index += 1) {
      const midpoint = polygon[index]!
        .clone()
        .add(polygon[(index + 1) % polygon.length]!)
        .multiplyScalar(0.5);
      const distance = midpoint.distanceToSquared(cameraPoint);
      if (distance >= closest) continue;
      closest = distance;
      placement = midpoint;
    }
    const outward = placement.clone().sub(center).normalize();
    if (outward.lengthSq() < 1e-6) outward.set(0, 1);
    const base = `trim-${roomLabel(roomId).toLowerCase().replaceAll(' ', '-')}`;
    let suffix = 1;
    let id = `${base}-${suffix}`;
    while (this.trim(id)) {
      suffix += 1;
      id = `${base}-${suffix}`;
    }
    const trim: SplatTrimPlane = {
      id,
      roomId,
      position: [placement.x, room.transform.position[1] + 1, placement.y],
      rotation: [0, Math.atan2(outward.x, outward.y), 0],
      keepSide: 'negative',
      enabled: true,
    };
    const before = this.snapshot();
    this.data.layout.trimPlanes.push(trim);
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Add ${trim.id}`, before);
    this.revealTrimPlane(
      trim.id,
      `Trim plane added to ${roomLabel(roomId)} only // red arrow points toward the removed side`,
    );
  }

  private addConnectiveTissue(value?: string): void {
    const [fromRoomId, toRoomId] = value?.split('|') ?? [];
    const fromRoom = fromRoomId ? this.room(fromRoomId) : null;
    const toRoom = toRoomId ? this.room(toRoomId) : null;
    if (!fromRoom || !toRoom || fromRoom.id === toRoom.id) {
      this.refresh('Choose two different splat rooms before adding a link');
      return;
    }
    if (
      this.lockedLayerIds.has(fromRoom.id) ||
      this.lockedLayerIds.has(toRoom.id)
    ) {
      this.refresh('Unlock both splat layers before changing their connectivity');
      return;
    }
    const duplicate = this.data.layout.portals.find(
      (portal) =>
        (portal.fromRoomId === fromRoom.id && portal.toRoomId === toRoom.id) ||
        (portal.fromRoomId === toRoom.id && portal.toRoomId === fromRoom.id),
    );
    if (duplicate) {
      this.overlays.connective = true;
      this.select(`${PORTAL_HANDLE_PREFIX}${duplicate.id}`);
      this.frameSelection();
      this.refresh(`${roomLabel(fromRoom.id)} and ${roomLabel(toRoom.id)} are already linked`);
      return;
    }
    this.data.layout.cutVolumes ??= [];
    if (this.data.layout.cutVolumes.length + 2 > MAX_SPLAT_CUT_VOLUMES) {
      this.refresh(`Two cuts are required // cut limit is ${MAX_SPLAT_CUT_VOLUMES}`);
      return;
    }

    const fromPolygon = this.worldPolygon(fromRoom);
    const toPolygon = this.worldPolygon(toRoom);
    const fromTarget = this.navigationCenter(toRoom);
    const toTarget = this.navigationCenter(fromRoom);
    const fromPoint = closestPointOnPolygonBoundary(fromPolygon, fromTarget);
    const toPoint = closestPointOnPolygonBoundary(toPolygon, toTarget);
    if (!fromPoint || !toPoint) {
      this.refresh('Both splats need a valid coverage boundary before linking');
      return;
    }

    const base = `${roomLabel(fromRoom.id)}-${roomLabel(toRoom.id)}`
      .toLowerCase()
      .replaceAll(' ', '-');
    let portalId = `portal-${base}`;
    let suffix = 2;
    while (this.data.layout.portals.some((portal) => portal.id === portalId)) {
      portalId = `portal-${base}-${suffix}`;
      suffix += 1;
    }
    const fromSocketId = `opening-${portalId.replace(/^portal-/, '')}-from`;
    const toSocketId = `opening-${portalId.replace(/^portal-/, '')}-to`;
    const width = Math.max(
      5,
      this.data.layout.largestActorCapsuleRadius * 2 +
        this.data.layout.portalSafetyMargin * 2 +
        0.5,
    );
    const makeSocket = (
      id: string,
      room: SplatLayoutRoom,
      point: THREE.Vector2,
      destination: THREE.Vector2,
    ): SplatDoorwaySocket => {
      const local = this.socketLocalPoint(room, point);
      return {
        id,
        position: [local.x, local.y],
        yaw:
          Math.atan2(destination.x - point.x, destination.y - point.y) -
          room.transform.authoredYaw,
        width,
        height: STANDARD_DOOR_CUT_SIZE[1],
        coverageDepth: 4,
        visualState: 'open',
        verifiedTraversable: true,
        evidence: 'Splat Placement Editor connective tissue authoring',
      };
    };
    const fromSocket = makeSocket(
      fromSocketId,
      fromRoom,
      fromPoint,
      toPoint,
    );
    const toSocket = makeSocket(toSocketId, toRoom, toPoint, fromPoint);
    const fromCutId = `cut-${portalId.replace(/^portal-/, '')}-from`;
    const toCutId = `cut-${portalId.replace(/^portal-/, '')}-to`;
    const makeCut = (
      id: string,
      room: SplatLayoutRoom,
      socket: SplatDoorwaySocket,
      point: THREE.Vector2,
    ): SplatCutVolume => ({
      id,
      roomId: room.id,
      portalId,
      position: [
        point.x,
        seatedCutCenterY(
          roomFloorY(room.transform.position[1]),
          socket.height + 0.12,
          STANDARD_DOOR_CUT_SILL,
        ),
        point.y,
      ],
      rotation: [0, room.transform.authoredYaw + socket.yaw, 0],
      size: [
        Math.max(4, socket.coverageDepth),
        socket.height + 0.12,
        socket.width + 0.24,
      ],
      enabled: true,
    });
    const portal: SplatLayoutPortal = {
      id: portalId,
      fromRoomId: fromRoom.id,
      toRoomId: toRoom.id,
      fromSocketId,
      toSocketId,
      fromClipId: fromCutId,
      toClipId: toCutId,
      traversalPolygon: [
        [fromPoint.x - 0.1, fromPoint.y - 0.1],
        [toPoint.x + 0.1, toPoint.y - 0.1],
        [toPoint.x, toPoint.y + 0.1],
      ],
      transitionPolygon: [
        [fromPoint.x - 0.1, fromPoint.y - 0.1],
        [toPoint.x + 0.1, toPoint.y - 0.1],
        [toPoint.x, toPoint.y + 0.1],
      ],
      width,
      // Physical connectivity is the paired cuts. `enabled` is reserved for
      // the retired two-room compositor path and intentionally stays false.
      enabled: false,
      residency: {
        requiredAssetIds: [fromRoom.assetId, toRoom.assetId],
        minimumActiveSplats: 0,
      },
    };

    const before = this.snapshot();
    fromRoom.doorwaySockets.push(fromSocket);
    toRoom.doorwaySockets.push(toSocket);
    this.data.layout.portals.push(portal);
    this.data.layout.cutVolumes.push(
      makeCut(fromCutId, fromRoom, fromSocket, fromPoint),
      makeCut(toCutId, toRoom, toSocket, toPoint),
    );
    this.updatePortalPolygons(true, new Set([portalId]));
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Add connective tissue ${portalId}`, before);
    this.overlays.connective = true;
    this.overlays.doorways = true;
    this.select(`${PORTAL_HANDLE_PREFIX}${portalId}`);
    this.frameSelection();
    this.refresh(
      `${roomLabel(fromRoom.id)} ↔ ${roomLabel(toRoom.id)} linked // two sockets and paired splat cuts created`,
    );
  }

  private deleteSelectedConnectiveTissue(): boolean {
    if (!this.selectedId) return false;
    const entity = this.entities.get(this.selectedId);
    if (entity?.type !== 'portal') return false;
    const portal = this.data.layout.portals.find(
      (candidate) => candidate.id === entity.dataId,
    );
    if (!portal) return false;
    if (
      this.lockedLayerIds.has(portal.fromRoomId) ||
      this.lockedLayerIds.has(portal.toRoomId)
    ) {
      this.refresh('Unlock both linked splat layers before removing connectivity');
      return false;
    }
    const before = this.snapshot();
    this.data.layout.portals = this.data.layout.portals.filter(
      (candidate) => candidate.id !== portal.id,
    );
    this.data.layout.cutVolumes = (this.data.layout.cutVolumes ?? []).filter(
      (cut) => cut.portalId !== portal.id,
    );
    this.data.layout.trimPlanes = (this.data.layout.trimPlanes ?? []).filter(
      (trim) => trim.portalId !== portal.id,
    );
    const socketStillUsed = (roomId: string, socketId: string) =>
      this.data.layout.portals.some(
        (candidate) =>
          (candidate.fromRoomId === roomId &&
            candidate.fromSocketId === socketId) ||
          (candidate.toRoomId === roomId && candidate.toSocketId === socketId),
      );
    for (const [roomId, socketId] of [
      [portal.fromRoomId, portal.fromSocketId],
      [portal.toRoomId, portal.toSocketId],
    ] as const) {
      const room = this.room(roomId);
      if (room && !socketStillUsed(roomId, socketId)) {
        room.doorwaySockets = room.doorwaySockets.filter(
          (socket) => socket.id !== socketId,
        );
      }
    }
    this.selectedId = null;
    this.transform.detach();
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Remove connective tissue ${portal.id}`, before);
    this.refresh(
      `${portal.id} removed with its paired splat openings // Undo restores the complete link`,
    );
    return true;
  }

  private revealTrimPlane(trimId: string, status: string): void {
    const entityId = `${TRIM_HANDLE_PREFIX}${trimId}`;
    if (!this.entities.has(entityId)) return;
    this.overlays.trims = true;
    this.overlays.labels = false;
    this.hiddenLayerIds.delete(this.trim(trimId)?.roomId ?? '');
    this.applyOverlayVisibility();
    this.tool = 'translate';
    this.transform.setMode('translate');
    this.select(entityId);
    this.frameSelection();
    this.refresh(status);
  }

  private deleteSelectedTrim(): boolean {
    if (!this.selectedId) return false;
    const entity = this.entities.get(this.selectedId);
    if (
      entity?.type !== 'trim' ||
      this.lockedLayerIds.has(entity.roomId)
    ) {
      return false;
    }
    const before = this.snapshot();
    this.data.layout.trimPlanes = (this.data.layout.trimPlanes ?? []).filter(
      (trim) => trim.id !== entity.dataId,
    );
    this.selectedId = null;
    this.transform.detach();
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Delete ${entity.label}`, before);
    return true;
  }

  private flipSelectedTrim(): void {
    if (!this.selectedId) return;
    const entity = this.entities.get(this.selectedId);
    if (
      entity?.type !== 'trim' ||
      this.lockedLayerIds.has(entity.roomId)
    ) {
      return;
    }
    const trim = this.trim(entity.dataId);
    if (!trim) return;
    const before = this.snapshot();
    trim.keepSide = trim.keepSide === 'positive' ? 'negative' : 'positive';
    this.applyDataToScene();
    this.commit(`Flip ${trim.id}`, before);
    this.refresh(
      `${trim.id} flipped // keeping ${trim.keepSide} side of the arrow`,
    );
  }

  /**
   * Auto-link / break doorway pairs for overlapping opposite-room cuts.
   * Mutates layout in place; caller owns undo commit.
   */
  private reconcileCutDoorwayLinks(focusCutId?: string): string | null {
    const cuts = (this.data.layout.cutVolumes ?? []).filter((cut) => cut.enabled);
    const focus = focusCutId ? this.cut(focusCutId) : null;
    const notes: string[] = [];

    // Break pairs that drifted too far apart.
    const portalIds = [
      ...new Set(
        cuts
          .map((cut) => cut.portalId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const portalId of portalIds) {
      const pair = cuts.filter((cut) => cut.portalId === portalId);
      if (pair.length !== 2) continue;
      if (cutCenterDistance(pair[0]!, pair[1]!) <= CUT_DOORWAY_BREAK_DIST_M) {
        continue;
      }
      if (
        focus &&
        focus.portalId === portalId &&
        this.detachDoorwayPair(portalId, { keepCuts: true })
      ) {
        notes.push('unlinked (cuts moved apart)');
      } else if (
        !focus &&
        this.detachDoorwayPair(portalId, { keepCuts: true })
      ) {
        notes.push(
          `unlinked ${roomLabel(pair[0]!.roomId)} ↔ ${roomLabel(pair[1]!.roomId)} (too far)`,
        );
      }
    }

    const candidates = focus
      ? [focus]
      : cuts.filter((cut) => !cut.portalId);
    for (const cut of candidates) {
      if (!cut.enabled || cut.portalId) continue;
      const match = this.findBestUnpairedOverlap(cut);
      if (!match) continue;
      if (match.ambiguous) {
        notes.push(
          `${cut.id} overlaps multiple cuts // use Link doorway`,
        );
        continue;
      }
      const portalId = this.linkExistingCuts(cut, match.cut);
      if (portalId) {
        notes.push(
          `linked ${roomLabel(cut.roomId)} ↔ ${roomLabel(match.cut.roomId)}`,
        );
      }
    }
    return notes.length > 0 ? notes.join(' · ') : null;
  }

  private findBestUnpairedOverlap(
    cut: SplatCutVolume,
  ): { cut: SplatCutVolume; score: number; ambiguous: boolean } | null {
    const ranked: Array<{ cut: SplatCutVolume; score: number }> = [];
    for (const other of this.data.layout.cutVolumes ?? []) {
      if (other.id === cut.id || other.portalId) continue;
      const score = scoreCutDoorwayOverlap(cut, other);
      if (score == null) continue;
      ranked.push({ cut: other, score });
    }
    ranked.sort((a, b) => a.score - b.score);
    const best = ranked[0];
    if (!best) return null;
    const second = ranked[1];
    const ambiguous = Boolean(second && second.score - best.score < 0.35);
    return { cut: best.cut, score: best.score, ambiguous };
  }

  private linkExistingCuts(
    cutA: SplatCutVolume,
    cutB: SplatCutVolume,
  ): string | null {
    if (cutA.roomId === cutB.roomId) return null;
    if (cutA.portalId || cutB.portalId) {
      if (cutA.portalId && cutA.portalId === cutB.portalId) return cutA.portalId;
      return null;
    }
    const fromCut =
      cutA.roomId === this.data.layout.startRoomId
        ? cutA
        : cutB.roomId === this.data.layout.startRoomId
          ? cutB
          : cutA.roomId < cutB.roomId
            ? cutA
            : cutB;
    const toCut = fromCut.id === cutA.id ? cutB : cutA;
    const fromRoom = this.room(fromCut.roomId);
    const toRoom = this.room(toCut.roomId);
    if (!fromRoom || !toRoom) return null;

    const base = `${roomLabel(fromRoom.id)}-${roomLabel(toRoom.id)}`
      .toLowerCase()
      .replaceAll(' ', '-');
    let portalId = `portal-${base}`;
    let suffix = 2;
    while (this.data.layout.portals.some((portal) => portal.id === portalId)) {
      portalId = `portal-${base}-${suffix}`;
      suffix += 1;
    }
    const fromSocketId = `opening-${portalId.replace(/^portal-/, '')}-from`;
    const toSocketId = `opening-${portalId.replace(/^portal-/, '')}-to`;
    const fromWorld = new THREE.Vector2(fromCut.position[0], fromCut.position[2]);
    const toWorld = new THREE.Vector2(toCut.position[0], toCut.position[2]);
    const width = Math.max(fromCut.size[2], toCut.size[2], 5);
    const height = Math.max(fromCut.size[1], toCut.size[1]);
    const depth = Math.max(fromCut.size[0], toCut.size[0], 4);
    const makeSocket = (
      id: string,
      room: SplatLayoutRoom,
      point: THREE.Vector2,
      destination: THREE.Vector2,
    ): SplatDoorwaySocket => {
      const local = this.socketLocalPoint(room, point);
      return {
        id,
        position: [local.x, local.y],
        yaw:
          Math.atan2(destination.x - point.x, destination.y - point.y) -
          room.transform.authoredYaw,
        width,
        height,
        coverageDepth: depth,
        visualState: 'open',
        verifiedTraversable: true,
        evidence: 'Auto-paired overlapping door cuts',
      };
    };
    const fromSocket = makeSocket(fromSocketId, fromRoom, fromWorld, toWorld);
    const toSocket = makeSocket(toSocketId, toRoom, toWorld, fromWorld);
    const portal: SplatLayoutPortal = {
      id: portalId,
      fromRoomId: fromRoom.id,
      toRoomId: toRoom.id,
      fromSocketId,
      toSocketId,
      fromClipId: fromCut.id,
      toClipId: toCut.id,
      traversalPolygon: [
        [fromWorld.x - 0.15, fromWorld.y - 0.15],
        [toWorld.x + 0.15, toWorld.y - 0.15],
        [toWorld.x, toWorld.y + 0.15],
      ],
      transitionPolygon: [
        [fromWorld.x - 0.15, fromWorld.y - 0.15],
        [toWorld.x + 0.15, toWorld.y - 0.15],
        [toWorld.x, toWorld.y + 0.15],
      ],
      width,
      enabled: false,
      residency: {
        requiredAssetIds: [fromRoom.assetId, toRoom.assetId],
        minimumActiveSplats: 0,
      },
    };
    fromRoom.doorwaySockets.push(fromSocket);
    toRoom.doorwaySockets.push(toSocket);
    this.data.layout.portals.push(portal);
    fromCut.portalId = portalId;
    toCut.portalId = portalId;
    this.updatePortalPolygons(true, new Set([portalId]));
    return portalId;
  }

  /** Remove doorway metadata but keep the physical cut cubes. */
  private detachDoorwayPair(
    portalId: string,
    options: { keepCuts: boolean },
  ): boolean {
    const portal = this.data.layout.portals.find(
      (entry) => entry.id === portalId,
    );
    if (!portal) return false;
    this.data.layout.portals = this.data.layout.portals.filter(
      (entry) => entry.id !== portalId,
    );
    const linkedCutIds = new Set(
      (this.data.layout.cutVolumes ?? [])
        .filter((cut) => cut.portalId === portalId)
        .map((cut) => cut.id),
    );
    for (const cut of this.data.layout.cutVolumes ?? []) {
      if (cut.portalId !== portalId) continue;
      delete cut.portalId;
    }
    for (const trim of this.data.layout.trimPlanes ?? []) {
      if (trim.portalId !== portalId) continue;
      delete trim.portalId;
    }
    if (!options.keepCuts) {
      this.data.layout.cutVolumes = (this.data.layout.cutVolumes ?? []).filter(
        (cut) => !linkedCutIds.has(cut.id),
      );
    }
    const socketStillUsed = (roomId: string, socketId: string) =>
      this.data.layout.portals.some(
        (candidate) =>
          (candidate.fromRoomId === roomId &&
            candidate.fromSocketId === socketId) ||
          (candidate.toRoomId === roomId && candidate.toSocketId === socketId),
      );
    for (const [roomId, socketId] of [
      [portal.fromRoomId, portal.fromSocketId],
      [portal.toRoomId, portal.toSocketId],
    ] as const) {
      const room = this.room(roomId);
      if (room && !socketStillUsed(roomId, socketId)) {
        room.doorwaySockets = room.doorwaySockets.filter(
          (socket) => socket.id !== socketId,
        );
      }
    }
    return true;
  }

  private linkSelectedCutDoorway(): void {
    const entity = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    if (entity?.type !== 'cut') {
      this.refresh('Select a door cut before linking');
      return;
    }
    const cut = this.cut(entity.dataId);
    if (!cut) return;
    if (cut.portalId) {
      const portal = this.data.layout.portals.find(
        (entry) => entry.id === cut.portalId,
      );
      this.refresh(
        portal
          ? `Already linked ${roomLabel(portal.fromRoomId)} ↔ ${roomLabel(portal.toRoomId)}`
          : 'This cut is already linked',
      );
      return;
    }
    const match = this.findBestUnpairedOverlap(cut);
    if (!match) {
      this.refresh(
        'No overlapping opposite-room cut nearby // drag cuts together, then Link',
      );
      return;
    }
    if (match.ambiguous) {
      this.refresh(
        'Multiple overlapping cuts nearby // move the wrong ones away, then Link',
      );
      return;
    }
    const before = this.snapshot();
    const portalId = this.linkExistingCuts(cut, match.cut);
    if (!portalId) {
      this.refresh('Could not link those cuts');
      return;
    }
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Link doorway ${portalId}`, before);
    this.overlays.connective = true;
    this.overlays.doorways = true;
    this.refresh(
      `Linked ${roomLabel(cut.roomId)} ↔ ${roomLabel(match.cut.roomId)} // + WALK into the opening`,
    );
  }

  private unlinkSelectedCutDoorway(): void {
    const entity = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    let portalId: string | undefined;
    if (entity?.type === 'cut') {
      portalId = this.cut(entity.dataId)?.portalId;
    } else if (entity?.type === 'portal') {
      portalId = entity.dataId;
    }
    if (!portalId) {
      this.refresh('Select a linked door cut (or connective link) to unlink');
      return;
    }
    const portal = this.data.layout.portals.find(
      (entry) => entry.id === portalId,
    );
    const before = this.snapshot();
    if (!this.detachDoorwayPair(portalId, { keepCuts: true })) {
      this.refresh('Nothing to unlink');
      return;
    }
    this.selectedId = null;
    this.transform.detach();
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Unlink doorway ${portalId}`, before);
    this.refresh(
      portal
        ? `Unlinked ${roomLabel(portal.fromRoomId)} ↔ ${roomLabel(portal.toRoomId)} // cuts kept`
        : 'Doorway unlinked // cuts kept',
    );
  }

  private doorwayLinkLabel(portalId: string | undefined): string | undefined {
    if (!portalId) return undefined;
    const portal = this.data.layout.portals.find(
      (entry) => entry.id === portalId,
    );
    if (!portal) return undefined;
    return `${roomLabel(portal.fromRoomId)} ↔ ${roomLabel(portal.toRoomId)}`;
  }

  private ensurePortalCuts(portalId: string): void {
    const portal = this.data.layout.portals.find(
      (entry) => entry.id === portalId,
    );
    if (!portal) return;
    const before = this.snapshot();
    this.data.layout.cutVolumes ??= [];
    const sides = [
      {
        suffix: 'from',
        roomId: portal.fromRoomId,
        socketId: portal.fromSocketId,
      },
      {
        suffix: 'to',
        roomId: portal.toRoomId,
        socketId: portal.toSocketId,
      },
    ] as const;
    let firstId: string | null = null;
    let createdCount = 0;
    for (const side of sides) {
      const existing = this.data.layout.cutVolumes.find(
        (cut) => cut.portalId === portal.id && cut.roomId === side.roomId,
      );
      if (existing) {
        firstId ??= existing.id;
        continue;
      }
      if (this.data.layout.cutVolumes.length >= MAX_SPLAT_CUT_VOLUMES) {
        this.refresh(`Cut limit reached // ${MAX_SPLAT_CUT_VOLUMES}`);
        return;
      }
      const room = this.room(side.roomId);
      const socket = this.socket(side.roomId, side.socketId);
      if (!room || !socket) continue;
      const point = this.socketWorldPoint(room, socket.position);
      // Match authored cut convention: local X = through-wall thickness,
      // local Z = doorway width along the wall face.
      const size: [number, number, number] = [
        Math.max(4, socket.coverageDepth || 2.2),
        socket.height + 0.12,
        Math.max(portal.width, socket.width) + 0.24,
      ];
      let id = `cut-${portal.id.replace(/^portal-/, '')}-${side.suffix}`;
      let duplicate = 2;
      while (this.cut(id)) {
        id = `cut-${portal.id.replace(/^portal-/, '')}-${side.suffix}-${duplicate}`;
        duplicate += 1;
      }
      this.data.layout.cutVolumes.push({
        id,
        roomId: room.id,
        portalId: portal.id,
        position: [
          point.x,
          seatedCutCenterY(
            roomFloorY(room.transform.position[1]),
            size[1],
            STANDARD_DOOR_CUT_SILL,
          ),
          point.y,
        ],
        rotation: [
          0,
          room.transform.authoredYaw + socket.yaw,
          0,
        ],
        size,
        enabled: true,
      });
      createdCount += 1;
      firstId ??= id;
    }
    if (!firstId) return;
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Create paired cuts for ${portal.id}`, before);
    this.revealCutVolume(
      firstId,
      createdCount > 0
        ? `Paired doorway cuts created for ${portal.id} // showing the first side`
        : `Paired doorway cuts already exist for ${portal.id} // showing the first side`,
    );
  }

  private revealCutVolume(cutId: string, status: string): void {
    const cut = this.cut(cutId);
    const entityId = `${CUT_HANDLE_PREFIX}${cutId}`;
    if (!cut || !this.entities.has(entityId)) return;
    this.overlays.doorways = true;
    this.hiddenLayerIds.delete(cut.roomId);
    this.soloLayerId = cut.portalId ? null : cut.roomId;
    this.applyOverlayVisibility();
    this.tool = 'translate';
    this.transform.setMode('translate');
    this.select(entityId);
    this.frameSelection();
    this.refresh(status);
  }

  private copySelectedCut(): boolean {
    if (!this.selectedId) return false;
    const entity = this.entities.get(this.selectedId);
    if (entity?.type !== 'cut') return false;
    const cut = this.cut(entity.dataId);
    if (!cut) return false;
    this.cutClipboard = cloneData(cut);
    this.trimClipboard = null;
    this.clipboardType = 'cut';
    this.refresh(`Copied ${cut.id} // press ⌘V to paste`);
    return true;
  }

  private pasteCutClipboard(): boolean {
    if (!this.cutClipboard || this.clipboardType !== 'cut') return false;
    this.data.layout.cutVolumes ??= [];
    if (this.data.layout.cutVolumes.length >= MAX_SPLAT_CUT_VOLUMES) {
      this.refresh(`Cut limit reached // ${MAX_SPLAT_CUT_VOLUMES}`);
      return true;
    }
    const source = cloneData(this.cutClipboard);
    const base = `${source.id}-copy`;
    let id = base;
    let suffix = 2;
    while (this.cut(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    const offset = Math.max(0.5, source.size[0] * 0.25);
    const tangent = new THREE.Vector3(1, 0, 0).applyEuler(
      new THREE.Euler(...source.rotation),
    );
    const cut: SplatCutVolume = {
      ...source,
      id,
      position: [
        source.position[0] + tangent.x * offset,
        source.position[1],
        source.position[2] + tangent.z * offset,
      ],
    };
    const pasteRoom = this.room(cut.roomId);
    if (pasteRoom) {
      clampCutAboveFloor(cut, roomFloorY(pasteRoom.transform.position[1]));
    }
    const wasDoorwayCut = Boolean(cut.portalId);
    delete cut.portalId;
    const before = this.snapshot();
    this.data.layout.cutVolumes.push(cut);
    const pairNote = this.reconcileCutDoorwayLinks(cut.id);
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Paste ${cut.id}`, before);
    this.revealCutVolume(
      cut.id,
      [
        wasDoorwayCut
          ? `Pasted ${cut.id} as a standalone cut // doorway link was not copied`
          : `Pasted ${cut.id} // drag the pink volume with W/E/R`,
        pairNote,
      ]
        .filter(Boolean)
        .join(' · '),
    );
    return true;
  }

  private copySelectedClip(): boolean {
    if (!this.selectedId) return false;
    const entity = this.entities.get(this.selectedId);
    if (entity?.type === 'cut') return this.copySelectedCut();
    if (entity?.type !== 'trim') return false;
    const trim = this.trim(entity.dataId);
    if (!trim) return false;
    this.trimClipboard = cloneData(trim);
    this.cutClipboard = null;
    this.clipboardType = 'trim';
    this.refresh(`Copied ${trim.id} // press ⌘V to paste`);
    return true;
  }

  private pasteClipClipboard(): boolean {
    if (this.clipboardType === 'cut') return this.pasteCutClipboard();
    if (!this.trimClipboard || this.clipboardType !== 'trim') return false;
    this.data.layout.trimPlanes ??= [];
    if (this.data.layout.trimPlanes.length >= MAX_SPLAT_TRIM_PLANES) {
      this.refresh(`Trim plane limit reached // ${MAX_SPLAT_TRIM_PLANES}`);
      return true;
    }
    const source = cloneData(this.trimClipboard);
    const base = `${source.id}-copy`;
    let id = base;
    let suffix = 2;
    while (this.trim(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    const tangent = new THREE.Vector3(1, 0, 0).applyEuler(
      new THREE.Euler(...source.rotation),
    );
    const trim: SplatTrimPlane = {
      ...source,
      id,
      position: [
        source.position[0] + tangent.x * 0.75,
        source.position[1] + tangent.y * 0.75,
        source.position[2] + tangent.z * 0.75,
      ],
    };
    const before = this.snapshot();
    this.data.layout.trimPlanes.push(trim);
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Paste ${trim.id}`, before);
    this.revealTrimPlane(
      trim.id,
      `Pasted ${trim.id} on ${roomLabel(trim.roomId)} only`,
    );
    return true;
  }

  private deleteSelectedCut(): boolean {
    if (!this.selectedId) return false;
    const entity = this.entities.get(this.selectedId);
    if (
      entity?.type !== 'cut' ||
      this.lockedLayerIds.has(entity.roomId)
    ) {
      return false;
    }
    const before = this.snapshot();
    const cut = this.cut(entity.dataId);
    if (cut?.portalId) {
      // Keep the partner cut; only drop doorway metadata for the pair.
      this.detachDoorwayPair(cut.portalId, { keepCuts: true });
    }
    this.data.layout.cutVolumes = (this.data.layout.cutVolumes ?? []).filter(
      (entry) => entry.id !== entity.dataId,
    );
    this.selectedId = null;
    this.transform.detach();
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Delete ${entity.label}`, before);
    return true;
  }

  private beginBoundaryEdit(
    requestedRoomId?: string,
    requestedPatchId?: string,
    pointIndex = 0,
  ): void {
    const selected = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    const patchFromId = requestedPatchId
      ? this.walkablePatch(requestedPatchId)
      : null;
    const roomId =
      patchFromId?.roomId ??
      requestedRoomId ??
      (selected?.type === 'room' ? selected.dataId : selected?.roomId);
    const room = roomId ? this.room(roomId) : null;
    if (!room) {
      this.refresh('Select a splat before editing walkable space');
      return;
    }
    if (this.lockedLayerIds.has(room.id)) {
      this.refresh(`${roomLabel(room.id)} layer is locked`);
      return;
    }
    const patches = (this.data.layout.walkablePatches ?? []).filter(
      (patch) => patch.roomId === room.id,
    );
    if (patches.length === 0) {
      this.addWalkablePatch(room.id);
      return;
    }
    const patch =
      (patchFromId && patchFromId.roomId === room.id ? patchFromId : null) ??
      (this.boundaryEditPatchId
        ? patches.find((entry) => entry.id === this.boundaryEditPatchId)
        : undefined) ??
      patches[patches.length - 1]!;
    const alreadyEditingRoom = this.boundaryEditRoomId === room.id;
    const samePatch = this.boundaryEditPatchId === patch.id;
    this.boundaryEditRoomId = room.id;
    this.boundaryEditPatchId = patch.id;
    this.overlays.navigation = true;
    this.overlays.labels = false;
    this.tool = 'translate';
    this.transform.setMode('translate');
    this.transform.detach();
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    const safeIndex = Math.max(
      0,
      Math.min(pointIndex, Math.max(0, patch.polygon.length - 1)),
    );
    this.select(`${BOUNDARY_HANDLE_PREFIX}${room.id}:${safeIndex}`);
    if (!alreadyEditingRoom) {
      this.frameRoomBoundary(room);
    }
    this.refresh(
      samePatch && alreadyEditingRoom
        ? `Editing ${patch.id} pt ${safeIndex + 1}`
        : `Editing ${patch.id} // drag green points // click dim corners or Tab to cycle overlaps`,
    );
  }

  private setWalkableDragMode(mode: 'corner' | 'patch'): void {
    if (!this.boundaryEditRoomId) {
      this.refresh('Enter walkable edit (+ WALK) before changing drag mode');
      return;
    }
    if (this.walkableDragMode === mode) {
      this.refresh(
        mode === 'patch'
          ? 'Walkable drag // whole patch (already on)'
          : 'Walkable drag // corners (already on)',
      );
      return;
    }
    this.walkableDragMode = mode;
    const selectedBoundary =
      this.selectedId && this.entities.has(this.selectedId)
        ? this.selectedId
        : `${BOUNDARY_HANDLE_PREFIX}${this.boundaryEditRoomId}:0`;
    this.rebuildEntities();
    this.applyDataToScene();
    if (this.entities.has(selectedBoundary)) {
      this.selectedId = null;
      this.select(selectedBoundary);
    }
    this.refresh(
      mode === 'patch'
        ? 'Walkable drag // whole patch — drag any handle to slide the section'
        : 'Walkable drag // corners — drag one point to reshape',
    );
  }

  private toggleWalkableFocus(): void {
    if (!this.boundaryEditRoomId) {
      this.refresh('Enter walkable edit (+ WALK) before toggling focus');
      return;
    }
    this.walkableFocusActive = !this.walkableFocusActive;
    this.rebuildEntities();
    this.applyDataToScene();
    const selectedBoundary =
      this.selectedId && this.entities.has(this.selectedId)
        ? this.selectedId
        : `${BOUNDARY_HANDLE_PREFIX}${this.boundaryEditRoomId}:0`;
    if (this.entities.has(selectedBoundary)) {
      this.selectedId = null;
      this.select(selectedBoundary);
    }
    this.refresh(
      this.walkableFocusActive
        ? 'Focus on // other patch fills hidden // Show all to compare'
        : 'Show all patches // click dim corners to switch · Tab cycles overlaps',
    );
  }

  private finishBoundaryEdit(): void {
    const roomId = this.boundaryEditRoomId;
    if (!roomId) return;
    this.boundaryEditRoomId = null;
    this.boundaryEditPatchId = null;
    this.transform.detach();
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.select(`${ROOM_HANDLE_PREFIX}${roomId}`);
    this.refresh(
      `${roomLabel(roomId)} walkable edit finished // Save, then Playtest`,
    );
  }

  private addWalkablePatch(requestedRoomId?: string): boolean {
    const selected = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    const roomId =
      requestedRoomId ??
      (selected?.type === 'room' ? selected.dataId : selected?.roomId);
    const room = roomId ? this.room(roomId) : null;
    if (!room) {
      this.refresh('Select a splat layer before adding walkable space');
      return false;
    }
    if (this.lockedLayerIds.has(room.id)) {
      this.refresh(`${roomLabel(room.id)} layer is locked`);
      return false;
    }
    const before = this.snapshot();
    const existingForRoom = (this.data.layout.walkablePatches ?? []).filter(
      (entry) => entry.roomId === room.id,
    );
    const cut =
      selected?.type === 'cut'
        ? this.cut(selected.dataId)
        : (this.data.layout.cutVolumes ?? []).find(
            (entry) => entry.roomId === room.id && entry.enabled,
          );
    const centerWorld = cut
      ? new THREE.Vector2(cut.position[0], cut.position[2])
      : this.socketWorldPoint(room, room.anchor);
    const stagger = existingForRoom.length * 2.4;
    centerWorld.x += stagger;
    centerWorld.y += stagger * 0.35;
    const half =
      cut != null
        ? Math.max(1.8, Math.min(cut.size[0], cut.size[2]) * 0.55)
        : 3.2;
    const corners = [
      new THREE.Vector2(centerWorld.x - half, centerWorld.y - half),
      new THREE.Vector2(centerWorld.x + half, centerWorld.y - half),
      new THREE.Vector2(centerWorld.x + half, centerWorld.y + half),
      new THREE.Vector2(centerWorld.x - half, centerWorld.y + half),
    ].map((point) => {
      const local = this.socketLocalPoint(room, point);
      return [local.x, local.y] as [number, number];
    });
    this.data.layout.walkablePatches ??= [];
    const base = `walk-${roomLabel(room.id).toLowerCase().replaceAll(' ', '-')}`;
    let suffix = 1;
    let id = `${base}-${suffix}`;
    while (this.walkablePatch(id)) {
      suffix += 1;
      id = `${base}-${suffix}`;
    }
    const patch: SplatWalkablePatch = {
      id,
      roomId: room.id,
      polygon: corners,
    };
    this.data.layout.walkablePatches.push(patch);
    this.transform.detach();
    this.selectedId = null;
    this.commit(`Add ${roomLabel(room.id)} walkable patch`, before);
    this.beginBoundaryEdit(room.id, patch.id);
    this.refresh(
      `${patch.id} added (${existingForRoom.length + 1} on ${roomLabel(room.id)}) // drag points or + WALK again`,
    );
    return true;
  }

  private deleteWalkablePatch(requestedRoomId?: string): boolean {
    const selected = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    const roomId =
      requestedRoomId ??
      this.boundaryEditRoomId ??
      (selected?.type === 'room' ? selected.dataId : selected?.roomId);
    const room = roomId ? this.room(roomId) : null;
    if (!room) {
      this.refresh('Select a splat layer before deleting walkable space');
      return false;
    }
    if (this.lockedLayerIds.has(room.id)) {
      this.refresh(`${roomLabel(room.id)} layer is locked`);
      return false;
    }
    const patches = this.data.layout.walkablePatches ?? [];
    const patchId =
      this.boundaryEditPatchId ??
      patches.find((patch) => patch.roomId === room.id)?.id;
    if (!patchId) {
      this.refresh(`${roomLabel(room.id)} has no walkable patch to delete`);
      return false;
    }
    const before = this.snapshot();
    this.data.layout.walkablePatches = patches.filter(
      (patch) => patch.id !== patchId,
    );
    if (this.boundaryEditPatchId === patchId) {
      this.boundaryEditRoomId = null;
      this.boundaryEditPatchId = null;
    }
    this.transform.detach();
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Delete ${roomLabel(room.id)} walkable patch`, before);
    this.refresh(`${roomLabel(room.id)} walkable patch deleted // Backspace`);
    return true;
  }

  private addBoundaryPoint(): boolean {
    if (!this.selectedId) return false;
    const entity = this.entities.get(this.selectedId);
    if (
      entity?.type !== 'boundary' ||
      this.lockedLayerIds.has(entity.roomId)
    ) {
      return false;
    }
    const room = this.room(entity.roomId);
    const patch = this.boundaryEditPatchId
      ? this.walkablePatch(this.boundaryEditPatchId)
      : null;
    const index = Number(entity.dataId);
    if (
      !room ||
      !patch ||
      !Number.isInteger(index) ||
      !patch.polygon[index]
    ) {
      return false;
    }
    const nextIndex = (index + 1) % patch.polygon.length;
    const current = patch.polygon[index]!;
    const next = patch.polygon[nextIndex]!;
    const inserted: [number, number] = [
      (current[0] + next[0]) * 0.5,
      (current[1] + next[1]) * 0.5,
    ];
    const before = this.snapshot();
    patch.polygon.splice(index + 1, 0, inserted);
    this.transform.detach();
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Insert ${roomLabel(room.id)} walkable point`, before);
    this.select(
      `${BOUNDARY_HANDLE_PREFIX}${room.id}:${index + 1}`,
    );
    this.refresh(
      `Walkable point inserted // ${patch.polygon.length} points`,
    );
    return true;
  }

  private deleteBoundaryPoint(): boolean {
    if (!this.selectedId) return false;
    const entity = this.entities.get(this.selectedId);
    if (
      entity?.type !== 'boundary' ||
      this.lockedLayerIds.has(entity.roomId)
    ) {
      return false;
    }
    const room = this.room(entity.roomId);
    const patch = this.boundaryEditPatchId
      ? this.walkablePatch(this.boundaryEditPatchId)
      : null;
    const index = Number(entity.dataId);
    if (
      !room ||
      !patch ||
      !Number.isInteger(index) ||
      !patch.polygon[index]
    ) {
      return false;
    }
    if (patch.polygon.length <= 3) {
      this.refresh('A walkable patch needs at least three points');
      return false;
    }
    const before = this.snapshot();
    patch.polygon.splice(index, 1);
    const nextIndex = Math.min(index, patch.polygon.length - 1);
    this.transform.detach();
    this.selectedId = null;
    this.rebuildEntities();
    this.applyDataToScene();
    this.commit(`Delete ${roomLabel(room.id)} walkable point`, before);
    this.select(`${BOUNDARY_HANDLE_PREFIX}${room.id}:${nextIndex}`);
    this.refresh(
      `Walkable point deleted // ${patch.polygon.length} points`,
    );
    return true;
  }


  private deleteSelectedEntity(): boolean {
    if (!this.selectedId) {
      if (this.boundaryEditPatchId) {
        return this.deleteWalkablePatch();
      }
      this.refresh(
        'Select connective tissue, a cut, trim, or walkable patch to delete',
      );
      return false;
    }
    const entity = this.entities.get(this.selectedId);
    if (!entity) return false;
    if (entity.type === 'portal') {
      return this.deleteSelectedConnectiveTissue();
    }
    if (this.lockedLayerIds.has(entity.roomId)) {
      this.refresh(`${roomLabel(entity.roomId)} layer is locked`);
      return false;
    }
    if (entity.type === 'cut') return this.deleteSelectedCut();
    if (entity.type === 'trim') return this.deleteSelectedTrim();
    if (entity.type === 'boundary') return this.deleteWalkablePatch();
    this.refresh(
      `${entity.label} is protected // delete is available for links, cuts, trims, and walkable patches`,
    );
    return false;
  }

  private setTool(tool: EditorTool): void {
    const selected = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    if (tool === 'scale' && selected?.type === 'trim') {
      this.refresh('Trim planes are infinite // use Move or Rotate');
      return;
    }
    if (tool === 'scale' && selected?.type === 'placement') {
      this.refresh('Gameplay placement scale is fixed by its runtime asset');
      return;
    }
    if (
      tool === 'rotate' &&
      selected?.type === 'placement' &&
      (selected.kind === 'player-start' || selected.kind === 'zombie-spawn')
    ) {
      this.refresh('This gameplay anchor has no authored orientation');
      return;
    }
    if (
      selected?.type === 'boundary' &&
      tool !== 'translate'
    ) {
      this.refresh('Boundary points use the Move tool on X/Z only');
      return;
    }
    this.tool = tool;
    this.transform.setMode(tool);
    const entity = this.selectedId
      ? this.entities.get(this.selectedId)
      : undefined;
    if (entity) this.configureTransformAxes(entity);
    this.refresh(
      tool === 'rotate' && entity?.type === 'room'
        ? 'Horizontal rotation active // drag the green Y ring or edit rotation Y'
        : `${tool.charAt(0).toUpperCase() + tool.slice(1)} tool active`,
    );
  }

  private configureTransformAxes(entity: EditorEntity): void {
    this.transform.showX = true;
    this.transform.showY = true;
    this.transform.showZ = true;
    if (
      this.tool === 'rotate' &&
      (entity.type === 'room' ||
        entity.type === 'cut' ||
        entity.type === 'socket' ||
        entity.type === 'placement')
    ) {
      this.transform.showX = false;
      this.transform.showZ = false;
      if (
        entity.type === 'placement' &&
        (entity.kind === 'player-start' || entity.kind === 'zombie-spawn')
      ) {
        this.transform.showY = false;
      }
    } else if (entity.type === 'boundary') {
      this.transform.showY = false;
      this.transform.showZ = true;
    } else if (this.tool === 'translate' && entity.type === 'socket') {
      this.transform.showY = false;
    } else if (
      this.tool === 'translate' &&
      entity.type === 'placement' &&
      (entity.kind === 'player-start' || entity.kind === 'zombie-spawn')
    ) {
      this.transform.showY = false;
    } else if (this.tool === 'scale' && entity.type === 'room') {
      this.transform.showY = false;
      this.transform.showZ = false;
    } else if (this.tool === 'scale' && entity.type === 'socket') {
      this.transform.showZ = false;
    } else if (this.tool === 'scale' && entity.type === 'placement') {
      this.transform.showX = false;
      this.transform.showY = false;
      this.transform.showZ = false;
    } else if (this.tool === 'scale' && entity.type === 'trim') {
      this.transform.showX = false;
      this.transform.showY = false;
      this.transform.showZ = false;
    }
  }

  private setSnap(value: number): void {
    this.snap = Number.isFinite(value) && value >= 0 ? value : 0;
    this.transform.setTranslationSnap(this.snap || null);
    this.transform.setRotationSnap(
      this.snap > 0 ? THREE.MathUtils.degToRad(5) : null,
    );
    this.transform.setScaleSnap(this.snap > 0 ? 0.05 : null);
    this.refresh(this.snap > 0 ? `Snap // ${this.snap} m` : 'Snapping disabled');
  }

  private undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    const command = this.history[this.historyIndex]!;
    this.restoreSnapshot(command.before);
    this.dirty = JSON.stringify(this.data) !== JSON.stringify(this.original);
    this.persistDraft();
    this.refresh(`Undo // ${command.label}`);
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length) return;
    const command = this.history[this.historyIndex]!;
    this.historyIndex += 1;
    this.restoreSnapshot(command.after);
    this.dirty = JSON.stringify(this.data) !== JSON.stringify(this.original);
    this.persistDraft();
    this.refresh(`Redo // ${command.label}`);
  }

  private revertSelection(): void {
    if (!this.selectedId) return;
    const entity = this.entities.get(this.selectedId);
    if (!entity?.editable) return;
    const before = this.snapshot();
    let rebuildTopology = false;
    if (entity.type === 'room') {
      rebuildTopology = true;
      const source = this.original.layout.rooms.find(
        (room) => room.id === entity.dataId,
      );
      const target = this.room(entity.dataId);
      const current = before.layout.rooms.find(
        (room) => room.id === entity.dataId,
      );
      if (source && target && current) {
        target.transform = cloneData(source.transform);
        this.moveOwnedPlacements(
          target.id,
          current.transform,
          target.transform,
          before,
        );
        this.moveOwnedCuts(
          target.id,
          current.transform,
          target.transform,
          before,
        );
        this.moveOwnedTrims(
          target.id,
          current.transform,
          target.transform,
          before,
        );
      }
    } else if (entity.type === 'boundary') {
      rebuildTopology = true;
      const source = this.original.layout.rooms.find(
        (room) => room.id === entity.roomId,
      );
      const target = this.room(entity.roomId);
      if (source && target) {
        target.coveragePolygon = cloneData(source.coveragePolygon);
      }
    } else if (entity.type === 'socket') {
      rebuildTopology = true;
      const sourceRoom = this.original.layout.rooms.find(
        (room) => room.id === entity.roomId,
      );
      const source = sourceRoom?.doorwaySockets.find(
        (socket) => socket.id === entity.dataId,
      );
      const target = this.socket(entity.roomId, entity.dataId);
      if (source && target) Object.assign(target, cloneData(source));
    } else if (entity.type === 'placement') {
      const source = this.original.placements.placements.find(
        (placement) => placement.id === entity.dataId,
      );
      const target = this.placement(entity.dataId);
      if (source && target) {
        Object.assign(target, cloneData(source));
        if (source.kind === 'barrier' || source.kind === 'zombie-spawn') {
          const spawnId =
            source.kind === 'zombie-spawn'
              ? source.id
              : source.id.replace(/^barrier-/, 'sp-');
          const barrierId =
            source.kind === 'barrier'
              ? source.id
              : source.id.replace(/^sp-/, 'barrier-');
          for (const pairedId of [spawnId, barrierId]) {
            const pairedSource = this.original.placements.placements.find(
              (placement) => placement.id === pairedId,
            );
            const pairedTarget = this.placement(pairedId);
            if (pairedSource && pairedTarget) {
              Object.assign(pairedTarget, cloneData(pairedSource));
            }
          }
          const sourceRoom = this.original.layout.rooms.find(
            (room) => room.id === source.roomId,
          );
          const targetRoom = this.room(source.roomId);
          const sourceSocket = sourceRoom?.wallCrawlSockets.find(
            (socket) =>
              socket.id === spawnId && socket.barrierId === barrierId,
          );
          const targetSocket = targetRoom?.wallCrawlSockets.find(
            (socket) =>
              socket.id === spawnId && socket.barrierId === barrierId,
          );
          if (sourceSocket && targetSocket) {
            Object.assign(targetSocket, cloneData(sourceSocket));
          }
        }
      }
    } else if (entity.type === 'cut') {
      const source = (this.original.layout.cutVolumes ?? []).find(
        (cut) => cut.id === entity.dataId,
      );
      const target = this.cut(entity.dataId);
      if (source && target) {
        Object.assign(target, cloneData(source));
        this.restoreOriginalClipTopology(source.id, source.portalId);
      }
    } else if (entity.type === 'trim') {
      const source = (this.original.layout.trimPlanes ?? []).find(
        (trim) => trim.id === entity.dataId,
      );
      const target = this.trim(entity.dataId);
      if (source && target) {
        Object.assign(target, cloneData(source));
        this.restoreOriginalClipTopology(source.id, source.portalId);
      }
    }
    if (rebuildTopology) {
      this.rebuildNavigation();
      this.updatePortalPolygons(true);
    }
    if (entity.type === 'boundary') {
      this.transform.detach();
      this.selectedId = null;
      this.rebuildEntities();
      this.applyDataToScene();
      this.commit(`Revert ${roomLabel(entity.roomId)} boundary`, before);
      this.select(`${BOUNDARY_HANDLE_PREFIX}${entity.roomId}:0`);
      return;
    }
    this.applyDataToScene();
    this.commit(`Revert ${entity.label}`, before);
  }

  private restoreOriginalClipTopology(
    clipId: string,
    portalId: string | undefined,
  ): void {
    if (!portalId) return;
    const sourcePortal = this.original.layout.portals.find(
      (portal) => portal.id === portalId,
    );
    const targetPortal = this.data.layout.portals.find(
      (portal) => portal.id === portalId,
    );
    if (sourcePortal && targetPortal) {
      Object.assign(targetPortal, cloneData(sourcePortal));
    }
    for (const sourceRoom of this.original.layout.rooms) {
      const targetRoom = this.room(sourceRoom.id);
      if (!targetRoom) continue;
      for (const sourceSocket of sourceRoom.doorwaySockets) {
        if (sourceSocket.derivedFromClipId !== clipId) continue;
        const targetSocket = targetRoom.doorwaySockets.find(
          (socket) => socket.id === sourceSocket.id,
        );
        if (targetSocket) Object.assign(targetSocket, cloneData(sourceSocket));
      }
    }
  }

  private commit(label: string, before: EditorDataSnapshot): void {
    const after = this.snapshot();
    if (JSON.stringify(before) === JSON.stringify(after)) {
      this.refresh();
      return;
    }
    this.history.splice(this.historyIndex);
    this.history.push({ label, before, after });
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = this.history.length;
    this.dirty = JSON.stringify(after) !== JSON.stringify(this.original);
    this.persistDraft();
    this.refresh(label);
  }

  private snapshot(): EditorDataSnapshot {
    return cloneData(this.data);
  }

  private restoreSnapshot(snapshot: EditorDataSnapshot): void {
    this.data = cloneData(snapshot);
    this.data.layout.cutVolumes ??= [];
    this.data.layout.trimPlanes ??= [];
    if (
      this.boundaryEditRoomId &&
      (this.room(this.boundaryEditRoomId)?.coveragePolygon.length ?? 0) < 3
    ) {
      this.boundaryEditRoomId = null;
    }
    this.rebuildEntities();
    this.applyDataToScene();
    if (this.selectedId && this.entities.has(this.selectedId)) {
      const entity = this.entities.get(this.selectedId)!;
      if (entity.editable) {
        this.transform.attach(entity.object);
        this.configureTransformAxes(entity);
      }
    } else {
      this.selectedId = null;
      this.transform.detach();
    }
  }

  private persistDraft(): void {
    try {
      if (this.dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify(this.data));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      this.status = 'Browser draft storage is unavailable';
    }
  }

  private recoverDraft(): void {
    try {
      const stored = localStorage.getItem(DRAFT_KEY);
      if (!stored) return;
      const recovered = JSON.parse(stored) as EditorDataSnapshot;
      if (
        recovered.layout?.version === 1 &&
        recovered.placements?.version === 1 &&
        Array.isArray(recovered.navigation?.rooms)
      ) {
        this.data = recovered;
        this.data.layout.cutVolumes ??= [];
        this.data.layout.trimPlanes ??= [];
        this.data.layout.walkablePatches ??= [];
        this.dirty = true;
        this.status = 'Recovered unsaved browser draft';
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.exportPayload(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'zombies-editor-layout.json';
    link.click();
    URL.revokeObjectURL(url);
    this.refresh('Exported complete splat and placement draft');
  }

  private importJson(text: string): void {
    try {
      const parsed = JSON.parse(text) as Partial<EditorDataSnapshot> & {
        data?: EditorDataSnapshot;
      };
      const imported = parsed.data ?? parsed;
      if (
        imported.layout?.version !== 1 ||
        imported.placements?.version !== 1 ||
        !Array.isArray(imported.navigation?.rooms)
      ) {
        throw new Error('File is not a Zombies editor v1 export');
      }
      const before = this.snapshot();
      imported.layout.cutVolumes ??= [];
      imported.layout.trimPlanes ??= [];
      imported.layout.walkablePatches ??= [];
      this.restoreSnapshot(imported as EditorDataSnapshot);
      this.commit('Import editor layout', before);
    } catch (error) {
      this.refresh(
        `Import failed // ${error instanceof Error ? error.message : 'invalid JSON'}`,
      );
    }
  }

  private exportPayload(): EditorDataSnapshot & {
    editorVersion: 1;
    exportedAt: string;
  } {
    return {
      editorVersion: 1,
      exportedAt: new Date().toISOString(),
      ...this.snapshot(),
    };
  }

  private async saveToProject(): Promise<boolean> {
    const pairNote = this.reconcileCutDoorwayLinks();
    if (pairNote) {
      this.rebuildEntities();
      this.applyDataToScene();
      this.dirty = true;
    }
    this.refresh(pairNote ? `Auto-paired before save · ${pairNote}` : undefined);
    const issueCount = this.validation.errors.length;
    this.saving = true;
    this.refresh(
      issueCount > 0
        ? `Saving project with ${issueCount} Playtest issue(s)…`
        : 'Validating and saving project JSON…',
    );
    try {
      const response = await fetch('/__zombies-editor/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...this.exportPayload(),
          allowInvalid: true,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        backups?: string[];
        validationWarnings?: string[];
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? `Save failed (${response.status})`);
      }
      this.original = this.snapshot();
      this.dirty = false;
      this.history = [];
      this.historyIndex = 0;
      this.persistDraft();
      this.options.onProjectSaved?.(cloneData(this.original));
      this.saving = false;
      this.refresh(
        issueCount > 0
          ? `Project saved with ${issueCount} Playtest issue(s) // ${result.backups?.length ?? 0} recoverable backups`
          : `Project saved // ${result.backups?.length ?? 0} recoverable backups`,
      );
      return true;
    } catch (error) {
      this.saving = false;
      this.refresh(
        `Save failed // ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }

  private discardDraft(): void {
    if (!this.dirty) return;
    this.restoreSnapshot(this.original);
    this.history = [];
    this.historyIndex = 0;
    this.dirty = false;
    this.persistDraft();
    this.refresh('Draft discarded // restored last saved project');
  }

  private async playtest(): Promise<void> {
    if (this.playtesting || this.saving) return;
    this.refresh();
    if (this.validation.errors.length > 0) {
      this.refresh('Playtest blocked // validation has critical errors');
      return;
    }
    this.playtesting = true;
    this.refresh(
      this.dirty
        ? 'Saving valid edits before playtest…'
        : 'Launching playtest from editor…',
    );
    sessionStorage.setItem('blacksite:zombies-editor-playtest', '1');
    if (this.dirty && !(await this.saveToProject())) {
      sessionStorage.removeItem('blacksite:zombies-editor-playtest');
      this.playtesting = false;
      this.refresh('Playtest cancelled // project save failed');
      return;
    }
    this.refresh('Launching zombies playtest…');
    this.options.onPlaytest();
  }

  private frameAll(view: 'perspective' | 'top'): void {
    const bounds = this.editorBounds();
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, 12);
    this.options.camera.up.set(
      view === 'top' ? 0 : 0,
      view === 'top' ? 0 : 1,
      view === 'top' ? -1 : 0,
    );
    if (view === 'top') {
      this.options.camera.position.set(
        center.x,
        center.y + radius * 1.45,
        center.z,
      );
    } else {
      this.options.camera.position.set(
        center.x + radius * 0.72,
        center.y + radius * 0.66,
        center.z + radius * 0.88,
      );
    }
    this.orbit.target.copy(center);
    this.options.camera.lookAt(center);
    this.orbit.update();
    this.refresh(
      view === 'top'
        ? 'Top view // all splats'
        : 'Perspective view // all splats',
    );
  }

  private frameSelection(): void {
    if (!this.selectedId) return;
    const entity = this.entities.get(this.selectedId);
    if (!entity) return;
    const portalEndpoints =
      entity.type === 'portal' ? this.portalEndpoints(entity.dataId) : null;
    const center = portalEndpoints
      ? portalEndpoints.from.clone().lerp(portalEndpoints.to, 0.5)
      : entity.object.getWorldPosition(new THREE.Vector3());
    const size =
      entity.type === 'room'
        ? Math.max(
            ...this.worldPolygon(this.room(entity.dataId)!).map((point) =>
              point.distanceTo(
                new THREE.Vector2(center.x, center.z),
              ),
            ),
            8,
          )
        : entity.type === 'portal' && portalEndpoints
          ? Math.max(
              4,
              portalEndpoints.from.distanceTo(portalEndpoints.to) * 0.55,
            )
          : entity.type === 'trim'
            ? 9
            : 4;
    this.options.camera.up.set(0, 1, 0);
    this.options.camera.position.set(
      center.x + size * 0.85,
      center.y + size * 0.65,
      center.z + size,
    );
    this.orbit.target.copy(center);
    this.options.camera.lookAt(center);
    this.orbit.update();
    this.refresh(`Framed ${entity.label}`);
  }

  private frameRoomBoundary(room: SplatLayoutRoom): void {
    const patch = this.boundaryEditPatchId
      ? this.walkablePatch(this.boundaryEditPatchId)
      : null;
    const polygon =
      patch && patch.roomId === room.id
        ? this.walkablePatchWorldPolygon(room, patch)
        : this.worldPolygon(room);
    if (polygon.length < 3) return;
    const center2 = polygon
      .reduce((sum, point) => sum.add(point), new THREE.Vector2())
      .multiplyScalar(1 / polygon.length);
    const radius = Math.max(
      5,
      ...polygon.map((point) => point.distanceTo(center2)),
    );
    const center = new THREE.Vector3(
      center2.x,
      roomFloorY(room.transform.position[1]) + 0.4,
      center2.y,
    );
    this.options.camera.up.set(0, 0, -1);
    this.options.camera.position.set(
      center.x,
      center.y + radius * 2.2,
      center.z,
    );
    this.orbit.target.copy(center);
    this.options.camera.lookAt(center);
    this.orbit.update();
  }

  private editorBounds(): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const room of this.data.layout.rooms) {
      for (const point of this.worldPolygon(room)) {
        bounds.expandByPoint(
          new THREE.Vector3(
            point.x,
            room.transform.position[1],
            point.y,
          ),
        );
      }
    }
    return bounds;
  }

  private applyOverlayVisibility(): void {
    this.navigationRoot.visible = this.overlays.navigation;
    this.doorwayRoot.visible = this.overlays.doorways;
    this.boundaryRoot.visible =
      this.overlays.navigation || Boolean(this.boundaryEditRoomId);
    this.connectiveRoot.visible = this.overlays.connective;
    this.trimRoot.visible = this.overlays.trims;
    this.placementRoot.visible = this.overlays.placements;
    this.labelRoot.visible = this.overlays.labels;
    this.grid.visible = this.overlays.grid;
    const roomVisible = (roomId: string) =>
      !this.hiddenLayerIds.has(roomId) &&
      (!this.soloLayerId || this.soloLayerId === roomId);
    for (const [roomId, layer] of this.options.rooms) {
      layer.setRenderState(
        this.overlays.splats && roomVisible(roomId) ? 'primary' : 'resident',
      );
    }
    for (const entity of this.entities.values()) {
      const portal =
        entity.type === 'portal'
          ? this.data.layout.portals.find(
              (candidate) => candidate.id === entity.dataId,
            )
          : null;
      const visible = portal
        ? roomVisible(portal.fromRoomId) || roomVisible(portal.toRoomId)
        : roomVisible(entity.roomId);
      const enabled =
        entity.type === 'cut'
          ? Boolean(this.cut(entity.dataId)?.enabled)
          : entity.type === 'trim'
            ? Boolean(this.trim(entity.dataId)?.enabled)
            : true;
      if (entity.type === 'room') {
        entity.pickObject.visible = visible;
      } else {
        entity.object.visible = visible && enabled;
      }
      if (entity.labelSprite) {
        entity.labelSprite.visible =
          visible && enabled && this.overlays.labels;
      }
    }
  }

  private updateEntityMaterials(): void {
    for (const entity of this.entities.values()) {
      // Walkable corners use a larger invisible pick child — style the visible
      // handle mesh so hover/selection still reads on the green sphere.
      const mesh = (
        entity.type === 'boundary' || entity.type === 'walkable-proxy'
          ? entity.object
          : entity.pickObject
      ) as THREE.Mesh;
      const materials = mesh.material
        ? Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        : [];
      for (const material of materials) {
        if (
          material instanceof THREE.MeshStandardMaterial ||
          material instanceof THREE.MeshBasicMaterial
        ) {
          if ('emissive' in material) {
            material.emissive.copy(
              entity.id === this.selectedId
                ? SELECTED_EMISSIVE
                : entity.id === this.hoveredId
                  ? HOVER_EMISSIVE
                  : CLEAR_EMISSIVE,
            );
            material.emissiveIntensity =
              entity.id === this.selectedId || entity.id === this.hoveredId
                ? 0.72
                : 0.12;
          }
          if (entity.type === 'boundary' || entity.type === 'walkable-proxy') {
            const baseOpacity =
              entity.type === 'walkable-proxy' ? 0.7 : 0.95;
            material.opacity =
              entity.id === this.selectedId
                ? 1
                : entity.id === this.hoveredId
                  ? 0.98
                  : baseOpacity;
            if (material instanceof THREE.MeshBasicMaterial) {
              material.color.setHex(
                entity.id === this.hoveredId && entity.id !== this.selectedId
                  ? 0xffb23d
                  : entity.type === 'boundary'
                    ? 0xb8ff3d
                    : 0x8fb86a,
              );
            }
            continue;
          }
          material.opacity =
            entity.type === 'portal'
              ? entity.id === this.selectedId || entity.id === this.hoveredId
                ? 0.42
                : 0.08
              : entity.type === 'trim'
              ? entity.id === this.selectedId
                ? 0.58
                : 0.2
              : entity.id === this.selectedId
                ? 0.96
                : entity.type === 'room'
                  ? 0.16
                  : 0.88;
        }
      }
    }
  }

  private entityTransform(entity: EditorEntity): EntityTransform {
    if (entity.type === 'room') {
      const room = this.room(entity.dataId);
      if (room) {
        return {
          position: [...room.transform.position],
          rotation: [...room.transform.rotation],
          scale: [
            room.transform.scale,
            room.transform.scale,
            room.transform.scale,
          ],
        };
      }
    }
    if (entity.type === 'placement') {
      const placement = this.placement(entity.dataId);
      if (placement) {
        return {
          position: [...placement.position],
          rotation: [...placement.rotation],
          scale: [...placement.scale],
        };
      }
    }
    if (entity.type === 'cut') {
      const cut = this.cut(entity.dataId);
      if (cut) {
        return {
          position: [...cut.position],
          rotation: [...cut.rotation],
          scale: [...cut.size],
        };
      }
    }
    if (entity.type === 'trim') {
      const trim = this.trim(entity.dataId);
      if (trim) {
        return {
          position: [...trim.position],
          rotation: [...trim.rotation],
          scale: [1, 1, 1],
        };
      }
    }
    if (entity.type === 'portal') {
      const endpoints = this.portalEndpoints(entity.dataId);
      if (endpoints) {
        const center = endpoints.from.clone().lerp(endpoints.to, 0.5);
        return {
          position: [center.x, center.y, center.z],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        };
      }
    }
    return this.objectTransform(entity.object);
  }

  private objectTransform(object: THREE.Object3D): EntityTransform {
    return {
      position: [object.position.x, object.position.y, object.position.z],
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    };
  }

  private setObjectTransform(
    object: THREE.Object3D,
    transform: EntityTransform,
  ): void {
    object.position.set(...transform.position);
    object.rotation.set(...transform.rotation);
    object.scale.set(...transform.scale);
  }

  /**
   * Room inspector values are authored coordinates. Runtime room roots carry
   * an extra navigation Y calibration, so apply that offset exactly once at
   * the inspector-to-scene boundary.
   */
  private setEditorTransformOnObject(
    entity: EditorEntity,
    transform: EntityTransform,
  ): void {
    if (entity.type !== 'room') {
      this.setObjectTransform(entity.object, transform);
      return;
    }
    const calibration =
      this.options.navigationCalibrationByRoom.get(entity.dataId) ?? 0;
    entity.object.position.set(
      transform.position[0],
      transform.position[1] + calibration,
      transform.position[2],
    );
    entity.object.rotation.set(...transform.rotation);
    entity.object.scale.set(...transform.scale);
  }

  private room(id: string): SplatLayoutRoom | null {
    return this.data.layout.rooms.find((room) => room.id === id) ?? null;
  }

  private navigationMesh(roomId: string): SplatWorldNavigationMesh | null {
    const room = this.data.navigation.rooms.find(
      (entry) => entry.id === roomId,
    );
    if (!room) return null;
    return {
      vertices: room.navmesh.vertices,
      indices: room.navmesh.indices,
      boundaryEdges: room.navmesh.boundaryEdges,
      clearanceRadius: this.data.navigation.parameters.clearanceRadius,
      areaSquareMetres: room.navmesh.areaSquareMetres,
    };
  }

  private navigationCenter(room: SplatLayoutRoom): THREE.Vector2 {
    const navigationRoom = this.data.navigation.rooms.find(
      (entry) => entry.id === room.id,
    );
    if (!navigationRoom) {
      return new THREE.Vector2(
        room.transform.position[0],
        room.transform.position[2],
      );
    }
    return new THREE.Vector2(
      (navigationRoom.bounds.min[0] + navigationRoom.bounds.max[0]) * 0.5,
      (navigationRoom.bounds.min[2] + navigationRoom.bounds.max[2]) * 0.5,
    );
  }

  private socket(roomId: string, id: string) {
    return (
      this.room(roomId)?.doorwaySockets.find((socket) => socket.id === id) ??
      null
    );
  }

  /**
   * A zombie entry is one authored contract represented by a barrier prop, a
   * spawn marker, and three wall-crawl route points. Keep those records
   * together so moving either visible marker changes the route used in play.
   */
  private syncEntryPlacementPair(
    placement: ZombiesPlacementRecord,
    previousPosition: readonly [number, number, number],
  ): void {
    if (
      placement.kind !== 'barrier' &&
      placement.kind !== 'zombie-spawn'
    ) {
      return;
    }
    const spawnId =
      placement.kind === 'zombie-spawn'
        ? placement.id
        : placement.id.replace(/^barrier-/, 'sp-');
    const barrierId =
      placement.kind === 'barrier'
        ? placement.id
        : placement.id.replace(/^sp-/, 'barrier-');
    const pairedId =
      placement.kind === 'barrier' ? spawnId : barrierId;
    const delta: [number, number, number] = [
      placement.position[0] - previousPosition[0],
      0,
      placement.position[2] - previousPosition[2],
    ];
    const paired = this.placement(pairedId);
    if (paired) {
      paired.position = [
        paired.position[0] + delta[0],
        paired.position[1] + delta[1],
        paired.position[2] + delta[2],
      ];
      paired.roomId = placement.roomId;
      this.options.arena.setEditorPlacement(paired);
    }

    const room = this.room(placement.roomId);
    const wallCrawl = room?.wallCrawlSockets.find(
      (entry) => entry.id === spawnId && entry.barrierId === barrierId,
    );
    if (!room || !wallCrawl) return;
    const beforeLocal = this.socketLocalPoint(
      room,
      new THREE.Vector2(previousPosition[0], previousPosition[2]),
    );
    const afterLocal = this.socketLocalPoint(
      room,
      new THREE.Vector2(placement.position[0], placement.position[2]),
    );
    const localDelta = afterLocal.sub(beforeLocal);
    const movePoint = (point: readonly [number, number]) =>
      [point[0] + localDelta.x, point[1] + localDelta.y] as const;
    wallCrawl.outside = movePoint(wallCrawl.outside);
    wallCrawl.opening = movePoint(wallCrawl.opening);
    wallCrawl.landing = movePoint(wallCrawl.landing);
  }

  private placement(id: string): ZombiesPlacementRecord | null {
    return (
      this.data.placements.placements.find(
        (placement) => placement.id === id,
      ) ?? null
    );
  }


  private walkablePatch(id: string): SplatWalkablePatch | null {
    return (
      (this.data.layout.walkablePatches ?? []).find((patch) => patch.id === id) ??
      null
    );
  }

  private walkablePatchWorldPolygon(
    room: SplatLayoutRoom,
    patch: SplatWalkablePatch,
  ): THREE.Vector2[] {
    const ratio =
      room.transform.scale / Math.max(this.originalRoomScale(room.id), 1e-6);
    const cosine = Math.cos(room.transform.authoredYaw);
    const sine = Math.sin(room.transform.authoredYaw);
    return patch.polygon.map(
      ([x, z]) =>
        new THREE.Vector2(
          room.transform.position[0] + (x * cosine - z * sine) * ratio,
          room.transform.position[2] + (x * sine + z * cosine) * ratio,
        ),
    );
  }

  private cut(id: string): SplatCutVolume | null {
    return (
      (this.data.layout.cutVolumes ?? []).find((cut) => cut.id === id) ?? null
    );
  }

  private trim(id: string): SplatTrimPlane | null {
    return (
      (this.data.layout.trimPlanes ?? []).find((trim) => trim.id === id) ??
      null
    );
  }

  private originalRoomScale(roomId: string): number {
    const room = this.original.layout.rooms.find((entry) => entry.id === roomId);
    return room?.coverageReferenceScale ?? room?.transform.scale ?? 1;
  }

  private worldPolygon(room: SplatLayoutRoom): THREE.Vector2[] {
    const ratio =
      room.transform.scale / Math.max(this.originalRoomScale(room.id), 1e-6);
    const cosine = Math.cos(room.transform.authoredYaw);
    const sine = Math.sin(room.transform.authoredYaw);
    return room.coveragePolygon.map(
      ([x, z]) =>
        new THREE.Vector2(
          room.transform.position[0] +
            x * ratio * cosine -
            z * ratio * sine,
          room.transform.position[2] +
            x * ratio * sine +
            z * ratio * cosine,
        ),
    );
  }

  private socketWorldPoint(
    room: SplatLayoutRoom,
    point: readonly [number, number],
  ): THREE.Vector2 {
    const ratio =
      room.transform.scale / Math.max(this.originalRoomScale(room.id), 1e-6);
    const cosine = Math.cos(room.transform.authoredYaw);
    const sine = Math.sin(room.transform.authoredYaw);
    return new THREE.Vector2(
      room.transform.position[0] +
        point[0] * ratio * cosine -
        point[1] * ratio * sine,
      room.transform.position[2] +
        point[0] * ratio * sine +
        point[1] * ratio * cosine,
    );
  }

  private socketLocalPoint(
    room: SplatLayoutRoom,
    point: THREE.Vector2,
  ): THREE.Vector2 {
    const dx = point.x - room.transform.position[0];
    const dz = point.y - room.transform.position[2];
    const cosine = Math.cos(-room.transform.authoredYaw);
    const sine = Math.sin(-room.transform.authoredYaw);
    const ratio =
      room.transform.scale / Math.max(this.originalRoomScale(room.id), 1e-6);
    return new THREE.Vector2(
      (dx * cosine - dz * sine) / ratio,
      (dx * sine + dz * cosine) / ratio,
    );
  }

  private roomForPoint(
    point: [number, number, number],
    preferredRoomId?: string,
  ): SplatLayoutRoom | null {
    const ordered = preferredRoomId
      ? [
          ...this.data.layout.rooms.filter(
            (room) => room.id === preferredRoomId,
          ),
          ...this.data.layout.rooms.filter(
            (room) => room.id !== preferredRoomId,
          ),
        ]
      : this.data.layout.rooms;
    const xz = new THREE.Vector2(point[0], point[2]);
    let best: { room: SplatLayoutRoom; clearance: number } | null = null;
    for (const room of ordered) {
      const navigation = this.navigationMesh(room.id);
      if (!navigation) continue;
      const clearance = splatNavigationSignedDistanceXZ(navigation, xz);
      // Editor placement ownership is the same collider-derived surface used
      // by player containment. Edge-mounted props receive a tiny tolerance.
      if (clearance < -0.15) continue;
      if (room.id === preferredRoomId) return room;
      if (!best || clearance > best.clearance) best = { room, clearance };
    }
    return best?.room ?? null;
  }

  private portalEndpoints(portalId: string): {
    from: THREE.Vector3;
    to: THREE.Vector3;
  } | null {
    const portal = this.data.layout.portals.find(
      (entry) => entry.id === portalId,
    );
    if (!portal) return null;
    const fromRoom = this.room(portal.fromRoomId);
    const toRoom = this.room(portal.toRoomId);
    const fromSocket = this.socket(portal.fromRoomId, portal.fromSocketId);
    const toSocket = this.socket(portal.toRoomId, portal.toSocketId);
    if (!fromRoom || !toRoom || !fromSocket || !toSocket) return null;
    const from = this.socketWorldPoint(fromRoom, fromSocket.position);
    const to = this.socketWorldPoint(toRoom, toSocket.position);
    return {
      from: new THREE.Vector3(
        from.x,
        fromRoom.transform.position[1] - 1.5 + fromSocket.height * 0.5,
        from.y,
      ),
      to: new THREE.Vector3(
        to.x,
        toRoom.transform.position[1] - 1.5 + toSocket.height * 0.5,
        to.y,
      ),
    };
  }

  private syncDerivedPortalSockets(): void {
    const clip = (id: string | undefined) =>
      id ? this.cut(id) ?? this.trim(id) : null;
    for (const portal of this.data.layout.portals) {
      const fromRoom = this.room(portal.fromRoomId);
      const toRoom = this.room(portal.toRoomId);
      const fromSocket = this.socket(
        portal.fromRoomId,
        portal.fromSocketId,
      );
      const toSocket = this.socket(portal.toRoomId, portal.toSocketId);
      const fromClip = clip(portal.fromClipId);
      const toClip = clip(portal.toClipId);
      if (
        !fromRoom ||
        !toRoom ||
        !fromSocket ||
        !toSocket ||
        !fromClip ||
        !toClip
      ) {
        continue;
      }
      const fromWorld = new THREE.Vector2(
        fromClip.position[0],
        fromClip.position[2],
      );
      const toWorld = new THREE.Vector2(
        toClip.position[0],
        toClip.position[2],
      );
      const fromLocal = this.socketLocalPoint(fromRoom, fromWorld);
      const toLocal = this.socketLocalPoint(toRoom, toWorld);
      const fromYaw = Math.atan2(
        toWorld.x - fromWorld.x,
        toWorld.y - fromWorld.y,
      );
      const toYaw = Math.atan2(
        fromWorld.x - toWorld.x,
        fromWorld.y - toWorld.y,
      );
      fromSocket.position = [fromLocal.x, fromLocal.y];
      fromSocket.yaw = fromYaw - fromRoom.transform.authoredYaw;
      toSocket.position = [toLocal.x, toLocal.y];
      toSocket.yaw = toYaw - toRoom.transform.authoredYaw;
    }
  }

  private clearRoot(root: THREE.Object3D): void {
    while (root.children.length > 0) {
      const child = root.children[0]!;
      root.remove(child);
      this.disposeObject(child);
    }
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (
        !(
          object instanceof THREE.Mesh ||
          object instanceof THREE.Sprite ||
          object instanceof THREE.Line
        )
      ) {
        return;
      }
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.SpriteMaterial) material.map?.dispose();
        material.dispose();
      }
    });
  }

  private readonly onDraggingChanged = (event: { value?: unknown }): void => {
    const dragging = event.value === true;
    this.orbit.enabled = !dragging;
    if (dragging === this.transformInteractionActive) return;
    this.transformInteractionActive = dragging;
    this.applyRoomTransforms();
  };

  private readonly onTransformMouseDown = (): void => {
    this.dragBefore = this.snapshot();
  };

  private readonly onTransformChange = (): void => {
    if (!this.selectedId || !this.dragBefore) return;
    const entity = this.entities.get(this.selectedId);
    if (!entity?.editable) return;
    this.syncEntityFromObject(entity, this.dragBefore);
    if (entity.type === 'room') {
      // TransformControls changes the Three.js root first. Reapply the
      // canonical saved record immediately so the root and paged splat have
      // only one authoritative transform during the drag.
      const room = this.room(entity.dataId);
      if (room) this.applyRoomTransform(room);
    }
    if (
      entity.type === 'cut' ||
      entity.type === 'trim' ||
      entity.type === 'room'
    ) {
      this.applyCutVolumes();
    }
    for (const current of this.entities.values()) {
      if (current.id !== entity.id) this.applyEntityDataToObject(current);
    }
    if (entity.type === 'boundary') {
      this.updateBoundaryOutline();
    }
    this.rebuildNavigationGeometry();
    this.refresh(
      entity.type === 'boundary' && this.walkableDragMode === 'patch'
        ? 'Moving whole walkable patch…'
        : `Editing ${entity.label}…`,
    );
  };

  private readonly onTransformMouseUp = (): void => {
    // TransformControls normally emits dragging-changed(false) first, but
    // restore the full campus defensively for synthetic/test interactions.
    if (this.transformInteractionActive) {
      this.transformInteractionActive = false;
      this.applyRoomTransforms();
    }
    if (!this.selectedId || !this.dragBefore) return;
    const entity = this.entities.get(this.selectedId);
    const before = this.dragBefore;
    this.dragBefore = null;
    if (!entity) return;
    let pairNote: string | null = null;
    if (entity.type === 'cut') {
      pairNote = this.reconcileCutDoorwayLinks(entity.dataId);
      if (pairNote) {
        this.rebuildEntities();
        this.applyDataToScene();
      }
    }
    this.commit(`Transform ${entity.label}`, before);
    if (pairNote) {
      this.refresh(`${entity.label} // ${pairNote}`);
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.transform.axis) return;
    // Prefer screen-space corner hits while authoring walkables — top-down
    // views make tiny mesh raycasts unreliable.
    if (this.boundaryEditRoomId) {
      const nearby = this.collectWalkablePickCandidates(
        event.clientX,
        event.clientY,
      );
      if (nearby.length > 0) {
        this.applyWalkablePick(nearby[0]!);
        return;
      }
    }
    const id = this.pick(event);
    if (id) {
      const entity = this.entities.get(id);
      if (entity?.type === 'walkable-proxy') {
        this.applyWalkablePick(id);
        return;
      }
    }
    this.select(id);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.transform.dragging) return;
    if (this.boundaryEditRoomId) {
      const nearby = this.collectWalkablePickCandidates(
        event.clientX,
        event.clientY,
      );
      const next = nearby[0] ?? null;
      if (next === this.hoveredId) return;
      this.hoveredId = next;
      this.updateEntityMaterials();
      return;
    }
    const next = this.pick(event);
    if (next === this.hoveredId) return;
    this.hoveredId = next;
    this.updateEntityMaterials();
  };

  private entityPickable(entity: EditorEntity): boolean {
    if (!entity.object.visible || !entity.pickObject.visible) return false;
    if (entity.type === 'room') return this.overlays.navigation;
    if (entity.type === 'placement') return this.overlays.placements;
    if (entity.type === 'trim') return this.overlays.trims;
    if (entity.type === 'boundary' || entity.type === 'walkable-proxy') {
      return this.overlays.navigation || Boolean(this.boundaryEditRoomId);
    }
    if (entity.type === 'cut') return this.overlays.doorways;
    return this.overlays.doorways;
  }

  private pick(event: PointerEvent): string | null {
    const rect = this.options.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.options.camera);
    const pickables = [...this.entities.values()]
      .filter((entity) => this.entityPickable(entity))
      .map((entity) => entity.pickObject);
    const hit = this.raycaster.intersectObjects(pickables, false)[0];
    return hit
      ? (this.pickEntityByObject.get(hit.object) ??
          (hit.object.userData.editorEntityId as string | undefined) ??
          null)
      : null;
  }

  /** Nearest walkable corner(s) within a generous screen-pixel radius. */
  private collectWalkablePickCandidates(
    clientX: number,
    clientY: number,
  ): string[] {
    const rect = this.options.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const candidates: Array<{ id: string; dist: number }> = [];
    for (const entity of this.entities.values()) {
      if (entity.type !== 'boundary' && entity.type !== 'walkable-proxy') {
        continue;
      }
      if (!this.entityPickable(entity)) continue;
      entity.object.updateWorldMatrix(true, false);
      entity.object.getWorldPosition(this.walkableScreenPoint);
      this.walkableScreenPoint.project(this.options.camera);
      if (
        !Number.isFinite(this.walkableScreenPoint.x) ||
        !Number.isFinite(this.walkableScreenPoint.y) ||
        this.walkableScreenPoint.z < -1 ||
        this.walkableScreenPoint.z > 1
      ) {
        continue;
      }
      const sx = (this.walkableScreenPoint.x * 0.5 + 0.5) * rect.width;
      const sy = (-this.walkableScreenPoint.y * 0.5 + 0.5) * rect.height;
      const dist = Math.hypot(sx - mouseX, sy - mouseY);
      if (dist <= WALKABLE_PICK_SCREEN_PX) {
        candidates.push({ id: entity.id, dist });
      }
    }
    candidates.sort(
      (a, b) => a.dist - b.dist || a.id.localeCompare(b.id),
    );
    return candidates.map((entry) => entry.id);
  }

  private applyWalkablePick(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    if (entity.type === 'walkable-proxy') {
      const vertexMatch = /^vertex:(\d+)$/.exec(entity.mount);
      const pointIndex = vertexMatch ? Number(vertexMatch[1]) : 0;
      this.beginBoundaryEdit(entity.roomId, entity.dataId, pointIndex);
      return;
    }
    this.select(id);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const typingTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable === true;
    const transformField =
      target instanceof HTMLInputElement &&
      Boolean(target.dataset.editorField);
    const command = event.metaKey || event.ctrlKey;
    if (command && event.code === 'KeyS') {
      event.preventDefault();
      if (this.dirty && !this.saving && !this.playtesting) {
        void this.saveToProject();
      } else {
        this.refresh(this.dirty ? 'Save already in progress' : 'Project is already saved');
      }
      return;
    }
    if (
      command &&
      event.code === 'KeyZ' &&
      (!typingTarget || transformField)
    ) {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (
      command &&
      event.code === 'KeyY' &&
      (!typingTarget || transformField)
    ) {
      event.preventDefault();
      this.redo();
      return;
    }
    if (typingTarget) return;
    if (command && event.code === 'KeyC' && this.copySelectedClip()) {
      event.preventDefault();
      return;
    }
    if (command && event.code === 'KeyV' && this.pasteClipClipboard()) {
      event.preventDefault();
      return;
    }
    if (event.code === 'Backspace' || event.code === 'Delete') {
      event.preventDefault();
      // Shift+Backspace/Delete still removes a single walkable corner.
      if (
        event.shiftKey &&
        this.selectedId &&
        this.entities.get(this.selectedId)?.type === 'boundary'
      ) {
        this.deleteBoundaryPoint();
      } else {
        this.deleteSelectedEntity();
      }
      return;
    }
    if (event.code === 'KeyW') this.setTool('translate');
    else if (event.code === 'KeyE') this.setTool('rotate');
    else if (event.code === 'KeyR') this.setTool('scale');
    else if (event.code === 'KeyF') this.frameSelection();
    else if (event.code === 'Slash') {
      event.preventDefault();
      this.ui.focusSearch();
    } else if (event.code === 'Escape') {
      if (this.dragBefore) {
        this.restoreSnapshot(this.dragBefore);
        this.dragBefore = null;
        this.refresh('Transform cancelled');
      } else if (this.boundaryEditRoomId) {
        this.finishBoundaryEdit();
      } else {
        this.select(null);
      }
    }
  };

  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.dirty) return;
    event.preventDefault();
  };
}
