import * as THREE from 'three';

const FRAME_SAMPLE_LIMIT = 600;
const REPORT_REFRESH_MS = 500;
const GPU_SAMPLE_INTERVAL_FRAMES = 60;

type TimerQueryExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

export type PerformanceStage = {
  name: string;
  startedAtMs: number;
  durationMs: number | null;
  complete: boolean;
  detail: string | null;
};

export type RoomStreamState =
  | 'unrequested'
  | 'loading'
  | 'header-ready'
  | 'collider-ready'
  | 'root-ready'
  | 'resident'
  | 'owner'
  | 'failed';

export type PerformanceTelemetrySnapshot = {
  stages: PerformanceStage[];
  rooms: Array<{
    id: string;
    state: RoomStreamState;
    updatedAtMs: number;
    attempts: number;
    detail: string | null;
  }>;
  frame: {
    samples: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    longFrames: number;
  };
  work: Array<{
    name: string;
    samples: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  }>;
  gpu: {
    supported: boolean;
    lastMs: number | null;
    maxMs: number | null;
    samples: number;
  };
  longTasks: {
    count: number;
    totalMs: number;
    maxMs: number;
  };
  resources: {
    requests: number;
    transferBytes: number;
    decodedBytes: number;
    durationMs: number;
    mintRequests: number;
    worldRequests: number;
  };
  budgets: {
    p95FrameMs: number;
    releaseP95FrameMs: number;
    maximumLongFrameMs: number;
    targetVisibleSplats: number;
    p95FramePass: boolean;
    longFramePass: boolean;
  };
};

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.floor(ordered.length * ratio)),
  );
  return ordered[index] ?? 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(2));
}

export class PerformanceTelemetry {
  private readonly epochMs = performance.now();
  private readonly stages = new Map<
    string,
    {
      startedAtMs: number;
      durationMs: number | null;
      detail: string | null;
    }
  >();
  private readonly rooms = new Map<
    string,
    {
      state: RoomStreamState;
      updatedAtMs: number;
      attempts: number;
      detail: string | null;
    }
  >();
  private readonly frameSamples: number[] = [];
  private frameSampleCursor = 0;
  private readonly workSamples = new Map<
    string,
    { values: number[]; cursor: number }
  >();
  private longFrameCount = 0;
  private longTaskCount = 0;
  private longTaskTotalMs = 0;
  private longTaskMaxMs = 0;
  private resourceRequests = 0;
  private resourceTransferBytes = 0;
  private resourceDecodedBytes = 0;
  private resourceDurationMs = 0;
  private mintResourceRequests = 0;
  private worldResourceRequests = 0;
  private gpuSamples = 0;
  private gpuLastMs: number | null = null;
  private gpuMaxMs: number | null = null;
  private readonly gl: WebGL2RenderingContext;
  private readonly timerExtension: TimerQueryExtension | null;
  private pendingGpuQuery: WebGLQuery | null = null;
  private activeGpuQuery: WebGLQuery | null = null;
  private lastReportAtMs = 0;
  private cachedSnapshot: PerformanceTelemetrySnapshot | null = null;
  private readonly observers: PerformanceObserver[] = [];

  constructor(renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timerExtension = this.gl.getExtension(
      'EXT_disjoint_timer_query_webgl2',
    ) as TimerQueryExtension | null;
    this.observeLongTasks();
    this.observeResources();
    this.begin('app.session');
  }

  dispose(): void {
    for (const observer of this.observers) observer.disconnect();
    this.observers.length = 0;
    if (this.pendingGpuQuery) this.gl.deleteQuery(this.pendingGpuQuery);
    if (this.activeGpuQuery) this.gl.deleteQuery(this.activeGpuQuery);
    this.pendingGpuQuery = null;
    this.activeGpuQuery = null;
  }

  begin(name: string, detail: string | null = null): void {
    const existing = this.stages.get(name);
    if (existing && existing.durationMs === null) return;
    this.stages.set(name, {
      startedAtMs: performance.now() - this.epochMs,
      durationMs: null,
      detail,
    });
    this.invalidate();
  }

