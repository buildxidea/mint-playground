export interface GameSettings {
  volume: number;
  muted: boolean;
  waveIntensity: number;
  quality: 'low' | 'medium' | 'high';
  cameraMode: 'chase' | 'high';
}

const STORAGE_KEY = 'boatpark-settings';

export const DEFAULT_SETTINGS: GameSettings = {
  volume: 0.8,
  muted: false,
  waveIntensity: 1,
  quality: 'high',
  cameraMode: 'chase',
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      volume: clamp01(numberOr(parsed.volume, DEFAULT_SETTINGS.volume)),
      muted: parsed.muted === true,
      waveIntensity: Math.min(1.5, clamp01to(numberOr(parsed.waveIntensity, 1), 1.5)),
      quality: parsed.quality === 'low' || parsed.quality === 'medium' ? parsed.quality : 'high',
      cameraMode: parsed.cameraMode === 'high' ? 'high' : 'chase',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or blocked storage: settings just stay session-local.
  }
}

export function qualityMaxDpr(quality: GameSettings['quality']): number {
  if (quality === 'low') return 1;
  if (quality === 'medium') return 1.5;
  return 2;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp01to(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}
