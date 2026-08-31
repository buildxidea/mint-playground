import * as THREE from 'three';
import {
  appendWorldPolygonToNavigation,
  type ClipableNavigationMesh,
} from './clipNavigationByCuts';
import type { SplatCutVolume } from './SplatCutVolume';
import type {
  SplatDoorwaySocket,
  SplatLayoutAsset,
  SplatLayoutPortal,
  SplatLayoutRoom,
  SplatPoint2,
} from './SplatNavigationSurface';
import type { SplatTrimPlane } from './SplatTrimPlane';

/** Max center distance for opposite-room cut cubes to form a doorway. */
export const CUT_DOORWAY_PAIR_MAX_DIST_M = 4.5;

/** Inflate cut floor footprints so capsule centers clear the sill. */
export const CUT_DOORWAY_FLOOR_INFLATE_M = 0.65;

/** Lower score is better. Null = not a valid opposite-room doorway overlap. */
export function scoreCutDoorwayOverlap(
  a: SplatCutVolume,
  b: SplatCutVolume,
  maxDistance = CUT_DOORWAY_PAIR_MAX_DIST_M,
): number | null {
  if (!a.enabled || !b.enabled || a.roomId === b.roomId) return null;
  const dist = Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  );
  if (dist > maxDistance) return null;
  let yawDelta = Math.abs(a.rotation[1] - b.rotation[1]) % Math.PI;
  yawDelta = Math.min(yawDelta, Math.PI - yawDelta);
  if (yawDelta > (40 * Math.PI) / 180) return null;
  const sizeDiff =
    Math.abs(a.size[0] - b.size[0]) +
    Math.abs(a.size[1] - b.size[1]) +
    Math.abs(a.size[2] - b.size[2]);
  if (sizeDiff > 4.5) return null;
  return dist + yawDelta * 0.45 + sizeDiff * 0.05;
}

/**
 * Project a cut cube onto the floor as an XZ quad (local depth × width).
 * Used to bridge navmesh into doorway openings authored as pink cut volumes.
 */
export function doorwayFloorPolygonFromCut(
  cut: SplatCutVolume,
  inflate = CUT_DOORWAY_FLOOR_INFLATE_M,
): THREE.Vector2[] {
  const halfDepth = cut.size[0] * 0.5 + inflate;
  const halfWidth = cut.size[2] * 0.5 + inflate;
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(cut.rotation[0], cut.rotation[1], cut.rotation[2]),
  );
  const local: Array<readonly [number, number]> = [
    [-halfDepth, -halfWidth],
    [halfDepth, -halfWidth],
    [halfDepth, halfWidth],
    [-halfDepth, halfWidth],
  ];
  return local.map(([lx, lz]) => {
    const world = new THREE.Vector3(lx, 0, lz).applyQuaternion(quaternion);
    return new THREE.Vector2(
      cut.position[0] + world.x,
      cut.position[2] + world.z,
    );
  });
}

/** True when an XZ point sits inside a cut's doorway floor footprint. */
export function pointInsideCutDoorwayAperture(
  point: THREE.Vector3,
  cut: SplatCutVolume,
  inflate = CUT_DOORWAY_FLOOR_INFLATE_M,
): boolean {
  const halfDepth = cut.size[0] * 0.5 + inflate;
  const halfWidth = cut.size[2] * 0.5 + inflate;
  const inverse = new THREE.Matrix4()
    .compose(
      new THREE.Vector3(...cut.position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...cut.rotation),
      ),
      new THREE.Vector3(1, 1, 1),
    )
    .invert();
  const local = point.clone().applyMatrix4(inverse);
  return (
    Math.abs(local.x) <= halfDepth &&
    Math.abs(local.z) <= halfWidth
  );
}

export function pointInsideAnyCutDoorwayAperture(
  point: THREE.Vector3,
  cuts: readonly SplatCutVolume[],
  inflate = CUT_DOORWAY_FLOOR_INFLATE_M,
): boolean {
  return cuts.some(
    (cut) =>
      cut.enabled && pointInsideCutDoorwayAperture(point, cut, inflate),
  );
}

