/**
 * THE MARS TRAIL — authored content.
 *
 * Distances are real-ish: Earth departure is measured in tens of thousands of
 * km, deep space in tens of millions. Travel rate rises sharply after L1
 * because the early legs are orbital phasing and the middle legs are a fast
 * coast, which is both physically true and what makes the pacing work.
 */

import type { Illness, Leg, Profession, ProfessionId, RationLevel, StoreItem } from './types';

export const CREW_SIZE = 5;

/** Days available before Mars falls out of position. */
export const TRANSFER_WINDOW_DAYS = 340;

export const PROFESSIONS: Profession[] = [
  {
    id: 'financier',
    name: 'Corporate Financier',
    startingCredits: 1100,
    scoreMultiplier: 1,
    blurb: 'Rich start, easiest crossing.',
    perk: 'Station markups are 15% lower.',
  },
  {
    id: 'engineer',
    name: "Ship's Engineer",
    startingCredits: 800,
    scoreMultiplier: 2,
    blurb: 'You know the drive better than the yard does.',
    perk: 'Repairs cost half the spares and drive cores wear 20% slower.',
  },
  {
    id: 'homesteader',
    name: 'Terraform Homesteader',
    startingCredits: 400,
    scoreMultiplier: 3,
    blurb: 'Seed stock and stubbornness.',
    perk: 'Hydroponics yields rations passively; harvests return 30% more.',
  },
];

export const DEFAULT_CREW_NAMES = ['Thompson', 'Helen', 'Jane', 'Jethro', 'Stee-lah'];

export const STORE_ITEMS: StoreItem[] = [
  {
    id: 'driveCores',
    name: 'Drive Cores',
    unit: 'core',
    basePrice: 120,
    step: 1,
    description:
      'Two will move the ship. Four to six will get it to Mars.',
  },
  {
    id: 'rationsKg',
    name: 'Rations',
    unit: 'kg',
    basePrice: 0.3,
    step: 100,
    description:
      'Five crew on filling rations eat about 10 kg a day.',
  },
  {
    id: 'waterL',
    name: 'Water',
    unit: 'L',
    basePrice: 0.1,
    step: 100,
    description: 'Reclaim recovers most, never all.',
  },
  {
    id: 'radSuits',
    name: 'Rad Suits',
    unit: 'suit',
    basePrice: 12,
    step: 1,
    description:
      'One per crew, or a solar storm is brutal.',
  },
  {
    id: 'propellantCells',
    name: 'Propellant Cells',
    unit: 'cell',
    basePrice: 8,
    step: 20,
    description: 'Course corrections, hazard burns, EVAs.',
  },
  {
    id: 'coolantPumps',
    name: 'Coolant Pumps',
    unit: 'pump',
    basePrice: 15,
    step: 1,
    description: 'A seized pump cooks a core.',
  },
  {
    id: 'heatShield',
    name: 'Heat-Shield Tiles',
    unit: 'set',
    basePrice: 25,
    step: 1,
    description: 'You cannot land without one.',
  },
  {
    id: 'commsArray',
    name: 'Comms Arrays',
    unit: 'array',
    basePrice: 20,
    step: 1,
    description: 'Lose it and you lose navigation and morale.',
  },
  {
    id: 'hullPlates',
    name: 'Hull Plates',
    unit: 'plate',
    basePrice: 18,
    step: 1,
    description: 'Patches punctures and debris strikes.',
  },
];

/** kg per crew member per day. */
export const RATION_CONSUMPTION: Record<RationLevel, number> = {
  filling: 2,
  meager: 1.3,
  bare: 0.8,
};

/** Litres per crew member per day after reclaim losses. */
export const WATER_CONSUMPTION = 0.9;

export const BURN_RATE_SPEED = {
  coasting: 0.75,
  standard: 1,
  hard: 1.3,
} as const;

/**
 * Drive-core wear per day at each burn rate, before the load is divided across
 * the cores actually installed. A well-cored ship wears slowly; running on two
 * cores wears each of them twice as fast.
 */
