import * as THREE from 'three';
import type { MintWorldLayer } from '../world/MintWorldLayer';
import type { ZombiesPlacementLayout } from '../zombies/ZombiesPlacementLayout';
import {
  MAPS_BARRIER_IDS,
  MAPS_ROOM_ID,
  MAPS_SPAWN_IDS,
  MAPS_WALL_BUY_IDS,
  buildMapsRingPlacementLayout,
  type MapsPlayableBounds,
  validateMapsPlacementLayout,
} from './MapsPlacement';

export type MapsAutoPlaceResult = {
  layout: ZombiesPlacementLayout;
  usedCollider: boolean;
  failures: string[];
};

/**
 * Seat Maps Outbreak buyables. Prefers collider surface queries when the layer
 * is ready; otherwise falls back to a deterministic ring inside playable bounds.
 */
export function autoPlaceMapsBuyables(input: {
  bounds: MapsPlayableBounds;
  layer?: MintWorldLayer | null;
  roomId?: string;
}): MapsAutoPlaceResult {
  const roomId = input.roomId ?? MAPS_ROOM_ID;
  const fallback = buildMapsRingPlacementLayout(input.bounds, roomId);
  const layer = input.layer;
  if (!layer) {
    return { layout: fallback, usedCollider: false, failures: [] };
  }

  const failures: string[] = [];
  const cx = (input.bounds.minX + input.bounds.maxX) * 0.5;
  const cz = (input.bounds.minZ + input.bounds.maxZ) * 0.5;
  const spanX = Math.max(4, input.bounds.maxX - input.bounds.minX);
  const spanZ = Math.max(4, input.bounds.maxZ - input.bounds.minZ);
  const radius = Math.min(spanX, spanZ) * 0.32;
  const floorY = input.bounds.floorY;

  const requests = [
    ...MAPS_WALL_BUY_IDS.map((id, index) => {
      const angle =
        (index / MAPS_WALL_BUY_IDS.length) * Math.PI * 2 - Math.PI * 0.5;
      return {
        id,
        kind: 'wall' as const,
        maxDistance: 4,
        reference: new THREE.Vector3(
          cx + Math.cos(angle) * radius,
          floorY + 1.2,
          cz + Math.sin(angle) * radius,
        ),
      };
    }),
    {
      id: 'player-start',
      kind: 'floor' as const,
      maxDistance: 6,
      reference: new THREE.Vector3(cx, floorY + 0.5, cz),
    },
    {
      id: 'mystery-box-0',
      kind: 'floor' as const,
      maxDistance: 6,
      reference: new THREE.Vector3(
        cx + radius * 0.15,
        floorY + 0.5,
        cz - radius * 0.55,
      ),
    },
    ...MAPS_BARRIER_IDS.map((id, index) => {
      const angle =
        (index / MAPS_BARRIER_IDS.length) * Math.PI * 2 + Math.PI * 0.25;
      return {
        id,
        kind: 'wall' as const,
        maxDistance: 5,
        reference: new THREE.Vector3(
          cx + Math.cos(angle) * radius * 0.92,
          floorY + 0.9,
          cz + Math.sin(angle) * radius * 0.92,
        ),
      };
    }),
    ...MAPS_SPAWN_IDS.map((id, index) => {
      const angle =
        (index / MAPS_SPAWN_IDS.length) * Math.PI * 2 + Math.PI * 0.25;
      return {
        id,
        kind: 'floor' as const,
        maxDistance: 6,
        reference: new THREE.Vector3(
          cx + Math.cos(angle) * radius * 1.18,
          floorY + 0.5,
          cz + Math.sin(angle) * radius * 1.18,
        ),
      };
    }),
  ];

  try {
    const hits = layer.nearestColliderSurfaces(requests);
    const layout = structuredClone(fallback) as ZombiesPlacementLayout;
    for (const placement of layout.placements) {
      const hit = hits.get(placement.id);
      if (!hit) {
        failures.push(placement.id);
        continue;
      }
      placement.position = [hit.point.x, hit.point.y, hit.point.z];
      if (placement.kind === 'wall-buy' || placement.kind === 'barrier') {
        const yaw = Math.atan2(hit.normal.x, hit.normal.z);
        placement.rotation = [0, yaw, 0];
        if (placement.kind === 'wall-buy') {
          placement.position[1] = Math.max(placement.position[1], floorY + 1.05);
        }
      }
    }
    const validation = validateMapsPlacementLayout(layout, roomId);
    if (!validation.valid) {
      return {
        layout: fallback,
        usedCollider: false,
        failures: [...failures, ...validation.errors],
      };
    }
    return { layout, usedCollider: true, failures };
  } catch (error) {
    return {
      layout: fallback,
      usedCollider: false,
      failures: [
        error instanceof Error ? error.message : 'Collider auto-place failed',
      ],
    };
  }
}
