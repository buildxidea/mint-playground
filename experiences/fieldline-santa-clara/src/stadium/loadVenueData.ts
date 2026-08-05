import {
  type RowRecord,
  type SeatRecord,
  type VerifiedMvpData,
  VerifiedMvpDataSchema,
  seatIdKey,
} from "./schema";

export type DataQualityIssue = {
  level: "error" | "warn" | "info";
  code: string;
  message: string;
};

export type DataQualityReport = {
  generatedAt: string;
  stadiumId: string;
  sectionCount: number;
  rowCount: number;
  seatCount: number;
  sourcePackSeatCount: number;
  independentlyPublicVerifiedSeatCount: number;
  placementVerifiedSeatCount: number;
  sourceAudit: Array<{
    id: string;
    status: string;
    verificationBasis: string;
    independentlyCorroborated: boolean;
    publicUrl: string | null;
  }>;
  issues: DataQualityIssue[];
  unknownDoNotInfer: string[];
  perSection: Array<{
    sectionId: string;
    rowCount: number;
    seatCountVerified: boolean;
    numberedSeatCount: number;
    adaRows: string[];
    identifierStatus: string;
    physicalPlacementStatus: "modeled";
  }>;
};

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split(","));
}

export function validateVerifiedData(data: unknown): VerifiedMvpData {
  const parsed = VerifiedMvpDataSchema.parse(data);
  const sourceIds = new Set(parsed.sources.map((source) => source.id));
  if (sourceIds.size !== parsed.sources.length) {
    throw new Error("Duplicate source IDs rejected");
  }
  for (const source of parsed.sources) {
    if (source.status === "provided-source" && source.independentlyCorroborated) {
      throw new Error(`Provided source ${source.id} cannot claim independent corroboration`);
    }
    if (source.status === "official-public" && (!source.publicUrl || !source.independentlyCorroborated)) {
      throw new Error(`Official source ${source.id} requires a public URL and corroboration flag`);
    }
  }
  const sectionIds = new Set<string>();

  const seatKeys = new Set<string>();
  for (const seat of parsed.seats) {
    const key = seatIdKey(seat);
    if (seatKeys.has(key)) {
      throw new Error(`Duplicate seat ID rejected: ${key}`);
    }
    seatKeys.add(key);
  }

  for (const section of parsed.sections) {
    if (sectionIds.has(section.sectionId)) {
      throw new Error(`Duplicate section ID rejected: ${section.sectionId}`);
    }
    sectionIds.add(section.sectionId);
    if (section.rowCount.value !== section.rows.length) {
      throw new Error(
        `Section ${section.sectionId} row-count mismatch: ${section.rowCount.value} declared, ${section.rows.length} records`,
      );
    }
    for (const sourceId of section.sourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`Unknown source ID ${sourceId}`);
    }
    const labels = new Set<string>();
    for (const row of section.rows) {
      if (labels.has(row.rowLabel)) {
        throw new Error(
          `Malformed section ${section.sectionId}: duplicate row label ${row.rowLabel}`,
        );
      }
      labels.add(row.rowLabel);
      if (row.sectionId !== section.sectionId) {
        throw new Error(
          `Malformed row record: section mismatch ${row.sectionId} vs ${section.sectionId}`,
        );
      }
      for (const sourceId of row.sourceIds) {
        if (!sourceIds.has(sourceId)) throw new Error(`Unknown source ID ${sourceId}`);
      }
      // Preserve unusual labels — never coerce 1W to 1.
      if (/^\d+W$/i.test(row.rowLabel) && Number.isNaN(Number(row.rowLabel))) {
        // ok — string label retained
      }
    }

    if (!section.seatCountVerified) {
      const numbered = section.rows.some((r) => r.seatCount != null);
      if (numbered) {
        throw new Error(
          `Section ${section.sectionId} is not seat-count-verified but has seat counts`,
        );
      }
    }
  }

  for (const seat of parsed.seats) {
    const section = parsed.sections.find((item) => item.sectionId === seat.sectionId);
    if (!section?.seatCountVerified) {
      throw new Error(`Seat ${seatIdKey(seat)} belongs to a section without verified seat counts`);
    }
    if (!section.rows.some((row) => row.rowLabel === seat.rowLabel)) {
      throw new Error(`Seat ${seatIdKey(seat)} references an unknown row`);
    }
    for (const sourceId of seat.sourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`Unknown source ID ${sourceId}`);
    }
  }

  return parsed;
}

