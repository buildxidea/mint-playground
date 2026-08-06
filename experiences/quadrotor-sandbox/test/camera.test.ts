import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA_MODES, ChaseCamera } from "../src/view/chase";
import { createState } from "../src/sim/state";

const DT = 1 / 60;

/** Roll the aircraft about its own forward axis (body +Z / -Z). */
function roll(state: ReturnType<typeof createState>, radians: number) {
  state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), radians);
}

describe("camera modes", () => {
  it("offers the onboard view in the cycle", () => {
    assert.ok(CAMERA_MODES.includes("onboard"), "onboard should be selectable with C");
  });

  it("puts the onboard camera on the aircraft, not trailing it", () => {
    const chase = new ChaseCamera();
    chase.mode = "onboard";
    chase.onboardOffset.set(0, 0.2, -0.5);
    const camera = new PerspectiveCamera();
    const state = createState();
    state.position.set(100, 50, -30);

    chase.update(camera, state, DT);

    // Within the offset's own length of the aircraft — i.e. mounted on it.
    assert.ok(
      camera.position.distanceTo(state.position) < 0.6,
      `onboard camera should sit on the airframe, was ${camera.position.distanceTo(state.position).toFixed(2)} m away`,
    );
  });

  it("tracks the aircraft rigidly, with no follow lag", () => {
    // A smoothed onboard camera would make the aircraft appear to drift
    // inside its own cockpit, so this view deliberately skips the chase
    // camera's damping. One frame after a jump, it must already be there.
    const chase = new ChaseCamera();
    chase.mode = "onboard";
    chase.onboardOffset.set(0, 0.2, -0.5);
    const camera = new PerspectiveCamera();
    const state = createState();

    state.position.set(0, 10, 0);
    chase.update(camera, state, DT);

    state.position.set(500, 200, -400);
    chase.update(camera, state, DT);

    assert.ok(
      camera.position.distanceTo(state.position) < 0.6,
      "onboard camera lagged behind a jump — it should be rigidly mounted",
    );
  });

  it("rolls with the aircraft when the horizon is not stabilised", () => {
    const chase = new ChaseCamera();
    chase.mode = "onboard";
    chase.stabilized = false;
    const camera = new PerspectiveCamera();
    const state = createState();

    chase.update(camera, state, DT);
    const level = camera.quaternion.clone();

    roll(state, 0.9);
    chase.update(camera, state, DT);

    assert.ok(
      level.angleTo(camera.quaternion) > 0.5,
      "raw onboard view should inherit the aircraft's roll",
    );
  });

  it("keeps the horizon flat when stabilised", () => {
    const chase = new ChaseCamera();
    chase.mode = "onboard";
    chase.stabilized = true;
    const camera = new PerspectiveCamera();
    const state = createState();

    chase.update(camera, state, DT);
    const level = camera.quaternion.clone();

    roll(state, 0.9);
    chase.update(camera, state, DT);

    assert.ok(
      level.angleTo(camera.quaternion) < 0.05,
      "stabilised onboard view should ignore roll, keeping the horizon level",
    );
  });

  it("still looks forward, not backward, along the aircraft's nose", () => {
    // The sim flies nose -Z, and a camera's default forward is also -Z, so a
    // stray extra half-turn anywhere would leave the pilot watching their own
    // tail without anything else failing.
    const chase = new ChaseCamera();
    chase.mode = "onboard";
    chase.stabilized = false;
    const camera = new PerspectiveCamera();
    const state = createState();

    // Point the aircraft along world -X and check the camera looks that way.
    state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    chase.update(camera, state, DT);

    const look = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const nose = new Vector3(0, 0, -1).applyQuaternion(state.orientation);
    assert.ok(
      look.dot(nose) > 0.9,
      `camera should look along the nose, dot was ${look.dot(nose).toFixed(2)}`,
    );
  });

  it("mounts on the pose the airframe was drawn at, not the raw state", () => {
    // The airframe is rendered at the simulation state interpolated across the
    // leftover fraction of a physics step; a camera bolted to it must use that
    // same pose. Using the raw state instead leaves the two disagreeing by up
    // to one step of travel every frame — 0.37 m at the jet's 73 m/s — which
    // is exactly the shaking this guards against.
    const chase = new ChaseCamera();
    chase.mode = "onboard";
    chase.onboardOffset.set(0, 0.2, -0.5);
    const camera = new PerspectiveCamera();
    const state = createState();
    state.position.set(0, 100, 0);

    // Where the airframe is actually drawn: a third of a step behind, which
    // at the jet's cruise is what one 200 Hz step covers.
    const LAG = 0.37;
    const pose = {
      position: new Vector3(0, 100, LAG),
      orientation: state.orientation.clone(),
    };

    chase.update(camera, state, DT);
    const onRawState = camera.position.clone();
    chase.update(camera, state, DT, pose);

    // The camera must have moved by exactly the pose's displacement — it is
    // rigidly mounted, so it tracks the drawn airframe one-for-one.
    const shift = camera.position.clone().sub(onRawState);
    assert.ok(
      Math.abs(shift.z - LAG) < 1e-6 && shift.lengthSq() - LAG * LAG < 1e-9,
      `onboard ignored the drawn pose and stayed on the raw state — this is the judder bug (shift ${shift.toArray().map((n) => n.toFixed(3)).join(", ")})`,
    );
  });

  it("defaults to the raw state when no drawn pose is given", () => {
    const chase = new ChaseCamera();
    chase.mode = "onboard";
    chase.onboardOffset.set(0, 0, -0.5);
    const camera = new PerspectiveCamera();
    const state = createState();
    state.position.set(7, 12, -3);

    chase.update(camera, state, DT);

    assert.ok(camera.position.distanceTo(state.position) < 0.6);
  });

  it("hands a sane position back to chase after leaving onboard", () => {
    // Onboard bypasses the smoothed chase state; if it did not keep that
    // state current, switching back would swing the camera in from wherever
    // it was last left.
    const chase = new ChaseCamera();
    const camera = new PerspectiveCamera();
    const state = createState();
    state.position.set(0, 10, 0);
    chase.reset(state);

    chase.mode = "onboard";
    state.position.set(300, 120, 80);
    for (let i = 0; i < 5; i += 1) chase.update(camera, state, DT);

    chase.mode = "chase";
    chase.update(camera, state, DT);

    assert.ok(
      camera.position.distanceTo(state.position) < 20,
      `chase should resume near the aircraft, was ${camera.position.distanceTo(state.position).toFixed(0)} m away`,
    );
  });
});
