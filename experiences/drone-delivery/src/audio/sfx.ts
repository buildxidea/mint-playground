import { getAudioUrl, hasAsset } from '../assets/registry';

export type SfxName = 'attach' | 'wind' | 'warning' | 'collision' | 'delivery' | 'score';

const SFX_KEYS: Record<SfxName, string> = {
  attach: 'sfx-attach',
  wind: 'sfx-wind',
  warning: 'sfx-warning',
  collision: 'sfx-collision',
  delivery: 'sfx-delivery',
  score: 'sfx-score',
};

/**
 * Web Audio playback for the Mint-generated sounds: an RPM-driven rotor hum
 * loop plus one-shot effects. Decodes lazily after the first user gesture
 * unlocks the context. Any sound missing from the registry falls back to a
 * small synthesized cue so the game still gives feedback.
 */
export class Sfx {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private rotorSource: AudioBufferSourceNode | OscillatorNode | null = null;
  private rotorGain: GainNode | null = null;
  private rotorIsBuffer = false;
  private lastWarning = 0;

  constructor() {
    const unlock = () => {
      void this.unlock();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.context) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    await this.context.resume();
    this.master = this.context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.context.destination);

    const jobs: Promise<void>[] = [this.loadBuffer('rotor-hum')];
    for (const key of Object.values(SFX_KEYS)) jobs.push(this.loadBuffer(key));
    await Promise.allSettled(jobs);
  }

  /** Drive the rotor loop: intensity 0 (idle) to 1 (full throttle climb). */
  setRotor(running: boolean, intensity: number): void {
    if (!this.context || !this.master) return;
    if (!running) {
      if (this.rotorSource) {
        this.rotorGain?.gain.setTargetAtTime(0, this.context.currentTime, 0.12);
        const source = this.rotorSource;
        this.rotorSource = null;
        setTimeout(() => {
          try {
            source.stop();
          } catch {
            // Already stopped.
          }
        }, 400);
      }
      return;
    }

    if (!this.rotorSource) {
      this.rotorGain = this.context.createGain();
      this.rotorGain.gain.value = 0;
      this.rotorGain.connect(this.master);
      const buffer = this.buffers.get('rotor-hum');
      if (buffer) {
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(this.rotorGain);
        source.start();
        this.rotorSource = source;
        this.rotorIsBuffer = true;
      } else {
        // Fallback hum while the Mint loop is unavailable.
        const osc = this.context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 90;
        osc.connect(this.rotorGain);
        osc.start();
        this.rotorSource = osc;
        this.rotorIsBuffer = false;
      }
    }

    const now = this.context.currentTime;
    this.rotorGain?.gain.setTargetAtTime(0.12 + intensity * 0.2, now, 0.08);
    if (this.rotorIsBuffer) {
      (this.rotorSource as AudioBufferSourceNode).playbackRate.setTargetAtTime(
        0.85 + intensity * 0.45,
        now,
        0.1,
      );
    } else {
      (this.rotorSource as OscillatorNode).frequency.setTargetAtTime(80 + intensity * 70, now, 0.1);
    }
  }

  play(name: SfxName, volume = 0.8): void {
    if (!this.context || !this.master) return;
    if (name === 'warning') {
      // Rate-limit the low battery beep.
      const now = performance.now();
      if (now - this.lastWarning < 1800) return;
      this.lastWarning = now;
    }
    const buffer = this.buffers.get(SFX_KEYS[name]);
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      const gain = this.context.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(this.master);
      source.start();
      return;
    }
    this.fallbackBeep(name);
  }

  dispose(): void {
    this.setRotor(false, 0);
    void this.context?.close();
    this.context = null;
  }

  private async loadBuffer(key: string): Promise<void> {
    if (!this.context || !hasAsset(key)) return;
    const url = getAudioUrl(key);
    if (!url) return;
    try {
      const response = await fetch(url);
      const data = await response.arrayBuffer();
      const buffer = await this.context.decodeAudioData(data);
      this.buffers.set(key, buffer);
    } catch (error) {
      console.warn(`Failed to load audio "${key}"`, error);
    }
  }

  private fallbackBeep(name: SfxName): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const tones: Record<SfxName, [number, number]> = {
      attach: [420, 640],
      wind: [180, 120],
      warning: [880, 880],
      collision: [140, 70],
      delivery: [520, 780],
      score: [660, 990],
    };
    const [from, to] = tones[name];
    osc.type = name === 'collision' ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.26);
  }
}
