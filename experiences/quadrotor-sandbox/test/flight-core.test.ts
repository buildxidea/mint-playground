import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRAVITY } from "../src/core/basis";
import {
  GAIN_PRESETS,
  HOVER_THRUST,
  LIMITS,
  MAX_ROTOR_THRUST,
  VEHICLE,
} from "../src/sim/config";
import { mix, thrustToOmega } from "../src/sim/mixer";
import { Pid } from "../src/sim/pid";
import { Wind } from "../src/sim/wind";
import { HZ, countSignChanges, fly, hashState } from "./harness";

describe("mixer", () => {
  it("splits a pure collective demand evenly", () => {
    const { thrusts, saturated } = mix({
      thrust: HOVER_THRUST,
      pitch: 0,
      yaw: 0,
      roll: 0,
    });
    for (const f of thrusts) {
      assert.ok(Math.abs(f - HOVER_THRUST / 4) < 1e-9, `expected even split, got ${f}`);
    }
    assert.equal(saturated, false);
  });

  it("produces nose-up pitch by favouring the front rotors", () => {
    const { thrusts } = mix({ thrust: HOVER_THRUST, pitch: 0.3, yaw: 0, roll: 0 });
    const front = thrusts[0] + thrusts[3];
    const rear = thrusts[1] + thrusts[2];
    assert.ok(front > rear, "front rotors should work harder for nose-up");
  });

  it("reproduces the demanded torques exactly when unsaturated", () => {
    const demand = { thrust: HOVER_THRUST, pitch: 0.25, yaw: 0.05, roll: -0.18 };
    const { thrusts } = mix(demand);

    // Recompute the torques the way the integrator does.
    let tx = 0;
    let ty = 0;
    let tz = 0;
    for (let i = 0; i < 4; i += 1) {
      const m = VEHICLE.motors[i];
      tx += -m.z * thrusts[i];
      tz += m.x * thrusts[i];
      ty += -m.spin * (VEHICLE.km / VEHICLE.kf) * thrusts[i];
    }

    assert.ok(Math.abs(tx - demand.pitch) < 1e-9, `pitch ${tx} vs ${demand.pitch}`);
    assert.ok(Math.abs(ty - demand.yaw) < 1e-9, `yaw ${ty} vs ${demand.yaw}`);
    assert.ok(Math.abs(tz - demand.roll) < 1e-9, `roll ${tz} vs ${demand.roll}`);
  });

  it("sacrifices collective before attitude when saturated", () => {
    // Ask for full thrust *and* a large roll torque; they cannot both fit.
    const demand = {
      thrust: 4 * MAX_ROTOR_THRUST,
      pitch: 0,
      yaw: 0,
      roll: LIMITS.maxTorque.roll,
    };
    const { thrusts, saturated } = mix(demand);

    assert.equal(saturated, true);

    let tz = 0;
    for (let i = 0; i < 4; i += 1) tz += VEHICLE.motors[i].x * thrusts[i];

    // The roll torque survives essentially intact...
    assert.ok(
      Math.abs(tz - demand.roll) < 1e-6,
      `roll authority should be preserved, got ${tz} of ${demand.roll}`,
    );
    // ...at the cost of total thrust.
    const total = thrusts.reduce((a, b) => a + b, 0);
    assert.ok(total < demand.thrust, "collective should have been reduced");
  });

  it("keeps every rotor inside its physical range", () => {
    const { thrusts } = mix({ thrust: 1e6, pitch: 50, yaw: 50, roll: -50 });
    for (const f of thrusts) {
      assert.ok(f >= 0 && f <= MAX_ROTOR_THRUST + 1e-9, `rotor out of range: ${f}`);
    }
  });

  it("inverts the thrust curve consistently", () => {
    const omega = thrustToOmega(5);
    assert.ok(Math.abs(VEHICLE.kf * omega * omega - 5) < 1e-9);
    assert.equal(thrustToOmega(-1), 0);
  });
});

describe("pid", () => {
  it("clamps the integral accumulator", () => {
    const pid = new Pid({ kp: 0, ki: 10, kd: 0 }, { integralLimit: 1 });
    for (let i = 0; i < 1000; i += 1) pid.update(1, 0, 0.005);
    assert.ok(Math.abs(pid.integralTerm) <= 1 + 1e-9, `integral ran to ${pid.integralTerm}`);
  });

  it("does not wind up while the output is saturated", () => {
    const pid = new Pid({ kp: 1, ki: 5, kd: 0 }, { outputLimit: 1 });
    // Demand far beyond the output limit for a long time.
    for (let i = 0; i < 400; i += 1) pid.update(100, 0, 0.005);
    const wound = pid.integralTerm;

    // On reversal the loop must respond promptly, not spend seconds unwinding.
    const output = pid.update(-100, 0, 0.005);
    assert.ok(output < 0, `expected immediate reversal, got ${output} (integral ${wound})`);
  });

  it("does not kick on a setpoint step", () => {
    const pid = new Pid({ kp: 0, ki: 0, kd: 1 }, {});
    pid.update(0, 0, 0.005);
    // Derivative is taken on the measurement, so a setpoint jump is invisible.
    const output = pid.update(1000, 0, 0.005);
    assert.equal(output, 0);
  });

  it("damps a moving measurement", () => {
    const pid = new Pid({ kp: 0, ki: 0, kd: 1 }, {});
    pid.update(0, 0, 0.005);
    const output = pid.update(0, 1, 0.005);
    assert.ok(output < 0, "derivative term should oppose the motion");
  });
});

