import type {
  ZombiesPlacementKind,
  ZombiesPlacementLayout,
  ZombiesPlacementRecord,
} from '../zombies/ZombiesPlacementLayout';

/** Maps Outbreak v1 — single-room buyable contract (no doors / perks / PaP). */
export const MAPS_ROOM_ID = 'world-maps-outbreak';

export const MAPS_WALL_BUY_IDS = [
  'wall-kestrel',
  'wall-arx',
  'wall-talon',
  'wall-morrow',
  'wall-brimstone',
  'wall-aegis',
] as const;

export const MAPS_WALL_BUY_WEAPONS: Record<
  (typeof MAPS_WALL_BUY_IDS)[number],
  string
> = {
  'wall-kestrel': 'kestrel-9',
  'wall-arx': 'arx-7',
  'wall-talon': 'talon-m4',
  'wall-morrow': 'morrow-dmr12',
  'wall-brimstone': 'brimstone-lmg6',
  'wall-aegis': 'aegis-p11',
};

export const MAPS_BARRIER_IDS = [
  'barrier-maps-a',
  'barrier-maps-b',
  'barrier-maps-c',
  'barrier-maps-d',
] as const;

export const MAPS_SPAWN_IDS = [
  'sp-maps-a',
  'sp-maps-b',
  'sp-maps-c',
  'sp-maps-d',
] as const;

export const REQUIRED_MAPS_PLACEMENT_IDS = [
  'player-start',
  ...MAPS_WALL_BUY_IDS,
  'mystery-box-0',
  ...MAPS_BARRIER_IDS,
  ...MAPS_SPAWN_IDS,
] as const;

export type MapsPlacementValidation = {
  valid: boolean;
  errors: string[];
};

function finiteVector(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

export function validateMapsPlacementLayout(
  layout: ZombiesPlacementLayout,
  roomId: string = MAPS_ROOM_ID,
): MapsPlacementValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (layout.version !== 1) {
    errors.push(`Unsupported placement layout version ${layout.version}`);
  }
  if (layout.coordinateSpace !== 'three-world-metres') {
    errors.push(`Unsupported placement coordinate space ${layout.coordinateSpace}`);
  }
  for (const placement of layout.placements) {
    if (!placement.id.trim()) errors.push('Placement has an empty id');
    if (ids.has(placement.id)) errors.push(`Duplicate placement id ${placement.id}`);
    ids.add(placement.id);
    if (placement.roomId !== roomId) {
      errors.push(`${placement.id} must use room ${roomId}`);
    }
    if (!finiteVector(placement.position)) {
      errors.push(`${placement.id} has an invalid position`);
    }
    if (!finiteVector(placement.rotation)) {
      errors.push(`${placement.id} has an invalid rotation`);
    }
    if (
      !finiteVector(placement.scale) ||
      placement.scale.some((entry) => entry <= 0)
    ) {
      errors.push(`${placement.id} has an invalid scale`);
    }
  }
  for (const requiredId of REQUIRED_MAPS_PLACEMENT_IDS) {
    if (!ids.has(requiredId)) errors.push(`Missing placement ${requiredId}`);
  }
  const wallBuys = layout.placements.filter((p) => p.kind === 'wall-buy');
  if (wallBuys.length < 6) {
    errors.push('Maps Outbreak requires six wall-buy placements');
  }
  const boxes = layout.placements.filter((p) => p.kind === 'mystery-box');
  if (boxes.length < 1) {
    errors.push('Maps Outbreak requires a mystery box');
  }
  const barriers = layout.placements.filter((p) => p.kind === 'barrier');
  if (barriers.length < 3) {
    errors.push('Maps Outbreak requires at least three barriers');
  }
  return { valid: errors.length === 0, errors };
}

export type MapsPlayableBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
};

function placement(
  id: string,
  kind: ZombiesPlacementKind,
  position: [number, number, number],
  rotation: [number, number, number],
  mount: ZombiesPlacementRecord['mount'],
  roomId: string,
): ZombiesPlacementRecord {
  return {
    id,
    kind,
    roomId,
    position,
    rotation,
    scale: [1, 1, 1],
    mount,
  };
}

