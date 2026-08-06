import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Vector3 } from "three";
import {
  ROCKET,
  STARSHIP,
  createRocketState,
  propellantFraction,
  resetRocketState,
  separateBoosters,
  stepRocket,
  thrustToWeight,
  type RocketControls,
  type RocketState,
} from "../src/sim/rocket";
import { createState, type DroneState } from "../src/sim/state";
import { createEnginePlumes } from "../src/fx/launch";
import { Box3, Group } from "three";
import { hashState } from "./harness";

const DT = 1 / 200;
const STILL = new Vector3();
/** Half the assembled stack length — the body origin's height on the pad. */
const CLEARANCE = 7;

const IDLE: RocketControls = { throttle: 0, pitch: 0, yaw: 0, roll: 0 };
const FULL: RocketControls = { throttle: 1, pitch: 0, yaw: 0, roll: 0 };

/** A stack on the pad, pitched ninety degrees nose-up. */
function onThePad(): { state: DroneState; rocket: RocketState } {
  const state = createState();
  const rocket = createRocketState();
  state.armed = true;
  state.position.set(0, CLEARANCE, 0);
  state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  return { state, rocket };
}

function run(
  state: DroneState,
  rocket: RocketState,
  controls: RocketControls,
  seconds: number,
) {
  for (let i = 0; i < 200 * seconds; i += 1) {
    stepRocket(state, rocket, controls, STILL, CLEARANCE, DT, {});
  }
}

describe("rocket on the pad", () => {
  it("stays put until the engines are lit, whatever the stick says", () => {
    const { state, rocket } = onThePad();
    run(state, rocket, FULL, 5);

    assert.equal(rocket.ignited, false);
    assert.ok(
      Math.abs(state.position.y - CLEARANCE) < 1e-6,
      "an unlit rocket should not move",
    );
    assert.equal(rocket.thrust, 0);
    assert.equal(propellantFraction(rocket), 1, "and should not burn anything");
  });

  it("leaves the pad once lit", () => {
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    run(state, rocket, FULL, 3);

    assert.ok(
      state.position.y > CLEARANCE + 5,
      `should be climbing, was at ${state.position.y.toFixed(1)} m`,
    );
    assert.ok(state.velocity.y > 0);
  });

  it("needs no hold-down: thrust below its own weight simply sits there", () => {
    // There is deliberately no separate hold-down mechanism. The shared ground
    // constraint keeps the stack on the pad, and a rocket that cannot lift its
    // own weight stays put on its own — which is the correct behaviour, not a
    // special case that had to be written.
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    // Boosters removed and the core throttled right back: nowhere near enough.
    separateBoosters(rocket);
    run(state, rocket, { ...IDLE, throttle: 0.15 }, 3);

    assert.ok(thrustToWeight(rocket) < 1, "this should not be enough to fly");
    assert.ok(
      Math.abs(state.position.y - CLEARANCE) < 1e-6,
      "and the stack should still be on the pad",
    );
  });
});

describe("rocket propellant", () => {
  it("gets livelier as it burns, because mass is a variable", () => {
    // The defining difference from every other craft here: same throttle,
    // completely different aircraft a minute apart.
    const { state, rocket } = onThePad();
    rocket.ignited = true;

    run(state, rocket, FULL, 1);
    const early = thrustToWeight(rocket);
    const heavy = rocket.mass;

    run(state, rocket, FULL, 40);
    const late = thrustToWeight(rocket);

    assert.ok(rocket.mass < heavy, "it should have burned mass off");
    assert.ok(
      late > early * 1.5,
      `thrust-to-weight should climb steeply: ${early.toFixed(2)} then ${late.toFixed(2)}`,
    );
  });

  it("ignores the throttle while the solids are lit", () => {
    // Solids have no valve. For the whole first phase most of the acceleration
    // is simply not the pilot's to command.
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    run(state, rocket, IDLE, 2);

    assert.ok(
      rocket.thrust > 0,
      "closing the throttle must not shut down a solid booster",
    );
    // And they are sized to carry the stack on their own, so shutting the core
    // down does not drop it back onto the pad.
    assert.ok(thrustToWeight(rocket) > 1, "the boosters alone should still fly it");
    assert.ok(state.velocity.y > 0, "and it should still be climbing on them");
  });

  it("runs dry and stops pushing", () => {
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    // Long enough to empty both the boosters and the core.
    run(state, rocket, FULL, 170);

    assert.equal(propellantFraction(rocket), 0, "should be out of propellant");
    assert.equal(rocket.thrust, 0);
    assert.equal(thrustToWeight(rocket), 0);
  });

  it("comes back to a full stack on reset", () => {
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    run(state, rocket, FULL, 30);
    separateBoosters(rocket);

    resetRocketState(rocket);

    assert.equal(propellantFraction(rocket), 1);
    assert.equal(rocket.boostersAttached, true);
    assert.equal(rocket.ignited, false, "a reset stack has not been lit");
  });
});