describe("wind", () => {
  it("is reproducible for a given seed", () => {
    const a = new Wind(1234);
    const b = new Wind(1234);
    a.speed = b.speed = 6;
    a.gustiness = b.gustiness = 0.8;

    for (let i = 0; i < 500; i += 1) {
      a.step(0.005);
      b.step(0.005);
    }
    assert.deepEqual(a.velocity().toArray(), b.velocity().toArray());
  });

  it("differs between seeds", () => {
    const a = new Wind(1);
    const b = new Wind(2);
    a.gustiness = b.gustiness = 1;
    for (let i = 0; i < 500; i += 1) {
      a.step(0.005);
      b.step(0.005);
    }
    assert.notDeepEqual(a.velocity().toArray(), b.velocity().toArray());
  });

  it("blows toward the commanded heading", () => {
    const wind = new Wind(7);
    wind.speed = 10;
    wind.gustiness = 0;
    wind.heading = 0; // toward -Z
    const v = wind.velocity();
    assert.ok(v.z < -9, `expected flow toward -Z, got ${v.z}`);
  });
});

describe("closed-loop flight", () => {
  it("holds altitude in position mode", () => {
    const start = 2;
    const { state } = fly(10, { altitude: start });
    const drift = Math.abs(state.position.y - start);
    assert.ok(drift < 0.15, `altitude drifted ${drift.toFixed(3)} m over 10 s`);
  });

  it("holds position against a steady crosswind", () => {
    const { state } = fly(15, {
      altitude: 3,
      windSpeed: 7,
      gustiness: 0,
      windSeed: 99,
    });
    const drift = Math.hypot(state.position.x, state.position.z);
    assert.ok(drift < 1.5, `blown ${drift.toFixed(2)} m off station`);
    assert.ok(state.position.y > 2.5, "should not have lost altitude fighting the wind");
  });

  it("returns to its hold point after a displacement", () => {
    const { state } = fly(12, {
      altitude: 3,
      pilot: (t) =>
        // Push hard for a second, then let go and let position hold recover.
        t < 1
          ? { roll: 1, pitch: 0, yaw: 0, throttle: 0.5 }
          : { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 },
    });
    // The hold anchor re-seats where the stick was released, so what matters is
    // that it settles rather than drifting on.
    assert.ok(
      state.velocity.length() < 0.4,
      `still moving at ${state.velocity.length().toFixed(2)} m/s`,
    );
  });

  it("climbs on throttle and settles at the new altitude", () => {
    const { state } = fly(12, {
      altitude: 2,
      pilot: (t) =>
        t < 3
          ? { roll: 0, pitch: 0, yaw: 0, throttle: 1 }
          : { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 },
    });
    assert.ok(state.position.y > 5, `expected a climb, ended at ${state.position.y.toFixed(2)} m`);
    assert.ok(Math.abs(state.velocity.y) < 0.3, "should have settled into a hover");
  });

  it("hovers at roughly the thrust the vehicle config predicts", () => {
    const { state } = fly(6, { altitude: 3 });
    const total = Array.from(state.motorThrust).reduce((a, b) => a + b, 0);
    const expected = VEHICLE.mass * GRAVITY;
    assert.ok(
      Math.abs(total - expected) / expected < 0.05,
      `hover thrust ${total.toFixed(2)} N vs predicted ${expected.toFixed(2)} N`,
    );
  });

  it("rings on the detuned preset and settles on the stable one", () => {
    // Excite with a stick step and watch the transient. Steady state is a poor
    // probe here: a constant tilt means a constant attitude, so the body rate
    // is zero at equilibrium no matter how badly the loop is tuned. The step
    // response is also exactly the gesture a pilot makes to judge a tune.
    //
    // Settling time rather than a raw reversal count: a correctly-tuned but
    // heavier, more lightly-damped airframe (the 10-inch class this sandbox
    // now flies) can take several cycles to decay to nothing even when it is
    // genuinely converging, so counting reversals inside a fixed window
    // conflates "rings for a while, then stops" with "never stops" once the
    // vehicle class changes. How long the rate stays above a small threshold
    // does not have that problem: it is near-zero once "stable" is finished
    // and pinned at the window length while "detuned" is still going.
    const WINDOW = 6;
    const THRESHOLD = 0.1;

    const sample = (preset: "stable" | "detuned") => {
      const rates: number[] = [];
      fly(WINDOW + 1, {
        preset,
        mode: "stabilized",
        altitude: 5,
        pilot: (t) => ({
          roll: 0,
          pitch: t > 1 ? 0.4 : 0,
          yaw: 0,
          throttle: 0.5,
        }),
        observe: (state, time) => {
          if (time > 1) rates.push(state.angularVelocity.x);
        },
      });

      let settle = 0;
      for (let i = rates.length - 1; i >= 0; i -= 1) {
        if (Math.abs(rates[i]) >= THRESHOLD) {
          settle = (i + 1) / HZ;
          break;
        }
      }

      return { settle, peak: Math.max(...rates.map(Math.abs)) };
    };

    const stable = sample("stable");
    const detuned = sample("detuned");

    assert.ok(
      stable.settle < WINDOW * 0.7,
      `stable preset should settle with margin inside the window, took ${stable.settle.toFixed(2)}s of ${WINDOW}s`,
    );
    assert.ok(
      detuned.settle > stable.settle * 1.5,
      `detuned should take far longer to settle (stable ${stable.settle.toFixed(2)}s, detuned ${detuned.settle.toFixed(2)}s)`,
    );
    assert.ok(
      detuned.peak > stable.peak * 2,
      `detuned should overshoot harder (stable ${stable.peak.toFixed(2)}, detuned ${detuned.peak.toFixed(2)})`,
    );
    // Still bounded — a preset that simply tumbles teaches nothing.
    assert.ok(detuned.peak < 12, `detuned should stay flyable, peaked at ${detuned.peak}`);
  });
});

