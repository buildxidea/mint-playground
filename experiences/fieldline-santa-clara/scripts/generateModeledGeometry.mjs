import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash as createCryptoHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Load verified JSON and emit modeled geometry via tsx-free inline port.
// Prefer running through vitest/ts build; this script duplicates hash + generator lightly.

function createGeometryHash(input) {
  let h0 = 0x811c9dc5;
  let h1 = 0x1000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h0 ^= c;
    h0 = Math.imul(h0, 0x01000193);
    h1 ^= c;
    h1 = Math.imul(h1, 0x85ebca77);
  }
  return `geo_${(h0 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

function canonicalizeForGeometryHash(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeForGeometryHash);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalizeForGeometryHash(entry)]),
    );
  }
  return value;
}

const inputFiles = {
  canonicalJson: resolve(root, "public/data/levis_stadium_verified_mvp_data.json"),
  verifiedRowsCsv: resolve(root, "public/data/levis_stadium_verified_rows.csv"),
  verifiedSeatsCsv: resolve(root, "public/data/levis_stadium_p234_verified_seats.csv"),
};
const data = JSON.parse(readFileSync(inputFiles.canonicalJson, "utf8"));
const tierLayoutManifest = JSON.parse(
  readFileSync(resolve(root, "src/stadium/tierLayout.v1.json"), "utf8"),
);

function sha256(path) {
  return createCryptoHash("sha256").update(readFileSync(path)).digest("hex");
}

const TIER_PROFILES = {
  lower: { frontRowOffsetM: 3, rowTreadM: 0.82, rowRiseM: 0.29, baseElevationM: 1.8, radiusM: 58, arcSpanDeg: 11 },
  club: { frontRowOffsetM: 4, rowTreadM: 0.9, rowRiseM: 0.3, baseElevationM: 16, radiusM: 77, arcSpanDeg: 11.5 },
  "upper-300": { frontRowOffsetM: 3, rowTreadM: 0.8, rowRiseM: 0.32, baseElevationM: 28, radiusM: 90, arcSpanDeg: 9 },
  "upper-400": { frontRowOffsetM: 4, rowTreadM: 0.78, rowRiseM: 0.34, baseElevationM: 36, radiusM: 99, arcSpanDeg: 8 },
};

const SECTION_ARC_SPAN = { P234: 12.5, "138VIP": 12, "139VIP": 12 };
const MODELED_TIER_OVERRIDES = { "138VIP": "lower", "139VIP": "lower" };

const SECTION_AZIMUTH = {
  "101": 235, "102": 250, "104": 282, "118": 18, "119": 28,
  "138VIP": 170, "139VIP": 190, P234: 135, "322": 45, "410": 4, "421": 48,
};

const degToRad = (d) => (d * Math.PI) / 180;

function visualRowIndex(rowLabel, fallbackIndex, visualRowCount) {
  const numeric = /^\d+/.exec(rowLabel)?.[0];
  const candidate = numeric ? Number(numeric) - 1 : fallbackIndex;
  return Math.max(0, Math.min(visualRowCount - 1, candidate));
}

function tierRowPose(layout, azimuthRad, rowLabel, fallbackIndex) {
  const index = visualRowIndex(rowLabel, fallbackIndex, layout.visualRowCount);
  const t = index / Math.max(layout.visualRowCount - 1, 1);
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
    x: c * radius,
    y: layout.innerElevationM + (layout.outerElevationM - layout.innerElevationM) * t,
    z: s * radius,
    radius,
  };
}

function polygonForSection(azimuthDeg, radiusM, arcSpanDeg, depthM) {
  const a0 = degToRad(azimuthDeg - arcSpanDeg / 2);
  const a1 = degToRad(azimuthDeg + arcSpanDeg / 2);
  const r0 = radiusM;
  const r1 = radiusM + depthM;
  return [
    [Math.cos(a0) * r0, Math.sin(a0) * r0],
    [Math.cos(a1) * r0, Math.sin(a1) * r0],
    [Math.cos(a1) * r1, Math.sin(a1) * r1],
    [Math.cos(a0) * r1, Math.sin(a0) * r1],
  ];
}

const sections = data.sections.map((section) => {
  const modeledTier = MODELED_TIER_OVERRIDES[section.sectionId] ?? section.tier;
  const profile = TIER_PROFILES[modeledTier] ?? TIER_PROFILES.lower;
  const tierLayout = tierLayoutManifest.tiers[modeledTier] ?? tierLayoutManifest.tiers.lower;
  const azimuth = SECTION_AZIMUTH[section.sectionId] ?? 0;
  const azimuthRad = degToRad(azimuth);
  const arcSpanDeg = SECTION_ARC_SPAN[section.sectionId] ?? profile.arcSpanDeg;
  const rowCenterlines = section.rows.map((row, rowIndex) => {
    const pose = tierRowPose(tierLayout, azimuthRad, row.rowLabel, rowIndex);
    const origin = [pose.x, pose.y, pose.z];
    return {
      rowLabel: row.rowLabel,
      origin,
      yawRad: Math.PI * 1.5 - azimuthRad,
      widthM: 2 * pose.radius * Math.tan(degToRad(arcSpanDeg / 2)),
      status: "modeled",
      sourceIds: [...row.sourceIds, "modeled-geometry-v2", "official-2026-pricing-map"],
    };
  });
  const rowRadii = rowCenterlines.map((row) => Math.hypot(row.origin[0], row.origin[2]));
  const frontRadiusM = Math.min(...rowRadii);
  const depthM = Math.max(...rowRadii) - frontRadiusM + profile.rowTreadM;
  const polygon = polygonForSection(azimuth, frontRadiusM, arcSpanDeg, depthM);
  const seats = [];
  if (section.seatCountVerified && section.sectionId === "P234") {
    for (const centerline of rowCenterlines) {
      const seatCount = 20;
      const pitch = 0.52;
      const aisleWidth = 1.1;
      const totalWidth = (seatCount - 1) * pitch + aisleWidth * 2;
      for (let seatNumber = 1; seatNumber <= seatCount; seatNumber++) {
        const aisleOffset = (seatNumber > 4 ? aisleWidth : 0) + (seatNumber > 14 ? aisleWidth : 0);
        const rightOffset = totalWidth / 2 - ((seatNumber - 1) * pitch + aisleOffset);
        const rightX = -Math.cos(centerline.yawRad);
        const rightZ = Math.sin(centerline.yawRad);
        seats.push({
          rowLabel: centerline.rowLabel,
          seatNumber,
          position: [
            centerline.origin[0] + rightX * rightOffset,
            centerline.origin[1],
            centerline.origin[2] + rightZ * rightOffset,
          ],
          yawRad: centerline.yawRad,
          status: "modeled",
          sourceIds: [...section.sourceIds, "modeled-geometry-v2", "official-2026-pricing-map"],
        });
      }
    }
  }
  return {
    sectionId: section.sectionId,
    status: "modeled",
    sourceIds: [...section.sourceIds, "modeled-geometry-v2", "official-2026-pricing-map"],
    polygon,
    centerlineAzimuthDeg: azimuth,
    centerlineRadiusM: frontRadiusM,
    arcSpanDeg,
    tier: modeledTier,
    frontRowOffsetM: profile.frontRowOffsetM,
    rowTreadM: profile.rowTreadM,
    rowRiseM: profile.rowRiseM,
    rakeChanges: [],
    aisleGaps: [
      { afterSeatIndex: 4, widthM: 1.1 },
      { afterSeatIndex: 14, widthM: 1.1 },
    ],
    calibration: {
      status: "pending",
      confidence: 0.42,
      residuals: [{ metric: "official-map-topology-anchor", value: 1, note: "Section quadrant and ordering anchored to the official 2026 map; exact as-built angle remains pending." }],
      referenceNotes: [
        "Official 2026 seating diagram anchors section ordering and quadrant placement.",
        "Public seat-view references used for residual notes only — not redistributed.",
      ],
    },
    rowCenterlines,
    seats,
  };
});

const manifest = {
  geometryVersion: "2.5.1",
  geometryVersionHash: "",
  stadiumId: data.stadium.stadiumId,
  coordinateSystem: { origin: "field-center", units: "meters", yUp: true, status: "modeled", sourceIds: ["modeled-geometry-v2"] },
  field: {
    lengthM: 109.728,
    widthM: 48.768,
    transform: { position: [0, 0, 0], rotationYRad: 0 },
    status: "modeled",
    sourceIds: ["modeled-geometry-v2"],
  },
  eyeHeightM: {
    value: 1.2,
    status: "modeled",
    note: "Modeled seated eye height above row surface; adjustable by user height presets.",
    sourceIds: ["modeled-geometry-v2"],
  },
  occluders: [
    { id: "rail-north-lower-front", category: "rail", bounds: { min: [-14, 1.1, -58.4], max: [14, 2.1, -57.5] }, status: "modeled" },
    { id: "rail-south-lower-front", category: "rail", bounds: { min: [-14, 1.1, 57.5], max: [14, 2.1, 58.4] }, status: "modeled" },
    { id: "fascia-club-west", category: "fascia", bounds: { min: [-84, 15, -42], max: [-80, 18, 42] }, status: "modeled" },
    { id: "west-suite-tower", category: "suite-tower", bounds: { min: [-122, 0, -68], max: [-82, 66.8, 68] }, status: "modeled" },
    { id: "overhang-west-suite", category: "overhang", bounds: { min: [-122, 64.8, -68], max: [-82, 66.8, 68] }, status: "modeled" },
    { id: "tunnel-north-center", category: "tunnel", bounds: { min: [-6, 1, -81], max: [6, 8, -73] }, status: "modeled" },
    { id: "column-west-north", category: "column", bounds: { min: [-129, 0, -30], max: [-126, 43, -27] }, status: "modeled" },
    { id: "column-west-south", category: "column", bounds: { min: [-129, 0, 27], max: [-126, 43, 30] }, status: "modeled" },
    { id: "board-north", category: "video-board", bounds: { min: [-38.1, 33.9416, -113.5], max: [38.1, 54.0584, -110.5] }, status: "modeled" },
    { id: "board-south", category: "video-board", bounds: { min: [-38.1, 33.9416, 110.5], max: [38.1, 54.0584, 113.5] }, status: "modeled" },
    { id: "goalpost-north", category: "goalpost", bounds: { min: [-2.5, 0, -55], max: [2.5, 11, -53.5] }, status: "modeled" },
    { id: "goalpost-south", category: "goalpost", bounds: { min: [-2.5, 0, 53.5], max: [2.5, 11, 55] }, status: "modeled" },
  ],
  videoBoards: [
    { id: "north", position: [0, 44, -112], size: [76.2, 20.1168], status: "modeled" },
    { id: "south", position: [0, 44, 112], size: [76.2, 20.1168], status: "modeled" },
  ],
  sections,
  unknownDoNotInfer: [
    "Exact railing heights",
    "As-built aisle widths pending calibration approval",
    "Exact suite glazing setbacks",
    "Exact tunnel and vomitory dimensions",
    "Exact structural column dimensions",
    "Official survey control",
    "Current 2025 video-board center elevation, housing, and support dimensions",
    "Current 2025 sport-lighting fixture distribution and photometrics",
  ],
};

manifest.occluders = manifest.occluders.map((occluder) => ({
  ...occluder,
  sourceIds: occluder.category === "video-board"
    ? ["official-2025-media-guide", "modeled-current-board-placement"]
    : ["modeled-geometry-v2"],
}));
manifest.videoBoards = manifest.videoBoards.map((board) => ({
  ...board,
  sourceIds: ["official-2025-media-guide", "modeled-current-board-placement"],
}));

const hashableManifest = { ...manifest };
delete hashableManifest.geometryVersionHash;
manifest.geometryVersionHash = createGeometryHash(
  JSON.stringify(canonicalizeForGeometryHash(hashableManifest)),
);

mkdirSync(resolve(root, "public/data"), { recursive: true });
writeFileSync(
  resolve(root, "public/data/levis_stadium_modeled_geometry.v1.json"),
  JSON.stringify(manifest, null, 2),
);

const quality = {
  generatedAt: new Date().toISOString(),
  stadiumId: data.stadium.stadiumId,
  sectionCount: data.sections.length,
  rowCount: data.sections.reduce((n, s) => n + s.rows.length, 0),
  seatCount: data.seats.length,
  sourcePackSeatCount: data.seats.filter((seat) => seat.status === "provided-source").length,
  independentlyPublicVerifiedSeatCount: data.seats.filter(
    (seat) => seat.status === "verified-public" || seat.status === "official-public",
  ).length,
  placementVerifiedSeatCount: 0,
  sourceAudit: data.sources.map((source) => ({
    id: source.id,
    status: source.status,
    verificationBasis: source.verificationBasis,
    independentlyCorroborated: source.independentlyCorroborated,
    publicUrl: source.publicUrl,
  })),
  issues: [],
  unknownDoNotInfer: data.unknownDoNotInfer,
  inputHashes: Object.fromEntries(
    Object.entries(inputFiles).map(([key, path]) => [key, `sha256:${sha256(path)}`]),
  ),
  perSection: data.sections.map((s) => ({
    sectionId: s.sectionId,
    rowCount: s.rows.length,
    seatCountVerified: s.seatCountVerified,
    numberedSeatCount: data.seats.filter((x) => x.sectionId === s.sectionId).length,
    adaRows: s.rows.filter((r) => r.isAda).map((r) => r.rowLabel),
    identifierStatus: s.status,
    physicalPlacementStatus: s.physicalPlacementStatus,
  })),
  geometryVersionHash: manifest.geometryVersionHash,
};

mkdirSync(resolve(root, "public/reports"), { recursive: true });
writeFileSync(resolve(root, "public/reports/data-quality.v1.json"), JSON.stringify(quality, null, 2));
writeFileSync(
  resolve(root, "public/reports/calibration.v1.json"),
  JSON.stringify(
    {
      geometryVersion: manifest.geometryVersion,
      geometryVersionHash: manifest.geometryVersionHash,
      claimBoundary:
        "Modeled for relative seat preview; calibration is pending human approval. Not architectural, survey, engineering, or as-built accuracy.",
      sections: sections.map((s) => ({
        sectionId: s.sectionId,
        status: s.calibration.status,
        confidence: s.calibration.confidence,
        residuals: s.calibration.residuals,
      })),
    },
    null,
    2,
  ),
);

console.log("Wrote modeled geometry", manifest.geometryVersionHash);
console.log("P234 seats", sections.find((s) => s.sectionId === "P234")?.seats.length);
