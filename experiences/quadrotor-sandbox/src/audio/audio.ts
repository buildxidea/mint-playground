import { VEHICLE } from "../sim/config";
import type { DroneState } from "../sim/state";
import { getArtifactUrl, getAsset, hasAsset } from "../assets/registry";

/**
 * Rotor audio.
 *
 * One looping sample driven by the *actual* rotor speed: playback rate follows
 * mean motor RPM and gain follows thrust, so spooling up, hovering, and
 * chopping the throttle all sound different without any additional samples.
 * Because it reads the same `motorOmega` the physics integrates, the sound is
 * a readout of the flight model rather than a canned effect played alongside it.
 *
 * Tuned to sound smooth rather than mechanical: the pitch sweep is narrow, a
 * gentle lowpass rolls off the sample's harsh edge, and both follow the rotor
 * speed on a long time constant, so the loop drifts between states instead of
 * snapping to them.
 *
 * Browsers refuse to start audio without a user gesture, so nothing is created
 * until `resume()` is called from a real interaction. Until then this class is
 * silent and inert rather than throwing.
 */

const ASSET_KEY = "rotor-hum";

/** Playback rate at idle and at full rotor speed — a narrow sweep reads as
 * smooth; a wide one reads as a revving engine. */
const RATE_AT_IDLE = 0.85;
const RATE_AT_FULL = 1.2;
/** Ceiling on rotor loop gain, leaving headroom for the wind bed. */
const MAX_ROTOR_GAIN = 0.3;
/** Lowpass cutoff at idle and at full speed, Hz — takes the edge off the sample. */
const FILTER_AT_IDLE = 900;
const FILTER_AT_FULL = 2400;
/** How quickly rate, gain, and filter chase their targets, seconds. Long on
 * purpose: this is what keeps throttle changes from sounding zippy. */
const SMOOTHING_TIME = 0.35;

export class RotorAudio {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private starting = false;

  muted = false;

  /** True once the loop is actually running. */
  get running() {
    return this.source !== null;
  }

  /** Whether the project has a rotor sample registered at all. */
  static get available() {
    return hasAsset(ASSET_KEY);
  }

  /**
   * Start (or unmute) audio. Must be called from a user gesture. Safe to call
   * repeatedly; failures are swallowed because losing audio should never take
   * the sandbox down with it.
   */
  async resume() {
    if (this.starting || this.source) {
      await this.context?.resume().catch(() => {});
      return;
    }
    if (!RotorAudio.available) return;
    this.starting = true;

    try {
      this.context = new AudioContext();
      await this.context.resume();

      if (!this.buffer) {
        const artifact = Object.values(getAsset(ASSET_KEY).artifacts).find(
          (a) => a.loaderHint === "audio",
        );
        if (!artifact) return;

        const response = await fetch(getArtifactUrl(artifact));
        const bytes = await response.arrayBuffer();
        this.buffer = await this.context.decodeAudioData(bytes);
      }

      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.context.destination);

      // Softens the sample's harsh edge; see FILTER_AT_IDLE/FULL for why this
      // is the main lever on "how smooth this sounds", not just gain and rate.
      this.filter = this.context.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = FILTER_AT_IDLE;
      this.filter.Q.value = 0.6;
      this.filter.connect(this.gain);

      this.source = this.context.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.loop = true;
      this.source.connect(this.filter);
      this.source.start();
    } catch (error) {
      console.warn("Rotor audio unavailable", error);
      this.source = null;
    } finally {
      this.starting = false;
    }
  }

  /** Follow the aircraft. Cheap enough to call every frame. */
  update(state: DroneState) {
    if (!this.context || !this.source || !this.gain || !this.filter) return;

    let omega = 0;
    let thrust = 0;
    for (let i = 0; i < 4; i += 1) {
      omega += state.motorOmega[i];
      thrust += state.motorThrust[i];
    }
    omega /= 4;

    const fraction = Math.min(1, omega / VEHICLE.maxRotorOmega);
    const rate = RATE_AT_IDLE + (RATE_AT_FULL - RATE_AT_IDLE) * fraction;
    const cutoff = FILTER_AT_IDLE + (FILTER_AT_FULL - FILTER_AT_IDLE) * fraction;
    const target =
      this.muted || fraction < 0.01
        ? 0
        : Math.min(MAX_ROTOR_GAIN, (thrust / (VEHICLE.mass * 9.80665)) * 0.22);

    const now = this.context.currentTime;
    // A long, shared time constant is the point: every parameter drifts
    // toward its target instead of tracking the throttle stick directly, which
    // is what keeps the loop from sounding like it is being switched between
    // states rather than smoothly changing.
    this.source.playbackRate.setTargetAtTime(rate, now, SMOOTHING_TIME);
    this.gain.gain.setTargetAtTime(target, now, SMOOTHING_TIME);
    this.filter.frequency.setTargetAtTime(cutoff, now, SMOOTHING_TIME);
  }

  async dispose() {
    this.source?.stop();
    this.source?.disconnect();
    this.filter?.disconnect();
    this.gain?.disconnect();
    await this.context?.close().catch(() => {});
    this.source = null;
    this.filter = null;
    this.gain = null;
    this.context = null;
  }
}
