import { Quaternion, Vector3 } from "three";
import { AIR_DENSITY, GRAVITY } from "../core/basis";
import type { DroneState } from "./state";

/**
 * Vertical-launch rocket dynamics.
 *
 * The third flight model here, and it earns its own file because neither of
 * the others describes it. The multirotor cascade *holds* an altitude with a
 * PID; a rocket does not hold anything, it accelerates. The fixed-wing model
 * needs airflow over a wing to make lift; a rocket has no wing and is happiest
 * where there is no air at all.
 *
 * Three things follow from that and shape everything below:
 *
 * 1. **Mass is a variable, not a constant.** Propellant is most of what leaves
 *    the pad, so thrust-to-weight climbs steeply through the burn. The stack
 *    leaves at about 1.5 g and is well past 3 g by the time the boosters are
 *    spent — the same throttle setting is a completely different aircraft two
 *    minutes apart.
 *
 * 2. **Steering costs thrust.** There are no control surfaces; the engines
 *    gimbal, so pitch and yaw authority is *proportional to thrust*. Close the
 *    throttle and the rocket becomes an unguided falling object. This is the
 *    single most distinctive thing about flying one, so it is modelled
 *    directly rather than approximated with a constant authority.
 *
 * 3. **Solids do not throttle.** Once lit, a strap-on booster burns flat out
 *    until it is empty — so for the whole first phase of the flight the
 *    throttle only commands part of the thrust, and most of the acceleration
 *    is out of the pilot's hands.
 *
 * Body axes follow the rest of the project: nose is -Z, thrust acts along the
 * nose, exhaust leaves at +Z. A rocket on the pad is therefore just an
 * airframe pitched ninety degrees nose-up, which lets the cameras, the ground
 * constraint and the crash policy work on it unchanged.
 */

export interface RocketConfig {
  /** Everything that is not propellant and not a booster, kg. */
  dryMass: number;
  /** Core propellant load, kg. */
  coreProp: number;
  /** Per-booster propellant load and empty mass, kg. */
  boosterProp: number;
  boosterDryMass: number;
  /** Core thrust at full throttle, N. Throttleable. */
  coreThrust: number;
  /** Per-booster thrust, N. Solids: full or nothing. */
  boosterThrust: number;
  /** Propellant consumed per second at full core throttle, kg/s. */
  coreBurnRate: number;
  /** Per-booster propellant consumed per second, kg/s. */
  boosterBurnRate: number;
  /**
   * Torque per unit stick per newton of thrust, m. Physically this is the
   * moment arm the gimbal works through, which is why it multiplies thrust
   * rather than standing alone.
   */
  gimbalArm: number;
  /** Roll authority, N·m per unit stick — roll thrusters, not the gimbal, so
   * this one does not scale with main-engine thrust. */
  rollAuthority: number;
  /** Diagonal body-frame inertia when fully loaded: x pitch, y yaw, z roll. */
  inertia: { x: number; y: number; z: number };
  /** Reference area for drag, m^2, and drag coefficient. */
  dragArea: number;
  dragCoefficient: number;
  /** Angular damping, N·m per rad/s. */
  angularDamping: number;
  /** Number of boosters on the stack. */
  boosterCount: number;
}

/**
 * A shuttle-style stack sized for this sandbox: 14 m tall, leaving the pad at
 * about 1.45 g and burning for a little under a minute on the boosters.
 *
 * Deliberately not a scale model of anything. The world here is a few hundred
 * metres across, so a rocket with a real one's thrust-to-weight and burn time
 * would be out of sight in four seconds.
 *
 * The thrust split between core and boosters is the load-bearing choice, and
 * it is set from four ratios rather than picked and hoped for. Against the
 * full stack's own weight:
 *
 *   everything, full throttle   1.45   it flies
 *   boosters alone              1.05   closing the throttle does not drop it
 *   core alone                  0.40   the boosters are genuinely required
 *   core alone, post-separation 1.36   and the second half of the flight works
 *
 * The first version of these numbers put core-alone at 0.99 — a knife edge
 * where separating on the pad stranded the stack for four seconds and then
 * let it crawl away as it burned mass off. That is not a design, it is a
 * coincidence, and it would have flipped the first time any other number
 * moved.
 */
