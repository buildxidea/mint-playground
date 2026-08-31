/**
 * Player display settings for THE MARS TRAIL.
 *
 * These only affect presentation — never the simulation — so they are safe to
 * persist and to change mid-run. Stored in localStorage so a chosen look
 * survives a reload.
 */

// Bumped when the defaults changed: a stored 270 is still a valid preset, so
// without a new key every returning player would stay on the old pixel look.
// Bumped again when the default rose to 1080p: a stored 540 is still a valid
// preset, so without a new key returning players would stay on the old default.
const STORAGE_KEY = 'mars-trail:display-settings:v3';

export interface DisplaySettings {
  /** Internal render height in pixels. Lower is chunkier. */
  internalHeight: number;
  /** Composite exposure multiplier. */
  exposure: number;
  /** Monochrome CRT filter. */
  phosphor: boolean;
  /** Palette clamp, ordered dither, and scanlines. Off is the modern look. */
  retro: boolean;
}

export interface SettingOption<T> {
  label: string;
  value: T;
  detail: string;
}

/**
 * Internal render resolution.
 *
 * 1080 is the default. The scene still renders into an offscreen buffer rather
 * than straight to the canvas, so the retro treatment stays available — it is
 * just no longer downscaled. Every lower preset is kept, because 1080p with a
 * bloom pass and a corridor of cloned models is genuinely expensive on weaker
 * hardware and dropping to HD halves the pixel cost.
 */
export const PIXELATION_OPTIONS: Array<SettingOption<number>> = [
  { label: 'Chunky', value: 270, detail: 'The original pixel look. Cheapest to draw.' },
  { label: 'Sharp', value: 405, detail: 'Coarse grain, models read clearly.' },
  { label: 'HD', value: 540, detail: 'Clean and detailed. Half the cost of Full.' },
  { label: 'Full', value: 1080, detail: 'Default. Sharpest, and the most to draw.' },
];

export const BRIGHTNESS_OPTIONS: Array<SettingOption<number>> = [
  { label: 'Dim', value: 1.25, detail: 'Darker, heavier shadows.' },
  { label: 'Normal', value: 1.6, detail: 'Default.' },
  { label: 'Bright', value: 1.95, detail: 'Lifts the deep-space legs.' },
  { label: 'Brightest', value: 2.35, detail: 'Maximum readability.' },
];

export const DEFAULT_SETTINGS: DisplaySettings = {
  internalHeight: 1080,
  exposure: 1.6,
  phosphor: false,
  retro: false,
};

function isValid(settings: Partial<DisplaySettings>): boolean {
  return (
    PIXELATION_OPTIONS.some((o) => o.value === settings.internalHeight) &&
    typeof settings.exposure === 'number' &&
    settings.exposure >= 0.2 &&
    settings.exposure <= 4
  );
}

export function loadSettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
    // A stored value from an older build may name a preset that no longer
    // exists; fall back rather than rendering at an untested resolution.
    if (!isValid(parsed)) return { ...DEFAULT_SETTINGS };
    return {
      internalHeight: parsed.internalHeight ?? DEFAULT_SETTINGS.internalHeight,
      exposure: parsed.exposure ?? DEFAULT_SETTINGS.exposure,
      phosphor: Boolean(parsed.phosphor),
      retro: Boolean(parsed.retro),
    };
  } catch {
    // Private browsing and disabled storage both throw here; the defaults are
    // a perfectly good answer.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: DisplaySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not being able to persist is not worth interrupting play over.
  }
}
