import type { EventConfigId } from "../app/eventConfigs";
import { SEAT_PERSPECTIVES } from "../camera/seatOccupantRig";
import type { ModeledGeometryManifest, VerifiedMvpData } from "./schema";

export type StadiumViewKind = "exact-seat" | "row-center" | "ada-row-center";

export type StadiumViewRecord = {
  id: string;
  kind: StadiumViewKind;
  sectionId: string;
  rowLabel: string;
  seatNumber: number | null;
  position: [number, number, number];
  yawRad: number;
  identifierStatus: "provided-source";
  placementStatus: "modeled-calibration-pending";
  sourceIds: string[];
  supportedEventConfigs: EventConfigId[];
};

export type StadiumViewInventory = {
  schemaVersion: "1.0.0";
  geometryVersion: string;
  geometryVersionHash: string;
  views: StadiumViewRecord[];
  coverage: {
    exactSeatViews: number;
    rowCenterViews: number;
    adaRowCenterViews: number;
    uniqueSupportedViews: number;
    perspectivesPerAnchor: number;
    derivedSeatPerspectives: number;
    eventVariants: number;
    eventPerspectiveVariants: number;
  };
  unsupported: Array<{
    viewClass: string;
    reason: string;
    status: "unknown-do-not-infer";
  }>;
};

const EVENT_CONFIGS: EventConfigId[] = [
  "football",
  "soccer",
  "concert-end",
  "concert-round",
];

function uniqueSourceIds(...sources: string[][]): string[] {
  return [...new Set(sources.flat())].sort();
}

export function buildViewInventory(
  data: VerifiedMvpData,
  geometry: ModeledGeometryManifest,
): StadiumViewInventory {
  const views: StadiumViewRecord[] = [];

  for (const section of data.sections) {
    const modeledSection = geometry.sections.find((item) => item.sectionId === section.sectionId);
    if (!modeledSection) continue;
    for (const row of section.rows) {
      const centerline = modeledSection.rowCenterlines.find(
        (item) => item.rowLabel === row.rowLabel,
      );
      if (!centerline) continue;
      views.push({
        id: `row:${section.sectionId}:${row.rowLabel}`,
        kind: row.isAda ? "ada-row-center" : "row-center",
        sectionId: section.sectionId,
        rowLabel: row.rowLabel,
        seatNumber: null,
        position: [...centerline.origin],
        yawRad: centerline.yawRad,
        identifierStatus: "provided-source",
        placementStatus: "modeled-calibration-pending",
        sourceIds: uniqueSourceIds(row.sourceIds, centerline.sourceIds),
        supportedEventConfigs: [...EVENT_CONFIGS],
      });
    }
  }

  for (const seat of data.seats) {
    const modeledSection = geometry.sections.find((item) => item.sectionId === seat.sectionId);
    const modeledSeat = modeledSection?.seats.find(
      (item) => item.rowLabel === seat.rowLabel && item.seatNumber === seat.seatNumber,
    );
    if (!modeledSeat) continue;
    views.push({
      id: `seat:${seat.sectionId}:${seat.rowLabel}:${seat.seatNumber}`,
      kind: "exact-seat",
      sectionId: seat.sectionId,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      position: [...modeledSeat.position],
      yawRad: modeledSeat.yawRad,
      identifierStatus: "provided-source",
      placementStatus: "modeled-calibration-pending",
      sourceIds: uniqueSourceIds(seat.sourceIds, modeledSeat.sourceIds),
      supportedEventConfigs: [...EVENT_CONFIGS],
    });
  }

  views.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const exactSeatViews = views.filter((view) => view.kind === "exact-seat").length;
  const adaRowCenterViews = views.filter((view) => view.kind === "ada-row-center").length;
  const rowCenterViews = views.length - exactSeatViews;
  return {
    schemaVersion: "1.0.0",
    geometryVersion: geometry.geometryVersion,
    geometryVersionHash: geometry.geometryVersionHash,
    views,
    coverage: {
      exactSeatViews,
      rowCenterViews,
      adaRowCenterViews,
      uniqueSupportedViews: views.length,
      perspectivesPerAnchor: SEAT_PERSPECTIVES.length,
      derivedSeatPerspectives: views.length * SEAT_PERSPECTIVES.length,
      eventVariants: views.length * EVENT_CONFIGS.length,
      eventPerspectiveVariants:
        views.length * SEAT_PERSPECTIVES.length * EVENT_CONFIGS.length,
    },
    unsupported: [
      {
        viewClass: "exact seats outside P234",
        reason: "Authoritative seat counts and seat identifiers are not present in the supplied source pack.",
        status: "unknown-do-not-infer",
      },
      {
        viewClass: "individual ADA and companion positions",
        reason: "ADA row identifiers exist, but individual platform and companion coordinates are not supplied.",
        status: "unknown-do-not-infer",
      },
      {
        viewClass: "suite, club-room, standing, and terrace positions",
        reason: "No authoritative position inventory is available in the current project sources.",
        status: "unknown-do-not-infer",
      },
      {
        viewClass: "event-specific temporary seating",
        reason: "No authoritative per-event temporary seating manifest is connected.",
        status: "unknown-do-not-infer",
      },
    ],
  };
}

export function findView(
  inventory: StadiumViewInventory,
  viewId: string,
): StadiumViewRecord | null {
  return inventory.views.find((view) => view.id === viewId) ?? null;
}