export const ROCKET: RocketConfig = {
  dryMass: 900,
  coreProp: 2600,
  boosterProp: 1400,
  boosterDryMass: 220,
  coreThrust: 26500,
  boosterThrust: 34700,
  coreBurnRate: 26,
  boosterBurnRate: 24,
  gimbalArm: 0.0105,
  rollAuthority: 900,
  inertia: { x: 5200, y: 5200, z: 420 },
  dragArea: 5.2,
  dragCoefficient: 0.42,
  angularDamping: 2600,
  boosterCount: 2,
};

/**
 * A single-stage stainless vehicle: no strap-on boosters at all.
 *
 * `boosterCount: 0` is doing real work here rather than being a placeholder.
 * The whole first phase of the shuttle-style stack's flight is governed by
 * solids the throttle cannot touch; this one has nothing but throttleable
 * engines, so the pilot commands *all* of the thrust from the moment it lights
 * and there is never a staging decision to get wrong. It is the simpler
 * rocket to fly and the less interesting one, which is the trade.
 *
 * Against its own fully-fuelled weight:
 *
 *   full throttle   1.49   it flies
 *   at burnout      7.1    a nearly empty stage is violently overpowered,
 *                          which is why the HUD shows thrust-to-weight
 */
export const STARSHIP: RocketConfig = {
  dryMass: 900,
  coreProp: 3400,
  boosterProp: 0,
  boosterDryMass: 0,
  coreThrust: 63000,
  boosterThrust: 0,
  coreBurnRate: 38,
  boosterBurnRate: 0,
  // Bigger moment arm than the stack's: the engines sit at the base of a
  // slimmer, taller vehicle, and the aero flaps help at low altitude.
  gimbalArm: 0.018,
  rollAuthority: 700,
  inertia: { x: 4200, y: 4200, z: 260 },
  dragArea: 3.2,
  dragCoefficient: 0.4,
  angularDamping: 2200,
  boosterCount: 0,
};

/**
 * The rocket's own bookkeeping, kept out of `DroneState`.
 *
 * Position, velocity and attitude mean the same thing to every vehicle here
 * and live in the canonical state. Propellant does not — five of the six craft
 * have no concept of it — so it lives beside the model that owns it rather
 * than being bolted onto a struct the whole app reads.
 */
export interface RocketState {
  /** Remaining core propellant, kg. */
  coreProp: number;
  /** Remaining propellant per booster, kg. */
  boosterProp: number;
  boostersAttached: boolean;
  /** Set once the pilot has lit the engines; a rocket cannot be un-lit. */
  ignited: boolean;
  /** Total thrust produced last step, N — for the plumes, audio and HUD. */
  thrust: number;
  /** Total mass last step, kg. */
  mass: number;
}

export function createRocketState(config: RocketConfig = ROCKET): RocketState {
  return {
    coreProp: config.coreProp,
    boosterProp: config.boosterProp,
    boostersAttached: true,
    ignited: false,
    thrust: 0,
    mass: totalMass(config, config.coreProp, config.boosterProp, true),
  };
}

export function resetRocketState(rocket: RocketState, config: RocketConfig = ROCKET) {
  rocket.coreProp = config.coreProp;
  rocket.boosterProp = config.boosterProp;
  rocket.boostersAttached = true;
  rocket.ignited = false;
  rocket.thrust = 0;
  rocket.mass = totalMass(config, config.coreProp, config.boosterProp, true);
}

function totalMass(
  c: RocketConfig,
  coreProp: number,
  boosterProp: number,
  boostersAttached: boolean,
): number {
  const boosters = boostersAttached
    ? c.boosterCount * (c.boosterDryMass + boosterProp)
    : 0;
  return c.dryMass + coreProp + boosters;
}

