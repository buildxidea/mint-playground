import * as THREE from 'three';
import layoutJson from '../assets/zombies-splat-layout.json' with { type: 'json' };
import navigationJson from '../assets/zombies-splat-navigation.json' with { type: 'json' };
import {
  CUT_FLOOR_BOTTOM_MAX_OFFSET,
  CUT_FLOOR_BOTTOM_MIN_OFFSET,
  MAX_SPLAT_CUT_VOLUMES,
  cutFloorBottomClearance,
  roomFloorY,
  type SplatCutVolume,
} from './SplatCutVolume';
import {
  appendWorldPolygonToNavigation,
  clipNavigationMeshByCuts,
  pointRejectedByTrimPlanes,
} from './clipNavigationByCuts';
import {
  appendCutDoorwayAperturesToNavigation,
  normalizeOverlappingDoorwayCuts,
  pointInsideAnyCutDoorwayAperture,
} from './splatDoorwayAperture';
import {
  MAX_SPLAT_TRIM_PLANES,
  prepareSplatTrimPlanes,
  type PreparedSplatTrimPlane,
  type SplatTrimPlane,
} from './SplatTrimPlane';

export type SplatPoint2 = readonly [number, number];
export type SplatTransform = {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: number;
  authoredYaw: number;
};

export type SplatDoorwaySocket = {
  id: string;
  derivedFromClipId?: string;
  position: SplatPoint2;
  yaw: number;
  width: number;
  height: number;
  coverageDepth: number;
  visualState: 'open' | 'closed-wall' | 'sparse-fringe' | 'unaudited';
  verifiedTraversable: boolean;
  evidence: string;
};

export type SplatWallCrawlSocket = {
  id: string;
  barrierId: string;
  outside: SplatPoint2;
  opening: SplatPoint2;
  landing: SplatPoint2;
  landingRadius: number;
  yaw: number;
};

export type SplatLayoutRoom = {
  id: string;
  assetId: string;
  radDigest: string;
  colliderDigest: string;
  transform: SplatTransform;
  coverageReferenceScale?: number;
  coveragePolygon: SplatPoint2[];
  minPlayableHeight: number;
  maxPlayableHeight: number;
  safeInset: number;
  anchor: SplatPoint2;
  doorwaySockets: SplatDoorwaySocket[];
  wallCrawlSockets: SplatWallCrawlSocket[];
};

export type SplatLayoutConnector = {
  id: string;
  assetId: string;
  transform: SplatTransform;
  coverageReferenceScale?: number;
  coveragePolygon: SplatPoint2[];
  minPlayableHeight: number;
  maxPlayableHeight: number;
  safeInset: number;
};

export type SplatLayoutPortal = {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  fromSocketId: string;
  toSocketId: string;
  fromClipId?: string;
  toClipId?: string;
  connectorId?: string;
  traversalPolygon: SplatPoint2[];
  transitionPolygon: SplatPoint2[];
  width: number;
  enabled: boolean;
  residency: {
    requiredAssetIds: string[];
    minimumActiveSplats: number;
  };
};

/** Local-space XZ polygon that extends the collider bake into door gaps. */
export type SplatWalkablePatch = {
  id: string;
  roomId: string;
  polygon: SplatPoint2[];
};

export type SplatLayoutAsset = {
  version: number;
  status: string;
  coordinateSpace: string;
  startRoomId: string;
  requiredRoomIds: string[];
  largestActorCapsuleRadius: number;
  portalSafetyMargin: number;
  rooms: SplatLayoutRoom[];
  connectors: SplatLayoutConnector[];
  cutVolumes: SplatCutVolume[];
  trimPlanes: SplatTrimPlane[];
  /** Authored walkable extensions (door bridges) applied on top of the bake. */
  walkablePatches?: SplatWalkablePatch[];
  portals: SplatLayoutPortal[];
  blockedRoutes: Array<{
    id: string;
    fromRoomId: string;
    toRoomId: string;
    reason: string;
    requiredAsset: string;
  }>;
};

export type SplatLayoutValidation = {
  runtimeSafe: boolean;
  releaseReady: boolean;
  errors: string[];
  warnings: string[];
  reachableRoomIds: string[];
  isolatedRoomIds: string[];
  enabledPortalIds: string[];
  /** Cut/trim doorway pair ids (shared portalId metadata) that connect two rooms. */
  doorwayIds: string[];
  blockedRoutes: SplatLayoutAsset['blockedRoutes'];
};

export type SplatDoorwayPair = {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  fromClipId: string;
  toClipId: string;
};

export type SplatWorldRoom = {
  source: SplatLayoutRoom;
  polygon: THREE.Vector2[];
  navigation: SplatWorldNavigationMesh | null;
  navigationCalibrationY: number;
  anchor: THREE.Vector3;
  bounds: THREE.Box3;
  floorY: number;
};

export type SplatWorldConnector = {
  source: SplatLayoutConnector;
  polygon: THREE.Vector2[];
  bounds: THREE.Box3;
  floorY: number;
};

export type SplatWorldNavigationMesh = {
  vertices: number[];
  indices: number[];
  boundaryEdges: number[];
  clearanceRadius: number;
  areaSquareMetres: number;
};

type SplatNavigationQueryGrid = {
  cellSize: number;
  minimumX: number;
  minimumZ: number;
  columns: number;
  rows: number;
  triangleOffsetsByCell: number[][];
  boundaryInteriorPoints: THREE.Vector3[];
};

export type SplatWorldPortal = {
  source: SplatLayoutPortal;
  traversalPolygon: THREE.Vector2[];
  transitionPolygon: THREE.Vector2[];
  from: THREE.Vector3;
  to: THREE.Vector3;
};

export type SplatMovementResolution = {
  position: THREE.Vector3;
  roomId: string | null;
  portalId: string | null;
  signedDistance: number;
  constrained: boolean;
};

const rawLayout = layoutJson as unknown as SplatLayoutAsset;
type SplatNavigationBakeRoom = {
  id: string;
  assetId: string;
  colliderDigest: string;
  colliderDigestHint: string;
  transform: SplatTransform;
  navigationCalibration: {
    sampledColliderFloorY: number;
    authoredFloorY: number;
    deltaY: number;
    sampleCount: number;
    rejectedSampleCount: number;
    maximumDeviation: number;
  };
  layoutInput: {
    transform: SplatTransform;
    coveragePolygon: SplatPoint2[];
    minPlayableHeight: number;
    maxPlayableHeight: number;
    safeInset: number;
    anchor: SplatPoint2;
    /** Enabled cut/trim fingerprint; omitted on legacy bakes. */
    clipFingerprint?: string;
  };
  anchor: [number, number, number];
  authoredAnchor: [number, number, number];
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  navmesh: {
    vertices: number[];
    indices: number[];
    boundaryEdges: number[];
    areaSquareMetres: number;
  };
};
export type SplatNavigationBakeAsset = {
  version: number;
  coordinateSpace: string;
  sourceMode: string;
  parameters: {
    clearanceRadius: number;
  };
  rooms: SplatNavigationBakeRoom[];
};
const rawNavigation = navigationJson as unknown as SplatNavigationBakeAsset;

/**
 * Updates the module-scoped splat layout/navigation imports in place so a
 * successful editor save is visible to gameplay without a full page reload.
 * Preserves object identity for the JSON module bindings.
 */
export function syncZombiesSplatModuleAssets(
  layout: SplatLayoutAsset,
  navigation: SplatNavigationBakeAsset,
): void {
  const nextLayout = structuredClone(layout) as SplatLayoutAsset;
  rawLayout.version = nextLayout.version;
  rawLayout.status = nextLayout.status;
  rawLayout.coordinateSpace = nextLayout.coordinateSpace;
  rawLayout.startRoomId = nextLayout.startRoomId;
  rawLayout.requiredRoomIds = nextLayout.requiredRoomIds;
  rawLayout.largestActorCapsuleRadius = nextLayout.largestActorCapsuleRadius;
  rawLayout.portalSafetyMargin = nextLayout.portalSafetyMargin;
  rawLayout.rooms = nextLayout.rooms;
  rawLayout.connectors = nextLayout.connectors;
  rawLayout.cutVolumes = nextLayout.cutVolumes ?? [];
  rawLayout.trimPlanes = nextLayout.trimPlanes ?? [];
  rawLayout.walkablePatches = nextLayout.walkablePatches ?? [];
  rawLayout.portals = nextLayout.portals;
  rawLayout.blockedRoutes = nextLayout.blockedRoutes;

  const nextNavigation = structuredClone(navigation) as SplatNavigationBakeAsset;
  rawNavigation.version = nextNavigation.version;
  rawNavigation.coordinateSpace = nextNavigation.coordinateSpace;
  rawNavigation.sourceMode = nextNavigation.sourceMode;
  rawNavigation.parameters = nextNavigation.parameters;
  rawNavigation.rooms = nextNavigation.rooms;
}
const EPSILON = 1e-6;
// Landing ownership needs enough nav clearance to survive two maximum sprint
// steps. The bake already includes the largest capsule radius, so this guard
// is added to the authored portal margin when selecting a stable handoff.
const PORTAL_LANDING_FIXED_STEP_GUARD = 0.24;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function bakeMatchesRoom(
  baked: SplatNavigationBakeRoom | undefined,
  source: SplatLayoutRoom,
): baked is SplatNavigationBakeRoom {
  // clipFingerprint is bookkeeping for editor/save; playable clipping is
  // applied at load from the live layout, so it must not invalidate the bake.
  const bakedLayoutInput = baked?.layoutInput
    ? {
        transform: baked.layoutInput.transform,
        coveragePolygon: baked.layoutInput.coveragePolygon,
        minPlayableHeight: baked.layoutInput.minPlayableHeight,
        maxPlayableHeight: baked.layoutInput.maxPlayableHeight,
        safeInset: baked.layoutInput.safeInset,
        anchor: baked.layoutInput.anchor,
      }
    : null;
  return Boolean(
    baked &&
      baked.assetId === source.assetId &&
      baked.colliderDigestHint === source.colliderDigest &&
      baked.colliderDigest.startsWith(source.colliderDigest) &&
      sameJson(baked.transform, source.transform) &&
      sameJson(bakedLayoutInput, {
        transform: source.transform,
        coveragePolygon: source.coveragePolygon,
        minPlayableHeight: source.minPlayableHeight,
        maxPlayableHeight: source.maxPlayableHeight,
        safeInset: source.safeInset,
        anchor: source.anchor,
      }) &&
      Number.isFinite(baked.navigationCalibration.deltaY) &&
      Math.abs(baked.navigationCalibration.deltaY) <= 8 &&
      baked.navigationCalibration.sampleCount >= 5 &&
      baked.navigationCalibration.maximumDeviation <= 0.75,
  );
}