describe("cascade stability", () => {
  it("keeps the rate loop faster than the attitude loop that drives it", () => {
    // The structural guard. A rate loop's closed-loop bandwidth is kp/I;
    // torque authority does not enter into it. Scaling P by anything less
    // than the inertia ratio leaves the inner loop slower than the outer one
    // commanding it, which is what made this airframe fly wobbly: measured at
    // 3.4 rad/s inner against 8 rad/s outer.
    for (const id of ["stable", "sport"] as const) {
      const gains = GAIN_PRESETS[id];
      const bandwidth = gains.rate.roll.kp / VEHICLE.inertia.x;
      const ratio = bandwidth / gains.attitudeKp;
      assert.ok(
        ratio >= 1.5,
        `${id}: rate loop ${bandwidth.toFixed(1)} rad/s vs attitude ${gains.attitudeKp} ` +
          `= ${ratio.toFixed(2)}x separation — the inner loop must lead the outer one`,
      );
    }
  });

  it("flies a box without ringing or overshooting the tilt limit", () => {
    // The behavioural guard, in the scenario the wobble was actually reported
    // in: a pilot rolling and pitching around, not a hover (undisturbed hover
    // sits at an exact equilibrium and looks perfect however bad the tune is,
    // which is why this went unnoticed).
    const rates: number[] = [];
    const tilts: number[] = [];
    fly(12, {
      preset: "stable",
      altitude: 8,
      gustiness: 0.25,
      windSeed: 4242,
      pilot: (t) => ({
        roll: t > 1 && t < 2.5 ? 0.6 : t > 6 && t < 7.5 ? -0.6 : 0,
        pitch: t > 3.5 && t < 5 ? 0.5 : 0,
        yaw: 0,
        throttle: 0.5,
      }),
      observe: (state, time) => {
        if (time <= 1) return;
        rates.push(state.angularVelocity.x);
        const cos = 1 - 2 * (state.orientation.x ** 2 + state.orientation.z ** 2);
        tilts.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
      },
    });

    const reversals = countSignChanges(rates, 0.05);
    const peakTilt = Math.max(...tilts);
    const commandedTilt = (LIMITS.maxTilt * 180) / Math.PI;

    assert.ok(reversals <= 6, `rate reversed ${reversals} times — it is ringing`);
    assert.ok(
      peakTilt < commandedTilt * 1.25,
      `tilt peaked at ${peakTilt.toFixed(0)}° against a ${commandedTilt.toFixed(0)}° command`,
    );
  });
});

describe("determinism", () => {
  it("reproduces a flight exactly from the same inputs and seed", () => {
    const pilot = (t: number) => ({
      roll: Math.sin(t * 1.7) * 0.6,
      pitch: Math.cos(t * 1.1) * 0.5,
      yaw: Math.sin(t * 0.4) * 0.3,
      throttle: 0.5 + Math.sin(t * 0.9) * 0.2,
    });
    const options = {
      altitude: 4,
      windSpeed: 5,
      gustiness: 0.7,
      windSeed: 4242,
      pilot,
    };

    const a = fly(5, options);
    const b = fly(5, options);
    assert.equal(hashState(a.state), hashState(b.state));
  });
});
