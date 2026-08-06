import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Object3D, Vector3 } from "three";
import {
  CrashController,
  DEFAULT_CRASH_LIMITS,
  isCrash,
} from "../src/sim/crash";
import { createPhysics } from "../src/sim/physics";
import { createState } from "../src/sim/state";
import type { PlacedProp } from "../src/world/props";

const NO_CONTACT = { ground: false, prop: false };
const PROP_CONTACT = { ground: false, prop: true };

describe("crash policy", () => {
  it("ignores a step with no contacts", () => {
    assert.equal(isCrash(NO_CONTACT, 12, null), false);
  });

  it("treats a gentle touchdown as a landing", () => {
    assert.equal(isCrash(NO_CONTACT, 1.2, 1.2), false);
  });

  it("treats a fast arrival as a crash", () => {
    assert.equal(
      isCrash(NO_CONTACT, 6, DEFAULT_CRASH_LIMITS.hardLandingSpeed + 0.5),
      true,
    );
  });

  it("crashes on scenery even at low speed", () => {
    assert.equal(isCrash(PROP_CONTACT, 1.5, null), true);
  });

  it("forgives brushing scenery while nearly stationary", () => {
    assert.equal(isCrash(PROP_CONTACT, 0.2, null), false);
  });

  it("is harsher about scenery than about the ground", () => {
    // The same speed that is a safe landing is a crash into a container.
    const speed = 1.5;
    assert.equal(isCrash(NO_CONTACT, speed, speed), false);
    assert.equal(isCrash(PROP_CONTACT, speed, null), true);
  });
});

function fakeProp(x: number, z: number): PlacedProp {
  return {
    kind: "container",
    object: new Object3D(),
    centre: new Vector3(x, 1.3, z),
    halfExtents: [1.45, 1.3, 3.03],
    rotation: 0,
    mass: null,
  };
}

describe("crash handoff", () => {
  it("hands the airframe to the engine on impact and takes it back on reset", async () => {
    const physics = await createPhysics([fakeProp(0, 0)], 0);
    const crash = new CrashController();
    const state = createState();

    // Fly into the container at speed.
    state.armed = true;
    state.position.set(0, 1.3, 4);
    state.velocity.set(0, 0, -9);

    let crashedAtStep = -1;
    for (let i = 0; i < 200; i += 1) {
      if (!state.crashed) {
        state.position.addScaledVector(state.velocity, 1 / 200);
        physics.pushKinematic(state);
      }
      physics.step(1 / 200);
      crash.update(state, physics, 1 / 200, null);
      if (state.crashed && crashedAtStep < 0) crashedAtStep = i;
    }

    assert.ok(state.crashed, "should have crashed into the container");
    assert.ok(crashedAtStep >= 0);
    assert.equal(state.armed, false, "a crash must disarm the aircraft");

    // Rapier owns it now: it should have been moved by the engine, not by us.
    assert.ok(
      state.position.y < 1.3,
      `wreck should have fallen, y=${state.position.y.toFixed(2)}`,
    );

    // And the pilot can take it back.
    crash.reset(state, physics);
    assert.equal(state.crashed, false);

    const before = state.position.clone();
    for (let i = 0; i < 100; i += 1) {
      physics.pushKinematic(state);
      physics.step(1 / 200);
      crash.update(state, physics, 1 / 200, null);
    }
    assert.ok(
      state.position.distanceTo(before) < 1e-6,
      "once recovered, the engine must not move the aircraft",
    );

    physics.dispose();
  });

  it("does not crash on a controlled descent to the pad", async () => {
    const physics = await createPhysics([], 0);
    const crash = new CrashController();
    const state = createState();
    state.armed = true;
    state.position.set(0, 0.072, 0);

    for (let i = 0; i < 400; i += 1) {
      physics.pushKinematic(state);
      physics.step(1 / 200);
      // A steady 1.2 m/s touchdown, well inside the limit.
      crash.update(state, physics, 1 / 200, 1.2);
    }

    assert.equal(state.crashed, false, "a soft landing must not count as a crash");
    physics.dispose();
  });
});
