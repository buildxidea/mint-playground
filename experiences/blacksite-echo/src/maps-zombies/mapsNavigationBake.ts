import * as THREE from 'three';
import { MAPS_ROOM_ID } from './MapsPlacement';
import type {
  SplatLayoutAsset,
  SplatNavigationBakeAsset,
} from '../world/SplatNavigationSurface';

const MAX_SLOPE_DEGREES = 48;
const CLEARANCE_RADIUS = 0.6;
const DIGEST = 'maps-runtime-bake';
const GRID_STEP = 2.4;

export type MapsNavigationBakeResult = {
  layout: SplatLayoutAsset;
  navigation: SplatNavigationBakeAsset;
  spawn: THREE.Vector3;
  footY: number;
  areaSquareMetres: number;
  bounds: THREE.Box3;
};

type FloorSample = {
  x: number;
  y: number;
  z: number;
  area: number;
};

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p)),
  );
  return sorted[index]!;
}

function collectFloorSamples(colliderRoot: THREE.Object3D): FloorSample[] {
  colliderRoot.updateMatrixWorld(true);
  const minimumNormalY = Math.cos(THREE.MathUtils.degToRad(MAX_SLOPE_DEGREES));
  const samples: FloorSample[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  colliderRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    const positions = geometry.getAttribute('position');
    if (!positions) return;
    const index = geometry.index;
    const count = index ? index.count : positions.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const ia = index ? index.getX(offset) : offset;
      const ib = index ? index.getX(offset + 1) : offset + 1;
      const ic = index ? index.getX(offset + 2) : offset + 2;
      a.set(positions.getX(ia), positions.getY(ia), positions.getZ(ia)).applyMatrix4(
        object.matrixWorld,
      );
      b.set(positions.getX(ib), positions.getY(ib), positions.getZ(ib)).applyMatrix4(
        object.matrixWorld,
      );
      c.set(positions.getX(ic), positions.getY(ic), positions.getZ(ic)).applyMatrix4(
        object.matrixWorld,
      );
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.crossVectors(ab, ac);
      const doubledArea = normal.length();
      if (doubledArea <= 1e-6) continue;
      normal.divideScalar(doubledArea);
      if (normal.y < 0) normal.negate();
      if (normal.y < minimumNormalY) continue;
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      samples.push({
        x: centroid.x,
        y: centroid.y,
        z: centroid.z,
        area: doubledArea * 0.5,
      });
    }
  });
  return samples;
}

function buildGridNavmesh(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  deckY: number,
): {
  vertices: number[];
  indices: number[];
  boundaryEdges: number[];
  areaSquareMetres: number;
} {
  const cols = Math.max(2, Math.ceil((maxX - minX) / GRID_STEP));
  const rows = Math.max(2, Math.ceil((maxZ - minZ) / GRID_STEP));
  const vertices: number[] = [];
  const indexAt = (col: number, row: number) => row * (cols + 1) + col;
  for (let row = 0; row <= rows; row += 1) {
    const z = minZ + ((maxZ - minZ) * row) / rows;
    for (let col = 0; col <= cols; col += 1) {
      const x = minX + ((maxX - minX) * col) / cols;
      vertices.push(round(x), round(deckY), round(z));
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = indexAt(col, row);
      const b = indexAt(col + 1, row);
      const c = indexAt(col + 1, row + 1);
      const d = indexAt(col, row + 1);
      indices.push(a, b, c, a, c, d);
    }
  }
  const boundaryEdges: number[] = [];
  for (let col = 0; col < cols; col += 1) {
    boundaryEdges.push(indexAt(col, 0), indexAt(col + 1, 0));
    boundaryEdges.push(indexAt(col, rows), indexAt(col + 1, rows));
  }
  for (let row = 0; row < rows; row += 1) {
    boundaryEdges.push(indexAt(0, row), indexAt(0, row + 1));
    boundaryEdges.push(indexAt(cols, row), indexAt(cols, row + 1));
  }
  return {
    vertices,
    indices,
    boundaryEdges,
    areaSquareMetres: round(Math.max(0, maxX - minX) * Math.max(0, maxZ - minZ), 3),
  };
}

/**
 * Editor-style walkable model for Maps Outbreak:
 * - XZ footprint from dense slope-filtered collider floor samples (large)
 * - Continuous navmesh grid at the RAD seating band (so the camera stays in
 *   the splat shell, matching campus navmesh floors + containment)
 */
