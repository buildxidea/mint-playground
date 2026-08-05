import {
  LiveSnapshotSchema,
  createStaticLiveState,
  type LiveVenueState,
} from "./contracts";

type Listener = (state: LiveVenueState) => void;

export class LiveVenueStore {
  private readonly options: {
    endpoint?: string | null;
    qaMode?: boolean;
    refreshMs?: number;
  };
  private state: LiveVenueState = { phase: "idle", snapshot: null, error: null };
  private readonly listeners = new Set<Listener>();
  private refreshTimer: number | null = null;
  private activeRequest: AbortController | null = null;

  constructor(options: {
    endpoint?: string | null;
    qaMode?: boolean;
    refreshMs?: number;
  } = {}) {
    this.options = options;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.options.qaMode || !this.options.endpoint) {
      this.setState(createStaticLiveState());
      return;
    }
    void this.refresh();
    this.refreshTimer = window.setInterval(() => {
      void this.refresh();
    }, this.options.refreshMs ?? 5 * 60_000);
  }

  async refresh(): Promise<void> {
    if (!this.options.endpoint) {
      this.setState(createStaticLiveState());
      return;
    }
    this.activeRequest?.abort();
    const request = new AbortController();
    this.activeRequest = request;
    this.setState({
      phase: this.state.snapshot ? "ready" : "loading",
      snapshot: this.state.snapshot,
      error: null,
    });
    try {
      const response = await fetch(this.options.endpoint, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: request.signal,
      });
      if (!response.ok) throw new Error(`Live data service returned ${response.status}`);
      const snapshot = LiveSnapshotSchema.parse(await response.json());
      this.setState({ phase: "ready", snapshot, error: null });
    } catch (error) {
      if (request.signal.aborted) return;
      this.setState({
        phase: this.state.snapshot ? "ready" : "error",
        snapshot: this.state.snapshot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  dispose(): void {
    this.activeRequest?.abort();
    if (this.refreshTimer != null) window.clearInterval(this.refreshTimer);
    this.listeners.clear();
  }

  private setState(state: LiveVenueState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