/**
 * Drop the boosters.
 *
 * Deliberately unconditional: separating early throws away thrust you still
 * had, separating late carries dead weight uphill, and both are the pilot's
 * mistake to make. Refusing the command until some "correct" moment would be
 * the sim deciding how to fly the rocket.
 *
 * Returns false only when there is nothing attached to drop.
 */
export function separateBoosters(rocket: RocketState): boolean {
  if (!rocket.boostersAttached) return false;
  rocket.boostersAttached = false;
  rocket.boosterProp = 0;
  return true;
}

export interface RocketControls {
  /** Core throttle, 0..1. */
  throttle: number;
  /** Gimbal commands, -1..1. */
  pitch: number;
  yaw: number;
  roll: number;
}

/** What the ground contact looked like this step, for the crash policy. */
export interface RocketContact {
  grounded: boolean;
  sinkSpeed: number;
  groundSpeed: number;
}

const contact: RocketContact = { grounded: false, sinkSpeed: 0, groundSpeed: 0 };

// Module-level scratch, like the other two models: the 200 Hz loop allocates
// nothing.
const thrustWorld = new Vector3();
const forceWorld = new Vector3();
const dragWorld = new Vector3();
const torque = new Vector3();
const spinQuat = new Quaternion();
const derivative = new Quaternion();

const NOSE = new Vector3(0, 0, -1);

export interface RocketOptions {
  config?: RocketConfig;
  /** Terrain height sampler; defaults to a flat world at zero. */
  groundHeightAt?: (x: number, z: number) => number;
}

const FLAT_GROUND = () => 0;

/**
 * Advance the rocket by `dt` seconds and report ground contact.
 *
 * `rocket.ignited` gates everything: before the pilot lights the engines the
 * stack simply sits on the pad, and no amount of stick does anything. There is
 * no separate hold-down mechanism — the shared ground constraint already keeps
 * it there, and a rocket whose thrust has not yet passed its own weight stays
 * put on its own, which is exactly right.
 */
