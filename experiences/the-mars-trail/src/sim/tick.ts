/**
 * THE MARS TRAIL — the daily attrition engine.
 *
 * One call to `advanceDay` is one mission day. Everything that grinds the crew
 * down lives here: distance, consumption, drive wear, stat drift, dose,
 * illness, mortality, and space weather. Randomness is injected so the whole
 * model is reproducible under a seed.
 */

import {
  BURN_RATE_FATIGUE,
  BURN_RATE_SPEED,
  BURN_RATE_WEAR,
  ILLNESS_NAMES,
  ILLNESS_SEVERITY,
  RATION_CONSUMPTION,
  WATER_CONSUMPTION,
} from './content';
import { rollEvent } from './events';
import {
  currentLeg,
  currentRoute,
  formatDistance,
  kmToNextWaypoint,
  legDistance,
  legWaypoints,
  livingCrew,
  pushLog,
} from './state';
import type { CrewMember, GameState, Illness, LogEntry, TickResult } from './types';

export type Rng = () => number;

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

/** Nominal drive-core count. Above it you gain speed; below it you lose a lot. */
const NOMINAL_CORES = 4;

/** Wear at which a core fails outright. */
const CORE_FAILURE_WEAR = 100;

export function driveEfficiency(state: GameState): number {
  const cores = state.ship.driveCores;
  if (cores <= 0) return 0;
  // Two cores still move the ship, just slowly. Six is meaningfully faster
  // than four, but with diminishing return so stacking cores is not a solve.
  const ratio = cores / NOMINAL_CORES;
  return clamp(0.42 + 0.58 * Math.min(ratio, 1) + 0.12 * Math.max(0, ratio - 1), 0, 1.28);
}

export function kmPerDay(state: GameState): number {
  const leg = currentLeg(state);
  const crewFactor = crewCapability(state);
  return leg.baseKmPerDay * BURN_RATE_SPEED[state.burnRate] * driveEfficiency(state) * crewFactor;
}

/** A sick, exhausted crew cannot hold a burn schedule. 0.55 - 1.0. */
function crewCapability(state: GameState): number {
  const crew = livingCrew(state);
  if (crew.length === 0) return 0;
  const avg =
    crew.reduce((sum, m) => sum + (m.health * 0.6 + m.energy * 0.4) / 100, 0) / crew.length;
  const crewedFraction = crew.length / state.crew.length;
  return clamp(0.55 + 0.45 * avg * (0.6 + 0.4 * crewedFraction), 0, 1) as number;
}

/** Space weather takes a slow random walk so streaks of bad luck feel authored. */
function evolveWeather(state: GameState, rng: Rng): void {
  const route = currentRoute(state);
  const leg = currentLeg(state);

  // Sunward routes and the inner legs run hotter.
  const solarBias = route?.id === 'sunward-arc' ? 0.22 : route?.id === 'shadow-track' ? -0.14 : 0;
  const legBias = leg.index <= 1 ? -0.05 : leg.index === 2 ? 0.12 : 0.04;

  const drift = (rng() - 0.5) * 0.24;
  state.weather.solarActivity = clamp(
    state.weather.solarActivity + drift + solarBias * 0.05 + legBias * 0.03,
    0.05,
    1,
  );
  state.weather.flareRisk = clamp(
    state.weather.solarActivity * 0.7 + (rng() - 0.5) * 0.1,
    0,
    1,
  );
  state.weather.debrisDensity = clamp(
    (leg.index <= 1 ? 0.5 : 0.15) + (rng() - 0.5) * 0.2,
    0,
    1,
  );

  const a = state.weather.solarActivity;
  state.weather.label =
    a > 0.8 ? 'Severe Storm' : a > 0.6 ? 'Active' : a > 0.38 ? 'Unsettled' : a > 0.2 ? 'Quiet' : 'Calm';
}

