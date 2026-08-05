import { z } from "zod";

export const DataStatusSchema = z.enum([
  "official-public",
  "provided-source",
  "verified-public",
  "observed-public",
  "modeled",
  "unknown-do-not-infer",
]);

export type DataStatus = z.infer<typeof DataStatusSchema>;

export const ProvenancedValueSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    status: DataStatusSchema,
    sourceIds: z.array(z.string()).min(1),
    updatedAt: z.string().optional(),
    note: z.string().optional(),
  });

export type ProvenancedValue<T> = {
  value: T | null;
  status: DataStatus;
  sourceIds: string[];
  updatedAt?: string;
  note?: string;
};

export const StadiumSeatIdSchema = z.object({
  stadiumId: z.string().min(1),
  sectionId: z.string().min(1),
  rowLabel: z.string().min(1),
  seatNumber: z.number().int().positive().optional(),
});

export type StadiumSeatId = z.infer<typeof StadiumSeatIdSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: DataStatusSchema,
  sourceType: z.enum(["user-provided-source-pack", "official-public-web"]),
  verificationBasis: z.enum([
    "user-provided-initial-source-of-truth",
    "first-party-public-source",
  ]),
  publisher: z.string(),
  publicUrl: z.string().url().nullable(),
  retrievedAt: z.string(),
  independentlyCorroborated: z.boolean(),
  evidenceSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  note: z.string(),
});

export const RowRecordSchema = z.object({
  sectionId: z.string(),
  rowLabel: z.string().min(1),
  status: DataStatusSchema,
  sourceIds: z.array(z.string()).min(1),
  isAda: z.boolean(),
  covered: z.boolean(),
  isEntrance: z.boolean(),
  seatCount: z.number().int().positive().nullable(),
  seatCountStatus: DataStatusSchema,
  updatedAt: z.string().optional(),
});

export type RowRecord = z.infer<typeof RowRecordSchema>;

export const SectionRecordSchema = z.object({
  sectionId: z.string(),
  displayName: z.string(),
  tier: z.string(),
  status: DataStatusSchema,
  sourceIds: z.array(z.string()).min(1),
  rowCount: ProvenancedValueSchema(z.number().int().nonnegative()),
  seatCountVerified: z.boolean(),
  seatIdentifierCoverage: z.enum(["source-pack-complete", "row-identifiers-only"]),
  identifierCorroboration: z.literal("public-pending"),
  physicalPlacementStatus: z.literal("modeled"),
  seatOneSide: z.string().nullable(),
  beginsAtRow: z.string().nullable(),
  notes: z.string().nullable(),
  rows: z.array(RowRecordSchema).min(1),
});

export type SectionRecord = z.infer<typeof SectionRecordSchema>;

export const SeatRecordSchema = StadiumSeatIdSchema.extend({
  seatNumber: z.number().int().positive(),
  status: DataStatusSchema,
  sourceIds: z.array(z.string()).min(1),
  updatedAt: z.string().optional(),
});

export type SeatRecord = z.infer<typeof SeatRecordSchema>;

export const VerifiedMvpDataSchema = z.object({
  schemaVersion: z.string(),
  stadium: z.object({
    stadiumId: z.string(),
    displayName: ProvenancedValueSchema(z.string()),
    productName: ProvenancedValueSchema(z.string()),
    locality: ProvenancedValueSchema(z.string()),
    timezone: ProvenancedValueSchema(z.string()),
    latitude: ProvenancedValueSchema(z.number()),
    longitude: ProvenancedValueSchema(z.number()),
    capacity: ProvenancedValueSchema(z.number()),
  }),
  sources: z.array(SourceSchema),
  truthPolicy: z.object({
    statuses: z.array(DataStatusSchema),
    rules: z.array(z.string()),
  }),
  sections: z.array(SectionRecordSchema),
  seats: z.array(SeatRecordSchema),
  unknownDoNotInfer: z.array(z.string()),
});

