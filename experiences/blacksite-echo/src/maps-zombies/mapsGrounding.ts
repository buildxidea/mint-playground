import * as THREE from 'three';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import {
  buildMapsRingPlacementLayout,
  type MapsPlayableBounds,
} from './MapsPlacement';
import {
  MAPS_QUALITY_POCKET_RADIUS,
  resolveMapsQualityPocket,
  type MapsQualityPocket,
} from './mapsQualityPocket';
import type { ZombiesPlacementLayout } from '../zombies/ZombiesPlacementLayout';

export type MapsGroundingResult = {
  spawn: THREE.Vector3;
  footY: number;
  placements: ZombiesPlacementLayout;
  deckMinY: number;
  usedSyntheticDeck: boolean;
  pocket: MapsQualityPocket;
  playableBounds: THREE.Box3;
};

/**
 * @deprecated Pocket seating is no longer used for deploy. Every Maps draft
 * (generated or imported) must go through
 * `applyMapsOutbreakWalkableFromCollider` so walkable space matches editor
 * playtest (navmesh + containment). Kept only for offline experiments.
 */
export function groundMapsOutbreakLayout(input: {
  physics: PhysicsWorld;
  bounds: THREE.Box3;
  visualBounds?: THREE.Box3 | null;
  roomId?: string;
  radius?: number;
}): MapsGroundingResult {
  const pocket = resolveMapsQualityPocket(input.physics, input.bounds, {
    radius: input.radius ?? MAPS_QUALITY_POCKET_RADIUS,
    visualBounds: input.visualBounds,
  });

  // Always install a continuous kinematic floor under the pocket so sparse
  // Mint collider holes cannot drop the player into water/void.
  input.physics.addMapsDeckFloor(pocket.bounds, pocket.deckY);

  const playable: MapsPlayableBounds = {
    ...pocket.playable,
    floorY: pocket.deckY,
  };
  const placements = buildMapsRingPlacementLayout(playable, input.roomId, {
    radiusFactor: 0.72,
  });

  for (const placement of placements.placements) {
    if (placement.kind === 'wall-buy' || placement.kind === 'barrier') {
      placement.position[1] =
        pocket.deckY + (placement.kind === 'wall-buy' ? 1.2 : 0.9);
    } else {
      placement.position[1] = pocket.deckY + 0.05;
    }
  }

  const spawn = new THREE.Vector3(
    pocket.center.x,
    pocket.deckY + 0.98,
    pocket.center.z,
  );
  const playerStart = placements.placements.find(
    (entry) => entry.id === 'player-start',
  );
  if (playerStart) {
    playerStart.position = [spawn.x, pocket.deckY + 0.05, spawn.z];
  }

  return {
    spawn,
    footY: pocket.deckY,
    placements,
    deckMinY: pocket.deckY - 0.85,
    usedSyntheticDeck: true,
    pocket,
    playableBounds: pocket.bounds.clone(),
  };
}
