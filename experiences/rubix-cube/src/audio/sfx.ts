/**
 * Turn sound.
 *
 * The click fires when a layer commits, which is where a real cube clicks into
 * its detent. Playback is through Web Audio rather than an <audio> element so
 * that overlapping turns each get their own voice - solution playback can fire
 * one every 45ms, which a single element cannot retrigger fast enough.
 *
 * A generated sample is used when it loads; otherwise a synthesised click
 * stands in, so audio never simply goes missing.
 */

/** Minimum gap between clicks, so fast playback does not turn into a buzz. */
const MIN_INTERVAL_MS = 26;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private noise: AudioBuffer | null = null;
  private pendingUrl: string | null = null;
  private lastPlayedAt = -Infinity;

  private mutedValue = false;

  get muted(): boolean {
    return this.mutedValue;
  }

  setMuted(value: boolean): void {
    this.mutedValue = value;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value ? 0 : 1, this.ctx.currentTime, 0.01);
    }
  }

  /** Queue a sample; it is decoded once the context exists. */
  load(url: string): void {
    this.pendingUrl = url;
    if (this.ctx) void this.decodePending();
  }

  /**
   * Create or resume the context. Browsers refuse to start audio outside a
   * user gesture, so this must be called from a real click or keypress.
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return; // Audio is a nicety; never let it break the app.
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mutedValue ? 0 : 1;
      this.master.connect(this.ctx.destination);
      void this.decodePending();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private async decodePending(): Promise<void> {
    const url = this.pendingUrl;
    if (!url || !this.ctx || this.buffer) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      const bytes = await response.arrayBuffer();
      const raw = await this.ctx.decodeAudioData(bytes);
      this.buffer = condition(this.ctx, raw);
      if (!this.buffer) {
        console.warn("Turn sound is effectively silent; using a synthesised click.");
      }
    } catch (error) {
      // Fall through to the synthesised click.
      console.warn("Turn sound unavailable, using a synthesised click.", error);
    }
  }

  /** One layer-turn click. Silently does nothing if audio is unavailable. */
  playTurn(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.mutedValue) return;
    if (ctx.state !== "running") return;

    const now = performance.now();
    if (now - this.lastPlayedAt < MIN_INTERVAL_MS) return;
    this.lastPlayedAt = now;

    // A little pitch and level jitter so repeated turns are not identical.
    const detune = 0.94 + Math.random() * 0.12;
    const level = 0.82 + Math.random() * 0.18;

    if (this.buffer) this.playSample(ctx, detune, level);
    else this.playSynth(ctx, detune, level);
  }

  private playSample(ctx: AudioContext, rate: number, level: number): void {
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = rate;

    const gain = ctx.createGain();
    gain.gain.value = 0.5 * level;

    source.connect(gain).connect(this.master!);
    source.start();
  }

  /**
   * Synthesised speedcube turn.
   *
   * A cube turn is not one click. The layer scrapes across the neighbouring
   * pieces as a burst of tiny irregular impacts, then seats into its detent
   * with a firmer clack and a little hollow body. Modelling those three parts
   * separately - rather than firing a single blip - is what makes it read as
   * plastic rather than as a UI beep.
   */
  private playSynth(ctx: AudioContext, rate: number, level: number): void {
    const t0 = ctx.currentTime;
    const noise = this.noiseBuffer(ctx);

    // 1. The slide: a handful of irregular micro-impacts, brightest first.
    const grains = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < grains; i++) {
      const spread = (i / grains) * 0.030;
      const jitter = Math.random() * 0.006;
      const freq = (1500 + Math.random() * 2100) * rate;
      const decay = 0.010 + Math.random() * 0.008;
      const gain = (0.055 + Math.random() * 0.035) * level;
      this.grain(ctx, noise, t0 + spread + jitter, freq, 3.4, gain, decay);
    }

    // 2. The seat: lower and louder, the moment the layer locks.
    this.grain(ctx, noise, t0 + 0.034, 1050 * rate, 1.5, 0.30 * level, 0.045);

    // 3. A short hollow body under the seat, for plastic rather than paper.
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(280 * rate, t0 + 0.034);
    body.frequency.exponentialRampToValueAtTime(150 * rate, t0 + 0.085);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, t0 + 0.034);
    bodyGain.gain.exponentialRampToValueAtTime(0.10 * level, t0 + 0.038);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);

    body.connect(bodyGain).connect(this.master!);
    body.start(t0 + 0.034);
    body.stop(t0 + 0.095);
  }

  /** One short filtered noise impact. */
  private grain(
    ctx: AudioContext,
    noise: AudioBuffer,
    at: number,
    frequency: number,
    q: number,
    peak: number,
    decay: number,
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    // Start somewhere random in the noise so grains never repeat identically.
    const offset = Math.random() * (noise.duration - decay - 0.01);

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = frequency;
    band.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);

    source.connect(band).connect(gain).connect(this.master!);
    source.start(at, Math.max(0, offset), decay + 0.01);
  }

  /** One second of white noise, reused by every grain. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const frames = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }
}

/** Peak below this is treated as no usable signal at all. */
const SILENCE_FLOOR = 0.0015;

