import type {
  AttachmentSelection,
  AttachmentSlot,
  WeaponStats,
} from '../game/types';

export type FireMode = 'auto' | 'semi' | 'shotgun';
export type WeaponId =
  | 'arx-7'
  | 'kestrel-9'
  | 'morrow-dmr12'
  | 'brimstone-lmg6'
  | 'talon-m4'
  | 'aegis-p11'
  | 'ray-gun'
  | 'volt-caster'
  | 'nightfall-50'
  | 'hellion-aa'
  | 'pyre-thrower'
  | 'rupture-rpg'
  | 'specter-pdw'
  | 'storm-howler'
  | 'magnum-rex'
  | 'wraith-burst';

/** Campaign / ops armory + wall-buy set. Mystery-box exclusives are omitted. */
export const OPS_LOADOUT_WEAPON_IDS = [
  'arx-7',
  'kestrel-9',
  'morrow-dmr12',
  'brimstone-lmg6',
  'talon-m4',
  'aegis-p11',
] as const satisfies readonly WeaponId[];

export type OpsLoadoutWeaponId = (typeof OPS_LOADOUT_WEAPON_IDS)[number];

/** Mystery-box exclusives — never sold on wall buys. */
export const BOX_EXCLUSIVE_WEAPON_IDS = [
  'ray-gun',
  'volt-caster',
  'nightfall-50',
  'hellion-aa',
  'pyre-thrower',
  'rupture-rpg',
  'specter-pdw',
  'storm-howler',
  'magnum-rex',
  'wraith-burst',
] as const satisfies readonly WeaponId[];

export type BoxExclusiveWeaponId = (typeof BOX_EXCLUSIVE_WEAPON_IDS)[number];

/** Full mystery-box roll pool: wall guns + exclusives. */
export const BOX_WEAPON_POOL = [
  ...OPS_LOADOUT_WEAPON_IDS,
  ...BOX_EXCLUSIVE_WEAPON_IDS,
] as const satisfies readonly WeaponId[];

export function isBoxExclusiveWeapon(id: string): boolean {
  return (BOX_EXCLUSIVE_WEAPON_IDS as readonly string[]).includes(id);
}

export function isOpsLoadoutWeapon(id: string): boolean {
  return (OPS_LOADOUT_WEAPON_IDS as readonly string[]).includes(id);
}

export type WeaponDefinition = {
  id: WeaponId;
  name: string;
  shortName: string;
  className: string;
  description: string;
  fireMode: FireMode;
  roundsPerMinute: number;
  magazineSize: number;
  reserve: number;
  reloadSeconds: number;
  equipSeconds: number;
  damage: number;
  minimumDamage: number;
  falloffStart: number;
  falloffEnd: number;
  pellets: number;
  spread: number;
  recoil: number;
  suppressed: boolean;
  stats: WeaponStats;
  silhouette: {
    length: number;
    bodyHeight: number;
    bodyWidth: number;
    barrel: number;
    stock: number;
    magazine: 'box' | 'curved' | 'drum' | 'tube' | 'pistol';
  };
};

export type AttachmentDefinition = {
  id: string;
  slot: AttachmentSlot;
  name: string;
  description: string;
  modifiers: Partial<WeaponStats>;
  magazineScale?: number;
  reloadScale?: number;
  damageScale?: number;
  rangeScale?: number;
  recoilScale?: number;
  spreadScale?: number;
  suppressed?: boolean;
};

