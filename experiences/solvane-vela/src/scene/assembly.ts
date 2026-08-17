import * as THREE from "three";
import type { PartName } from "./fleet-manifest";

/**
 * Per-era assembly tuning: how the five delivered pack parts compose into
 * one car. Values are hand-tuned per generation against the delivered
 * geometry (see .debug-shots workflow); `DEFAULT_ASSEMBLY` is the baseline
 * part-pack fit every era starts from. Eras delivered as one complete mesh
 * override it with a bare `body` fit and no wheels.
 *
 * Conventions:
 *  - car group faces +Z (nose toward +Z); left side of the car is +X
 *  - car root sits on the plinth top (y = 0.12 handled by CarFleet)
 *  - every part transform is local to the car group
 *  - doors hinge around Y at their front edge; the hood tilts around X at
 *    its cowl edge (front lifts up, alligator style)
 */
export interface PartFit {
  position: [number, number, number];
  rotation: [number, number, number];
  /** multiplier on the part's normalized target size */
  scale: number;
}

export interface HingeFit {
  /** hinge pivot in car-group space */
  pivot: [number, number, number];
  axis: [number, number, number];
  /** open angle in radians */
  angle: number;
}

export interface EraAssembly {
  /** overall car length target in meters (normalizes generated scale) */
  length: number;
  parts: Record<PartName, PartFit>;
  wheels: PartFit[];
  hinges: { hood: HingeFit; doorL: HingeFit; doorR: HingeFit };
  /** explode translation distance multiplier */
  explode: number;
  /** rest height above the slice ground (hover cars); 0 = grounded */
  hover?: number;
}

const fit = (
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale = 1,
): PartFit => ({ position, rotation, scale });

const HALF_PI = Math.PI / 2;

export const DEFAULT_ASSEMBLY: EraAssembly = {
  length: 4.2,
  parts: {
    body: fit([0, 0.72, 0]),
    // hood height derived from the body's measured fender/hood line, minus
    // the panel's own crown (generated hoods are domed, not flat slabs)
    hood: fit([0, 0.58, 1.24], [0, 0, 0], 0.9),
    // Doors are fitted to the body's measured door APERTURE: the opening is
    // found by scanning the body skin for the gap at door-card height, then
    // each door is scaled to that opening and centred in it.
    doorL: fit([0.55, 0.725, 0.18], [0, 1.55, 0], 0.802),
    doorR: fit([-0.734, 0.725, 0.18], [0, -1.55, 0], 0.643),
    wheel: fit([0, 0, 0]), // template; real placement via `wheels`
  },
  wheels: [
    fit([0.7, 0.31, 1.32], [0, HALF_PI, 0]),
    fit([-0.7, 0.31, 1.32], [0, -HALF_PI, 0]),
    fit([0.7, 0.31, -1.32], [0, HALF_PI, 0]),
    fit([-0.7, 0.31, -1.32], [0, -HALF_PI, 0]),
  ],
  hinges: {
    hood: { pivot: [0, 0.95, 0.62], axis: [1, 0, 0], angle: -0.55 },
    // hinge at the aperture's forward edge so the door swings like a real one
    doorL: { pivot: [0.55, 0.725, 0.5], axis: [0, 1, 0], angle: -1.0 },
    doorR: { pivot: [-0.734, 0.725, 0.5], axis: [0, 1, 0], angle: 1.0 },
  },
  explode: 1,
};

const era = (
  length: number,
  overrides: {
    parts?: Partial<Record<PartName, PartFit>>;
    hinges?: Partial<EraAssembly["hinges"]>;
    wheels?: PartFit[];
  },
): EraAssembly => ({
  ...DEFAULT_ASSEMBLY,
  length,
  parts: { ...DEFAULT_ASSEMBLY.parts, ...overrides.parts },
  hinges: { ...DEFAULT_ASSEMBLY.hinges, ...overrides.hinges },
  wheels: overrides.wheels ?? DEFAULT_ASSEMBLY.wheels,
});

/** era-specific overrides, tuned per delivered pack via the debug-shot loop */
export const ASSEMBLIES: Record<string, EraAssembly> = {
  // one complete assembly: a brass-era touring car — short and tall, so it
  // rides the shortest length in the fleet to keep its real proportions
  "car-1948": era(3.7, {
    parts: { body: fit([0, 0, 0]) },
    wheels: [],
  }),
  // one complete assembly: a full-size American convertible, so it rides a
  // little longer than the rest of the fleet
  "car-1965": era(4.9, {
    parts: { body: fit([0, 0, 0]) },
    wheels: [],
  }),
  // one complete assembly: body, glass and wheels arrive as a single mesh
  "car-1987": era(4.6, {
    parts: { body: fit([0, 0, 0]) },
    wheels: [],
  }),
  // one complete assembly; this GLB is authored nose-along-X, so give it a
  // quarter turn to face outward (+Z) like the rest of the fleet
  "car-2004": era(4.55, {
    parts: { body: fit([0, 0, 0], [0, HALF_PI, 0]) },
    wheels: [],
  }),
  // one complete assembly: body, glass and wheels arrive as a single mesh, so
  // there are no panels to place and no wheels to position
  "car-2026": era(4.75, {
    parts: { body: fit([0, 0, 0]) },
    wheels: [],
  }),
  // one complete assembly: a wheel-less hover GT that floats above the
  // mirror pool, with an idle bob applied in CarFleet. This GLB is authored
  // nose-along-X, so it takes a quarter turn to face outward like the fleet
  "car-2040": {
    ...era(4.8, {
      parts: { body: fit([0, 0, 0], [0, HALF_PI, 0]) },
      wheels: [],
    }),
    hover: 0.45,
  },
};

export const vec = (v: [number, number, number]) => new THREE.Vector3(...v);
