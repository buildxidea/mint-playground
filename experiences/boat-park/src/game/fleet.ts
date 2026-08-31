export interface BoatSpec {
  id: string;
  name: string;
  blurb: string;
  /** Hull length in meters (drives physics, berth size, camera). */
  length: number;
  beam: number;
  /** Uniform across the fleet: every hull has the same legs. */
  maxSpeed: number;
  accel: number;
  reverseAccel: number;
  turnRate: number;
  /** Per-second exponential speed decay. Lower = longer glide. */
  drag: number;
  /**
   * Per-second decay of sideways slip. Low values let the hull keep sliding
   * along its old course after the bow swings — this is the drift.
   */
  lateralGrip: number;
  /** Max speed (m/s) at which mooring engages; uniform like the rest. */
  dockSpeed: number;
  parTime: number;
  hullColor: string;
  accentColor: string;
  camDistance: number;
  camHeight: number;
  /** Logical key into mint-assets.json for the generated model. */
  mintKey: string;
  /** Extra yaw applied to the generated model so its bow faces local +Z. */
  modelYaw?: number;
}

/** Every run opens with this hull; the rest of the fleet is shuffled behind it. */
export const STARTER_BOAT_ID = 'dinghy';

/**
 * Build a play order: the starter boat first, then the remaining fleet in a
 * random sequence. Pass a seeded generator so a run's order is reproducible.
 */
export function createFleetOrder(random: () => number): BoatSpec[] {
  const starter = FLEET.find((boat) => boat.id === STARTER_BOAT_ID) ?? FLEET[0];
  const rest = FLEET.filter((boat) => boat !== starter);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [starter, ...rest];
}

/** Resolve stored boat ids back to specs, ignoring anything unrecognised. */
export function orderFromIds(ids: string[]): BoatSpec[] | null {
  const specs = ids
    .map((id) => FLEET.find((boat) => boat.id === id))
    .filter((boat): boat is BoatSpec => Boolean(boat));
  return specs.length === FLEET.length ? specs : null;
}

/** Shift boost: multiplies top speed and thrust while held. */
export const BOOST_SPEED = 1.5;
export const BOOST_ACCEL = 2;

/** How far off the dock a boat spawns; capped so giants stay inside the water plane. */
export function approachDistance(spec: BoatSpec): number {
  return Math.min(spec.length * 3.2 + 80, 760);
}

export const FLEET: BoatSpec[] = [
  {
    id: 'dinghy',
    name: 'Dinghy',
    blurb: 'Three meters of wood and optimism.',
    length: 3.2,
    beam: 1.4,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 1.2,
    drag: 0.42,
    lateralGrip: 1.9,
    dockSpeed: 2,
    parTime: 25,
    hullColor: '#7fb2c9',
    accentColor: '#f2ede2',
    camDistance: 13,
    camHeight: 7,
    mintKey: 'boat-dinghy',
    modelYaw: Math.PI,
  },
  {
    id: 'speedboat',
    name: 'Speedboat',
    blurb: 'Fast in. Hopefully slow enough out.',
    length: 6.5,
    beam: 2.3,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 1.1,
    drag: 0.32,
    lateralGrip: 1.3,
    dockSpeed: 2,
    parTime: 30,
    hullColor: '#f2ede2',
    accentColor: '#c2402f',
    camDistance: 18,
    camHeight: 9,
    mintKey: 'boat-speedboat',
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    blurb: 'Sails furled, motor puttering.',
    length: 8.5,
    beam: 2.8,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 1.0,
    drag: 0.23,
    lateralGrip: 1.05,
    dockSpeed: 2,
    parTime: 40,
    hullColor: '#20456b',
    accentColor: '#f2ede2',
    camDistance: 22,
    camHeight: 11,
    mintKey: 'boat-sailboat',
  },
  {
    id: 'trawler',
    name: 'Fishing Trawler',
    blurb: 'Smells like work. Handles like it too.',
    length: 15,
    beam: 5,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 0.85,
    drag: 0.17,
    lateralGrip: 0.75,
    dockSpeed: 2,
    parTime: 55,
    hullColor: '#3a7d78',
    accentColor: '#e8e3d5',
    camDistance: 34,
    camHeight: 16,
    mintKey: 'boat-trawler',
  },
  {
    id: 'tugboat',
    name: 'Tugboat',
    blurb: 'Pushes ships for a living. Now park it.',
    length: 19,
    beam: 7,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 0.9,
    drag: 0.2,
    lateralGrip: 0.8,
    dockSpeed: 2,
    parTime: 55,
    hullColor: '#b03a2e',
    accentColor: '#1d2430',
    camDistance: 40,
    camHeight: 19,
    mintKey: 'boat-tugboat',
  },
  {
    id: 'yacht',
    name: 'Motor Yacht',
    blurb: 'Scratch it and someone loses a summer.',
    length: 32,
    beam: 7.5,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 0.75,
    drag: 0.11,
    lateralGrip: 0.5,
    dockSpeed: 2,
    parTime: 75,
    hullColor: '#f4f1e8',
    accentColor: '#33414f',
    camDistance: 60,
    camHeight: 28,
    mintKey: 'boat-yacht',
  },
  {
    id: 'cruise',
    name: 'Cruise Ship',
    blurb: 'Four thousand passengers are watching.',
    length: 120,
    beam: 22,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 0.6,
    drag: 0.055,
    lateralGrip: 0.2,
    dockSpeed: 2,
    parTime: 140,
    hullColor: '#f4f1e8',
    accentColor: '#1d3557',
    camDistance: 150,
    camHeight: 66,
    mintKey: 'boat-cruise',
  },
  {
    id: 'container',
    name: 'Container Ship',
    blurb: 'Twelve thousand boxes. One berth.',
    length: 200,
    beam: 32,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 0.55,
    drag: 0.038,
    lateralGrip: 0.15,
    dockSpeed: 2,
    parTime: 200,
    hullColor: '#2f3b45',
    accentColor: '#c2402f',
    camDistance: 225,
    camHeight: 95,
    mintKey: 'boat-container',
    modelYaw: Math.PI,
  },
  {
    id: 'carrier',
    name: 'Aircraft Carrier',
    blurb: 'A hundred thousand tons of no mistakes.',
    length: 300,
    beam: 42,
    maxSpeed: 30,
    accel: 14,
    reverseAccel: 7,
    turnRate: 0.5,
    drag: 0.03,
    lateralGrip: 0.12,
    dockSpeed: 2,
    parTime: 260,
    hullColor: '#7e8790',
    accentColor: '#3a424a',
    camDistance: 320,
    camHeight: 135,
    mintKey: 'boat-carrier',
  },
];