/**
 * Extend a room navmesh with floor quads under every enabled cut so pink cut
 * cubes / overlapping doorway planes become walkable without a manual +WALK.
 */
export function appendCutDoorwayAperturesToNavigation(
  navigation: ClipableNavigationMesh,
  cuts: readonly SplatCutVolume[],
  floorY: number,
  inflate = CUT_DOORWAY_FLOOR_INFLATE_M,
): ClipableNavigationMesh {
  let mesh = navigation;
  for (const cut of cuts) {
    if (!cut.enabled) continue;
    mesh = appendWorldPolygonToNavigation(
      mesh,
      doorwayFloorPolygonFromCut(cut, inflate),
      floorY,
    );
  }
  return mesh;
}

function roomShortLabel(roomId: string): string {
  return roomId
    .replace(/^world-zombies-arena-?/, '')
    .replace(/^world-/, '')
    .replaceAll('-', ' ')
    .trim() || roomId;
}

function worldToRoomLocal(
  room: SplatLayoutRoom,
  world: THREE.Vector2,
): SplatPoint2 {
  const dx = world.x - room.transform.position[0];
  const dz = world.y - room.transform.position[2];
  const cosine = Math.cos(-room.transform.authoredYaw);
  const sine = Math.sin(-room.transform.authoredYaw);
  const ratio =
    room.transform.scale /
    Math.max(room.coverageReferenceScale ?? room.transform.scale, 1e-6);
  return [
    (dx * cosine - dz * sine) / ratio,
    (dx * sine + dz * cosine) / ratio,
  ];
}

function corridorPolygon(
  from: THREE.Vector2,
  to: THREE.Vector2,
  width: number,
  extension: number,
): SplatPoint2[] {
  const direction = to.clone().sub(from);
  if (direction.lengthSq() < 1e-6) direction.set(0, 1);
  direction.normalize();
  const right = new THREE.Vector2(direction.y, -direction.x);
  const half = width * 0.5;
  const start = from.clone().addScaledVector(direction, -extension);
  const end = to.clone().addScaledVector(direction, extension);
  return [
    start.clone().addScaledVector(right, half),
    end.clone().addScaledVector(right, half),
    end.clone().addScaledVector(right, -half),
    start.clone().addScaledVector(right, -half),
  ].map((point) => [point.x, point.y] as SplatPoint2);
}

function makeSocket(
  id: string,
  room: SplatLayoutRoom,
  point: THREE.Vector2,
  destination: THREE.Vector2,
  cut: SplatCutVolume,
): SplatDoorwaySocket {
  const local = worldToRoomLocal(room, point);
  return {
    id,
    derivedFromClipId: cut.id,
    position: local,
    yaw:
      Math.atan2(destination.x - point.x, destination.y - point.y) -
      room.transform.authoredYaw,
    width: Math.max(cut.size[2], 5),
    height: Math.max(cut.size[1], 3),
    coverageDepth: Math.max(cut.size[0], 4),
    visualState: 'open',
    verifiedTraversable: true,
    evidence: 'Auto-paired overlapping door cuts',
  };
}

/**
 * Pair every unambiguous overlapping opposite-room cut pair into a doorway
 * (portalId + portal record + sockets). Also stamps overlapping trim planes
 * with the same doorway id. Mutates the layout in place.
 */
