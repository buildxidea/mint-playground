/**
 * Snorlax gets permanently bigger every time he is woken, and stays that size
 * when he goes back to sleep. Size lives only in memory, so a refresh returns
 * him to his original scale.
 *
 * Both the timing and the feel of the inflation are switchable at runtime from
 * the settings panel, so this module owns the option lists as well as the
 * curves — the UI and the rig read the same source.
 */

export type GrowthWhen = "sitting" | "landing";
export type GrowthFeel = "balloon" | "smooth" | "pumps";

export interface GrowthSettings {
  when: GrowthWhen;
  feel: GrowthFeel;
}

/** Each wake multiplies his size by this. There is deliberately no cap. */
export const GROWTH_PER_WAKE = 1.2;

export const DEFAULT_GROWTH: GrowthSettings = { when: "sitting", feel: "balloon" };

export const GROWTH_WHEN_OPTIONS: { id: GrowthWhen; label: string; blurb: string }[] = [
  { id: "sitting", label: "While sitting", blurb: "He sits up, then visibly swells before flopping back." },
  { id: "landing", label: "On landing", blurb: "The thud of him hitting the ground puffs him bigger." },
];

export const GROWTH_FEEL_OPTIONS: { id: GrowthFeel; label: string; blurb: string }[] = [
  { id: "balloon", label: "Balloon", blurb: "Overshoots the new size, then settles back with a wobble." },
  { id: "smooth", label: "Smooth", blurb: "Clean ease up to the new size, no overshoot." },
  { id: "pumps", label: "Pumps", blurb: "Three visible pushes, like breaths being blown in." },
];

/** The wake phase times, passed in so this never drifts from the animation. */
export interface WakeTimeline {
  riseStart: number;
  riseEnd: number;
  sitEnd: number;
  fallEnd: number;
  total: number;
}

/**
 * When the inflation plays within the wake sequence, in seconds from the start
 * of the wake. Derived from the timeline rather than hardcoded, so retiming the
 * wake cannot silently push the inflation past the end of it.
 */
export function growthWindow(when: GrowthWhen, wake: WakeTimeline): { start: number; duration: number } {
  if (when === "sitting") {
    // Just after he settles upright, finishing before he drops back.
    const start = wake.riseEnd + 0.4;
    return { start, duration: Math.min(1.3, Math.max(0.6, wake.sitEnd - start - 0.3)) };
  }
  // On the impact, riding the settle that follows it.
  return { start: wake.fallEnd, duration: Math.min(1.2, wake.total - wake.fallEnd - 0.3) };
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Maps 0..1 progress to 0..1 of the size change. `balloon` deliberately exceeds
 * 1 in the middle so he swells past the target; every curve lands exactly on 1
 * at t = 1, so he always finishes at the intended size.
 */
export function growthCurve(feel: GrowthFeel, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  if (feel === "smooth") return smoothstep(k);

  if (feel === "pumps") {
    const steps = 3;
    const stage = Math.min(steps - 1e-6, k * steps);
    const index = Math.floor(stage);
    const local = stage - index;
    // Each pump pushes for most of its slot, then holds briefly.
    const eased = local < 0.62 ? smoothstep(local / 0.62) : 1;
    return (index + eased) / steps;
  }

  // balloon: swell past the target, then settle back onto it. A back-ease,
  // whose cubic genuinely exceeds 1 in the middle — an ease plus a decaying
  // wobble does not, because the wobble dies faster than the base rises.
  const overshoot = 2;
  const u = k - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
}