export type VerifiedMvpData = z.infer<typeof VerifiedMvpDataSchema>;

export const Vec3Schema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
]) as unknown as z.ZodType<[number, number, number]>;

export const ModeledSectionGeometrySchema = z.object({
  sectionId: z.string(),
  status: z.literal("modeled"),
  sourceIds: z.array(z.string()).min(1),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  centerlineAzimuthDeg: z.number(),
  centerlineRadiusM: z.number(),
  arcSpanDeg: z.number(),
  tier: z.string(),
  frontRowOffsetM: z.number(),
  rowTreadM: z.number(),
  rowRiseM: z.number(),
  rakeChanges: z.array(
    z.object({
      afterRowIndex: z.number().int().nonnegative(),
      rowRiseM: z.number(),
    }),
  ),
  aisleGaps: z.array(
    z.object({
      afterSeatIndex: z.number().int().nonnegative(),
      widthM: z.number(),
    }),
  ),
  calibration: z.object({
    status: z.enum(["pending", "approved", "rejected"]),
    confidence: z.number().min(0).max(1),
    residuals: z.array(
      z.object({
        metric: z.string(),
        value: z.number(),
        note: z.string().optional(),
      }),
    ),
    referenceNotes: z.array(z.string()),
  }),
  rowCenterlines: z.array(
    z.object({
      rowLabel: z.string(),
      origin: Vec3Schema,
      yawRad: z.number(),
      widthM: z.number(),
      status: z.literal("modeled"),
      sourceIds: z.array(z.string()).min(1),
    }),
  ),
  seats: z.array(
    z.object({
      rowLabel: z.string(),
      seatNumber: z.number().int().positive(),
      position: Vec3Schema,
      yawRad: z.number(),
      status: z.literal("modeled"),
      sourceIds: z.array(z.string()).min(1),
    }),
  ),
});

export const ModeledGeometryManifestSchema = z.object({
  geometryVersion: z.string(),
  geometryVersionHash: z.string(),
  stadiumId: z.string(),
  coordinateSystem: z.object({
    origin: z.literal("field-center"),
    units: z.literal("meters"),
    yUp: z.literal(true),
    status: z.literal("modeled"),
    sourceIds: z.array(z.string()).min(1),
  }),
  field: z.object({
    lengthM: z.number(),
    widthM: z.number(),
    transform: z.object({
      position: Vec3Schema,
      rotationYRad: z.number(),
    }),
    status: z.literal("modeled"),
    sourceIds: z.array(z.string()).min(1),
  }),
  eyeHeightM: z.object({
    value: z.number(),
    status: z.literal("modeled"),
    note: z.string(),
    sourceIds: z.array(z.string()).min(1),
  }),
  occluders: z.array(
    z.object({
      id: z.string(),
      category: z.enum([
        "rail",
        "fascia",
        "tunnel",
        "overhang",
        "video-board",
        "suite-tower",
        "column",
        "goalpost",
        "stage",
        "rigging",
      ]),
      bounds: z.object({
        min: Vec3Schema,
        max: Vec3Schema,
      }),
      status: z.literal("modeled"),
      sourceIds: z.array(z.string()).min(1),
    }),
  ),
  videoBoards: z.array(
    z.object({
      id: z.enum(["north", "south"]),
      position: Vec3Schema,
      size: z.tuple([z.number(), z.number()]),
      status: z.literal("modeled"),
      sourceIds: z.array(z.string()).min(1),
    }),
  ),
  sections: z.array(ModeledSectionGeometrySchema),
  unknownDoNotInfer: z.array(z.string()),
});

export type ModeledGeometryManifest = z.infer<typeof ModeledGeometryManifestSchema>;

export function seatIdKey(id: StadiumSeatId): string {
  const seat = id.seatNumber == null ? "" : `:S${id.seatNumber}`;
  return `${id.stadiumId}:${id.sectionId}:R${id.rowLabel}${seat}`;
}