export type MapsRingPlacementOptions = {
  /** Legacy shared radius for walls + barrier cluster (relative to half-extent). */
  radiusFactor?: number;
  /** Inner ring for wall buys / mystery box (relative to half-extent). */
  wallRadiusFactor?: number;
  /** Outer ring for barriers / spawns (relative to half-extent). */
  barrierRadiusFactor?: number;
};

/**
 * Deterministic ring layout used when collider surface queries are unavailable
 * or when Maps Outbreak seats buyables on a walkable footprint.
 *
 * Walls stay on an inner quality ring; barriers/spawns can use a wider
 * perimeter ring so the horde covers the full player pad.
 */
export function buildMapsRingPlacementLayout(
  bounds: MapsPlayableBounds,
  roomId: string = MAPS_ROOM_ID,
  options?: MapsRingPlacementOptions,
): ZombiesPlacementLayout {
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cz = (bounds.minZ + bounds.maxZ) * 0.5;
  const spanX = Math.max(4, bounds.maxX - bounds.minX);
  const spanZ = Math.max(4, bounds.maxZ - bounds.minZ);
  const halfMin = Math.min(spanX, spanZ) * 0.5;
  const legacyFactor = options?.radiusFactor;
  const wallFactor = options?.wallRadiusFactor ?? legacyFactor ?? 0.64;
  const barrierFactor =
    options?.barrierRadiusFactor ?? legacyFactor ?? wallFactor;
  const wallRadius = Math.min(halfMin * wallFactor, halfMin - 0.85);
  const barrierRadius = Math.min(
    halfMin * barrierFactor,
    halfMin - 0.55,
  );
  const floorY = bounds.floorY;
  const wallY = floorY + 1.2;

  const placements: ZombiesPlacementRecord[] = [
    placement(
      'player-start',
      'player-start',
      [cx, floorY + 0.05, cz],
      [0, 0, 0],
      'floor',
      roomId,
    ),
  ];

  MAPS_WALL_BUY_IDS.forEach((id, index) => {
    const angle = (index / MAPS_WALL_BUY_IDS.length) * Math.PI * 2 - Math.PI * 0.5;
    const x = cx + Math.cos(angle) * wallRadius;
    const z = cz + Math.sin(angle) * wallRadius;
    const yaw = -angle + Math.PI;
    placements.push(
      placement(id, 'wall-buy', [x, wallY, z], [0, yaw, 0], 'wall', roomId),
    );
  });

  placements.push(
    placement(
      'mystery-box-0',
      'mystery-box',
      [cx + wallRadius * 0.15, floorY + 0.05, cz - wallRadius * 0.55],
      [0, Math.PI * 0.25, 0],
      'floor',
      roomId,
    ),
  );

  MAPS_BARRIER_IDS.forEach((barrierId, index) => {
    const spawnId = MAPS_SPAWN_IDS[index]!;
    const angle =
      (index / MAPS_BARRIER_IDS.length) * Math.PI * 2 + Math.PI * 0.25;
    // Barrier on the perimeter; spawn slightly outward (entry projected later).
    const barrierR = barrierRadius;
    const outsideR = Math.min(barrierR + 1.15, halfMin - 0.35);
    const bx = cx + Math.cos(angle) * barrierR;
    const bz = cz + Math.sin(angle) * barrierR;
    const sx = cx + Math.cos(angle) * outsideR;
    const sz = cz + Math.sin(angle) * outsideR;
    const yaw = -angle;
    placements.push(
      placement(
        barrierId,
        'barrier',
        [bx, floorY + 0.9, bz],
        [0, yaw, 0],
        'wall',
        roomId,
      ),
      placement(
        spawnId,
        'zombie-spawn',
        [sx, floorY + 0.05, sz],
        [0, yaw + Math.PI, 0],
        'socket',
        roomId,
      ),
    );
  });

  return {
    version: 1,
    coordinateSpace: 'three-world-metres',
    placements,
  };
}

export type MapsPublishReadiness = {
  manifestReady: boolean;
  placementReady: boolean;
  playableBoundsReady: boolean;
  cdnReady: boolean;
  passed: boolean;
};

export function isMapsOutbreakPlayReady(input: {
  manifestReady: boolean;
  placementReady: boolean;
  playableBoundsReady: boolean;
  cdnReady: boolean;
}): MapsPublishReadiness {
  const passed =
    input.manifestReady &&
    input.placementReady &&
    input.playableBoundsReady &&
    input.cdnReady;
  return { ...input, passed };
}
