import type { ModelAssetId } from '../assets/registry';
import type { BoatTuning } from '../systems/BoatPhysics';
import { DEFAULT_BOAT_TUNING } from '../systems/BoatPhysics';
import { primaryBoatFootprint } from '../assets/collisionProfiles';

export type PlayerBoatId = Extract<
  ModelAssetId,
  'boat_red_runabout' | 'boat_teal_skiff' | 'boat_yellow_utility'
>;

export type PlayerBoatOption = {
  id: PlayerBoatId;
  name: string;
  blurb: string;
  length: number;
};

export const PLAYER_BOATS: PlayerBoatOption[] = [
  {
    id: 'boat_red_runabout',
    name: 'Red Runabout',
    blurb: 'Balanced · default',
    length: 5.2,
  },
  {
    id: 'boat_teal_skiff',
    name: 'Teal Skiff',
    blurb: 'Longer · tighter fit',
    length: 5.4,
  },
  {
    id: 'boat_yellow_utility',
    name: 'Yellow Utility',
    blurb: 'Short · snappy',
    length: 5.0,
  },
];

const STORAGE_KEY = 'tiny-boat-selected-hull';

export function isPlayerBoatId(value: string): value is PlayerBoatId {
  return PLAYER_BOATS.some((boat) => boat.id === value);
}

export function loadSelectedBoatId(): PlayerBoatId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isPlayerBoatId(stored)) return stored;
  } catch {
    // ignore
  }
  return 'boat_red_runabout';
}

export function saveSelectedBoatId(id: PlayerBoatId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

/** Use the same authored footprint as imported hull collision and traffic. */
export function tuningForBoat(id: PlayerBoatId): BoatTuning {
  const footprint = primaryBoatFootprint(id);
  return {
    ...DEFAULT_BOAT_TUNING,
    hullHalfLength: footprint.hz,
    hullHalfWidth: footprint.hx,
  };
}
