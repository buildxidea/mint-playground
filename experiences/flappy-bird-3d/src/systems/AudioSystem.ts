import { AUDIO_URLS } from '../assets/assets';

export type SoundName = keyof typeof AUDIO_URLS;

/**
 * Plays the Mint-generated sound effects through Web Audio. The context is
 * created on the first user gesture (browser autoplay policy); buffers load
 * once and are reused. Mute routes everything through a master gain.
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private muted = false;
  private loading = false;

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
    if (this.context) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 1;
    this.masterGain.connect(this.context.destination);
    await this.context.resume();
    void this.loadBuffers();
  }

  play(name: SoundName): void {
    if (!this.context || !this.masterGain || this.context.state !== 'running') return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.masterGain);
    source.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : 1;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.masterGain = null;
    this.buffers.clear();
  }

  private async loadBuffers(): Promise<void> {
    if (this.loading || !this.context) return;
    this.loading = true;
    await Promise.all(
      (Object.keys(AUDIO_URLS) as SoundName[]).map(async (name) => {
        try {
          const response = await fetch(AUDIO_URLS[name]);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.arrayBuffer();
          const buffer = await this.context!.decodeAudioData(data);
          this.buffers.set(name, buffer);
        } catch (error) {
          console.error(`Failed to load sound "${name}":`, error);
        }
      }),
    );
  }
}