export const BURN_RATE_WEAR = {
  coasting: 0.3,
  standard: 0.58,
  hard: 1.18,
} as const;

/** Crew energy drain per day at each burn rate. */
export const BURN_RATE_FATIGUE = {
  coasting: 0.4,
  standard: 1,
  hard: 1.9,
} as const;

export const ILLNESS_LABELS: Record<Illness, string> = {
  none: '',
  'radiation-sickness': 'RAD SICK',
  hypoxia: 'HYPOXIA',
  'bone-density-collapse': 'BONE LOSS',
  'space-adaptation-syndrome': 'SAS',
  'cabin-psychosis': 'PSYCHOSIS',
  'hydroponics-blight': 'SCURVY',
  'decompression-trauma': 'TRAUMA',
};

export const ILLNESS_NAMES: Record<Illness, string> = {
  none: '',
  'radiation-sickness': 'radiation sickness',
  hypoxia: 'hypoxia',
  'bone-density-collapse': 'bone-density collapse',
  'space-adaptation-syndrome': 'space adaptation syndrome',
  'cabin-psychosis': 'cabin psychosis',
  'hydroponics-blight': 'hydroponics blight',
  'decompression-trauma': 'decompression trauma',
};

/** Daily health drain while afflicted, and the per-day mortality weighting. */
export const ILLNESS_SEVERITY: Record<Illness, { drain: number; mortality: number }> = {
  none: { drain: 0, mortality: 0 },
  'radiation-sickness': { drain: 3.2, mortality: 0.019 },
  hypoxia: { drain: 3.4, mortality: 0.016 },
  'bone-density-collapse': { drain: 1.4, mortality: 0.004 },
  'space-adaptation-syndrome': { drain: 1.1, mortality: 0.002 },
  'cabin-psychosis': { drain: 1.8, mortality: 0.007 },
  'hydroponics-blight': { drain: 2.1, mortality: 0.01 },
  'decompression-trauma': { drain: 5.5, mortality: 0.034 },
};

