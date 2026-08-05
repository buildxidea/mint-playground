import type { Vector3Tuple } from "three";

export const REFERENCE_CAMERA_IDS = [
  "aerial-oblique",
  "north-end",
  "south-end",
  "east-sideline",
  "west-suite",
  "open-end-exterior",
  "suite-interior-bowl",
  "current-board-field",
] as const;

export type ReferenceCameraId = typeof REFERENCE_CAMERA_IDS[number];

export type ReferenceCamera = {
  id: ReferenceCameraId;
  position: Vector3Tuple;
  target: Vector3Tuple;
  fovDeg: number;
  nearM: number;
  farM: number;
  sourceIds: string[];
  status: "modeled-calibration-frame";
};

export const REFERENCE_CAMERAS: Record<ReferenceCameraId, ReferenceCamera> = {
  "aerial-oblique": {
    id: "aerial-oblique",
    position: [178, 142, 184],
    target: [0, 15, 0],
    fovDeg: 44,
    nearM: 0.1,
    farM: 700,
    sourceIds: ["official-2026-pricing-map"],
    status: "modeled-calibration-frame",
  },
  "north-end": {
    id: "north-end",
    position: [58, 72, 126],
    target: [0, 23, -105],
    fovDeg: 43,
    nearM: 0.1,
    farM: 700,
    sourceIds: ["official-2026-pricing-map"],
    status: "modeled-calibration-frame",
  },
  "south-end": {
    id: "south-end",
    position: [-58, 72, -126],
    target: [0, 23, 105],
    fovDeg: 43,
    nearM: 0.1,
    farM: 700,
    sourceIds: ["official-2026-pricing-map"],
    status: "modeled-calibration-frame",
  },
  "east-sideline": {
    id: "east-sideline",
    position: [305, 145, 0],
    target: [20, 17, 0],
    fovDeg: 40,
    nearM: 0.1,
    farM: 700,
    sourceIds: ["official-2026-pricing-map", "hntb-project"],
    status: "modeled-calibration-frame",
  },
  "west-suite": {
    id: "west-suite",
    position: [210, 118, 125],
    target: [-92, 30, 0],
    fovDeg: 38,
    nearM: 0.1,
    farM: 700,
    sourceIds: ["official-2026-pricing-map", "hntb-project"],
    status: "modeled-calibration-frame",
  },
  "open-end-exterior": {
    id: "open-end-exterior",
    // Initial northeast exterior solve corresponding to the HNTB open-end
    // architectural frame. Intrinsics/extrinsics remain pending landmarks.
    position: [-250, 55, -230],
    target: [-30, 26, -95],
    fovDeg: 43,
    nearM: 0.1,
    farM: 850,
    sourceIds: ["hntb-project"],
    status: "modeled-calibration-frame",
  },
  "suite-interior-bowl": {
    id: "suite-interior-bowl",
    // Initial southwest suite-side frame looking toward the north end. This is
    // deliberately separate from the modeled seated-eye cameras.
    position: [-60, 31, 68],
    target: [2, 17, -91],
    fovDeg: 52,
    nearM: 0.05,
    farM: 650,
    sourceIds: ["hntb-project"],
    status: "modeled-calibration-frame",
  },
  "current-board-field": {
    id: "current-board-field",
    position: [1.5, 2.15, 50],
    target: [-10, 24, -108],
    fovDeg: 68,
    nearM: 0.05,
    farM: 650,
    sourceIds: ["official-2025-whats-new", "official-2025-media-guide"],
    status: "modeled-calibration-frame",
  },
};