/** Envelope resolution used to find the hit, in seconds. */
const HOP_SECONDS = 0.0027;

/** Onset is where energy last sat below this fraction of the hit's peak. */
const ONSET_FLOOR = 0.10;

/** The hit is over once energy falls below this fraction of its peak. */
const RELEASE_FLOOR = 0.03;

/** Never keep more than this much of one hit. */
const MAX_SECONDS = 0.2;

/** Normalised peak of the conditioned hit. */
const TARGET_PEAK = 0.9;

/**
 * Extract one clean turn from a decoded clip, then normalise it.
 *
 * Generated audio does not arrive in the shape this app needs. The first
 * attempt came back near -39 dBFS, inaudible in place; the second came back
 * well recorded but containing five separate turns across 600ms, because a
 * cube-ASMR prompt naturally produces a few moves rather than one. Either way
 * the app needs exactly one hit per move, at a usable level.
 *
 * So rather than trusting the file, this finds the loudest moment, walks back
 * to where that hit actually begins and forward to where it dies away, and
 * keeps only that. It self-corrects for whatever a regeneration returns, which
 * matters because the level and content of a generation are not controllable.
 */
function condition(ctx: AudioContext, raw: AudioBuffer): AudioBuffer | null {
  const channels: Float32Array[] = [];
  for (let c = 0; c < raw.numberOfChannels; c++) {
    channels.push(raw.getChannelData(c));
  }

  const frames = raw.length;
  const mono = new Float32Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const data of channels) sum += data[i];
    const value = sum / channels.length;
    mono[i] = value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  if (peak < SILENCE_FLOOR) return null;

  // Short-time energy, so a single stray sample cannot look like a hit.
  const hop = Math.max(1, Math.floor(raw.sampleRate * HOP_SECONDS));
  const buckets = Math.floor(frames / hop);
  if (buckets < 4) return null;

  const energy = new Float32Array(buckets);
  let loudest = 0;
  let loudestAt = 0;
  for (let b = 0; b < buckets; b++) {
    let sum = 0;
    for (let i = b * hop; i < (b + 1) * hop; i++) sum += mono[i] * mono[i];
    const value = Math.sqrt(sum / hop);
    energy[b] = value;
    if (value > loudest) {
      loudest = value;
      loudestAt = b;
    }
  }
  if (loudest <= 0) return null;

  // Back to the start of this hit, not the start of the file.
  let onset = loudestAt;
  while (onset > 0 && energy[onset - 1] > loudest * ONSET_FLOOR) onset--;

  // Forward to where it has decayed away.
  let release = loudestAt;
  while (release < buckets - 1 && energy[release + 1] > loudest * RELEASE_FLOOR) {
    release++;
  }

  const startFrame = Math.max(0, onset * hop);
  const maxFrames = Math.floor(raw.sampleRate * MAX_SECONDS);
  const endFrame = Math.min(frames, startFrame + maxFrames, (release + 2) * hop);
  const length = endFrame - startFrame;
  if (length < 64) return null;

  // Normalise against the extracted slice, not the whole file.
  let slicePeak = 0;
  for (let i = startFrame; i < endFrame; i++) {
    const magnitude = Math.abs(mono[i]);
    if (magnitude > slicePeak) slicePeak = magnitude;
  }
  if (slicePeak < SILENCE_FLOOR) return null;

  const out = ctx.createBuffer(1, length, raw.sampleRate);
  const dest = out.getChannelData(0);
  const gain = TARGET_PEAK / slicePeak;

  // Tiny fades so neither cut becomes an audible edge of its own.
  const fadeIn = Math.min(Math.floor(raw.sampleRate * 0.0015), Math.floor(length / 8));
  const fadeOut = Math.min(Math.floor(raw.sampleRate * 0.010), Math.floor(length / 4));
  for (let i = 0; i < length; i++) {
    let envelope = 1;
    if (i < fadeIn) envelope = i / fadeIn;
    const remaining = length - i;
    if (remaining < fadeOut) envelope = Math.min(envelope, remaining / fadeOut);
    dest[i] = mono[startFrame + i] * gain * envelope;
  }

  return out;
}
