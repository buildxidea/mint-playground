import type { Settings } from './types';

const STORAGE_KEY = 'pt3d-settings';

const DEFAULTS: Settings = {
  finish: 'glossy',
  board: 'wood',
  background: 'black',
  colorMode: 'category',
  sound: 'on',
};

type Listener = (settings: Settings, changed: keyof Settings) => void;

export class SettingsStore {
  readonly state: Settings;
  private listeners: Listener[] = [];

  constructor() {
    this.state = { ...DEFAULTS, ...this.load() };
  }

  private load(): Partial<Settings> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const out: Partial<Settings> = {};
      if (parsed.finish && ['glossy', 'matte', 'metallic', 'satin'].includes(parsed.finish))
        out.finish = parsed.finish;
      if (parsed.board && ['wood', 'plastic'].includes(parsed.board)) out.board = parsed.board;
      if (parsed.background && ['black', 'white'].includes(parsed.background))
        out.background = parsed.background;
      if (parsed.colorMode && ['category', 'mono'].includes(parsed.colorMode))
        out.colorMode = parsed.colorMode;
      if (parsed.sound && ['on', 'off'].includes(parsed.sound)) out.sound = parsed.sound;
      return out;
    } catch {
      return {};
    }
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.state[key] === value) return;
    this.state[key] = value;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable; settings stay session-only */
    }
    for (const l of this.listeners) l(this.state, key);
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Wire the segmented buttons in #settings-panel to the store. */
  bindUI(): void {
    const panel = document.getElementById('settings-panel')!;
    const btn = document.getElementById('settings-btn')!;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('visible');
    });
    document.addEventListener('pointerdown', (e) => {
      if (!panel.contains(e.target as Node) && e.target !== btn)
        panel.classList.remove('visible');
    });

    const syncers: Array<() => void> = [];
    panel.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const key = seg.dataset.setting as keyof Settings;
      const sync = () => {
        seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
          b.classList.toggle('active', b.dataset.value === this.state[key]);
        });
      };
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.addEventListener('click', () => this.set(key, b.dataset.value as never));
      });
      syncers.push(sync);
      sync();
    });
    // the store is the source of truth: reflect every change, however triggered
    this.onChange(() => {
      for (const sync of syncers) sync();
    });
  }
}
