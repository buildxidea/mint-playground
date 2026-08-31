import type { WeaponId } from '../data/weapons';

export type ZoneId = 'spawn' | 'mid' | 'power' | 'pap';
export type PerkId = 'revive' | 'juggernog' | 'speed' | 'doubletap';
export type ZombieArchetype = 'shambler' | 'sprinter' | 'brute';
export type PowerUpKind =
  | 'max-ammo'
  | 'insta-kill'
  | 'double-points'
  | 'nuke'
  | 'carpenter';

export type BuyableKind =
  | 'wall-buy'
  | 'door'
  | 'barrier'
  | 'power-switch'
  | 'mystery-box'
  | 'perk'
  | 'pack-a-punch';

export const STARTING_POINTS = 500;
export const MYSTERY_BOX_COST = 950;
export const PACK_A_PUNCH_COST = 5000;
export const CONCURRENT_ZOMBIE_CAP = 24;
export const INTERMISSION_SECONDS = 9;
export const LAST_STAND_SECONDS = 30;
export const POWER_UP_DURATION = 30;
export const POWER_UP_DROP_CHANCE = 0.02;
export const BOX_MOVE_AFTER_USES = 10;
/** Presentation-only growth; zombie navigation keeps its existing capsule. */
export const ZOMBIE_PRESENTATION_SCALE = 1.08;

/**
 * Canonical character-space contract for every zombie presentation.
 *
 * World units are meters, feet sit on local Y=0, +Y is up, and the actor faces
 * +Z before its runtime yaw is applied. Imported visuals should be normalized
 * to `height` once at the asset boundary, grounded by subtracting their
 * post-normalization bounds.min.y, then enlarged by `ZOMBIE_PRESENTATION_SCALE`
 * without changing the navigation capsule. Hit-region ratios are deliberately shared
 * across authored and fallback silhouettes so the head remains a readable,
 * human-scale target instead of shrinking with a particular GLB.
 */
export const ZOMBIE_PRESENTATION_CONTRACT = {
  worldUnitsPerMeter: 1,
  upAxis: '+Y',
  forwardAxis: '+Z',
  feetY: 0,
  hitRegions: {
    body: { minHeightRatio: 0.08, maxHeightRatio: 0.78 },
    head: { minHeightRatio: 0.78, maxHeightRatio: 1 },
  },
  archetypes: {
    shambler: { height: 2.02, collisionRadius: 0.44 },
    sprinter: { height: 1.92, collisionRadius: 0.41 },
    brute: { height: 2.35, collisionRadius: 0.54 },
  },
} as const;

export function zombiePresentationFor(archetype: ZombieArchetype) {
  return ZOMBIE_PRESENTATION_CONTRACT.archetypes[archetype];
}

export const DOOR_COSTS: Record<string, number> = {
  'door-spawn-mid': 750,
  'door-mid-power': 1000,
  'door-power-pap': 1250,
};

export const PERK_COSTS: Record<PerkId, number> = {
  revive: 500,
  juggernog: 2500,
  speed: 3000,
  doubletap: 2000,
};

export const PERK_LABELS: Record<PerkId, string> = {
  revive: 'Quick Pulse',
  juggernog: 'Iron Ration',
  speed: 'Snap Cola',
  doubletap: 'Twin Strike',
};

export type WallBuyDef = {
  id: string;
  weaponId: string;
  cost: number;
  ammoCost: number;
  zone: ZoneId;
};

export const WALL_BUYS: WallBuyDef[] = [
  { id: 'wall-kestrel', weaponId: 'kestrel-9', cost: 500, ammoCost: 250, zone: 'spawn' },
  { id: 'wall-arx', weaponId: 'arx-7', cost: 1200, ammoCost: 600, zone: 'mid' },
  { id: 'wall-talon', weaponId: 'talon-m4', cost: 1500, ammoCost: 750, zone: 'power' },
  { id: 'wall-brimstone', weaponId: 'brimstone-lmg6', cost: 2000, ammoCost: 1000, zone: 'pap' },
];

/** Six wall buys for Maps Outbreak single-room arenas. */
export const MAPS_WALL_BUYS: WallBuyDef[] = [
  { id: 'wall-kestrel', weaponId: 'kestrel-9', cost: 500, ammoCost: 250, zone: 'spawn' },
  { id: 'wall-arx', weaponId: 'arx-7', cost: 1200, ammoCost: 600, zone: 'spawn' },
  { id: 'wall-talon', weaponId: 'talon-m4', cost: 1500, ammoCost: 750, zone: 'spawn' },
  { id: 'wall-morrow', weaponId: 'morrow-dmr12', cost: 1600, ammoCost: 800, zone: 'spawn' },
  { id: 'wall-brimstone', weaponId: 'brimstone-lmg6', cost: 2000, ammoCost: 1000, zone: 'spawn' },
  { id: 'wall-aegis', weaponId: 'aegis-p11', cost: 400, ammoCost: 200, zone: 'spawn' },
];

