import type { GamePhase } from '../game/types';
import { getMintArtifactUrlByRole } from '../assets/MintAssetLibrary';

type MintAudioKey =
  | 'audio-engine'
  | 'audio-scrape'
  | 'audio-water'
  | 'audio-turn'
  | 'audio-collision'
  | 'audio-ambience'
  | 'audio-completion';

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineHarmonic: OscillatorNode | null = null;
  private scrapeGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private readonly mintBuffers = new Map<MintAudioKey, AudioBuffer>();
  private readonly mintLoopGains = new Map<MintAudioKey, GainNode>();
  private readonly mintLoopSources = new Map<MintAudioKey, AudioBufferSourceNode>();
  private mintAudioLoading = false;
  private unlocked = false;
  private muted = false;
  private lastTurnChirp = 0;
  private engineActive = false;
  private resurfacingActive = false;

  constructor() {
    window.addEventListener('pointerdown', this.unlockOnGesture, { once: true });
    window.addEventListener('keydown', this.unlockOnGesture, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.unlocked) {
      await this.context?.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.72;
    this.master.connect(context.destination);

    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0.0001;
    this.engineGain.connect(this.master);
    this.engineOscillator = context.createOscillator();
    this.engineOscillator.type = 'sawtooth';
    this.engineOscillator.frequency.value = 54;
    this.engineOscillator.connect(this.engineGain);
    this.engineOscillator.start();
    this.engineHarmonic = context.createOscillator();
    this.engineHarmonic.type = 'triangle';
    this.engineHarmonic.frequency.value = 108;
    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.32;
    this.engineHarmonic.connect(harmonicGain).connect(this.engineGain);
    this.engineHarmonic.start();

    this.scrapeGain = this.createLoopingNoise(context, 0.0001, 1500, 0.8);
    this.waterGain = this.createLoopingNoise(context, 0.0001, 4200, 2.2);
    this.ambienceGain = this.createLoopingNoise(context, 0.018, 680, 0.42);
    this.unlocked = true;
    await context.resume();
    void this.loadMintAudio(context);
  }

  update(speed: number, steering: number, resurfacing: boolean, phase: GamePhase): void {
    const context = this.context;
    if (!context || !this.engineGain || !this.engineOscillator || !this.engineHarmonic) return;
    const now = context.currentTime;
    const playing = phase === 'playing';
    this.engineActive = playing;
    this.resurfacingActive = playing && resurfacing;
    const speedRatio = Math.min(1, Math.abs(speed) / 6.9);
    const engineLevel = playing ? 0.035 + speedRatio * 0.055 : 0.0001;
    const mintEngine = this.mintLoopGains.get('audio-engine');
    this.engineGain.gain.setTargetAtTime(mintEngine ? 0.0001 : engineLevel, now, 0.06);
    this.engineOscillator.frequency.setTargetAtTime(50 + speedRatio * 58, now, 0.05);
    this.engineHarmonic.frequency.setTargetAtTime(100 + speedRatio * 116, now, 0.05);
    this.mintLoopSources.get('audio-engine')?.playbackRate.setTargetAtTime(0.88 + speedRatio * 0.24, now, 0.08);
    mintEngine?.gain.setTargetAtTime(playing ? 0.12 + speedRatio * 0.12 : 0.0001, now, 0.08);
    const mintScrape = this.mintLoopGains.get('audio-scrape');
    const mintWater = this.mintLoopGains.get('audio-water');
    const mintAmbience = this.mintLoopGains.get('audio-ambience');
    this.scrapeGain?.gain.setTargetAtTime(mintScrape ? 0.0001 : playing && resurfacing ? 0.052 + speedRatio * 0.035 : 0.0001, now, 0.04);
    this.waterGain?.gain.setTargetAtTime(mintWater ? 0.0001 : playing && resurfacing ? 0.036 : 0.0001, now, 0.08);
    this.ambienceGain?.gain.setTargetAtTime(mintAmbience ? 0.0001 : phase === 'paused' ? 0.0001 : 0.018, now, 0.2);
    mintScrape?.gain.setTargetAtTime(playing && resurfacing ? 0.25 + speedRatio * 0.08 : 0.0001, now, 0.05);
    mintWater?.gain.setTargetAtTime(playing && resurfacing ? 0.18 : 0.0001, now, 0.09);
    mintAmbience?.gain.setTargetAtTime(phase === 'paused' ? 0.0001 : 0.16, now, 0.2);

    if (playing && Math.abs(steering) > 0.72 && speedRatio > 0.35 && now - this.lastTurnChirp > 0.75) {
      this.lastTurnChirp = now;
      if (!this.playMintOneShot('audio-turn', 0.32)) this.playTone(155, 0.045, 0.035, 'triangle', -35);
    }
  }

  collision(): void {
    if (this.playMintOneShot('audio-collision', 0.52)) return;
    this.playNoiseBurst(0.14, 0.12, 240);
    this.playTone(92, 0.16, 0.08, 'square', -34);
  }

  toggle(active: boolean): void {
    this.playTone(active ? 520 : 320, 0.09, 0.055, 'triangle', active ? 90 : -60);
  }

  complete(stars: number): void {
    if (this.playMintOneShot('audio-completion', stars === 3 ? 0.58 : 0.42)) return;
    const notes = stars === 3 ? [392, 494, 659, 784] : stars === 2 ? [392, 494, 659] : [392, 523];
    notes.forEach((frequency, index) => window.setTimeout(() => this.playTone(frequency, 0.28, 0.075, 'sine', 35), index * 105));
  }

  fail(): void {
    this.playTone(180, 0.4, 0.07, 'sawtooth', -110);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.04);
  }

  isMuted(): boolean {
    return this.muted;
  }

  getDebugState(): { unlocked: boolean; contextState: string; muted: boolean; engineActive: boolean; resurfacingActive: boolean } {
    return {
      unlocked: this.unlocked,
      contextState: this.context?.state ?? 'unavailable',
      muted: this.muted,
      engineActive: this.engineActive,
      resurfacingActive: this.resurfacingActive,
    };
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlockOnGesture);
    window.removeEventListener('keydown', this.unlockOnGesture);
    this.engineOscillator?.stop();
    this.engineHarmonic?.stop();
    for (const source of this.mintLoopSources.values()) source.stop();
    this.mintLoopSources.clear();
    this.mintLoopGains.clear();
    this.mintBuffers.clear();
    void this.context?.close();
    this.context = null;
  }

  private readonly unlockOnGesture = (): void => {
    void this.unlock();
  };

  private async loadMintAudio(context: AudioContext): Promise<void> {
    if (this.mintAudioLoading || this.mintBuffers.size > 0) return;
    this.mintAudioLoading = true;
    const keys: MintAudioKey[] = [
      'audio-engine',
      'audio-scrape',
      'audio-water',
      'audio-turn',
      'audio-collision',
      'audio-ambience',
      'audio-completion',
    ];
    const results = await Promise.allSettled(
      keys.map(async (key) => {
        const response = await fetch(getMintArtifactUrlByRole(key, 'audio'));
        if (!response.ok) throw new Error(`Audio asset ${key} returned ${response.status}.`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        return { key, buffer };
      }),
    );
    if (this.context !== context || !this.master) return;
    for (const result of results) {
      if (result.status === 'fulfilled') this.mintBuffers.set(result.value.key, result.value.buffer);
      else console.warn('A Mint audio asset could not be decoded.', result.reason);
    }
    for (const key of ['audio-engine', 'audio-scrape', 'audio-water', 'audio-ambience'] as MintAudioKey[]) {
      const buffer = this.mintBuffers.get(key);
      if (!buffer) continue;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0.0001;
      source.connect(gain).connect(this.master);
      source.start();
      this.mintLoopSources.set(key, source);
      this.mintLoopGains.set(key, gain);
    }
  }

  private playMintOneShot(key: MintAudioKey, level: number): boolean {
    const context = this.context;
    const buffer = this.mintBuffers.get(key);
    if (!context || context.state !== 'running' || !this.master || !buffer) return false;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = level;
    source.connect(gain).connect(this.master);
    source.start();
    return true;
  }

  private createLoopingNoise(context: AudioContext, level: number, cutoff: number, playbackRate: number): GainNode {
    const frames = context.sampleRate * 2;
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x1ce5eed;
    for (let index = 0; index < frames; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[index] = (seed / 4294967296) * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = playbackRate;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(filter).connect(gain).connect(this.master as GainNode);
    source.start();
    return gain;
  }

  private playTone(frequency: number, duration: number, level: number, type: OscillatorType, bend = 0): void {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.linearRampToValueAtTime(Math.max(30, frequency + bend), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private playNoiseBurst(duration: number, level: number, cutoff: number): void {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.master) return;
    const frames = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0xc0111de;
    for (let index = 0; index < frames; index += 1) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[index] = ((seed / 4294967296) * 2 - 1) * (1 - index / frames);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }
}
