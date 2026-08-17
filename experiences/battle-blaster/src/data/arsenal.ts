import registryJson from "../../mint-assets.json";

export type SlotType = "scope" | "barrel" | "magazine" | "grip" | "stock";

export type StatKey =
  | "damage"
  | "fireRate"
  | "range"
  | "stability"
  | "chargeSpeed";

export const STAT_LABELS: Record<StatKey, string> = {
  damage: "Damage",
  fireRate: "Fire Rate",
  range: "Range",
  stability: "Stability",
  chargeSpeed: "Handling",
};

export const STAT_ORDER: StatKey[] = [
  "damage",
  "fireRate",
  "range",
  "stability",
  "chargeSpeed",
];

/** Energy-weapon vocabulary; the slot keys stay put so anchors keep working. */
export const SLOT_LABELS: Record<SlotType, string> = {
  scope: "Optic",
  barrel: "Emitter",
  magazine: "Cell",
  grip: "Grip",
  stock: "Stabilizer",
};

export const SLOT_ORDER: SlotType[] = [
  "scope",
  "barrel",
  "magazine",
  "grip",
  "stock",
];

export type StatBlock = Record<StatKey, number>;

/**
 * Where a module mounts. The seat itself is measured off the frame's real
 * surface when the weapon loads, so this only says *where along* the frame to
 * take that measurement.
 *
 * u — along the frame axis, 0 = emitter end, 1 = rear. Used by scope, magazine
 *     and grip, which measure the surface at that point. Ignored by barrel and
 *     stock.
 * w — lateral, 0.5 = centred.
 * v — for barrel and stock, the height to aim along the frame axis, needed when
 *     the extreme end of the model is not the mount (a pistol's rearmost point
 *     is its grip heel). For the surface slots it is only a fallback, used if
 *     the probe finds nothing.
 */
export interface AnchorSpec {
  u?: number;
  v?: number;
  w?: number;
  /** Multiplies the attachment's default size for this weapon. */
  sizeScale?: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  tagline: string;
  modelUrl: string;
  /** Firing sound effect; absent until the generated audio is synced. */
  soundUrl?: string;
  /** Display length in world units after normalization. */
  displayLength: number;
  stats: StatBlock;
  /** Slots this weapon supports; a missing slot type is incompatible. */
  slots: Partial<Record<SlotType, AnchorSpec>>;
  /** Catalogue code shown in the spec-panel eyebrow, e.g. "BB-001". */
  sku: string;
  /** Edition line rendered beside the SKU. */
  edition: string;
  /** Single-word class for the spec panel, e.g. "Sidearm". */
  className: string;
  /** Spec-panel body copy. */
  description: string;
  /** Index-rail footer meta line. */
  meta: string;
}

export interface AttachmentDef {
  id: string;
  name: string;
  slot: SlotType;
  modelUrl: string;
  /** Long-axis size as a fraction of the host weapon's display length. */
  relativeSize: number;
  modifiers: Partial<Record<StatKey, number>>;
  blurb: string;
}

type MintRegistry = {
  assets: Record<string, { artifacts?: Record<string, { runtimeUrl?: string }> }>;
};

const mintArtifactUrl = (assetKey: string, artifactId: string) => {
  const url = (registryJson as MintRegistry).assets[assetKey]?.artifacts?.[artifactId]?.runtimeUrl;
  if (!url) throw new Error(`Missing Mint CDN artifact ${assetKey}:${artifactId}`);
  return url;
};