function wearDriveCores(state: GameState, rng: Rng, entries: LogEntry[]): void {
  const engineerBonus = state.profession?.id === 'engineer' ? 0.8 : 1;
  // The drive load is shared across installed cores, so a six-core ship wears
  // each core far slower than a two-core ship running the same burn. Without
  // this the cores all fail on the same day and buying spares buys nothing.
  const cores = Math.max(1, state.ship.driveCoreWear.length);
  const loadShare = NOMINAL_CORES / cores;
  const perDay = BURN_RATE_WEAR[state.burnRate] * engineerBonus * loadShare;

  for (let i = state.ship.driveCoreWear.length - 1; i >= 0; i -= 1) {
    // Uneven wear so cores fail one at a time rather than all at once.
    state.ship.driveCoreWear[i] += perDay * (0.7 + rng() * 0.7);

    if (state.ship.driveCoreWear[i] >= CORE_FAILURE_WEAR) {
      state.ship.driveCoreWear.splice(i, 1);
      state.ship.driveCores = Math.max(0, state.ship.driveCores - 1);

      if (state.ship.coolantPumps > 0 && rng() < 0.45) {
        state.ship.coolantPumps -= 1;
        state.ship.driveCores += 1;
        state.ship.driveCoreWear.push(55);
        entries.push(logEntry(state, 'A drive core seized. You rebuilt it around a spare coolant pump.', 'neutral'));
      } else {
        entries.push(
          logEntry(
            state,
            `A drive core burned out. ${state.ship.driveCores} still running.`,
            state.ship.driveCores <= 1 ? 'fatal' : 'bad',
          ),
        );
      }
    }
  }
}

function consumeSupplies(state: GameState, entries: LogEntry[]): { starving: boolean; thirsty: boolean } {
  const crew = livingCrew(state);
  const headcount = crew.length;
  if (headcount === 0) return { starving: false, thirsty: false };

  const rationNeed = RATION_CONSUMPTION[state.rations] * headcount;
  const waterNeed = WATER_CONSUMPTION * headcount;

  // Homesteader seed stock keeps a trickle coming in.
  if (state.profession?.id === 'homesteader') {
    state.inventory.rationsKg += 1.6;
  }

  const starving = state.inventory.rationsKg < rationNeed;
  const thirsty = state.inventory.waterL < waterNeed;

  state.inventory.rationsKg = Math.max(0, state.inventory.rationsKg - rationNeed);
  state.inventory.waterL = Math.max(0, state.inventory.waterL - waterNeed);

  // Station-keeping and course corrections burn a slow trickle of propellant.
  const burnCost = state.burnRate === 'hard' ? 0.55 : state.burnRate === 'standard' ? 0.3 : 0.15;
  state.inventory.propellantCells = Math.max(0, state.inventory.propellantCells - burnCost);

  if (starving) entries.push(logEntry(state, 'Rations did not cover the day. The crew went hungry.', 'bad'));
  if (thirsty) entries.push(logEntry(state, 'Water reclaim fell short. Rationing is now involuntary.', 'bad'));

  return { starving, thirsty };
}

function driftCrewStats(
  state: GameState,
  rng: Rng,
  starving: boolean,
  thirsty: boolean,
): void {
  const fatigue = BURN_RATE_FATIGUE[state.burnRate];
  const rationQuality =
    state.rations === 'filling' ? 1 : state.rations === 'meager' ? 0.55 : 0.2;
  const suitCoverage = Math.min(1, state.inventory.radSuits / Math.max(1, livingCrew(state).length));
  const leg = currentLeg(state);
  const commsOut = state.ship.commsArray <= 0;

  for (const member of state.crew) {
    if (!member.alive) continue;

    // Energy: burned by pace, restored by food.
    member.energy = clamp(member.energy - fatigue * 1.4 + rationQuality * 2);

    // Hygiene only ever falls in transit; camp and stations restore it.
    member.hygiene = clamp(member.hygiene - 0.42 - rng() * 0.22);

    // Dose accumulates with solar activity and is blunted, never stopped, by suits.
    const doseRate = state.weather.solarActivity * (1 - suitCoverage * 0.62);
    member.radDose = clamp(member.radDose + doseRate * 0.5);

    // Morale: the Deep Quiet is the psychological low point of the run.
    const isolation = leg.index === 2 ? 1.15 : leg.index === 3 ? 0.7 : 0.35;
    let moraleDelta = -isolation * 0.8 + rationQuality * 1.1;
    if (commsOut) moraleDelta -= 1.4;
    if (member.hygiene < 30) moraleDelta -= 0.7;
    if (member.energy < 25) moraleDelta -= 0.6;
    member.morale = clamp(member.morale + moraleDelta);

    // Health follows the other four plus outright deprivation.
    let healthDelta = 0;
    if (starving) healthDelta -= 4.2;
    if (thirsty) healthDelta -= 5;
    if (member.energy < 20) healthDelta -= 1.6;
    if (member.hygiene < 20) healthDelta -= 1.1;
    if (member.morale < 20) healthDelta -= 1.2;
    if (member.radDose > 55) healthDelta -= (member.radDose - 55) * 0.055;
    if (healthDelta === 0 && member.illness === 'none') {
      // Slow recovery on a good day, so a careful captain can climb back.
      healthDelta += rationQuality * 1.3;
    }
    member.health = clamp(member.health + healthDelta);
  }
}