export function reconcileCsvWithJson(
  data: VerifiedMvpData,
  rowsCsv: string,
  seatsCsv: string,
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const rowLines = parseCsv(rowsCsv);
  const jsonRowKeys = new Set<string>();
  for (const section of data.sections) {
    for (const row of section.rows) {
      jsonRowKeys.add(`${section.sectionId}::${row.rowLabel}`);
    }
  }

  const csvRowKeys = new Set<string>();
  for (const cols of rowLines) {
    const sectionId = cols[1];
    const rowLabel = cols[2];
    if (!sectionId || rowLabel == null || rowLabel === "") {
      issues.push({
        level: "error",
        code: "malformed-row-csv",
        message: `Malformed row CSV record: ${cols.join(",")}`,
      });
      continue;
    }
    const key = `${sectionId}::${rowLabel}`;
    if (csvRowKeys.has(key)) {
      issues.push({
        level: "error",
        code: "duplicate-row-csv",
        message: `Rows CSV contains duplicate ${key}`,
      });
    }
    csvRowKeys.add(key);
    if (!jsonRowKeys.has(key)) {
      issues.push({
        level: "error",
        code: "csv-row-missing-in-json",
        message: `Row CSV has ${key} not present in canonical JSON`,
      });
    }
  }

  for (const key of jsonRowKeys) {
    if (!csvRowKeys.has(key)) {
      issues.push({
        level: "error",
        code: "json-row-missing-in-csv",
        message: `Canonical JSON row ${key} missing from rows CSV`,
      });
    }
  }

  const seatLines = parseCsv(seatsCsv);
  const csvSeatKeys = new Set<string>();
  for (const cols of seatLines) {
    const sectionId = cols[1];
    const rowLabel = cols[2];
    const seatNumber = Number(cols[3]);
    if (!sectionId || !rowLabel || !Number.isFinite(seatNumber)) {
      issues.push({
        level: "error",
        code: "malformed-seat-csv",
        message: `Malformed seat CSV record: ${cols.join(",")}`,
      });
      continue;
    }
    const key = `${sectionId}::${rowLabel}::${seatNumber}`;
    if (csvSeatKeys.has(key)) {
      issues.push({
        level: "error",
        code: "duplicate-seat-csv",
        message: `Seats CSV contains duplicate ${key}`,
      });
    }
    csvSeatKeys.add(key);
  }

  for (const seat of data.seats) {
    const key = `${seat.sectionId}::${seat.rowLabel}::${seat.seatNumber}`;
    if (!csvSeatKeys.has(key)) {
      issues.push({
        level: "error",
        code: "json-seat-missing-in-csv",
        message: `Canonical seat ${key} missing from seats CSV`,
      });
    }
  }

  if (data.seats.length !== 260) {
    issues.push({
      level: "error",
      code: "p234-seat-count",
      message: `Expected 260 P234 seats, found ${data.seats.length}`,
    });
  }

  return issues;
}

export function buildDataQualityReport(data: VerifiedMvpData): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  const perSection = data.sections.map((section) => {
    const numberedSeatCount = data.seats.filter((s) => s.sectionId === section.sectionId).length;
    if (!section.seatCountVerified && numberedSeatCount > 0) {
      issues.push({
        level: "error",
        code: "unverifiable-numbered-seats",
        message: `Section ${section.sectionId} has numbered seats without verified seat count`,
      });
    }
    return {
      sectionId: section.sectionId,
      rowCount: section.rows.length,
      seatCountVerified: section.seatCountVerified,
      numberedSeatCount,
      adaRows: section.rows.filter((r) => r.isAda).map((r) => r.rowLabel),
      identifierStatus: section.status,
      physicalPlacementStatus: "modeled" as const,
    };
  });

  return {
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
    issues,
    unknownDoNotInfer: [...data.unknownDoNotInfer],
    perSection,
  };
}

export async function loadVenueData(
  baseUrl = `${import.meta.env.BASE_URL}data`.replace(/\/$/, ""),
): Promise<{
  data: VerifiedMvpData;
  report: DataQualityReport;
  reconcileIssues: DataQualityIssue[];
}> {
  const [jsonRes, rowsRes, seatsRes] = await Promise.all([
    fetch(`${baseUrl}/levis_stadium_verified_mvp_data.json`),
    fetch(`${baseUrl}/levis_stadium_verified_rows.csv`),
    fetch(`${baseUrl}/levis_stadium_p234_verified_seats.csv`),
  ]);

  if (!jsonRes.ok || !rowsRes.ok || !seatsRes.ok) {
    throw new Error("Failed to load verified venue data files");
  }

  const raw = await jsonRes.json();
  const data = validateVerifiedData(raw);
  const rowsCsv = await rowsRes.text();
  const seatsCsv = await seatsRes.text();
  const reconcileIssues = reconcileCsvWithJson(data, rowsCsv, seatsCsv);
  const report = buildDataQualityReport(data);
  report.issues.push(...reconcileIssues);

  const fatal = report.issues.filter((i) => i.level === "error");
  if (fatal.length) {
    throw new Error(
      `Data quality failures:\n${fatal.map((i) => `- ${i.code}: ${i.message}`).join("\n")}`,
    );
  }

  return { data, report, reconcileIssues };
}

export function getSection(data: VerifiedMvpData, sectionId: string) {
  return data.sections.find((s) => s.sectionId === sectionId) ?? null;
}

export function getRow(
  data: VerifiedMvpData,
  sectionId: string,
  rowLabel: string,
): RowRecord | null {
  const section = getSection(data, sectionId);
  return section?.rows.find((r) => r.rowLabel === rowLabel) ?? null;
}

export function listSeatsForRow(
  data: VerifiedMvpData,
  sectionId: string,
  rowLabel: string,
): SeatRecord[] {
  return data.seats.filter((s) => s.sectionId === sectionId && s.rowLabel === rowLabel);
}
