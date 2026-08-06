import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Box3, Group, Vector3 } from "three";
import {
  BOMBER,
  JET,
  PLANE,
  stepAirplane,
  type PlaneConfig,
  type PlaneControls,
} from "../src/sim/airplane";
import { createAfterburners } from "../src/fx/afterburner";
import { createPhysics } from "../src/sim/physics";
import { createState, type DroneState } from "../src/sim/state";
import { CITY_RUNWAY, CITY_RUNWAY_SPAWN } from "../src/world/city";
import { hashState } from "./harness";

const DT = 1 / 200;
const GEAR = 0.12;
const STILL = new Vector3();

const NEUTRAL: PlaneControls = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

interface FlightOptions {
  position?: [number, number, number];
  /** Initial forward speed along -Z, m/s. */
  speed?: number;
  controls?: (t: number, state: DroneState) => PlaneControls;
  observe?: (state: DroneState, t: number) => void;
}

/**
 * Run the real airplane integrator for `seconds`, mirroring the app loop.
 * Ground is the flat city floor, exactly as in the app.
 */
function flyPlane(seconds: number, options: FlightOptions = {}) {
  const state = createState();
  state.armed = true;
  const [x, y, z] = options.position ?? [0, 60, 0];
  state.position.set(x, y, z);
  state.velocity.set(0, 0, -(options.speed ?? 0));

  const steps = Math.round(seconds / DT);
  // Impact metrics accumulate across the run: by the final step a crashed
  // plane is just rolling on the ground, so "last contact" alone hides the
  // arrival that mattered.
  let everGrounded = false;
  let worstSink = 0;
  for (let i = 0; i < steps; i += 1) {
    const t = i * DT;
    const controls = options.controls ? options.controls(t, state) : NEUTRAL;
    const contact = stepAirplane(state, controls, STILL, GEAR, DT);
    if (contact.grounded) {
      everGrounded = true;
      worstSink = Math.max(worstSink, contact.sinkSpeed);
    }
    options.observe?.(state, t + DT);
  }
  return { state, everGrounded, worstSink };
}

/**
 * Level-flight top speed: hold the aircraft wings-level and nose-level each
 * step so the only forces along the flight path are thrust and drag.
 *
 * Flying it free instead does *not* measure top speed — with no elevator
 * input a statically stable airframe trims nose-up, zoom-climbs and stalls,
 * which reads as a very low "top speed" that says nothing about the engine.
 */
function levelTopSpeed(config: PlaneConfig, startSpeed: number): number {
  const state = createState();
  state.armed = true;
  state.position.set(0, 400, 0);
  state.velocity.set(0, 0, -startSpeed);

  for (let i = 0; i < 200 * 90; i += 1) {
    stepAirplane(state, { roll: 0, pitch: 0, yaw: 0, throttle: 1 }, STILL, 0.2, DT, {
      config,
    });
    state.orientation.set(0, 0, 0, 1);
    state.angularVelocity.set(0, 0, 0);
    state.velocity.y = 0;
    state.position.y = 400;
  }
  return Math.hypot(state.velocity.x, state.velocity.z);
}

describe("supersonic jet", () => {
  it("flies far faster than the bush plane", () => {
    const plane = levelTopSpeed(PLANE, 10);
    const jet = levelTopSpeed(JET, 30);

    assert.ok(
      jet > plane * 3,
      `the jet should be far faster: ${jet.toFixed(1)} m/s vs the plane's ${plane.toFixed(1)}`,
    );
    // And genuinely fast in absolute terms, not just relatively.
    assert.ok(jet > 60, `expected a jet-class top speed, got ${jet.toFixed(1)} m/s`);
  });

  it("holds thrust at speed where a propeller would not", () => {
    // The propeller's thrust fades to nothing by 40 m/s; the jet's carries to
    // 220. This is the single change that makes the speed difference, so it
    // is asserted rather than left implicit in the numbers.
    assert.ok(JET.thrustFadeSpeed > PLANE.thrustFadeSpeed * 4);
    assert.ok(JET.maxThrust > PLANE.maxThrust * 5);
  });

  it("uses gentler control powers so high dynamic pressure stays flyable", () => {
    // Dynamic pressure goes with speed squared: at 60 m/s the jet sees ~25x
    // the bush plane's q. Reusing the plane's control coefficients would make
    // full stick an unflyable snap, so they must be markedly smaller.
    assert.ok(JET.cmElevator < PLANE.cmElevator * 0.3);
    assert.ok(JET.clAileron < PLANE.clAileron * 0.3);
  });

  it("is still a wing — it sinks when slow with no power", () => {
    const state = createState();
    state.armed = true;
    state.position.set(0, 400, 0);
    state.velocity.set(0, 0, -12);
    for (let i = 0; i < 200 * 8; i += 1) {
      stepAirplane(state, { roll: 0, pitch: 1, yaw: 0, throttle: 0 }, STILL, 0.2, DT, {
        config: JET,
      });
    }
    assert.ok(
      state.position.y < 395,
      `a wing at 12 m/s with no power must sink, ended at ${state.position.y.toFixed(0)} m`,
    );
  });
});

