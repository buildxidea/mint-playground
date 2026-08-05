import type { ModeledGeometryManifest, VerifiedMvpData } from "./schema";
import {
  isAngleInsideTierAisle,
  isPointInsideBoardClearance,
} from "./aisleTopology";
import {
  OFFICIAL_SECTION_COUNT,
  OFFICIAL_SECTION_TOPOLOGY,
  type OfficialSectionTier,
} from "./officialSectionTopology";
import tierLayoutManifest from "./tierLayout.v1.json";

export type ExplorerIdentifierStatus =
  | "official-public"
  | "provided-source"
  | "modeled-anonymous";

export type ExplorerSeatAnchor = {
  id: string;
  sectionId: string;
  rowLabel: string;
  positionIndex: number;
  seatNumber: number | null;
  identifierStatus: ExplorerIdentifierStatus;
  placementStatus: "modeled-calibration-pending";
  position: [number, number, number];
  yawRad: number;
  tier: OfficialSectionTier;
  sourceIds: string[];
};

export type ExplorerRow = {
  id: string;
  sectionId: string;
  rowLabel: string;
  displayLabel: string;
  identifierStatus: ExplorerIdentifierStatus;
  placementStatus: "modeled-calibration-pending";
  isAda: boolean;
  position: [number, number, number];
  yawRad: number;
  widthM: number;
  tier: OfficialSectionTier;
  seats: ExplorerSeatAnchor[];
  sourceIds: string[];
};

export type ExplorerSection = {
  id: string;
  sectionId: string;
  numericSection: number;
  displayName: string;
  tier: OfficialSectionTier;
  level: 100 | 200 | 300 | 400;
  identifierStatus: "official-public";
  placementStatus: "modeled-calibration-pending";
  azimuthDeg: number;
  arcSpanDeg: number;
  polygon: Array<[number, number]>;
  rows: ExplorerRow[];
  sourceIds: string[];
};

export type SeatExplorerCatalog = {
  schemaVersion: "1.0.0";
  claimBoundary: string;
  sections: ExplorerSection[];
  coverage: {
    officialSections: number;
    sourcedSections: number;
    modeledSections: number;
    totalRows: number;
    sourcedRows: number;
    modeledRows: number;
    exactSeatIdentifiers: number;
    modeledSeatPositions: number;
    selectableChairPositions: number;
    rowCenterViews: number;
    totalSelectableAnchors: number;
    perspectivesPerAnchor: 8;
    derivedPerspectives: number;
  };
};

type TierLayout = (typeof tierLayoutManifest.tiers)[keyof typeof tierLayoutManifest.tiers];

const TIER_TREAD_M: Record<OfficialSectionTier, number> = {
  lower: 0.82,
  club: 0.9,
  "upper-300": 0.8,
  "upper-400": 0.78,
};

function degToRad(value: number): number {
  return value * Math.PI / 180;
}

function unique(...values: string[][]): string[] {
  return [...new Set(values.flat())].sort();
}

function tierLayoutFor(tier: OfficialSectionTier): TierLayout {
  return tierLayoutManifest.tiers[tier];
}

function modeledRowPose(
  layout: TierLayout,
  azimuthRad: number,
  rowIndex: number,
  rowCount: number,
): { position: [number, number, number]; radius: number } {
  const t = rowIndex / Math.max(rowCount - 1, 1);
  const halfWidth = layout.innerHalfWidthM +
    (layout.outerHalfWidthM - layout.innerHalfWidthM) * t;
  const halfLength = layout.innerHalfLengthM +
    (layout.outerHalfLengthM - layout.innerHalfLengthM) * t;
  const c = Math.cos(azimuthRad);
  const s = Math.sin(azimuthRad);
  const exponent = tierLayoutManifest.superellipseExponent;
  const denominator = Math.pow(
    Math.pow(Math.abs(c) / halfWidth, exponent) +
      Math.pow(Math.abs(s) / halfLength, exponent),
    1 / exponent,
  );
  const radius = denominator > 0 ? 1 / denominator : 0;
  return {
    position: [
      c * radius,
      layout.innerElevationM + (layout.outerElevationM - layout.innerElevationM) * t,
      s * radius,
    ],
    radius,
  };
}

function polygonForSection(
  azimuthDeg: number,
  frontRadiusM: number,
  rearRadiusM: number,
  arcSpanDeg: number,
): Array<[number, number]> {
  const a0 = degToRad(azimuthDeg - arcSpanDeg / 2);
  const a1 = degToRad(azimuthDeg + arcSpanDeg / 2);
  return [
    [Math.cos(a0) * frontRadiusM, Math.sin(a0) * frontRadiusM],
    [Math.cos(a1) * frontRadiusM, Math.sin(a1) * frontRadiusM],
    [Math.cos(a1) * rearRadiusM, Math.sin(a1) * rearRadiusM],
    [Math.cos(a0) * rearRadiusM, Math.sin(a0) * rearRadiusM],
  ];
}