export const WEAPONS: WeaponDefinition[] = [
  {
    id: 'arx-7',
    name: 'ARX-7 Vandal',
    shortName: 'Vandal',
    className: 'Modular assault rifle',
    description:
      'A balanced short-stroke platform with measured recoil, clean sight recovery, and broad attachment compatibility.',
    fireMode: 'auto',
    roundsPerMinute: 720,
    magazineSize: 30,
    reserve: 150,
    reloadSeconds: 2.15,
    equipSeconds: 0.46,
    damage: 38,
    minimumDamage: 24,
    falloffStart: 20,
    falloffEnd: 55,
    pellets: 1,
    spread: 0.006,
    recoil: 0.018,
    suppressed: false,
    stats: { damage: 68, range: 67, fireRate: 66, accuracy: 69, mobility: 62, handling: 66 },
    silhouette: {
      length: 1.02,
      bodyHeight: 0.17,
      bodyWidth: 0.105,
      barrel: 0.34,
      stock: 0.31,
      magazine: 'curved',
    },
  },
  {
    id: 'kestrel-9',
    name: 'Kestrel-9',
    shortName: 'Kestrel',
    className: 'Close-quarters machine carbine',
    description:
      'A compact, high-cadence platform that clears tight spaces quickly but spends ammunition and loses force at distance.',
    fireMode: 'auto',
    roundsPerMinute: 930,
    magazineSize: 36,
    reserve: 180,
    reloadSeconds: 1.78,
    equipSeconds: 0.32,
    damage: 31,
    minimumDamage: 18,
    falloffStart: 11,
    falloffEnd: 34,
    pellets: 1,
    spread: 0.011,
    recoil: 0.014,
    suppressed: false,
    stats: { damage: 48, range: 38, fireRate: 88, accuracy: 56, mobility: 88, handling: 84 },
    silhouette: {
      length: 0.72,
      bodyHeight: 0.19,
      bodyWidth: 0.115,
      barrel: 0.17,
      stock: 0.2,
      magazine: 'box',
    },
  },
  {
    id: 'morrow-dmr12',
    name: 'Morrow DMR-12',
    shortName: 'Morrow',
    className: 'Semi-automatic marksman rifle',
    description:
      'A long receiver and controlled gas system reward deliberate sight pictures and punish hurried follow-up fire.',
    fireMode: 'semi',
    roundsPerMinute: 310,
    magazineSize: 18,
    reserve: 90,
    reloadSeconds: 2.35,
    equipSeconds: 0.58,
    damage: 78,
    minimumDamage: 52,
    falloffStart: 34,
    falloffEnd: 82,
    pellets: 1,
    spread: 0.0024,
    recoil: 0.034,
    suppressed: false,
    stats: { damage: 88, range: 91, fireRate: 38, accuracy: 91, mobility: 46, handling: 48 },
    silhouette: {
      length: 1.22,
      bodyHeight: 0.16,
      bodyWidth: 0.105,
      barrel: 0.47,
      stock: 0.34,
      magazine: 'box',
    },
  },
  {
    id: 'brimstone-lmg6',
    name: 'Brimstone LMG-6',
    shortName: 'Brimstone',
    className: 'Belt-fed support weapon',
    description:
      'A heavy support platform that dominates lanes through capacity and low sustained recoil at the cost of every transition.',
    fireMode: 'auto',
    roundsPerMinute: 640,
    magazineSize: 72,
    reserve: 216,
    reloadSeconds: 4.65,
    equipSeconds: 0.78,
    damage: 43,
    minimumDamage: 28,
    falloffStart: 26,
    falloffEnd: 66,
    pellets: 1,
    spread: 0.008,
    recoil: 0.021,
    suppressed: false,
    stats: { damage: 74, range: 74, fireRate: 59, accuracy: 62, mobility: 30, handling: 28 },
    silhouette: {
      length: 1.15,
      bodyHeight: 0.23,
      bodyWidth: 0.15,
      barrel: 0.4,
      stock: 0.34,
      magazine: 'drum',
    },
  },
  {
    id: 'talon-m4',
    name: 'Talon M4',
    shortName: 'Talon',
    className: 'Compact tactical shotgun',
    description:
      'A compact pump platform built for violent room entries, with severe falloff and a reload that can be interrupted.',
    fireMode: 'shotgun',
    roundsPerMinute: 104,
    magazineSize: 8,
    reserve: 40,
    reloadSeconds: 0.62,
    equipSeconds: 0.5,
    damage: 16,
    minimumDamage: 5,
    falloffStart: 7,
    falloffEnd: 23,
    pellets: 8,
    spread: 0.038,
    recoil: 0.064,
    suppressed: false,
    stats: { damage: 96, range: 27, fireRate: 25, accuracy: 42, mobility: 66, handling: 58 },
    silhouette: {
      length: 0.94,
      bodyHeight: 0.16,
      bodyWidth: 0.12,
      barrel: 0.39,
      stock: 0.27,
      magazine: 'tube',
    },
  },
  {
    id: 'aegis-p11',
    name: 'Aegis P11',
    shortName: 'Aegis',
    className: 'Integrally suppressed sidearm',
    description:
      'A quiet, fast-drawing sidearm for finishing work and covert openings. Its modest cartridge demands precision.',
    fireMode: 'semi',
    roundsPerMinute: 430,
    magazineSize: 15,
    reserve: 60,
    reloadSeconds: 1.48,
    equipSeconds: 0.22,
    damage: 24,
    minimumDamage: 14,
    falloffStart: 13,
    falloffEnd: 38,
    pellets: 1,
    spread: 0.006,
    recoil: 0.02,
    suppressed: true,
    stats: { damage: 45, range: 42, fireRate: 52, accuracy: 72, mobility: 96, handling: 94 },
    silhouette: {
      length: 0.48,
      bodyHeight: 0.17,
      bodyWidth: 0.085,
      barrel: 0.2,
      stock: 0,
      magazine: 'pistol',
    },
  },
  {
    id: 'ray-gun',
    name: 'Ray Gun',
    shortName: 'Ray Gun',
    className: 'Wonder weapon pistol',
    description:
      'A mystery-box exclusive atomizer that dumps green death into a single target. Short magazine, high payoff.',
    fireMode: 'semi',
    roundsPerMinute: 280,
    magazineSize: 20,
    reserve: 160,
    reloadSeconds: 2.4,
    equipSeconds: 0.42,
    damage: 220,
    minimumDamage: 140,
    falloffStart: 18,
    falloffEnd: 42,
    pellets: 1,
    spread: 0.004,
    recoil: 0.028,
    suppressed: false,
    stats: { damage: 96, range: 58, fireRate: 34, accuracy: 78, mobility: 72, handling: 70 },
    silhouette: {
      length: 0.52,
      bodyHeight: 0.22,
      bodyWidth: 0.12,
      barrel: 0.18,
      stock: 0,
      magazine: 'pistol',
    },
  },
  {
    id: 'volt-caster',
    name: 'Volt Caster',
    shortName: 'Volt',
    className: 'Wonder energy SMG',
    description:
      'A coil-fed mystery exclusive that shreds mid-range packs with sustained electric cadence.',
    fireMode: 'auto',
    roundsPerMinute: 880,
    magazineSize: 40,
    reserve: 200,
    reloadSeconds: 2.05,
    equipSeconds: 0.38,
    damage: 48,
    minimumDamage: 28,
    falloffStart: 14,
    falloffEnd: 40,
    pellets: 1,
    spread: 0.01,
    recoil: 0.016,
    suppressed: false,
    stats: { damage: 62, range: 52, fireRate: 86, accuracy: 60, mobility: 78, handling: 74 },
    silhouette: {
      length: 0.78,
      bodyHeight: 0.2,
      bodyWidth: 0.12,
      barrel: 0.22,
      stock: 0.18,
      magazine: 'box',
    },
  },
  {
    id: 'nightfall-50',
    name: 'Nightfall .50',
    shortName: 'Nightfall',
    className: 'Bolt-action antimateriel rifle',
    description:
      'Box-only precision rifle that deletes elite threats. Slow bolt, brutal terminal effect.',
    fireMode: 'semi',
    roundsPerMinute: 42,
    magazineSize: 5,
    reserve: 40,
    reloadSeconds: 3.4,
    equipSeconds: 0.85,
    damage: 420,
    minimumDamage: 280,
    falloffStart: 50,
    falloffEnd: 110,
    pellets: 1,
    spread: 0.0012,
    recoil: 0.09,
    suppressed: false,
    stats: { damage: 99, range: 96, fireRate: 12, accuracy: 96, mobility: 28, handling: 30 },
    silhouette: {
      length: 1.35,
      bodyHeight: 0.18,
      bodyWidth: 0.11,
      barrel: 0.58,
      stock: 0.36,
      magazine: 'box',
    },
  },
  {
    id: 'hellion-aa',
    name: 'Hellion AA',
    shortName: 'Hellion',
    className: 'Full-auto combat shotgun',
    description:
      'Drum-fed room clearer exclusive to the mystery box. Devastating up close, empty past mid-lane.',
    fireMode: 'shotgun',
    roundsPerMinute: 260,
    magazineSize: 20,
    reserve: 80,
    reloadSeconds: 3.8,
    equipSeconds: 0.62,
    damage: 18,
    minimumDamage: 6,
    falloffStart: 6,
    falloffEnd: 18,
    pellets: 8,
    spread: 0.042,
    recoil: 0.055,
    suppressed: false,
    stats: { damage: 94, range: 22, fireRate: 48, accuracy: 36, mobility: 42, handling: 40 },
    silhouette: {
      length: 0.92,
      bodyHeight: 0.22,
      bodyWidth: 0.16,
      barrel: 0.28,
      stock: 0.24,
      magazine: 'drum',
    },
  },
  {
    id: 'pyre-thrower',
    name: 'Pyre Thrower',
    shortName: 'Pyre',
    className: 'Close-range hazard projector',
    description:
      'Mystery exclusive hazard streamer. Floods doorways with volume fire that dies past arm’s length.',
    fireMode: 'auto',
    roundsPerMinute: 720,
    magazineSize: 100,
    reserve: 200,
    reloadSeconds: 3.1,
    equipSeconds: 0.7,
    damage: 22,
    minimumDamage: 8,
    falloffStart: 4,
    falloffEnd: 12,
    pellets: 1,
    spread: 0.028,
    recoil: 0.012,
    suppressed: false,
    stats: { damage: 55, range: 14, fireRate: 70, accuracy: 28, mobility: 48, handling: 44 },
    silhouette: {
      length: 0.88,
      bodyHeight: 0.24,
      bodyWidth: 0.14,
      barrel: 0.26,
      stock: 0.1,
      magazine: 'drum',
    },
  },
  {
    id: 'rupture-rpg',
    name: 'Rupture RPG',
    shortName: 'Rupture',
    className: 'Shoulder-fired launcher',
    description:
      'Box-only rocket tube. One shot clears a knot of corpses; reload is a commitment.',
    fireMode: 'semi',
    roundsPerMinute: 28,
    magazineSize: 1,
    reserve: 8,
    reloadSeconds: 3.6,
    equipSeconds: 0.95,
    damage: 650,
    minimumDamage: 320,
    falloffStart: 12,
    falloffEnd: 36,
    pellets: 1,
    spread: 0.008,
    recoil: 0.12,
    suppressed: false,
    stats: { damage: 99, range: 40, fireRate: 8, accuracy: 48, mobility: 22, handling: 18 },
    silhouette: {
      length: 1.18,
      bodyHeight: 0.2,
      bodyWidth: 0.16,
      barrel: 0.7,
      stock: 0.2,
      magazine: 'tube',
    },
  },
  {
    id: 'specter-pdw',
    name: 'Specter PDW',
    shortName: 'Specter',
    className: 'Compact personal defense weapon',
    description:
      'Mystery-box CQB specialist: faster and cleaner than wall SMGs inside tight seams.',
    fireMode: 'auto',
    roundsPerMinute: 980,
    magazineSize: 32,
    reserve: 160,
    reloadSeconds: 1.65,
    equipSeconds: 0.28,
    damage: 34,
    minimumDamage: 20,
    falloffStart: 10,
    falloffEnd: 28,
    pellets: 1,
    spread: 0.009,
    recoil: 0.012,
    suppressed: false,
    stats: { damage: 52, range: 34, fireRate: 92, accuracy: 62, mobility: 92, handling: 90 },
    silhouette: {
      length: 0.64,
      bodyHeight: 0.18,
      bodyWidth: 0.1,
      barrel: 0.14,
      stock: 0.16,
      magazine: 'box',
    },
  },
  {
    id: 'storm-howler',
    name: 'Storm Howler',
    shortName: 'Howler',
    className: 'Wonder shockwave cannon',
    description:
      'Box-exclusive thunder cannon. Slow fire, brutal close-pack deletion with a cyan storm core.',
    fireMode: 'semi',
    roundsPerMinute: 36,
    magazineSize: 2,
    reserve: 12,
    reloadSeconds: 3.2,
    equipSeconds: 0.88,
    damage: 520,
    minimumDamage: 260,
    falloffStart: 8,
    falloffEnd: 22,
    pellets: 1,
    spread: 0.02,
    recoil: 0.1,
    suppressed: false,
    stats: { damage: 98, range: 30, fireRate: 10, accuracy: 40, mobility: 26, handling: 24 },
    silhouette: {
      length: 1.05,
      bodyHeight: 0.26,
      bodyWidth: 0.18,
      barrel: 0.42,
      stock: 0.28,
      magazine: 'box',
    },
  },
  {
    id: 'magnum-rex',
    name: 'Magnum Rex',
    shortName: 'Rex',
    className: 'Heavy revolver',
    description:
      'Mystery-box hand cannon. Six thunderous rounds that punish precise timing.',
    fireMode: 'semi',
    roundsPerMinute: 140,
    magazineSize: 6,
    reserve: 48,
    reloadSeconds: 2.7,
    equipSeconds: 0.3,
    damage: 160,
    minimumDamage: 95,
    falloffStart: 16,
    falloffEnd: 38,
    pellets: 1,
    spread: 0.005,
    recoil: 0.07,
    suppressed: false,
    stats: { damage: 90, range: 48, fireRate: 22, accuracy: 70, mobility: 80, handling: 76 },
    silhouette: {
      length: 0.42,
      bodyHeight: 0.18,
      bodyWidth: 0.09,
      barrel: 0.22,
      stock: 0,
      magazine: 'pistol',
    },
  },
  {
    id: 'wraith-burst',
    name: 'Wraith Burst',
    shortName: 'Wraith',
    className: 'Exotic burst assault rifle',
    description:
      'Box-only violet-edged AR with deliberate cadence and clean mid-lane control.',
    fireMode: 'semi',
    roundsPerMinute: 520,
    magazineSize: 30,
    reserve: 150,
    reloadSeconds: 2.2,
    equipSeconds: 0.48,
    damage: 56,
    minimumDamage: 34,
    falloffStart: 22,
    falloffEnd: 58,
    pellets: 1,
    spread: 0.0055,
    recoil: 0.02,
    suppressed: false,
    stats: { damage: 74, range: 70, fireRate: 54, accuracy: 76, mobility: 60, handling: 64 },
    silhouette: {
      length: 1.0,
      bodyHeight: 0.17,
      bodyWidth: 0.105,
      barrel: 0.36,
      stock: 0.3,
      magazine: 'curved',
    },
  },
];

