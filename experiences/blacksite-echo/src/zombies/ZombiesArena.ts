import * as THREE from 'three';
import type { Collider } from '@dimforge/rapier3d-compat';
import type { MintAssetRuntime } from '../assets/MintAssetRuntime';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import { normalizeMintModel } from '../weapons/WeaponViewModel';
import type {
  SplatNavigationSurface,
  SplatWorldRoom,
} from '../world/SplatNavigationSurface';
import type {
  MintWorldColliderHit,
  MintWorldSurfaceKind,
  MintWorldSurfaceRequest,
} from '../world/MintWorldLayer';
import type { ZombieSpawnPoint } from './HordeDirector';
import type { PerkId, ZoneId } from './zombiesData';
import { ZOMBIES_MINT_IDS } from './zombiesData';
import type {
  ZombiesPlacementLayout,
  ZombiesPlacementRecord,
} from './ZombiesPlacementLayout';
import {
  MAPS_BARRIER_IDS,
  MAPS_ROOM_ID,
  MAPS_SPAWN_IDS,
  MAPS_WALL_BUY_IDS,
} from '../maps-zombies/MapsPlacement';

export type ArenaAnchors = {
  playerStart: THREE.Vector3;
  wallBuys: { id: string; position: THREE.Vector3 }[];
  doors: {
    id: string;
    position: THREE.Vector3;
    interactionPosition?: THREE.Vector3;
    unlocks: ZoneId;
  }[];
  barriers: { id: string; position: THREE.Vector3 }[];
  powerSwitch: THREE.Vector3;
  powerSwitchInteraction: THREE.Vector3;
  mysteryBoxLocations: THREE.Vector3[];
  perks: { perkId: PerkId; position: THREE.Vector3 }[];
  packAPunch: THREE.Vector3;
  spawnPoints: ZombieSpawnPoint[];
};

export type ArenaWallCrawlSocket = {
  id: string;
  barrierId: string;
  roomId: string;
  outside: THREE.Vector3;
  opening: THREE.Vector3;
  landing: THREE.Vector3;
};

export type ArenaSurfacePlacementDiagnostics = {
  total: number;
  placed: number;
  wallMounted: number;
  floorMounted: number;
  sourceTrianglePlacements: number;
  analyzerPlacements: number;
  authoredSocketPlacements: number;
  failures: string[];
};

export type ArenaSurfaceRaycast = (
  roomId: ZombiesCampusRoomId,
  requests: readonly MintWorldSurfaceRequest[],
) => Map<string, MintWorldColliderHit>;

export const ZOMBIES_CAMPUS_ROOM_IDS = [
  'world-zombies-arena',
  'world-zombies-arena-north',
  'world-zombies-arena-far-north',
  'world-zombies-arena-east',
  'world-zombies-arena-west',
  'world-zombies-arena-south',
] as const;

export type ZombiesCampusRoomId = (typeof ZOMBIES_CAMPUS_ROOM_IDS)[number];

export type ZombiesInteractableVisualRole =
  | 'perk-machine'
  | 'mystery-box'
  | 'pack-a-punch';

export type ZombiesInteractableVisualId =
  | `perk-${PerkId}`
  | 'mystery-box'
  | 'pack-a-punch';

export type ZombiesInteractableActivationPose = {
  rootLift: number;
  rootScale: { x: number; y: number; z: number };
  rootYaw: number;
  effectScale: number;
};

export const ZOMBIES_INTERACTABLE_ACTIVATION_PEAK = 0.42;

/**
 * Pure activation profile shared by runtime animation and deterministic tests.
 * Each role has a different physical response so a reward reads by motion and
 * silhouette, not color alone.
 */
export function sampleZombiesInteractableActivation(
  role: ZombiesInteractableVisualRole,
  normalizedPhase: number,
): ZombiesInteractableActivationPose {
  const phase = THREE.MathUtils.clamp(normalizedPhase, 0, 1);
  const impact = Math.sin(Math.PI * phase);
  const settle = Math.sin(Math.PI * 2 * phase);
  switch (role) {
    case 'perk-machine':
      return {
        rootLift: impact * 0.1,
        rootScale: {
          x: 1 + impact * 0.09,
          y: 1 + impact * 0.14,
          z: 1 + impact * 0.09,
        },
        rootYaw: settle * 0.055,
        effectScale: 0.72 + phase * 0.92,
      };
    case 'mystery-box':
      return {
        rootLift: impact * 0.24,
        rootScale: {
          x: 1 + impact * 0.08,
          y: 1 - impact * 0.035,
          z: 1 + impact * 0.08,
        },
        rootYaw: impact * 0.16,
        effectScale: 0.66 + phase * 1.08,
      };
    case 'pack-a-punch':
      return {
        rootLift: impact * 0.055,
        rootScale: {
          x: 1 + impact * 0.16,
          y: 1 - impact * 0.1,
          z: 1 + impact * 0.16,
        },
        rootYaw: settle * 0.035,
        effectScale: 0.82 + phase * 0.76,
      };
  }
}