function seatPosition(
  rowPosition: [number, number, number],
  yawRad: number,
  rightOffsetM: number,
): [number, number, number] {
  const rightX = -Math.cos(yawRad);
  const rightZ = Math.sin(yawRad);
  return [
    rowPosition[0] + rightX * rightOffsetM,
    rowPosition[1],
    rowPosition[2] + rightZ * rightOffsetM,
  ];
}

function createModeledSeats(input: {
  sectionId: string;
  rowLabel: string;
  tier: OfficialSectionTier;
  position: [number, number, number];
  yawRad: number;
  widthM: number;
  sourceIds: string[];
}): ExplorerSeatAnchor[] {
  const pitchM = input.tier === "club" ? 0.56 : 0.53;
  const usableWidthM = Math.max(3.4, input.widthM - 1.2);
  const requestedCount = Math.max(6, Math.min(34, Math.floor(usableWidthM / pitchM)));
  const seats: ExplorerSeatAnchor[] = [];
  for (let index = 0; index < requestedCount; index += 1) {
    const positionIndex = index + 1;
    const offset = requestedCount === 1
      ? 0
      : usableWidthM / 2 - index * (usableWidthM / (requestedCount - 1));
    const position = seatPosition(input.position, input.yawRad, offset);
    const angle = Math.atan2(position[2], position[0]);
    const radius = Math.hypot(position[0], position[2]);
    if (isAngleInsideTierAisle(input.tier, angle, radius, 0.1)) continue;
    if (isPointInsideBoardClearance(position[0], position[1], position[2], 0.16)) continue;
    seats.push({
      id: `position:${input.sectionId}:${input.rowLabel}:${positionIndex}`,
      sectionId: input.sectionId,
      rowLabel: input.rowLabel,
      positionIndex,
      seatNumber: null,
      identifierStatus: "modeled-anonymous",
      placementStatus: "modeled-calibration-pending",
      position,
      yawRad: input.yawRad,
      tier: input.tier,
      sourceIds: unique(input.sourceIds, ["modeled-seat-position-v1"]),
    });
  }
  return seats;
}