export const ATTACHMENTS: AttachmentDefinition[] = [
  {
    id: 'optic-iron',
    slot: 'optic',
    name: 'Low profile',
    description: 'Unobstructed peripheral view with no magnification.',
    modifiers: {},
  },
  {
    id: 'optic-holo',
    slot: 'optic',
    name: 'Osprey reflex',
    description: 'Cleaner target acquisition with a modest handling cost.',
    modifiers: { accuracy: 6, handling: -2 },
    spreadScale: 0.9,
  },
  {
    id: 'optic-2x',
    slot: 'optic',
    name: 'Vector 2×',
    description: 'Extended identification range at the cost of close transitions.',
    modifiers: { range: 8, accuracy: 9, handling: -8 },
    spreadScale: 0.82,
  },
  {
    id: 'muzzle-standard',
    slot: 'muzzle',
    name: 'Standard crown',
    description: 'Neutral muzzle behavior.',
    modifiers: {},
  },
  {
    id: 'muzzle-comp',
    slot: 'muzzle',
    name: 'Trident brake',
    description: 'Tames climb but increases report and forward weight.',
    modifiers: { accuracy: 8, handling: -4 },
    recoilScale: 0.78,
  },
  {
    id: 'muzzle-suppressor',
    slot: 'muzzle',
    name: 'Veil suppressor',
    description: 'Reduces detection radius while sacrificing terminal range.',
    modifiers: { range: -9, handling: -3 },
    damageScale: 0.95,
    rangeScale: 0.82,
    suppressed: true,
  },
  {
    id: 'mag-standard',
    slot: 'magazine',
    name: 'Standard feed',
    description: 'Baseline capacity and reload time.',
    modifiers: {},
  },
  {
    id: 'mag-extended',
    slot: 'magazine',
    name: 'Extended feed',
    description: 'More rounds between reloads with slower movement and handling.',
    modifiers: { mobility: -6, handling: -5 },
    magazineScale: 1.4,
    reloadScale: 1.12,
  },
  {
    id: 'mag-fast',
    slot: 'magazine',
    name: 'Index magazine',
    description: 'Faster reload indexing with reduced carried capacity.',
    modifiers: { handling: 6 },
    magazineScale: 0.84,
    reloadScale: 0.76,
  },
  {
    id: 'grip-standard',
    slot: 'grip',
    name: 'Hand stop',
    description: 'Neutral support-hand position.',
    modifiers: {},
  },
  {
    id: 'grip-vertical',
    slot: 'grip',
    name: 'Anchor grip',
    description: 'Stronger recoil control with slower aim transitions.',
    modifiers: { accuracy: 7, handling: -5 },
    recoilScale: 0.82,
  },
  {
    id: 'grip-angled',
    slot: 'grip',
    name: 'Skate grip',
    description: 'Quicker aim transitions with less sustained stability.',
    modifiers: { accuracy: -4, handling: 8 },
    recoilScale: 1.08,
  },
  {
    id: 'stock-standard',
    slot: 'stock',
    name: 'Field stock',
    description: 'Balanced shoulder contact.',
    modifiers: {},
  },
  {
    id: 'stock-stable',
    slot: 'stock',
    name: 'Monolith stock',
    description: 'Stable firing position with reduced movement speed.',
    modifiers: { accuracy: 8, mobility: -7 },
    recoilScale: 0.84,
  },
  {
    id: 'stock-collapsed',
    slot: 'stock',
    name: 'Breach stock',
    description: 'Fast movement and ready speed with harsher recoil.',
    modifiers: { mobility: 8, handling: 5, accuracy: -7 },
    recoilScale: 1.18,
  },
];

