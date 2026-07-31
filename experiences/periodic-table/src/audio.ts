import { AUDIO_FILES } from './audio-manifest';

type SfxName = keyof typeof AUDIO_FILES;

/**
 * Where the audible event starts, so leading silence can be skipped. Measured
 * on a short-window RMS envelope: individual noise-floor samples in a quiet
 * clip can exceed a sample-level threshold, but the windowed energy does not.
 */
function onsetFor(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.round(buffer.sampleRate * 0.005));
  const env: number[] = [];
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0;
    for (let k = 0; k < win; k++) sum += data[i + k] * data[i + k];
    env.push(Math.sqrt(sum / win));
  }
  if (!env.length) return 0;
  const threshold = Math.max(...env) * 0.35;
  const idx = env.findIndex((v) => v >= threshold);
  if (idx <= 0) return 0;
  const seconds = (idx * win) / buffer.sampleRate - 0.01;
  return Math.min(Math.max(seconds, 0), 0.15);
}

/** Peak-normalize a clip so quiet source files still play at a usable level. */
function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    // stride-sample long clips; peaks in generated audio are not needle-thin
    const step = data.length > 200000 ? 4 : 1;
    for (let i = 0; i < data.length; i += step) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

function normalizationFor(peak: number): number {
  if (peak <= 0.0001) return 1;
  return Math.min(Math.max(TARGET_PEAK / peak, MIN_NORM), MAX_NORM);
}

/**
 * WebAudio SFX manager. Fails soft: missing files or a locked AudioContext
 * never block the app — sounds simply stay silent.
 */
/** Peak every clip is normalized toward, so source loudness doesn't matter. */
const TARGET_PEAK = 0.85;
const MIN_NORM = 0.25;
const MAX_NORM = 24;

interface Clip {
  buffer: AudioBuffer;
  /** multiplier that brings this clip to TARGET_PEAK */
  norm: number;
  /** seconds of leading silence, skipped so one-shots respond immediately */
  onset: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SfxName, Clip>();
  private master: GainNode | null = null;
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private muted = false;
  private started = false;

  constructor() {
    const unlock = () => {
      this.start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      void this.preload();
    } catch {
      this.ctx = null;
    }
  }

  private async preload(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(
      (Object.keys(AUDIO_FILES) as SfxName[]).map(async (name) => {
        const url = AUDIO_FILES[name];
        if (!url) return;
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const data = await res.arrayBuffer();
          const buffer = await this.ctx!.decodeAudioData(data);
          this.buffers.set(name, {
            buffer,
            norm: normalizationFor(peakOf(buffer)),
            onset: onsetFor(buffer),
          });
        } catch {
          /* sound unavailable; stay silent */
        }
      })
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * `softenHz` low-passes the clip; `decaySec` fades it out over that long and
   * stops it, which turns a ringing sample into a short blunt blip.
   */
  play(name: SfxName, volume = 0.5, rate = 1, softenHz = 0, decaySec = 0): void {
    if (!this.ctx || !this.master || this.muted) return;
    const clip = this.buffers.get(name);
    if (!clip) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    const level = volume * clip.norm;
    gain.gain.value = level;

    if (softenHz > 0) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = softenHz;
      lp.Q.value = 0.7;
      src.connect(lp).connect(gain).connect(this.master);
    } else {
      src.connect(gain).connect(this.master);
    }

    if (decaySec > 0) {
      gain.gain.setValueAtTime(level, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decaySec);
      src.start(now, clip.onset);
      src.stop(now + decaySec + 0.02);
    } else {
      src.start(now, clip.onset);
    }
  }

  startAmbience(volume = 0.22): void {
    if (!this.ctx || !this.master || this.ambience) return;
    const clip = this.buffers.get('ambience');
    if (!clip) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    // ambience loops the whole buffer: no onset trim, or the seam would click
    const src = this.ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(volume * clip.norm, this.ctx.currentTime, 0.8);
    src.connect(gain).connect(this.master);
    src.start();
    this.ambience = { src, gain };
  }

  stopAmbience(): void {
    if (!this.ctx || !this.ambience) return;
    const { src, gain } = this.ambience;
    this.ambience = null;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.35);
    setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }, 1500);
  }
}
