import type { ModeledGeometryManifest } from "./schema";

export type CalibrationGate = {
  sectionId: string;
  status: "pending" | "approved" | "rejected";
  confidence: number;
  residuals: Array<{ metric: string; value: number; note?: string }>;
  referenceNotes: string[];
};

export function listCalibrationGates(
  geometry: ModeledGeometryManifest,
): CalibrationGate[] {
  return geometry.sections.map((s) => ({
    sectionId: s.sectionId,
    status: s.calibration.status,
    confidence: s.calibration.confidence,
    residuals: s.calibration.residuals,
    referenceNotes: s.calibration.referenceNotes,
  }));
}

export function approveSectionCalibration(
  geometry: ModeledGeometryManifest,
  sectionId: string,
  confidence: number,
): ModeledGeometryManifest {
  return {
    ...geometry,
    sections: geometry.sections.map((s) =>
      s.sectionId === sectionId
        ? {
            ...s,
            calibration: {
              ...s.calibration,
              status: "approved",
              confidence,
            },
          }
        : s,
    ),
  };
}

export function buildCalibrationReport(geometry: ModeledGeometryManifest): {
  geometryVersion: string;
  geometryVersionHash: string;
  sections: CalibrationGate[];
  claimBoundary: string;
} {
  return {
    geometryVersion: geometry.geometryVersion,
    geometryVersionHash: geometry.geometryVersionHash,
    sections: listCalibrationGates(geometry),
    claimBoundary:
      "Modeled for relative seat preview; calibration is pending human approval. Not architectural, survey, engineering, or as-built accuracy.",
  };
}
