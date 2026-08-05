import * as THREE from "three";
import { MODELED_DISCLAIMER, provenanced } from "./provenance";
import type { ModeledGeometryManifest, ProvenancedValue } from "./schema";

export type FocusTarget =
  | "midfield"
  | "near-goal"
  | "far-goal"
  | "home-sideline"
  | "away-sideline"
  | "north-board"
  | "south-board";

export type HeightPreset = "child" | "average" | "tall";

export const HEIGHT_PRESET_OFFSET_M: Record<HeightPreset, number> = {
  child: -0.25,
  average: 0,
  tall: 0.2,
};

export type SightlineMetrics = {
  geometryVersionHash: string;
  sampleCount: number;
  visibleFieldPercent: ProvenancedValue<number>;
  distanceToMidfieldM: ProvenancedValue<number>;
  distanceToNearestSidelineM: ProvenancedValue<number>;
  distanceToNearGoalM: ProvenancedValue<number>;
  distanceToFarGoalM: ProvenancedValue<number>;
  horizontalOffsetM: ProvenancedValue<number>;
  downwardAngleToMidfieldDeg: ProvenancedValue<number>;
  northBoardAngleDeg: ProvenancedValue<number>;
  southBoardAngleDeg: ProvenancedValue<number>;
  nearSidelineVisible: ProvenancedValue<boolean>;
  nearCornerVisible: ProvenancedValue<boolean>;
  obstructions: ProvenancedValue<string[]>;
  cValueClearanceM: ProvenancedValue<number>;
  aisleProximityM: ProvenancedValue<number | null>;
  fieldHits: Array<{ x: number; z: number; visible: boolean; occluder?: string }>;
};

type CacheKey = string;

const cache = new Map<CacheKey, SightlineMetrics>();

export function focusTargetPosition(
  target: FocusTarget,
  geometry: ModeledGeometryManifest,
): THREE.Vector3 {
  const halfL = geometry.field.lengthM / 2;
  const halfW = geometry.field.widthM / 2;
  switch (target) {
    case "midfield":
      return new THREE.Vector3(0, 0, 0);
    case "near-goal":
      return new THREE.Vector3(0, 0, -halfL + 5);
    case "far-goal":
      return new THREE.Vector3(0, 0, halfL - 5);
    case "home-sideline":
      return new THREE.Vector3(-halfW, 0, 0);
    case "away-sideline":
      return new THREE.Vector3(halfW, 0, 0);
    case "north-board": {
      const b = geometry.videoBoards.find((v) => v.id === "north")!;
      return new THREE.Vector3(...b.position);
    }
    case "south-board": {
      const b = geometry.videoBoards.find((v) => v.id === "south")!;
      return new THREE.Vector3(...b.position);
    }
  }
}

function buildFieldSamples(
  geometry: ModeledGeometryManifest,
  density: number,
): Array<[number, number]> {
  const samples: Array<[number, number]> = [];
  const halfL = geometry.field.lengthM / 2;
  const halfW = geometry.field.widthM / 2;
  for (let iz = 0; iz < density; iz++) {
    for (let ix = 0; ix < density; ix++) {
      const x = -halfW + ((ix + 0.5) / density) * geometry.field.widthM;
      const z = -halfL + ((iz + 0.5) / density) * geometry.field.lengthM;
      samples.push([x, z]);
    }
  }
  return samples;
}

type AnalysisOccluder = ModeledGeometryManifest["occluders"][number];

function eventOccluders(eventConfigId: string): AnalysisOccluder[] {
  if (eventConfigId === "concert-end") {
    return [{
      id: "event-end-stage",
      category: "stage" as AnalysisOccluder["category"],
      bounds: { min: [-16, 0, -49], max: [16, 24, -30] },
      status: "modeled",
      sourceIds: ["modeled-event-configuration"],
    }];
  }
  if (eventConfigId === "concert-round") {
    return [{
      id: "event-round-stage",
      category: "stage" as AnalysisOccluder["category"],
      bounds: { min: [-16, 0, -16], max: [16, 19, 16] },
      status: "modeled",
      sourceIds: ["modeled-event-configuration"],
    }];
  }
  return [];
}

