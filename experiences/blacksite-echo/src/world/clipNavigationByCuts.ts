import * as THREE from 'three';
import { type SplatCutVolume } from './SplatCutVolume';
import {
  clipPolygonToTrimPlane,
  pointTrimmedByPlane,
  prepareSplatTrimPlanes,
  type PreparedSplatTrimPlane,
  type SplatTrimPlane,
} from './SplatTrimPlane';

export type ClipableNavigationMesh = {
  vertices: number[];
  indices: number[];
  boundaryEdges: number[];
  areaSquareMetres: number;
  clearanceRadius?: number;
};

/** Stable fingerprint of enabled clips that affect a room's playable mesh. */
export function roomClipFingerprint(
  roomId: string,
  cutVolumes: readonly SplatCutVolume[],
  trimPlanes: readonly SplatTrimPlane[],
): string {
  const cuts = cutVolumes
    .filter((cut) => cut.enabled && cut.roomId === roomId)
    .map(
      (cut) =>
        `c:${cut.id}:${cut.position.join(',')}:${cut.rotation.join(',')}:${cut.size.join(',')}`,
    )
    .sort();
  const trims = trimPlanes
    .filter((trim) => trim.enabled && trim.roomId === roomId)
    .map(
      (trim) =>
        `t:${trim.id}:${trim.position.join(',')}:${trim.rotation.join(',')}:${trim.keepSide}`,
    )
    .sort();
  return [...cuts, ...trims].join('|') || 'none';
}

/**
 * Trim planes carve playable area. Cut cubes only punch splat/collision
 * apertures — they must not delete floor triangles under doorways or spawns.
 */
export function clipNavigationMeshByCuts(
  navigation: ClipableNavigationMesh,
  _cutVolumes: readonly SplatCutVolume[],
  trimPlanes: readonly SplatTrimPlane[],
): ClipableNavigationMesh {
  const preparedTrims = prepareSplatTrimPlanes(trimPlanes);
  if (preparedTrims.length === 0) {
    return {
      vertices: [...navigation.vertices],
      indices: [...navigation.indices],
      boundaryEdges: [...navigation.boundaryEdges],
      areaSquareMetres: navigation.areaSquareMetres,
      ...(navigation.clearanceRadius !== undefined
        ? { clearanceRadius: navigation.clearanceRadius }
        : {}),
    };
  }

  const triangleA = new THREE.Vector3();
  const triangleB = new THREE.Vector3();
  const triangleC = new THREE.Vector3();
  const clippedVertices: number[] = [];
  const clippedIndices: number[] = [];

  for (let offset = 0; offset < navigation.indices.length; offset += 3) {
    const aIndex = navigation.indices[offset]!;
    const bIndex = navigation.indices[offset + 1]!;
    const cIndex = navigation.indices[offset + 2]!;
    triangleA.fromArray(navigation.vertices, aIndex * 3);
    triangleB.fromArray(navigation.vertices, bIndex * 3);
    triangleC.fromArray(navigation.vertices, cIndex * 3);
    let polygon = [triangleA.clone(), triangleB.clone(), triangleC.clone()];
    for (const trim of preparedTrims) {
      polygon = clipPolygonToTrimPlane(polygon, trim);
      if (polygon.length < 3) break;
    }
    if (polygon.length < 3) continue;
    const base = clippedVertices.length / 3;
    for (const point of polygon) {
      clippedVertices.push(point.x, point.y, point.z);
    }
    for (let index = 1; index < polygon.length - 1; index += 1) {
      clippedIndices.push(base, base + index, base + index + 1);
    }
  }

  if (clippedIndices.length < 3) {
    return {
      vertices: [],
      indices: [],
      boundaryEdges: [],
      areaSquareMetres: 0,
      ...(navigation.clearanceRadius !== undefined
        ? { clearanceRadius: navigation.clearanceRadius }
        : {}),
    };
  }

  return finalizeNavigationMesh(
    clippedVertices,
    clippedIndices,
    navigation.clearanceRadius,
  );
}

export function pointRejectedByTrimPlanes(
  point: THREE.Vector3,
  preparedTrims: readonly PreparedSplatTrimPlane[],
): boolean {
  return preparedTrims.some((trim) => pointTrimmedByPlane(point, trim));
}

/**
 * Append a world-space XZ polygon as walkable triangles (editor door bridges).
 * Overlaps with the existing bake are fine — containment is a union.
 */
