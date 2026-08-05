export type TierAisleSpec = {
  tierId: string;
  aisleCount: number;
  widthM: number;
  status: "modeled-calibration-pending";
  sourceIds: string[];
};

export type BoardClearanceVolume = {
  id: "north" | "south";
  min: [number, number, number];
  max: [number, number, number];
  rayDirectionZ: -1 | 1;
  status: "modeled-calibration-pending";
  sourceIds: string[];
};

// Seat anchors are rejected before their chair geometry can touch a board's
// rear-clearance prism. The prism already includes a modeled edge allowance;
// this adds tolerance for the chair mesh around its anchor.
export const BOARD_SEAT_CLEARANCE_MARGIN_M = 0.35;

const TWO_PI = Math.PI * 2;

/**
 * The pricing map constrains section topology, not as-built aisle widths.
 * These widths therefore stay explicitly modeled until survey/control-point
 * evidence is approved.
 */
export const TIER_AISLE_SPECS: Record<string, TierAisleSpec> = {
  lower: {
    tierId: "lower",
    aisleCount: 28,
    widthM: 1.1,
    status: "modeled-calibration-pending",
    sourceIds: ["official-2026-pricing-map", "modeled-aisle-topology-v1"],
  },
  club: {
    tierId: "club",
    aisleCount: 28,
    widthM: 1.16,
    status: "modeled-calibration-pending",
    sourceIds: ["official-2026-pricing-map", "modeled-aisle-topology-v1"],
  },
  "upper-300": {
    tierId: "upper-300",
    aisleCount: 24,
    widthM: 1.08,
    status: "modeled-calibration-pending",
    sourceIds: ["official-2026-pricing-map", "modeled-aisle-topology-v1"],
  },
  "upper-400": {
    tierId: "upper-400",
    aisleCount: 18,
    widthM: 1.08,
    status: "modeled-calibration-pending",
    sourceIds: ["official-2026-pricing-map", "modeled-aisle-topology-v1"],
  },
};

/**
 * The current board face dimensions are official (250 x 66 ft). Placement,
 * housing depth, and the extra edge margin remain modeled. The volume starts
 * immediately behind each housing and extends to the exterior so bowl objects
 * cannot appear through or above the screen opening.
 */
export const BOARD_CLEARANCE_VOLUMES: BoardClearanceVolume[] = [
  {
    id: "north",
    min: [-38.7, 33.35, -152],
    max: [38.7, 54.65, -112.72],
    rayDirectionZ: -1,
    status: "modeled-calibration-pending",
    sourceIds: ["official-2025-media-guide", "modeled-board-clearance-v1"],
  },
  {
    id: "south",
    min: [-38.7, 33.35, 112.72],
    max: [38.7, 54.65, 152],
    rayDirectionZ: 1,
    status: "modeled-calibration-pending",
    sourceIds: ["official-2025-media-guide", "modeled-board-clearance-v1"],
  },
];

export function normalizeAngle(angle: number): number {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

export function circularAngularDistance(a: number, b: number): number {
  const delta = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(delta, TWO_PI - delta);
}

export function tierAisleCenters(tierId: string): number[] {
  const spec = TIER_AISLE_SPECS[tierId];
  if (!spec) return [];
  return Array.from({ length: spec.aisleCount }, (_, index) =>
    (index / spec.aisleCount) * TWO_PI,
  );
}

export function aisleHalfAngleRad(tierId: string, radiusM: number): number {
  const spec = TIER_AISLE_SPECS[tierId];
  if (!spec || radiusM <= 0) return 0;
  return Math.atan2(spec.widthM / 2, radiusM);
}

export function isAngleInsideTierAisle(
  tierId: string,
  angle: number,
  radiusM: number,
  marginM = 0,
): boolean {
  const spec = TIER_AISLE_SPECS[tierId];
  if (!spec) return false;
  const halfAngle = Math.atan2(spec.widthM / 2 + marginM, Math.max(radiusM, 0.001));
  return tierAisleCenters(tierId).some(
    (center) => circularAngularDistance(angle, center) < halfAngle,
  );
}

export function isPointInsideBoardClearance(
  x: number,
  y: number,
  z: number,
  insetM = 0,
): BoardClearanceVolume | null {
  return BOARD_CLEARANCE_VOLUMES.find((volume) =>
    x > volume.min[0] + insetM && x < volume.max[0] - insetM &&
    y > volume.min[1] + insetM && y < volume.max[1] - insetM &&
    z > volume.min[2] + insetM && z < volume.max[2] - insetM,
  ) ?? null;
}

export function isSeatAnchorInsideBoardClearance(
  x: number,
  y: number,
  z: number,
): BoardClearanceVolume | null {
  return isPointInsideBoardClearance(
    x,
    y,
    z,
    -BOARD_SEAT_CLEARANCE_MARGIN_M,
  );
}

export function aisleTopologySummary(): {
  corridorCount: number;
  tiers: TierAisleSpec[];
  boardClearanceVolumes: BoardClearanceVolume[];
} {
  const tiers = Object.values(TIER_AISLE_SPECS);
  return {
    corridorCount: tiers.reduce((total, tier) => total + tier.aisleCount, 0),
    tiers,
    boardClearanceVolumes: BOARD_CLEARANCE_VOLUMES,
  };
}
