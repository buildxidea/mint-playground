export class AudioSystem {
  private context: AudioContext | null = null;
  private unlocked = false;

  constructor() {
    const unlock = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    await this.context.resume();
    this.unlocked = true;
  }

  /** Rising chime for a ring pass; pitch climbs with the combo. */
  ring(combo: number): void {
    this.tone('triangle', 420 + combo * 60, 840 + combo * 90, 0.09, 0.2);
  }

  /** Springy boing for a jelly cap bounce. */
  bounce(): void {
    this.tone('sine', 180, 520, 0.12, 0.28);
  }

  /** Low buzz for a tentacle sting. */
  sting(): void {
    this.tone('sawtooth', 220, 90, 0.07, 0.3);
  }

  private tone(
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    volume: number,
    duration: number,
  ): void {
    if (!this.context || this.context.state !== 'running') return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(fromHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), now + duration * 0.6);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }
}
