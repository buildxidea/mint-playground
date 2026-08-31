import * as THREE from 'three';

export const MAX_SPLAT_CUT_VOLUMES = 16;

/** Previous door height; used to lift already-authored standard door cuts. */
export const LEGACY_STANDARD_DOOR_CUT_HEIGHT = 3.6;

/** Previous through-wall depth before soft-gaussian fringe clearance. */
export const LEGACY_STANDARD_DOOR_CUT_DEPTH = 5.2;

/** Through-wall × height × doorway width (meters). */
export const STANDARD_DOOR_CUT_SIZE: readonly [number, number, number] = [
  7.0, 5.0, 6.5,
];

/** Grow legacy standard door cuts to the current size, keeping the sill. */
export function migrateLegacyDoorCutHeights(
  cuts: readonly SplatCutVolume[],
): number {
  let migrated = 0;
  for (const cut of cuts) {
    const depthMatchesCurrent =
      Math.abs(cut.size[0] - STANDARD_DOOR_CUT_SIZE[0]) <= 0.01;
    const depthMatchesLegacy =
      Math.abs(cut.size[0] - LEGACY_STANDARD_DOOR_CUT_DEPTH) <= 0.01;
    const heightMatchesCurrent =
      Math.abs(cut.size[1] - STANDARD_DOOR_CUT_SIZE[1]) <= 0.01;
    const heightMatchesLegacy =
      Math.abs(cut.size[1] - LEGACY_STANDARD_DOOR_CUT_HEIGHT) <= 0.01;
    const widthMatches =
      Math.abs(cut.size[2] - STANDARD_DOOR_CUT_SIZE[2]) <= 0.01;
    if (
      !widthMatches ||
      (!depthMatchesCurrent && !depthMatchesLegacy) ||
      (!heightMatchesCurrent && !heightMatchesLegacy)
    ) {
      continue;
    }
    if (depthMatchesCurrent && heightMatchesCurrent) {
      continue;
    }
    const bottom = cut.position[1] - cut.size[1] * 0.5;
    cut.size[0] = STANDARD_DOOR_CUT_SIZE[0];
    cut.size[1] = STANDARD_DOOR_CUT_SIZE[1];
    cut.position[1] = bottom + cut.size[1] * 0.5;
    migrated += 1;
  }
  return migrated;
}

/**
 * Keep the cut bottom above the walkable floor. Gaussian floors have thickness,
 * so this needs more than a hairline gap or the OBB still eats the floor plate.
 */
export const STANDARD_DOOR_CUT_SILL = 0.18;

/**
 * Extra meters carved out of the bottom of every cut in the splat shader so
 * thick floor gaussians inside the OBB are never discarded.
 */
export const CUT_FLOOR_SHADER_GUARD = 0.28;

/** Hard reject when the OBB digs into the floor. */
export const CUT_FLOOR_BOTTOM_MIN_OFFSET = -0.05;

/** Warn when the aperture floats clear of the walkable floor. */
export const CUT_FLOOR_BOTTOM_MAX_OFFSET = 0.28;

/** Mint root Y to walkable floor offset used across the campus. */
export const SPLAT_ROOM_FLOOR_OFFSET = 1.5;

export type SplatCutVolume = {
  id: string;
  roomId: string;
  portalId?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  enabled: boolean;
};

export type PreparedSplatCutVolume = {
  source: SplatCutVolume;
  inverseWorld: THREE.Matrix4;
  localBounds: THREE.Box3;
};

export function roomFloorY(roomRootY: number): number {
  return roomRootY - SPLAT_ROOM_FLOOR_OFFSET;
}

export function seatedCutCenterY(
  floorY: number,
  height = STANDARD_DOOR_CUT_SIZE[1],
  sill = STANDARD_DOOR_CUT_SILL,
): number {
  return floorY + height * 0.5 + sill;
}

/** Yaw that aligns local Z (door width) to a world-space wall edge. */
export function doorCutYawForWallEdge(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Lift a cut so its bottom stays on the sill above the room floor. */
export function clampCutAboveFloor(
  cut: SplatCutVolume,
  floorY: number,
  sill = STANDARD_DOOR_CUT_SILL,
): boolean {
  const bottom = cut.position[1] - cut.size[1] * 0.5;
  const minBottom = floorY + sill;
  if (bottom >= minBottom - 1e-6) return false;
  cut.position[1] = seatedCutCenterY(floorY, cut.size[1], sill);
  return true;
}

/** Re-seat any cut whose bottom has drifted into the floor band. */
export function reseatCutsAboveFloor(
  cuts: readonly SplatCutVolume[],
  floorYForRoom: (roomId: string) => number | null,
  sill = STANDARD_DOOR_CUT_SILL,
): number {
  let moved = 0;
  for (const cut of cuts) {
    const floorY = floorYForRoom(cut.roomId);
    if (floorY === null) continue;
    if (clampCutAboveFloor(cut, floorY, sill)) moved += 1;
  }
  return moved;
}

export function cutFloorBottomClearance(
  cut: Pick<SplatCutVolume, 'position' | 'size'>,
  floorY: number,
): number {
  return cut.position[1] - cut.size[1] * 0.5 - floorY;
}

export function cutVolumeMatrix(
  cut: SplatCutVolume,
  target = new THREE.Matrix4(),
): THREE.Matrix4 {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...cut.rotation),
  );
  return target.compose(
    new THREE.Vector3(...cut.position),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
}

export function prepareSplatCutVolumes(
  cuts: readonly SplatCutVolume[],
): PreparedSplatCutVolume[] {
  return cuts
    .filter((cut) => cut.enabled)
    .slice(0, MAX_SPLAT_CUT_VOLUMES)
    .map((source) => {
      const half = new THREE.Vector3(...source.size).multiplyScalar(0.5);
      return {
        source,
        inverseWorld: cutVolumeMatrix(source).invert(),
        localBounds: new THREE.Box3(half.clone().negate(), half),
      };
    });
}

export function pointInsideCutVolume(
  point: THREE.Vector3,
  cut: PreparedSplatCutVolume,
): boolean {
  return cut.localBounds.containsPoint(
    point.clone().applyMatrix4(cut.inverseWorld),
  );
}

export function triangleIntersectsCutVolume(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  cut: PreparedSplatCutVolume,
): boolean {
  const triangle = new THREE.Triangle(
    a.clone().applyMatrix4(cut.inverseWorld),
    b.clone().applyMatrix4(cut.inverseWorld),
    c.clone().applyMatrix4(cut.inverseWorld),
  );
  return cut.localBounds.intersectsTriangle(triangle);
}