function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const a = polygon[current]!;
    const b = polygon[previous]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  point: THREE.Vector2,
  start: THREE.Vector2,
  end: THREE.Vector2,
): number {
  const edge = end.clone().sub(start);
  const lengthSq = edge.lengthSq();
  if (lengthSq <= EPSILON) return point.distanceTo(start);
  const t = THREE.MathUtils.clamp(
    point.clone().sub(start).dot(edge) / lengthSq,
    0,
    1,
  );
  return point.distanceTo(start.clone().addScaledVector(edge, t));
}

function signedDistanceToPolygon(
  point: THREE.Vector2,
  polygon: THREE.Vector2[],
): number {
  if (polygon.length < 3) return Number.NEGATIVE_INFINITY;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(
      distance,
      distanceToSegment(
        point,
        polygon[index]!,
        polygon[(index + 1) % polygon.length]!,
      ),
    );
  }
  return pointInPolygon(point, polygon) ? distance : -distance;
}

function polygonArea(polygon: SplatPoint2[]): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

function isFinitePoint(point: SplatPoint2): boolean {
  return point.length === 2 && point.every(Number.isFinite);
}

function pointOnSegment(
  point: SplatPoint2,
  start: SplatPoint2,
  end: SplatPoint2,
): boolean {
  const cross =
    (point[0] - start[0]) * (end[1] - start[1]) -
    (point[1] - start[1]) * (end[0] - start[0]);
  if (Math.abs(cross) > EPSILON) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON
  );
}

function segmentsIntersect(
  a: SplatPoint2,
  b: SplatPoint2,
  c: SplatPoint2,
  d: SplatPoint2,
): boolean {
  const orientation = (
    start: SplatPoint2,
    end: SplatPoint2,
    point: SplatPoint2,
  ) =>
    (end[0] - start[0]) * (point[1] - start[1]) -
    (end[1] - start[1]) * (point[0] - start[0]);
  const abc = orientation(a, b, c);
  const abd = orientation(a, b, d);
  const cda = orientation(c, d, a);
  const cdb = orientation(c, d, b);
  if (
    ((abc > EPSILON && abd < -EPSILON) ||
      (abc < -EPSILON && abd > EPSILON)) &&
    ((cda > EPSILON && cdb < -EPSILON) ||
      (cda < -EPSILON && cdb > EPSILON))
  ) {
    return true;
  }
  return (
    (Math.abs(abc) <= EPSILON && pointOnSegment(c, a, b)) ||
    (Math.abs(abd) <= EPSILON && pointOnSegment(d, a, b)) ||
    (Math.abs(cda) <= EPSILON && pointOnSegment(a, c, d)) ||
    (Math.abs(cdb) <= EPSILON && pointOnSegment(b, c, d))
  );
}

function polygonSelfIntersects(polygon: SplatPoint2[]): boolean {
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first
      ) {
        continue;
      }
      if (
        segmentsIntersect(
          polygon[first]!,
          polygon[firstNext]!,
          polygon[second]!,
          polygon[secondNext]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function localPointToWorld(
  point: SplatPoint2,
  transform: SplatTransform,
  referenceScale = transform.scale,
): THREE.Vector2 {
  const scale = transform.scale / Math.max(referenceScale, EPSILON);
  const cosine = Math.cos(transform.authoredYaw);
  const sine = Math.sin(transform.authoredYaw);
  return new THREE.Vector2(
    transform.position[0] +
      point[0] * scale * cosine -
      point[1] * scale * sine,
    transform.position[2] +
      point[0] * scale * sine +
      point[1] * scale * cosine,
  );
}

function worldPolygon(
  polygon: SplatPoint2[],
  transform: SplatTransform,
  referenceScale = transform.scale,
): THREE.Vector2[] {
  return polygon.map((point) =>
    localPointToWorld(point, transform, referenceScale),
  );
}

function polygonBounds(
  polygon: THREE.Vector2[],
  minY: number,
  maxY: number,
): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const point of polygon) {
    bounds.expandByPoint(new THREE.Vector3(point.x, minY, point.y));
    bounds.expandByPoint(new THREE.Vector3(point.x, maxY, point.y));
  }
  return bounds;
}

function pointInTriangleXZCoordinates(
  pointX: number,
  pointZ: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const v0x = cx - ax;
  const v0z = cz - az;
  const v1x = bx - ax;
  const v1z = bz - az;
  const v2x = pointX - ax;
  const v2z = pointZ - az;
  const dot00 = v0x * v0x + v0z * v0z;
  const dot01 = v0x * v1x + v0z * v1z;
  const dot02 = v0x * v2x + v0z * v2z;
  const dot11 = v1x * v1x + v1z * v1z;
  const dot12 = v1x * v2x + v1z * v2z;
  const denominator = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denominator) <= EPSILON) return false;
  const inverse = 1 / denominator;
  const u = (dot11 * dot02 - dot01 * dot12) * inverse;
  const v = (dot00 * dot12 - dot01 * dot02) * inverse;
  return u >= -EPSILON && v >= -EPSILON && u + v <= 1 + EPSILON;
}

function buildNavigationQueryGrid(
  navigation: SplatWorldNavigationMesh,
): SplatNavigationQueryGrid {
  const bounds = navigationBounds(
    navigation,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  const cellSize = 3;
  const columns = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / cellSize));
  const triangleOffsetsByCell = Array.from(
    { length: columns * rows },
    () => [] as number[],
  );
  const triangleOffsetByEdge = new Map<string, number>();
  const cellX = (value: number): number =>
    THREE.MathUtils.clamp(
      Math.floor((value - bounds.min.x) / cellSize),
      0,
      columns - 1,
    );
  const cellZ = (value: number): number =>
    THREE.MathUtils.clamp(
      Math.floor((value - bounds.min.z) / cellSize),
      0,
      rows - 1,
    );
  for (let offset = 0; offset < navigation.indices.length; offset += 3) {
    const aOffset = navigation.indices[offset]! * 3;
    const bOffset = navigation.indices[offset + 1]! * 3;
    const cOffset = navigation.indices[offset + 2]! * 3;
    const triangle = navigation.indices.slice(offset, offset + 3);
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge]!;
      const b = triangle[(edge + 1) % 3]!;
      triangleOffsetByEdge.set(a < b ? `${a}:${b}` : `${b}:${a}`, offset);
    }
    const minimumX = Math.min(
      navigation.vertices[aOffset]!,
      navigation.vertices[bOffset]!,
      navigation.vertices[cOffset]!,
    );
    const maximumX = Math.max(
      navigation.vertices[aOffset]!,
      navigation.vertices[bOffset]!,
      navigation.vertices[cOffset]!,
    );
    const minimumZ = Math.min(
      navigation.vertices[aOffset + 2]!,
      navigation.vertices[bOffset + 2]!,
      navigation.vertices[cOffset + 2]!,
    );
    const maximumZ = Math.max(
      navigation.vertices[aOffset + 2]!,
      navigation.vertices[bOffset + 2]!,
      navigation.vertices[cOffset + 2]!,
    );
    for (let z = cellZ(minimumZ); z <= cellZ(maximumZ); z += 1) {
      for (let x = cellX(minimumX); x <= cellX(maximumX); x += 1) {
        triangleOffsetsByCell[z * columns + x]!.push(offset);
      }
    }
  }
  const boundaryInteriorPoints: THREE.Vector3[] = [];
  for (let offset = 0; offset < navigation.boundaryEdges.length; offset += 2) {
    const a = navigation.boundaryEdges[offset]!;
    const b = navigation.boundaryEdges[offset + 1]!;
    const triangleOffset = triangleOffsetByEdge.get(
      a < b ? `${a}:${b}` : `${b}:${a}`,
    );
    if (triangleOffset === undefined) continue;
    const point = new THREE.Vector3();
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexOffset =
        navigation.indices[triangleOffset + corner]! * 3;
      point.x += navigation.vertices[vertexOffset]!;
      point.y += navigation.vertices[vertexOffset + 1]!;
      point.z += navigation.vertices[vertexOffset + 2]!;
    }
    boundaryInteriorPoints.push(point.multiplyScalar(1 / 3));
  }
  return {
    cellSize,
    minimumX: bounds.min.x,
    minimumZ: bounds.min.z,
    columns,
    rows,
    triangleOffsetsByCell,
    boundaryInteriorPoints,
  };
}

function navigationContainsXZ(
  navigation: SplatWorldNavigationMesh,
  point: THREE.Vector2,
  query?: SplatNavigationQueryGrid,
): boolean {
  let offsets: Iterable<number>;
  if (query) {
    const x = Math.floor((point.x - query.minimumX) / query.cellSize);
    const z = Math.floor((point.y - query.minimumZ) / query.cellSize);
    if (x < 0 || x >= query.columns || z < 0 || z >= query.rows) return false;
    offsets = query.triangleOffsetsByCell[z * query.columns + x]!;
  } else {
    offsets = Array.from(
      { length: Math.floor(navigation.indices.length / 3) },
      (_, index) => index * 3,
    );
  }
  for (const offset of offsets) {
    const aOffset = navigation.indices[offset]! * 3;
    const bOffset = navigation.indices[offset + 1]! * 3;
    const cOffset = navigation.indices[offset + 2]! * 3;
    if (
      pointInTriangleXZCoordinates(
        point.x,
        point.y,
        navigation.vertices[aOffset]!,
        navigation.vertices[aOffset + 2]!,
        navigation.vertices[bOffset]!,
        navigation.vertices[bOffset + 2]!,
        navigation.vertices[cOffset]!,
        navigation.vertices[cOffset + 2]!,
      )
    ) {
      return true;
    }
  }
  return false;
}

