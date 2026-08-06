import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Vector3 } from "three";
import { DEFAULT_CRASH_LIMITS, isCrash } from "../src/sim/crash";
import {
  GRADE_ORDER,
  GRADE_SINK,
  LandingDetector,
  gradeLanding,
  tiltOf,
} from "../src/sim/landing";
import { createState } from "../src/sim/state";

const DT = 1 / 200;

/** Tilt the aircraft about its roll axis by `radians`. */
function bank(state: ReturnType<typeof createState>, radians: number) {
  state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), radians);
}

/** Fly for `seconds`, then arrive at `sink` m/s. */
function land(
  detector: LandingDetector,
  state: ReturnType<typeof createState>,
  sink: number,
  seconds = 2,
) {
  for (let t = 0; t < seconds; t += DT) detector.update(state, false, 0, DT);
  return detector.update(state, true, sink, DT);
}

describe("landing grades", () => {
  it("runs the grade scale right up to the crash limit", () => {
    // Every survivable landing must have a grade, and every grade must
    // describe a survivable landing. If the worst grade stopped short of the
    // crash limit there would be a band of landings that neither crashed nor
    // graded, and the pilot would get no feedback at all for them.
    const worst = GRADE_ORDER[GRADE_ORDER.length - 1];
    assert.equal(GRADE_SINK[worst], DEFAULT_CRASH_LIMITS.hardLandingSpeed);
  });

  it("orders the sink thresholds monotonically", () => {
    for (let i = 1; i < GRADE_ORDER.length; i += 1) {
      assert.ok(
        GRADE_SINK[GRADE_ORDER[i]] > GRADE_SINK[GRADE_ORDER[i - 1]],
        `${GRADE_ORDER[i]} should tolerate more sink than ${GRADE_ORDER[i - 1]}`,
      );
    }
  });

  it("grades a feather-light arrival as greased", () => {
    assert.equal(gradeLanding(0.1, 0), "greased");
  });

  it("grades an arrival just under the crash limit as hard", () => {
    assert.equal(gradeLanding(2.4, 0), "hard");
  });

  it("never returns a grade off the end of the scale", () => {
    // Above the limit the crash policy takes over, but the function must still
    // answer — the touchdown marker asks it about descents that have not
    // happened yet.
    assert.equal(gradeLanding(50, 1.5), "hard");
  });

  it("demotes a slow arrival that came in tilted", () => {
    // 0.2 m/s is greased on sink rate alone; on its side it is a wingtip
    // strike that happened to be slow.
    assert.equal(gradeLanding(0.2, 0), "greased");
    assert.equal(gradeLanding(0.2, (20 * Math.PI) / 180), "good");
    assert.equal(gradeLanding(0.2, (40 * Math.PI) / 180), "firm");
  });

  it("measures tilt from either roll or pitch", () => {
    const state = createState();
    assert.ok(tiltOf(state) < 1e-9, "level aircraft has no tilt");

    bank(state, Math.PI / 6);
    assert.ok(Math.abs(tiltOf(state) - Math.PI / 6) < 1e-6);

    state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6);
    assert.ok(
      Math.abs(tiltOf(state) - Math.PI / 6) < 1e-6,
      "pitching up is as much a tilt as banking",
    );
  });
});

describe("landing detector", () => {
  it("says nothing while airborne", () => {
    const detector = new LandingDetector();
    const state = createState();
    for (let i = 0; i < 400; i += 1) {
      assert.equal(detector.update(state, false, 0, DT), null);
    }
  });

  it("reports the touchdown once, not every step it stays down", () => {
    const detector = new LandingDetector();
    const state = createState();

    const touchdown = land(detector, state, 0.6);
    assert.ok(touchdown, "arriving after a flight should report a landing");
    assert.equal(touchdown.grade, "good");
    assert.ok(Math.abs(touchdown.sinkSpeed - 0.6) < 1e-9);

    // Sitting there is not landing again.
    for (let i = 0; i < 200; i += 1) {
      assert.equal(detector.update(state, true, 0, DT), null);
    }
  });

  it("does not report a fresh landing for a bounce", () => {
    // The constraint releases and re-engages across a step or two as the
    // aircraft settles. Each re-engagement looks exactly like an arrival, and
    // without hysteresis one touchdown reports three or four times.
    const detector = new LandingDetector();
    const state = createState();
    assert.ok(land(detector, state, 1.0));

    for (let i = 0; i < 3; i += 1) {
      detector.update(state, false, 0, DT);
      detector.update(state, false, 0, DT);
      assert.equal(
        detector.update(state, true, 0.4, DT),
        null,
        "a two-step skip off the surface is the same landing, not a new one",
      );
    }
  });

  it("reports again after a genuine departure and return", () => {
    const detector = new LandingDetector();
    const state = createState();
    assert.ok(land(detector, state, 1.0));
    assert.ok(land(detector, state, 0.2), "a real circuit should grade again");
    assert.equal(detector.last?.grade, "greased");
  });

  it("does not grade a wreck", () => {
    // The crash handoff has its own verdict and its own display. Grading a
    // tumbling airframe would report two different outcomes for one event.
    const detector = new LandingDetector();
    const state = createState();
    state.crashed = true;
    assert.equal(land(detector, state, 0.1), null);
    assert.equal(detector.last, null);
  });

  it("records where it landed, so a rooftop reads differently from the street", () => {
    const detector = new LandingDetector();
    const state = createState();
    state.position.set(120, 63.5, -40);
    const touchdown = land(detector, state, 0.3);
    assert.ok(touchdown);
    assert.equal(touchdown.surfaceHeight, 63.5);
  });

  it("forgets the last landing on reset", () => {
    const detector = new LandingDetector();
    const state = createState();
    assert.ok(land(detector, state, 0.5));
    detector.reset();
    assert.equal(detector.last, null);
    assert.equal(detector.sinceLast, Infinity);
  });
});

describe("crash policy with a surface underneath", () => {
  const roofContact = { ground: false, prop: true };

  it("treats settling onto a rooftop as a landing, not a collision", () => {
    // Only the flat ground slab is classified as ground; a roof arrives as
    // scenery, which used to crash the aircraft above 0.5 m/s — that is to
    // say, on every landing anyone would ever fly.
    const supported = { supported: true, horizontalSpeed: 0.2 };
    assert.equal(isCrash(roofContact, 2.0, 2.0, DEFAULT_CRASH_LIMITS, supported), false);
  });

  it("still crashes when sliding into something at speed while supported", () => {
    // Standing on the street and flying into a wall is not a landing, however
    // firmly the street is holding you up.
    const supported = { supported: true, horizontalSpeed: 6 };
    assert.equal(isCrash(roofContact, 6, null, DEFAULT_CRASH_LIMITS, supported), true);
  });

  it("leaves unsupported scenery contacts exactly as they were", () => {
    assert.equal(isCrash(roofContact, 6, null), true);
    assert.equal(isCrash(roofContact, 0.2, null), false);
  });

  it("still crashes a hard arrival, supported or not", () => {
    const supported = { supported: true, horizontalSpeed: 0 };
    const over = DEFAULT_CRASH_LIMITS.hardLandingSpeed + 0.1;
    assert.equal(
      isCrash({ ground: true, prop: false }, over, over, DEFAULT_CRASH_LIMITS, supported),
      true,
      "support must not turn an unsurvivable descent into a landing",
    );
  });
});