function segmentAabbDistance(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  occluder: AnalysisOccluder,
): number | null {
  const direction = target.clone().sub(origin);
  let tMin = 0;
  let tMax = 1;
  for (const [axis, min, max] of [
    ["x", occluder.bounds.min[0], occluder.bounds.max[0]],
    ["y", occluder.bounds.min[1], occluder.bounds.max[1]],
    ["z", occluder.bounds.min[2], occluder.bounds.max[2]],
  ] as const) {
    const value = origin[axis];
    const delta = direction[axis];
    if (Math.abs(delta) < 1e-8) {
      if (value < min || value > max) return null;
      continue;
    }
    const a = (min - value) / delta;
    const b = (max - value) / delta;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
    if (tMin > tMax) return null;
  }
  return tMin > 0.0001 && tMin < 0.9999 ? tMin * direction.length() : null;
}

function segmentHitsOccluder(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  occluders: AnalysisOccluder[],
  activeCategories: Set<string>,
): Array<{ category: string; distance: number }> {
  const hits: Array<{ category: string; distance: number }> = [];
  for (const occluder of occluders) {
    if (!activeCategories.has(occluder.category)) continue;
    const distance = segmentAabbDistance(origin, target, occluder);
    if (distance != null) hits.push({ category: occluder.category, distance });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

export function computeSightlineMetrics(args: {
  geometry: ModeledGeometryManifest;
  eye: THREE.Vector3;
  focus: FocusTarget;
  heightPreset: HeightPreset;
  crowdPercentile: number;
  sampleDensity?: number;
  eventConfigId: string;
  selectionKey: string;
  sectionId?: string;
  activeOccluderCategories?: string[];
}): SightlineMetrics {
  const sampleDensity = args.sampleDensity ?? 12;
  const key: CacheKey = [
    args.geometry.geometryVersionHash,
    args.eventConfigId,
    args.selectionKey,
    args.sectionId ?? "unknown-section",
    args.heightPreset,
    args.focus,
    args.crowdPercentile,
    sampleDensity,
    ...(args.activeOccluderCategories ?? []),
  ].join("|");

  const hit = cache.get(key);
  if (hit) return hit;

  const eye = args.eye.clone();
  eye.y += HEIGHT_PRESET_OFFSET_M[args.heightPreset];

  const mid = new THREE.Vector3(0, 0, 0);
  const halfL = args.geometry.field.lengthM / 2;
  const halfW = args.geometry.field.widthM / 2;
  const nearGoal = new THREE.Vector3(0, 0, eye.z < 0 ? -halfL : halfL);
  const farGoal = new THREE.Vector3(0, 0, eye.z < 0 ? halfL : -halfL);
  const nearestSideline = new THREE.Vector3(eye.x < 0 ? -halfW : halfW, 0, eye.z);

  const samples = buildFieldSamples(args.geometry, sampleDensity);
  const fieldHits: Array<{ x: number; z: number; visible: boolean; occluder?: string }> = [];
  let visible = 0;
  const activeCategories = new Set(
    args.activeOccluderCategories ?? [
      "rail",
      "fascia",
      "tunnel",
      "overhang",
      "video-board",
      "suite-tower",
      "column",
      "goalpost",
      "stage",
    ],
  );
  const occluders = [...args.geometry.occluders, ...eventOccluders(args.eventConfigId)];

  for (const [x, z] of samples) {
    const target = new THREE.Vector3(x, 0.05, z);
    const occlusions = segmentHitsOccluder(eye, target, occluders, activeCategories);
    // Crowd obstruction modeled as soft block when percentile high and target nearby ahead.
    const ahead = target.clone().sub(eye);
    const crowdBlocked =
      args.crowdPercentile >= 75 &&
      ahead.length() < 35 &&
      ahead.y < -0.5 &&
      Math.abs(ahead.x) < 4;
    const isVisible = occlusions.length === 0 && !crowdBlocked;
    if (isVisible) visible++;
    fieldHits.push({
      x,
      z,
      visible: isVisible,
      ...(occlusions[0]?.category ? { occluder: occlusions[0].category } : {}),
    });
  }

  const obstructions = new Set<string>();
  for (const t of [mid, nearGoal, farGoal, focusTargetPosition(args.focus, args.geometry)]) {
    for (const hit of segmentHitsOccluder(eye, t, occluders, activeCategories)) {
      obstructions.add(hit.category);
    }
  }
  if (args.crowdPercentile >= 75) obstructions.add("spectator-crowd");

  const toMid = mid.clone().sub(eye);
  const downwardAngle = (Math.atan2(-toMid.y, Math.hypot(toMid.x, toMid.z)) * 180) / Math.PI;

  const north = focusTargetPosition("north-board", args.geometry);
  const south = focusTargetPosition("south-board", args.geometry);
  const northAngle =
    (Math.atan2(north.y - eye.y, eye.distanceTo(new THREE.Vector3(north.x, eye.y, north.z))) *
      180) /
    Math.PI;
  const southAngle =
    (Math.atan2(south.y - eye.y, eye.distanceTo(new THREE.Vector3(south.x, eye.y, south.z))) *
      180) /
    Math.PI;

  // Modeled C-value approximation: rise over tread relative to next row ahead.
  const selectedSection = args.geometry.sections.find(
    (section) => section.sectionId === args.sectionId,
  );
  const cValue = selectedSection
    ? selectedSection.rowRiseM - 0.08
    : 0.12;

  const src = ["modeled-geometry", args.geometry.geometryVersionHash];

  const metrics: SightlineMetrics = {
    geometryVersionHash: args.geometry.geometryVersionHash,
    sampleCount: samples.length,
    visibleFieldPercent: provenanced(
      (visible / samples.length) * 100,
      "modeled",
      src,
      `${MODELED_DISCLAIMER} ${visible}/${samples.length} samples clear.`,
    ),
    distanceToMidfieldM: provenanced(eye.distanceTo(mid), "modeled", src, MODELED_DISCLAIMER),
    distanceToNearestSidelineM: provenanced(
      eye.distanceTo(nearestSideline),
      "modeled",
      src,
      MODELED_DISCLAIMER,
    ),
    distanceToNearGoalM: provenanced(eye.distanceTo(nearGoal), "modeled", src, MODELED_DISCLAIMER),
    distanceToFarGoalM: provenanced(eye.distanceTo(farGoal), "modeled", src, MODELED_DISCLAIMER),
    horizontalOffsetM: provenanced(Math.hypot(eye.x, 0), "modeled", src, MODELED_DISCLAIMER),
    downwardAngleToMidfieldDeg: provenanced(downwardAngle, "modeled", src, MODELED_DISCLAIMER),
    northBoardAngleDeg: provenanced(northAngle, "modeled", src, MODELED_DISCLAIMER),
    southBoardAngleDeg: provenanced(southAngle, "modeled", src, MODELED_DISCLAIMER),
    nearSidelineVisible: provenanced(
      segmentHitsOccluder(eye, nearestSideline, occluders, activeCategories).length === 0,
      "modeled",
      src,
      MODELED_DISCLAIMER,
    ),
    nearCornerVisible: provenanced(
      segmentHitsOccluder(
        eye,
        new THREE.Vector3(halfW, 0, halfL),
        occluders,
        activeCategories,
      ).length === 0,
      "modeled",
      src,
      MODELED_DISCLAIMER,
    ),
    obstructions: provenanced([...obstructions], "modeled", src, MODELED_DISCLAIMER),
    cValueClearanceM: provenanced(cValue, "modeled", src, MODELED_DISCLAIMER),
    aisleProximityM: provenanced(
      null,
      "unknown-do-not-infer",
      src,
      "Aisle proximity withheld until aisle geometry calibration is approved.",
    ),
    fieldHits,
  };

  cache.set(key, metrics);
  return metrics;
}

export function invalidateSightlineCache(geometryVersionHash?: string): void {
  if (!geometryVersionHash) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(geometryVersionHash)) cache.delete(key);
  }
}
