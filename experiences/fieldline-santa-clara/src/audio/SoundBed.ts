export class SoundBed {
  private context: AudioContext | null = null;
  private crowd: HTMLAudioElement | null = null;
  private unlocked = false;
  private enabled = false;

  constructor() {
    this.crowd = new Audio(
      "https://cdn.mint.gg/audio/xd729tzzwdbw9debk86c8ykd8d8bmryw/fieldline-crowd-ambience-6f8a4d-5d390602d69205ec.mp3",
    );
    this.crowd.preload = "auto";
    this.crowd.loop = true;
    this.crowd.volume = 0.18;
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.context = new AudioContext();
    void this.context.resume();
    if (this.enabled) this.startCrowd();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.crowd?.pause();
      return;
    }
    if (this.unlocked) this.startCrowd();
  }

  private startCrowd(): void {
    void this.crowd?.play().catch(() => {
      /* The UI remains usable if a browser declines audio playback. */
    });
  }

  playCameraMove(): void {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(190, now);
    oscillator.frequency.exponentialRampToValueAtTime(85, now + 0.13);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
  }

  dispose(): void {
    this.crowd?.pause();
    this.crowd = null;
    void this.context?.close();
    this.context = null;
  }
}
