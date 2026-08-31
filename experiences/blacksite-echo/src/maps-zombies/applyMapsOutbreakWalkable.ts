import * as THREE from 'three';
import { SplatContainment } from '../world/SplatContainment';
import {
  SplatNavigationSurface,
  type SplatLayoutAsset,
  type SplatNavigationBakeAsset,
} from '../world/SplatNavigationSurface';
import type { ZombiesPlacementLayout } from '../zombies/ZombiesPlacementLayout';
import {
  MAPS_BARRIER_IDS,
  MAPS_SPAWN_IDS,
  buildMapsRingPlacementLayout,
  type MapsPlayableBounds,
} from './MapsPlacement';
import {
  bakeMapsNavigationFromCollider,
  type MapsNavigationBakeResult,
} from './mapsNavigationBake';
import type { MapsMintRuntime } from './mapsMintManifest';

/** Every Maps Outbreak deploy must use this walkable policy. */
export const MAPS_WALKABLE_POLICY = 'editor-navmesh-v1' as const;

const MAPS_ZOMBIE_CAPSULE_RADIUS = 0.42;

export type MapsSpawnRoute = {
  spawnId: string;
  barrierId: string;
  outside: THREE.Vector3;
  landing: THREE.Vector3;
};

export type MapsOutbreakWalkableSetup = {
  policy: typeof MAPS_WALKABLE_POLICY;
  bake: MapsNavigationBakeResult;
  layout: SplatLayoutAsset;
  navigation: SplatNavigationBakeAsset;
  surface: SplatNavigationSurface;
  containment: SplatContainment;
  placements: ZombiesPlacementLayout;
  playable: MapsPlayableBounds;
  spawn: THREE.Vector3;
  /** Navmesh-projected barrier entry routes for full-pad horde pursuit. */
  spawnRoutes: MapsSpawnRoute[];
};

/**
 * Require a finalized Maps runtime to expose a Mint collider. Without it the
 * editor-style walkable bake cannot run for generated/imported maps.
 */
export function assertMapsRuntimeSupportsWalkableBake(
  runtime: MapsMintRuntime | null | undefined,
): asserts runtime is MapsMintRuntime {
  if (!runtime) {
    throw new Error('Maps Outbreak runtime is missing.');
  }
  if (!runtime.colliderUrl?.includes('cdn.mint.gg')) {
    throw new Error(
      'Maps Outbreak runtime is missing a Mint CDN collider. Re-generate or re-install the arena.',
    );
  }
  if (!runtime.runtimeUrl?.includes('cdn.mint.gg')) {
    throw new Error(
      'Maps Outbreak runtime is missing a Mint CDN RAD stream. Re-generate or re-install the arena.',
    );
  }
}

/**
 * Spiral-search a capsule-safe point on the Maps navmesh near (x, z).
 * Prefers the seed, then steps toward the room center, then a short spiral.
 */
export function projectMapsPointOntoNavmesh(
  surface: SplatNavigationSurface,
  roomId: string,
  x: number,
  z: number,
  footY: number,
  centerX: number,
  centerZ: number,
  capsuleRadius = MAPS_ZOMBIE_CAPSULE_RADIUS,
): THREE.Vector3 | null {
  const probeY = footY + 0.98;
  const tryPoint = (px: number, pz: number): THREE.Vector3 | null => {
    const candidate = new THREE.Vector3(px, probeY, pz);
    if (surface.containsCapsuleInRoom(roomId, candidate, capsuleRadius)) {
      return candidate;
    }
    return null;
  };

  const direct = tryPoint(x, z);
  if (direct) return direct;

  const toCenterX = centerX - x;
  const toCenterZ = centerZ - z;
  const toCenterLen = Math.hypot(toCenterX, toCenterZ);
  if (toCenterLen > 1e-4) {
    const nx = toCenterX / toCenterLen;
    const nz = toCenterZ / toCenterLen;
    for (let step = 0.6; step <= 14; step += 0.6) {
      const hit = tryPoint(x + nx * step, z + nz * step);
      if (hit) return hit;
    }
  }

  for (let ring = 1; ring <= 12; ring += 1) {
    const radius = ring * 0.75;
    const samples = 8 + ring * 2;
    for (let i = 0; i < samples; i += 1) {
      const angle = (i / samples) * Math.PI * 2;
      const hit = tryPoint(
        x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius,
      );
      if (hit) return hit;
    }
  }
  return null;
}

function seatPlacementOnDeck(
  placement: ZombiesPlacementLayout['placements'][number],
  footY: number,
): void {
  if (placement.kind === 'wall-buy' || placement.kind === 'barrier') {
    placement.position[1] =
      footY + (placement.kind === 'wall-buy' ? 1.2 : 0.9);
  } else {
    placement.position[1] = footY + 0.05;
  }
}

