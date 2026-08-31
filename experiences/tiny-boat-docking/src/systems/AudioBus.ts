import { AUDIO_REGISTRY, type AudioAssetId } from '../assets/registry';

export class AudioBus {
  private context: AudioContext | null = null;
  private unlocked = false;
  private muted = false;
  private readonly pendingRaw = new Map<AudioAssetId, ArrayBuffer>();
  private readonly buffers = new Map<AudioAssetId, AudioBuffer>();
  private engineSource: AudioBufferSourceNode | null = null;
  private waterSource: AudioBufferSourceNode | null = null;
  private engineGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private master: GainNode | null = null;

  constructor() {
    const unlock = () => {
      void this.unlock();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  /** Fetch audio bytes only — never blocks on AudioContext.resume(). */
  async loadAll(): Promise<void> {
    const entries = Object.values(AUDIO_REGISTRY);
    await Promise.all(
      entries.map(async (entry) => {
        const response = await fetch(entry.path);
        if (!response.ok) {
          throw new Error(`Missing audio asset: ${entry.path}`);
        }
        this.pendingRaw.set(entry.id, await response.arrayBuffer());
      }),
    );
  }

  async unlock(): Promise<void> {
    if (this.unlocked && this.context) {
      if (this.context.state === 'suspended') {
        await this.context.resume().catch(() => undefined);
      }
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.context.destination);
    // Do not await resume during boot — some hosts hang until a real gesture.
    void this.context.resume().catch(() => undefined);
    this.unlocked = true;
    await this.decodePending();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  }

  isMuted(): boolean {
    return this.muted;
  }

  updateLoops(throttle: number, speed: number): void {
    if (!this.context || !this.master) return;
    this.ensureLoop('boat_engine', (src, gain) => {
      this.engineSource = src;
      this.engineGain = gain;
    });
    this.ensureLoop('water_move', (src, gain) => {
      this.waterSource = src;
      this.waterGain = gain;
    });
    if (this.engineGain) {
      const target = 0.02 + Math.abs(throttle) * 0.12 + Math.min(speed, 6) * 0.015;
      this.engineGain.gain.value = THREE_LERP(this.engineGain.gain.value, target, 0.12);
    }
    if (this.waterGain) {
      const target = Math.min(0.16, speed * 0.03);
      this.waterGain.gain.value = THREE_LERP(this.waterGain.gain.value, target, 0.1);
    }
  }

  play(id: AudioAssetId, volume = 0.7): void {
    if (!this.context || !this.master || this.muted) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const src = this.context.createBufferSource();
    const gain = this.context.createGain();
    src.buffer = buffer;
    gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start();
  }

  dispose(): void {
    try {
      this.engineSource?.stop();
    } catch {
      // already stopped
    }
    try {
      this.waterSource?.stop();
    } catch {
      // already stopped
    }
    void this.context?.close();
    this.context = null;
  }

  private async decodePending(): Promise<void> {
    if (!this.context) return;
    for (const [id, raw] of this.pendingRaw) {
      if (this.buffers.has(id)) continue;
      try {
        const buffer = await this.context.decodeAudioData(raw.slice(0));
        this.buffers.set(id, buffer);
      } catch (error) {
        console.warn(`Failed to decode audio ${id}`, error);
      }
    }
  }

  private ensureLoop(
    id: 'boat_engine' | 'water_move',
    assign: (src: AudioBufferSourceNode, gain: GainNode) => void,
  ): void {
    if (!this.context || !this.master) return;
    const existing = id === 'boat_engine' ? this.engineSource : this.waterSource;
    if (existing) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const src = this.context.createBufferSource();
    const gain = this.context.createGain();
    src.buffer = buffer;
    src.loop = true;
    gain.gain.value = 0.001;
    src.connect(gain).connect(this.master);
    src.start();
    assign(src, gain);
  }
}

function THREE_LERP(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
