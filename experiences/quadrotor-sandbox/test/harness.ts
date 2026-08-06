import { Vector3 } from "three";
import { FlightController, type Sticks } from "../src/sim/controller";
import { mix } from "../src/sim/mixer";
import { applyFlatGround, stepDynamics } from "../src/sim/quadrotor";
import { createState, type DroneState, type FlightMode } from "../src/sim/state";
import { Wind } from "../src/sim/wind";
import type { GainPresetId, GainSet } from "../src/sim/config";

export const HZ = 200;
export const DT = 1 / HZ;

export interface SimOptions {
  preset?: GainPresetId;
  /** Explicit gain set, overriding `preset`. Used for tuning sweeps. */
  gains?: GainSet;
  mode?: FlightMode;
  /** Starting altitude, metres. */
  altitude?: number;
  /**
   * Altitude to hold from the outset, as arming in position mode requests.
   * Omit to hold the starting altitude.
   */
  takeoffAltitude?: number;
  windSpeed?: number;
  gustiness?: number;
  windSeed?: number;
  /** Called each step to produce stick input; defaults to centred + hover. */
  pilot?: (time: number, state: DroneState) => Sticks;
  /** Called after each committed step, for sampling. */
  observe?: (state: DroneState, time: number) => void;
}

const CENTRED: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 };

/**
 * Run the real closed loop — controller, mixer, integrator and wind — for a
 * fixed number of seconds. This is the same code path the browser runs; only
 * the input and the clock are substituted.
 */
export function fly(seconds: number, options: SimOptions = {}) {
  const state = createState();
  state.mode = options.mode ?? "position";
  state.position.y = options.altitude ?? 2;
  state.armed = true;

  const controller = new FlightController(options.preset ?? "stable");
  if (options.gains) controller.applyGains(options.gains);
  controller.reset(state, options.takeoffAltitude);

  const wind = new Wind(options.windSeed ?? 0x5eed);
  wind.speed = options.windSpeed ?? 0;
  wind.gustiness = options.gustiness ?? 0;

  const still = new Vector3();
  const steps = Math.round(seconds * HZ);

  for (let i = 0; i < steps; i += 1) {
    const time = i * DT;
    const sticks = options.pilot ? options.pilot(time, state) : CENTRED;

    const demand = controller.update(state, sticks, DT);
    const { thrusts } = mix(demand);

    wind.step(DT);
    const air = wind.speed > 0 || wind.gustiness > 0 ? wind.velocity() : still;

    stepDynamics(state, thrusts, air, DT);
    applyFlatGround(state, 0.12);

    options.observe?.(state, time + DT);
  }

  return { state, controller };
}

/** Count sign changes in a sampled signal — a cheap oscillation metric. */
export function countSignChanges(samples: number[], threshold = 0.05) {
  let changes = 0;
  let last = 0;
  for (const value of samples) {
    if (Math.abs(value) < threshold) continue;
    const sign = Math.sign(value);
    if (last !== 0 && sign !== last) changes += 1;
    last = sign;
  }
  return changes;
}

/** Stable fingerprint of a full state, for determinism checks. */
export function hashState(state: DroneState) {
  const parts = [
    state.position.x,
    state.position.y,
    state.position.z,
    state.velocity.x,
    state.velocity.y,
    state.velocity.z,
    state.orientation.x,
    state.orientation.y,
    state.orientation.z,
    state.orientation.w,
    state.angularVelocity.x,
    state.angularVelocity.y,
    state.angularVelocity.z,
    ...Array.from(state.motorOmega),
  ];
  return parts.map((n) => n.toFixed(12)).join("|");
}
