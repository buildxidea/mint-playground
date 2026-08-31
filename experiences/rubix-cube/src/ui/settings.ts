import { BackgroundName, CubeSize, DEFAULT_SIZE, isCubeSize } from "../cube/constants";

const STORAGE_KEY = "rubix-cube.settings";

export interface Settings {
  background: BackgroundName;
  size: CubeSize;
  muted: boolean;
}

const DEFAULTS: Settings = {
  background: "black",
  size: DEFAULT_SIZE,
  muted: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      background:
        parsed.background === "white" || parsed.background === "black"
          ? parsed.background
          : DEFAULTS.background,
      size: isCubeSize(parsed.size) ? parsed.size : DEFAULTS.size,
      muted: parsed.muted === true,
    };
  } catch {
    // Private mode or corrupt value: fall back rather than fail to start.
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is a convenience, never a hard requirement.
  }
}
