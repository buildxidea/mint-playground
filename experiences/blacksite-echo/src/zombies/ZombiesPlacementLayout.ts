import placementJson from '../assets/zombies-placement-layout.json' with { type: 'json' };

export type ZombiesPlacementKind =
  | 'player-start'
  | 'wall-buy'
  | 'door'
  | 'barrier'
  | 'power-switch'
  | 'mystery-box'
  | 'perk'
  | 'pack-a-punch'
  | 'zombie-spawn';

export type ZombiesPlacementRecord = {
  id: string;
  kind: ZombiesPlacementKind;
  roomId: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  mount: 'floor' | 'wall' | 'socket' | 'free';
};

export type ZombiesPlacementLayout = {
  version: 1;
  coordinateSpace: 'three-world-metres';
  placements: ZombiesPlacementRecord[];
};

export type ZombiesPlacementLayoutValidation = {
  valid: boolean;
  errors: string[];
};

export const ZOMBIES_PLACEMENT_LAYOUT =
  placementJson as unknown as ZombiesPlacementLayout;

/**
 * Updates the module-scoped placement import in place so editor saves apply to
 * the next zombies deploy without requiring a full page reload.
 */
export function replaceZombiesPlacementLayout(
  layout: ZombiesPlacementLayout,
): void {
  const next = structuredClone(layout) as ZombiesPlacementLayout;
  ZOMBIES_PLACEMENT_LAYOUT.version = next.version;
  ZOMBIES_PLACEMENT_LAYOUT.coordinateSpace = next.coordinateSpace;
  ZOMBIES_PLACEMENT_LAYOUT.placements = next.placements;
}

export const REQUIRED_ZOMBIES_PLACEMENT_IDS = [
  'player-start',
  'wall-kestrel',
  'wall-arx',
  'wall-talon',
  'wall-brimstone',
  'door-spawn-mid',
  'door-mid-power',
  'door-power-pap',
  'barrier-spawn-a',
  'barrier-spawn-b',
  'barrier-mid-a',
  'barrier-mid-c',
  'barrier-pap-a',
  'barrier-pap-b',
  'barrier-power-a',
  'barrier-power-c',
  'barrier-power-b',
  'barrier-power-d',
  'barrier-mid-b',
  'barrier-mid-d',
  'power-switch',
  'mystery-box-0',
  'mystery-box-1',
  'perk-revive',
  'perk-juggernog',
  'perk-speed',
  'perk-doubletap',
  'pack-a-punch',
  'sp-spawn-a',
  'sp-spawn-b',
  'sp-mid-a',
  'sp-mid-c',
  'sp-pap-a',
  'sp-pap-b',
  'sp-power-a',
  'sp-power-c',
  'sp-power-b',
  'sp-power-d',
  'sp-mid-b',
  'sp-mid-d',
] as const;

const GAMEPLAY_ITEM_KINDS = new Set<ZombiesPlacementKind>([
  'wall-buy',
  'power-switch',
  'mystery-box',
  'perk',
  'pack-a-punch',
]);

const FINITE_VECTOR_LENGTH = 3;

function finiteVector(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === FINITE_VECTOR_LENGTH &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

export function validateZombiesPlacementLayout(
  layout: ZombiesPlacementLayout,
  roomIds: readonly string[],
): ZombiesPlacementLayoutValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  const rooms = new Set(roomIds);
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
    if (!rooms.has(placement.roomId)) {
      errors.push(`${placement.id} references missing room ${placement.roomId}`);
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
  for (const requiredId of REQUIRED_ZOMBIES_PLACEMENT_IDS) {
    if (!ids.has(requiredId)) errors.push(`Missing placement ${requiredId}`);
  }
  for (const roomId of roomIds) {
    const gameplayItemCount = layout.placements.filter(
      (placement) =>
        placement.roomId === roomId &&
        GAMEPLAY_ITEM_KINDS.has(placement.kind),
    ).length;
    if (gameplayItemCount < 1) {
      errors.push(`${roomId} requires at least one gameplay item`);
    }
  }
  return { valid: errors.length === 0, errors };
}