export function normalizeOverlappingDoorwayCuts(
  layout: SplatLayoutAsset,
): string[] {
  layout.cutVolumes ??= [];
  layout.trimPlanes ??= [];
  layout.portals ??= [];
  const notes: string[] = [];
  const unpaired = layout.cutVolumes.filter(
    (cut) => cut.enabled && !cut.portalId,
  );
  const claimed = new Set<string>();

  for (const cut of unpaired) {
    if (claimed.has(cut.id) || cut.portalId) continue;
    const ranked: Array<{ cut: SplatCutVolume; score: number }> = [];
    for (const other of unpaired) {
      if (other.id === cut.id || claimed.has(other.id) || other.portalId) {
        continue;
      }
      const score = scoreCutDoorwayOverlap(cut, other);
      if (score == null) continue;
      ranked.push({ cut: other, score });
    }
    ranked.sort((a, b) => a.score - b.score);
    const best = ranked[0];
    if (!best) continue;
    const second = ranked[1];
    if (second && second.score - best.score < 0.35) {
      notes.push(`${cut.id} overlaps multiple cuts // needs Link doorway`);
      continue;
    }

    const cutA = cut;
    const cutB = best.cut;
    const fromCut =
      cutA.roomId === layout.startRoomId
        ? cutA
        : cutB.roomId === layout.startRoomId
          ? cutB
          : cutA.roomId < cutB.roomId
            ? cutA
            : cutB;
    const toCut = fromCut.id === cutA.id ? cutB : cutA;
    const fromRoom = layout.rooms.find((room) => room.id === fromCut.roomId);
    const toRoom = layout.rooms.find((room) => room.id === toCut.roomId);
    if (!fromRoom || !toRoom) continue;

    const base = `${roomShortLabel(fromRoom.id)}-${roomShortLabel(toRoom.id)}`
      .toLowerCase()
      .replaceAll(' ', '-');
    let portalId = `portal-${base}`;
    let suffix = 2;
    while (layout.portals.some((portal) => portal.id === portalId)) {
      portalId = `portal-${base}-${suffix}`;
      suffix += 1;
    }

    const fromWorld = new THREE.Vector2(fromCut.position[0], fromCut.position[2]);
    const toWorld = new THREE.Vector2(toCut.position[0], toCut.position[2]);
    const width = Math.max(fromCut.size[2], toCut.size[2], 5);
    const fromSocketId = `opening-${portalId.replace(/^portal-/, '')}-from`;
    const toSocketId = `opening-${portalId.replace(/^portal-/, '')}-to`;
    const fromSocket = makeSocket(
      fromSocketId,
      fromRoom,
      fromWorld,
      toWorld,
      fromCut,
    );
    const toSocket = makeSocket(
      toSocketId,
      toRoom,
      toWorld,
      fromWorld,
      toCut,
    );
    const portal: SplatLayoutPortal = {
      id: portalId,
      fromRoomId: fromRoom.id,
      toRoomId: toRoom.id,
      fromSocketId,
      toSocketId,
      fromClipId: fromCut.id,
      toClipId: toCut.id,
      traversalPolygon: corridorPolygon(fromWorld, toWorld, width, 1.25),
      transitionPolygon: corridorPolygon(fromWorld, toWorld, Math.max(2.2, width * 0.55), 0.2),
      width,
      enabled: false,
      residency: {
        requiredAssetIds: [fromRoom.assetId, toRoom.assetId],
        minimumActiveSplats: 0,
      },
    };

    fromRoom.doorwaySockets.push(fromSocket);
    toRoom.doorwaySockets.push(toSocket);
    layout.portals.push(portal);
    fromCut.portalId = portalId;
    toCut.portalId = portalId;
    claimed.add(fromCut.id);
    claimed.add(toCut.id);

    // Stamp overlapping room trims so they share doorway ownership.
    for (const trim of layout.trimPlanes as SplatTrimPlane[]) {
      if (!trim.enabled || trim.portalId) continue;
      if (trim.roomId !== fromCut.roomId && trim.roomId !== toCut.roomId) {
        continue;
      }
      const dist = Math.hypot(
        trim.position[0] - fromCut.position[0],
        trim.position[2] - fromCut.position[2],
      );
      const distB = Math.hypot(
        trim.position[0] - toCut.position[0],
        trim.position[2] - toCut.position[2],
      );
      if (Math.min(dist, distB) <= CUT_DOORWAY_PAIR_MAX_DIST_M) {
        trim.portalId = portalId;
      }
    }

    notes.push(
      `linked ${roomShortLabel(fromRoom.id)} ↔ ${roomShortLabel(toRoom.id)}`,
    );
  }
  return notes;
}
