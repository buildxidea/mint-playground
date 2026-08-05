import { createHash } from "./hash";
import type { ModeledGeometryManifest, VerifiedMvpData } from "./schema";
import tierLayoutManifest from "./tierLayout.v1.json";

/** Approximate NFL field playing surface (meters). Modeled, not survey. */
const FIELD_LENGTH_M = 109.728; // 120 yd including end zones
const FIELD_WIDTH_M = 48.768; // 53.3 yd

type TierProfile = {
  frontRowOffsetM: number;
  rowTreadM: number;
  rowRiseM: number;
  baseElevationM: number;
  radiusM: number;
  arcSpanDeg: number;
};

const TIER_PROFILES: Record<string, TierProfile> = {
  lower: {
    frontRowOffsetM: 3,
    rowTreadM: 0.82,
    rowRiseM: 0.29,
    baseElevationM: 1.8,
    radiusM: 58,
    arcSpanDeg: 11,
  },
  club: {
    frontRowOffsetM: 4,
    rowTreadM: 0.9,
    rowRiseM: 0.3,
    baseElevationM: 16,
    radiusM: 77,
    arcSpanDeg: 11.5,
  },
  "upper-300": {
    frontRowOffsetM: 3,
    rowTreadM: 0.8,
    rowRiseM: 0.32,
    baseElevationM: 28,
    radiusM: 90,
    arcSpanDeg: 9,
  },
  "upper-400": {
    frontRowOffsetM: 4,
    rowTreadM: 0.78,
    rowRiseM: 0.34,
    baseElevationM: 36,
    radiusM: 99,
    arcSpanDeg: 8,
  },
};

const SECTION_ARC_SPAN: Record<string, number> = {
  P234: 12.5,
  "138VIP": 12,
  "139VIP": 12,
};

// 138/139 carry VIP access labels but occupy the 100-level lower-bowl family
// on the official map. Their access class must not push their cameras into the
// west suite-tower volume.
const MODELED_TIER_OVERRIDES: Record<string, string> = {
  "138VIP": "lower",
  "139VIP": "lower",
};

/** Section azimuths around the bowl (degrees from +X / east, CCW). Modeled layout. */
const SECTION_AZIMUTH: Record<string, number> = {
  "101": 235,
  "102": 250,
  "104": 282,
  "118": 18,
  "119": 28,
  "138VIP": 170,
  "139VIP": 190,
  P234: 135,
  "322": 45,
  "410": 4,
  "421": 48,
};

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

type TierLayout = (typeof tierLayoutManifest.tiers)[keyof typeof tierLayoutManifest.tiers];

function tierLayoutFor(id: string): TierLayout {
  return tierLayoutManifest.tiers[id as keyof typeof tierLayoutManifest.tiers] ??
    tierLayoutManifest.tiers.lower;
}

function visualRowIndex(rowLabel: string, fallbackIndex: number, visualRowCount: number): number {
  const numeric = /^\d+/.exec(rowLabel)?.[0];
  const candidate = numeric ? Number(numeric) - 1 : fallbackIndex;
  return Math.max(0, Math.min(visualRowCount - 1, candidate));
}

function tierRowPose(
  layout: TierLayout,
  azimuthRad: number,
  rowLabel: string,
  fallbackIndex: number,
): { x: number; y: number; z: number; radius: number } {
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

function polygonForSection(
  azimuthDeg: number,
  radiusM: number,
  arcSpanDeg: number,
  depthM: number,
): Array<[number, number]> {
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

/**
 * Canonicalize generated geometry before version hashing. Node and Chromium can
 * differ at the last few binary digits for trigonometric operations; those
 * differences are immaterial to placement but must not invalidate the shared
 * artifact/runtime signature.
 */
function canonicalizeForGeometryHash(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeForGeometryHash);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalizeForGeometryHash(entry)]),
    );
  }
  return value;
}

