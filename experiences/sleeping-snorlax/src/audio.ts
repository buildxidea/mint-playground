import { artifactMirrorUrl, localArtifactUrl } from "./assets";

export interface AudioKit {
  /**
   * Browsers refuse to start audio without a user gesture, so call this from
   * one. Safe to call repeatedly; only the first call does anything.
   */
  unlock(): void;
  /** rate < 1 plays deeper and slower, for when Snorlax has grown. */
  playSnore(rate?: number): void;
  playPop(): void;
  playThud(rate?: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

type ClipName = "ambient" | "snore" | "pop" | "thud";

/** Registry key and artifact id for each clip. */
const CLIPS: Record<ClipName, { assetKey: string; artifactId: string; gain: number }> = {
  ambient: { assetKey: "ambience", artifactId: "audio_file", gain: 0.3 },
  snore: { assetKey: "snore", artifactId: "audio_file", gain: 0.42 },
  pop: { assetKey: "pop", artifactId: "audio_file", gain: 0.5 },
  // Loudest by a wide margin: he is enormous and this is the one impact in the
  // whole scene. Above 1 is fine — the master gain is the only thing after it.
  thud: { assetKey: "thud", artifactId: "audio_file", gain: 1.8 },
};

/** Tries the committed copy, then the CDN mirror for source-only hosts. */
async function fetchClip(assetKey: string, artifactId: string): Promise<ArrayBuffer> {
  const urls = [localArtifactUrl(assetKey, artifactId), artifactMirrorUrl(assetKey, artifactId)];
  let lastError: unknown = new Error(`No source for ${assetKey}`);
  for (const url of urls) {
    if (!url) continue;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      return await response.arrayBuffer();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Ambient bed plus one-shots, behind a single mute.
 *
 * Decoding starts immediately so clips are ready before the first click, but
 * the context stays suspended until `unlock` runs inside a gesture.
 */
export function createAudio(options: { muted: boolean }): AudioKit {
  const AudioCtx: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  let muted = options.muted;
  if (!AudioCtx) {
    // No Web Audio: silently do nothing rather than breaking the scene.
    return { unlock() {}, playSnore() {}, playPop() {}, playThud() {}, setMuted(v) { muted = v; }, get muted() { return muted; } };
  }

  const context = new AudioCtx();

  // A limiter on the way out, so the thud can be genuinely loud without the
  // sum hard-clipping against the destination when it lands over the ambience.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(context.destination);

  const master = context.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(limiter);

  const buffers = new Map<ClipName, AudioBuffer>();
  let unlocked = false;
  let ambientSource: AudioBufferSourceNode | null = null;

  const loading = (Object.keys(CLIPS) as ClipName[]).map(async (name) => {
    const clip = CLIPS[name];
    try {
      const data = await fetchClip(clip.assetKey, clip.artifactId);
      buffers.set(name, await context.decodeAudioData(data));
      if (name === "ambient" && unlocked) startAmbient();
    } catch (error) {
      // A missing sound should never take the scene down with it.
      console.warn(`Could not load the ${name} sound.`, error);
    }
  });
  void Promise.allSettled(loading);

  function startAmbient() {
    const buffer = buffers.get("ambient");
    if (!buffer || ambientSource) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    // Fade in, so it never snaps on mid-breath.
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(CLIPS.ambient.gain, context.currentTime + 3);
    source.connect(gain).connect(master);
    source.start();
    ambientSource = source;
  }

  function playOneShot(name: ClipName, rate = 1) {
    if (!unlocked || muted) return;
    const buffer = buffers.get(name);
    if (!buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = CLIPS[name].gain;
    source.connect(gain).connect(master);
    source.start();
  }

  return {
    unlock() {
      if (unlocked) return;
      unlocked = true;
      void context.resume();
      startAmbient();
    },
    playSnore(rate = 1) {
      playOneShot("snore", rate);
    },
    playPop() {
      playOneShot("pop");
    },
    playThud(rate = 1) {
      playOneShot("thud", rate);
    },
    setMuted(value) {
      muted = value;
      // Ramp rather than jump, so muting does not click.
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(master.gain.value, context.currentTime);
      master.gain.linearRampToValueAtTime(value ? 0 : 1, context.currentTime + 0.25);
    },
    get muted() {
      return muted;
    },
  };
}