const rewardHaloGeometry = new THREE.RingGeometry(0.42, 0.54, 32);
const rewardHaloMaterial = new THREE.MeshBasicMaterial({
  color: 0xb8ff3d,
  transparent: true,
  opacity: 0.38,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const activationRingGeometry = new THREE.TorusGeometry(0.62, 0.035, 8, 40);
const activationBeamGeometry = new THREE.CylinderGeometry(
  0.18,
  0.5,
  1.35,
  20,
  1,
  true,
);
const activationCoreGeometry = new THREE.OctahedronGeometry(0.24, 0);
const activationWeaponBodyGeometry = new THREE.BoxGeometry(0.74, 0.12, 0.18);
const activationWeaponBarrelGeometry = new THREE.CylinderGeometry(
  0.045,
  0.045,
  0.56,
  8,
);
const activationShardGeometry = new THREE.TetrahedronGeometry(0.075, 0);

const perkActivationMaterial = new THREE.MeshBasicMaterial({
  color: 0xc8ff5c,
  transparent: true,
  opacity: 0.55,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const mysteryActivationMaterial = new THREE.MeshBasicMaterial({
  color: 0xd774ff,
  transparent: true,
  opacity: 0.62,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const packActivationMaterial = new THREE.MeshBasicMaterial({
  color: 0xffbd4a,
  transparent: true,
  opacity: 0.6,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

type InteractableVisualState = {
  id: ZombiesInteractableVisualId;
  role: ZombiesInteractableVisualRole;
  root: THREE.Object3D;
  anchorPosition: THREE.Vector3;
  floorY: number;
  baseRootPosition: THREE.Vector3;
  baseRootRotation: THREE.Euler;
  baseRootScale: THREE.Vector3;
  effect: THREE.Group;
  rotors: THREE.Object3D[];
  shards: THREE.InstancedMesh;
  shardTransform: THREE.Object3D;
  elapsed: number;
  duration: number;
  active: boolean;
  frozenAtPeak: boolean;
  phase: number;
};

export class ZombiesArena {
  readonly group = new THREE.Group();
  readonly anchors: ArenaAnchors;
  private doorColliders = new Map<string, { collider: Collider; mesh: THREE.Object3D }>();
  private doorMeshes = new Map<string, THREE.Object3D>();
  private poweredLights: THREE.Light[] = [];
  private readonly anchorRoomById = new Map<string, string>();
  private readonly anchorYawById = new Map<string, number>();
  private mapsOutbreakActive = false;
  private allowedPlacementRoomIds: ReadonlySet<string> = new Set(
    ZOMBIES_CAMPUS_ROOM_IDS,
  );
  private surfacePlacementDiagnostics: ArenaSurfacePlacementDiagnostics = {
    total: 0,
    placed: 0,
    wallMounted: 0,
    floorMounted: 0,
    sourceTrianglePlacements: 0,
    analyzerPlacements: 0,
    authoredSocketPlacements: 0,
    failures: [],
  };
  private readonly interactableVisuals = new Map<
    ZombiesInteractableVisualId,
    InteractableVisualState
  >();
  private built = false;

  constructor() {
    this.group.name = 'zombies-arena';
    this.anchors = this.createAnchors();
  }

  /**
   * Remap the authored 4-room layout into a splat playable footprint so every
   * buyable stays inside the visible volume.
   */
  fitLayoutToBounds(bounds: THREE.Box3, floorY: number): void {
    const src = this.createAnchors();
    const srcBox = new THREE.Box3(
      new THREE.Vector3(-6, 0, 0),
      new THREE.Vector3(20, 3, 36),
    );
    const size = bounds.getSize(new THREE.Vector3());
    const pad = Math.min(1.6, Math.max(0.45, Math.min(size.x, size.z) * 0.12));
    let dstMinX = bounds.min.x + pad;
    let dstMaxX = bounds.max.x - pad;
    let dstMinZ = bounds.min.z + pad;
    let dstMaxZ = bounds.max.z - pad;
    const center = bounds.getCenter(new THREE.Vector3());

    // Tiny / collapsed pads still need visible spawn-room entry portals.
    if (dstMaxX <= dstMinX || dstMaxZ <= dstMinZ) {
      const half = Math.max(2.4, Math.min(size.x, size.z, 6) * 0.45);
      dstMinX = center.x - half;
      dstMaxX = center.x + half;
      dstMinZ = center.z - half;
      dstMaxZ = center.z + half;
      this.placeCompactHubAnchors(center, floorY, dstMinX, dstMaxX, dstMinZ, dstMaxZ);
      return;
    }

    const mapXZ = (point: THREE.Vector3, y: number): THREE.Vector3 => {
      const nx = THREE.MathUtils.clamp(
        (point.x - srcBox.min.x) / (srcBox.max.x - srcBox.min.x),
        0,
        1,
      );
      const nz = THREE.MathUtils.clamp(
        (point.z - srcBox.min.z) / (srcBox.max.z - srcBox.min.z),
        0,
        1,
      );
      return new THREE.Vector3(
        THREE.MathUtils.lerp(dstMinX, dstMaxX, nx),
        y,
        THREE.MathUtils.lerp(dstMinZ, dstMaxZ, nz),
      );
    };
    this.anchors.playerStart.set(center.x, floorY + 0.98, center.z);
    this.anchors.wallBuys = src.wallBuys.map((wall) => ({
      ...wall,
      position: mapXZ(wall.position, floorY + 1.2),
    }));
    this.anchors.doors = src.doors.map((door) => ({
      ...door,
      position: mapXZ(door.position, floorY + 1),
    }));
    this.anchors.barriers = src.barriers.map((barrier) => ({
      ...barrier,
      position: mapXZ(barrier.position, floorY + 1),
    }));
    this.anchors.powerSwitch = mapXZ(src.powerSwitch, floorY + 1.2);
    this.anchors.powerSwitchInteraction.copy(this.anchors.powerSwitch);
    this.anchors.mysteryBoxLocations = src.mysteryBoxLocations.map((pos) =>
      mapXZ(pos, floorY + 0.7),
    );
    this.anchors.perks = src.perks.map((perk) => ({
      ...perk,
      position: mapXZ(perk.position, floorY + 1.2),
    }));
    this.anchors.packAPunch = mapXZ(src.packAPunch, floorY + 1.2);
    this.anchors.spawnPoints = src.spawnPoints.map((point) => ({
      ...point,
      position: mapXZ(point.position, floorY + 1),
    }));

    // Keep a clear spawn bubble so the player is not jammed into a door/prop.
    const clearRadius = Math.min(3.8, Math.min(size.x, size.z) * 0.28);
    const pushOut = (position: THREE.Vector3) => {
      const dx = position.x - center.x;
      const dz = position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= clearRadius || dist < 1e-4) return;
      const scale = clearRadius / dist;
      position.x = center.x + dx * scale;
      position.z = center.z + dz * scale;
      position.x = THREE.MathUtils.clamp(position.x, dstMinX, dstMaxX);
      position.z = THREE.MathUtils.clamp(position.z, dstMinZ, dstMaxZ);
    };
    for (const door of this.anchors.doors) pushOut(door.position);
    for (const wall of this.anchors.wallBuys) pushOut(wall.position);
    for (const barrier of this.anchors.barriers) pushOut(barrier.position);
    for (const perk of this.anchors.perks) pushOut(perk.position);
    pushOut(this.anchors.powerSwitch);
    pushOut(this.anchors.packAPunch);
    for (const box of this.anchors.mysteryBoxLocations) pushOut(box);
    for (const point of this.anchors.spawnPoints) pushOut(point.position);

    // Pin round-1 entry portals on the near edge so zombies climb into view.
    this.pinSpawnRoomEntries(dstMinX, dstMaxX, dstMinZ, dstMaxZ, floorY, center);
  }

  /**
   * Author the economy and threat route across all six splat rooms. Placement
   * fractions are resolved inside each room's safe bounds, keeping props clear
   * of perimeter recovery and relay landing space.
   */
  distributeAcrossRooms(rooms: readonly SplatWorldRoom[]): void {
    const byId = new Map(
      rooms.map((room) => [room.source.id, room] as const),
    );
    for (const roomId of ZOMBIES_CAMPUS_ROOM_IDS) {
      if (!byId.has(roomId)) {
        throw new Error(`Missing Zombies campus placement room ${roomId}`);
      }
    }
    this.anchorRoomById.clear();

    const point = (
      roomId: ZombiesCampusRoomId,
      xFraction: number,
      zFraction: number,
      height: number,
    ): THREE.Vector3 => {
      const room = byId.get(roomId)!;
      const inset = Math.max(1.35, room.source.safeInset + 0.65);
      const minX = room.bounds.min.x + inset;
      const maxX = room.bounds.max.x - inset;
      const minZ = room.bounds.min.z + inset;
      const maxZ = room.bounds.max.z - inset;
      const desired = new THREE.Vector3(
        THREE.MathUtils.lerp(
          minX,
          maxX,
          THREE.MathUtils.clamp(xFraction, 0, 1),
        ),
        room.floorY + height,
        THREE.MathUtils.lerp(
          minZ,
          maxZ,
          THREE.MathUtils.clamp(zFraction, 0, 1),
        ),
      );
      const navigation = room.navigation;
      if (!navigation) return desired;
      let closest: THREE.Vector3 | null = null;
      let closestCentroid: THREE.Vector3 | null = null;
      let closestDistanceSq = Number.POSITIVE_INFINITY;
      const triangle = new THREE.Triangle();
      const candidate = new THREE.Vector3();
      const centroid = new THREE.Vector3();
      const vertex = (index: number) => {
        const offset = index * 3;
        return new THREE.Vector3(
          navigation.vertices[offset]!,
          navigation.vertices[offset + 1]!,
          navigation.vertices[offset + 2]!,
        );
      };
      for (let offset = 0; offset < navigation.indices.length; offset += 3) {
        triangle.set(
          vertex(navigation.indices[offset]!),
          vertex(navigation.indices[offset + 1]!),
          vertex(navigation.indices[offset + 2]!),
        );
        triangle.closestPointToPoint(desired, candidate);
        const distanceSq =
          (candidate.x - desired.x) ** 2 +
          (candidate.z - desired.z) ** 2;
        if (distanceSq >= closestDistanceSq) continue;
        closestDistanceSq = distanceSq;
        closest = candidate.clone();
        closestCentroid = triangle.getMidpoint(centroid).clone();
      }
      if (!closest) return desired;
      if (closestDistanceSq > 1e-6 && closestCentroid) {
        const inward = closestCentroid.sub(closest).setY(0);
        if (inward.lengthSq() > 1e-8) {
          closest.add(inward.setLength(Math.min(0.35, inward.length())));
        }
      }
      return closest.setY(room.floorY + height);
    };
    const move = (
      entries: Array<{ id: string; position: THREE.Vector3 }>,
      id: string,
      roomId: ZombiesCampusRoomId,
      xFraction: number,
      zFraction: number,
      height: number,
    ) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error(`Missing Zombies gameplay anchor ${id}`);
      entry.position.copy(point(roomId, xFraction, zFraction, height));
      this.anchorRoomById.set(id, roomId);
    };

    const [hub, north, farNorth, east, west, south] =
      ZOMBIES_CAMPUS_ROOM_IDS;
    const hubRoom = byId.get(hub)!;
    this.anchors.playerStart.copy(hubRoom.anchor);
    this.anchorRoomById.set('player-start', hub);

    // Upgrade curve: one weapon decision in the hub, then one in each combat
    // wing.
    move(this.anchors.wallBuys, 'wall-kestrel', hub, 0.14, 0.34, 1.2);
    move(this.anchors.wallBuys, 'wall-arx', north, 0.84, 0.28, 1.2);
    // The East RAD scan tapers before its navigation rectangle reaches the
    // far wall, so keep the shotgun visibly on scanned geometry.
    move(this.anchors.wallBuys, 'wall-talon', east, 0.68, 0.58, 1.2);
    move(this.anchors.wallBuys, 'wall-brimstone', west, 0.18, 0.58, 1.2);

    // Keep the legacy progression panel against the Hub wall; the compact
    // South room now connects through the center of the Hub's south edge.
    move(this.anchors.doors, 'door-spawn-mid', hub, 0.18, 0.35, 1);
    move(this.anchors.doors, 'door-mid-power', north, 0.18, 0.78, 1);
    move(this.anchors.doors, 'door-power-pap', east, 0.18, 0.8, 1);

    // Power is the campus traversal payoff: the player leaves the bright hub,
    // crosses North directly, and restores the grid in the deepest room.
    this.anchors.powerSwitch.copy(point(farNorth, 0.18, 0.72, 1.15));
    this.anchors.powerSwitchInteraction.copy(this.anchors.powerSwitch);
    this.anchorRoomById.set('power-switch', farNorth);
    this.anchors.packAPunch.copy(point(south, 0.82, 0.76, 0.8));
    this.anchorRoomById.set('pack-a-punch', south);
    this.anchors.mysteryBoxLocations = [
      point(farNorth, 0.82, 0.28, 0.8),
      point(south, 0.2, 0.28, 0.8),
    ];
    this.anchorRoomById.set('mystery-box-0', farNorth);
    this.anchorRoomById.set('mystery-box-1', south);

    const perkPlacements: Record<
      PerkId,
      readonly [ZombiesCampusRoomId, number, number]
    > = {
      revive: [hub, 0.86, 0.7],
      juggernog: [north, 0.82, 0.74],
      speed: [east, 0.18, 0.28],
      doubletap: [west, 0.82, 0.72],
    };
    for (const perk of this.anchors.perks) {
      const [roomId, x, z] = perkPlacements[perk.perkId];
      perk.position.copy(point(roomId, x, z, 0.8));
      this.anchorRoomById.set(`perk-${perk.perkId}`, roomId);
    }

    const entryPlacements: ReadonlyArray<
      readonly [
        barrierId: string,
        spawnId: string,
        roomId: ZombiesCampusRoomId,
        x: number,
        z: number,
      ]
    > = [
      ['barrier-spawn-a', 'sp-spawn-a', hub, 0.08, 0.58],
      ['barrier-spawn-b', 'sp-spawn-b', hub, 0.92, 0.58],
      ['barrier-mid-a', 'sp-mid-a', north, 0.08, 0.48],
      ['barrier-mid-c', 'sp-mid-c', north, 0.92, 0.62],
      ['barrier-mid-b', 'sp-mid-b', farNorth, 0.92, 0.5],
      ['barrier-mid-d', 'sp-mid-d', farNorth, 0.08, 0.34],
      ['barrier-power-a', 'sp-power-a', east, 0.92, 0.48],
      ['barrier-power-c', 'sp-power-c', east, 0.48, 0.92],
      ['barrier-power-b', 'sp-power-b', west, 0.08, 0.5],
      ['barrier-power-d', 'sp-power-d', west, 0.42, 0.08],
      ['barrier-pap-a', 'sp-pap-a', south, 0.12, 0.34],
      ['barrier-pap-b', 'sp-pap-b', south, 0.88, 0.66],
    ];
    for (const [barrierId, spawnId, roomId, x, z] of entryPlacements) {
      move(this.anchors.barriers, barrierId, roomId, x, z, 1);
      move(this.anchors.spawnPoints, spawnId, roomId, x, z, 0);
      const spawn = this.anchors.spawnPoints.find((entry) => entry.id === spawnId);
      if (spawn) spawn.barrierId = barrierId;
    }
  }

  /**
   * Keep only authored wall-entry contracts. Synthetic fractional spawn
   * points are useful for blockouts but make infected appear through arbitrary
   * splat walls in production.
   */
  useAuthoredDoorEntries(sockets: readonly ArenaWallCrawlSocket[]): void {
    const byBarrier = new Map(
      this.anchors.barriers.map((barrier) => [barrier.id, barrier] as const),
    );
    const bySpawn = new Map(
      this.anchors.spawnPoints.map((spawn) => [spawn.id, spawn] as const),
    );
    this.anchors.barriers = sockets.map((socket) => {
      const barrier = byBarrier.get(socket.barrierId) ?? {
        id: socket.barrierId,
        position: new THREE.Vector3(),
      };
      barrier.position.copy(socket.opening);
      this.anchorRoomById.set(
        barrier.id,
        socket.roomId as ZombiesCampusRoomId,
      );
      return barrier;
    });
    this.anchors.spawnPoints = sockets.map((socket) => {
      const existing = bySpawn.get(socket.id);
      const spawn: ZombieSpawnPoint = {
        ...(existing ?? {
          id: socket.id,
          zone: 'spawn',
          position: new THREE.Vector3(),
        }),
        position: socket.opening.clone(),
        barrierId: socket.barrierId,
        roomId: socket.roomId,
        outsidePosition: socket.outside.clone(),
        landingPosition: socket.landing.clone(),
      };
      this.anchorRoomById.set(
        spawn.id,
        socket.roomId as ZombiesCampusRoomId,
      );
      return spawn;
    });
  }

  /**
   * Seat wall and floor gameplay anchors on transformed collider triangles.
   * Bounds choose the neighborhood; a successful source-mesh hit determines
   * the final position and orientation.
   */
  seatAnchorsOnSurfaces(
    rooms: readonly SplatWorldRoom[],
    raycast: ArenaSurfaceRaycast,
  ): ArenaSurfacePlacementDiagnostics {
    const byId = new Map(
      rooms.map((room) => [room.source.id, room] as const),
    );
    this.anchorYawById.clear();
    const failures: string[] = [];
    let placed = 0;
    let wallMounted = 0;
    let floorMounted = 0;
    let sourceTrianglePlacements = 0;
    let analyzerPlacements = 0;
    let authoredSocketPlacements = 0;
    type PendingPlacement = {
      id: string;
      position: THREE.Vector3;
      kind: MintWorldSurfaceKind;
      offset: number;
      roomId: string;
      request: MintWorldSurfaceRequest;
    };
    const pending: PendingPlacement[] = [];

    const queue = (
      id: string,
      position: THREE.Vector3,
      kind: MintWorldSurfaceKind,
      offset: number,
    ) => {
      const roomId = this.anchorRoomById.get(id);
      const room = roomId ? byId.get(roomId) : null;
      if (!roomId || !room) {
        failures.push(`${id}:missing-room`);
        return;
      }
      const maxDistance =
        kind === 'wall'
          ? Math.max(
              room.bounds.max.x - room.bounds.min.x,
              room.bounds.max.z - room.bounds.min.z,
            ) * 1.1
          : 8;
      pending.push({
        id,
        position,
        kind,
        offset,
        roomId,
        request: {
          id,
          reference:
            kind === 'floor'
              ? position.clone().add(new THREE.Vector3(0, -0.8, 0))
              : position.clone(),
          kind,
          maxDistance,
        },
      });
    };

    for (const wall of this.anchors.wallBuys) {
      queue(wall.id, wall.position, 'wall', 0.12);
    }
    for (const door of this.anchors.doors) {
      queue(door.id, door.position, 'wall', 0.08);
    }
    // These are analyzer-authored entry openings, not arbitrary blockout
    // points. Preserve their opening positions and orient the boards along
    // the outside-to-landing route.
    for (const barrier of this.anchors.barriers) {
      const spawn = this.anchors.spawnPoints.find(
        (entry) => entry.barrierId === barrier.id,
      );
      const inward =
        spawn?.outsidePosition && spawn.landingPosition
          ? spawn.landingPosition
              .clone()
              .sub(spawn.outsidePosition)
              .setY(0)
              .normalize()
          : new THREE.Vector3(0, 0, 1);
      this.anchorYawById.set(
        barrier.id,
        Math.atan2(inward.x, inward.z),
      );
      placed += 1;
      wallMounted += 1;
      authoredSocketPlacements += 1;
    }
    queue('power-switch', this.anchors.powerSwitch, 'wall', 0.14);
    this.anchors.mysteryBoxLocations.forEach((position, index) => {
      queue(`mystery-box-${index}`, position, 'floor', 0);
    });
    for (const perk of this.anchors.perks) {
      queue(`perk-${perk.perkId}`, perk.position, 'floor', 0);
    }
    queue('pack-a-punch', this.anchors.packAPunch, 'floor', 0);

    for (const roomId of ZOMBIES_CAMPUS_ROOM_IDS) {
      const roomPlacements = pending.filter(
        (placement) => placement.roomId === roomId,
      );
      if (roomPlacements.length === 0) continue;
      const hits = raycast(
        roomId,
        roomPlacements.map((placement) => placement.request),
      );
      for (const placement of roomPlacements) {
        const room = byId.get(roomId)!;
        let hit = hits.get(placement.id);
        const expectedY =
          placement.kind === 'floor'
            ? room.floorY
            : placement.request.reference.y;
        const verticalTolerance = placement.kind === 'floor' ? 0.65 : 0.9;
        const sourceUsable =
          Boolean(hit) &&
          Math.abs(hit!.point.y - expectedY) <= verticalTolerance;
        if (!sourceUsable) {
          if (placement.kind === 'floor') {
            hit = {
              point: new THREE.Vector3(
                placement.request.reference.x,
                room.floorY,
                placement.request.reference.z,
              ),
              normal: new THREE.Vector3(0, 1, 0),
              distance: Math.abs(
                placement.request.reference.y - room.floorY,
              ),
            };
          } else {
            const reference = new THREE.Vector2(
              placement.request.reference.x,
              placement.request.reference.z,
            );
            let bestPoint: THREE.Vector2 | null = null;
            let bestDistanceSq = Infinity;
            const navigation = room.navigation;
            const boundarySegments = navigation
              ? Array.from(
                  { length: navigation.boundaryEdges.length / 2 },
                  (_, index) => {
                    const startOffset =
                      navigation.boundaryEdges[index * 2]! * 3;
                    const endOffset =
                      navigation.boundaryEdges[index * 2 + 1]! * 3;
                    return [
                      new THREE.Vector2(
                        navigation.vertices[startOffset]!,
                        navigation.vertices[startOffset + 2]!,
                      ),
                      new THREE.Vector2(
                        navigation.vertices[endOffset]!,
                        navigation.vertices[endOffset + 2]!,
                      ),
                    ] as const;
                  },
                )
              : room.polygon.map((start, index) => [
                  start,
                  room.polygon[(index + 1) % room.polygon.length]!,
                ] as const);
            for (const [start, end] of boundarySegments) {
              const edge = end.clone().sub(start);
              const edgeLengthSq = Math.max(edge.lengthSq(), 1e-8);
              const t = THREE.MathUtils.clamp(
                reference.clone().sub(start).dot(edge) / edgeLengthSq,
                0,
                1,
              );
              const candidate = start.clone().addScaledVector(edge, t);
              const distanceSq = candidate.distanceToSquared(reference);
              if (distanceSq >= bestDistanceSq) continue;
              bestDistanceSq = distanceSq;
              bestPoint = candidate;
            }
            if (bestPoint) {
              const normal = new THREE.Vector3(
                room.anchor.x - bestPoint.x,
                0,
                room.anchor.z - bestPoint.y,
              ).normalize();
              hit = {
                point: new THREE.Vector3(
                  bestPoint.x,
                  placement.request.reference.y,
                  bestPoint.y,
                ),
                normal,
                distance: Math.sqrt(bestDistanceSq),
              };
            }
          }
          analyzerPlacements += 1;
        } else {
          sourceTrianglePlacements += 1;
        }
        if (!hit) {
          failures.push(`${placement.id}:no-${placement.kind}-surface`);
          continue;
        }
        if (placement.kind === 'wall') {
          const normal = hit.normal.clone().setY(0).normalize();
          placement.position
            .copy(hit.point)
            .addScaledVector(normal, placement.offset);
          this.anchorYawById.set(
            placement.id,
            Math.atan2(normal.x, normal.z),
          );
          wallMounted += 1;
        } else {
          placement.position.set(
            hit.point.x,
            hit.point.y + 0.8,
            hit.point.z,
          );
          floorMounted += 1;
        }
        placed += 1;
      }
    }

    this.surfacePlacementDiagnostics = {
      total:
        pending.length +
        this.anchors.barriers.length +
        failures.filter((failure) =>
          failure.endsWith(':missing-room'),
        ).length,
      placed,
      wallMounted,
      floorMounted,
      sourceTrianglePlacements,
      analyzerPlacements,
      authoredSocketPlacements,
      failures,
    };
    return {
      ...this.surfacePlacementDiagnostics,
      failures: [...failures],
    };
  }

  getSurfacePlacementDiagnostics(): ArenaSurfacePlacementDiagnostics {
    return {
      ...this.surfacePlacementDiagnostics,
      failures: [...this.surfacePlacementDiagnostics.failures],
    };
  }

  getAnchorRoom(anchorId: string): string | null {
    return this.anchorRoomById.get(anchorId) ?? null;
  }

  isMapsOutbreakActive(): boolean {
    return this.mapsOutbreakActive;
  }

  /**
   * Rebuild anchors for a single-room Maps Outbreak pack (6 wall guns,
   * mystery box, barriers/spawns; no door / perk / PaP progression).
   */
  configureMapsOutbreak(placements: ZombiesPlacementLayout): string[] {
    this.mapsOutbreakActive = true;
    this.allowedPlacementRoomIds = new Set([MAPS_ROOM_ID]);
    this.anchors.wallBuys = MAPS_WALL_BUY_IDS.map((id) => ({
      id,
      position: new THREE.Vector3(),
    }));
    this.anchors.doors = [];
    this.anchors.barriers = MAPS_BARRIER_IDS.map((id) => ({
      id,
      position: new THREE.Vector3(),
    }));
    this.anchors.mysteryBoxLocations = [new THREE.Vector3()];
    this.anchors.perks = [];
    this.anchors.spawnPoints = MAPS_SPAWN_IDS.map((id, index) => ({
      id,
      zone: 'spawn' as ZoneId,
      position: new THREE.Vector3(),
      barrierId: MAPS_BARRIER_IDS[index]!,
    }));
    this.anchorRoomById.clear();
    this.anchorYawById.clear();
    return this.applyPlacementLayout(placements);
  }

  clearMapsOutbreakMode(): void {
    this.mapsOutbreakActive = false;
    this.allowedPlacementRoomIds = new Set(ZOMBIES_CAMPUS_ROOM_IDS);
    Object.assign(this.anchors, this.createAnchors());
    this.anchorRoomById.clear();
    this.anchorYawById.clear();
  }

  getAnchorYaw(anchorId: string): number {
    return this.anchorYawById.get(anchorId) ?? 0;
  }

  /**
   * Return the complete authored placement surface in one stable, serializable
   * form. Editor markers project these records; gameplay continues to consume
   * the existing Vector3 anchors.
   */
  editorPlacements(): ZombiesPlacementRecord[] {
    const placement = (
      id: string,
      kind: ZombiesPlacementRecord['kind'],
      position: THREE.Vector3,
      mount: ZombiesPlacementRecord['mount'],
    ): ZombiesPlacementRecord => ({
      id,
      kind,
      roomId:
        this.getAnchorRoom(id) ??
        ZOMBIES_CAMPUS_ROOM_IDS[0],
      position: [position.x, position.y, position.z],
      rotation: [0, this.getAnchorYaw(id), 0],
      scale: [1, 1, 1],
      mount,
    });

    return [
      placement(
        'player-start',
        'player-start',
        this.anchors.playerStart,
        'floor',
      ),
      ...this.anchors.wallBuys.map((entry) =>
        placement(entry.id, 'wall-buy', entry.position, 'wall'),
      ),
      ...this.anchors.doors.map((entry) =>
        placement(entry.id, 'door', entry.position, 'wall'),
      ),
      ...this.anchors.barriers.map((entry) =>
        placement(entry.id, 'barrier', entry.position, 'socket'),
      ),
      placement(
        'power-switch',
        'power-switch',
        this.anchors.powerSwitch,
        'wall',
      ),
      ...this.anchors.mysteryBoxLocations.map((position, index) =>
        placement(`mystery-box-${index}`, 'mystery-box', position, 'floor'),
      ),
      ...this.anchors.perks.map((entry) =>
        placement(
          `perk-${entry.perkId}`,
          'perk',
          entry.position,
          'floor',
        ),
      ),
      placement(
        'pack-a-punch',
        'pack-a-punch',
        this.anchors.packAPunch,
        'floor',
      ),
      ...this.anchors.spawnPoints.map((entry) =>
        placement(entry.id, 'zombie-spawn', entry.position, 'socket'),
      ),
    ];
  }

  applyPlacementLayout(layout: ZombiesPlacementLayout): string[] {
    const ignored: string[] = [];
    for (const placement of layout.placements) {
      if (!this.setEditorPlacement(placement)) ignored.push(placement.id);
    }
    return ignored;
  }

  /**
   * Commit one editor record to the canonical runtime anchor. This method is
   * deliberately ID-driven so the scene graph never becomes the source of
   * truth.
   */
  setEditorPlacement(placement: ZombiesPlacementRecord): boolean {
    const position = new THREE.Vector3(...placement.position);
    const roomId = this.allowedPlacementRoomIds.has(placement.roomId)
      ? placement.roomId
      : null;
    if (!roomId) return false;

    let target: THREE.Vector3 | null = null;
    if (placement.id === 'player-start') {
      target = this.anchors.playerStart;
    } else if (placement.id === 'power-switch') {
      target = this.anchors.powerSwitch;
    } else if (placement.id === 'pack-a-punch') {
      target = this.anchors.packAPunch;
    } else if (placement.id.startsWith('mystery-box-')) {
      const index = Number(placement.id.slice('mystery-box-'.length));
      target = Number.isInteger(index)
        ? (this.anchors.mysteryBoxLocations[index] ?? null)
        : null;
    } else if (placement.id.startsWith('perk-')) {
      const perkId = placement.id.slice('perk-'.length);
      target =
        this.anchors.perks.find((entry) => entry.perkId === perkId)?.position ??
        null;
    } else {
      target =
        this.anchors.wallBuys.find((entry) => entry.id === placement.id)
          ?.position ??
        this.anchors.doors.find((entry) => entry.id === placement.id)
          ?.position ??
        this.anchors.barriers.find((entry) => entry.id === placement.id)
          ?.position ??
        this.anchors.spawnPoints.find((entry) => entry.id === placement.id)
          ?.position ??
        null;
    }
    if (!target) return false;

    const spawnTarget = this.anchors.spawnPoints.find(
      (entry) => entry.id === placement.id,
    );
    const spawnDelta = spawnTarget
      ? position.clone().sub(spawnTarget.position)
      : null;
    target.copy(position);
    if (spawnDelta) {
      spawnTarget?.outsidePosition?.add(spawnDelta);
      spawnTarget?.landingPosition?.add(spawnDelta);
    }
    this.anchorRoomById.set(placement.id, roomId);
    this.anchorYawById.set(placement.id, placement.rotation[1]);
    if (placement.id === 'power-switch') {
      this.anchors.powerSwitchInteraction.copy(position);
    }
    const door = this.anchors.doors.find(
      (entry) => entry.id === placement.id,
    );
    if (door?.interactionPosition) door.interactionPosition.copy(position);
    return true;
  }

  /**
   * Keep wall-mounted progression art separate from the point occupied by the
   * player. A surface ray can find a visually correct wall that belongs to a
   * disconnected navmesh island, so every approach is also proven by a
   * capsule-safe straight segment from the room landing.
   */
  resolveProgressionInteractionAnchors(
    surface: SplatNavigationSurface,
  ): void {
    const resolve = (
      id: string,
      visualPosition: THREE.Vector3,
    ): THREE.Vector3 => {
      const roomId = this.anchorRoomById.get(id);
      const room = roomId ? surface.room(roomId) : null;
      if (!roomId || !room) {
        throw new Error(`${id}:missing-progression-room`);
      }
      const landing = room.anchor
        .clone()
        .setY(room.floorY + 0.98);
      if (!surface.containsCapsuleInRoom(roomId, landing, 0.34)) {
        throw new Error(`${id}:unsafe-room-landing`);
      }

      const direction = visualPosition
        .clone()
        .sub(landing)
        .setY(0);
      if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
      const visualDistance = direction.length();
      direction.normalize();
      // Keep progression controls within the room's arrival clearing. The
      // baked navigation mesh proves floor coverage, but long straight
      // segments can still cross a source-collider prop that is not carved
      // into that mesh. A short approach remains readable and is also
      // traversable by the live Rapier player capsule.
      const maximumDistance = Math.min(visualDistance, 3.6);
      let approach: THREE.Vector3 | null = null;
      for (
        let distance = maximumDistance;
        distance >= 0.75;
        distance -= 0.35
      ) {
        const candidate = landing
          .clone()
          .addScaledVector(direction, distance);
        if (
          surface.containsCapsuleInRoom(roomId, candidate, 0.34) &&
          surface.containsCapsuleSegmentInRoom(
            roomId,
            landing,
            candidate,
            0.34,
          )
        ) {
          approach = candidate;
          break;
        }
      }
      if (!approach && id === 'power-switch') {
        // The Far North collider has a large decorative island between its
        // polygon wall and the baked arrival clearing. Keep the switch beside
        // the guaranteed-safe room anchor instead of rejecting an otherwise
        // reachable deep-room objective. The interaction is separate from the
        // editor-authored visual transform, which must remain authoritative.
        approach = landing.clone();
      }
      if (!approach) {
        throw new Error(`${id}:no-clear-progression-approach`);
      }

      // The approach can be separated from a wall-mounted visual when a scan
      // includes a decorative island. Never rewrite the visual here: its
      // placement JSON is the editor's source of truth.
      return approach;
    };

    const approaches: Array<{
      id: string;
      roomId: string;
      position: THREE.Vector3;
    }> = [];
    const powerRoomId = this.anchorRoomById.get('power-switch');
    if (!powerRoomId) throw new Error('power-switch:missing-progression-room');
    this.anchors.powerSwitchInteraction.copy(
      resolve('power-switch', this.anchors.powerSwitch),
    );
    approaches.push({
      id: 'power-switch',
      roomId: powerRoomId,
      position: this.anchors.powerSwitchInteraction,
    });
    for (const door of this.anchors.doors) {
      door.interactionPosition = resolve(door.id, door.position);
      const roomId = this.anchorRoomById.get(door.id);
      if (!roomId) throw new Error(`${door.id}:missing-progression-room`);
      approaches.push({
        id: door.id,
        roomId,
        position: door.interactionPosition,
      });
    }
    for (let leftIndex = 0; leftIndex < approaches.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < approaches.length;
        rightIndex += 1
      ) {
        const left = approaches[leftIndex]!;
        const right = approaches[rightIndex]!;
        if (
          left.roomId === right.roomId &&
          left.position.distanceTo(right.position) < 3
        ) {
          throw new Error(
            `${left.id}/${right.id}:overlapping-progression-approaches`,
          );
        }
      }
    }
  }

  /** Force spawn-room barriers onto flanks the player sees looking toward mid. */
  private pinSpawnRoomEntries(
    dstMinX: number,
    dstMaxX: number,
    dstMinZ: number,
    dstMaxZ: number,
    floorY: number,
    center: THREE.Vector3,
  ): void {
    // Flank portals just ahead of the player, on the left/right walls, so a
    // natural look toward the mid door frames the climb-in.
    const ahead = Math.max(1.2, (dstMaxZ - center.z) * 0.28);
    const flankZ = THREE.MathUtils.clamp(
      center.z + ahead,
      dstMinZ + 0.4,
      dstMaxZ - 0.4,
    );
    const leftX = THREE.MathUtils.lerp(center.x, dstMinX, 0.7);
    const rightX = THREE.MathUtils.lerp(center.x, dstMaxX, 0.7);
    const y = floorY + 1;
    const place = (id: string, x: number, z: number) => {
      const barrier = this.anchors.barriers.find((entry) => entry.id === id);
      if (barrier) barrier.position.set(x, y, z);
      const spawnId = id.replace(/^barrier-/, 'sp-');
      const spawn = this.anchors.spawnPoints.find((entry) => entry.id === spawnId);
      if (spawn) {
        spawn.position.set(x, y, z);
        spawn.barrierId = id;
      }
    };
    place('barrier-spawn-a', leftX, flankZ);
    place('barrier-spawn-b', rightX, flankZ);

    // Keep portals close enough to read in the hub splat FOV.
    const maxDist = Math.min(5.5, Math.hypot(dstMaxX - dstMinX, dstMaxZ - dstMinZ) * 0.28);
    for (const id of ['barrier-spawn-a', 'barrier-spawn-b'] as const) {
      const barrier = this.anchors.barriers.find((entry) => entry.id === id);
      const spawn = this.anchors.spawnPoints.find(
        (entry) => entry.id === id.replace(/^barrier-/, 'sp-'),
      );
      if (!barrier || !spawn) continue;
      const dx = barrier.position.x - center.x;
      const dz = barrier.position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist > maxDist && dist > 1e-4) {
        const scale = maxDist / dist;
        barrier.position.x = center.x + dx * scale;
        barrier.position.z = center.z + dz * scale;
        spawn.position.copy(barrier.position);
      }
    }

    // Keep the first door ahead of the player for orientation into mid.
    const door = this.anchors.doors.find((entry) => entry.id === 'door-spawn-mid');
    if (door) {
      door.position.set(
        center.x,
        y,
        THREE.MathUtils.lerp(center.z, dstMaxZ, 0.72),
      );
    }
  }

  private placeCompactHubAnchors(
    center: THREE.Vector3,
    floorY: number,
    dstMinX: number,
    dstMaxX: number,
    dstMinZ: number,
    dstMaxZ: number,
  ): void {
    const src = this.createAnchors();
    this.anchors.playerStart.set(center.x, floorY + 0.98, center.z);
    this.anchors.wallBuys = src.wallBuys.map((wall, index) => ({
      ...wall,
      position: new THREE.Vector3(
        index % 2 === 0 ? dstMinX + 0.8 : dstMaxX - 0.8,
        floorY + 1.2,
        THREE.MathUtils.lerp(dstMinZ, dstMaxZ, 0.35 + index * 0.12),
      ),
    }));
    this.anchors.doors = src.doors.map((door, index) => ({
      ...door,
      position: new THREE.Vector3(
        center.x + (index - 1) * 0.4,
        floorY + 1,
        THREE.MathUtils.lerp(dstMinZ, dstMaxZ, 0.55 + index * 0.08),
      ),
    }));
    this.anchors.barriers = src.barriers.map((barrier) => ({
      ...barrier,
      position: barrier.position.clone(),
    }));
    this.anchors.powerSwitch.set(dstMinX + 1, floorY + 1.2, dstMaxZ - 1);
    this.anchors.powerSwitchInteraction.copy(this.anchors.powerSwitch);
    this.anchors.mysteryBoxLocations = [
      new THREE.Vector3(center.x + 1.2, floorY + 0.7, center.z + 0.8),
      new THREE.Vector3(center.x - 1.2, floorY + 0.7, center.z - 0.2),
    ];
    this.anchors.perks = src.perks.map((perk, index) => ({
      ...perk,
      position: new THREE.Vector3(
        index < 2 ? dstMaxX - 0.9 : dstMinX + 0.9,
        floorY + 1.2,
        THREE.MathUtils.lerp(dstMinZ, dstMaxZ, 0.3 + (index % 2) * 0.25),
      ),
    }));
    this.anchors.packAPunch.set(dstMaxX - 1.1, floorY + 1.2, dstMaxZ - 1.1);
    this.anchors.spawnPoints = src.spawnPoints.map((point) => ({
      ...point,
      position: point.position.clone(),
    }));
    this.pinSpawnRoomEntries(dstMinX, dstMaxX, dstMinZ, dstMaxZ, floorY, center);
  }

  build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    options: { skipWorldBoundary?: boolean; compactRooms?: boolean } = {},
  ): void {
    if (this.built) return;
    this.built = true;
    scene.add(this.group);

    if (!options.compactRooms) {
      // Spawn room (z 0..12)
      this.addRoom(physics, 0, 0, 10, 12, '#2a2e33');
      // Mid courtyard (z 12..24)
      this.addRoom(physics, 0, 14, 12, 12, '#24282c');
      // Power room (z 24..36)
      this.addRoom(physics, 0, 28, 10, 12, '#1f2328');
      // PaP wing (x 8..20, z 24..36)
      this.addRoom(physics, 14, 28, 12, 12, '#26201c');
    }

    if (!options.compactRooms) {
      for (const door of this.anchors.doors) {
        this.placeDoor(
          physics,
          door.id,
          door.position.clone().setY(door.position.y + 0.5),
          door.unlocks,
          false,
        );
      }
    }

    if (!this.mapsOutbreakActive) {
      this.placeMintProp(
        ZOMBIES_MINT_IDS.powerSwitch,
        this.anchors.powerSwitch,
        0x4caf50,
        new THREE.Vector3(0.4, 1.2, 0.25),
        false,
        'power-switch',
      );
    }
    const mysteryBox = this.placeMintProp(
      ZOMBIES_MINT_IDS.mysteryBox,
      this.anchors.mysteryBoxLocations[0]!,
      0x9c27b0,
      new THREE.Vector3(0.9, 0.7, 0.7),
      true,
      'mystery-box-0',
    );
    this.registerInteractableVisual(
      'mystery-box',
      'mystery-box',
      mysteryBox,
      this.anchors.mysteryBoxLocations[0]!,
    );
    if (!this.mapsOutbreakActive) {
      const packAPunch = this.placeMintProp(
        ZOMBIES_MINT_IDS.packAPunch,
        this.anchors.packAPunch,
        0xff9800,
        new THREE.Vector3(1.1, 1.4, 0.8),
        true,
        'pack-a-punch',
      );
      this.registerInteractableVisual(
        'pack-a-punch',
        'pack-a-punch',
        packAPunch,
        this.anchors.packAPunch,
      );
    }
    for (const perk of this.anchors.perks) {
      const colors: Record<PerkId, number> = {
        revive: 0x00bcd4,
        juggernog: 0xc62828,
        speed: 0xcddc39,
        doubletap: 0xff6f00,
      };
      const perkMachine = this.placeMintProp(
        `machine-perk-${perk.perkId}`,
        perk.position,
        colors[perk.perkId],
        new THREE.Vector3(0.7, 1.6, 0.5),
        true,
        `perk-${perk.perkId}`,
      );
      this.registerInteractableVisual(
        `perk-${perk.perkId}`,
        'perk-machine',
        perkMachine,
        perk.position,
      );
    }
    for (const wall of this.anchors.wallBuys) {
      this.placeMintProp(
        ZOMBIES_MINT_IDS.wallBuyRack,
        wall.position,
        0x607d8b,
        new THREE.Vector3(0.8, 1.2, 0.2),
        false,
        wall.id,
      );
    }
    for (const barrier of this.anchors.barriers) {
      this.placeMintProp(
        ZOMBIES_MINT_IDS.barrierBoards,
        barrier.position.clone().setY(barrier.position.y + 0.35),
        0x8d6e63,
        new THREE.Vector3(1.4, 1.5, 0.18),
        false,
        barrier.id,
      );
    }

    const fill = new THREE.AmbientLight(0x304050, 0.55);
    const key = new THREE.DirectionalLight(0xdde6ef, 0.65);
    key.position.set(
      this.anchors.playerStart.x + 4,
      this.anchors.playerStart.y + 9,
      this.anchors.playerStart.z,
    );
    this.group.add(fill, key);
    const powered = new THREE.PointLight(0x88ffaa, 0, 18);
    powered.position.set(
      this.anchors.powerSwitch.x,
      this.anchors.powerSwitch.y + 1.8,
      this.anchors.powerSwitch.z,
    );
    this.poweredLights.push(powered);
    this.group.add(powered);

    if (!options.skipWorldBoundary) {
      physics.addWorldBoundary(
        new THREE.Box3(new THREE.Vector3(-12, -1, -2), new THREE.Vector3(22, 4, 40)),
        0.5,
      );
    }
  }

  /** Invisible walk pad covering the splat playable footprint. */
  installWalkPad(physics: PhysicsWorld, bounds: THREE.Box3, floorY: number): void {
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const half = new THREE.Vector3(size.x * 0.5, 0.2, size.z * 0.5);
    const pos = new THREE.Vector3(center.x, floorY, center.z);
    physics.addBox(pos, half);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, 0.35, size.z),
      new THREE.MeshStandardMaterial({
        color: '#1a1e22',
        roughness: 0.95,
        transparent: true,
        opacity: 0.001,
      }),
    );
    mesh.position.copy(pos);
    mesh.name = 'zombies-splat-walk-pad';
    mesh.userData.arenaBlockout = true;
    mesh.visible = false;
    this.group.add(mesh);
  }

  openDoor(doorId: string): void {
    const entry = this.doorColliders.get(doorId);
    if (!entry) return;
    entry.mesh.visible = false;
    // Soft-disable by shifting collider out of playable space.
    entry.collider.setTranslation({ x: 0, y: -50, z: 0 });
    this.doorMeshes.get(doorId)?.removeFromParent();
  }

  setPowerVisual(on: boolean): void {
    for (const light of this.poweredLights) {
      light.intensity = on ? 1.8 : 0;
    }
  }

  resetInteractableVisuals(): void {
    for (const state of this.interactableVisuals.values()) {
      state.elapsed = 0;
      state.phase = 0;
      state.active = false;
      state.frozenAtPeak = false;
      this.restoreInteractableRoot(state);
      state.effect.visible = false;
    }
  }

  activateInteractable(id: ZombiesInteractableVisualId): boolean {
    const state = this.interactableVisuals.get(id);
    if (!state) return false;
    state.elapsed = 0;
    state.phase = 0;
    state.active = true;
    state.frozenAtPeak = false;
    this.applyInteractableVisual(state, 0.001);
    return true;
  }

  freezeInteractableAtPeak(id: ZombiesInteractableVisualId): boolean {
    const state = this.interactableVisuals.get(id);
    if (!state) return false;
    state.elapsed = state.duration * ZOMBIES_INTERACTABLE_ACTIVATION_PEAK;
    state.phase = ZOMBIES_INTERACTABLE_ACTIVATION_PEAK;
    state.active = true;
    state.frozenAtPeak = true;
    this.applyInteractableVisual(
      state,
      ZOMBIES_INTERACTABLE_ACTIVATION_PEAK,
    );
    return true;
  }

  updateInteractableVisuals(delta: number): void {
    const safeDelta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    for (const state of this.interactableVisuals.values()) {
      if (!state.active) continue;
      if (state.frozenAtPeak) {
        this.applyInteractableVisual(
          state,
          ZOMBIES_INTERACTABLE_ACTIVATION_PEAK,
        );
        continue;
      }
      state.elapsed += safeDelta;
      if (state.elapsed >= state.duration) {
        state.elapsed = state.duration;
        state.phase = 1;
        state.active = false;
        this.restoreInteractableRoot(state);
        state.effect.visible = false;
        continue;
      }
      state.phase = state.elapsed / state.duration;
      this.applyInteractableVisual(state, state.phase);
    }
  }

  getInteractableVisualDiagnostics(): Array<{
    id: ZombiesInteractableVisualId;
    role: ZombiesInteractableVisualRole;
    active: boolean;
    frozenAtPeak: boolean;
    phase: number;
    rootLift: number;
    effectVisible: boolean;
    effectScale: number;
  }> {
    return [...this.interactableVisuals.values()].map((state) => ({
      id: state.id,
      role: state.role,
      active: state.active,
      frozenAtPeak: state.frozenAtPeak,
      phase: state.phase,
      rootLift: state.root.position.y - state.baseRootPosition.y,
      effectVisible: state.effect.visible,
      effectScale: state.effect.scale.x,
    }));
  }

  moveMysteryBoxVisual(index: number): void {
    const target = this.anchors.mysteryBoxLocations[index];
    if (!target) return;
    const state = this.interactableVisuals.get('mystery-box');
    if (!state) return;
    this.restoreInteractableRoot(state);
    const offset = state.baseRootPosition.clone().sub(state.anchorPosition);
    state.anchorPosition.copy(target);
    state.floorY = target.y - 0.8;
    state.baseRootPosition.copy(target).add(offset);
    state.root.position.copy(state.baseRootPosition);
    state.effect.position.set(target.x, state.floorY, target.z);
  }

  setBlockoutVisible(visible: boolean): void {
    this.group.traverse((object) => {
      if (object.userData.arenaBlockout === true) {
        object.visible = visible;
      }
    });
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]!);
    }
    this.doorColliders.clear();
    this.doorMeshes.clear();
    this.poweredLights = [];
    this.interactableVisuals.clear();
    this.built = false;
  }

  async attachMintMachines(
    assets: MintAssetRuntime,
    onProgress?: (completed: number, total: number, artifactId: string) => void,
    options?: {
      /** When set, only replace placeholders whose anchor lives in these rooms. */
      roomIds?: ReadonlySet<string> | readonly string[];
      concurrency?: number;
    },
  ): Promise<{ requested: number; attached: number; failures: string[] }> {
    const allowedRooms = options?.roomIds
      ? options.roomIds instanceof Set
        ? options.roomIds
        : new Set(options.roomIds)
      : null;
    const concurrency = Math.max(1, Math.min(6, options?.concurrency ?? 4));
    const placeholders = this.group.children.filter((child) => {
      if (child.userData.mintPlaceholder !== true) return false;
      if (!allowedRooms) return true;
      const anchorId = child.userData.zombiesAnchorId as string | undefined;
      if (!anchorId) return true;
      const roomId = this.anchorRoomById.get(anchorId);
      return roomId ? allowedRooms.has(roomId) : true;
    });
    let completed = 0;
    let attached = 0;
    const failures: string[] = [];
    let cursor = 0;
    const attachOne = async (placeholder: THREE.Object3D): Promise<void> => {
      const artifactId = placeholder.userData.mintArtifactId as
        | string
        | undefined;
      if (!artifactId) return;
      try {
        const model = await assets.instantiateModel(artifactId);
        if (!model) {
          failures.push(artifactId);
          return;
        }
        // Wall racks are mounted in narrow portal approaches. Their generated
        // source was normalized to the same height as floor-standing machines,
        // making the Talon rack read like a blocking cabinet even though it
        // owns no physics collider.
        normalizeMintModel(
          model,
          artifactId === ZOMBIES_MINT_IDS.wallBuyRack ? 1.15 : 1.6,
        );
        model.position.copy(placeholder.position);
        model.quaternion.copy(placeholder.quaternion);
        const floorY = placeholder.userData.mintFloorY;
        if (typeof floorY === 'number' && Number.isFinite(floorY)) {
          model.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(model);
          model.position.y += floorY - bounds.min.y;
          const glow = new THREE.Color(
            placeholder.userData.mintAttractColor as number,
          );
          model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const materials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            for (const material of materials) {
              if (
                material instanceof THREE.MeshStandardMaterial ||
                material instanceof THREE.MeshPhysicalMaterial
              ) {
                material.emissive.lerp(glow, 0.14);
                material.emissiveIntensity = Math.max(
                  material.emissiveIntensity,
                  0.24,
                );
              }
            }
          });
        }
        model.name = artifactId;
        model.userData.mintArtifactId = artifactId;
        const anchorId = placeholder.userData.zombiesAnchorId;
        if (typeof anchorId === 'string') {
          model.userData.zombiesAnchorId = anchorId;
        }
        const interactableVisualId = placeholder.userData
          .zombiesInteractableVisualId as
          | ZombiesInteractableVisualId
          | undefined;
        if (interactableVisualId) {
          model.userData.zombiesInteractableVisualId = interactableVisualId;
        }
        this.group.add(model);
        if (interactableVisualId) {
          const state = this.interactableVisuals.get(interactableVisualId);
          if (state) this.bindInteractableRoot(state, model);
        }
        placeholder.removeFromParent();
        attached += 1;
      } catch {
        failures.push(artifactId);
      } finally {
        completed += 1;
        onProgress?.(completed, placeholders.length, artifactId);
      }
    };
    const worker = async () => {
      while (cursor < placeholders.length) {
        const index = cursor;
        cursor += 1;
        await attachOne(placeholders[index]!);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, placeholders.length) }, () =>
        worker(),
      ),
    );
    return {
      requested: placeholders.length,
      attached,
      failures,
    };
  }

  private createAnchors(): ArenaAnchors {
    return {
      playerStart: new THREE.Vector3(0, 1, 2),
      wallBuys: [
        { id: 'wall-kestrel', position: new THREE.Vector3(-4.2, 1.2, 4) },
        { id: 'wall-arx', position: new THREE.Vector3(4.5, 1.2, 16) },
        { id: 'wall-talon', position: new THREE.Vector3(-4.2, 1.2, 30) },
        { id: 'wall-brimstone', position: new THREE.Vector3(16, 1.2, 26) },
      ],
      doors: [
        { id: 'door-spawn-mid', position: new THREE.Vector3(0, 1, 11.5), unlocks: 'mid' },
        { id: 'door-mid-power', position: new THREE.Vector3(0, 1, 23.5), unlocks: 'power' },
        { id: 'door-power-pap', position: new THREE.Vector3(6.5, 1, 30), unlocks: 'pap' },
      ],
      barriers: [
        { id: 'barrier-spawn-a', position: new THREE.Vector3(-4.5, 1, 1) },
        { id: 'barrier-spawn-b', position: new THREE.Vector3(4.5, 1, 1) },
        { id: 'barrier-mid-a', position: new THREE.Vector3(-5.5, 1, 18) },
        { id: 'barrier-mid-b', position: new THREE.Vector3(5.5, 1, 20) },
        { id: 'barrier-mid-c', position: new THREE.Vector3(5.5, 1, 18) },
        { id: 'barrier-mid-d', position: new THREE.Vector3(-5.5, 1, 20) },
        { id: 'barrier-power-a', position: new THREE.Vector3(4.5, 1, 34) },
        { id: 'barrier-power-b', position: new THREE.Vector3(-4, 1, 34.5) },
        { id: 'barrier-power-c', position: new THREE.Vector3(4.5, 1, 30) },
        { id: 'barrier-power-d', position: new THREE.Vector3(-4, 1, 30) },
        { id: 'barrier-pap-a', position: new THREE.Vector3(18, 1, 34.5) },
        { id: 'barrier-pap-b', position: new THREE.Vector3(18, 1, 25.5) },
      ],
      powerSwitch: new THREE.Vector3(-3.5, 1.2, 32),
      powerSwitchInteraction: new THREE.Vector3(-3.5, 0.98, 30.8),
      mysteryBoxLocations: [
        new THREE.Vector3(12, 0.7, 32),
        new THREE.Vector3(3, 0.7, 18),
      ],
      perks: [
        { perkId: 'revive', position: new THREE.Vector3(3.8, 1.2, 3) },
        { perkId: 'juggernog', position: new THREE.Vector3(17, 1.2, 33) },
        { perkId: 'speed', position: new THREE.Vector3(11, 1.2, 26) },
        { perkId: 'doubletap', position: new THREE.Vector3(17, 1.2, 28) },
      ],
      packAPunch: new THREE.Vector3(14, 1.2, 34),
      spawnPoints: [
        {
          id: 'sp-spawn-a',
          zone: 'spawn',
          position: new THREE.Vector3(-4.5, 1, 0.5),
          barrierId: 'barrier-spawn-a',
        },
        {
          id: 'sp-spawn-b',
          zone: 'spawn',
          position: new THREE.Vector3(4.5, 1, 0.5),
          barrierId: 'barrier-spawn-b',
        },
        {
          id: 'sp-mid-a',
          zone: 'mid',
          position: new THREE.Vector3(-5.5, 1, 17.5),
          barrierId: 'barrier-mid-a',
        },
        {
          id: 'sp-mid-b',
          zone: 'mid',
          position: new THREE.Vector3(5.5, 1, 20),
          barrierId: 'barrier-mid-b',
        },
        {
          id: 'sp-mid-c',
          zone: 'mid',
          position: new THREE.Vector3(5.5, 1, 17.5),
          barrierId: 'barrier-mid-c',
        },
        {
          id: 'sp-mid-d',
          zone: 'mid',
          position: new THREE.Vector3(-5.5, 1, 20),
          barrierId: 'barrier-mid-d',
        },
        {
          id: 'sp-power-a',
          zone: 'power',
          position: new THREE.Vector3(4.5, 1, 34.5),
          barrierId: 'barrier-power-a',
        },
        {
          id: 'sp-power-b',
          zone: 'power',
          position: new THREE.Vector3(-4, 1, 34.5),
          barrierId: 'barrier-power-b',
        },
        {
          id: 'sp-power-c',
          zone: 'power',
          position: new THREE.Vector3(4.5, 1, 30),
          barrierId: 'barrier-power-c',
        },
        {
          id: 'sp-power-d',
          zone: 'power',
          position: new THREE.Vector3(-4, 1, 30),
          barrierId: 'barrier-power-d',
        },
        {
          id: 'sp-pap-a',
          zone: 'pap',
          position: new THREE.Vector3(18, 1, 34.5),
          barrierId: 'barrier-pap-a',
        },
        {
          id: 'sp-pap-b',
          zone: 'pap',
          position: new THREE.Vector3(18, 1, 25.5),
          barrierId: 'barrier-pap-b',
        },
      ],
    };
  }

  private addRoom(
    physics: PhysicsWorld,
    cx: number,
    cz: number,
    width: number,
    depth: number,
    color: string,
  ): void {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.3, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
    );
    floor.position.set(cx, -0.15, cz + depth * 0.5);
    floor.receiveShadow = true;
    floor.userData.arenaBlockout = true;
    this.group.add(floor);
    physics.addBox(
      new THREE.Vector3(cx, -0.15, cz + depth * 0.5),
      new THREE.Vector3(width * 0.5, 0.15, depth * 0.5),
    );

    const wallMat = new THREE.MeshStandardMaterial({
      color: '#3a4048',
      roughness: 0.88,
    });
    const wallH = 3.2;
    const thickness = 0.3;
    const minX = cx - width * 0.5;
    const maxX = cx + width * 0.5;
    const minZ = cz;
    const maxZ = cz + depth;
    const walls: Array<[number, number, number, number]> = [
      [minX, (minZ + maxZ) * 0.5, thickness, depth],
      [maxX, (minZ + maxZ) * 0.5, thickness, depth],
      [cx, minZ, width, thickness],
      [cx, maxZ, width, thickness],
    ];
    for (const [x, z, w, d] of walls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      mesh.position.set(x, wallH * 0.5, z);
      mesh.userData.arenaBlockout = true;
      this.group.add(mesh);
      physics.addBox(
        new THREE.Vector3(x, wallH * 0.5, z),
        new THREE.Vector3(w * 0.5, wallH * 0.5, d * 0.5),
      );
    }
  }

  private placeDoor(
    physics: PhysicsWorld,
    id: string,
    position: THREE.Vector3,
    _unlocks: ZoneId,
    compact = false,
  ): void {
    const width = compact ? 1.15 : 2.2;
    const height = compact ? 2.1 : 2.8;
    const depth = compact ? 0.12 : 0.25;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({
        color: '#5a4638',
        metalness: 0.2,
        roughness: 0.7,
        transparent: compact,
        opacity: compact ? 0.55 : 1,
      }),
    );
    mesh.position.copy(position);
    const yaw = this.anchorYawById.get(id) ?? 0;
    mesh.rotation.y = yaw;
    mesh.name = id;
    mesh.userData.mintArtifactId = ZOMBIES_MINT_IDS.purchaseDoor;
    this.group.add(mesh);
    const collider = physics.addBox(
      position.clone(),
      new THREE.Vector3(width * 0.5, height * 0.5, Math.max(0.08, depth * 0.5)),
      yaw,
    );
    this.doorColliders.set(id, { collider, mesh });
    this.doorMeshes.set(id, mesh);
  }

  private placeMintProp(
    artifactId: string,
    position: THREE.Vector3,
    color: number,
    size: THREE.Vector3,
    freeStanding = false,
    anchorId?: string,
  ): THREE.Object3D {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.25,
        roughness: 0.55,
        metalness: 0.2,
      }),
    );
    mesh.position.copy(position);
    mesh.rotation.y = anchorId
      ? (this.anchorYawById.get(anchorId) ?? 0)
      : 0;
    mesh.name = artifactId;
    mesh.userData.mintArtifactId = artifactId;
    mesh.userData.mintPlaceholder = true;
    // Keep placeholders out of the camera until Mint GLBs attach. Solid grey
    // boxes were reading as broken "guns" / washed-out props over the splat.
    mesh.visible = false;
    if (anchorId) mesh.userData.zombiesAnchorId = anchorId;
    if (freeStanding) {
      const floorY = position.y - 0.8;
      mesh.userData.mintFloorY = floorY;
      mesh.userData.mintAttractColor = color;
      const halo = new THREE.Mesh(rewardHaloGeometry, rewardHaloMaterial);
      halo.name = `${artifactId}-attract-halo`;
      halo.position.set(position.x, floorY + 0.025, position.z);
      halo.rotation.x = -Math.PI / 2;
      halo.renderOrder = 2;
      halo.userData.rewardAttractState = true;
      this.group.add(halo);
    }
    this.group.add(mesh);
    return mesh;
  }

  private registerInteractableVisual(
    id: ZombiesInteractableVisualId,
    role: ZombiesInteractableVisualRole,
    root: THREE.Object3D,
    anchorPosition: THREE.Vector3,
  ): void {
    root.userData.zombiesInteractableVisualId = id;
    const effect = this.createInteractableEffect(id, role);
    const floorY = anchorPosition.y - 0.8;
    effect.position.set(anchorPosition.x, floorY, anchorPosition.z);
    effect.visible = false;
    this.group.add(effect);
    const shards = effect.getObjectByName(
      `${id}-activation-shards`,
    ) as THREE.InstancedMesh;
    const rotors = effect.children.filter(
      (child) => child.userData.activationRotor === true,
    );
    const state: InteractableVisualState = {
      id,
      role,
      root,
      anchorPosition: anchorPosition.clone(),
      floorY,
      baseRootPosition: root.position.clone(),
      baseRootRotation: root.rotation.clone(),
      baseRootScale: root.scale.clone(),
      effect,
      rotors,
      shards,
      shardTransform: new THREE.Object3D(),
      elapsed: 0,
      duration:
        role === 'mystery-box' ? 4.2 : role === 'pack-a-punch' ? 2.15 : 1.6,
      active: false,
      frozenAtPeak: false,
      phase: 0,
    };
    this.interactableVisuals.set(id, state);
    this.updateActivationShards(state, 0);
  }

  private createInteractableEffect(
    id: ZombiesInteractableVisualId,
    role: ZombiesInteractableVisualRole,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `${id}-activation-rig`;
    group.renderOrder = 4;
    const material =
      role === 'perk-machine'
        ? perkActivationMaterial
        : role === 'mystery-box'
          ? mysteryActivationMaterial
          : packActivationMaterial;

    const floorRing = new THREE.Mesh(activationRingGeometry, material);
    floorRing.name = `${id}-activation-floor-ring`;
    floorRing.rotation.x = Math.PI / 2;
    floorRing.position.y = 0.055;
    floorRing.userData.activationRotor = true;
    group.add(floorRing);

    if (role === 'perk-machine') {
      const beam = new THREE.Mesh(activationBeamGeometry, material);
      beam.name = `${id}-activation-beam`;
      beam.position.y = 0.72;
      group.add(beam);

      const crown = new THREE.Mesh(activationRingGeometry, material);
      crown.name = `${id}-activation-crown`;
      crown.position.y = 1.46;
      crown.scale.setScalar(0.72);
      crown.userData.activationRotor = true;
      group.add(crown);
    } else if (role === 'mystery-box') {
      const portal = new THREE.Mesh(activationRingGeometry, material);
      portal.name = `${id}-activation-portal`;
      portal.position.y = 1.18;
      portal.scale.setScalar(0.82);
      portal.userData.activationRotor = true;
      group.add(portal);

      const weapon = new THREE.Group();
      weapon.name = `${id}-activation-weapon`;
      weapon.position.y = 1.32;
      const body = new THREE.Mesh(activationWeaponBodyGeometry, material);
      const barrel = new THREE.Mesh(activationWeaponBarrelGeometry, material);
      barrel.position.x = 0.54;
      barrel.rotation.z = Math.PI / 2;
      weapon.add(body, barrel);
      weapon.userData.activationRotor = true;
      group.add(weapon);
    } else {
      const core = new THREE.Mesh(activationCoreGeometry, material);
      core.name = `${id}-activation-core`;
      core.position.y = 1.24;
      core.userData.activationRotor = true;
      group.add(core);
      for (let index = 0; index < 2; index += 1) {
        const orbit = new THREE.Mesh(activationRingGeometry, material);
        orbit.name = `${id}-activation-orbit-${index}`;
        orbit.position.y = 1.24;
        orbit.rotation.y = index * Math.PI / 2;
        orbit.scale.setScalar(index === 0 ? 0.82 : 1.02);
        orbit.userData.activationRotor = true;
        group.add(orbit);
      }
    }

    const shards = new THREE.InstancedMesh(
      activationShardGeometry,
      material,
      8,
    );
    shards.name = `${id}-activation-shards`;
    shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shards.frustumCulled = false;
    group.add(shards);
    return group;
  }

  private bindInteractableRoot(
    state: InteractableVisualState,
    root: THREE.Object3D,
  ): void {
    state.root = root;
    state.baseRootPosition.copy(root.position);
    state.baseRootRotation.copy(root.rotation);
    state.baseRootScale.copy(root.scale);
    this.restoreInteractableRoot(state);
  }

  private restoreInteractableRoot(state: InteractableVisualState): void {
    state.root.position.copy(state.baseRootPosition);
    state.root.rotation.copy(state.baseRootRotation);
    state.root.scale.copy(state.baseRootScale);
  }

  private applyInteractableVisual(
    state: InteractableVisualState,
    phase: number,
  ): void {
    const pose = sampleZombiesInteractableActivation(state.role, phase);
    state.phase = phase;
    state.root.position.copy(state.baseRootPosition);
    state.root.position.y += pose.rootLift;
    state.root.rotation.copy(state.baseRootRotation);
    state.root.rotation.y += pose.rootYaw;
    state.root.scale.set(
      state.baseRootScale.x * pose.rootScale.x,
      state.baseRootScale.y * pose.rootScale.y,
      state.baseRootScale.z * pose.rootScale.z,
    );

    state.effect.visible = true;
    state.effect.scale.setScalar(pose.effectScale);
    state.effect.rotation.y = phase * Math.PI * 1.7;
    for (let index = 0; index < state.rotors.length; index += 1) {
      const rotor = state.rotors[index]!;
      rotor.rotation.z =
        phase * Math.PI * 2 * (index % 2 === 0 ? 1 : -1) +
        index * Math.PI * 0.25;
    }
    this.updateActivationShards(state, phase);
  }

  private updateActivationShards(
    state: InteractableVisualState,
    phase: number,
  ): void {
    const radius = state.role === 'pack-a-punch' ? 0.92 : 0.72;
    const height = state.role === 'perk-machine' ? 1.28 : 1.08;
    for (let index = 0; index < state.shards.count; index += 1) {
      const angle =
        (index / state.shards.count) * Math.PI * 2 +
        phase * Math.PI * (state.role === 'mystery-box' ? 2.8 : 1.8);
      const wave = Math.sin(phase * Math.PI * 2 + index * 1.7);
      state.shardTransform.position.set(
        Math.cos(angle) * radius,
        0.28 + (index / state.shards.count) * height + wave * 0.08,
        Math.sin(angle) * radius,
      );
      state.shardTransform.rotation.set(angle, angle * 0.7, phase * Math.PI * 3);
      state.shardTransform.scale.setScalar(
        0.75 + 0.25 * Math.sin(angle * 2 + phase * Math.PI),
      );
      state.shardTransform.updateMatrix();
      state.shards.setMatrixAt(index, state.shardTransform.matrix);
    }
    state.shards.instanceMatrix.needsUpdate = true;
  }
}