function navigationReachableSupportPoint(
  navigation: SplatWorldNavigationMesh,
  anchor: THREE.Vector3,
  target: THREE.Vector2,
  leadInDistance = 5,
): THREE.Vector3 {
  const centroids: THREE.Vector3[] = [];
  const triangleCount = Math.floor(navigation.indices.length / 3);
  const adjacency = Array.from(
    { length: triangleCount },
    () => new Set<number>(),
  );
  const trianglesByEdge = new Map<string, number[]>();
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
    if (
      pointInTriangleXZCoordinates(
        anchor.x,
        anchor.z,
        points[0]!.x,
        points[0]!.z,
        points[1]!.x,
        points[1]!.z,
        points[2]!.x,
        points[2]!.z,
      )
    ) {
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
  if (start < 0) {
    return new THREE.Vector3(target.x, anchor.y - 0.98, target.y);
  }
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
  let supportDistance = Math.hypot(
    support.x - target.x,
    support.z - target.y,
  );
  for (let index = 0; index < centroids.length; index += 1) {
    if (!reachable[index]) continue;
    const candidate = centroids[index]!;
    const distance = Math.hypot(
      candidate.x - target.x,
      candidate.z - target.y,
    );
    if (distance < supportDistance) {
      support = candidate;
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

type SplatNavigationGraph = {
  centroids: THREE.Vector3[];
  adjacency: number[][];
};

const navigationGraphs = new WeakMap<
  SplatWorldNavigationMesh,
  SplatNavigationGraph
>();

function navigationGraphFor(
  navigation: SplatWorldNavigationMesh,
): SplatNavigationGraph {
  const cached = navigationGraphs.get(navigation);
  if (cached) return cached;
  const triangleCount = Math.floor(navigation.indices.length / 3);
  const centroids: THREE.Vector3[] = [];
  const adjacency = Array.from({ length: triangleCount }, () => [] as number[]);
  const trianglesByEdge = new Map<string, number[]>();
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
    centroids.push(
      points
        .reduce((sum, point) => sum.add(point), new THREE.Vector3())
        .multiplyScalar(1 / 3),
    );
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
        if (first === second) continue;
        if (!adjacency[first]!.includes(second)) {
          adjacency[first]!.push(second);
        }
      }
    }
  }
  const graph = { centroids, adjacency };
  navigationGraphs.set(navigation, graph);
  return graph;
}

function navigationNearestTriangle(
  navigation: SplatWorldNavigationMesh,
  graph: SplatNavigationGraph,
  point: THREE.Vector2,
  hint?: THREE.Vector3,
): number {
  let containing = -1;
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const hintPoint = hint ?? new THREE.Vector3(point.x, 0, point.y);
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
    if (
      pointInTriangleXZCoordinates(
        point.x,
        point.y,
        points[0]!.x,
        points[0]!.z,
        points[1]!.x,
        points[1]!.z,
        points[2]!.x,
        points[2]!.z,
      )
    ) {
      containing = triangleIndex;
      break;
    }
    const centroid = graph.centroids[triangleIndex]!;
    const distance = centroid.distanceToSquared(hintPoint);
    if (distance < nearestDistance) {
      nearest = triangleIndex;
      nearestDistance = distance;
    }
  }
  return containing >= 0 ? containing : nearest;
}

function navigationPathPoints(
  navigation: SplatWorldNavigationMesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
): THREE.Vector3[] | null {
  const graph = navigationGraphFor(navigation);
  const startIndex = navigationNearestTriangle(
    navigation,
    graph,
    new THREE.Vector2(start.x, start.z),
    start,
  );
  const endIndex = navigationNearestTriangle(
    navigation,
    graph,
    new THREE.Vector2(end.x, end.z),
    end,
  );
  if (startIndex < 0 || endIndex < 0) return null;
  if (startIndex === endIndex) {
    return [end.clone()];
  }
  const previous = new Int32Array(graph.centroids.length).fill(-1);
  const queue = [startIndex];
  previous[startIndex] = startIndex;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (current === endIndex) break;
    for (const neighbor of graph.adjacency[current]!) {
      if (previous[neighbor] >= 0) continue;
      previous[neighbor] = current;
      queue.push(neighbor);
    }
  }
  if (previous[endIndex] < 0) return null;
  const trianglePath: number[] = [];
  let cursor = endIndex;
  while (cursor !== startIndex) {
    trianglePath.push(cursor);
    cursor = previous[cursor]!;
  }
  trianglePath.reverse();
  const waypoints: THREE.Vector3[] = [];
  for (const triangleIndex of trianglePath) {
    const centroid = graph.centroids[triangleIndex]!;
    if (
      waypoints.length > 0 &&
      Math.hypot(
        centroid.x - waypoints[waypoints.length - 1]!.x,
        centroid.z - waypoints[waypoints.length - 1]!.z,
      ) < 0.45
    ) {
      continue;
    }
    waypoints.push(centroid.clone());
  }
  const last = waypoints[waypoints.length - 1];
  if (
    !last ||
    Math.hypot(last.x - end.x, last.z - end.z) > 0.12
  ) {
    waypoints.push(end.clone());
  } else {
    last.copy(end);
  }
  return waypoints;
}

function navigationBoundaryDistance(
  navigation: SplatWorldNavigationMesh,
  point: THREE.Vector2,
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < navigation.boundaryEdges.length; offset += 2) {
    const aOffset = navigation.boundaryEdges[offset]! * 3;
    const bOffset = navigation.boundaryEdges[offset + 1]! * 3;
    const ax = navigation.vertices[aOffset]!;
    const az = navigation.vertices[aOffset + 2]!;
    const bx = navigation.vertices[bOffset]!;
    const bz = navigation.vertices[bOffset + 2]!;
    const edgeX = bx - ax;
    const edgeZ = bz - az;
    const lengthSquared = edgeX * edgeX + edgeZ * edgeZ;
    const t =
      lengthSquared <= EPSILON
        ? 0
        : THREE.MathUtils.clamp(
            ((point.x - ax) * edgeX + (point.y - az) * edgeZ) /
              lengthSquared,
            0,
            1,
          );
    const dx = point.x - (ax + edgeX * t);
    const dz = point.y - (az + edgeZ * t);
    distance = Math.min(
      distance,
      Math.hypot(dx, dz),
    );
  }
  return distance;
}

/**
 * Editor/runtime placement query against the baked collider-derived surface.
 * Positive values are inside the navigation mesh, negative values are outside.
 */
export function splatNavigationSignedDistanceXZ(
  navigation: SplatWorldNavigationMesh,
  point: THREE.Vector2,
): number {
  const boundaryDistance = navigationBoundaryDistance(navigation, point);
  return navigationContainsXZ(navigation, point)
    ? boundaryDistance
    : -boundaryDistance;
}

function navigationBounds(
  navigation: SplatWorldNavigationMesh,
  minimumY: number,
  maximumY: number,
): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (let offset = 0; offset < navigation.vertices.length; offset += 3) {
    bounds.expandByPoint(
      new THREE.Vector3(
        navigation.vertices[offset]!,
        navigation.vertices[offset + 1]!,
        navigation.vertices[offset + 2]!,
      ),
    );
  }
  bounds.min.y = minimumY;
  bounds.max.y = maximumY;
  return bounds;
}