describe("afterburners", () => {
  const spool = (state: DroneState, fraction: number) => {
    // The multirotor config's max rotor speed is what the plume scales
    // against, matching the runtime.
    state.motorOmega.fill(fraction * 950);
  };

  it("stays dark at idle and lights up with the throttle", () => {
    const parent = new Group();
    const burners = createAfterburners(parent, [new Vector3(0.3, 0, 1)]);
    const state = createState();

    spool(state, 0);
    burners.update(state, 1 / 60);
    const cold = parent.getObjectByProperty("type", "Mesh") as never as {
      material: { opacity: number };
      scale: { z: number };
    };
    assert.equal(cold.material.opacity, 0, "burner should be out at idle");

    spool(state, 1);
    burners.update(state, 1 / 60);
    assert.ok(cold.material.opacity > 0.2, "burner should be lit at full throttle");
    assert.ok(cold.scale.z > 1, `plume should extend, scaled ${cold.scale.z}`);

    burners.dispose();
  });

  it("fires aft, not through the nose", () => {
    // Direction is invisible to a scale/opacity check — the plume looks
    // identical either way until you see where it points. This shipped
    // backwards once: the cone's quarter-turn sent it toward -Z, which is
    // forward, so the flames came out of the nose.
    const parent = new Group();
    const burners = createAfterburners(parent, [new Vector3(0, 0, 1)]);
    const state = createState();
    state.motorOmega.fill(950);
    burners.update(state, 1 / 60);

    const bounds = new Box3().setFromObject(parent);
    assert.ok(
      bounds.max.z > 1.2,
      `plume should extend aft past the nozzle at z=1, reached ${bounds.max.z.toFixed(2)}`,
    );
    assert.ok(
      bounds.min.z > 0.5,
      `nothing should extend forward of the nozzle, min z was ${bounds.min.z.toFixed(2)}`,
    );

    burners.dispose();
  });

  it("flickers over time without the throttle moving", () => {
    const parent = new Group();
    const burners = createAfterburners(parent, [new Vector3(0, 0, 1)]);
    const state = createState();
    spool(state, 1);

    const lengths: number[] = [];
    const plume = parent.getObjectByProperty("type", "Mesh") as never as {
      scale: { z: number };
    };
    for (let i = 0; i < 40; i += 1) {
      burners.update(state, 1 / 60);
      lengths.push(plume.scale.z);
    }

    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    assert.ok(max - min > 0.01, "plume length should visibly flicker, not sit still");

    burners.dispose();
  });

  it("is deterministic, so a replayed flight looks identical", () => {
    const run = () => {
      const parent = new Group();
      const burners = createAfterburners(parent, [new Vector3(0, 0, 1)]);
      const state = createState();
      state.motorOmega.fill(700);
      const plume = parent.getObjectByProperty("type", "Mesh") as never as {
        scale: { z: number };
      };
      const samples: number[] = [];
      for (let i = 0; i < 30; i += 1) {
        burners.update(state, 1 / 60);
        samples.push(plume.scale.z);
      }
      burners.dispose();
      return samples.join(",");
    };
    assert.equal(run(), run());
  });
});

