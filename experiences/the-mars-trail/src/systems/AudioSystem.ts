/**
 * Audio for THE MARS TRAIL.
 *
 * Generated files (the drive hum bed and the hazard klaxon) play through Web
 * Audio buffers so the loop is gapless and the klaxon can overlap itself. Short
 * UI clicks stay procedural — generating a file for a 40 ms blip would be waste.
 *
 * Gameplay code emits semantic events here; it never touches the audio graph.
 */

export type AudioEvent = 'ui-click' | 'ui-confirm' | 'hazard' | 'death' | 'arrive';

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private humSource: AudioBufferSourceNode | null = null;
  private humGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private roarSource: AudioBufferSourceNode | null = null;
  private roarGain: GainNode | null = null;
  private pendingUrls = new Map<string, string>();
  private unlocked = false;
  private muted = false;

  constructor() {
    const unlock = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  /** Register generated audio URLs. Decoding is deferred until unlock. */
  registerUrls(urls: Map<string, string>): void {
    for (const [key, url] of urls) this.pendingUrls.set(key, url);
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    this.context = new AudioContextClass();
    await this.context.resume();
    this.master = this.context.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.context.destination);
    this.unlocked = true;

    await this.decodePending();
  }

  private async decodePending(): Promise<void> {
    if (!this.context) return;
    const entries = [...this.pendingUrls.entries()];
    this.pendingUrls.clear();

    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = await response.arrayBuffer();
          const buffer = await this.context!.decodeAudioData(bytes);
          this.buffers.set(key, buffer);
        } catch {
          // A missing sound must never break the game loop; stay silent instead.
        }
      }),
    );
  }

  /** Start the looping engine bed. Safe to call repeatedly. */
  startAmbience(): void {
    if (!this.context || !this.master || this.humSource) return;
    const buffer = this.buffers.get('audio-drive-hum');
    if (!buffer) return;

    this.humGain = this.context.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.master);

    this.humSource = this.context.createBufferSource();
    this.humSource.buffer = buffer;
    this.humSource.loop = true;
    this.humSource.connect(this.humGain);
    this.humSource.start();

    // Fade in so the bed does not slam on at the first click.
    this.humGain.gain.linearRampToValueAtTime(0.32, this.context.currentTime + 1.6);
  }

  /**
   * Start the launch engine roar.
   *
   * Separate from the travel ambience: this is the only place the game is loud,
   * and it has its own gain so the ascent can duck as the air thins without
   * touching the drive hum that plays for the rest of the crossing.
   */
  startLaunchRoar(): void {
    if (!this.context || !this.master || this.roarSource) return;

    // The ignition one-shot fires alongside the loop rather than before it, so
    // the roar is already at full power when the clamps release.
    const ignition = this.buffers.get('audio-launch-ignition');
    if (ignition) {
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      gain.gain.value = this.muted ? 0 : 0.75;
      source.buffer = ignition;
      source.connect(gain).connect(this.master);
      source.start();
    }

    const buffer = this.buffers.get('audio-launch-roar');
    if (!buffer) return;

    this.roarGain = this.context.createGain();
    this.roarGain.gain.value = 0;
    this.roarGain.connect(this.master);

    this.roarSource = this.context.createBufferSource();
    this.roarSource.buffer = buffer;
    this.roarSource.loop = true;
    this.roarSource.connect(this.roarGain);
    this.roarSource.start();
  }

  /**
   * @param throttle 0-1 engine power.
   * @param airDensity 0-1. Sound needs air to carry, so the roar thins out as
   *   the vehicle climbs and is almost gone by the time it is in vacuum.
   */
  setLaunchIntensity(throttle: number, airDensity: number): void {
    if (!this.context || !this.roarGain) return;
    const t = Math.max(0, Math.min(1, throttle));
    const air = Math.max(0, Math.min(1, airDensity));
    const target = this.muted ? 0 : (0.18 + t * 0.62) * (0.12 + air * 0.88);
    this.roarGain.gain.setTargetAtTime(target, this.context.currentTime, 0.25);
  }

  stopLaunchRoar(): void {
    if (!this.context || !this.roarSource) return;
    const source = this.roarSource;
    const gain = this.roarGain;
    this.roarSource = null;
    this.roarGain = null;
    // Ramp down rather than cutting, then stop once the ramp has run.
    gain?.gain.setTargetAtTime(0, this.context.currentTime, 0.3);
    setTimeout(() => {
      try {
        source.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    }, 1200);
  }

  /** Engine loudness tracks the burn rate. */
  setBurnIntensity(factor: number): void {
    if (!this.context || !this.humGain) return;
    const target = this.muted ? 0 : 0.2 + Math.max(0, Math.min(1, factor)) * 0.28;
    this.humGain.gain.setTargetAtTime(target, this.context.currentTime, 0.4);
  }

  play(event: AudioEvent): void {
    if (!this.context || !this.master || this.muted) return;

    if (event === 'hazard' || event === 'death') {
      const buffer = this.buffers.get('audio-klaxon');
      if (buffer) {
        const source = this.context.createBufferSource();
        const gain = this.context.createGain();
        gain.gain.value = event === 'death' ? 0.55 : 0.4;
        source.buffer = buffer;
        source.connect(gain).connect(this.master);
        source.start();
        return;
      }
    }

    this.blip(event);
  }

  /** Procedural UI tones. Cheap, and they posterise into the same aesthetic. */
  private blip(event: AudioEvent): void {
    if (!this.context || !this.master) return;

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    const shape: Record<AudioEvent, { type: OscillatorType; from: number; to: number; length: number; level: number }> =
      {
        'ui-click': { type: 'square', from: 420, to: 520, length: 0.06, level: 0.05 },
        'ui-confirm': { type: 'triangle', from: 380, to: 720, length: 0.14, level: 0.07 },
        hazard: { type: 'sawtooth', from: 260, to: 150, length: 0.3, level: 0.09 },
        death: { type: 'sine', from: 220, to: 70, length: 0.7, level: 0.1 },
        arrive: { type: 'triangle', from: 440, to: 880, length: 0.45, level: 0.09 },
      };

    const spec = shape[event];
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, spec.to), now + spec.length);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.level, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.length);

    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + spec.length + 0.02);
  }

  setMuted(muted: boolean): void {
    if (muted && this.roarGain && this.context) {
      this.roarGain.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
    }
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.context.currentTime, 0.1);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    this.stopLaunchRoar();
    this.humSource?.stop();
    this.humSource = null;
    this.humGain = null;
    void this.context?.close();
    this.context = null;
    this.buffers.clear();
  }
}
