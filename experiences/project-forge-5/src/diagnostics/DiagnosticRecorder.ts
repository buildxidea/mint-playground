export type DiagnosticLevel = 'debug' | 'info' | 'warning' | 'error';

export type DiagnosticCategory =
  | 'application'
  | 'world-load'
  | 'world-alignment'
  | 'containment'
  | 'robot'
  | 'props'
  | 'physics'
  | 'camera'
  | 'input'
  | 'sandbox';

export type DiagnosticEvent = Readonly<{
  sequence: number;
  timestamp: string;
  elapsedMilliseconds: number;
  level: DiagnosticLevel;
  category: DiagnosticCategory;
  event: string;
  data: unknown;
}>;

export type DiagnosticReport<TSnapshot = unknown> = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  sessionStartedAt: string;
  events: readonly DiagnosticEvent[];
  snapshot: TSnapshot;
}>;

const DEFAULT_CAPACITY = 1_024;

function cloneSerializable<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Bounded, event-driven diagnostics. Hot paths use recordChanged so the report
 * contains every state transition without producing one console entry per
 * render frame.
 */
export class DiagnosticRecorder {
  private readonly startedAt = new Date();
  private readonly startedAtMilliseconds = performance.now();
  private readonly events: DiagnosticEvent[] = [];
  private readonly lastValues = new Map<string, string>();
  private sequence = 0;

  constructor(
    private readonly capacity = DEFAULT_CAPACITY,
    private readonly verboseConsole = false,
  ) {
    if (!Number.isInteger(capacity) || capacity < 32) {
      throw new Error('Diagnostic recorder capacity must be an integer of at least 32');
    }
  }

  record(
    level: DiagnosticLevel,
    category: DiagnosticCategory,
    event: string,
    data: unknown = null,
  ): DiagnosticEvent {
    const entry: DiagnosticEvent = Object.freeze({
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      elapsedMilliseconds: Math.max(0, performance.now() - this.startedAtMilliseconds),
      level,
      category,
      event,
      data: cloneSerializable(data),
    });
    this.events.push(entry);
    if (this.events.length > this.capacity)
      this.events.splice(0, this.events.length - this.capacity);

    const message = `[FORGE-5][${category}][${event}]`;
    if (level === 'error') console.error(message, entry.data);
    else if (level === 'warning') console.warn(message, entry.data);
    else if (this.verboseConsole) console.info(message, entry.data);
    return entry;
  }

  recordChanged(
    key: string,
    level: DiagnosticLevel,
    category: DiagnosticCategory,
    event: string,
    data: unknown,
  ): DiagnosticEvent | null {
    const serialized = JSON.stringify(data);
    if (this.lastValues.get(key) === serialized) return null;
    this.lastValues.set(key, serialized);
    return this.record(level, category, event, data);
  }

  snapshot(): readonly DiagnosticEvent[] {
    return this.events.map((entry) => cloneSerializable(entry));
  }

  report<TSnapshot>(snapshot: TSnapshot): DiagnosticReport<TSnapshot> {
    return Object.freeze({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sessionStartedAt: this.startedAt.toISOString(),
      events: this.snapshot(),
      snapshot: cloneSerializable(snapshot),
    });
  }
}