  end(name: string, detail: string | null = null): number | null {
    const stage = this.stages.get(name);
    if (!stage || stage.durationMs !== null) return stage?.durationMs ?? null;
    stage.durationMs = performance.now() - this.epochMs - stage.startedAtMs;
    if (detail !== null) stage.detail = detail;
    this.invalidate();
    return stage.durationMs;
  }

  instant(name: string, detail: string | null = null): void {
    this.stages.set(name, {
      startedAtMs: performance.now() - this.epochMs,
      durationMs: 0,
      detail,
    });
    this.invalidate();
  }

  setRoomState(
    id: string,
    state: RoomStreamState,
    detail: string | null = null,
  ): void {
    const existing = this.rooms.get(id);
    this.rooms.set(id, {
      state,
      updatedAtMs: performance.now() - this.epochMs,
      attempts:
        state === 'loading'
          ? (existing?.attempts ?? 0) + 1
          : (existing?.attempts ?? 0),
      detail,
    });
    this.invalidate();
  }

  recordFrame(deltaMs: number): void {
    const bounded = Math.min(250, Math.max(0, deltaMs));
    if (this.frameSamples.length < FRAME_SAMPLE_LIMIT) {
      this.frameSamples.push(bounded);
    } else {
      this.frameSamples[this.frameSampleCursor] = bounded;
      this.frameSampleCursor =
        (this.frameSampleCursor + 1) % FRAME_SAMPLE_LIMIT;
    }
    if (bounded > 50) this.longFrameCount += 1;
  }

  recordWork(name: string, durationMs: number): void {
    const bounded = Math.min(250, Math.max(0, durationMs));
    const state = this.workSamples.get(name) ?? {
      values: [],
      cursor: 0,
    };
    if (state.values.length < FRAME_SAMPLE_LIMIT) {
      state.values.push(bounded);
    } else {
      state.values[state.cursor] = bounded;
      state.cursor = (state.cursor + 1) % FRAME_SAMPLE_LIMIT;
    }
    this.workSamples.set(name, state);
  }

  beginGpuFrame(frame: number): boolean {
    this.pollGpuQuery();
    if (
      !this.timerExtension ||
      this.pendingGpuQuery ||
      this.activeGpuQuery ||
      frame % GPU_SAMPLE_INTERVAL_FRAMES !== 0
    ) {
      return false;
    }
    const query = this.gl.createQuery();
    if (!query) return false;
    try {
      this.gl.beginQuery(this.timerExtension.TIME_ELAPSED_EXT, query);
      this.activeGpuQuery = query;
      return true;
    } catch {
      this.gl.deleteQuery(query);
      return false;
    }
  }

  endGpuFrame(active: boolean): void {
    if (!active || !this.timerExtension || !this.activeGpuQuery) return;
    try {
      this.gl.endQuery(this.timerExtension.TIME_ELAPSED_EXT);
      this.pendingGpuQuery = this.activeGpuQuery;
    } finally {
      this.activeGpuQuery = null;
    }
  }