export function generateModeledGeometry(data: VerifiedMvpData): ModeledGeometryManifest {
  const sections = data.sections.map((section) => {
    const modeledTier = MODELED_TIER_OVERRIDES[section.sectionId] ?? section.tier;
    const profile = TIER_PROFILES[modeledTier] ?? TIER_PROFILES.lower!;
    const tierLayout = tierLayoutFor(modeledTier);
    const azimuth = SECTION_AZIMUTH[section.sectionId] ?? 0;
    const azimuthRad = degToRad(azimuth);
    const arcSpanDeg = SECTION_ARC_SPAN[section.sectionId] ?? profile.arcSpanDeg;
    const rowCenterlines = section.rows.map((row, rowIndex) => {
      const pose = tierRowPose(tierLayout, azimuthRad, row.rowLabel, rowIndex);
      // Three.js +Z-forward yaw that points from this radial section toward field center.
      const yawRad = Math.PI * 1.5 - azimuthRad;
      const widthM = 2 * pose.radius * Math.tan(degToRad(arcSpanDeg / 2));
      return {
        rowLabel: row.rowLabel,
        origin: [pose.x, pose.y, pose.z] as [number, number, number],
        yawRad,
        widthM,
        status: "modeled" as const,
        sourceIds: [...row.sourceIds, "modeled-geometry-v2", "official-2026-pricing-map"],
      };
    });
    const rowRadii = rowCenterlines.map((row) => Math.hypot(row.origin[0], row.origin[2]));
    const frontRadiusM = Math.min(...rowRadii);
    const depthM = Math.max(...rowRadii) - frontRadiusM + profile.rowTreadM;
    const polygon = polygonForSection(azimuth, frontRadiusM, arcSpanDeg, depthM);

    const seats: ModeledGeometryManifest["sections"][number]["seats"] = [];
    if (section.seatCountVerified && section.sectionId === "P234") {
      // Seat 1 on the right while facing the field.
      for (const centerline of rowCenterlines) {
        const seatCount = 20;
        const pitch = 0.52;
        const aisleWidth = 1.1;
        const totalWidth = (seatCount - 1) * pitch + aisleWidth * 2;
        for (let seatNumber = 1; seatNumber <= seatCount; seatNumber++) {
          const aisleOffset = (seatNumber > 4 ? aisleWidth : 0) +
            (seatNumber > 14 ? aisleWidth : 0);
          const distanceFromRight = (seatNumber - 1) * pitch + aisleOffset;
          const rightOffset = totalWidth / 2 - distanceFromRight;
          const rightX = -Math.cos(centerline.yawRad);
          const rightZ = Math.sin(centerline.yawRad);
          const px = centerline.origin[0] + rightX * rightOffset;
          const py = centerline.origin[1];
          const pz = centerline.origin[2] + rightZ * rightOffset;
          seats.push({
            rowLabel: centerline.rowLabel,
            seatNumber,
            position: [px, py, pz],
            yawRad: centerline.yawRad,
            status: "modeled",
            sourceIds: [...section.sourceIds, "modeled-geometry-v2", "official-2026-pricing-map"],
          });
        }
      }
    }

    return {
      sectionId: section.sectionId,
      status: "modeled" as const,
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
        status: "pending" as const,
        confidence: 0.42,
        residuals: [
          {
            metric: "official-map-topology-anchor",
            value: 1,
            note: "Section quadrant and ordering anchored to the official 2026 map; exact as-built angle remains pending.",
          },
        ],
        referenceNotes: [
          "Official 2026 seating diagram anchors section ordering and quadrant placement.",
          "Public seat-view references used for residual notes only — not redistributed.",
        ],
      },
      rowCenterlines,
      seats,
    };
  });

  const manifestWithoutHash = {
    geometryVersion: "2.5.1",
    geometryVersionHash: "",
    stadiumId: data.stadium.stadiumId,
    coordinateSystem: {
      origin: "field-center" as const,
      units: "meters" as const,
      yUp: true as const,
      status: "modeled" as const,
      sourceIds: ["modeled-geometry-v2"],
    },
    field: {
      lengthM: FIELD_LENGTH_M,
      widthM: FIELD_WIDTH_M,
      transform: {
        position: [0, 0, 0] as [number, number, number],
        rotationYRad: 0,
      },
      status: "modeled" as const,
      sourceIds: ["modeled-geometry-v2"],
    },
    eyeHeightM: {
      value: 1.2,
      status: "modeled" as const,
      note: "Modeled seated eye height above row surface; adjustable by user height presets.",
      sourceIds: ["modeled-geometry-v2"],
    },
    occluders: [
      {
        id: "rail-north-lower-front",
        category: "rail" as const,
        bounds: {
          min: [-14, 1.1, -58.4] as [number, number, number],
          max: [14, 2.1, -57.5] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "rail-south-lower-front",
        category: "rail" as const,
        bounds: {
          min: [-14, 1.1, 57.5] as [number, number, number],
          max: [14, 2.1, 58.4] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "fascia-club-west",
        category: "fascia" as const,
        bounds: {
          min: [-84, 15, -42] as [number, number, number],
          max: [-80, 18, 42] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "west-suite-tower",
        category: "suite-tower" as const,
        bounds: {
          min: [-122, 0, -68] as [number, number, number],
          max: [-82, 66.8, 68] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "overhang-west-suite",
        category: "overhang" as const,
        bounds: {
          min: [-122, 64.8, -68] as [number, number, number],
          max: [-82, 66.8, 68] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "tunnel-north-center",
        category: "tunnel" as const,
        bounds: {
          min: [-6, 1, -81] as [number, number, number],
          max: [6, 8, -73] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "column-west-north",
        category: "column" as const,
        bounds: {
          min: [-129, 0, -30] as [number, number, number],
          max: [-126, 43, -27] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "column-west-south",
        category: "column" as const,
        bounds: {
          min: [-129, 0, 27] as [number, number, number],
          max: [-126, 43, 30] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "board-north",
        category: "video-board" as const,
        bounds: {
          min: [-38.1, 33.9416, -113.5] as [number, number, number],
          max: [38.1, 54.0584, -110.5] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["official-2025-media-guide", "modeled-current-board-placement"],
      },
      {
        id: "board-south",
        category: "video-board" as const,
        bounds: {
          min: [-38.1, 33.9416, 110.5] as [number, number, number],
          max: [38.1, 54.0584, 113.5] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["official-2025-media-guide", "modeled-current-board-placement"],
      },
      {
        id: "goalpost-north",
        category: "goalpost" as const,
        bounds: {
          min: [-2.5, 0, -55] as [number, number, number],
          max: [2.5, 11, -53.5] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
      {
        id: "goalpost-south",
        category: "goalpost" as const,
        bounds: {
          min: [-2.5, 0, 53.5] as [number, number, number],
          max: [2.5, 11, 55] as [number, number, number],
        },
        status: "modeled" as const,
        sourceIds: ["modeled-geometry-v2"],
      },
    ],
    videoBoards: [
      {
        id: "north" as const,
        position: [0, 44, -112] as [number, number, number],
        size: [76.2, 20.1168] as [number, number],
        status: "modeled" as const,
        sourceIds: ["official-2025-media-guide", "modeled-current-board-placement"],
      },
      {
        id: "south" as const,
        position: [0, 44, 112] as [number, number, number],
        size: [76.2, 20.1168] as [number, number],
        status: "modeled" as const,
        sourceIds: ["official-2025-media-guide", "modeled-current-board-placement"],
      },
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

  const geometryVersionHash = createHash(JSON.stringify(canonicalizeForGeometryHash({
    ...manifestWithoutHash,
    geometryVersionHash: undefined,
  })));

  return {
    ...manifestWithoutHash,
    geometryVersionHash,
  };
}
