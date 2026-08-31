const MUTE_STORAGE_KEY = 'mowed.muted';

/** Everything the engine sound needs to know about the mower this step. */
export type EngineState = {
  /** False outside play, which idles the engine down to silence. */
  running: boolean;
  moving: boolean;
  boosting: boolean;
  stalled: boolean;
  /** 0 when nothing is being cut, 1 when the deck is full of tall grass. */
  cutting: number;
};

/**
 * A small petrol engine, synthesised.
 *
 * Three things carry the feel: the note bends with throttle so boosting is
 * obviously faster than cruising, the amplitude wobbles at engine speed to give
 * the putt-putt of a single cylinder, and a band of noise rides on top only
 * while grass is actually being cut.
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private wobble: OscillatorNode | null = null;
  private wobbleDepth: GainNode | null = null;
  private cutGain: GainNode | null = null;
  private cutFilter: BiquadFilterNode | null = null;
  private cutSource: AudioBufferSourceNode | null = null;

  private started = false;
  private muted = loadMutePreference();

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Builds the graph. Must be called from a user gesture, and is safe to call
   * again on later gestures to recover a context the browser suspended.
   */
  start(): void {
    if (this.started) {
      void this.context?.resume();
      return;
    }
    this.started = true;

    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      this.context = new AudioContextCtor();
    } catch {
      // No audio available; every update below degrades to a no-op.
      this.context = null;
      return;
    }

    const context = this.context;

    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(context.destination);

    // --- engine ------------------------------------------------------------
    this.engineFilter = context.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 700;
    this.engineFilter.Q.value = 2.6;

    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    this.engineOsc = context.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = ENGINE_BASE_HZ;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc.start();

    this.engineSub = context.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = ENGINE_BASE_HZ / 2;
    const subGain = context.createGain();
    subGain.gain.value = 0.32;
    this.engineSub.connect(subGain);
    subGain.connect(this.engineFilter);
    this.engineSub.start();

    // Amplitude wobble at engine speed: the putt-putt of one small cylinder.
    this.wobble = context.createOscillator();
    this.wobble.type = 'sine';
    this.wobble.frequency.value = 9;
    this.wobbleDepth = context.createGain();
    this.wobbleDepth.gain.value = 0;
    this.wobble.connect(this.wobbleDepth);
    this.wobbleDepth.connect(this.engineGain.gain);
    this.wobble.start();

    // --- blades cutting ----------------------------------------------------
    this.cutFilter = context.createBiquadFilter();
    this.cutFilter.type = 'bandpass';
    this.cutFilter.frequency.value = 2200;
    this.cutFilter.Q.value = 0.7;

    this.cutGain = context.createGain();
    this.cutGain.gain.value = 0;
    this.cutFilter.connect(this.cutGain);
    this.cutGain.connect(this.master);

    const noiseLength = Math.floor(context.sampleRate * 2);
    const buffer = context.createBuffer(1, noiseLength, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLength; i += 1) data[i] = Math.random() * 2 - 1;

    this.cutSource = context.createBufferSource();
    this.cutSource.buffer = buffer;
    this.cutSource.loop = true;
    this.cutSource.connect(this.cutFilter);
    this.cutSource.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    saveMutePreference(muted);
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.04);
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Drives the whole engine voice from one simulation step. */
  update(state: EngineState): void {
    if (!this.context || !this.engineGain || !this.engineOsc || !this.engineSub) return;

    const now = this.context.currentTime;
    const rpm = engineSpeed(state);

    // Throttle sets pitch, so boosting is audibly faster than cruising.
    this.engineOsc.frequency.setTargetAtTime(ENGINE_BASE_HZ * rpm, now, 0.08);
    this.engineSub.frequency.setTargetAtTime((ENGINE_BASE_HZ / 2) * rpm, now, 0.08);

    if (this.engineFilter) {
      this.engineFilter.frequency.setTargetAtTime(430 + 700 * rpm, now, 0.1);
    }

    const level = state.running ? 0.13 + 0.075 * rpm : 0;
    this.engineGain.gain.setTargetAtTime(level, now, 0.09);

    if (this.wobble && this.wobbleDepth) {
      // A labouring engine wobbles deeper and slower; a revving one smooths out.
      this.wobble.frequency.setTargetAtTime(6 + 11 * rpm, now, 0.12);
      const depth = state.running ? level * (state.stalled ? 0.55 : 0.22) : 0;
      this.wobbleDepth.gain.setTargetAtTime(depth, now, 0.1);
    }

    const cutting = state.running ? Math.max(0, Math.min(1, state.cutting)) : 0;
    if (this.cutGain) {
      this.cutGain.gain.setTargetAtTime(0.085 * cutting, now, 0.05);
    }
    if (this.cutFilter) {
      // Blades spin with the engine, so the cut hiss brightens under boost.
      this.cutFilter.frequency.setTargetAtTime(1500 + 1500 * rpm, now, 0.09);
    }
  }

  /** Short confirmation tone, used when a yard is graded. */
  blip(frequency: number, duration = 0.18): void {
    if (!this.context || !this.master || this.muted) return;

    const context = this.context;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(context.currentTime + duration + 0.02);
  }

  dispose(): void {
    this.engineOsc?.stop();
    this.engineSub?.stop();
    this.wobble?.stop();
    this.cutSource?.stop();
    void this.context?.close();
    this.context = null;
    this.started = false;
  }
}

const ENGINE_BASE_HZ = 64;

/**
 * Relative engine speed. Boost is the big jump so the two driving speeds are
 * easy to tell apart by ear; tall grass sags the note slightly, the way a real
 * mower bogs down before it catches up.
 */
function engineSpeed(state: EngineState): number {
  if (!state.running) return 0.7;
  if (state.stalled) return 0.55;

  let rpm = state.moving ? 1 : 0.74;
  if (state.moving && state.boosting) rpm += 0.45;
  rpm -= 0.07 * Math.max(0, Math.min(1, state.cutting));
  return rpm;
}

function loadMutePreference(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveMutePreference(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
  } catch {
    // Private browsing; the preference just will not survive a reload.
  }
}