export function validateSplatLayout(
  layout: SplatLayoutAsset,
  options?: { mode?: 'campus' | 'single-room' },
): SplatLayoutValidation {
  const mode = options?.mode ?? 'campus';
  const errors: string[] = [];
  const warnings: string[] = [];
  const roomIds = new Set<string>();
  const assetIds = new Set<string>();
  const requiredIds = new Set(layout.requiredRoomIds);

  if (layout.version !== 1) errors.push(`Unsupported layout version ${layout.version}`);
  if (mode === 'campus' && layout.requiredRoomIds.length !== 6) {
    errors.push(`Expected exactly six required rooms, got ${layout.requiredRoomIds.length}`);
  }
  if (mode === 'single-room' && layout.requiredRoomIds.length !== 1) {
    errors.push(
      `Expected exactly one required room for single-room mode, got ${layout.requiredRoomIds.length}`,
    );
  }

  for (const room of layout.rooms) {
    if (roomIds.has(room.id)) errors.push(`Duplicate room id ${room.id}`);
    roomIds.add(room.id);
    if (assetIds.has(room.assetId)) errors.push(`Duplicate room asset id ${room.assetId}`);
    assetIds.add(room.assetId);
    if (room.assetId !== room.id) {
      errors.push(`${room.id} asset id does not match its registered RAD id`);
    }
    if (
      room.coverageReferenceScale !== undefined &&
      (!Number.isFinite(room.coverageReferenceScale) ||
        room.coverageReferenceScale <= 0)
    ) {
      errors.push(`${room.id} coverage reference scale is invalid`);
    }
    if (room.coveragePolygon.length < 3) {
      errors.push(`${room.id} coverage polygon has fewer than three points`);
    } else if (
      !room.coveragePolygon.every(isFinitePoint) ||
      Math.abs(polygonArea(room.coveragePolygon)) < 0.01
    ) {
      errors.push(`${room.id} coverage polygon is invalid`);
    } else if (polygonSelfIntersects(room.coveragePolygon)) {
      errors.push(`${room.id} coverage polygon self-intersects`);
    }
    if (
      !Number.isFinite(room.minPlayableHeight) ||
      !Number.isFinite(room.maxPlayableHeight) ||
      room.minPlayableHeight >= room.maxPlayableHeight
    ) {
      errors.push(`${room.id} playable height range is invalid`);
    }
    if (room.safeInset < layout.largestActorCapsuleRadius) {
      errors.push(`${room.id} safe inset is smaller than the largest actor capsule`);
    }
    const localPolygon = room.coveragePolygon.map(
      ([x, z]) => new THREE.Vector2(x, z),
    );
    for (const socket of room.wallCrawlSockets) {
      if (
        !isFinitePoint(socket.outside) ||
        !isFinitePoint(socket.opening) ||
        !isFinitePoint(socket.landing) ||
        !Number.isFinite(socket.landingRadius) ||
        socket.landingRadius <= 0
      ) {
        errors.push(`${room.id}/${socket.id} has an invalid wall-entry route`);
        continue;
      }
      const landingDistance = signedDistanceToPolygon(
        new THREE.Vector2(socket.landing[0], socket.landing[1]),
        localPolygon,
      );
      if (
        landingDistance <
        socket.landingRadius + layout.portalSafetyMargin
      ) {
        errors.push(
          `${room.id}/${socket.id} landing capsule is outside safe coverage`,
        );
      }
    }
  }

  for (const requiredId of requiredIds) {
    if (!roomIds.has(requiredId)) errors.push(`Missing required room ${requiredId}`);
  }
  if (!roomIds.has(layout.startRoomId)) {
    errors.push(`Missing start room ${layout.startRoomId}`);
  }

  for (const connector of layout.connectors) {
    if (
      connector.coverageReferenceScale !== undefined &&
      (!Number.isFinite(connector.coverageReferenceScale) ||
        connector.coverageReferenceScale <= 0)
    ) {
      errors.push(`${connector.id} connector coverage reference scale is invalid`);
    }
    if (connector.coveragePolygon.length < 3) {
      errors.push(`${connector.id} connector polygon has fewer than three points`);
    } else if (
      !connector.coveragePolygon.every(isFinitePoint) ||
      Math.abs(polygonArea(connector.coveragePolygon)) < 0.01
    ) {
      errors.push(`${connector.id} connector polygon is invalid`);
    }
    if (connector.safeInset < 0) {
      errors.push(`${connector.id} connector safe inset is invalid`);
    }
  }

  const cutVolumes = layout.cutVolumes ?? [];
  if (cutVolumes.length > MAX_SPLAT_CUT_VOLUMES) {
    errors.push(
      `Cut volume count ${cutVolumes.length} exceeds ${MAX_SPLAT_CUT_VOLUMES}`,
    );
  }

  const trimPlanes = layout.trimPlanes ?? [];
  if (trimPlanes.length > MAX_SPLAT_TRIM_PLANES) {
    errors.push(
      `Trim plane count ${trimPlanes.length} exceeds ${MAX_SPLAT_TRIM_PLANES}`,
    );
  }
  const trimIds = new Set<string>();
  for (const trim of trimPlanes) {
    if (!trim.id || trimIds.has(trim.id)) {
      errors.push(`Duplicate or empty trim plane id ${trim.id}`);
    }
    trimIds.add(trim.id);
    if (!layout.rooms.some((room) => room.id === trim.roomId)) {
      errors.push(`${trim.id} references missing room ${trim.roomId}`);
    }
    if (
      trim.position.length !== 3 ||
      trim.rotation.length !== 3 ||
      ![...trim.position, ...trim.rotation].every(Number.isFinite)
    ) {
      errors.push(`${trim.id} has an invalid transform`);
    }
    if (trim.keepSide !== 'positive' && trim.keepSide !== 'negative') {
      errors.push(`${trim.id} has an invalid keep side`);
    }
    if (
      trim.portalId &&
      !layout.portals.some(
        (portal) =>
          portal.id === trim.portalId &&
          (portal.fromRoomId === trim.roomId ||
            portal.toRoomId === trim.roomId),
      )
    ) {
      errors.push(`${trim.id} references an incompatible doorway link`);
    }
  }
  const cutIds = new Set<string>();
  for (const cut of cutVolumes) {
    if (!cut.id || cutIds.has(cut.id)) {
      errors.push(`Duplicate or empty cut volume id ${cut.id}`);
    }
    cutIds.add(cut.id);
    const room = layout.rooms.find((entry) => entry.id === cut.roomId);
    if (!room) {
      errors.push(`${cut.id} references missing room ${cut.roomId}`);
      continue;
    }
    if (
      cut.position.length !== 3 ||
      cut.rotation.length !== 3 ||
      cut.size.length !== 3 ||
      ![...cut.position, ...cut.rotation, ...cut.size].every(Number.isFinite)
    ) {
      errors.push(`${cut.id} has an invalid transform`);
      continue;
    }
    if (cut.size[0] < 0.9 || cut.size[1] < 1.7 || cut.size[2] < 0.2) {
      errors.push(`${cut.id} is smaller than the minimum doorway volume`);
    }
    const floorY = roomFloorY(room.transform.position[1]);
    const bottomClearance = cutFloorBottomClearance(cut, floorY);
    if (bottomClearance < CUT_FLOOR_BOTTOM_MIN_OFFSET) {
      warnings.push(`${cut.id} extends below the room floor`);
    } else if (bottomClearance > CUT_FLOOR_BOTTOM_MAX_OFFSET) {
      warnings.push(`${cut.id} begins above the walkable floor`);
    }
    if (
      cut.portalId &&
      !layout.portals.some(
        (portal) =>
          portal.id === cut.portalId &&
          (portal.fromRoomId === cut.roomId || portal.toRoomId === cut.roomId),
      )
    ) {
      errors.push(`${cut.id} references an incompatible doorway link`);
    }
  }

  const validPortalIds: string[] = [];
  const neighbors = new Map(
    layout.rooms.map((room) => [room.id, new Set<string>()]),
  );
  const connectorIds = new Set(layout.connectors.map((connector) => connector.id));
  for (const portal of layout.portals) {
    if (!portal.enabled) continue;
    const from = layout.rooms.find((room) => room.id === portal.fromRoomId);
    const to = layout.rooms.find((room) => room.id === portal.toRoomId);
    const fromSocket = from?.doorwaySockets.find(
      (socket) => socket.id === portal.fromSocketId,
    );
    const toSocket = to?.doorwaySockets.find(
      (socket) => socket.id === portal.toSocketId,
    );
    const portalErrors: string[] = [];
    if (!from || !to) portalErrors.push('missing room endpoint');
    if (!fromSocket || !toSocket) portalErrors.push('missing doorway endpoint');
    const portalClips = [
      ...cutVolumes
        .filter((cut) => cut.enabled && cut.portalId === portal.id)
        .map((clip) => ({ roomId: clip.roomId, id: clip.id })),
      ...trimPlanes
        .filter((trim) => trim.enabled && trim.portalId === portal.id)
        .map((clip) => ({ roomId: clip.roomId, id: clip.id })),
    ];
    if (portalClips.length !== 2) {
      portalErrors.push('requires exactly two active user-authored clips');
    } else if (
      !portalClips.some((clip) => clip.roomId === portal.fromRoomId) ||
      !portalClips.some((clip) => clip.roomId === portal.toRoomId)
    ) {
      portalErrors.push('user-authored clips do not cover both linked rooms');
    }
    if (
      portal.fromClipId &&
      !portalClips.some(
        (clip) =>
          clip.id === portal.fromClipId &&
          clip.roomId === portal.fromRoomId,
      )
    ) {
      portalErrors.push('source clip does not match the linked room');
    }
    if (
      portal.toClipId &&
      !portalClips.some(
        (clip) =>
          clip.id === portal.toClipId &&
          clip.roomId === portal.toRoomId,
      )
    ) {
      portalErrors.push('destination clip does not match the linked room');
    }
    if (
      fromSocket &&
      (!fromSocket.verifiedTraversable || fromSocket.visualState !== 'open')
    ) {
      portalErrors.push('source socket is not an audited visible opening');
    }
    if (
      toSocket &&
      (!toSocket.verifiedTraversable || toSocket.visualState !== 'open')
    ) {
      portalErrors.push('destination socket is not an audited visible opening');
    }
    if (
      portal.width <
      layout.largestActorCapsuleRadius * 2 + layout.portalSafetyMargin * 2
    ) {
      portalErrors.push('safe traversal width is too small');
    }
    if (portal.traversalPolygon.length < 3) {
      portalErrors.push('missing traversal polygon');
    } else if (
      !portal.traversalPolygon.every(isFinitePoint) ||
      Math.abs(polygonArea(portal.traversalPolygon)) < 0.01
    ) {
      portalErrors.push('invalid traversal polygon');
    }
    if (portal.transitionPolygon.length < 3) {
      portalErrors.push('missing render-transition polygon');
    } else if (
      !portal.transitionPolygon.every(isFinitePoint) ||
      Math.abs(polygonArea(portal.transitionPolygon)) < 0.01
    ) {
      portalErrors.push('invalid render-transition polygon');
    }
    if (portal.connectorId && !connectorIds.has(portal.connectorId)) {
      portalErrors.push('missing connector asset');
    }
    if (portal.residency.requiredAssetIds.length === 0) {
      portalErrors.push('missing residency requirements');
    }
    if (
      fromSocket &&
      toSocket &&
      (fromSocket.width < portal.width || toSocket.width < portal.width)
    ) {
      portalErrors.push('doorway socket is narrower than traversal width');
    }
    if (
      !portal.connectorId &&
      portal.traversalPolygon.length >= 3 &&
      portal.transitionPolygon.some(
        ([x, z]) =>
          !pointInPolygon(
            new THREE.Vector2(x, z),
            portal.traversalPolygon.map(
              ([px, pz]) => new THREE.Vector2(px, pz),
            ),
          ),
      )
    ) {
      portalErrors.push('render-transition polygon leaves physical overlap');
    }
    if (from && to && fromSocket && toSocket && portal.traversalPolygon.length >= 3) {
      const fromWorld = localPointToWorld(
        fromSocket.position,
        from.transform,
        from.coverageReferenceScale,
      );
      const toWorld = localPointToWorld(
        toSocket.position,
        to.transform,
        to.coverageReferenceScale,
      );
      const midpoint = fromWorld.clone().lerp(toWorld, 0.5);
      const traversal = portal.traversalPolygon.map(
        ([x, z]) => new THREE.Vector2(x, z),
      );
      if (!portal.connectorId && !pointInPolygon(midpoint, traversal)) {
        portalErrors.push('portal midpoint is outside visible safe coverage');
      }

      if (
        !portal.connectorId &&
        fromWorld.distanceTo(toWorld) > 14
      ) {
        portalErrors.push('user-authored clips are too far apart');
      }
    }
    if (portalErrors.length > 0) {
      errors.push(`${portal.id}: ${portalErrors.join(', ')}`);
      continue;
    }
    // Enabled portals are legacy compositor links. Room connectivity is owned
    // by cut/trim doorway pairs below; do not require portals for the graph.
    validPortalIds.push(portal.id);
  }

  // Doorways = paired cut cubes that share doorway metadata (portalId).
  // Trim planes may also stamp the same portalId for ownership, but only the
  // two opposite-room cut cubes define the doorway pair.
  const doorwayCuts = cutVolumes
    .filter((cut) => cut.enabled && cut.portalId)
    .map((clip) => ({
      id: clip.id,
      roomId: clip.roomId,
      doorwayId: clip.portalId!,
    }));
  const clipsByDoorway = new Map<string, typeof doorwayCuts>();
  for (const clip of doorwayCuts) {
    const group = clipsByDoorway.get(clip.doorwayId) ?? [];
    group.push(clip);
    clipsByDoorway.set(clip.doorwayId, group);
  }
  const doorwayIds: string[] = [];
  for (const [doorwayId, clips] of clipsByDoorway) {
    const rooms = [...new Set(clips.map((clip) => clip.roomId))];
    if (clips.length !== 2 || rooms.length !== 2) {
      errors.push(
        `${doorwayId}: cut doorway requires exactly two active cut cubes on two rooms`,
      );
      continue;
    }
    const record = layout.portals.find((portal) => portal.id === doorwayId);
    if (record) {
      const clipIds = new Set(clips.map((clip) => clip.id));
      if (
        record.fromClipId &&
        record.toClipId &&
        (!clipIds.has(record.fromClipId) || !clipIds.has(record.toClipId))
      ) {
        errors.push(`${doorwayId}: cut clips do not match doorway endpoints`);
        continue;
      }
      neighbors.get(record.fromRoomId)?.add(record.toRoomId);
      neighbors.get(record.toRoomId)?.add(record.fromRoomId);
    } else {
      neighbors.get(rooms[0]!)?.add(rooms[1]!);
      neighbors.get(rooms[1]!)?.add(rooms[0]!);
    }
    doorwayIds.push(doorwayId);
  }

  const reachable = new Set<string>();
  const queue = roomIds.has(layout.startRoomId) ? [layout.startRoomId] : [];
  while (queue.length > 0) {
    const roomId = queue.shift()!;
    if (reachable.has(roomId)) continue;
    reachable.add(roomId);
    for (const neighbor of neighbors.get(roomId) ?? []) {
      if (!reachable.has(neighbor)) queue.push(neighbor);
    }
  }
  const isolatedRoomIds = layout.requiredRoomIds.filter(
    (roomId) => !reachable.has(roomId),
  );
  if (mode === 'campus' && isolatedRoomIds.length > 0) {
    const message = `Room graph is disconnected; unreachable: ${isolatedRoomIds.join(', ')}`;
    // Empty doorway authoring is intentional while re-linking rooms by hand.
    if (doorwayIds.length === 0) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }
  if (layout.status !== 'release-ready') {
    warnings.push(`Layout status is ${layout.status}`);
  }
  if (validPortalIds.length > 0) {
    warnings.push(
      `Legacy compositor portals still enabled: ${validPortalIds.join(', ')}`,
    );
  }
  const structuralErrors = errors.filter(
    (error) => !error.startsWith('Room graph is disconnected'),
  );
  return {
    runtimeSafe: structuralErrors.length === 0,
    releaseReady:
      errors.length === 0 &&
      layout.status === 'release-ready' &&
      (mode === 'single-room' ||
        doorwayIds.length === 0 ||
        doorwayIds.length >= layout.requiredRoomIds.length - 1) &&
      validPortalIds.length === 0,
    errors,
    warnings,
    reachableRoomIds: layout.requiredRoomIds.filter((roomId) =>
      reachable.has(roomId),
    ),
    isolatedRoomIds,
    enabledPortalIds: validPortalIds,
    doorwayIds,
    blockedRoutes: layout.blockedRoutes,
  };
}