export const LEGS: Leg[] = [
  {
    index: 0,
    title: 'EARTH DEPARTURE',
    from: 'Canaveral Orbital Yard',
    to: 'Lunar Gateway',
    baseKm: 384_000,
    baseKmPerDay: 38_000,
    sceneKey: 'earth-orbit',
    routes: [
      {
        id: 'standard-ascent',
        name: 'Standard Ascent Corridor',
        distanceMultiplier: 1,
        severityMultiplier: 1,
        description: 'Mapped and monitored. A transfer ring on the way.',
        hasStation: true,
      },
      {
        id: 'polar-sling',
        name: 'Polar Sling',
        distanceMultiplier: 0.82,
        severityMultiplier: 1.45,
        description: 'Shorter, and straight through uncatalogued junk.',
        hasStation: false,
      },
    ],
    waypoints: [
      {
        id: 'leo-ring',
        name: 'LEO Transfer Ring',
        kind: 'station',
        kmFromLegStart: 62_000,
        severity: 0,
        description:
          'Last cheap supplies you will see.',
        routeId: 'standard-ascent',
      },
      {
        id: 'van-allen',
        name: 'Van Allen Shear',
        kind: 'hazard',
        kmFromLegStart: 178_000,
        severity: 0.38,
        description:
          'Trapped particle belts. Every hour here is dose.',
      },
      {
        id: 'lunar-gateway',
        name: 'Lunar Gateway',
        kind: 'station',
        kmFromLegStart: 384_000,
        severity: 0,
        description:
          'The last true port. Cores, spares, one last chance to turn back.',
      },
    ],
  },
  {
    index: 1,
    title: 'THE DEBRIS BELT',
    from: 'Lunar Gateway',
    to: 'L1 Waystation',
    baseKm: 1_120_000,
    baseKmPerDay: 75_000,
    sceneKey: 'debris-belt',
    routes: [
      {
        id: 'cleared-corridor',
        name: 'Cleared Corridor',
        distanceMultiplier: 1.22,
        severityMultiplier: 0.6,
        description:
          'Longer, but the sky is empty. Has a station.',
        hasStation: true,
      },
      {
        id: 'the-graveyard',
        name: 'The Graveyard',
        distanceMultiplier: 0.9,
        severityMultiplier: 1.5,
        description:
          'Straight through eighty years of dead satellites. Salvage is real out here. So is the shrapnel.',
        hasStation: false,
      },
    ],
    waypoints: [
      {
        id: 'kessler-belt',
        name: 'Kessler Belt',
        kind: 'hazard',
        kmFromLegStart: 340_000,
        severity: 0.55,
        description:
          'Ten thousand tracked objects, and no map of the rest.',
      },
      {
        id: 'graveyard-drift',
        name: 'Graveyard Drift',
        kind: 'harvest',
        kmFromLegStart: 690_000,
        severity: 0.3,
        description:
          'Tanks that were never drained. Cut them open and you eat.',
        routeId: 'the-graveyard',
      },
      {
        id: 'l1-waystation',
        name: 'L1 Waystation',
        kind: 'station',
        kmFromLegStart: 1_120_000,
        severity: 0,
        description:
          'Expensive, and nothing is fresh.',
      },
    ],
  },
  {
    index: 2,
    title: 'THE DEEP QUIET',
    from: 'L1 Waystation',
    to: 'Asteroid Fringe',
    baseKm: 90_000_000,
    baseKmPerDay: 2_000_000,
    sceneKey: 'deep-quiet',
    routes: [
      {
        id: 'sunward-arc',
        name: 'Sunward Arc',
        distanceMultiplier: 0.88,
        severityMultiplier: 1.6,
        description:
          'Cuts inside the transfer for speed and pays for it in radiation. Flares will find you here.',
        hasStation: false,
      },
      {
        id: 'shadow-track',
        name: 'Shadow Track',
        distanceMultiplier: 1.14,
        severityMultiplier: 0.7,
        description:
          'The long way around, running cold and dark. Kinder to the crew, crueller to the calendar.',
        hasStation: false,
      },
    ],
    waypoints: [
      {
        id: 'flare-corridor',
        name: 'Solar Flare Corridor',
        kind: 'hazard',
        kmFromLegStart: 24_000_000,
        severity: 0.62,
        description:
          'No shelter out here but shielding and luck.',
      },
      {
        id: 'ice-field',
        name: 'Cometary Ice Field',
        kind: 'harvest',
        kmFromLegStart: 51_000_000,
        severity: 0.2,
        description:
          'Water, if someone goes out and takes it.',
      },
      {
        id: 'cosmic-deep',
        name: 'The Cosmic Deep',
        kind: 'hazard',
        kmFromLegStart: 72_000_000,
        severity: 0.45,
        description:
          'No landmarks. This is where crews come apart.',
      },
      {
        id: 'asteroid-fringe',
        name: 'Asteroid Fringe',
        kind: 'landmark',
        kmFromLegStart: 90_000_000,
        severity: 0,
        description: 'After eleven weeks of nothing, even a rock is company.',
      },
    ],
  },
  {
    index: 3,
    title: 'THE ASTEROID FRINGE',
    from: 'Asteroid Fringe',
    to: 'Phobos Approach',
    baseKm: 90_000_000,
    baseKmPerDay: 2_000_000,
    sceneKey: 'asteroid-fringe',
    routes: [
      {
        id: 'ceres-lane',
        name: 'Ceres Lane',
        distanceMultiplier: 1.18,
        severityMultiplier: 0.75,
        description: 'Detours to the depot. Fuel, spares, and a hot meal cooked by someone else.',
        hasStation: true,
      },
      {
        id: 'direct-crossing',
        name: 'Direct Crossing',
        distanceMultiplier: 0.94,
        severityMultiplier: 1.4,
        description:
          'Threads the fringe at speed with no port to fall back on. Fast, and entirely on your own.',
        hasStation: false,
      },
    ],
    waypoints: [
      {
        id: 'rubble-shoal',
        name: 'The Rubble Shoal',
        kind: 'hazard',
        kmFromLegStart: 28_000_000,
        severity: 0.58,
        description: 'Uncharted collision debris, all of it moving.',
      },
      {
        id: 'ceres-depot',
        name: 'Ceres Depot',
        kind: 'station',
        kmFromLegStart: 55_000_000,
        severity: 0,
        description:
          'The only fresh vegetables between here and Mars.',
        routeId: 'ceres-lane',
      },
      {
        id: 'meteor-sleet',
        name: 'Micrometeoroid Sleet',
        kind: 'hazard',
        kmFromLegStart: 78_000_000,
        severity: 0.5,
        description:
          'You will not see the one that matters.',
      },
    ],
  },
  {
    index: 4,
    title: 'MARS APPROACH',
    from: 'Phobos Approach',
    to: 'Ares Basin',
    baseKm: 45_000_000,
    baseKmPerDay: 1_300_000,
    sceneKey: 'mars-approach',
    routes: [
      {
        id: 'phobos-brake',
        name: 'Phobos Brake',
        distanceMultiplier: 1.1,
        severityMultiplier: 0.65,
        description:
          'Dock at Phobos, top off, and drop under control. The safe descent, if you still have the days.',
        hasStation: true,
      },
      {
        id: 'direct-aerobrake',
        name: 'Direct Aerobrake',
        distanceMultiplier: 0.85,
        severityMultiplier: 1.55,
        description:
          'One pass through the upper atmosphere at interplanetary speed. Everything rides on the heat shield.',
        hasStation: false,
      },
    ],
    waypoints: [
      {
        id: 'phobos-station',
        name: 'Phobos Station',
        kind: 'station',
        kmFromLegStart: 18_000_000,
        severity: 0,
        description:
          'The colony reads your manifest before you dock.',
        routeId: 'phobos-brake',
      },
      {
        id: 'orbital-insertion',
        name: 'Mars Orbital Insertion',
        kind: 'hazard',
        kmFromLegStart: 34_000_000,
        severity: 0.6,
        description:
          'One burn, one window. Miss it and you sail past.',
      },
      {
        id: 'ares-descent',
        name: 'Ares Basin Descent',
        kind: 'finale',
        kmFromLegStart: 45_000_000,
        severity: 0.62,
        description:
          'Aerobrake, then powered descent. Then ground.',
      },
    ],
  },
];