describe("concurrent physics worlds", () => {
  it("keeps handles separate when two worlds are created via Promise.all", async () => {
    // Regression for the black-screen bug: a boolean init guard let two
    // concurrent createPhysics calls run RAPIER.init() twice, re-instantiating
    // the WASM module mid-construction. The symptom was cross-wired handles —
    // one world's aircraft body resolving to the other world's scenery — and
    // a "recursive use of an object" throw on the first pushKinematic of
    // every frame. The app now keeps a single world, but the init guard must
    // stay concurrency-safe; this pins it.
    const [a, b] = await Promise.all([
      createPhysics(
        [
          {
            kind: "container",
            object: {} as never,
            centre: new Vector3(13, 1.3, 8),
            halfExtents: [1.45, 1.3, 3.03],
            rotation: 0,
            mass: null,
          },
        ],
        0,
      ),
      createPhysics([], 0, {
        aircraftHalfExtents: [0.95, 0.25, 0.7],
        aircraftMass: 2.2,
      }),
    ]);

    for (const [label, world] of [
      ["first", a],
      ["second", b],
    ] as const) {
      const t = world.droneBody.translation();
      assert.ok(
        Math.hypot(t.x, t.z) < 0.1,
        `${label} aircraft body is at (${t.x.toFixed(1)}, ${t.z.toFixed(1)}) — ` +
          `handles are cross-wired with the other world`,
      );
    }

    const state = createState();
    for (let i = 0; i < 5; i += 1) {
      a.pushKinematic(state);
      a.step(1 / 200);
      b.pushKinematic(state);
      b.step(1 / 200);
    }

    a.dispose();
    b.dispose();
  });

  it("swaps the aircraft collision box in place without breaking the world", async () => {
    // The vehicle switch uses one shared world and swaps the aircraft's
    // collider; the swap must leave stepping and ray queries working.
    const physics = await createPhysics([], 0);
    const state = createState();

    physics.pushKinematic(state);
    physics.step(1 / 200);

    physics.setAircraftShape([0.95, 0.25, 0.7], 2.2);
    for (let i = 0; i < 5; i += 1) {
      physics.pushKinematic(state);
      physics.step(1 / 200);
    }

    const hit = physics.castDown(new Vector3(0, 10, 0), 100);
    assert.ok(hit !== null && Math.abs(10 - hit) < 0.1, "ground query broke after the swap");

    physics.setAircraftShape([0.3, 0.12, 0.29], 2.4);
    physics.pushKinematic(state);
    physics.step(1 / 200);

    physics.dispose();
  });
});