export function wallBuyDefFor(id: string): WallBuyDef | undefined {
  return (
    MAPS_WALL_BUYS.find((entry) => entry.id === id) ??
    WALL_BUYS.find((entry) => entry.id === id)
  );
}

/** Stable Mint artifact IDs for zombies mode. */
export const ZOMBIES_MINT_IDS = {
  zombieWalker: 'zombie-walker',
  zombieSprinter: 'zombie-sprinter',
  mysteryBox: 'prop-mystery-box',
  teddyDeny: 'prop-teddy-deny',
  perkRevive: 'machine-perk-revive',
  perkJuggernog: 'machine-perk-juggernog',
  perkSpeed: 'machine-perk-speed',
  perkDoubletap: 'machine-perk-doubletap',
  packAPunch: 'machine-pack-a-punch',
  powerSwitch: 'prop-power-switch',
  powerupMaxAmmo: 'prop-powerup-max-ammo',
  powerupInstaKill: 'prop-powerup-insta-kill',
  powerupDoublePoints: 'prop-powerup-double-points',
  powerupNuke: 'prop-powerup-nuke',
  powerupCarpenter: 'prop-powerup-carpenter',
  wallBuyRack: 'prop-wall-buy-rack',
  purchaseDoor: 'door-zombies-purchase',
  barrierBoards: 'barrier-window-boards',
  worldArena: 'world-zombies-arena',
  audioRoundStart: 'audio-zombies-round-start',
  audioPurchase: 'audio-zombies-purchase',
  audioPowerOn: 'audio-zombies-power-on',
  audioBoxSpin: 'audio-zombies-box-spin',
  audioPowerupGrab: 'audio-zombies-powerup-grab',
  audioAttack: 'audio-zombies-attack',
} as const;

export function spawnCountForRound(round: number): number {
  const n = Math.max(1, round);
  return Math.ceil(0.000058 * n ** 3 + 0.074 * n ** 2 + 0.74 * n + 6);
}

export function zombieArchetypeForSpawn(
  round: number,
  sequence: number,
): ZombieArchetype {
  // Every round exposes the full silhouette/behavior mix. Later rounds tilt
  // toward pressure types without making the sequence random or test-flaky.
  const slot = Math.max(1, sequence);
  if (slot % (round >= 5 ? 4 : 5) === 0) return 'brute';
  if (slot % (round >= 3 ? 2 : 3) === 0) return 'sprinter';
  return 'shambler';
}

export function zombieHealthForRound(
  round: number,
  archetype: ZombieArchetype,
): number {
  const base = 50 + round * 18;
  if (archetype === 'brute') return Math.floor(base * 1.8);
  if (archetype === 'sprinter') return Math.floor(base * 0.82);
  return base;
}

export function zombieSpeedForRound(
  round: number,
  archetype: ZombieArchetype,
): number {
  const walk = 1.35 + Math.min(round, 20) * 0.08;
  if (archetype === 'brute') return Math.min(walk * 0.78, 2.65);
  if (archetype === 'sprinter') return Math.min(walk * 1.55, 4.2);
  return Math.min(round >= 8 ? walk * 1.12 : walk, 3.25);
}

export function zombieAttackDamage(
  round: number,
  archetype: ZombieArchetype,
): number {
  const base = 22 + Math.floor(round * 1.4);
  const archetypeDamage =
    archetype === 'brute'
      ? Math.min(70, Math.floor(base * 1.35))
      : archetype === 'sprinter'
        ? Math.min(48, Math.floor(base * 0.86))
        : Math.min(55, base);
  // Give a fresh run room to teach movement, doors, and weapon swapping.
  // Pressure blends back to the original curve by round six.
  const earlyRoundScale = [0.68, 0.76, 0.84, 0.92, 0.97, 1][
    Math.min(6, Math.max(1, Math.floor(round))) - 1
  ]!;
  return Math.max(1, Math.floor(archetypeDamage * earlyRoundScale));
}

export function shouldDropPowerUp(rng: () => number, pityKills: number): boolean {
  const chance = POWER_UP_DROP_CHANCE + Math.min(0.08, pityKills * 0.002);
  return rng() < chance;
}

export function randomPowerUpKind(rng: () => number): PowerUpKind {
  const kinds: PowerUpKind[] = [
    'max-ammo',
    'insta-kill',
    'double-points',
    'nuke',
    'carpenter',
  ];
  return kinds[Math.floor(rng() * kinds.length)] ?? 'max-ammo';
}

export type BoxWeaponPool = WeaponId | string;