describe("booster separation", () => {
  it("drops mass and thrust when the pilot calls for it", () => {
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    run(state, rocket, FULL, 10);

    const before = { mass: rocket.mass, thrust: rocket.thrust };
    assert.equal(separateBoosters(rocket), true);
    run(state, rocket, FULL, 0.5);

    assert.ok(rocket.mass < before.mass, "the boosters took their mass with them");
    assert.ok(rocket.thrust < before.thrust, "and their thrust");
    assert.ok(rocket.thrust > 0, "but the core keeps burning");
  });

  it("refuses only when there is nothing left to drop", () => {
    const rocket = createRocketState();
    assert.equal(separateBoosters(rocket), true);
    assert.equal(separateBoosters(rocket), false, "nothing to separate twice");
  });

  it("is allowed at any moment, including a bad one", () => {
    // Separating on the pad throws away most of the thrust and strands the
    // stack. That is the pilot's mistake to make; the sim refusing the command
    // until some "correct" moment would be it deciding how to fly the rocket.
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    assert.equal(separateBoosters(rocket), true);
    run(state, rocket, FULL, 4);

    assert.ok(
      Math.abs(state.position.y - CLEARANCE) < 1e-6,
      "core alone cannot lift the stack, and it should be stuck on the pad",
    );
  });
});

describe("rocket steering", () => {
  /** Peak pitch rate reached under full gimbal, deg/s. */
  function peakPitchRate(throttle: number, boosters: boolean): number {
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    state.position.set(0, 400, 0);
    if (!boosters) separateBoosters(rocket);

    let peak = 0;
    for (let i = 0; i < 200 * 6; i += 1) {
      stepRocket(
        state,
        rocket,
        { throttle, pitch: 1, yaw: 0, roll: 0 },
        STILL,
        CLEARANCE,
        DT,
        {},
      );
      peak = Math.max(peak, Math.abs(state.angularVelocity.x));
    }
    return (peak * 180) / Math.PI;
  }

  it("cannot steer at all without thrust", () => {
    // The single most distinctive thing about flying a rocket. There are no
    // control surfaces — the engines gimbal — so shutting them down does not
    // just weaken the controls, it removes them.
    assert.equal(
      peakPitchRate(0, false),
      0,
      "a coasting rocket is an unguided falling object",
    );
  });

  it("steers harder the more thrust it is making", () => {
    const onBoosters = peakPitchRate(1, true);
    const coreOnly = peakPitchRate(1, false);

    assert.ok(onBoosters > 12, `should be flyable on the boosters, got ${onBoosters.toFixed(1)}°/s`);
    assert.ok(
      onBoosters > coreOnly * 2,
      `authority should track thrust: ${onBoosters.toFixed(1)} vs ${coreOnly.toFixed(1)}°/s`,
    );
    assert.ok(coreOnly > 1, "the core alone must still be able to steer");
  });

  it("still rolls with the engines shut down", () => {
    // Roll comes from thrusters, not the gimbal, so unlike pitch and yaw it
    // survives a shutdown. Without this a coasting rocket could not even hold
    // its orientation.
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    state.position.set(0, 400, 0);
    separateBoosters(rocket);

    for (let i = 0; i < 200 * 2; i += 1) {
      stepRocket(state, rocket, { throttle: 0, pitch: 0, yaw: 0, roll: 1 }, STILL, CLEARANCE, DT, {});
    }
    assert.ok(Math.abs(state.angularVelocity.z) > 0.01, "roll thrusters should still work");
  });
});