export function buildSeatExplorerCatalog(
  data: VerifiedMvpData,
  geometry: ModeledGeometryManifest,
): SeatExplorerCatalog {
  const sections: ExplorerSection[] = OFFICIAL_SECTION_TOPOLOGY.map((topology) => {
    const suppliedSection = data.sections.find((section) => section.sectionId === topology.sectionId);
    const suppliedGeometry = geometry.sections.find((section) => section.sectionId === topology.sectionId);
    const layout = tierLayoutFor(topology.tier);
    const rowCount = suppliedSection?.rows.length ?? layout.visualRowCount;
    const azimuthRad = degToRad(topology.azimuthDeg);
    const yawRad = Math.PI * 1.5 - azimuthRad;
    const rows: ExplorerRow[] = [];

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const suppliedRow = suppliedSection?.rows[rowIndex];
      const rowLabel = suppliedRow?.rowLabel ?? `M${String(rowIndex + 1).padStart(2, "0")}`;
      const suppliedCenterline = suppliedGeometry?.rowCenterlines.find(
        (row) => row.rowLabel === rowLabel,
      );
      const fallbackPose = modeledRowPose(layout, azimuthRad, rowIndex, rowCount);
      const position = suppliedCenterline?.origin ?? fallbackPose.position;
      const rowYawRad = suppliedCenterline?.yawRad ?? yawRad;
      const radius = Math.hypot(position[0], position[2]);
      const widthM = suppliedCenterline?.widthM ??
        2 * radius * Math.tan(degToRad(topology.arcSpanDeg / 2));
      const rowSourceIds = unique(
        topology.sourceIds,
        suppliedRow?.sourceIds ?? [],
        suppliedCenterline?.sourceIds ?? [],
        ["modeled-seat-explorer-v1"],
      );
      const exactSeats = data.seats
        .filter((seat) => seat.sectionId === topology.sectionId && seat.rowLabel === rowLabel)
        .sort((a, b) => a.seatNumber - b.seatNumber)
        .map((seat, exactIndex): ExplorerSeatAnchor | null => {
          const modeledSeat = suppliedGeometry?.seats.find(
            (item) => item.rowLabel === rowLabel && item.seatNumber === seat.seatNumber,
          );
          if (!modeledSeat) return null;
          return {
            id: `seat:${topology.sectionId}:${rowLabel}:${seat.seatNumber}`,
            sectionId: topology.sectionId,
            rowLabel,
            positionIndex: exactIndex + 1,
            seatNumber: seat.seatNumber,
            identifierStatus: "provided-source",
            placementStatus: "modeled-calibration-pending",
            position: modeledSeat.position,
            yawRad: modeledSeat.yawRad,
            tier: topology.tier,
            sourceIds: unique(seat.sourceIds, modeledSeat.sourceIds),
          };
        })
        .filter((seat): seat is ExplorerSeatAnchor => seat != null);
      const isAda = suppliedRow?.isAda ?? false;
      const seats = isAda
        ? []
        : exactSeats.length
          ? exactSeats
          : createModeledSeats({
            sectionId: topology.sectionId,
            rowLabel,
            tier: topology.tier,
            position,
            yawRad: rowYawRad,
            widthM,
            sourceIds: rowSourceIds,
          });
      rows.push({
        id: `row:${topology.sectionId}:${rowLabel}`,
        sectionId: topology.sectionId,
        rowLabel,
        displayLabel: suppliedRow ? `Row ${rowLabel}` : `Modeled row ${rowIndex + 1}`,
        identifierStatus: suppliedRow ? "provided-source" : "modeled-anonymous",
        placementStatus: "modeled-calibration-pending",
        isAda,
        position: [...position],
        yawRad: rowYawRad,
        widthM,
        tier: topology.tier,
        seats,
        sourceIds: rowSourceIds,
      });
    }

    const rowRadii = rows.map((row) => Math.hypot(row.position[0], row.position[2]));
    const frontRadiusM = Math.min(...rowRadii);
    const rearRadiusM = Math.max(...rowRadii) + TIER_TREAD_M[topology.tier];
    return {
      id: `section:${topology.sectionId}`,
      sectionId: topology.sectionId,
      numericSection: topology.numericSection,
      displayName: suppliedSection?.displayName ?? topology.displayName,
      tier: topology.tier,
      level: topology.level,
      identifierStatus: "official-public",
      placementStatus: "modeled-calibration-pending",
      azimuthDeg: topology.azimuthDeg,
      arcSpanDeg: topology.arcSpanDeg,
      polygon: polygonForSection(
        topology.azimuthDeg,
        frontRadiusM,
        rearRadiusM,
        topology.arcSpanDeg,
      ),
      rows,
      sourceIds: unique(topology.sourceIds, suppliedSection?.sourceIds ?? []),
    };
  });

  const allRows = sections.flatMap((section) => section.rows);
  const allSeats = allRows.flatMap((row) => row.seats);
  const sourcedRows = allRows.filter((row) => row.identifierStatus === "provided-source").length;
  const exactSeatIdentifiers = allSeats.filter(
    (seat) => seat.identifierStatus === "provided-source",
  ).length;
  const totalSelectableAnchors = allRows.length + allSeats.length;
  return {
    schemaVersion: "1.0.0",
    claimBoundary:
      "All official 2026 bowl sections and all generated chair objects are navigable. Only supplied row and P234 seat identifiers are represented as sourced identifiers; other rows and chairs remain modeled anonymous positions.",
    sections,
    coverage: {
      officialSections: OFFICIAL_SECTION_COUNT,
      sourcedSections: sections.filter((section) =>
        data.sections.some((supplied) => supplied.sectionId === section.sectionId)
      ).length,
      modeledSections: sections.filter((section) =>
        !data.sections.some((supplied) => supplied.sectionId === section.sectionId)
      ).length,
      totalRows: allRows.length,
      sourcedRows,
      modeledRows: allRows.length - sourcedRows,
      exactSeatIdentifiers,
      modeledSeatPositions: allSeats.length - exactSeatIdentifiers,
      selectableChairPositions: allSeats.length,
      rowCenterViews: allRows.length,
      totalSelectableAnchors,
      perspectivesPerAnchor: 8,
      derivedPerspectives: totalSelectableAnchors * 8,
    },
  };
}

export function findExplorerSection(
  catalog: SeatExplorerCatalog,
  sectionId: string,
): ExplorerSection | null {
  return catalog.sections.find((section) => section.sectionId === sectionId) ?? null;
}

export function findExplorerRow(
  catalog: SeatExplorerCatalog,
  sectionId: string,
  rowLabel: string,
): ExplorerRow | null {
  return findExplorerSection(catalog, sectionId)?.rows.find((row) => row.rowLabel === rowLabel) ?? null;
}

export function findExplorerSeat(
  catalog: SeatExplorerCatalog,
  sectionId: string,
  rowLabel: string,
  positionIndex: number,
): ExplorerSeatAnchor | null {
  return findExplorerRow(catalog, sectionId, rowLabel)?.seats.find(
    (seat) => seat.positionIndex === positionIndex,
  ) ?? null;
}

export function findExplorerAnchorById(
  catalog: SeatExplorerCatalog,
  id: string,
): ExplorerRow | ExplorerSeatAnchor | null {
  for (const section of catalog.sections) {
    for (const row of section.rows) {
      if (row.id === id) return row;
      const seat = row.seats.find((candidate) => candidate.id === id);
      if (seat) return seat;
    }
  }
  return null;
}
