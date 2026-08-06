import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from "three";
import { DEFAULT_CRASH_LIMITS } from "../sim/crash";
import { gradeLanding, tiltOf, type LandingGrade } from "../sim/landing";
import type { DroneState } from "../sim/state";

/**
 * Predicted touchdown point, drawn on the surface below.
 *
 * Landing a quad from a chase camera is mostly a depth-perception problem: the
 * aircraft is a few hundred pixels tall against ground that gives no parallax
 * cue for the last ten metres. The ring answers the two questions the view
 * cannot — *where* the current descent puts you, and *how hard* you would
 * arrive — by carrying the colour of the grade you would earn right now.
 *
 * The projection is deliberately naive: straight-line extrapolation of the
 * present velocity, no gravity term, no controller model. It is a statement
 * about the descent you are flying, not a prediction of the future, and a
 * pilot correcting toward the ring is doing exactly the right thing.
 */

/** Below this descent rate the ring means nothing, so it is not drawn. */
const MIN_SINK = 0.35;

/** Don't extrapolate further than this — a shallow descent projects to infinity. */
const MAX_LOOKAHEAD = 12;

const GRADE_COLOURS: Record<LandingGrade, number> = {
  greased: 0x5eead4,
  good: 0xa3e635,
  firm: 0xfbbf24,
  hard: 0xf97316,
};

/** Beyond the crash limit the ring stops grading and starts warning. */
const CRASH_COLOUR = 0xef4444;

/** Ring radius at the aircraft, metres, plus growth with distance so that it
 * stays readable from a chase camera hundreds of metres up. */
const BASE_RADIUS = 0.9;
const RADIUS_PER_METRE = 0.02;

/** Lift off the surface, so the ring never z-fights with what it lies on. */
const SURFACE_LIFT = 0.06;

export class TouchdownMarker {
  readonly group = new Group();
  enabled = true;

  private readonly ring: Mesh;
  private readonly stalk: Line;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly stalkMaterial: LineBasicMaterial;
  private readonly colour = new Color();
  private readonly predicted = new Vector3();

  constructor() {
    this.ringMaterial = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    // Unit ring, scaled per frame — one geometry for every distance.
    const geometry = new RingGeometry(0.78, 1, 48);
    geometry.rotateX(-Math.PI / 2);
    this.ring = new Mesh(geometry, this.ringMaterial);

    // A stalk from the surface up toward the aircraft. Without it the ring
    // reads as floating at an ambiguous height over a flat city.
    this.stalkMaterial = new LineBasicMaterial({
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const stalkGeometry = new BufferGeometry();
    stalkGeometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3),
    );
    this.stalk = new Line(stalkGeometry, this.stalkMaterial);

    this.group.add(this.ring);
    this.group.add(this.stalk);
    this.group.visible = false;
    // Instruments are not scenery — this must never darken the world under it.
    this.group.renderOrder = 2;
  }

  /**
   * @param agl height above whatever is directly below, metres, or null when
   *   the rangefinder has nothing in range.
   * @param surfaceAt height of the surface at a point, for placing the ring on
   *   the roof or the street it actually lands on rather than on the height
   *   directly beneath the aircraft.
   */
  update(
    state: DroneState,
    agl: number | null,
    surfaceAt: (x: number, z: number) => number | null,
  ) {
    const sink = -state.velocity.y;
    if (!this.enabled || state.crashed || agl === null || sink < MIN_SINK) {
      this.group.visible = false;
      return;
    }

    const lookahead = Math.min(agl / sink, MAX_LOOKAHEAD);
    this.predicted.set(
      state.position.x + state.velocity.x * lookahead,
      0,
      state.position.z + state.velocity.z * lookahead,
    );

    // The ring belongs on the surface at the *predicted* point, which over a
    // city is routinely not the surface under the aircraft — drifting off a
    // rooftop should drop the marker forty storeys, because that is where the
    // current descent is taking you.
    const surface = surfaceAt(this.predicted.x, this.predicted.z);
    if (surface === null) {
      this.group.visible = false;
      return;
    }
    this.predicted.y = surface + SURFACE_LIFT;

    const distance = state.position.distanceTo(this.predicted);
    const radius = BASE_RADIUS + distance * RADIUS_PER_METRE;
    this.ring.scale.setScalar(radius);

    // Stalk from the ring up toward the aircraft, capped so it stays a cue
    // rather than a tether across the whole descent.
    this.stalk.scale.y = Math.min(agl, 8);

    this.group.position.copy(this.predicted);
    this.group.visible = true;

    const grade =
      sink > DEFAULT_CRASH_LIMITS.hardLandingSpeed
        ? null
        : gradeLanding(sink, tiltOf(state));
    this.colour.setHex(grade === null ? CRASH_COLOUR : GRADE_COLOURS[grade]);
    this.ringMaterial.color.copy(this.colour);
    this.stalkMaterial.color.copy(this.colour);
  }

  dispose() {
    this.ring.geometry.dispose();
    this.stalk.geometry.dispose();
    this.ringMaterial.dispose();
    this.stalkMaterial.dispose();
    this.group.removeFromParent();
  }
}
