/// <reference lib="webworker" />

import * as THREE from "three";
import { computeSightlineMetrics } from "./sightlineEngine";
import type { ModeledGeometryManifest } from "./schema";
import type { FocusTarget, HeightPreset } from "./sightlineEngine";

type RequestMessage = {
  id: number;
  args: {
    geometry: ModeledGeometryManifest;
    eye: [number, number, number];
    focus: FocusTarget;
    heightPreset: HeightPreset;
    crowdPercentile: number;
    sampleDensity: number;
    eventConfigId: string;
    selectionKey: string;
    activeOccluderCategories: string[];
  };
};

self.addEventListener("message", (event: MessageEvent<RequestMessage>) => {
  const { id, args } = event.data;
  try {
    const metrics = computeSightlineMetrics({
      ...args,
      eye: new THREE.Vector3(...args.eye),
    });
    self.postMessage({ id, metrics });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