describe("rocket determinism", () => {
  it("replays identically from the same inputs", () => {
    const fly = () => {
      const { state, rocket } = onThePad();
      rocket.ignited = true;
      for (let i = 0; i < 200 * 20; i += 1) {
        const t = i / 200;
        if (i === 200 * 12) separateBoosters(rocket);
        stepRocket(
          state,
          rocket,
          { throttle: 1, pitch: Math.sin(t) * 0.5, yaw: 0, roll: 0 },
          STILL,
          CLEARANCE,
          DT,
          {},
        );
      }
      return `${hashState(state)}|${rocket.coreProp.toFixed(6)}`;
    };

    assert.equal(fly(), fly());
  });

  it("burns at the rate its config says", () => {
    // Guards the partial-step scaling: the last fraction of a burn must not
    // produce full thrust from propellant that was not there.
    const { state, rocket } = onThePad();
    rocket.ignited = true;
    separateBoosters(rocket);
    run(state, rocket, FULL, 10);

    const expected = ROCKET.coreProp - ROCKET.coreBurnRate * 10;
    assert.ok(
      Math.abs(rocket.coreProp - expected) < 1,
      `expected about ${expected.toFixed(0)} kg left, got ${rocket.coreProp.toFixed(0)}`,
    );
  });
});

describe("launch plumes", () => {
  /** How far aft of the nozzle the drawn flame reaches, metres. */
  function plumeReach(clearance: number, level = 1): number {
    const parent = new Group();
    const plumes = createEnginePlumes(parent, [new Vector3(0, 0, 0)], 1);
    plumes.update(level, 0, clearance);
    parent.updateMatrixWorld(true);
    const box = new Box3().setFromObject(plumes.group);
    const reach = box.max.z;
    plumes.dispose();
    return reach;
  }

  it("does not drive the flame through the ground at ignition", () => {
    // On the pad the nozzles are *at* ground level: the body origin sits at
    // the middle of a stack pitched ninety degrees, so there is exactly zero
    // room below them. Unclamped, the whole 5.3 m plume was drawn underground,
    // the ground's depth write hid all but a sliver at the tarmac line, and
    // that sliver flickered with the wobble. That was what ignition looked
    // like, and it looked broken.
    const onThePad = plumeReach(0);
    assert.ok(
      onThePad <= 1.2,
      `flame should be a short flare with no room below it, reached ${onThePad.toFixed(2)} m`,
    );
    assert.ok(onThePad > 0.3, "but there must still be visible fire at ignition");
  });

  it("grows into the room as the stack climbs away", () => {
    // The flame opens up as the rocket rises off the pad, until it reaches its
    // natural length and stops caring about the ground.
    // Note the arrow: `.map(plumeReach)` would pass the index as `level`.
    const sweep = [0, 1, 2, 4, 50].map((room) => plumeReach(room));
    for (let i = 1; i < sweep.length; i += 1) {
      assert.ok(
        sweep[i] >= sweep[i - 1] - 1e-9,
        `flame should never shrink as room opens up: ${sweep.map((n) => n.toFixed(2)).join(" → ")}`,
      );
    }
    assert.ok(
      sweep[sweep.length - 1] > sweep[0] * 2,
      `and should end up far longer than the pad flare: ${sweep[0].toFixed(2)} → ${sweep[sweep.length - 1].toFixed(2)} m`,
    );
  });

  it("never reaches further than the room it is given", () => {
    for (const clearance of [0, 0.5, 1.5, 3, 6]) {
      const reach = plumeReach(clearance);
      assert.ok(
        reach <= Math.max(1.2, clearance + 0.05),
        `with ${clearance} m of room the flame reached ${reach.toFixed(2)} m`,
      );
    }
  });

  it("still fires aft, never forward through the nose", () => {
    // The afterburners shipped once with this sign flipped and fired their
    // plumes out of the nose. Nose is -Z, exhaust is +Z.
    const parent = new Group();
    const plumes = createEnginePlumes(parent, [new Vector3(0, 0, 0)], 1);
    plumes.update(1, 0, 50);
    parent.updateMatrixWorld(true);
    const box = new Box3().setFromObject(plumes.group);
    assert.ok(box.max.z > 1, "the flame should extend aft");
    assert.ok(box.min.z > -0.01, "and nothing should stick out in front of the nozzle");
    plumes.dispose();
  });
});

