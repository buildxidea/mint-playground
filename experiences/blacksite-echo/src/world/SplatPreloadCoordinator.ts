export type SplatPreloadStage =
  | 'queued'
  | 'warming'
  | 'ready'
  | 'timeout'
  | 'error';

export type SplatPreloadRecord = {
  key: string;
  ownerId: string;
  destinationId: string;
  priority: number;
  stage: SplatPreloadStage;
  requestedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  attempts: number;
  detail: string;
};

type SplatPreloadJob = {
  key: string;
  ownerId: string;
  destinationId: string;
  priority: number;
  run: (signal: AbortSignal) => Promise<boolean>;
  onSettled?: (ready: boolean, record: SplatPreloadRecord) => void;
};

/**
 * Serializes view-specific Spark paging work. Spark owns one shared LoD camera,
 * worker traversal, and display mapping, so overlapping warm promises can
 * overwrite the view that a previous promise is trying to prove.
 */
export class SplatPreloadCoordinator {
  private readonly records = new Map<string, SplatPreloadRecord>();
  private readonly queued = new Map<string, SplatPreloadJob>();
  private active: { job: SplatPreloadJob; abort: AbortController } | null = null;

  request(job: SplatPreloadJob): void {
    const previous = this.records.get(job.key);
    if (previous?.stage === 'ready') return;
    if (this.active?.job.key === job.key) return;
    const existing = this.queued.get(job.key);
    if (existing && existing.priority >= job.priority) return;
    this.queued.set(job.key, job);
    this.records.set(job.key, {
      key: job.key,
      ownerId: job.ownerId,
      destinationId: job.destinationId,
      priority: job.priority,
      stage: 'queued',
      requestedAt: performance.now(),
      startedAt: previous?.startedAt ?? null,
      completedAt: null,
      attempts: previous?.attempts ?? 0,
      detail: 'waiting for shared Spark view slot',
    });
    this.pump();
  }

  isReady(key: string): boolean {
    return this.records.get(key)?.stage === 'ready';
  }

  stage(key: string): SplatPreloadStage | 'idle' {
    return this.records.get(key)?.stage ?? 'idle';
  }

  invalidate(key: string, detail: string): void {
    const record = this.records.get(key);
    if (!record || record.stage !== 'ready') return;
    this.records.set(key, {
      ...record,
      stage: 'timeout',
      completedAt: performance.now(),
      detail,
    });
  }

  reset(): void {
    this.active?.abort.abort();
    this.active = null;
    this.queued.clear();
    this.records.clear();
  }

  diagnostics(): {
    activeKey: string | null;
    queuedKeys: string[];
    records: SplatPreloadRecord[];
  } {
    return {
      activeKey: this.active?.job.key ?? null,
      queuedKeys: [...this.queued.values()]
        .sort((a, b) => b.priority - a.priority)
        .map((job) => job.key),
      records: [...this.records.values()].map((record) => ({ ...record })),
    };
  }

  private pump(): void {
    if (this.active || this.queued.size === 0) return;
    const job = [...this.queued.values()].sort(
      (a, b) => b.priority - a.priority,
    )[0]!;
    this.queued.delete(job.key);
    const abort = new AbortController();
    this.active = { job, abort };
    const previous = this.records.get(job.key);
    const record: SplatPreloadRecord = {
      key: job.key,
      ownerId: job.ownerId,
      destinationId: job.destinationId,
      priority: job.priority,
      stage: 'warming',
      requestedAt: previous?.requestedAt ?? performance.now(),
      startedAt: performance.now(),
      completedAt: null,
      attempts: (previous?.attempts ?? 0) + 1,
      detail: 'warming from the live gameplay view',
    };
    this.records.set(job.key, record);
    void job
      .run(abort.signal)
      .then((ready) => {
        record.stage = ready ? 'ready' : 'timeout';
        record.detail = ready
          ? 'root, requested chunks, and destination mapping are stable'
          : 'live-view warm timed out';
        return ready;
      })
      .catch((error) => {
        record.stage = abort.signal.aborted ? 'timeout' : 'error';
        record.detail =
          error instanceof Error ? error.message : String(error);
        return false;
      })
      .then((ready) => {
        record.completedAt = performance.now();
        this.records.set(job.key, { ...record });
        job.onSettled?.(ready, { ...record });
      })
      .finally(() => {
        if (this.active?.job.key === job.key) this.active = null;
        this.pump();
      });
  }
}
