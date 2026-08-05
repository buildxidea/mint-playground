import type * as THREE from "three";
import type { ModeledGeometryManifest } from "./schema";
import type { FocusTarget, HeightPreset, SightlineMetrics } from "./sightlineEngine";

export type SightlineWorkerArgs = {
  geometry: ModeledGeometryManifest;
  eye: THREE.Vector3;
  focus: FocusTarget;
  heightPreset: HeightPreset;
  crowdPercentile: number;
  sampleDensity: number;
  eventConfigId: string;
  selectionKey: string;
  activeOccluderCategories: string[];
};

export class SightlineClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: SightlineMetrics) => void; reject: (reason: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("./sightline.worker.ts", import.meta.url), {
      type: "module",
      name: "fieldline-sightline-analysis",
    });
    this.worker.addEventListener("message", (event: MessageEvent<{
      id: number;
      metrics?: SightlineMetrics;
      error?: string;
    }>) => {
      const job = this.pending.get(event.data.id);
      if (!job) return;
      this.pending.delete(event.data.id);
      if (event.data.metrics) job.resolve(event.data.metrics);
      else job.reject(new Error(event.data.error ?? "Sightline worker failed"));
    });
  }

  compute(args: SightlineWorkerArgs): Promise<SightlineMetrics> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({
        id,
        args: {
          ...args,
          eye: args.eye.toArray(),
        },
      });
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Sightline worker disposed"));
    }
    this.pending.clear();
  }
}