describe("airplane flight model", () => {
  it("glides when the power is off instead of tumbling", () => {
    let maxTiltDeg = 0;
    const { state } = flyPlane(5, {
      position: [0, 80, 0],
      speed: 13,
      observe: (s) => {
        const cosTilt = 1 - 2 * (s.orientation.x ** 2 + s.orientation.z ** 2);
        maxTiltDeg = Math.max(
          maxTiltDeg,
          (Math.acos(Math.max(-1, Math.min(1, cosTilt))) * 180) / Math.PI,
        );
      },
    });

    const forwardSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    assert.ok(forwardSpeed > 7, `should keep flying speed, has ${forwardSpeed.toFixed(1)} m/s`);
    assert.ok(maxTiltDeg < 45, `should stay upright gliding, tilted ${maxTiltDeg.toFixed(0)}°`);
    assert.ok(state.velocity.y > -8, `sink rate ${(-state.velocity.y).toFixed(1)} m/s is a plummet`);
    assert.ok(state.position.y < 80, "with no power it must descend");
  });

  it("climbs under full throttle", () => {
    const { state } = flyPlane(6, {
      position: [0, 60, 0],
      speed: 13,
      controls: () => ({ roll: 0, pitch: 0.1, yaw: 0, throttle: 1 }),
    });
    assert.ok(
      state.position.y > 65,
      `full power should climb, went from 60 m to ${state.position.y.toFixed(1)} m`,
    );
  });

  it("cannot hold altitude below flying speed, whatever the elevator", () => {
    // A statically stable airframe recovers from a stall by dropping its nose
    // and mushing — it does not fall out of the sky, and a test expecting a
    // plummet fails against correct physics (measured: it porpoises between
    // ~110 m and its 120 m start). What a stalled wing genuinely cannot do is
    // hold or gain height with no power at 4 m/s, so that is what's asserted.
    let minY = Infinity;
    let maxY = 0;
    const { state } = flyPlane(4, {
      position: [0, 120, 0],
      speed: 4,
      controls: () => ({ roll: 0, pitch: 1, yaw: 0, throttle: 0 }),
      observe: (s) => {
        minY = Math.min(minY, s.position.y);
        maxY = Math.max(maxY, s.position.y);
      },
    });
    assert.ok(maxY < 121, `no free energy: zoomed to ${maxY.toFixed(1)} m from 120 m`);
    assert.ok(minY < 112, `should sink through the mush, only reached ${minY.toFixed(1)} m`);
    assert.ok(
      state.position.y < 116,
      `must end below its starting height, at ${state.position.y.toFixed(1)} m`,
    );
  });

  it("banks right under right aileron and turns that way", () => {
    const headings: number[] = [];
    flyPlane(4, {
      position: [0, 100, 0],
      speed: 14,
      controls: (t) => ({
        roll: t < 0.8 ? 0.5 : 0,
        pitch: 0.15,
        yaw: 0,
        throttle: 0.7,
      }),
      observe: (s) => {
        const nose = new Vector3(0, 0, -1).applyQuaternion(s.orientation);
        headings.push(Math.atan2(nose.x, -nose.z));
      },
    });

    // Started flying toward -Z (heading 0); a right bank must swing the nose
    // toward +X (positive heading).
    const finalHeading = headings[headings.length - 1];
    assert.ok(
      finalHeading > 0.15,
      `right aileron should turn right, heading moved to ${finalHeading.toFixed(2)} rad`,
    );
  });

  it("takes off from the city airstrip under its own power", () => {
    const { state } = flyPlane(14, {
      position: [CITY_RUNWAY_SPAWN.x, CITY_RUNWAY.height + GEAR, CITY_RUNWAY_SPAWN.z],
      speed: 0,
      controls: (t, s) => ({
        roll: 0,
        // Rotate once there is flying speed, then ease off to a climb.
        pitch: Math.hypot(s.velocity.x, s.velocity.z) > 9 ? 0.45 : 0,
        yaw: 0,
        throttle: 1,
      }),
    });

    assert.ok(
      state.position.y > CITY_RUNWAY.height + 8,
      `should be airborne after the roll, at ${state.position.y.toFixed(1)} m`,
    );
    // Rolling straight down the strip: no reason to have wandered far off the
    // runway heading during the climb-out.
    assert.ok(
      Math.abs(state.position.x - CITY_RUNWAY_SPAWN.x) < 120,
      `drifted to x=${state.position.x.toFixed(0)} during takeoff`,
    );
  });

  it("reports a hard arrival to the crash policy", () => {
    const { everGrounded, worstSink } = flyPlane(3, {
      position: [0, 25, -60],
      speed: 10,
      // Shove the nose down and keep it there.
      controls: () => ({ roll: 0, pitch: -1, yaw: 0, throttle: 0.6 }),
    });
    assert.ok(everGrounded, "diving at the ground must reach it");
    assert.ok(
      worstSink > 3,
      `a dive should register a hard sink at impact, got ${worstSink.toFixed(1)} m/s`,
    );
  });

  it("is deterministic", () => {
    const controls = (t: number): PlaneControls => ({
      roll: Math.sin(t * 1.3) * 0.4,
      pitch: Math.cos(t * 0.7) * 0.3,
      yaw: Math.sin(t * 0.5) * 0.2,
      throttle: 0.6 + Math.sin(t) * 0.3,
    });
    const a = flyPlane(5, { position: [0, 90, 0], speed: 13, controls });
    const b = flyPlane(5, { position: [0, 90, 0], speed: 13, controls });
    assert.equal(hashState(a.state), hashState(b.state));
  });
});

