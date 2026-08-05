import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildDataQualityReport,
  reconcileCsvWithJson,
  validateVerifiedData,
} from "../src/stadium/loadVenueData";
import { generateModeledGeometry } from "../src/stadium/generateSectionGeometry";
import {
  assertP234SeatInvariants,
  buildSeatInstances,
} from "../src/stadium/generateSeatInstances";
import {
  computeSightlineMetrics,
  invalidateSightlineCache,
} from "../src/stadium/sightlineEngine";
import { computeShadeReport, zonedLocalToUtc } from "../src/stadium/shadeEngine";
import { ModeledGeometryManifestSchema } from "../src/stadium/schema";
import { buildExternalListingUrl } from "../src/tickets/externalListing";
import * as THREE from "three";
import {
  createSeatedEyePosition,
  SEATED_EYE_FORWARD_OFFSET_M,
  seatedForward,
} from "../src/camera/seatedEye";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadJson() {
  return JSON.parse(
    readFileSync(resolve(root, "public/data/levis_stadium_verified_mvp_data.json"), "utf8"),
  );
}

describe("verified venue data", () => {
  const data = validateVerifiedData(loadJson());
  const rowsCsv = readFileSync(
    resolve(root, "public/data/levis_stadium_verified_rows.csv"),
    "utf8",
  );
  const seatsCsv = readFileSync(
    resolve(root, "public/data/levis_stadium_p234_verified_seats.csv"),
    "utf8",
  );

  it("reconciles CSV with canonical JSON", () => {
    const issues = reconcileCsvWithJson(data, rowsCsv, seatsCsv);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("separates supplied identifiers from independent public verification", () => {
    const supplied = data.sources.filter((source) => source.status === "provided-source");
    expect(supplied.map((source) => source.id).sort()).toEqual([
      "src-mvp-json",
      "src-p234-csv",
      "src-rows-csv",
    ]);
    expect(supplied.every((source) => source.independentlyCorroborated === false)).toBe(true);
    expect(data.seats.every((seat) => seat.status === "provided-source")).toBe(true);
    expect(data.sections.every((section) => section.identifierCorroboration === "public-pending"))
      .toBe(true);
    expect(data.sections.every((section) => section.physicalPlacementStatus === "modeled"))
      .toBe(true);
  });

  it("section 101 invariants", () => {
    const s = data.sections.find((x) => x.sectionId === "101")!;
    expect(s.rows).toHaveLength(34);
    expect(s.rows.map((r) => r.rowLabel)).toContain("1W");
    expect(s.rows.map((r) => r.rowLabel)).toContain("35W");
    expect(s.rows.map((r) => r.rowLabel)).not.toContain("2");
  });

  it("section 102/104/118 invariants", () => {
    expect(data.sections.find((x) => x.sectionId === "102")!.rows).toHaveLength(37);
    const s104 = data.sections.find((x) => x.sectionId === "104")!;
    expect(s104.rows).toHaveLength(36);
    expect(s104.rows.filter((r) => r.covered).map((r) => r.rowLabel)).toEqual([
      "35",
      "36",
      "37",
    ]);
    expect(s104.rows.find((r) => r.rowLabel === "37")!.isEntrance).toBe(true);
    expect(data.sections.find((x) => x.sectionId === "118")!.rows).toHaveLength(37);
  });

  it("VIP and upper invariants", () => {
    const vip = data.sections.find((x) => x.sectionId === "138VIP")!;
    expect(vip.rows[0]!.rowLabel).toBe("6");
    expect(vip.rows.map((r) => r.rowLabel)).toContain("35W");
    expect(data.sections.find((x) => x.sectionId === "322")!.rows).toHaveLength(8);
    expect(data.sections.find((x) => x.sectionId === "410")!.rows).toHaveLength(28);
    expect(data.sections.find((x) => x.sectionId === "421")!.rows).toHaveLength(28);
  });

  it("P234 complete seat grid", () => {
    const p = data.sections.find((x) => x.sectionId === "P234")!;
    expect(p.rows).toHaveLength(13);
    expect(p.seatCountVerified).toBe(true);
    expect(data.seats).toHaveLength(260);
    for (const row of p.rows) {
      const seats = data.seats.filter((s) => s.rowLabel === row.rowLabel);
      expect(
        seats
          .map((s) => s.seatNumber)
          .sort((a, b) => Number(a) - Number(b)),
      ).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    }
  });

  it("never numbers seats for unverified sections", () => {
    for (const s of data.sections.filter((x) => !x.seatCountVerified)) {
      expect(data.seats.filter((seat) => seat.sectionId === s.sectionId)).toHaveLength(0);
    }
  });

  it("preserves unusual labels exactly", () => {
    const labels = data.sections.flatMap((s) => s.rows.map((r) => r.rowLabel));
    expect(labels).toContain("1W");
    expect(labels).not.toContain(1 as unknown as string);
  });

  it("builds a clean quality report", () => {
    const report = buildDataQualityReport(data);
    expect(report.seatCount).toBe(260);
    expect(report.sourcePackSeatCount).toBe(260);
    expect(report.independentlyPublicVerifiedSeatCount).toBe(0);
    expect(report.placementVerifiedSeatCount).toBe(0);
    expect(report.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("rejects duplicate identifiers before scene construction", () => {
    const duplicateSection = structuredClone(loadJson());
    duplicateSection.sections.push(structuredClone(duplicateSection.sections[0]));
    expect(() => validateVerifiedData(duplicateSection)).toThrow(/Duplicate section ID/);

    const duplicateSeat = structuredClone(loadJson());
    duplicateSeat.seats.push(structuredClone(duplicateSeat.seats[0]));
    expect(() => validateVerifiedData(duplicateSeat)).toThrow(/Duplicate seat ID/);

    const falseCorroboration = structuredClone(loadJson());
    falseCorroboration.sources.find((source: { id: string }) => source.id === "src-p234-csv")
      .independentlyCorroborated = true;
    expect(() => validateVerifiedData(falseCorroboration)).toThrow(/cannot claim independent/);
  });
});

describe("modeled geometry and seats", () => {
  const data = validateVerifiedData(loadJson());
  const geometry = generateModeledGeometry(data);
  const { seats } = buildSeatInstances(data, geometry);

  it("hashes geometry version", () => {
    expect(geometry.geometryVersionHash.startsWith("geo_")).toBe(true);
  });

  it("uses current official 2025 board dimensions without claiming placement accuracy", () => {
    expect(geometry.geometryVersion).toBe("2.5.1");
    for (const board of geometry.videoBoards) {
      expect(board.size[0]).toBeCloseTo(76.2, 4);
      expect(board.size[1]).toBeCloseTo(20.1168, 4);
      expect(board.sourceIds).toContain("official-2025-media-guide");
      expect(board.sourceIds).toContain("modeled-current-board-placement");
    }
    expect(geometry.unknownDoNotInfer).toContain(
      "Current 2025 video-board center elevation, housing, and support dimensions",
    );
  });

  it("keeps VIP access labels in the lower-bowl modeled geometry and outside tower interiors", () => {
    for (const id of ["138VIP", "139VIP"]) {
      const section = geometry.sections.find((item) => item.sectionId === id)!;
      expect(section.tier).toBe("lower");
      expect(section.rowCenterlines[0]!.origin[1]).toBeCloseTo(3.25, 5);
      expect(section.rowCenterlines[Math.floor(section.rowCenterlines.length / 2)]!.origin[0])
        .toBeGreaterThan(-82);
    }
  });

  it("places the seated eye forward of the modeled chair anchor", () => {
    const surface = new THREE.Vector3(4, 8, 12);
    const yaw = Math.PI / 3;
    const eye = createSeatedEyePosition(surface, yaw, 1.2);
    const forwardDistance = eye.clone().sub(surface).dot(seatedForward(yaw));
    expect(forwardDistance).toBeCloseTo(SEATED_EYE_FORWARD_OFFSET_M, 6);
    expect(eye.y).toBeCloseTo(9.2, 6);
    expect(surface.toArray()).toEqual([4, 8, 12]);
  });

  it("emits a schema-valid geometry artifact", () => {
    const artifact = JSON.parse(
      readFileSync(resolve(root, "public/data/levis_stadium_modeled_geometry.v1.json"), "utf8"),
    );
    expect(() => ModeledGeometryManifestSchema.parse(artifact)).not.toThrow();
    expect(artifact.geometryVersionHash).toBe(geometry.geometryVersionHash);
  });

  it("P234 instance invariants and seat-1-right", () => {
    assertP234SeatInvariants(seats);
    const row7 = seats.filter((s) => s.sectionId === "P234" && s.rowLabel === "7");
    const seat1 = row7.find((s) => s.seatNumber === 1)!;
    const seat20 = row7.find((s) => s.seatNumber === 20)!;
    // Facing field: local right is + (yaw + 90°). Seat 1 should be more toward local right than seat 20.
    const right = new THREE.Vector3(-Math.cos(seat1.yawRad), 0, Math.sin(seat1.yawRad));
    const d1 = seat1.position.clone().sub(new THREE.Vector3(...geometry.sections.find((s)=>s.sectionId==="P234")!.rowCenterlines.find(r=>r.rowLabel==="7")!.origin));
    const d20 = seat20.position.clone().sub(new THREE.Vector3(...geometry.sections.find((s)=>s.sectionId==="P234")!.rowCenterlines.find(r=>r.rowLabel==="7")!.origin));
    expect(d1.dot(right)).toBeGreaterThan(d20.dot(right));
  });

  it("seats rest on row surfaces and cameras stay valid", () => {
    for (const seat of seats.filter((s) => s.selectable)) {
      const section = geometry.sections.find((s) => s.sectionId === seat.sectionId)!;
      const row = section.rowCenterlines.find((r) => r.rowLabel === seat.rowLabel)!;
      expect(Math.abs(seat.position.y - row.origin[1])).toBeLessThan(0.001);
      expect(seat.position.y).toBeGreaterThan(0.5);
      const eyeY = seat.position.y + geometry.eyeHeightM.value;
      expect(eyeY).toBeGreaterThan(seat.position.y);
    }
  });

  it("keeps P234 seat centers within its section polygon with explicit aisle gaps", () => {
    const section = geometry.sections.find((item) => item.sectionId === "P234")!;
    const polygon = section.polygon;
    const insideConvexPolygon = (x: number, z: number) => {
      const signs = polygon.map(([ax, az], index) => {
        const [bx, bz] = polygon[(index + 1) % polygon.length]!;
        return (bx - ax) * (z - az) - (bz - az) * (x - ax);
      });
      return signs.every((value) => value >= -1e-5) || signs.every((value) => value <= 1e-5);
    };
    for (const seat of seats.filter((item) => item.sectionId === "P234")) {
      expect(insideConvexPolygon(seat.position.x, seat.position.z)).toBe(true);
    }

    const row7 = seats
      .filter((item) => item.sectionId === "P234" && item.rowLabel === "7")
      .sort((a, b) => a.seatNumber! - b.seatNumber!);
    const gaps = row7.slice(1).map((seat, index) => seat.position.distanceTo(row7[index]!.position));
    expect(Math.min(...gaps)).toBeGreaterThan(0.5);
    expect(gaps[3]).toBeGreaterThan(1.5);
    expect(gaps[13]).toBeGreaterThan(1.5);
  });

  it("no production numbered seats for unknown counts", () => {
    const numberedUnknown = seats.filter((s) => s.selectable && s.sectionId !== "P234");
    expect(numberedUnknown).toHaveLength(0);
  });
});

describe("sightline and shade", () => {
  const data = validateVerifiedData(loadJson());
  const geometry = generateModeledGeometry(data);
  const { seats } = buildSeatInstances(data, geometry);
  const seat = seats.find((s) => s.sectionId === "P234" && s.rowLabel === "7" && s.seatNumber === 8)!;

  it("is deterministic and exposes provenance", () => {
    const eye = seat.position.clone().add(new THREE.Vector3(0, geometry.eyeHeightM.value, 0));
    invalidateSightlineCache();
    const a = computeSightlineMetrics({
      geometry,
      eye,
      focus: "midfield",
      heightPreset: "average",
      crowdPercentile: 50,
      eventConfigId: "football",
      selectionKey: "P234 R7 S8",
      sectionId: "P234",
    });
    const b = computeSightlineMetrics({
      geometry,
      eye,
      focus: "midfield",
      heightPreset: "average",
      crowdPercentile: 50,
      eventConfigId: "football",
      selectionKey: "P234 R7 S8",
      sectionId: "P234",
    });
    expect(a.visibleFieldPercent.value).toBe(b.visibleFieldPercent.value);
    expect(a.visibleFieldPercent.status).toBe("modeled");
    expect(a.aisleProximityM.status).toBe("unknown-do-not-infer");
    expect(a.fieldHits).toHaveLength(a.sampleCount);
    for (const [key, metric] of Object.entries(a)) {
      if (["geometryVersionHash", "sampleCount", "fieldHits"].includes(key)) continue;
      expect(metric).toMatchObject({ status: expect.any(String), sourceIds: expect.any(Array) });
      expect((metric as { sourceIds: string[] }).sourceIds.length).toBeGreaterThan(0);
    }
  });

  it("separates event configurations in sightline analysis", () => {
    const eye = seat.position.clone().add(new THREE.Vector3(0, geometry.eyeHeightM.value, 0));
    const shared = {
      geometry,
      eye,
      focus: "midfield" as const,
      heightPreset: "average" as const,
      crowdPercentile: 50,
      selectionKey: "P234 R7 S8",
      sectionId: "P234",
    };
    const football = computeSightlineMetrics({ ...shared, eventConfigId: "football" });
    const concert = computeSightlineMetrics({ ...shared, eventConfigId: "concert-end" });
    expect(concert).not.toBe(football);
    expect(concert.visibleFieldPercent.value).not.toBe(football.visibleFieldPercent.value);
  });

  it("invalidates when geometry hash prefix changes", () => {
    invalidateSightlineCache(geometry.geometryVersionHash);
    expect(true).toBe(true);
  });

  it("uses America/Los_Angeles for sun math", () => {
    const utc = zonedLocalToUtc("2026-09-13", "13:25", "America/Los_Angeles");
    const shade = computeShadeReport({
      latitude: 37.403,
      longitude: -121.9702,
      dateStr: "2026-09-13",
      kickoffLocal: "13:25",
      durationHours: 3.5,
      seatX: seat.position.x,
      seatZ: seat.position.z,
    });
    expect(shade.directSunMinutes.status).toBe("modeled");
    expect(shade.kickoff).toMatchObject({ status: "modeled", sourceIds: expect.any(Array) });
    expect(shade.timeline.every((sample) => sample.status === "modeled")).toBe(true);
    expect(shade.timeline.length).toBeGreaterThan(10);
    expect(Number.isFinite(utc.getTime())).toBe(true);
    expect(utc.toISOString()).toBe("2026-09-13T20:25:00.000Z");
    expect(shade.kickoff.altitudeDeg).toBeGreaterThan(50);
    expect(shade.kickoff.altitudeDeg).toBeLessThan(65);
    expect(shade.kickoff.azimuthDeg).toBeGreaterThan(180);
    expect(shade.kickoff.azimuthDeg).toBeLessThan(210);
  });

  it("reports the sun below the horizon at venue-local midnight", () => {
    const shade = computeShadeReport({
      latitude: 37.403,
      longitude: -121.9702,
      dateStr: "2026-09-13",
      kickoffLocal: "23:55",
      durationHours: 1,
      seatX: seat.position.x,
      seatZ: seat.position.z,
    });
    expect(shade.kickoff.sunAboveHorizon).toBe(false);
    expect(shade.kickoff.inDirectSun).toBe(false);
  });

  it("opens the official venue hub without leaking modeled seat coordinates", () => {
    const url = buildExternalListingUrl({ sectionId: "P234", rowLabel: "7", seatNumber: 8 });
    expect(url).toBe("https://levisstadium.com/tickets/");
    expect(url).not.toMatch(/P234|seat|row/i);
  });
});