export const ATTACHMENT_SLOTS: AttachmentSlot[] = [
  'optic',
  'muzzle',
  'magazine',
  'grip',
  'stock',
];

export const DEFAULT_ATTACHMENTS: AttachmentSelection = {
  optic: 'optic-iron',
  muzzle: 'muzzle-standard',
  magazine: 'mag-standard',
  grip: 'grip-standard',
  stock: 'stock-standard',
};

export function getWeapon(id: string): WeaponDefinition {
  return WEAPONS.find((weapon) => weapon.id === id) ?? WEAPONS[0];
}

export function getAttachment(id: string): AttachmentDefinition {
  return ATTACHMENTS.find((attachment) => attachment.id === id) ?? ATTACHMENTS[0];
}

export function getAttachmentsForSlot(slot: AttachmentSlot): AttachmentDefinition[] {
  return ATTACHMENTS.filter((attachment) => attachment.slot === slot);
}

export function deriveStats(
  weapon: WeaponDefinition,
  selection: AttachmentSelection,
): WeaponStats {
  const result = { ...weapon.stats };
  for (const slot of ATTACHMENT_SLOTS) {
    const attachment = getAttachment(selection[slot]);
    for (const [key, value] of Object.entries(attachment.modifiers)) {
      const stat = key as keyof WeaponStats;
      result[stat] = Math.max(0, Math.min(100, result[stat] + (value ?? 0)));
    }
  }
  return result;
}

export function deriveWeaponRuntime(
  weapon: WeaponDefinition,
  selection: AttachmentSelection,
): WeaponDefinition {
  const runtime = { ...weapon, stats: deriveStats(weapon, selection) };
  for (const slot of ATTACHMENT_SLOTS) {
    const attachment = getAttachment(selection[slot]);
    runtime.magazineSize = Math.max(
      1,
      Math.round(runtime.magazineSize * (attachment.magazineScale ?? 1)),
    );
    runtime.reloadSeconds *= attachment.reloadScale ?? 1;
    runtime.damage *= attachment.damageScale ?? 1;
    runtime.minimumDamage *= attachment.damageScale ?? 1;
    runtime.falloffStart *= attachment.rangeScale ?? 1;
    runtime.falloffEnd *= attachment.rangeScale ?? 1;
    runtime.recoil *= attachment.recoilScale ?? 1;
    runtime.spread *= attachment.spreadScale ?? 1;
    runtime.suppressed ||= attachment.suppressed ?? false;
  }
  return runtime;
}