export const WEAPONS: WeaponDef[] = [
  {
    id: "ionbreaker",
    name: "Ionbreaker",
    tagline: "Service caster",
    sku: "BB-001",
    edition: "Edition 240",
    className: "Sidearm",
    description:
      "The compact end of the line. A single coil ring behind a short finned nozzle, with the cell seated flat on top of the receiver.",
    meta: "Mint asset pack · item 01 of 05",
    modelUrl: mintArtifactUrl("plasma-weapons", "asset_pack_item_glb:vd7fm7jh9n4pdmfxcqf3jxeps98c808x:0:ks73qytpfc8th8qk8s4k9v4h4h8c9ecw"),
    soundUrl: mintArtifactUrl("sfx-ionbreaker", "audio_file"),
    displayLength: 1.3,
    stats: { damage: 62, fireRate: 55, range: 40, stability: 58, chargeSpeed: 82 },
    slots: {
      scope: { u: 0.52, v: 0.8 },
      barrel: {},
      magazine: { u: 0.38, v: 0.46 },
      // The one frame with no rear brace of its own, so a stabilizer is an
      // addition rather than a second copy of a modelled part. The height is
      // authored because this frame's rearmost geometry is the heel of its
      // grip -- the mount is the pin on top of the receiver, further forward.
      stock: { v: 0.78 },
    },
  },
  {
    id: "arcwelder",
    name: "Arcwelder",
    tagline: "Coil carbine",
    sku: "BB-002",
    edition: "Edition 180",
    className: "Carbine",
    description:
      "Twin coil wraps and a downward-socketed cell. The cell and stock are part of the frame, so it takes an optic, an emitter and a grip.",
    meta: "Mint asset pack · item 02 of 05",
    modelUrl: mintArtifactUrl("plasma-weapons", "asset_pack_item_glb:vd7fm7jh9n4pdmfxcqf3jxeps98c808x:1:ks73mh9z7mw80epz7eb5h5k7hn8c8ztj"),
    soundUrl: mintArtifactUrl("sfx-arcwelder", "audio_file"),
    displayLength: 2.0,
    stats: { damage: 70, fireRate: 72, range: 62, stability: 66, chargeSpeed: 68 },
    // No magazine or stock bay: this frame already models a socketed cell and a
    // folding wire stock, so those modules would double up on existing parts.
    slots: {
      scope: { u: 0.5, v: 0.7 },
      barrel: {},
      grip: { u: 0.3, v: 0.38 },
    },
  },
  {
    id: "slagthrower",
    name: "Slagthrower",
    tagline: "Plasma thrower",
    sku: "BB-003",
    edition: "Edition 120",
    className: "Heavy",
    description:
      "The flagship. A deep-finned shroud, heavy windings at the emitter throat, and a full-length cell riding the spine.",
    meta: "Mint asset pack · item 03 of 05",
    modelUrl: mintArtifactUrl("plasma-weapons", "asset_pack_item_glb:vd7fm7jh9n4pdmfxcqf3jxeps98c808x:2:ks70rvvck6byad9nzc40525ct58c8w2x"),
    soundUrl: mintArtifactUrl("sfx-slagthrower", "audio_file"),
    displayLength: 2.2,
    stats: { damage: 96, fireRate: 30, range: 44, stability: 38, chargeSpeed: 42 },
    slots: {
      scope: { u: 0.5, v: 0.74 },
      // The muzzle face carries a bore ring and a canister ring with a hollow
      // gap between, so a whole-face centre lands in the gap on neither. 0.57
      // is the middle of the bore aperture, measured as the band where rays
      // pass into the barrel (v 0.464 to 0.679) rather than striking the rim.
      barrel: { v: 0.57 },
      // 0.55 sat at the front lip of the grip cut; the flat shelf is behind it.
      magazine: { u: 0.45, v: 0.36 },
      grip: { u: 0.38, v: 0.36 },
    },
  },
  {
    id: "longcoil",
    name: "Longcoil",
    tagline: "Marksman caster",
    sku: "BB-004",
    edition: "Edition 60",
    className: "Marksman",
    description:
      "Three coil rings spaced down an extended emitter tube. Everything on this frame is traded for reach.",
    meta: "Mint asset pack · item 04 of 05",
    modelUrl: mintArtifactUrl("plasma-weapons", "asset_pack_item_glb:vd7fm7jh9n4pdmfxcqf3jxeps98c808x:3:ks70k5nyancr9w1gch4f0fpnh18c9skz"),
    soundUrl: mintArtifactUrl("sfx-longcoil", "audio_file"),
    displayLength: 2.7,
    stats: { damage: 100, fireRate: 12, range: 100, stability: 48, chargeSpeed: 34 },
    // No stock bay: the frame already carries a full stock with a cheek riser.
    slots: {
      scope: { u: 0.52, v: 0.72 },
      barrel: {},
    },
  },
  {
    id: "boilover",
    name: "Boilover",
    tagline: "Scatter caster",
    sku: "BB-005",
    edition: "Edition 90",
    className: "Scatter",
    description:
      "Twin apertures over a slung canister. Emitter, cell, grip and stabilizer are all welded to the frame — only the optic rail takes a module.",
    meta: "Mint asset pack · item 05 of 05",
    modelUrl: mintArtifactUrl("plasma-weapons", "asset_pack_item_glb:vd7fm7jh9n4pdmfxcqf3jxeps98c808x:4:ks79ewqmetgwkhf1tm4rnzqs2x8c9y9e"),
    soundUrl: mintArtifactUrl("sfx-boilover", "audio_file"),
    displayLength: 1.9,
    stats: { damage: 88, fireRate: 28, range: 22, stability: 44, chargeSpeed: 56 },
    slots: {
      scope: { u: 0.5, v: 0.72 },
    },
  },
];

