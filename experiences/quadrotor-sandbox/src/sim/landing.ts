import { Vector3 } from "three";
import { DEFAULT_CRASH_LIMITS } from "./crash";
import type { DroneState } from "./state";

/**
 * Touchdown detection and grading.
 *
 * Landing already *worked* before this module existed — the ground constraint
 * catches the aircraft and anything under the crash limit is survivable. What
 * was missing is that nothing ever said so. This turns arriving on a surface
 * into an event with a verdict attached, which is what makes landing a thing
 * a pilot can get better at rather than a thing that merely stops happening.
 *
 * Kept free of physics and rendering so the policy can be tested directly.
 */

export type LandingGrade = "greased" | "good" | "firm" | "hard";

export const GRADE_LABELS: Record<LandingGrade, string> = {
  greased: "GREASED",
  good: "GOOD",
  firm: "FIRM",
  hard: "HARD",
};

/** Ordered best to worst, so a grade can be demoted by index. */
export const GRADE_ORDER: readonly LandingGrade[] = [
  "greased",
  "good",
  "firm",
  "hard",
];

/**
 * Sink-rate ceilings for each grade, m/s.
 *
 * Anchored to the crash limit rather than picked independently: `hard` runs
 * right up to it, so every landing that is survivable has a grade and every
 * grade describes a landing that was survivable. Move the crash limit and
 * these follow.
 */
export const GRADE_SINK: Record<LandingGrade, number> = {
  greased: 0.4,
  good: 1.0,
  firm: 1.8,
  hard: DEFAULT_CRASH_LIMITS.hardLandingSpeed,
};

/** Tilt past which the landing is demoted one grade, then two. Radians. */
const TILT_DEMOTE = (15 * Math.PI) / 180;
const TILT_DEMOTE_HARD = (30 * Math.PI) / 180;

/**
 * How long the aircraft must have been off the ground for the next contact to
 * count as a landing. Without it a single touchdown reports several times: the
 * constraint releases and re-engages across a step or two as the aircraft
 * settles, and each re-engagement looks like a fresh arrival.
 */
const AIRBORNE_BEFORE_LANDING = 0.35;

export interface Touchdown {
  grade: LandingGrade;
  /** Descent rate at the moment of contact, m/s. */
  sinkSpeed: number;
  /** Angle between the aircraft's up axis and world up at contact, radians. */
  tilt: number;
  /** Horizontal speed at contact, m/s. */
  groundSpeed: number;
  /** Height of the surface landed on, metres — street level, or a rooftop. */
  surfaceHeight: number;
}

const bodyUp = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

/** Angle between the aircraft's up axis and world up, radians. */
export function tiltOf(state: DroneState): number {
  bodyUp.set(0, 1, 0).applyQuaternion(state.orientation);
  return Math.acos(Math.min(1, Math.max(-1, bodyUp.dot(WORLD_UP))));
}

/**
 * Grade a touchdown from its sink rate, demoted for arriving tilted.
 *
 * Sink rate alone is not enough: setting down at 0.2 m/s while banked 40° is
 * not a greased landing, it is a wingtip strike that happened to be slow.
 */
export function gradeLanding(sinkSpeed: number, tilt: number): LandingGrade {
  let index = GRADE_ORDER.findIndex((grade) => sinkSpeed <= GRADE_SINK[grade]);
  if (index === -1) index = GRADE_ORDER.length - 1;

  if (tilt > TILT_DEMOTE_HARD) index += 2;
  else if (tilt > TILT_DEMOTE) index += 1;

  return GRADE_ORDER[Math.min(index, GRADE_ORDER.length - 1)];
}

/**
 * Watches for the airborne → supported transition and reports it once.
 *
 * The sink speed has to be passed in rather than read from the state: the
 * ground constraint zeroes the descent in the same step it engages, so by the
 * time anything downstream looks at the velocity, the number that decides the
 * grade is already gone. Both flight models capture it before clamping.
 */
export class LandingDetector {
  /**
   * Seconds since the aircraft was last supported.
   *
   * Starts at zero, meaning "already on the ground". Starting it at the
   * threshold instead made the very first supported step look like an arrival,
   * so every spawn onto a pad or runway flashed a landing grade before the
   * pilot had flown anywhere — and a rocket, sitting pitched ninety degrees on
   * its tail, was graded FIRM for standing still.
   */
  private airborne = 0;
  /** Latest touchdown, kept so the HUD can hold it on screen. */
  last: Touchdown | null = null;
  /** Seconds since `last` was recorded. */
  sinceLast = Infinity;

  update(
    state: DroneState,
    grounded: boolean,
    sinkSpeed: number,
    dt: number,
  ): Touchdown | null {
    this.sinceLast += dt;

    if (!grounded) {
      this.airborne += dt;
      return null;
    }

    const wasFlying = this.airborne >= AIRBORNE_BEFORE_LANDING;
    this.airborne = 0;
    if (!wasFlying) return null;

    // A crash is not a landing. The handoff has its own verdict and its own
    // display; grading a wreck would be reporting two outcomes for one event.
    if (state.crashed) return null;

    const tilt = tiltOf(state);
    const touchdown: Touchdown = {
      grade: gradeLanding(sinkSpeed, tilt),
      sinkSpeed,
      tilt,
      groundSpeed: Math.hypot(state.velocity.x, state.velocity.z),
      surfaceHeight: state.position.y,
    };
    this.last = touchdown;
    this.sinceLast = 0;
    return touchdown;
  }

  /** Forget the last landing — called from the pilot's reset. */
  reset() {
    this.airborne = 0;
    this.last = null;
    this.sinceLast = Infinity;
  }
}
