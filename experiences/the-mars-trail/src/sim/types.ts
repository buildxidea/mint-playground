/**
 * THE MARS TRAIL — simulation types.
 *
 * This module and the rest of `src/sim` are pure TypeScript with no Three.js or
 * DOM dependency so the whole attrition model stays unit-testable outside a
 * browser. Rendering and UI observe this state; they never own it.
 */

export type BurnRate = 'coasting' | 'standard' | 'hard';
export type RationLevel = 'filling' | 'meager' | 'bare';

/** Named crew ailments. `none` keeps the union total for exhaustive switches. */
export type Illness =
  | 'none'
  | 'radiation-sickness'
  | 'hypoxia'
  | 'bone-density-collapse'
  | 'space-adaptation-syndrome'
  | 'cabin-psychosis'
  | 'hydroponics-blight'
  | 'decompression-trauma';

export type ProfessionId = 'financier' | 'engineer' | 'homesteader';

export interface Profession {
  id: ProfessionId;
  name: string;
  /** Starting credits. Lower start = higher score multiplier, as in the original. */
  startingCredits: number;
  scoreMultiplier: number;
  blurb: string;
  /** Passive advantage granted at outfitting. */
  perk: string;
}

export interface CrewMember {
  id: string;
  name: string;
  /** Registry key for the generated portrait, resolved by the UI layer. */
  portraitKey: string;
  health: number;
  energy: number;
  hygiene: number;
  morale: number;
  /** Cumulative absorbed dose, 0-100. Only ever rises unless shielded and rested. */
  radDose: number;
  illness: Illness;
  /** Days the current illness has persisted, used for recovery and mortality rolls. */
  illnessDays: number;
  alive: boolean;
  /** Mission day the member died, for the memorial on the score screen. */
  diedOnDay: number | null;
  causeOfDeath: string | null;
}

export interface ShipState {
  /** Working drive cores. Wear accumulates per core; a failed core is removed. */
  driveCores: number;
  driveCoreWear: number[];
  hullIntegrity: number;
  heatShield: number;
  coolantPumps: number;
  commsArray: number;
  hullPlates: number;
}

export interface Inventory {
  rationsKg: number;
  waterL: number;
  propellantCells: number;
  radSuits: number;
  credits: number;
}

export interface SpaceWeather {
  /** 0-1 solar activity. Drives flare risk and rad accumulation. */
  solarActivity: number;
  /** 0-1 chance-weighting for a flare event on any given day. */
  flareRisk: number;
  /** 0-1 micrometeoroid and debris density for the current stretch. */
  debrisDensity: number;
  label: string;
}

export type WaypointKind = 'station' | 'hazard' | 'landmark' | 'harvest' | 'finale';

export interface Waypoint {
  id: string;
  name: string;
  kind: WaypointKind;
  /** Distance from the start of its leg, in km. */
  kmFromLegStart: number;
  /** 0-1 base severity for hazard traversal rolls. */
  severity: number;
  /** Flavour shown on the arrival card. */
  description: string;
  /** Set on branch waypoints; only reachable when the matching route is chosen. */
  routeId?: string;
}

export interface RouteOption {
  id: string;
  name: string;
  /** Multiplier applied to the leg's base distance. */
  distanceMultiplier: number;
  /** Multiplier applied to every hazard severity on this route. */
  severityMultiplier: number;
  description: string;
  /** True when the route passes a resupply station. */
  hasStation: boolean;
}

export interface Leg {
  index: number;
  title: string;
  /** Start and end place names, shown on the star chart. */
  from: string;
  to: string;
  baseKm: number;
  /** Base travel rate before burn-rate and drive-core modifiers. */
  baseKmPerDay: number;
  /** Scene palette key consumed by the renderer. */
  sceneKey: string;
  routes: RouteOption[];
  waypoints: Waypoint[];
}

export interface StoreItem {
  id: string;
  name: string;
  unit: string;
  /** Credits per unit at the outfitting yard. Stations apply a markup. */
  basePrice: number;
  /** Units added to inventory per purchase step. */
  step: number;
  description: string;
}

export type Phase =
  | 'title'
  | 'profession'
  | 'crew-naming'
  | 'outfitting'
  | 'leg-select'
  | 'travel'
  | 'event'
  | 'hazard'
  | 'station'
  | 'harvest'
  | 'camp'
  | 'arrived'
  | 'lost';

export interface EventChoice {
  id: string;
  label: string;
  /** Optional cost gate; the choice is disabled when unaffordable. */
  requires?: Partial<Pick<Inventory, 'credits' | 'propellantCells' | 'rationsKg'>>;
  /** Informational tone renders amber instead of green. */
  tone?: 'primary' | 'info';
}

export interface GameEvent {
  id: string;
  title: string;
  body: string;
  choices: EventChoice[];
  /** Set when the event is a waypoint arrival rather than a random roll. */
  waypointId?: string;
}

export interface LogEntry {
  day: number;
  date: string;
  text: string;
  tone: 'neutral' | 'good' | 'bad' | 'fatal';
}

export interface GameState {
  phase: Phase;
  profession: Profession | null;
  crew: CrewMember[];
  ship: ShipState;
  inventory: Inventory;
  weather: SpaceWeather;

  /** Mission day 1 is departure day. */
  day: number;
  /** Days remaining before the transfer window closes. */
  windowDaysLeft: number;

  legIndex: number;
  /** Chosen route for the current leg, null until leg-select resolves. */
  routeId: string | null;
  /** Distance covered inside the current leg, km. */
  kmIntoLeg: number;
  /** Total distance covered across the whole mission, km. */
  kmTotal: number;
  /** Index of the next waypoint within the current leg's active waypoint list. */
  nextWaypointIndex: number;

  burnRate: BurnRate;
  rations: RationLevel;

  /** Pending modal event, if any. */
  activeEvent: GameEvent | null;
  log: LogEntry[];

  /** Set when the run ends, drives the score screen. */
  outcome: 'in-progress' | 'arrived' | 'lost-crew' | 'window-closed' | 'adrift';
  score: number;

  /**
   * True while the player is camped by choice rather than at a waypoint, so
   * leaving camp resumes travel instead of consuming the next waypoint.
   */
  voluntaryCamp: boolean;

  /** Unlocked once the run ends, enabling the monochrome filter. */
  retroFilterUnlocked: boolean;
}

export interface TickResult {
  /** Days actually advanced. Usually 1, more when resting or waiting. */
  daysAdvanced: number;
  /** Waypoint reached during this tick, if any. */
  reachedWaypoint: Waypoint | null;
  /** Random event triggered during this tick, if any. */
  triggeredEvent: GameEvent | null;
  newLogEntries: LogEntry[];
}