/** Candidate illnesses weighted by the conditions that actually cause them. */
function illnessWeights(state: GameState, member: CrewMember): Array<[Illness, number]> {
  const suitCoverage = Math.min(1, state.inventory.radSuits / Math.max(1, livingCrew(state).length));
  const leg = currentLeg(state);
  // Dose only becomes dangerous once it is genuinely high — a linear term here
  // makes radiation sickness a certainty inside a month, which it must not be.
  const doseOver = Math.max(0, member.radDose - 25) / 100;

  return [
    ['radiation-sickness', doseOver * doseOver * 0.06 * (1 - suitCoverage * 0.4)],
    ['hypoxia', state.ship.hullIntegrity < 70 ? (70 - state.ship.hullIntegrity) * 0.0006 : 0.0001],
    // Long-haul microgravity risk, capped so it never becomes an inevitability.
    ['bone-density-collapse', Math.min(0.0022, Math.max(0, state.day - 90) * 0.00003)],
    ['space-adaptation-syndrome', state.day < 30 ? 0.003 : 0.0003],
    ['cabin-psychosis', member.morale < 45 ? (45 - member.morale) * 0.00028 + (leg.index === 2 ? 0.0009 : 0) : 0],
    ['hydroponics-blight', state.rations === 'bare' ? 0.0035 : state.rations === 'meager' ? 0.001 : 0.0002],
    ['decompression-trauma', state.weather.debrisDensity * 0.0009],
  ];
}

function rollIllness(state: GameState, rng: Rng, entries: LogEntry[]): void {
  for (const member of state.crew) {
    if (!member.alive || member.illness !== 'none') continue;

    // Poor hygiene and low health raise susceptibility across the board.
    const susceptibility =
      1 + (100 - member.health) * 0.008 + (100 - member.hygiene) * 0.004;

    for (const [illness, weight] of illnessWeights(state, member)) {
      if (weight <= 0) continue;
      if (rng() < weight * susceptibility) {
        member.illness = illness;
        member.illnessDays = 0;
        entries.push(
          logEntry(state, `${member.name} has come down with ${ILLNESS_NAMES[illness]}.`, 'bad'),
        );
        break;
      }
    }
  }
}

function progressIllness(state: GameState, rng: Rng, entries: LogEntry[]): void {
  for (const member of state.crew) {
    if (!member.alive || member.illness === 'none') continue;

    const severity = ILLNESS_SEVERITY[member.illness];
    member.illnessDays += 1;
    member.health = clamp(member.health - severity.drain);

    // Mortality rises as health falls — the same arbitrary cruelty as the original.
    const mortality = severity.mortality * (1 + (100 - member.health) * 0.015);
    if (member.health <= 0 || rng() < mortality) {
      killCrew(state, member, ILLNESS_NAMES[member.illness], entries);
      continue;
    }

    // Recovery becomes possible once the crew member is fed, rested, and clean.
    const recoveryChance =
      0.06 +
      (member.health / 100) * 0.1 +
      (state.rations === 'filling' ? 0.05 : 0) +
      (member.hygiene > 60 ? 0.03 : 0) +
      (member.illnessDays > 6 ? 0.04 : 0) +
      // Fixing the cause makes the symptom survivable.
      (member.illness === 'hypoxia' && state.ship.hullIntegrity > 70 ? 0.12 : 0);
    if (rng() < recoveryChance) {
      entries.push(logEntry(state, `${member.name} has recovered from ${ILLNESS_NAMES[member.illness]}.`, 'good'));
      member.illness = 'none';
      member.illnessDays = 0;
      member.health = clamp(member.health + 8);
    }
  }
}

export function killCrew(
  state: GameState,
  member: CrewMember,
  cause: string,
  entries: LogEntry[],
): void {
  member.alive = false;
  member.health = 0;
  member.diedOnDay = state.day;
  member.causeOfDeath = cause;
  entries.push(logEntry(state, `${member.name} has died of ${cause}.`, 'fatal'));

  // Grief spreads. Every death costs the survivors morale.
  for (const other of state.crew) {
    if (other.alive) other.morale = clamp(other.morale - 12);
  }
}