  snapshot(): PerformanceTelemetrySnapshot {
    const now = performance.now();
    if (
      this.cachedSnapshot &&
      now - this.lastReportAtMs < REPORT_REFRESH_MS
    ) {
      return this.cachedSnapshot;
    }
    const p50Ms = percentile(this.frameSamples, 0.5);
    const p95Ms = percentile(this.frameSamples, 0.95);
    const p99Ms = percentile(this.frameSamples, 0.99);
    const maxMs =
      this.frameSamples.length > 0 ? Math.max(...this.frameSamples) : 0;
    this.cachedSnapshot = {
      stages: Array.from(this.stages, ([name, stage]) => ({
        name,
        startedAtMs: rounded(stage.startedAtMs),
        durationMs:
          stage.durationMs === null ? null : rounded(stage.durationMs),
        complete: stage.durationMs !== null,
        detail: stage.detail,
      })).sort((left, right) => left.startedAtMs - right.startedAtMs),
      rooms: Array.from(this.rooms, ([id, room]) => ({
        id,
        state: room.state,
        updatedAtMs: rounded(room.updatedAtMs),
        attempts: room.attempts,
        detail: room.detail,
      })),
      frame: {
        samples: this.frameSamples.length,
        p50Ms: rounded(p50Ms),
        p95Ms: rounded(p95Ms),
        p99Ms: rounded(p99Ms),
        maxMs: rounded(maxMs),
        longFrames: this.longFrameCount,
      },
      work: Array.from(this.workSamples, ([name, state]) => ({
        name,
        samples: state.values.length,
        p50Ms: rounded(percentile(state.values, 0.5)),
        p95Ms: rounded(percentile(state.values, 0.95)),
        maxMs: rounded(
          state.values.length > 0 ? Math.max(...state.values) : 0,
        ),
      })).sort((left, right) => right.p95Ms - left.p95Ms),
      gpu: {
        supported: Boolean(this.timerExtension),
        lastMs: this.gpuLastMs === null ? null : rounded(this.gpuLastMs),
        maxMs: this.gpuMaxMs === null ? null : rounded(this.gpuMaxMs),
        samples: this.gpuSamples,
      },
      longTasks: {
        count: this.longTaskCount,
        totalMs: rounded(this.longTaskTotalMs),
        maxMs: rounded(this.longTaskMaxMs),
      },
      resources: {
        requests: this.resourceRequests,
        transferBytes: this.resourceTransferBytes,
        decodedBytes: this.resourceDecodedBytes,
        durationMs: rounded(this.resourceDurationMs),
        mintRequests: this.mintResourceRequests,
        worldRequests: this.worldResourceRequests,
      },
      budgets: {
        // Aspirational 60 FPS target; release gate remains 20 ms p95.
        p95FrameMs: 16.7,
        releaseP95FrameMs: 20,
        maximumLongFrameMs: 50,
        targetVisibleSplats: 2_500_000,
        p95FramePass: this.frameSamples.length < 120 || p95Ms <= 20,
        longFramePass: maxMs <= 50,
      },
    };
    this.lastReportAtMs = now;
    return this.cachedSnapshot!;
  }

  private pollGpuQuery(): void {
    if (!this.timerExtension || !this.pendingGpuQuery) return;
    const available = this.gl.getQueryParameter(
      this.pendingGpuQuery,
      this.gl.QUERY_RESULT_AVAILABLE,
    ) as boolean;
    const disjoint = this.gl.getParameter(
      this.timerExtension.GPU_DISJOINT_EXT,
    ) as boolean;
    if (!available) return;
    if (!disjoint) {
      const nanoseconds = this.gl.getQueryParameter(
        this.pendingGpuQuery,
        this.gl.QUERY_RESULT,
      ) as number;
      const milliseconds = nanoseconds / 1_000_000;
      this.gpuLastMs = milliseconds;
      this.gpuMaxMs = Math.max(this.gpuMaxMs ?? 0, milliseconds);
      this.gpuSamples += 1;
    }
    this.gl.deleteQuery(this.pendingGpuQuery);
    this.pendingGpuQuery = null;
    this.invalidate();
  }

  private observeLongTasks(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskCount += 1;
          this.longTaskTotalMs += entry.duration;
          this.longTaskMaxMs = Math.max(this.longTaskMaxMs, entry.duration);
        }
        this.invalidate();
      });
      observer.observe({ type: 'longtask', buffered: true });
      this.observers.push(observer);
    } catch {
      // Long Tasks are not exposed by every browser.
    }
  }

  private observeResources(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry instanceof PerformanceResourceTiming)) continue;
          this.resourceRequests += 1;
          this.resourceTransferBytes += entry.transferSize;
          this.resourceDecodedBytes += entry.decodedBodySize;
          this.resourceDurationMs += entry.duration;
          if (entry.name.includes('/assets/mint/')) {
            this.mintResourceRequests += 1;
          }
          if (
            entry.name.includes('.rad') ||
            entry.name.includes('world') ||
            entry.name.includes('collider')
          ) {
            this.worldResourceRequests += 1;
          }
        }
        this.invalidate();
      });
      observer.observe({ type: 'resource', buffered: true });
      this.observers.push(observer);
    } catch {
      // Resource timing can be disabled by privacy policies.
    }
  }

  private invalidate(): void {
    this.cachedSnapshot = null;
  }
}