export class SplatNavigationSurface {
  readonly layout: SplatLayoutAsset;
  readonly validation: SplatLayoutValidation;
  readonly rooms: SplatWorldRoom[];
  readonly connectors: SplatWorldConnector[];
  readonly portals: SplatWorldPortal[];
  private readonly roomById = new Map<string, SplatWorldRoom>();
  private readonly portalReadiness = new Map<string, boolean>();
  private readonly portalLandingCache = new Map<string, THREE.Vector3>();
  private readonly portalLandingCorridors = new Map<
    string,
    { from: THREE.Vector3; to: THREE.Vector3 }
  >();
  private readonly usesAuthoredCoverage: boolean;
  private readonly navigationQueries = new WeakMap<
    SplatWorldNavigationMesh,
    SplatNavigationQueryGrid
  >();
  private readonly preparedTrimsByRoom = new Map<
    string,
    PreparedSplatTrimPlane[]
  >();

  constructor(
    layout: SplatLayoutAsset = rawLayout,
    navigationBake: SplatNavigationBakeAsset = rawNavigation,
    options?: { mode?: 'campus' | 'single-room' },
  ) {
    // Overlapping opposite-room cut cubes (and nearby trims) become doorways
    // before validation / nav attachment so pink cuts are walkable without a
    // separate manual +WALK / Link step.
    if ((options?.mode ?? 'campus') === 'campus') {
      normalizeOverlappingDoorwayCuts(layout);
    }
    this.layout = layout;
    this.validation = validateSplatLayout(layout, {
      mode: options?.mode ?? 'campus',
    });
    // The collider-derived bake owns exploration. coveragePolygon remains in
    // the v1 asset only as a legacy bake fingerprint; it is no longer a
    // player-containment or editor-authoring boundary.
    this.usesAuthoredCoverage = false;
    const navigationById = new Map(
      navigationBake.rooms.map((room) => [room.id, room]),
    );
    const navigationErrors: string[] = [];
    const cutVolumes = layout.cutVolumes ?? [];
    const trimPlanes = layout.trimPlanes ?? [];
    for (const room of layout.rooms) {
      this.preparedTrimsByRoom.set(
        room.id,
        prepareSplatTrimPlanes(
          trimPlanes.filter((trim) => trim.roomId === room.id && trim.enabled),
        ),
      );
    }
    this.rooms = layout.rooms.map((source) => {
      const polygon = worldPolygon(
        source.coveragePolygon,
        source.transform,
        source.coverageReferenceScale,
      );
      const floorY = source.transform.position[1] - 1.5;
      const baked = navigationById.get(source.id);
      const bakeMatches =
        navigationBake.version === 1 &&
        navigationBake.coordinateSpace === 'three-world-metres' &&
        navigationBake.sourceMode === 'collider-only' &&
        bakeMatchesRoom(baked, source);
      const roomCuts = cutVolumes.filter(
        (cut) => cut.enabled && cut.roomId === source.id,
      );
      const roomTrims = trimPlanes.filter(
        (trim) => trim.enabled && trim.roomId === source.id,
      );
      const navigation =
        bakeMatches
          ? (() => {
              let mesh = clipNavigationMeshByCuts(
                {
                  vertices: baked.navmesh.vertices,
                  indices: baked.navmesh.indices,
                  boundaryEdges: baked.navmesh.boundaryEdges,
                  areaSquareMetres: baked.navmesh.areaSquareMetres,
                  clearanceRadius: navigationBake.parameters.clearanceRadius,
                },
                roomCuts,
                roomTrims,
              );
              const patches = (layout.walkablePatches ?? []).filter(
                (patch) => patch.roomId === source.id && patch.polygon.length >= 3,
              );
              for (const patch of patches) {
                mesh = appendWorldPolygonToNavigation(
                  mesh,
                  worldPolygon(
                    patch.polygon,
                    source.transform,
                    source.coverageReferenceScale,
                  ),
                  floorY,
                );
              }
              // Cut cubes punch the splat; also bridge nav into their floor
              // footprint so overlapping cut/door/plane openings are walkable.
              mesh = appendCutDoorwayAperturesToNavigation(
                mesh,
                roomCuts,
                floorY,
              );
              return {
                vertices: mesh.vertices,
                indices: mesh.indices,
                boundaryEdges: mesh.boundaryEdges,
                clearanceRadius: navigationBake.parameters.clearanceRadius,
                areaSquareMetres: mesh.areaSquareMetres,
              };
            })()
          : null;
      if (!bakeMatches) {
        navigationErrors.push(
          `${source.id} navigation bake is missing, stale, or failed calibration`,
        );
      }
      const room: SplatWorldRoom = {
        source,
        polygon,
        navigation,
        navigationCalibrationY: bakeMatches
          ? baked.navigationCalibration.deltaY
          : 0,
        floorY,
        anchor: this.usesAuthoredCoverage
          ? new THREE.Vector3(
              localPointToWorld(
                source.anchor,
                source.transform,
                source.coverageReferenceScale,
              ).x,
              floorY + 0.98,
              localPointToWorld(
                source.anchor,
                source.transform,
                source.coverageReferenceScale,
              ).y,
            )
          : new THREE.Vector3(
              bakeMatches
                ? baked.anchor[0]
                : localPointToWorld(
                    source.anchor,
                    source.transform,
                    source.coverageReferenceScale,
                  ).x,
              bakeMatches ? baked.anchor[1] + 0.98 : floorY + 0.98,
              bakeMatches
                ? baked.anchor[2]
                : localPointToWorld(
                    source.anchor,
                    source.transform,
                    source.coverageReferenceScale,
                  ).y,
            ),
        bounds: navigation && !this.usesAuthoredCoverage
          ? navigationBounds(
              navigation,
              floorY + source.minPlayableHeight,
              floorY + source.maxPlayableHeight,
            )
          : polygonBounds(
              polygon,
              floorY + source.minPlayableHeight,
              floorY + source.maxPlayableHeight,
            ),
      };
      if (navigation) {
        this.navigationQueries.set(
          navigation,
          buildNavigationQueryGrid(navigation),
        );
      }
      this.roomById.set(source.id, room);
      return room;
    });
    // Wall-crawl landings are gameplay seating checks. Keep them advisory so a
    // single off-mesh spawn socket cannot hard-block Deploy after all RAD
    // streams are already ready.
    for (const room of this.rooms) {
      for (const socket of this.wallCrawlSockets(room.source.id)) {
        if (
          !this.containsCapsuleInRoom(
            room.source.id,
            socket.landing,
            socket.landingRadius,
          )
        ) {
          this.validation.warnings.push(
            `${room.source.id}/${socket.id} landing capsule is outside the baked navigation surface`,
          );
        }
      }
    }
    this.connectors = layout.connectors.map((source) => {
      const polygon = worldPolygon(
        source.coveragePolygon,
        source.transform,
        source.coverageReferenceScale,
      );
      const floorY = source.transform.position[1] - 1.5;
      return {
        source,
        polygon,
        floorY,
        bounds: polygonBounds(
          polygon,
          floorY + source.minPlayableHeight,
          floorY + source.maxPlayableHeight,
        ),
      };
    });
    if (navigationErrors.length > 0) {
      this.validation.errors.push(...navigationErrors);
      this.validation.runtimeSafe = false;
      this.validation.releaseReady = false;
    }
    // Build nav doorway records from cut-pair doorway ids. Portal `enabled` is
    // reserved for the removed compositor path and must stay false.
    this.portals = layout.portals
      .filter((portal) => this.validation.doorwayIds.includes(portal.id))
      .flatMap((source) => {
        const fromRoom = this.roomById.get(source.fromRoomId);
        const toRoom = this.roomById.get(source.toRoomId);
        const fromSocket = fromRoom?.source.doorwaySockets.find(
          (socket) => socket.id === source.fromSocketId,
        );
        const toSocket = toRoom?.source.doorwaySockets.find(
          (socket) => socket.id === source.toSocketId,
        );
        if (!fromRoom || !toRoom || !fromSocket || !toSocket) return [];
        const fromPoint = localPointToWorld(
          fromSocket.position,
          fromRoom.source.transform,
          fromRoom.source.coverageReferenceScale,
        );
        const toPoint = localPointToWorld(
          toSocket.position,
          toRoom.source.transform,
          toRoom.source.coverageReferenceScale,
        );
        const fromSupport = fromRoom.navigation
          ? navigationReachableSupportPoint(
              fromRoom.navigation,
              fromRoom.anchor,
              fromPoint,
            )
          : null;
        const toSupport = toRoom.navigation
          ? navigationReachableSupportPoint(
              toRoom.navigation,
              toRoom.anchor,
              toPoint,
            )
          : null;
        // Never seat doorway endpoints below the room floor. Clipped/appended
        // nav support can sit slightly under the sill and would spawn the
        // capsule into catch-slab / opposite-room floor lips at the seam.
        const fromStandY =
          Math.max(fromSupport?.y ?? fromRoom.floorY, fromRoom.floorY) + 0.98;
        const toStandY =
          Math.max(toSupport?.y ?? toRoom.floorY, toRoom.floorY) + 0.98;
        const portal: SplatWorldPortal = {
          source,
          traversalPolygon: source.traversalPolygon.map(
            ([x, z]) => new THREE.Vector2(x, z),
          ),
          transitionPolygon: source.transitionPolygon.map(
            ([x, z]) => new THREE.Vector2(x, z),
          ),
          from: new THREE.Vector3(fromPoint.x, fromStandY, fromPoint.y),
          to: new THREE.Vector3(toPoint.x, toStandY, toPoint.y),
        };
        this.portalReadiness.set(source.id, false);
        return [portal];
      });
    // Authored traversal polygons come from raw cut sockets, while collision
    // safety comes from the baked room meshes. Rotated/offset socket pairs can
    // leave a small capsule gap between those two representations. Cache one
    // narrow corridor between the proven landings so both players and zombies
    // can finish an otherwise valid doorway transfer without gaining access
    // anywhere outside an open authored portal.
    for (const portal of this.portals) {
      const radius = this.layout.largestActorCapsuleRadius;
      const from = this.portalLandingPoint(
        portal.source.id,
        portal.source.fromRoomId,
        radius,
      );
      const to = this.portalLandingPoint(
        portal.source.id,
        portal.source.toRoomId,
        radius,
      );
      if (from && to) {
        this.portalLandingCorridors.set(portal.source.id, { from, to });
      }
    }
  }

