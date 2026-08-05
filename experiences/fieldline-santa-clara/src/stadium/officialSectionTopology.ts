export type OfficialSectionTier = "lower" | "club" | "upper-300" | "upper-400";

export type OfficialSectionTopology = {
  sectionId: string;
  numericSection: number;
  displayName: string;
  tier: OfficialSectionTier;
  level: 100 | 200 | 300 | 400;
  azimuthDeg: number;
  arcSpanDeg: number;
  topologyStatus: "official-public";
  placementStatus: "modeled-calibration-pending";
  sourceIds: string[];
};

export const OFFICIAL_SECTION_TOPOLOGY_SOURCE_ID = "official-2026-pricing-map";

const range = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);

const lowerClubNumbers = new Set([113, 114, 116, 117, 135, 136, 137, 139, 140, 141]);
const lowerVipNumbers = new Set([115, 138]);
const clubLevelNumbers = new Set(range(212, 220));
const premiumLevelNumbers = new Set(range(232, 246));

function canonicalId(number: number): string {
  // The supplied source pack calls 139 "139VIP". Preserve that stable ID while
  // disclosing the public 2026 map's club treatment in its display name.
  if (number === 139) return "139VIP";
  if (lowerVipNumbers.has(number)) return `${number}VIP`;
  if (lowerClubNumbers.has(number) || clubLevelNumbers.has(number)) return `C${number}`;
  if (premiumLevelNumbers.has(number)) return `P${number}`;
  return String(number);
}

function displayName(number: number): string {
  if (number === 139) return "Club 139 · source-pack VIP alias";
  if (lowerVipNumbers.has(number)) return `Section ${number} VIP`;
  if (lowerClubNumbers.has(number) || clubLevelNumbers.has(number)) return `Club ${number}`;
  if (premiumLevelNumbers.has(number)) return `Premium ${number}`;
  return `Section ${number}`;
}

function buildRing(
  numbers: number[],
  tier: OfficialSectionTier,
  level: 100 | 200 | 300 | 400,
  startAzimuthDeg: number,
  sweepDeg: number,
): OfficialSectionTopology[] {
  const step = numbers.length > 1 ? sweepDeg / (numbers.length - (sweepDeg === 360 ? 0 : 1)) : 0;
  const span = Math.max(3.9, step * 0.86);
  return numbers.map((number, index) => ({
    sectionId: canonicalId(number),
    numericSection: number,
    displayName: displayName(number),
    tier,
    level,
    azimuthDeg: (startAzimuthDeg + index * step) % 360,
    arcSpanDeg: span,
    topologyStatus: "official-public",
    placementStatus: "modeled-calibration-pending",
    sourceIds: [OFFICIAL_SECTION_TOPOLOGY_SOURCE_ID],
  }));
}

/**
 * Public 2026 bowl topology: 46 lower, 46 club/premium, 28 upper-300,
 * and 22 east-side upper-400 sections. Angular placement is a modeled
 * projection of the official diagram, not survey geometry.
 */
export const OFFICIAL_SECTION_TOPOLOGY: OfficialSectionTopology[] = [
  ...buildRing(range(101, 146), "lower", 100, 235, 360),
  ...buildRing(range(201, 246), "club", 200, 235, 360),
  ...buildRing(range(301, 328), "upper-300", 300, 235, 230),
  ...buildRing(range(401, 422), "upper-400", 400, 310, 110),
];

export const OFFICIAL_SECTION_COUNT = OFFICIAL_SECTION_TOPOLOGY.length;

export function findOfficialSection(sectionId: string): OfficialSectionTopology | null {
  return OFFICIAL_SECTION_TOPOLOGY.find((section) => section.sectionId === sectionId) ?? null;
}