export function appendWorldPolygonToNavigation(
  navigation: ClipableNavigationMesh,
  polygon: readonly THREE.Vector2[],
  floorY: number,
): ClipableNavigationMesh {
  if (polygon.length < 3 || !Number.isFinite(floorY)) {
    return {
      vertices: [...navigation.vertices],
      indices: [...navigation.indices],
      boundaryEdges: [...navigation.boundaryEdges],
      areaSquareMetres: navigation.areaSquareMetres,
      ...(navigation.clearanceRadius !== undefined
        ? { clearanceRadius: navigation.clearanceRadius }
        : {}),
    };
  }
  const shape = polygon.map((point) => new THREE.Vector2(point.x, point.y));
  const triangles = THREE.ShapeUtils.triangulateShape(shape, []);
  if (triangles.length === 0) {
    return {
      vertices: [...navigation.vertices],
      indices: [...navigation.indices],
      boundaryEdges: [...navigation.boundaryEdges],
      areaSquareMetres: navigation.areaSquareMetres,
      ...(navigation.clearanceRadius !== undefined
        ? { clearanceRadius: navigation.clearanceRadius }
        : {}),
    };
  }

  const vertices = [...navigation.vertices];
  const indices = [...navigation.indices];
  const base = vertices.length / 3;
  for (const point of shape) {
    vertices.push(point.x, floorY, point.y);
  }
  for (const triangle of triangles) {
    // Match campus portal-floor winding (XZ ground, +Y up).
    indices.push(
      base + triangle[0]!,
      base + triangle[2]!,
      base + triangle[1]!,
    );
  }
  return finalizeNavigationMesh(
    vertices,
    indices,
    navigation.clearanceRadius,
  );
}

/**
 * Weld near-coincident vertices so trim clipping / polygon appends keep a
 * connected adjacency graph for doorway approach and path queries.
 */
function weldNavigationMesh(
  vertices: number[],
  indices: number[],
  epsilon = 1e-3,
): { vertices: number[]; indices: number[] } {
  const cellSize = Math.max(epsilon, 1e-6);
  const buckets = new Map<string, number>();
  const remap = new Int32Array(Math.floor(vertices.length / 3));
  const welded: number[] = [];

  for (let index = 0; index < remap.length; index += 1) {
    const offset = index * 3;
    const x = vertices[offset]!;
    const y = vertices[offset + 1]!;
    const z = vertices[offset + 2]!;
    const key = `${Math.round(x / cellSize)}:${Math.round(y / cellSize)}:${Math.round(z / cellSize)}`;
    const existing = buckets.get(key);
    if (existing !== undefined) {
      remap[index] = existing;
      continue;
    }
    const weldedIndex = welded.length / 3;
    welded.push(x, y, z);
    remap[index] = weldedIndex;
    buckets.set(key, weldedIndex);
  }

  const weldedIndices: number[] = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = remap[indices[offset]!]!;
    const b = remap[indices[offset + 1]!]!;
    const c = remap[indices[offset + 2]!]!;
    if (a === b || b === c || a === c) continue;
    weldedIndices.push(a, b, c);
  }
  return { vertices: welded, indices: weldedIndices };
}

export function finalizeNavigationMesh(
  vertices: number[],
  indices: number[],
  clearanceRadius?: number,
): ClipableNavigationMesh {
  const welded = weldNavigationMesh(vertices, indices);
  const edgeCounts = new Map<string, { a: number; b: number; count: number }>();
  for (let offset = 0; offset < welded.indices.length; offset += 3) {
    const corners = [
      welded.indices[offset]!,
      welded.indices[offset + 1]!,
      welded.indices[offset + 2]!,
    ];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = corners[edge]!;
      const b = corners[(edge + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const existing = edgeCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeCounts.set(key, { a, b, count: 1 });
      }
    }
  }
  const boundaryEdges: number[] = [];
  for (const edge of edgeCounts.values()) {
    if (edge.count === 1) boundaryEdges.push(edge.a, edge.b);
  }

  let area = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let offset = 0; offset < welded.indices.length; offset += 3) {
    a.fromArray(welded.vertices, welded.indices[offset]! * 3);
    b.fromArray(welded.vertices, welded.indices[offset + 1]! * 3);
    c.fromArray(welded.vertices, welded.indices[offset + 2]! * 3);
    area += new THREE.Triangle(a, b, c).getArea();
  }

  return {
    vertices: welded.vertices,
    indices: welded.indices,
    boundaryEdges,
    areaSquareMetres: Math.round(area * 1000) / 1000,
    ...(clearanceRadius !== undefined ? { clearanceRadius } : {}),
  };
}