  /**
   * Build a surface from an injected layout + collider bake (Maps Outbreak
   * single-room arenas). Does not use the 6-room campus JSON imports.
   */
  static fromAssets(
    layout: SplatLayoutAsset,
    navigation: SplatNavigationBakeAsset,
  ): SplatNavigationSurface {
    return new SplatNavigationSurface(layout, navigation, {
      mode: 'single-room',
    });
  }

  room(roomId: string): SplatWorldRoom | null {
    return this.roomById.get(roomId) ?? null;
  }

  startRoom(): SplatWorldRoom {
    const room = this.room(this.layout.startRoomId);
    if (!room) throw new Error(`Missing start room ${this.layout.startRoomId}`);
    return room;
  }

  roomIdForPosition(
    position: THREE.Vector3,
    capsuleRadius = 0,
  ): string | null {
    let best: { id: string; anchorDistance: number; clearance: number } | null =
      null;
    for (const room of this.rooms) {
      const distance = this.signedDistanceInRoom(
        room,
        position,
        capsuleRadius,
      );
      if (distance < 0) continue;
      const anchorDistance = room.anchor.distanceToSquared(position);
      if (
        !best ||
        anchorDistance < best.anchorDistance - EPSILON ||
        (Math.abs(anchorDistance - best.anchorDistance) <= EPSILON &&
          distance > best.clearance)
      ) {
        best = {
          id: room.source.id,
          anchorDistance,
          clearance: distance,
        };
      }
    }
    return best?.id ?? null;
  }

  portalIdForPosition(position: THREE.Vector3): string | null {
    const point = new THREE.Vector2(position.x, position.z);
    for (const portal of this.portals) {
      if (
        this.isPortalOpen(portal.source.id) &&
        pointInPolygon(point, portal.traversalPolygon)
      ) {
        return portal.source.id;
      }
    }
    return null;
  }

  connectorIdForPosition(
    position: THREE.Vector3,
    capsuleRadius = 0,
  ): string | null {
    if (!this.hasAnyOpenPortal()) return null;
    let best: { id: string; clearance: number } | null = null;
    for (const connector of this.connectors) {
      const clearance = this.signedDistanceInConnector(
        connector,
        position,
        capsuleRadius,
      );
      if (clearance < 0 || (best && best.clearance >= clearance)) continue;
      best = { id: connector.source.id, clearance };
    }
    return best?.id ?? null;
  }

  signedDistance(position: THREE.Vector3, capsuleRadius = 0): number {
    let distance = Number.NEGATIVE_INFINITY;
    for (const room of this.rooms) {
      distance = Math.max(
        distance,
        this.signedDistanceInRoom(room, position, capsuleRadius),
      );
    }
    if (this.hasAnyOpenPortal()) {
      for (const connector of this.connectors) {
        distance = Math.max(
          distance,
          this.signedDistanceInConnector(
            connector,
            position,
            capsuleRadius,
          ),
        );
      }
    }
    const point = new THREE.Vector2(position.x, position.z);
    for (const portal of this.portals) {
      if (!this.isPortalOpen(portal.source.id)) continue;
      distance = Math.max(
        distance,
        signedDistanceToPolygon(point, portal.traversalPolygon) - capsuleRadius,
      );
    }
    return distance;
  }

  containsCapsule(position: THREE.Vector3, capsuleRadius: number): boolean {
    return this.signedDistance(position, capsuleRadius) >= 0;
  }

  signedDistanceForRoom(
    roomId: string,
    position: THREE.Vector3,
    capsuleRadius = 0,
  ): number {
    const room = this.room(roomId);
    return room
      ? this.signedDistanceInRoom(room, position, capsuleRadius)
      : Number.NEGATIVE_INFINITY;
  }

  containsCapsuleInRoom(
    roomId: string,
    position: THREE.Vector3,
    capsuleRadius: number,
  ): boolean {
    const room = this.room(roomId);
    if (!room) return false;
    const minimumY = room.floorY + room.source.minPlayableHeight;
    const maximumY = room.floorY + room.source.maxPlayableHeight;
    if (position.y < minimumY || position.y > maximumY) return false;
    // Trim planes cut playable space even when the bake mesh is stale.
    // Doorway cut footprints stay walkable: an overlapping trim must not
    // reject the sill/approach that the pink cut cube opens.
    const roomCuts = (this.layout.cutVolumes ?? []).filter(
      (cut) => cut.enabled && cut.roomId === roomId,
    );
    if (
      !pointInsideAnyCutDoorwayAperture(position, roomCuts) &&
      pointRejectedByTrimPlanes(
        position,
        this.preparedTrimsByRoom.get(roomId) ?? [],
      )
    ) {
      return false;
    }
    if (!room.navigation || this.usesAuthoredCoverage) {
      return (
        signedDistanceToPolygon(
          new THREE.Vector2(position.x, position.z),
          room.polygon,
        ) -
          room.source.safeInset -
          capsuleRadius >=
        0
      );
    }
    const point = new THREE.Vector2(position.x, position.z);
    if (
      !navigationContainsXZ(
        room.navigation,
        point,
        this.navigationQueries.get(room.navigation),
      )
    ) {
      return false;
    }
    const extraClearance = Math.max(
      0,
      capsuleRadius - room.navigation.clearanceRadius,
    );
    return (
      extraClearance <= 0 ||
      navigationBoundaryDistance(room.navigation, point) >= extraClearance
    );
  }

  containsCapsuleSegmentInRoom(
    roomId: string,
    from: THREE.Vector3,
    to: THREE.Vector3,
    capsuleRadius: number,
    maximumStep = 0.35,
  ): boolean {
    const distance = from.distanceTo(to);
    const steps = Math.max(
      1,
      Math.ceil(distance / Math.max(0.05, maximumStep)),
    );
    const sample = new THREE.Vector3();
    for (let step = 0; step <= steps; step += 1) {
      sample.lerpVectors(from, to, step / steps);
      if (!this.containsCapsuleInRoom(roomId, sample, capsuleRadius)) {
        return false;
      }
    }
    return true;
  }

  perimeterCornerWaypoints(roomId: string): THREE.Vector3[] {
    const room = this.room(roomId);
    if (room && this.usesAuthoredCoverage) {
      const inset = room.source.safeInset + 1.1;
      return room.polygon.map((corner) => {
        const towardAnchor = new THREE.Vector2(
          room.anchor.x - corner.x,
          room.anchor.z - corner.y,
        ).normalize();
        return new THREE.Vector3(
          corner.x + towardAnchor.x * inset,
          room.anchor.y,
          corner.y + towardAnchor.y * inset,
        );
      });
    }
    const query = room?.navigation
      ? this.navigationQueries.get(room.navigation)
      : null;
    if (!room || !query || query.boundaryInteriorPoints.length === 0) {
      return [];
    }
    const directions = [
      new THREE.Vector2(-1, -1).normalize(),
      new THREE.Vector2(1, -1).normalize(),
      new THREE.Vector2(1, 1).normalize(),
      new THREE.Vector2(-1, 1).normalize(),
    ];
    return directions.map((direction) => {
      let selected = query.boundaryInteriorPoints[0]!;
      let bestProjection = Number.NEGATIVE_INFINITY;
      for (const point of query.boundaryInteriorPoints) {
        const projection =
          (point.x - room.anchor.x) * direction.x +
          (point.z - room.anchor.z) * direction.y;
        if (projection > bestProjection) {
          bestProjection = projection;
          selected = point;
        }
      }
      return selected.clone().add(new THREE.Vector3(0, 1.2, 0));
    });
  }

  navigationDiagnostics(): {
    sourceMode: string;
    totalAreaSquareMetres: number;
    totalTriangles: number;
    totalBoundaryEdges: number;
    rooms: Array<{
      id: string;
      areaSquareMetres: number;
      triangles: number;
      boundaryEdges: number;
      calibrationY: number;
    }>;
  } {
    const rooms = this.rooms.map((room) => ({
      id: room.source.id,
      areaSquareMetres: room.navigation?.areaSquareMetres ?? 0,
      triangles: (room.navigation?.indices.length ?? 0) / 3,
      boundaryEdges: (room.navigation?.boundaryEdges.length ?? 0) / 2,
      calibrationY: room.navigationCalibrationY,
    }));
    return {
      sourceMode: rawNavigation.sourceMode,
      totalAreaSquareMetres: rooms.reduce(
        (total, room) => total + room.areaSquareMetres,
        0,
      ),
      totalTriangles: rooms.reduce(
        (total, room) => total + room.triangles,
        0,
      ),
      totalBoundaryEdges: rooms.reduce(
        (total, room) => total + room.boundaryEdges,
        0,
      ),
      rooms,
    };
  }

  projectMovement(
    previous: THREE.Vector3,
    proposed: THREE.Vector3,
    capsuleRadius: number,
    activeRoomId: string | null = null,
  ): SplatMovementResolution {
    const signedDistance = (position: THREE.Vector3): number =>
      activeRoomId
        ? this.signedDistanceForActorSpace(
            activeRoomId,
            position,
            capsuleRadius,
          )
        : this.signedDistance(position, capsuleRadius);
    const contains = (position: THREE.Vector3): boolean =>
      activeRoomId
        ? this.containsCapsuleInActorSpace(
            activeRoomId,
            position,
            capsuleRadius,
          )
        : this.containsCapsule(position, capsuleRadius);
    const resolvedRoomId = (position: THREE.Vector3): string | null =>
      activeRoomId
        ? this.roomIdAcrossPortalSegment(
            activeRoomId,
            previous,
            position,
          )
        : this.roomIdForPosition(position, capsuleRadius);

    if (!contains(previous)) {
      const roomId = this.roomIdForPosition(proposed, capsuleRadius);
      return {
        position: previous.clone(),
        roomId,
        portalId: this.portalIdForPosition(previous),
        signedDistance: signedDistance(previous),
        constrained: true,
      };
    }
    if (contains(proposed)) {
      return {
        position: proposed.clone(),
        roomId: resolvedRoomId(proposed),
        portalId: this.portalIdForPosition(proposed),
        signedDistance: signedDistance(proposed),
        constrained: false,
      };
    }

    const delta = proposed.clone().sub(previous);
    const distance = Math.hypot(delta.x, delta.z);
    const samples = Math.max(1, Math.ceil(distance / Math.max(0.08, capsuleRadius * 0.5)));
    const valid = previous.clone();
    for (let index = 1; index <= samples; index += 1) {
      const candidate = previous.clone().lerp(proposed, index / samples);
      if (!contains(candidate)) break;
      valid.copy(candidate);
    }

    const xSlide = valid.clone().setX(proposed.x);
    const zSlide = valid.clone().setZ(proposed.z);
    const slides = [xSlide, zSlide].filter(contains);
    if (slides.length > 0) {
      slides.sort(
        (a, b) =>
          b.distanceToSquared(previous) - a.distanceToSquared(previous),
      );
      valid.copy(slides[0]!);
    }
    return {
      position: valid,
      roomId: resolvedRoomId(valid),
      portalId: this.portalIdForPosition(valid),
      signedDistance: signedDistance(valid),
      constrained: true,
    };
  }