function buildProjectedSpawnRoutes(
  surface: SplatNavigationSurface,
  roomId: string,
  placements: ZombiesPlacementLayout,
  footY: number,
  centerX: number,
  centerZ: number,
): MapsSpawnRoute[] {
  const routes: MapsSpawnRoute[] = [];
  for (let index = 0; index < MAPS_BARRIER_IDS.length; index += 1) {
    const barrierId = MAPS_BARRIER_IDS[index]!;
    const spawnId = MAPS_SPAWN_IDS[index]!;
    const barrier = placements.placements.find(
      (entry) => entry.id === barrierId,
    );
    const spawn = placements.placements.find((entry) => entry.id === spawnId);
    if (!barrier || !spawn) continue;

    const inwardX = centerX - barrier.position[0];
    const inwardZ = centerZ - barrier.position[2];
    const inwardLen = Math.hypot(inwardX, inwardZ) || 1;
    const nx = inwardX / inwardLen;
    const nz = inwardZ / inwardLen;

    const outsideSeedX = spawn.position[0];
    const outsideSeedZ = spawn.position[2];
    const landingSeedX = barrier.position[0] + nx * 2.4;
    const landingSeedZ = barrier.position[2] + nz * 2.4;

    const outside =
      projectMapsPointOntoNavmesh(
        surface,
        roomId,
        outsideSeedX,
        outsideSeedZ,
        footY,
        centerX,
        centerZ,
      ) ??
      projectMapsPointOntoNavmesh(
        surface,
        roomId,
        barrier.position[0],
        barrier.position[2],
        footY,
        centerX,
        centerZ,
      );
    const landing =
      projectMapsPointOntoNavmesh(
        surface,
        roomId,
        landingSeedX,
        landingSeedZ,
        footY,
        centerX,
        centerZ,
      ) ?? outside;

    if (!outside || !landing) {
      throw new Error(
        `Maps spawn route failed navmesh projection for ${spawnId}`,
      );
    }

    // Seat barrier/spawn feet on the proven deck; keep barrier art readable.
    const barrierOnMesh =
      projectMapsPointOntoNavmesh(
        surface,
        roomId,
        barrier.position[0],
        barrier.position[2],
        footY,
        centerX,
        centerZ,
      ) ?? landing;
    barrier.position[0] = barrierOnMesh.x;
    barrier.position[2] = barrierOnMesh.z;
    barrier.position[1] = footY + 0.9;
    spawn.position[0] = outside.x;
    spawn.position[2] = outside.z;
    spawn.position[1] = footY + 0.05;

    routes.push({
      spawnId,
      barrierId,
      outside: outside.clone().setY(footY + 0.05),
      landing: landing.clone().setY(footY + 0.05),
    });
  }
  return routes;
}

/**
 * Sole walkable seating path for Maps Outbreak — used for the proof world and
 * every newly generated/imported draft alike. Builds the editor playtest stack:
 * collider floor footprint → navmesh deck → SplatNavigationSurface + containment.
 *
 * Buyables stay on an inner quality ring; barriers/spawns seat on the navmesh
 * perimeter so the horde can chase across the full player walkable pad.
 */
export function applyMapsOutbreakWalkableFromCollider(
  colliderRoot: THREE.Object3D,
  roomId: string,
): MapsOutbreakWalkableSetup {
  const bake = bakeMapsNavigationFromCollider(colliderRoot, roomId);
  const surface = SplatNavigationSurface.fromAssets(
    bake.layout,
    bake.navigation,
  );
  if (!surface.rooms[0]?.navigation) {
    throw new Error(
      `Maps navigation bake failed to attach: ${surface.validation.errors.join('; ')}`,
    );
  }
  if (bake.areaSquareMetres < 80) {
    throw new Error(
      `Maps walkable bake is too small (${bake.areaSquareMetres.toFixed(1)} m²). Collider may be incomplete.`,
    );
  }

  const playable: MapsPlayableBounds = {
    minX: bake.bounds.min.x + 1.2,
    maxX: bake.bounds.max.x - 1.2,
    minZ: bake.bounds.min.z + 1.2,
    maxZ: bake.bounds.max.z - 1.2,
    floorY: bake.footY,
  };
  if (
    playable.maxX - playable.minX < 12 ||
    playable.maxZ - playable.minZ < 12
  ) {
    throw new Error('Maps walkable footprint collapsed; cannot seat the arena.');
  }

  const centerX = (playable.minX + playable.maxX) * 0.5;
  const centerZ = (playable.minZ + playable.maxZ) * 0.5;
  const placements = buildMapsRingPlacementLayout(playable, roomId, {
    wallRadiusFactor: 0.38,
    barrierRadiusFactor: 0.86,
  });
  for (const placement of placements.placements) {
    seatPlacementOnDeck(placement, bake.footY);
  }
  const playerStart = placements.placements.find(
    (entry) => entry.id === 'player-start',
  );
  if (playerStart) {
    playerStart.position = [bake.spawn.x, bake.footY + 0.05, bake.spawn.z];
  }

  const spawnRoutes = buildProjectedSpawnRoutes(
    surface,
    roomId,
    placements,
    bake.footY,
    centerX,
    centerZ,
  );

  return {
    policy: MAPS_WALKABLE_POLICY,
    bake,
    layout: bake.layout,
    navigation: bake.navigation,
    surface,
    containment: new SplatContainment(surface),
    placements,
    playable,
    spawn: bake.spawn.clone(),
    spawnRoutes,
  };
}
