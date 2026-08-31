import type { AssetLibrary } from '../assets/AssetLibrary';
import type { AudioKey } from '../assets/manifest';

const TIRE_COOLDOWN_MS = 280;
const COLLISION_COOLDOWN_MS = 220;

export class ParkingAudio {
  private unlocked = false;
  private muted = false;
  private engineSource: AudioBufferSourceNode | null = null;
  private engineGain: GainNode | null = null;
  private lastTireAt = 0;
  private lastCollisionAt = 0;

  constructor(private readonly assets: AssetLibrary) {}

  async unlock(): Promise<void> {
    const ctx = this.assets.getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    this.unlocked = true;
    this.ensureEngine();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.engineGain) this.engineGain.gain.value = muted ? 0 : this.engineGain.gain.value;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /**
   * Idle → drive engine: quiet when nearly stopped, rises with |speed|.
   * Rate tracks RPM so it reads as a car, not a constant drone.
   */
  updateEngine(speed: number, maxSpeed: number): void {
    if (!this.unlocked || !this.engineGain) return;
    const abs = Math.abs(speed);
    const t = Math.min(1, abs / Math.max(1, maxSpeed));
    // Soft idle under crawl; swell with speed.
    const idle = abs < 0.45 ? 0.02 : 0.05;
    const target = this.muted ? 0 : idle + t * 0.16;
    this.engineGain.gain.value += (target - this.engineGain.gain.value) * 0.12;
    if (this.engineSource) {
      this.engineSource.playbackRate.value = 0.78 + t * 0.62;
    }
  }

  /** Tire screech — cooldown + slip gate applied by caller. */
  playTire(volume = 0.18): void {
    if (!this.unlocked || this.muted) return;
    const now = performance.now();
    if (now - this.lastTireAt < TIRE_COOLDOWN_MS) return;
    this.lastTireAt = now;
    this.playBuffer('tire', volume);
  }

  /** Impact — volume should already be scaled by speed. */
  playCollision(volume = 0.45): void {
    if (!this.unlocked || this.muted) return;
    const now = performance.now();
    if (now - this.lastCollisionAt < COLLISION_COOLDOWN_MS) return;
    this.lastCollisionAt = now;
    this.playBuffer('collision', volume);
  }

  play(key: AudioKey, volume = 0.55): void {
    if (!this.unlocked || this.muted) return;
    if (key === 'tire') {
      this.playTire(volume);
      return;
    }
    if (key === 'collision') {
      this.playCollision(volume);
      return;
    }
    this.playBuffer(key, volume);
  }

  dispose(): void {
    try {
      this.engineSource?.stop();
    } catch {
      /* ignore */
    }
    this.engineSource = null;
  }

  private playBuffer(key: AudioKey, volume: number): void {
    const buffer = this.assets.getAudio(key);
    if (!buffer) return;
    const ctx = this.assets.getAudioContext();
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }

  private ensureEngine(): void {
    if (this.engineSource) return;
    const buffer = this.assets.getAudio('engine');
    if (!buffer) return;
    const ctx = this.assets.getAudioContext();
    this.engineSource = ctx.createBufferSource();
    this.engineGain = ctx.createGain();
    this.engineSource.buffer = buffer;
    this.engineSource.loop = true;
    this.engineGain.gain.value = 0;
    this.engineSource.connect(this.engineGain).connect(ctx.destination);
    this.engineSource.start();
  }
}
