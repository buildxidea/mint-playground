import { mintModelUrl } from '../assets/ModelLibrary';

/** One-shot cues. */
export type SfxKey =
  | 'gate-clear'
  | 'gate-miss'
  | 'impact'
  | 'moored'
  | 'fail'
  | 'whale'
  | 'boost';

/** Continuous beds. */
type LoopKey = 'engine' | 'water' | 'ambience';

const REGISTRY: Record<SfxKey | LoopKey, string> = {
  engine: 'sfx-engine',
  water: 'sfx-water',
  ambience: 'sfx-ambience',
  'gate-clear': 'sfx-gate-clear',
  'gate-miss': 'sfx-gate-miss',
  impact: 'sfx-impact',
  moored: 'sfx-moored',
  fail: 'sfx-fail',
  whale: 'sfx-whale',
  boost: 'sfx-boost',
};

/** Relative levels, so one loud generation cannot drown the mix. */
const LEVELS: Record<SfxKey | LoopKey, number> = {
  engine: 0.32,
  water: 0.3,
  ambience: 0.34,
  'gate-clear': 0.6,
  'gate-miss': 0.55,
  impact: 0.75,
  moored: 0.7,
  fail: 0.8,
  whale: 0.5,
  boost: 0.45,
};

interface Loop {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Web Audio mixer for the game.
 *
 * Browsers refuse to start audio without a user gesture, so the context is
 * created suspended and resumed on the first click or keypress. Everything is
 * best-effort: a missing or undecodable sound is skipped rather than thrown,
 * because silence is a much better failure than a broken game.
 */
export class AudioSystem {
  private readonly context: AudioContext | null;
  private readonly master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<LoopKey, Loop>();
  private volume = 0.8;
  private muted = false;
  private started = false;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.context = null;
      return;
    }
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Fetch and decode every registered sound. Safe to call more than once. */
  load(): Promise<void> {
    if (!this.context) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = Promise.all(
      Object.entries(REGISTRY).map(async ([, key]) => {
        const url = mintModelUrl(key);
        if (!url) return;
        try {
          const response = await fetch(url);
          if (!response.ok) return;
          const bytes = await response.arrayBuffer();
          const buffer = await this.context!.decodeAudioData(bytes);
          this.buffers.set(key, buffer);
        } catch {
          // A sound that will not decode simply stays silent.
        }
      }),
    ).then(() => undefined);

    return this.loadPromise;
  }

  /** Must be called from a real user gesture or the context stays suspended. */
  resume(): void {
    if (!this.context) return;
    if (this.context.state === 'suspended') void this.context.resume();
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    this.applyMasterGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Start the continuous beds. Idempotent. */
  startAmbient(): void {
    if (!this.context || this.started) return;
    this.started = true;
    this.startLoop('ambience', 1);
    this.startLoop('engine', 0);
    this.startLoop('water', 0);
  }

  /**
   * Drive the engine and wake layers from the boat.
   * `throttle` is 0..1 of applied thrust, `speedFraction` 0..1 of top speed.
   */
  setEngine(throttle: number, speedFraction: number): void {
    const engine = this.loops.get('engine');
    const water = this.loops.get('water');
    if (!this.context) return;

    const now = this.context.currentTime;
    if (engine) {
      // Idle hum even at rest, louder under power.
      const level = LEVELS.engine * (0.35 + throttle * 0.65);
      engine.gain.gain.setTargetAtTime(level, now, 0.12);
      engine.source.playbackRate.setTargetAtTime(0.8 + speedFraction * 0.7, now, 0.2);
    }
    if (water) {
      const level = LEVELS.water * Math.min(1, speedFraction * 1.4);
      water.gain.gain.setTargetAtTime(level, now, 0.15);
      water.source.playbackRate.setTargetAtTime(0.9 + speedFraction * 0.4, now, 0.25);
    }
  }

  /** Fire a one-shot cue. */
  play(key: SfxKey, volumeScale = 1): void {
    if (!this.context || !this.master) return;
    const buffer = this.buffers.get(REGISTRY[key]);
    if (!buffer) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = LEVELS[key] * volumeScale;
    source.connect(gain).connect(this.master);
    source.start();
  }

  /** Mixer state, for QA. */
  debugState(): {
    supported: boolean;
    contextState: string;
    buffersLoaded: number;
    loopsRunning: number;
    masterGain: number;
    muted: boolean;
  } {
    return {
      supported: Boolean(this.context),
      contextState: this.context?.state ?? 'none',
      buffersLoaded: this.buffers.size,
      loopsRunning: this.loops.size,
      masterGain: this.master?.gain.value ?? 0,
      muted: this.muted,
    };
  }

  dispose(): void {
    for (const loop of this.loops.values()) {
      try {
        loop.source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.loops.clear();
    void this.context?.close();
  }

  private startLoop(key: LoopKey, initialLevel: number): void {
    if (!this.context || !this.master) return;
    const buffer = this.buffers.get(REGISTRY[key]);
    if (!buffer) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    gain.gain.value = LEVELS[key] * initialLevel;
    source.connect(gain).connect(this.master);
    source.start();
    this.loops.set(key, { source, gain });
  }

  private applyMasterGain(): void {
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : this.volume,
      this.context.currentTime,
      0.05,
    );
  }
}
