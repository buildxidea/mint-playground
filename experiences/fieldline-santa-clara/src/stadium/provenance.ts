import type { DataStatus, ProvenancedValue } from "./schema";

export const STATUS_LABELS: Record<DataStatus, string> = {
  "official-public": "Official public",
  "provided-source": "Provided source pack — public corroboration pending",
  "verified-public": "Verified public",
  "observed-public": "Observed public",
  modeled: "Modeled geometry — calibration pending",
  "unknown-do-not-infer": "Unknown — do not infer",
};

export function provenanced<T>(
  value: T | null,
  status: DataStatus,
  sourceIds: string[],
  note?: string,
): ProvenancedValue<T> {
  return {
    value,
    status,
    sourceIds,
    updatedAt: new Date().toISOString(),
    note,
  };
}

export function formatProvenance(p: ProvenancedValue<unknown>): string {
  const base = STATUS_LABELS[p.status];
  if (p.note) return `${base}. ${p.note}`;
  return base;
}

export function assertNeverModeledAsOfficial(status: DataStatus, label: string): void {
  if (status === "modeled" && /official|architectural|survey|as-built/i.test(label)) {
    throw new Error(`Refusing to label modeled metric as official: ${label}`);
  }
}

export const MODELED_DISCLAIMER =
  "Modeled geometry with human calibration pending — not an official architectural measurement.";
