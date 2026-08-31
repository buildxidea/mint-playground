import { STOPS, ROOF_STORY, storyY } from "./content";

/**
 * The whole ride is a pure function of scroll progress p in [0,1].
 * Time units below are abstract "beats" that get normalized once.
 */

export interface StopWindow {
  story: number;
  stopIndex: number;
  y: number;
  arrive: number; // cab settled, doors begin opening
  open: number; // doors fully open
  closeStart: number; // doors begin closing
  depart: number; // doors fully closed
}

export interface RideState {
  t: number;
  duration: number;
  cabY: number;
  /** 0 closed .. 1 fully open */
  doors: number;
  /** Index into STOPS for the stop we're at/approaching, for copy + mood. */
  stopIndex: number;
  /** True while dwelling at a stop with doors mostly open. */
  atStop: boolean;
  /** Displayed story number (rounded from cabY). */
  displayStory: number;
  /** 0..1 through the roof finale camera pull. */
  finale: number;
  /** 0..1 walk across the lobby toward the closed doors, before boarding. */
  approach: number;
  /** 0..1 walk-in + turn-around after the doors first open; 1 once aboard. */
  enter: number;
  /** True while the camera is still on the landing, outside the cab. */
  outside: boolean;
  introVisible: boolean;
  outroVisible: boolean;
  /** 0..1 blend toward the current stop's mood (vs. travel mood). */
  moodBlend: number;
}

const DOOR_BEATS = 0.8;
const DWELL_BEATS = 1.15;
/** Approaching the lift across the lobby, doors closed, title up. */
const OUTSIDE_DWELL = 1.9;
/** Doors sliding open for boarding. */
const INTRO_OPEN_BEATS = 0.8;
/** Camera walks in and turns around. */
const ENTER_BEATS = 1.3;
/** Brief settle in the chosen view before the doors close. */
const SETTLE_BEATS = 0.35;
const FINALE_BEATS = 3.4;
const ROOF_OPEN_BEATS = 0.9;

export const ENTER_START = OUTSIDE_DWELL + INTRO_OPEN_BEATS;
export const ENTER_END = ENTER_START + ENTER_BEATS;

function travelBeats(fromStory: number, toStory: number): number {
  const dist = Math.abs(storyY(toStory) - storyY(fromStory));
  return 1.0 + Math.min(1.15, dist / 110);
}

function easeInOut(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const stopWindows: StopWindow[] = [];
export let RIDE_DURATION = 0;
export let FINALE_START = 0;
export let ROOF_ARRIVE = 0;

// ---- build the beat table ----------------------------------------------
{
  let t = 0;
  // Ground: the visitor starts OUTSIDE closed doors, boards, then departs.
  const ground = STOPS[0];
  const g: StopWindow = {
    story: ground.story,
    stopIndex: 0,
    y: storyY(ground.story),
    arrive: OUTSIDE_DWELL,
    open: ENTER_START,
    closeStart: ENTER_END + SETTLE_BEATS,
    depart: ENTER_END + SETTLE_BEATS + DOOR_BEATS,
  };
  stopWindows.push(g);
  t = g.depart;

  for (let i = 1; i < STOPS.length; i++) {
    const stop = STOPS[i];
    const prev = stopWindows[stopWindows.length - 1];
    const arrive = t + travelBeats(prev.story, stop.story);
    if (stop.story === ROOF_STORY) {
      const w: StopWindow = {
        story: stop.story,
        stopIndex: i,
        y: storyY(stop.story),
        arrive,
        open: arrive + ROOF_OPEN_BEATS,
        closeStart: Number.POSITIVE_INFINITY,
        depart: Number.POSITIVE_INFINITY,
      };
      stopWindows.push(w);
      ROOF_ARRIVE = arrive;
      FINALE_START = w.open + 0.35;
      t = FINALE_START + FINALE_BEATS;
    } else {
      const w: StopWindow = {
        story: stop.story,
        stopIndex: i,
        y: storyY(stop.story),
        arrive,
        open: arrive + DOOR_BEATS,
        closeStart: arrive + DOOR_BEATS + DWELL_BEATS,
        depart: arrive + DOOR_BEATS + DWELL_BEATS + DOOR_BEATS,
      };
      stopWindows.push(w);
      t = w.depart;
    }
  }
  RIDE_DURATION = t;
}

/** Cab Y at beat time t. */
export function cabYAt(t: number): number {
  for (let i = 0; i < stopWindows.length; i++) {
    const w = stopWindows[i];
    if (t <= (Number.isFinite(w.depart) ? w.depart : Number.MAX_VALUE)) {
      if (t >= w.arrive) return w.y;
      // travelling from previous stop; before the first window the cab is
      // simply parked at the ground floor waiting for boarding.
      const prev = stopWindows[i - 1];
      if (!prev) return w.y;
      const u = (t - prev.depart) / (w.arrive - prev.depart);
      return prev.y + (w.y - prev.y) * easeInOut(clamp01(u));
    }
  }
  return stopWindows[stopWindows.length - 1].y;
}

/** Door openness at beat time t. */
export function doorsAt(t: number): number {
  for (const w of stopWindows) {
    if (t < w.arrive - 0.001) continue;
    if (!Number.isFinite(w.depart)) {
      // roof: opens and stays open
      return clamp01((t - w.arrive) / ROOF_OPEN_BEATS);
    }
    if (t <= w.depart) {
      if (t < w.open) return clamp01((t - w.arrive) / (w.open - w.arrive));
      if (t < w.closeStart) return 1;
      return 1 - clamp01((t - w.closeStart) / (w.depart - w.closeStart));
    }
  }
  return 0;
}

export function evaluate(p: number): RideState {
  const t = clamp01(p) * RIDE_DURATION;
  const cabY = cabYAt(t);
  const doors = doorsAt(t);

  // nearest upcoming/current stop for copy & mood
  let stopIndex = 0;
  let moodBlend = 0;
  for (let i = stopWindows.length - 1; i >= 0; i--) {
    const w = stopWindows[i];
    const lead = 0.55; // start blending copy/mood on approach
    if (t >= w.arrive - lead) {
      stopIndex = w.stopIndex;
      const end = Number.isFinite(w.depart) ? w.depart + 0.2 : Number.MAX_VALUE;
      if (t <= end) {
        moodBlend = clamp01((t - (w.arrive - lead)) / lead);
      }
      break;
    }
  }

  const finale = clamp01((t - FINALE_START) / FINALE_BEATS);
  const atStop = doors > 0.55;
  const enter = clamp01((t - ENTER_START) / (ENTER_END - ENTER_START));

  return {
    t,
    duration: RIDE_DURATION,
    cabY,
    doors,
    stopIndex,
    atStop,
    displayStory: Math.max(0, Math.min(ROOF_STORY, Math.round(cabY / storyY(1)))),
    finale,
    approach: clamp01(t / OUTSIDE_DWELL),
    enter,
    outside: enter <= 0,
    introVisible: t < OUTSIDE_DWELL * 0.97,
    outroVisible: finale > 0.62,
    moodBlend,
  };
}

/** Beat time → scroll progress for programmatic travel (button panel). */
export function progressForStopDwell(story: number): number {
  const w = stopWindows.find((s) => s.story === story);
  if (!w) return 0;
  if (!Number.isFinite(w.depart)) return clamp01((w.open + 0.3) / RIDE_DURATION);
  return clamp01((w.open + (w.closeStart - w.open) * 0.5) / RIDE_DURATION);
}

export function windowForStory(story: number): StopWindow | undefined {
  return stopWindows.find((s) => s.story === story);
}
