import * as THREE from 'three';

export const MAX_SPLAT_TRIM_PLANES = 8;

export type SplatTrimPlane = {
  id: string;
  roomId: string;
  portalId?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  keepSide: 'positive' | 'negative';
  enabled: boolean;
};

export type PreparedSplatTrimPlane = {
  source: SplatTrimPlane;
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  keepSign: 1 | -1;
};

export function trimPlaneNormal(
  plane: SplatTrimPlane,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  return target
    .set(0, 0, 1)
    .applyEuler(new THREE.Euler(...plane.rotation))
    .normalize();
}

export function prepareSplatTrimPlanes(
  planes: readonly SplatTrimPlane[],
): PreparedSplatTrimPlane[] {
  return planes
    .filter((plane) => plane.enabled)
    .slice(0, MAX_SPLAT_TRIM_PLANES)
    .map((source) => ({
      source,
      origin: new THREE.Vector3(...source.position),
      normal: trimPlaneNormal(source),
      keepSign: source.keepSide === 'positive' ? 1 : -1,
    }));
}

export function trimPlaneDistance(
  point: THREE.Vector3,
  plane: PreparedSplatTrimPlane,
): number {
  return (
    (plane.normal.x * (point.x - plane.origin.x) +
      plane.normal.y * (point.y - plane.origin.y) +
      plane.normal.z * (point.z - plane.origin.z)) *
    plane.keepSign
  );
}

export function pointTrimmedByPlane(
  point: THREE.Vector3,
  plane: PreparedSplatTrimPlane,
  epsilon = 1e-5,
): boolean {
  return trimPlaneDistance(point, plane) < -epsilon;
}

export function clipPolygonToTrimPlane(
  polygon: readonly THREE.Vector3[],
  plane: PreparedSplatTrimPlane,
  epsilon = 1e-5,
): THREE.Vector3[] {
  if (polygon.length < 3) return [];
  const output: THREE.Vector3[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    const currentDistance = trimPlaneDistance(current, plane);
    const nextDistance = trimPlaneDistance(next, plane);
    const currentInside = currentDistance >= -epsilon;
    const nextInside = nextDistance >= -epsilon;
    if (currentInside) output.push(current.clone());
    if (currentInside === nextInside) continue;
    const denominator = currentDistance - nextDistance;
    if (Math.abs(denominator) <= Number.EPSILON) continue;
    output.push(
      current.clone().lerp(next, currentDistance / denominator),
    );
  }
  return output;
}