export function bakeMapsNavigationFromCollider(
  colliderRoot: THREE.Object3D,
  roomId: string = MAPS_ROOM_ID,
): MapsNavigationBakeResult {
  const samples = collectFloorSamples(colliderRoot);
  if (samples.length < 8) {
    throw new Error('Maps Outbreak collider has no usable walkable floor triangles');
  }

  const worldBounds = new THREE.Box3().setFromObject(colliderRoot);
  const contentCenter = worldBounds.getCenter(new THREE.Vector3());
  const sortedY = samples.map((sample) => sample.y).sort((a, b) => a - b);
  const bandCenter = percentile(sortedY, 0.6);
  const bandSamples = samples.filter(
    (sample) => Math.abs(sample.y - bandCenter) <= 2.2,
  );
  const pool = bandSamples.length >= 24 ? bandSamples : samples;

  const span = Math.min(
    worldBounds.max.x - worldBounds.min.x,
    worldBounds.max.z - worldBounds.min.z,
  );
  // Large editor-like roam: ~half the collider planar span, minimum 28m radius.
  const keepRadius = Math.max(28, Math.min(span * 0.48, 70));
  const kept = pool.filter(
    (sample) =>
      Math.hypot(sample.x - contentCenter.x, sample.z - contentCenter.z) <=
      keepRadius,
  );
  const footprint = kept.length >= 24 ? kept : pool;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumZ = 0;
  for (const sample of footprint) {
    minX = Math.min(minX, sample.x);
    maxX = Math.max(maxX, sample.x);
    minZ = Math.min(minZ, sample.z);
    maxZ = Math.max(maxZ, sample.z);
    sumX += sample.x;
    sumZ += sample.z;
  }
  // Inflate slightly so edges are not knife-thin.
  minX -= 1.5;
  maxX += 1.5;
  minZ -= 1.5;
  maxZ += 1.5;

  // Seat the continuous deck inside the RAD shell (proven Maps waterfront band).
  const deckY =
    worldBounds.min.y +
    Math.max(2.2, (worldBounds.max.y - worldBounds.min.y) * 0.28);
  const navmesh = buildGridNavmesh(minX, maxX, minZ, maxZ, deckY);
  const anchorX = sumX / Math.max(footprint.length, 1);
  const anchorZ = sumZ / Math.max(footprint.length, 1);
  const bestAnchor = new THREE.Vector3(
    THREE.MathUtils.clamp(anchorX, minX + 2, maxX - 2),
    deckY,
    THREE.MathUtils.clamp(anchorZ, minZ + 2, maxZ - 2),
  );

  const transformY = deckY + 1.5;
  const coveragePolygon: Array<[number, number]> = [
    [round(minX), round(minZ)],
    [round(maxX), round(minZ)],
    [round(maxX), round(maxZ)],
    [round(minX), round(maxZ)],
  ];
  const localAnchor: [number, number] = [
    round(bestAnchor.x),
    round(bestAnchor.z),
  ];
  const transform = {
    position: [0, transformY, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: 1,
    authoredYaw: 0,
  };
  const layoutInput = {
    transform,
    coveragePolygon,
    minPlayableHeight: -0.75,
    maxPlayableHeight: 4.5,
    safeInset: 0.55,
    anchor: localAnchor,
  };

  const layout: SplatLayoutAsset = {
    version: 1,
    status: 'release-ready',
    coordinateSpace: 'three-world-metres',
    startRoomId: roomId,
    requiredRoomIds: [roomId],
    largestActorCapsuleRadius: 0.42,
    portalSafetyMargin: 0.18,
    rooms: [
      {
        id: roomId,
        assetId: roomId,
        radDigest: DIGEST,
        colliderDigest: DIGEST,
        transform,
        coverageReferenceScale: 1,
        coveragePolygon,
        minPlayableHeight: layoutInput.minPlayableHeight,
        maxPlayableHeight: layoutInput.maxPlayableHeight,
        safeInset: layoutInput.safeInset,
        anchor: localAnchor,
        doorwaySockets: [],
        wallCrawlSockets: [],
      },
    ],
    connectors: [],
    cutVolumes: [],
    trimPlanes: [],
    portals: [],
    blockedRoutes: [],
  };

  const navigation: SplatNavigationBakeAsset = {
    version: 1,
    coordinateSpace: 'three-world-metres',
    sourceMode: 'collider-only',
    parameters: {
      clearanceRadius: CLEARANCE_RADIUS,
    },
    rooms: [
      {
        id: roomId,
        assetId: roomId,
        colliderDigest: DIGEST,
        colliderDigestHint: DIGEST,
        transform,
        navigationCalibration: {
          sampledColliderFloorY: deckY,
          authoredFloorY: deckY,
          deltaY: 0,
          sampleCount: 32,
          rejectedSampleCount: 0,
          maximumDeviation: 0.05,
        },
        layoutInput,
        anchor: [bestAnchor.x, bestAnchor.y, bestAnchor.z],
        authoredAnchor: [bestAnchor.x, bestAnchor.y, bestAnchor.z],
        bounds: {
          min: [minX, deckY - 1, minZ],
          max: [maxX, deckY + 3, maxZ],
        },
        navmesh,
      },
    ],
  };

  const bounds = new THREE.Box3(
    new THREE.Vector3(minX, deckY - 1, minZ),
    new THREE.Vector3(maxX, deckY + 4, maxZ),
  );

  return {
    layout,
    navigation,
    spawn: new THREE.Vector3(bestAnchor.x, deckY + 0.98, bestAnchor.z),
    footY: deckY,
    areaSquareMetres: navmesh.areaSquareMetres,
    bounds,
  };
}