describe("stealth flying wing", () => {
  /** Peak roll rate reached under full aileron, deg/s. */
  function peakRollRate(config: PlaneConfig, speed: number): number {
    const state = createState();
    state.armed = true;
    state.position.set(0, 2000, 0);
    state.velocity.set(0, 0, -speed);
    let peak = 0;
    for (let i = 0; i < 200 * 3; i += 1) {
      stepAirplane(state, { roll: 1, pitch: 0, yaw: 0, throttle: 0.6 }, STILL, 0.2, DT, {
        config,
      });
      peak = Math.max(peak, Math.abs(state.angularVelocity.z));
    }
    return (peak * 180) / Math.PI;
  }

  it("flies between the bush plane and the jet", () => {
    // It is a subsonic bomber, so it should be neither. Measured rather than
    // asserted from the thrust numbers, because thrust alone says nothing —
    // the jet's original config had ample thrust and still could not use it.
    const plane = levelTopSpeed(PLANE, 10);
    const jet = levelTopSpeed(JET, 30);
    const wing = levelTopSpeed(BOMBER, 25);

    assert.ok(
      wing > plane * 2 && wing < jet * 0.85,
      `expected a subsonic bomber between ${plane.toFixed(0)} and ${jet.toFixed(0)} m/s, got ${wing.toFixed(1)}`,
    );
  });

  it("rolls more reluctantly than either of the others", () => {
    // The signature of a flying wing: mass spread out along the span means a
    // lot of roll inertia. If this ever inverts, the inertia tensor has been
    // copied from a fuselage aircraft.
    const wing = peakRollRate(BOMBER, 45);
    const jet = peakRollRate(JET, 65);
    const plane = peakRollRate(PLANE, 14);

    assert.ok(
      wing < jet && jet < plane,
      `expected wing < jet < plane roll authority, got ${wing.toFixed(0)} / ${jet.toFixed(0)} / ${plane.toFixed(0)} deg/s`,
    );
  });

  it("has almost no weathervane stiffness, because it has no fin", () => {
    assert.ok(
      Math.abs(BOMBER.cnBeta) < Math.abs(JET.cnBeta) * 0.4,
      "a tailless aircraft must not point itself into the airflow like a finned one",
    );
    // What keeps it flyable instead is damping, standing in for the real
    // aircraft's yaw damper. Without this the trade is a wandering aircraft.
    assert.ok(
      Math.abs(BOMBER.cnR) > Math.abs(JET.cnR) * 1.5,
      "the missing fin has to be paid for in yaw damping",
    );
  });

  it("still flies straight hands-off despite the missing fin", () => {
    // The point of the test above is a trade, and this is the half that could
    // have gone wrong: weak directional stiffness is only acceptable if the
    // aircraft does not slowly diverge in yaw or roll while left alone.
    const state = createState();
    state.armed = true;
    state.position.set(0, 2000, 0);
    state.velocity.set(0, 0, -42);

    for (let i = 0; i < 200 * 40; i += 1) {
      stepAirplane(state, { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 }, STILL, 0.2, DT, {
        config: BOMBER,
      });
    }

    const drift = Math.abs(state.velocity.x);
    assert.ok(
      drift < 1,
      `should still be tracking straight after 40 s, drifted sideways at ${drift.toFixed(2)} m/s`,
    );
    assert.ok(
      Math.abs(state.angularVelocity.y) < 0.05,
      "yaw rate should have damped out, not built up",
    );
  });

  it("can be flown down at a landable sink rate on throttle alone", () => {
    // A heavy aircraft on approach controls its descent with power, and this
    // is what makes the landing grades reachable in it: there has to be a
    // throttle setting that produces a survivable arrival.
    const sinkAt = (throttle: number) => {
      const state = createState();
      state.armed = true;
      state.position.set(0, 300, 0);
      state.velocity.set(0, 0, -42);
      for (let i = 0; i < 200 * 60; i += 1) {
        stepAirplane(state, { roll: 0, pitch: 0, yaw: 0, throttle }, STILL, 0.1, DT, {
          config: BOMBER,
        });
      }
      return -state.velocity.y;
    };

    assert.ok(sinkAt(0.35) < 1, `part throttle should give a gentle descent, got ${sinkAt(0.35).toFixed(2)} m/s`);
    assert.ok(sinkAt(0.2) > 2.5, "and closing the throttle should still be able to break it");
  });
});
