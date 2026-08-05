import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataPath = resolve(root, "public/data/levis_stadium_verified_mvp_data.json");
const geometryPath = resolve(root, "public/data/levis_stadium_modeled_geometry.v1.json");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const geometry = JSON.parse(readFileSync(geometryPath, "utf8"));
const eventConfigs = ["football", "soccer", "concert-end", "concert-round"];
const seatPerspectives = [
  "authentic-forward",
  "midfield",
  "near-goal",
  "far-goal",
  "north-board",
  "south-board",
  "left-context",
  "right-context",
];
const views = [];

const unique = (...sources) => [...new Set(sources.flat())].sort();

for (const section of data.sections) {
  const modeled = geometry.sections.find((item) => item.sectionId === section.sectionId);
  if (!modeled) continue;
  for (const row of section.rows) {
    const centerline = modeled.rowCenterlines.find((item) => item.rowLabel === row.rowLabel);
    if (!centerline) continue;
    views.push({
      id: `row:${section.sectionId}:${row.rowLabel}`,
      kind: row.isAda ? "ada-row-center" : "row-center",
      sectionId: section.sectionId,
      rowLabel: row.rowLabel,
      seatNumber: null,
      position: centerline.origin,
      yawRad: centerline.yawRad,
      identifierStatus: "provided-source",
      placementStatus: "modeled-calibration-pending",
      sourceIds: unique(row.sourceIds, centerline.sourceIds),
      supportedEventConfigs: eventConfigs,
    });
  }
}

for (const seat of data.seats) {
  const modeled = geometry.sections
    .find((item) => item.sectionId === seat.sectionId)
    ?.seats.find((item) => item.rowLabel === seat.rowLabel && item.seatNumber === seat.seatNumber);
  if (!modeled) continue;
  views.push({
    id: `seat:${seat.sectionId}:${seat.rowLabel}:${seat.seatNumber}`,
    kind: "exact-seat",
    sectionId: seat.sectionId,
    rowLabel: seat.rowLabel,
    seatNumber: seat.seatNumber,
    position: modeled.position,
    yawRad: modeled.yawRad,
    identifierStatus: "provided-source",
    placementStatus: "modeled-calibration-pending",
    sourceIds: unique(seat.sourceIds, modeled.sourceIds),
    supportedEventConfigs: eventConfigs,
  });
}

views.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
const exactSeatViews = views.filter((view) => view.kind === "exact-seat").length;
const adaRowCenterViews = views.filter((view) => view.kind === "ada-row-center").length;
const inputHashes = Object.fromEntries([dataPath, geometryPath].map((path) => [
  path.endsWith("verified_mvp_data.json") ? "verifiedData" : "modeledGeometry",
  `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`,
]));

const inventory = {
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  geometryVersion: geometry.geometryVersion,
  geometryVersionHash: geometry.geometryVersionHash,
  inputHashes,
  claimBoundary: "Every source-supported view is enumerated. Physical positions remain modeled-calibration-pending.",
  views,
  coverage: {
    exactSeatViews,
    rowCenterViews: views.length - exactSeatViews,
    adaRowCenterViews,
    uniqueSupportedViews: views.length,
    perspectivesPerAnchor: seatPerspectives.length,
    derivedSeatPerspectives: views.length * seatPerspectives.length,
    eventVariants: views.length * eventConfigs.length,
    eventPerspectiveVariants: views.length * seatPerspectives.length * eventConfigs.length,
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

mkdirSync(resolve(root, "public/data"), { recursive: true });
mkdirSync(resolve(root, "public/reports"), { recursive: true });
writeFileSync(
  resolve(root, "public/data/levis_stadium_view_inventory.v1.json"),
  `${JSON.stringify(inventory, null, 2)}\n`,
);
writeFileSync(
  resolve(root, "public/reports/view-coverage.v1.json"),
  `${JSON.stringify({
    schemaVersion: "1.0.0",
    generatedAt: inventory.generatedAt,
    geometryVersion: inventory.geometryVersion,
    geometryVersionHash: inventory.geometryVersionHash,
    coverage: inventory.coverage,
    unsupported: inventory.unsupported,
    allSupportedViewsEnumerated: true,
    allRealWorldViewsClaimed: false,
  }, null, 2)}\n`,
);
process.stdout.write(
  `Wrote ${views.length} supported anchors, ${views.length * seatPerspectives.length} perspectives, ` +
  `${views.length * seatPerspectives.length * eventConfigs.length} event/perspective variants\n`,
);