describe("single-stage starship", () => {
  function fly(seconds: number, throttle = 1) {
    const state = createState();
    const rocket = createRocketState(STARSHIP);
    state.armed = true;
    rocket.ignited = true;
    state.position.set(0, 6.5, 0);
    state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    for (let i = 0; i < 200 * seconds; i += 1) {
      stepRocket(
        state,
        rocket,
        { throttle, pitch: 0, yaw: 0, roll: 0 },
        STILL,
        6.5,
        DT,
        { config: STARSHIP },
      );
    }
    return { state, rocket };
  }

  it("carries no boosters at all", () => {
    assert.equal(STARSHIP.boosterCount, 0);
    assert.equal(STARSHIP.boosterProp, 0);
    assert.equal(STARSHIP.boosterThrust, 0);
  });

  it("lifts on its core alone, which the stack cannot", () => {
    // The whole difference between the two rockets. The shuttle-style stack's
    // core makes 0.40 of its own weight and is going nowhere without solids;
    // this one commands all of its thrust from the moment it lights.
    const full = STARSHIP.dryMass + STARSHIP.coreProp;
    const twr = STARSHIP.coreThrust / (full * 9.81);
    assert.ok(twr > 1.2, `should fly on the core alone, got ${twr.toFixed(2)}`);

    const stackCore = ROCKET.coreThrust / ((ROCKET.dryMass + ROCKET.coreProp +
      ROCKET.boosterCount * (ROCKET.boosterDryMass + ROCKET.boosterProp)) * 9.81);
    assert.ok(stackCore < 1, "and the stack's core alone should still not");
  });

  it("has nothing to stage, so separation is a no-op on the flight", () => {
    const { rocket } = fly(5);
    const before = rocket.mass;
    separateBoosters(rocket);
    assert.equal(rocket.mass, before, "there was no booster mass to lose");
  });

  it("loses steering entirely when the throttle closes", () => {
    // Unlike the stack, whose solids keep burning — and therefore keep
    // gimballing — however far back the throttle goes. With nothing but
    // throttleable engines, closing the throttle is a total control failure.
    const state = createState();
    const rocket = createRocketState(STARSHIP);
    state.armed = true;
    rocket.ignited = true;
    state.position.set(0, 400, 0);
    state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

    let peak = 0;
    for (let i = 0; i < 200 * 6; i += 1) {
      stepRocket(state, rocket, { throttle: 0, pitch: 1, yaw: 0, roll: 0 }, STILL, 6.5, DT, {
        config: STARSHIP,
      });
      peak = Math.max(peak, Math.abs(state.angularVelocity.x));
    }
    assert.equal(peak, 0, "no thrust, no steering — and nothing else is burning");
  });

  it("burns its own propellant, not the stack's", () => {
    const { rocket } = fly(10);
    const expected = STARSHIP.coreProp - STARSHIP.coreBurnRate * 10;
    assert.ok(
      Math.abs(rocket.coreProp - expected) < 1,
      `expected about ${expected.toFixed(0)} kg left, got ${rocket.coreProp.toFixed(0)}`,
    );
    assert.ok(
      propellantFraction(rocket, STARSHIP) < 1,
      "and the fraction must be measured against its own load",
    );
  });
});
