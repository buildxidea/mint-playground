/** THE MARS TRAIL — state construction, formatting, and derived selectors. */

import {
  CREW_SIZE,
  DEFAULT_CREW_NAMES,
  LEGS,
  TRANSFER_WINDOW_DAYS,
  activeWaypoints,
} from './content';
import type {
  CrewMember,
  GameState,
  Leg,
  Profession,
  RouteOption,
  Waypoint,
} from './types';

/** Departure is 14 March 2091 — the opening of the transfer window. */
const DEPARTURE = { year: 2091, month: 2, day: 14 };

const MONTH_NAMES = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface MissionDate {
  year: number;
  monthIndex: number;
  day: number;
  monthLabel: string;
}

/** Convert a mission day (1-based) into a calendar date. */
export function missionDate(missionDay: number): MissionDate {
  let year = DEPARTURE.year;
  let monthIndex = DEPARTURE.month;
  let day = DEPARTURE.day + (missionDay - 1);

  for (;;) {
    const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const length = monthIndex === 1 && isLeap ? 29 : MONTH_LENGTHS[monthIndex];
    if (day <= length) break;
    day -= length;
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }

  return { year, monthIndex, day, monthLabel: MONTH_NAMES[monthIndex] };
}

export function formatMissionDate(missionDay: number): string {
  const d = missionDate(missionDay);
  return `${d.monthLabel} ${d.day}, ${d.year}`;
}

/**
 * Distance readout that stays legible across four orders of magnitude — the
 * early legs are thousands of km, the deep legs are tens of millions.
 */
export function formatDistance(km: number): string {
  const value = Math.max(0, km);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mkm`;
  if (value >= 1_000) return `${Math.round(value / 1_000).toLocaleString('en-US')}k km`;
  return `${Math.round(value).toLocaleString('en-US')} km`;
}

export function createCrew(names: string[]): CrewMember[] {
  const resolved = names.length === CREW_SIZE ? names : DEFAULT_CREW_NAMES;
  return resolved.map((name, index) => ({
    id: `crew-${index}`,
    name,
    portraitKey: `crew-portrait-${index + 1}`,
    health: 100,
    energy: 100,
    hygiene: 100,
    morale: 100,
    radDose: 0,
    illness: 'none' as const,
    illnessDays: 0,
    alive: true,
    diedOnDay: null,
    causeOfDeath: null,
  }));
}

export function createInitialState(): GameState {
  return {
    phase: 'title',
    profession: null,
    crew: createCrew(DEFAULT_CREW_NAMES),
    ship: {
      driveCores: 0,
      driveCoreWear: [],
      hullIntegrity: 100,
      heatShield: 0,
      coolantPumps: 0,
      commsArray: 0,
      hullPlates: 0,
    },
    inventory: {
      rationsKg: 0,
      waterL: 0,
      propellantCells: 0,
      radSuits: 0,
      credits: 0,
    },
    weather: {
      solarActivity: 0.3,
      flareRisk: 0.1,
      debrisDensity: 0.2,
      label: 'Quiet',
    },
    day: 1,
    windowDaysLeft: TRANSFER_WINDOW_DAYS,
    legIndex: 0,
    routeId: null,
    kmIntoLeg: 0,
    kmTotal: 0,
    nextWaypointIndex: 0,
    burnRate: 'standard',
    rations: 'filling',
    activeEvent: null,
    log: [],
    outcome: 'in-progress',
    score: 0,
    voluntaryCamp: false,
    retroFilterUnlocked: false,
  };
}

export function applyProfession(state: GameState, profession: Profession): void {
  state.profession = profession;
  state.inventory.credits = profession.startingCredits;
  if (profession.id === 'homesteader') {
    // Seed stock: a small standing hydroponics yield, applied in the tick.
    state.inventory.rationsKg += 60;
  }
  if (profession.id === 'engineer') {
    state.ship.coolantPumps += 1;
    state.ship.hullPlates += 1;
  }
}

export function currentLeg(state: GameState): Leg {
  return LEGS[Math.min(state.legIndex, LEGS.length - 1)];
}

export function currentRoute(state: GameState): RouteOption | null {
  const leg = currentLeg(state);
  return leg.routes.find((route) => route.id === state.routeId) ?? null;
}

/** Total distance of the current leg after the chosen route's multiplier. */
export function legDistance(state: GameState): number {
  const leg = currentLeg(state);
  const route = currentRoute(state);
  return leg.baseKm * (route?.distanceMultiplier ?? 1);
}

export function legWaypoints(state: GameState): Waypoint[] {
  return activeWaypoints(currentLeg(state), state.routeId);
}

export function nextWaypoint(state: GameState): Waypoint | null {
  const waypoints = legWaypoints(state);
  return waypoints[state.nextWaypointIndex] ?? null;
}

/**
 * Distance to the next waypoint, scaled by the route multiplier so a longer
 * route genuinely reads as further away on the HUD.
 */
export function kmToNextWaypoint(state: GameState): number {
  const waypoint = nextWaypoint(state);
  if (!waypoint) return Math.max(0, legDistance(state) - state.kmIntoLeg);
  const leg = currentLeg(state);
  const scale = legDistance(state) / leg.baseKm;
  return Math.max(0, waypoint.kmFromLegStart * scale - state.kmIntoLeg);
}

export function livingCrew(state: GameState): CrewMember[] {
  return state.crew.filter((member) => member.alive);
}

export function isRunOver(state: GameState): boolean {
  return state.outcome !== 'in-progress';
}

export function pushLog(
  state: GameState,
  text: string,
  tone: 'neutral' | 'good' | 'bad' | 'fatal' = 'neutral',
): void {
  state.log.push({ day: state.day, date: formatMissionDate(state.day), text, tone });
  // The log is a scrolling journal; cap it so a long run cannot grow unbounded.
  if (state.log.length > 220) state.log.splice(0, state.log.length - 220);
}