  setPortalReady(portalId: string, ready: boolean): void {
    if (this.portals.some((portal) => portal.source.id === portalId)) {
      this.portalReadiness.set(portalId, ready);
    }
  }

  isPortalOpen(portalId: string): boolean {
    return this.portalReadiness.get(portalId) === true;
  }

  containsCapsuleForActor(
    activeRoomId: string,
    position: THREE.Vector3,
    capsuleRadius: number,
  ): boolean {
    return this.containsCapsuleInActorSpace(
      activeRoomId,
      position,
      capsuleRadius,
    );
  }

  private signedDistanceForActorSpace(
    activeRoomId: string,
    position: THREE.Vector3,
    capsuleRadius: number,
  ): number {
    let distance = Number.NEGATIVE_INFINITY;
    const adjacentRoomIds = this.adjacentRoomIds(activeRoomId);
    for (const room of this.rooms) {
      if (
        room.source.id !== activeRoomId &&
        !adjacentRoomIds.has(room.source.id)
      ) {
        continue;
      }
      distance = Math.max(
        distance,
        this.signedDistanceInRoom(room, position, capsuleRadius),
      );
    }
    if (this.hasAnyOpenPortal()) {
      for (const connector of this.connectors) {
        distance = Math.max(
          distance,
          this.signedDistanceInConnector(
            connector,
            position,
            capsuleRadius,
          ),
        );
      }
      const point = new THREE.Vector2(position.x, position.z);
      for (const portal of this.portals) {
        if (
          !this.isPortalOpen(portal.source.id) ||
          (portal.source.fromRoomId !== activeRoomId &&
            portal.source.toRoomId !== activeRoomId)
        ) {
          continue;
        }
        distance = Math.max(
          distance,
          signedDistanceToPolygon(point, portal.traversalPolygon) -
            capsuleRadius,
          this.signedDistanceInPortalLandingCorridor(
            portal,
            point,
            capsuleRadius,
          ),
        );
      }
    }
    return distance;
  }

  private containsCapsuleInActorSpace(
    activeRoomId: string,
    position: THREE.Vector3,
    capsuleRadius: number,
  ): boolean {
    if (
      this.containsCapsuleInRoom(activeRoomId, position, capsuleRadius)
    ) {
      return true;
    }
    const point = new THREE.Vector2(position.x, position.z);
    if (
      this.portals.some(
        (portal) =>
          this.isPortalOpen(portal.source.id) &&
          (portal.source.fromRoomId === activeRoomId ||
            portal.source.toRoomId === activeRoomId) &&
          (signedDistanceToPolygon(point, portal.traversalPolygon) >=
            capsuleRadius ||
            this.signedDistanceInPortalLandingCorridor(
              portal,
              point,
              capsuleRadius,
            ) >= 0),
      )
    ) {
      return true;
    }
    if (this.connectorIdForPosition(position, capsuleRadius)) return true;
    const destinationRoomId = this.roomIdForPosition(position, capsuleRadius);
    return Boolean(
      destinationRoomId &&
        this.adjacentRoomIds(activeRoomId).has(destinationRoomId),
    );
  }

  private signedDistanceInPortalLandingCorridor(
    portal: SplatWorldPortal,
    point: THREE.Vector2,
    capsuleRadius: number,
  ): number {
    const corridor = this.portalLandingCorridors.get(portal.source.id);
    if (!corridor) return Number.NEGATIVE_INFINITY;
    const halfWidth = Math.max(
      0.08,
      // Rapier can displace the capsule center laterally while it climbs a
      // sloped portal ramp. Retain half the radius as collision clearance but
      // do not subtract the full radius a second time: physical wall/contact
      // resolution already accounts for the capsule extent.
      portal.source.width * 0.5 - capsuleRadius * 0.5,
    );
    return (
      halfWidth -
      distanceToSegment(
        point,
        new THREE.Vector2(corridor.from.x, corridor.from.z),
        new THREE.Vector2(corridor.to.x, corridor.to.z),
      )
    );
  }

  private roomIdAcrossPortal(
    activeRoomId: string,
    position: THREE.Vector3,
  ): string {
    const portalId = this.portalIdForPosition(position);
    const portal = portalId
      ? this.portals.find((candidate) => candidate.source.id === portalId)
      : null;
    if (
      !portal ||
      (portal.source.fromRoomId !== activeRoomId &&
        portal.source.toRoomId !== activeRoomId)
    ) {
      return activeRoomId;
    }
    const otherRoomId =
      portal.source.fromRoomId === activeRoomId
        ? portal.source.toRoomId
        : portal.source.fromRoomId;
    return this.isOnOtherRoomSide(
      portal,
      activeRoomId,
      otherRoomId,
      position,
    )
      ? otherRoomId
      : activeRoomId;
  }

  private roomIdAcrossPortalSegment(
    activeRoomId: string,
    previous: THREE.Vector3,
    current: THREE.Vector3,
  ): string {
    const direct = this.roomIdAcrossPortal(activeRoomId, current);
    if (direct !== activeRoomId) return direct;
    // A portal may finish warming after the fixed-step capsule has already
    // crossed its narrow transition polygon. Do not strand ownership in the
    // source room in that case: once the center is unambiguously supported by
    // an adjacent destination mesh and no longer by the active mesh, the same
    // open authored portal is sufficient proof of a continuous handoff.
    const insideActive = this.containsCapsuleInRoom(
      activeRoomId,
      current,
      0,
    );
    for (const portal of this.portals) {
      if (
        !this.isPortalOpen(portal.source.id) ||
        (portal.source.fromRoomId !== activeRoomId &&
          portal.source.toRoomId !== activeRoomId)
      ) {
        continue;
      }
      const otherRoomId =
        portal.source.fromRoomId === activeRoomId
          ? portal.source.toRoomId
          : portal.source.fromRoomId;
      if (
        !insideActive &&
        this.containsCapsuleInRoom(otherRoomId, current, 0)
      ) {
        return otherRoomId;
      }
    }
    const distance = previous.distanceTo(current);
    const samples = Math.max(1, Math.ceil(distance / 0.05));
    const sample = new THREE.Vector3();
    for (const portal of this.portals) {
      if (
        !this.isPortalOpen(portal.source.id) ||
        (portal.source.fromRoomId !== activeRoomId &&
          portal.source.toRoomId !== activeRoomId)
      ) {
        continue;
      }
      const otherRoomId =
        portal.source.fromRoomId === activeRoomId
          ? portal.source.toRoomId
          : portal.source.fromRoomId;
      let touchedPortal = false;
      for (let step = 0; step <= samples; step += 1) {
        sample.lerpVectors(previous, current, step / samples);
        if (
          signedDistanceToPolygon(
            new THREE.Vector2(sample.x, sample.z),
            portal.traversalPolygon,
          ) >= -0.05
        ) {
          touchedPortal = true;
          // A sprint step can cross a very narrow destination-nav sliver and
          // finish inside overlapping source support on the far side. Decide
          // ownership at the sampled crossing, not only at the overshot end,
          // or the actor can remain permanently assigned to the source room.
          if (
            this.isOnOtherRoomSide(
              portal,
              activeRoomId,
              otherRoomId,
              sample,
            )
          ) {
            return otherRoomId;
          }
        }
      }
      if (!touchedPortal) continue;
      if (this.isOnOtherRoomSide(
        portal,
        activeRoomId,
        otherRoomId,
        current,
      )) {
        return otherRoomId;
      }
    }
    return activeRoomId;
  }

  private isOnOtherRoomSide(
    portal: SplatWorldPortal,
    activeRoomId: string,
    otherRoomId: string,
    position: THREE.Vector3,
  ): boolean {
    const activeAnchor = this.room(activeRoomId)?.anchor;
    const otherAnchor = this.room(otherRoomId)?.anchor;
    if (!activeAnchor || !otherAnchor) return false;
    const insideActive = this.containsCapsuleInRoom(
      activeRoomId,
      position,
      0,
    );
    const insideOther = this.containsCapsuleInRoom(
      otherRoomId,
      position,
      0,
    );
    // The baked room meshes are stronger ownership evidence than an
    // anchor-derived half-plane. At rotated, concave seams (notably
    // North -> West), the old plane could leave the player physically inside
    // the destination while frame ownership remained behind the doorway.
    if (insideOther && !insideActive) return true;
    if (insideActive && !insideOther) return false;
    const seam = portal.transitionPolygon
      .reduce(
        (sum, point) => sum.add(point),
        new THREE.Vector2(),
      )
      .multiplyScalar(1 / Math.max(1, portal.transitionPolygon.length));
    const towardOther = new THREE.Vector2(
      otherAnchor.x - activeAnchor.x,
      otherAnchor.z - activeAnchor.z,
    );
    return (
      new THREE.Vector2(position.x - seam.x, position.z - seam.y).dot(
        towardOther,
      ) > 0
    );
  }

  private adjacentRoomIds(roomId: string): Set<string> {
    const adjacent = new Set<string>();
    for (const portal of this.portals) {
      if (!this.isPortalOpen(portal.source.id)) continue;
      if (portal.source.fromRoomId === roomId) {
        adjacent.add(portal.source.toRoomId);
      } else if (portal.source.toRoomId === roomId) {
        adjacent.add(portal.source.fromRoomId);
      }
    }
    return adjacent;
  }

  findRoomPath(
    fromRoomId: string,
    toRoomId: string,
    excludePortalIds: ReadonlySet<string> = new Set(),
  ): string[] | null {
    if (fromRoomId === toRoomId) return [fromRoomId];
    const previous = new Map<string, string | null>([[fromRoomId, null]]);
    const queue = [fromRoomId];
    while (queue.length > 0) {
      const roomId = queue.shift()!;
      for (const portal of this.portals) {
        if (!this.isPortalOpen(portal.source.id)) continue;
        if (excludePortalIds.has(portal.source.id)) continue;
        const neighbor =
          portal.source.fromRoomId === roomId
            ? portal.source.toRoomId
            : portal.source.toRoomId === roomId
              ? portal.source.fromRoomId
              : null;
        if (!neighbor || previous.has(neighbor)) continue;
        previous.set(neighbor, roomId);
        if (neighbor === toRoomId) {
          const path = [toRoomId];
          let cursor: string | null = roomId;
          while (cursor) {
            path.push(cursor);
            cursor = previous.get(cursor) ?? null;
          }
          return path.reverse();
        }
        queue.push(neighbor);
      }
    }
    return null;
  }