export function stepRocket(
  state: DroneState,
  rocket: RocketState,
  controls: RocketControls,
  windVelocity: Vector3,
  groundClearance: number,
  dt: number,
  options: RocketOptions = {},
): RocketContact {
  const c = options.config ?? ROCKET;
  const groundHeightAt = options.groundHeightAt ?? FLAT_GROUND;

  const lit = rocket.ignited && state.armed && !state.crashed;

  // --- Propellant and thrust ----------------------------------------------
  const throttle = lit ? Math.min(1, Math.max(0, controls.throttle)) : 0;

  let coreThrust = 0;
  if (rocket.coreProp > 0 && throttle > 0) {
    const burn = Math.min(rocket.coreProp, c.coreBurnRate * throttle * dt);
    rocket.coreProp -= burn;
    // Scale by what was actually available: the last partial step of a burn
    // should not produce full thrust from propellant that was not there.
    coreThrust = c.coreThrust * throttle * (burn / (c.coreBurnRate * throttle * dt) || 0);
  }

  let boosterThrust = 0;
  if (lit && rocket.boostersAttached && rocket.boosterProp > 0) {
    // Solids do not throttle: full flow until empty, whatever the stick says.
    const burn = Math.min(rocket.boosterProp, c.boosterBurnRate * dt);
    rocket.boosterProp -= burn;
    boosterThrust = c.boosterCount * c.boosterThrust * (burn / (c.boosterBurnRate * dt));
  }

  const thrust = coreThrust + boosterThrust;
  rocket.thrust = thrust;

  const mass = totalMass(c, rocket.coreProp, rocket.boosterProp, rocket.boostersAttached);
  rocket.mass = mass;

  // --- Forces --------------------------------------------------------------
  thrustWorld.copy(NOSE).applyQuaternion(state.orientation).multiplyScalar(thrust);
  forceWorld.copy(thrustWorld);
  forceWorld.y -= mass * GRAVITY;

  // Drag against the air the rocket is moving through, including wind.
  dragWorld.copy(state.velocity).sub(windVelocity);
  const airspeed = dragWorld.length();
  if (airspeed > 1e-4) {
    const q = 0.5 * AIR_DENSITY * airspeed * airspeed;
    dragWorld.multiplyScalar((-q * c.dragArea * c.dragCoefficient) / airspeed);
    forceWorld.add(dragWorld);
  }

  state.velocity.addScaledVector(forceWorld, dt / mass);
  state.position.addScaledVector(state.velocity, dt);

  // --- Attitude ------------------------------------------------------------
  // Pitch and yaw come from gimballing the engines, so their authority is the
  // thrust itself times a moment arm. No thrust, no steering.
  torque.set(
    controls.pitch * thrust * c.gimbalArm,
    controls.yaw * thrust * c.gimbalArm,
    controls.roll * c.rollAuthority * (lit ? 1 : 0),
  );
  torque.x -= state.angularVelocity.x * c.angularDamping;
  torque.y -= state.angularVelocity.y * c.angularDamping;
  torque.z -= state.angularVelocity.z * c.angularDamping * 0.2;

  // Inertia falls with the propellant, exactly as mass does — a spent stack
  // is far quicker to rotate than a full one.
  const loaded = totalMass(c, c.coreProp, c.boosterProp, true);
  const inertiaScale = Math.max(0.12, mass / loaded);
  state.angularVelocity.x += (torque.x / (c.inertia.x * inertiaScale)) * dt;
  state.angularVelocity.y += (torque.y / (c.inertia.y * inertiaScale)) * dt;
  state.angularVelocity.z += (torque.z / (c.inertia.z * inertiaScale)) * dt;

  spinQuat.set(
    state.angularVelocity.x,
    state.angularVelocity.y,
    state.angularVelocity.z,
    0,
  );
  derivative.copy(spinQuat).multiply(state.orientation);
  state.orientation.x += 0.5 * derivative.x * dt;
  state.orientation.y += 0.5 * derivative.y * dt;
  state.orientation.z += 0.5 * derivative.z * dt;
  state.orientation.w += 0.5 * derivative.w * dt;
  state.orientation.normalize();

  state.time += dt;

  // Throttle is published through the rotor arrays, as the jet does, so the
  // plumes and the RPM-linked audio need no rocket-specific plumbing.
  const level = thrust / (c.coreThrust + c.boosterCount * c.boosterThrust);
  state.motorOmega.fill(level * 950);
  state.motorThrust.fill(thrust / state.motorThrust.length);

  // --- Ground --------------------------------------------------------------
  const groundY = groundHeightAt(state.position.x, state.position.z) + groundClearance;
  contact.grounded = state.position.y <= groundY;
  contact.sinkSpeed = 0;
  contact.groundSpeed = Math.hypot(state.velocity.x, state.velocity.z);

  if (contact.grounded) {
    contact.sinkSpeed = Math.max(0, -state.velocity.y);
    state.position.y = groundY;
    if (state.velocity.y < 0) state.velocity.y = 0;

    // Held on the pad: friction against sliding, and the stack does not topple
    // while it is still sitting on its own tail.
    state.velocity.x *= 0.9;
    state.velocity.z *= 0.9;
    state.angularVelocity.multiplyScalar(0.85);
  }

  return contact;
}

/** Fraction of the original propellant load still aboard, 0..1. */
export function propellantFraction(
  rocket: RocketState,
  config: RocketConfig = ROCKET,
): number {
  const aboard =
    rocket.coreProp +
    (rocket.boostersAttached ? config.boosterCount * rocket.boosterProp : 0);
  const full = config.coreProp + config.boosterCount * config.boosterProp;
  return Math.max(0, Math.min(1, aboard / full));
}

/** Thrust-to-weight ratio right now — 1.0 is exactly hovering. */
export function thrustToWeight(rocket: RocketState): number {
  return rocket.mass > 0 ? rocket.thrust / (rocket.mass * GRAVITY) : 0;
}
