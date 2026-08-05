import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAngleInsideTierAisle,
  isPointInsideBoardClearance,
} from "../src/stadium/aisleTopology";
import { generateModeledGeometry } from "../src/stadium/generateSectionGeometry";
import { validateVerifiedData } from "../src/stadium/loadVenueData";
import {
  OFFICIAL_SECTION_COUNT,
  OFFICIAL_SECTION_TOPOLOGY,
} from "../src/stadium/officialSectionTopology";
import { buildSeatExplorerCatalog } from "../src/stadium/seatExplorerCatalog";
import { auditSeatExplorerViewMatrix } from "../src/stadium/seatExplorerQa";

const root = resolve(import.meta.dirname, "..");
const data = validateVerifiedData(JSON.parse(readFileSync(
  resolve(root, "public/data/levis_stadium_verified_mvp_data.json"),
  "utf8",
)));
const geometry = generateModeledGeometry(data);
const catalog = buildSeatExplorerCatalog(data, geometry);

describe("complete 3D seat explorer catalog", () => {
  it("enumerates the official 142-section bowl topology", () => {
    expect(OFFICIAL_SECTION_COUNT).toBe(142);
    expect(new Set(OFFICIAL_SECTION_TOPOLOGY.map((section) => section.sectionId)).size).toBe(142);
    expect(catalog.coverage).toMatchObject({
      officialSections: 142,
      sourcedSections: 11,
      modeledSections: 131,
      sourcedRows: 318,
      exactSeatIdentifiers: 260,
      perspectivesPerAnchor: 8,
    });
    expect(catalog.sections.filter((section) => section.level === 100)).toHaveLength(46);
    expect(catalog.sections.filter((section) => section.level === 200)).toHaveLength(46);
    expect(catalog.sections.filter((section) => section.level === 300)).toHaveLength(28);
    expect(catalog.sections.filter((section) => section.level === 400)).toHaveLength(22);
  });

  it("gives every section rows and every non-ADA row selectable chair objects", () => {
    expect(catalog.sections.every((section) => section.rows.length > 0)).toBe(true);
    const rows = catalog.sections.flatMap((section) => section.rows);
    expect(rows.every((row) => row.isAda || row.seats.length > 0)).toBe(true);
    expect(catalog.coverage.selectableChairPositions).toBeGreaterThan(60_000);
    expect(catalog.coverage.totalSelectableAnchors).toBe(
      catalog.coverage.totalRows + catalog.coverage.selectableChairPositions,
    );
    expect(catalog.coverage.derivedPerspectives).toBe(
      catalog.coverage.totalSelectableAnchors * 8,
    );
  });

  it("keeps every generated chair outside modeled aisles and scoreboard clearances", () => {
    let auditedSeatCount = 0;
    const invalidCoordinates: Array<{
      sectionId: string;
      rowId: string;
      seatId: string;
      position: number[];
    }> = [];
    const aisleIntrusions: Array<{
      sectionId: string;
      rowId: string;
      seatId: string;
      position: number[];
    }> = [];
    const boardIntrusions: Array<{
      sectionId: string;
      rowId: string;
      seatId: string;
      position: number[];
      volumeId: string;
    }> = [];
    for (const section of catalog.sections) {
      for (const row of section.rows) {
        for (const seat of row.seats) {
          const [x, y, z] = seat.position;
          const location = {
            sectionId: section.id,
            rowId: row.id,
            seatId: seat.id,
            position: [x, y, z],
          };
          auditedSeatCount += 1;
          if (
            invalidCoordinates.length === 0 &&
            !(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))
          ) {
            invalidCoordinates.push(location);
          }
          if (
            aisleIntrusions.length === 0 &&
            isAngleInsideTierAisle(
              seat.tier,
              Math.atan2(z, x),
              Math.hypot(x, z),
              0.1,
            )
          ) {
            aisleIntrusions.push(location);
          }
          const boardIntrusion = isPointInsideBoardClearance(x, y, z, 0.16);
          if (boardIntrusions.length === 0 && boardIntrusion) {
            boardIntrusions.push({
              ...location,
              volumeId: boardIntrusion.id,
            });
          }
        }
      }
    }
    expect({
      auditedSeatCount,
      invalidCoordinates,
      aisleIntrusions,
      boardIntrusions,
    }).toEqual({
      auditedSeatCount: catalog.coverage.selectableChairPositions,
      invalidCoordinates: [],
      aisleIntrusions: [],
      boardIntrusions: [],
    });
  });

  it("uses globally stable unique row and chair anchor IDs", () => {
    const rows = catalog.sections.flatMap((section) => section.rows);
    const seats = rows.flatMap((row) => row.seats);
    const ids = [
      ...catalog.sections.map((section) => section.id),
      ...rows.map((row) => row.id),
      ...seats.map((seat) => seat.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(seats.filter((seat) => seat.identifierStatus === "provided-source")).toHaveLength(260);
    expect(seats.filter((seat) => seat.identifierStatus === "modeled-anonymous").every(
      (seat) => seat.seatNumber == null && seat.id.startsWith("position:"),
    )).toBe(true);
  });

  it("resolves every anchor through all eight camera perspectives", () => {
    const audit = auditSeatExplorerViewMatrix(catalog, geometry);
    expect(audit).toMatchObject({
      anchorCount: catalog.coverage.totalSelectableAnchors,
      perspectiveCount: 8,
      testedViewStates: catalog.coverage.derivedPerspectives,
      expectedViewStates: catalog.coverage.derivedPerspectives,
      invalidAnchorCount: 0,
      invalidViewStateCount: 0,
      chairObjectsAudited: catalog.coverage.selectableChairPositions,
      seatCorridorIntersections: 0,
      boardClearanceSeatIntrusions: 0,
      perspectiveIdsUnique: true,
      pass: true,
    });
  });
});