  /**
   * Triangle-corridor path inside one baked room. Returns world waypoints at
   * actor eye/foot height (end.y preserved on the final point).
   */
  findNavigationPath(
    roomId: string,
    start: THREE.Vector3,
    end: THREE.Vector3,
  ): THREE.Vector3[] | null {
    const room = this.room(roomId);
    if (!room?.navigation) return null;
    const path = navigationPathPoints(room.navigation, start, end);
    if (!path) return null;
    for (const point of path) {
      point.y = end.y;
    }
    return path;
  }

  portalBetween(fromRoomId: string, toRoomId: string): SplatWorldPortal | null {
    return (
      this.portals.find(
        (portal) =>
          this.isPortalOpen(portal.source.id) &&
          ((portal.source.fromRoomId === fromRoomId &&
            portal.source.toRoomId === toRoomId) ||
            (portal.source.toRoomId === fromRoomId &&
              portal.source.fromRoomId === toRoomId)),
      ) ?? null
    );
  }

  portalApproachPoint(
    portalId: string,
    roomId: string,
    leadInDistance = 1.4,
  ): THREE.Vector3 | null {
    const portal = this.portals.find(
      (candidate) => candidate.source.id === portalId,
    );
    const room = this.room(roomId);
    if (!portal || !room?.navigation) return null;
    const endpoint =
      portal.source.fromRoomId === roomId
        ? portal.from
        : portal.source.toRoomId === roomId
          ? portal.to
          : null;
    if (!endpoint) return null;
    const doorwaySupport = navigationReachableSupportPoint(
      room.navigation,
      room.anchor,
      new THREE.Vector2(endpoint.x, endpoint.z),
      0,
    );
    const towardRoom = new THREE.Vector2(
      room.anchor.x - doorwaySupport.x,
      room.anchor.z - doorwaySupport.z,
    );
    if (towardRoom.lengthSq() > EPSILON) {
      towardRoom.normalize().multiplyScalar(Math.max(0, leadInDistance));
    }
    const support = navigationReachableSupportPoint(
      room.navigation,
      room.anchor,
      new THREE.Vector2(
        doorwaySupport.x + towardRoom.x,
        doorwaySupport.z + towardRoom.y,
      ),
      0,
    );
    support.y += 0.98;
    return support;
  }

  /**
   * Returns the doorway point that should own presentation/facing checks.
   * Most scan cuts line up with their nearest baked-nav threshold. On a
   * folded join, however, that threshold can face away from the reachable
   * landing corridor. In that case the landing is the only opening the player
   * and agents actually cross, so using it prevents a second, false doorway
   * from being projected through sparse splat coverage.
   */
  portalPresentationPoint(
    portalId: string,
    roomId: string,
  ): THREE.Vector3 | null {
    const threshold = this.portalApproachPoint(portalId, roomId, 0);
    const interior = this.portalApproachPoint(portalId, roomId, 1.4);
    const landing = this.portalLandingPoint(portalId, roomId, 0.34);
    if (!threshold) return landing;
    if (!interior || !landing) return threshold;
    const towardThreshold = threshold.clone().sub(interior).setY(0);
    const towardLanding = landing.clone().sub(interior).setY(0);
    const planarThresholdToLanding = Math.hypot(
      threshold.x - landing.x,
      threshold.z - landing.z,
    );
    if (
      // Folding is a ground-plane topology property. Including floor-height
      // differences here made the safely-settled far-north landing look like
      // a displaced doorway and moved its visual aperture off the real cut.
      planarThresholdToLanding >= 3 &&
      towardThreshold.lengthSq() > EPSILON &&
      towardLanding.lengthSq() > EPSILON &&
      towardThreshold.normalize().dot(towardLanding.normalize()) < 0.35
    ) {
      return landing;
    }
    return threshold;
  }

  portalLandingPoint(
    portalId: string,
    roomId: string,
    capsuleRadius = 0.34,
  ): THREE.Vector3 | null {
    const cacheKey = `${portalId}:${roomId}:${capsuleRadius.toFixed(4)}`;
    const cached = this.portalLandingCache.get(cacheKey);
    if (cached) return cached.clone();
    const portal = this.portals.find(
      (candidate) => candidate.source.id === portalId,
    );
    const room = this.room(roomId);
    if (
      !portal ||
      !room ||
      (portal.source.fromRoomId !== roomId &&
        portal.source.toRoomId !== roomId)
    ) {
      return null;
    }
    const seam = portal.transitionPolygon
      .reduce(
        (sum, point) => sum.add(point),
        new THREE.Vector2(),
      )
      .multiplyScalar(1 / Math.max(1, portal.transitionPolygon.length));
    const towardRoom = new THREE.Vector2(
      room.anchor.x - seam.x,
      room.anchor.z - seam.y,
    );
    if (towardRoom.lengthSq() <= EPSILON) return null;
    towardRoom.normalize();
    const settleLanding = (entry: THREE.Vector3): THREE.Vector3 => {
      if (!room.navigation) return entry;
      const path = navigationPathPoints(room.navigation, entry, room.anchor);
      if (!path) return entry;
      const requiredTravel =
        this.layout.portalSafetyMargin + PORTAL_LANDING_FIXED_STEP_GUARD;
      let travelled = 0;
      const cursor = entry.clone();
      const sample = new THREE.Vector3();
      for (const waypoint of path) {
        const segmentDistance = cursor.distanceTo(waypoint);
        const steps = Math.max(1, Math.ceil(segmentDistance / 0.08));
        for (let step = 1; step <= steps; step += 1) {
          sample.lerpVectors(cursor, waypoint, step / steps);
          sample.y = entry.y;
          const sampleTravel = travelled + segmentDistance * (step / steps);
          if (
            sampleTravel >= requiredTravel &&
            entry.distanceTo(sample) >= requiredTravel &&
            this.containsCapsuleInRoom(roomId, sample, capsuleRadius)
          ) {
            return sample.clone();
          }
        }
        travelled += segmentDistance;
        cursor.copy(waypoint);
      }
      return entry;
    };
    // Start just beyond a full player radius and walk toward the room until
    // the baked navmesh accepts the capsule. Then settle along the actual
    // baked path so the returned ownership point is multiple fixed steps past
    // the boundary rather than the first barely-valid triangle.
    for (
      let distance = capsuleRadius + 0.08;
      distance <= 8;
      distance += 0.16
    ) {
      const candidate = new THREE.Vector3(
        seam.x + towardRoom.x * distance,
        room.floorY + 0.98,
        seam.y + towardRoom.y * distance,
      );
      if (
        this.containsCapsuleInRoom(
          roomId,
          candidate,
          capsuleRadius,
        )
      ) {
        const landing = settleLanding(candidate);
        this.portalLandingCache.set(cacheKey, landing.clone());
        return landing;
      }
    }
    if (!room.navigation) return null;
    const support = navigationReachableSupportPoint(
      room.navigation,
      room.anchor,
      seam,
      0,
    );
    support.y += 0.98;
    const landing = this.containsCapsuleInRoom(
      roomId,
      support,
      capsuleRadius,
    )
      ? settleLanding(support)
      : null;
    if (landing) this.portalLandingCache.set(cacheKey, landing.clone());
    return landing;
  }

  wallCrawlSockets(roomId = this.layout.startRoomId): Array<{
    id: string;
    barrierId: string;
    roomId: string;
    outside: THREE.Vector3;
    opening: THREE.Vector3;
    landing: THREE.Vector3;
    landingRadius: number;
  }> {
    const room = this.room(roomId);
    if (!room) return [];
    return room.source.wallCrawlSockets.map((socket) => {
      const outside = localPointToWorld(
        socket.outside,
        room.source.transform,
        room.source.coverageReferenceScale,
      );
      const opening = localPointToWorld(
        socket.opening,
        room.source.transform,
        room.source.coverageReferenceScale,
      );
      const landing = localPointToWorld(
        socket.landing,
        room.source.transform,
        room.source.coverageReferenceScale,
      );
      return {
        id: socket.id,
        barrierId: socket.barrierId,
        roomId,
        outside: new THREE.Vector3(outside.x, room.floorY, outside.y),
        opening: new THREE.Vector3(opening.x, room.floorY, opening.y),
        landing: new THREE.Vector3(landing.x, room.floorY, landing.y),
        landingRadius: socket.landingRadius,
      };
    });
  }

  /** Stable authored wall-entry list for horde setup across every campus room. */
  allWallCrawlSockets(): Array<{
    id: string;
    barrierId: string;
    roomId: string;
    outside: THREE.Vector3;
    opening: THREE.Vector3;
    landing: THREE.Vector3;
    landingRadius: number;
  }> {
    return this.layout.requiredRoomIds.flatMap((roomId) =>
      this.wallCrawlSockets(roomId),
    );
  }

  private signedDistanceInRoom(
    room: SplatWorldRoom,
    position: THREE.Vector3,
    capsuleRadius: number,
  ): number {
    const minimumY = room.floorY + room.source.minPlayableHeight;
    const maximumY = room.floorY + room.source.maxPlayableHeight;
    if (position.y < minimumY || position.y > maximumY) {
      return -Math.min(
        Math.abs(position.y - minimumY),
        Math.abs(position.y - maximumY),
      );
    }
    const point = new THREE.Vector2(position.x, position.z);
    if (room.navigation && !this.usesAuthoredCoverage) {
      const inside = navigationContainsXZ(
        room.navigation,
        point,
        this.navigationQueries.get(room.navigation),
      );
      const boundaryDistance = navigationBoundaryDistance(room.navigation, point);
      const extraClearance = Math.max(
        0,
        capsuleRadius - room.navigation.clearanceRadius,
      );
      return (inside ? boundaryDistance : -boundaryDistance) - extraClearance;
    }
    return (
      signedDistanceToPolygon(point, room.polygon) -
      room.source.safeInset -
      capsuleRadius
    );
  }

  private signedDistanceInConnector(
    connector: SplatWorldConnector,
    position: THREE.Vector3,
    capsuleRadius: number,
  ): number {
    const minimumY =
      connector.floorY + connector.source.minPlayableHeight;
    const maximumY =
      connector.floorY + connector.source.maxPlayableHeight;
    if (position.y < minimumY || position.y > maximumY) {
      return -Math.min(
        Math.abs(position.y - minimumY),
        Math.abs(position.y - maximumY),
      );
    }
    return (
      signedDistanceToPolygon(
        new THREE.Vector2(position.x, position.z),
        connector.polygon,
      ) -
      connector.source.safeInset -
      capsuleRadius
    );
  }

  private hasAnyOpenPortal(): boolean {
    return this.portals.some((portal) => this.isPortalOpen(portal.source.id));
  }
}

export const zombiesSplatLayout = rawLayout;
export const zombiesSplatNavigationBake = rawNavigation;