function logEntry(
  state: GameState,
  text: string,
  tone: LogEntry['tone'],
): LogEntry {
  return { day: state.day, date: '', text, tone };
}

/**
 * Advance one mission day. Returns what happened so the caller can raise the
 * matching UI: a waypoint arrival, a random event, or neither.
 */
export function advanceDay(state: GameState, rng: Rng): TickResult {
  const entries: LogEntry[] = [];

  if (state.outcome !== 'in-progress') {
    return { daysAdvanced: 0, reachedWaypoint: null, triggeredEvent: null, newLogEntries: [] };
  }

  state.day += 1;
  state.windowDaysLeft -= 1;

  evolveWeather(state, rng);

  // Distance is capped at the next waypoint so arrivals always resolve cleanly.
  const travel = kmPerDay(state);
  const gate = kmToNextWaypoint(state);
  const moved = Math.min(travel, gate);
  state.kmIntoLeg += moved;
  state.kmTotal += moved;

  wearDriveCores(state, rng, entries);
  const { starving, thirsty } = consumeSupplies(state, entries);
  driftCrewStats(state, rng, starving, thirsty);
  rollIllness(state, rng, entries);
  progressIllness(state, rng, entries);

  if (state.ship.driveCores <= 0) {
    entries.push(logEntry(state, 'The last drive core is dead. The ship is adrift.', 'fatal'));
  }

  // Waypoint arrival takes priority over a random event so the two never stack.
  let reachedWaypoint = null as TickResult['reachedWaypoint'];
  const waypoints = legWaypoints(state);
  const pending = waypoints[state.nextWaypointIndex];
  if (pending && gate - moved <= 0.5) {
    reachedWaypoint = pending;
    entries.push(logEntry(state, `Reached ${pending.name}.`, 'neutral'));
  }

  let triggeredEvent = null as TickResult['triggeredEvent'];
  if (!reachedWaypoint) {
    triggeredEvent = rollEvent(state, rng);
  }

  resolveOutcome(state, entries);

  for (const entry of entries) pushLog(state, entry.text, entry.tone);

  return { daysAdvanced: 1, reachedWaypoint, triggeredEvent, newLogEntries: entries };
}

export function resolveOutcome(state: GameState, entries: LogEntry[]): void {
  if (state.outcome !== 'in-progress') return;

  if (livingCrew(state).length === 0) {
    state.outcome = 'lost-crew';
    state.phase = 'lost';
    entries.push(logEntry(state, 'No one is left to fly the ship.', 'fatal'));
    return;
  }

  if (state.windowDaysLeft <= 0) {
    state.outcome = 'window-closed';
    state.phase = 'lost';
    entries.push(
      logEntry(state, 'The transfer window has closed. Mars is no longer where you aimed.', 'fatal'),
    );
    return;
  }

  // Losing every core is terminal and gets its own outcome label.
  if (state.ship.driveCores <= 0) {
    state.outcome = 'adrift';
    state.phase = 'lost';
    entries.push(logEntry(state, 'No drive cores left. The ship is adrift and will not arrive.', 'fatal'));
  }
}

/** Rest in place: burns days, restores the crew. Used by camp and station stops. */
export function restDays(state: GameState, days: number, rng: Rng): LogEntry[] {
  const entries: LogEntry[] = [];
  for (let i = 0; i < days; i += 1) {
    if (state.outcome !== 'in-progress') break;
    state.day += 1;
    state.windowDaysLeft -= 1;
    evolveWeather(state, rng);
    const { starving, thirsty } = consumeSupplies(state, entries);

    for (const member of state.crew) {
      if (!member.alive) continue;
      member.energy = clamp(member.energy + (starving ? 3 : 9));
      member.morale = clamp(member.morale + (starving ? 0.5 : 3.2));
      if (!starving && !thirsty) member.health = clamp(member.health + 2.6);
    }

    progressIllness(state, rng, entries);
    resolveOutcome(state, entries);
  }
  for (const entry of entries) pushLog(state, entry.text, entry.tone);
  return entries;
}

/** Human-readable travel summary for the HUD and log. */
export function travelSummary(state: GameState): string {
  return `${formatDistance(kmPerDay(state))}/day · ${formatDistance(
    Math.max(0, legDistance(state) - state.kmIntoLeg),
  )} left this leg`;
}