/** Resolve the waypoints active for a leg given the chosen route. */
export function activeWaypoints(leg: Leg, routeId: string | null) {
  return leg.waypoints.filter((wp) => !wp.routeId || wp.routeId === routeId);
}

export function professionById(id: ProfessionId): Profession {
  const found = PROFESSIONS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown profession: ${id}`);
  return found;
}

/**
 * Waypoints the player can fly themselves instead of resolving with a card.
 *
 * Kept in the pure sim, next to the waypoints it names, so the simulation and
 * the flight model agree on the set without either importing the other. The
 * remaining hazards — the Van Allen Shear, the flare corridor, the Cosmic
 * Deep, and orbital insertion — stay pure decision cards, so the pacing varies
 * rather than every waypoint becoming a dodge sequence.
 */
export const FLYABLE_WAYPOINTS: Record<string, string> = {
  'kessler-belt': 'kessler',
  'rubble-shoal': 'asteroid-fringe',
  'meteor-sleet': 'asteroid-fringe',
  'ares-descent': 'mars-descent',
};

export function flightSequenceFor(waypointId: string): string | null {
  return FLYABLE_WAYPOINTS[waypointId] ?? null;
}

export const TOTAL_MISSION_KM = LEGS.reduce((sum, leg) => sum + leg.baseKm, 0);
