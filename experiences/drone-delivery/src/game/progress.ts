/** Best stars per route, persisted locally. */
const KEY = 'drone-delivery-dash-progress-v1';

export type Progress = Record<number, number>;

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Progress) : {};
  } catch {
    return {};
  }
}

export function saveStars(routeId: number, stars: number): Progress {
  const progress = loadProgress();
  if ((progress[routeId] ?? 0) < stars) progress[routeId] = stars;
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Storage may be unavailable (private browsing); progress just won't persist.
  }
  return progress;
}
