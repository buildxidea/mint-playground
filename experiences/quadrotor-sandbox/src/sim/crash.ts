import type { DroneContacts, PhysicsWorld } from "./physics";
import type { DroneState } from "./state";

/**
 * The kinematic ↔ dynamic handoff.
 *
 * While flying, this project's integrator owns the aircraft and Rapier only
 * watches. On a real impact the aircraft is handed to Rapier as a dynamic
 * body, carrying its momentum, and tumbles under the engine's control until
 * the pilot resets.
 *
 * Recovery is deliberately manual. An automatic hand-back would have to decide
 * when a tumbling wreck has "settled", and any threshold for that flaps: the
 * body twitches below the limit, control returns, the controller snaps it
 * upright, it clips the ground again. Requiring an explicit reset removes the
 * oscillation entirely rather than papering over it with a longer timer.
 */

export interface CrashLimits {
  /** Vertical speed above which meeting the ground is a crash, m/s. */
  hardLandingSpeed: number;
  /** Speed above which brushing scenery is a crash, m/s. */
  scenerySpeed: number;
}

export const DEFAULT_CRASH_LIMITS: CrashLimits = {
  // A controlled descent touches down well under 2 m/s; anything faster is an
  // arrival rather than a landing.
  hardLandingSpeed: 2.5,
  // Scenery is unforgiving: props are spinning, and a container does not care
  // how gently you meet it.
  scenerySpeed: 0.5,
};

/**
 * Decide whether this step's contacts constitute a crash.
 *
 * Split out as a pure function so the policy can be tested without standing up
 * a physics world.
 *
 * Note the asymmetry in where the two contact kinds come from. Scenery hits
 * are reported by Rapier, but ground hits are *not*: the flight model's ground
 * constraint stops the aircraft before its collider can reach the ground slab,
 * so Rapier never sees the landing. The touchdown speed is therefore passed in
 * from the constraint itself, captured before it zeroes the descent.
 */
export function isCrash(
  contacts: DroneContacts,
  speed: number,
  groundImpactSpeed: number | null,
  limits: CrashLimits = DEFAULT_CRASH_LIMITS,
  support: Support = UNSUPPORTED,
): boolean {
  if (contacts.prop) {
    // Only the flat ground slab is classified as ground; every other collider
    // in the world — including the roof of every building — arrives here as
    // scenery. Before landing on surfaces existed that was fine, because the
    // only way to touch a building was to fly into it. Now a textbook rooftop
    // landing generates exactly the same contact, so the test has to
    // distinguish *arriving on* a surface from *running into* one.
    //
    // The discriminator is direction, not gentleness. When something is
    // holding the aircraft up, downward speed is the landing and horizontal
    // speed is the collision: descending onto a roof at 2 m/s is an arrival,
    // sliding into a parapet at 2 m/s is a crash. Unsupported, any contact at
    // speed is still a crash, exactly as before.
    const relevantSpeed = support.supported ? support.horizontalSpeed : speed;
    if (relevantSpeed > limits.scenerySpeed) return true;
  }
  if (groundImpactSpeed !== null && groundImpactSpeed > limits.hardLandingSpeed) {
    return true;
  }
  return false;
}

/**
 * Whether a surface is currently holding the aircraft up, and how fast it is
 * travelling across that surface.
 */
export interface Support {
  supported: boolean;
  horizontalSpeed: number;
}

const UNSUPPORTED: Support = { supported: false, horizontalSpeed: 0 };

export class CrashController {
  /** Seconds spent tumbling since the crash, for the HUD and for effects. */
  elapsed = 0;

  constructor(private readonly limits: CrashLimits = DEFAULT_CRASH_LIMITS) {}

  /**
   * Run one step of the handoff.
   *
   * Call after the flight model has committed its step and after the physics
   * world has stepped, so the contacts being read belong to the pose the
   * aircraft actually reached.
   */
  update(
    state: DroneState,
    physics: PhysicsWorld,
    dt: number,
    groundImpactSpeed: number | null,
    support: Support = UNSUPPORTED,
  ) {
    if (state.crashed) {
      // Rapier owns the aircraft now; read its verdict back.
      physics.pullDynamic(state);
      this.elapsed += dt;
      physics.drainDroneContacts();
      return;
    }

    const contacts = physics.drainDroneContacts();
    if (
      isCrash(
        contacts,
        state.velocity.length(),
        groundImpactSpeed,
        this.limits,
        support,
      )
    ) {
      this.begin(state, physics);
    }
  }

  private begin(state: DroneState, physics: PhysicsWorld) {
    state.crashed = true;
    state.armed = false;
    this.elapsed = 0;

    // Rotors stop producing thrust, but keep their stored speed so they can be
    // seen spinning down rather than stopping dead.
    state.motorThrust.fill(0);

    physics.setDroneDynamic(true, state);
  }

  /** Hand the aircraft back to the flight model. Called from the pilot's reset. */
  reset(state: DroneState, physics: PhysicsWorld) {
    state.crashed = false;
    this.elapsed = 0;
    physics.setDroneDynamic(false, state);
    physics.drainDroneContacts();
  }
}