export const ATTACHMENTS: AttachmentDef[] = [
  {
    id: "holo-scope",
    name: "Holo Scope",
    slot: "scope",
    modelUrl: mintArtifactUrl("attachments", "asset_pack_item_glb:vd730pkbrbwesez24haez5dfb18c0x55:0:ks75dye1rkxe9hs6b9b6d6gygx8c1w30"),
    // Between the original 0.24, which was wider than the Longcoil it sat on,
    // and 0.14, which read too small once seated.
    relativeSize: 0.2,
    modifiers: { range: 18, chargeSpeed: -5 },
    blurb: "Holographic optic. Sharper reach, slower spin-up.",
  },
  {
    id: "emitter-extension",
    name: "Emitter Extension",
    slot: "barrel",
    modelUrl: mintArtifactUrl("attachments", "asset_pack_item_glb:vd730pkbrbwesez24haez5dfb18c0x55:1:ks73a9cpn966a4qgeatsrzygnd8c01qd"),
    // Was a 0.235-thick sleeve on a 0.055-diameter emitter tube at 0.34.
    relativeSize: 0.3,
    modifiers: { range: 12, damage: 8, fireRate: -10 },
    blurb: "Longer beam column. Hits harder, cycles slower.",
  },
  {
    id: "energy-canister",
    name: "Energy Canister",
    slot: "magazine",
    modelUrl: mintArtifactUrl("attachments", "asset_pack_item_glb:vd730pkbrbwesez24haez5dfb18c0x55:2:ks7c7jw5vbhdvptyjdwd7n20y18c1gyg"),
    relativeSize: 0.24,
    modifiers: { fireRate: 15, chargeSpeed: 10, stability: -8 },
    blurb: "Overcharged cell feed. Faster everything, twitchier handling.",
  },
  {
    id: "tactical-grip",
    name: "Tactical Grip",
    slot: "grip",
    modelUrl: mintArtifactUrl("attachments", "asset_pack_item_glb:vd730pkbrbwesez24haez5dfb18c0x55:3:ks784k64132nxr0qewnedw1ebd8c1c7e"),
    relativeSize: 0.2,
    modifiers: { stability: 20, fireRate: -5 },
    blurb: "Angled forward handle. Locks the emitter down.",
  },
  {
    id: "stabilizer-stock",
    name: "Stabilizer Stock",
    slot: "stock",
    modelUrl: mintArtifactUrl("attachments", "asset_pack_item_glb:vd730pkbrbwesez24haez5dfb18c0x55:4:ks73bp8dmc3vzne0q1sw4j74n98c1p5g"),
    relativeSize: 0.34,
    modifiers: { stability: 15, range: 8, chargeSpeed: -10 },
    blurb: "Finned shoulder rest. Steadier beams at distance.",
  },
];

export const PLATFORM_MODEL_URL = mintArtifactUrl("pedestal", "original_glb");

export function attachmentForSlot(slot: SlotType): AttachmentDef | undefined {
  return ATTACHMENTS.find((a) => a.slot === slot);
}

export function weaponById(id: string): WeaponDef {
  const weapon = WEAPONS.find((w) => w.id === id);
  if (!weapon) throw new Error(`Unknown weapon: ${id}`);
  return weapon;
}

export function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}
