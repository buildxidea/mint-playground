const STORAGE_KEY = "battle-blaster:sound";

/**
 * Shots can overlap: the fastest weapon re-fires every ~350 ms against clips of
 * up to ~1.4 s, so four voices is the most that can ever be audible at once.
 */
const POOL_SIZE = 4;

interface Voice {
  elements: HTMLAudioElement[];
  next: number;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Owns weapon audio and the global mute. Deliberately the single source of
 * truth for sound state — AppState does not model it — so muting keeps working
 * regardless of which UI is wired up.
 */
export class AudioManager {
  private voices = new Map<string, Voice>();
  private on = readEnabled();
  private volume = 0.75;

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(next: boolean): void {
    this.on = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Private mode — mute still applies for this session.
    }
    if (!next) this.stopAll();
  }

  preload(id: string, url: string): void {
    if (this.voices.has(id)) return;
    const elements = Array.from({ length: POOL_SIZE }, () => {
      const element = new Audio(url);
      element.preload = "auto";
      element.volume = this.volume;
      return element;
    });
    this.voices.set(id, { elements, next: 0 });
  }

  play(id: string): void {
    if (!this.on) return;
    const voice = this.voices.get(id);
    if (!voice) return;
    const element = voice.elements[voice.next];
    voice.next = (voice.next + 1) % voice.elements.length;
    // Rewinding an element that has not loaded its metadata throws.
    if (element.readyState > 0) element.currentTime = 0;
    element.volume = this.volume;
    void element.play().catch(() => {});
  }

  private stopAll(): void {
    for (const voice of this.voices.values()) {
      for (const element of voice.elements) {
        element.pause();
        if (element.readyState > 0) element.currentTime = 0;
      }
    }
  }

  dispose(): void {
    this.stopAll();
    for (const voice of this.voices.values()) {
      for (const element of voice.elements) {
        element.removeAttribute("src");
        element.load();
      }
    }
    this.voices.clear();
  }
}

export const audio = new AudioManager();
