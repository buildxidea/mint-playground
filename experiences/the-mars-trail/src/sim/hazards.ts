/**
 * THE MARS TRAIL — hazard traversals.
 *
 * These are the river crossings. Four options with the original's risk shape:
 * burn through (fast, free, dangerous), creep (slow, safe-ish), pay for an
 * escort (credits), or hold for a window (days only). Outcome probability is
 * severity x space weather x drive condition, which is the direct analogue of
 * river depth x weather.
 */

import { killCrew } from './tick';
import { flightSequenceFor } from './content';
import { currentRoute, livingCrew, pushLog } from './state';
import type { GameState, LogEntry, Waypoint } from './types';

type Rng = () => number;

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export type HazardOptionId = 'burn' | 'fly' | 'creep' | 'escort' | 'hold';

/**
 * Map flight performance onto a hazard grade.
 *
 * Skill replaces the dice for this option only; the consequences it feeds are
 * the same ones every other option feeds.
 */
export function flightGrade(performance: number): HazardResolution['grade'] {
  if (performance >= 0.62) return 'clean';
  if (performance >= 0.28) return 'setback';
  return 'disaster';
}

export interface HazardOption {
  id: HazardOptionId;
  label: string;
  detail: string;
  /** Multiplies effective severity. Below 1 is safer. */
  riskMultiplier: number;
  days: number;
  propellantCells: number;
  credits: number;
  available: boolean;
  unavailableReason?: string;
}

export interface HazardResolution {
  grade: 'clean' | 'setback' | 'disaster';
  headline: string;
  detail: string;
  entries: LogEntry[];
}

/** Escort price scales with how dangerous the crossing actually is. */
function escortPrice(state: GameState, waypoint: Waypoint): number {
  const base = 60 + waypoint.severity * 220;
  const discount = state.profession?.id === 'financier' ? 0.85 : 1;
  return Math.round(base * discount);
}

export function hazardOptions(state: GameState, waypoint: Waypoint): HazardOption[] {
  const price = escortPrice(state, waypoint);
  const creepCells = Math.round(8 + waypoint.severity * 22);
  const isFinale = waypoint.kind === 'finale';
  const flyable = flightSequenceFor(waypoint.id) !== null;

  const options: HazardOption[] = [];

  // Flying is offered FIRST, in the slot burn-through occupies elsewhere.
  // The QA sweep drives the overlay by clicking the last enabled button, so an
  // option appended at the end would be taken blindly by automation that
  // cannot actually fly.
  if (flyable) {
    options.push({
      id: 'fly',
      label: isFinale ? 'Fly the descent yourself' : 'Fly it yourself',
      detail: isFinale
        ? 'Take the stick and thread the canyon onto the pad. How well you fly is how well it goes.'
        : 'Take the stick. No escort, no waiting — how well you fly is how well it goes.',
      riskMultiplier: 1,
      days: 0,
      // Manoeuvring burns real margin, so skill is never a free win against
      // the options that cost credits or days.
      propellantCells: 4,
      credits: 0,
      available: state.inventory.propellantCells >= 4,
      unavailableReason: 'Needs 4 propellant cells',
    });
  }

  const rest: HazardOption[] = [
    {
      id: 'burn',
      label: isFinale ? 'Commit to the descent' : 'Burn straight through',
      detail: isFinale
        ? 'One pass. Everything rides on the heat shield.'
        : 'Fast, free, no margin.',
      riskMultiplier: 1,
      days: 0,
      propellantCells: 0,
      credits: 0,
      available: true,
    },
    {
      id: 'creep',
      label: isFinale ? 'Multi-pass aerobrake' : 'Creep through on thrusters',
      detail: isFinale
        ? 'Several passes. Kinder to the shield, costs days.'
        : 'Slow and safe. Costs days and propellant.',
      riskMultiplier: 0.45,
      days: 3,
      propellantCells: creepCells,
      credits: 0,
      available: state.inventory.propellantCells >= creepCells,
      unavailableReason: `Needs ${creepCells} propellant cells`,
    },
    {
      id: 'escort',
      label: isFinale ? 'Buy a colony talkdown' : 'Hire a tug escort',
      detail: isFinale
        ? 'They fly you in. Expensive, near-safe.'
        : 'A cleared lane and someone else\'s radar. Expensive and very nearly safe.',
      riskMultiplier: 0.16,
      days: 1,
      propellantCells: 0,
      credits: price,
      available: state.inventory.credits >= price,
      unavailableReason: `Needs ${price} credits`,
    },
    {
      id: 'hold',
      label: 'Hold for a clean window',
      detail: 'Wait it out. Costs only days.',
      riskMultiplier: 0.3,
      days: 6,
      propellantCells: 2,
      credits: 0,
      available: state.windowDaysLeft > 10,
      unavailableReason: 'Not enough window left to wait',
    },
  ];

  // Burning straight through is replaced by flying where a sequence exists —
  // omitted rather than disabled, so it cannot be silently selected.
  options.push(...rest.filter((option) => !(flyable && option.id === 'burn')));
  return options;
}

/** Effective severity after route, weather, and ship condition. */
export function effectiveSeverity(state: GameState, waypoint: Waypoint): number {
  const route = currentRoute(state);
  const routeFactor = route?.severityMultiplier ?? 1;
  const weatherFactor = 0.75 + state.weather.solarActivity * 0.3 + state.weather.debrisDensity * 0.25;
  const hullFactor = 1 + (100 - state.ship.hullIntegrity) * 0.004;
  const driveFactor = state.ship.driveCores <= 2 ? 1.25 : 1;
  return clamp(waypoint.severity * routeFactor * weatherFactor * hullFactor * driveFactor, 0, 1.6) as number;
}

export function resolveHazard(
  state: GameState,
  waypoint: Waypoint,
  optionId: HazardOptionId,
  rng: Rng,
  /**
   * Flight performance, 0-1, when the player flew this hazard.
   *
   * Left undefined the `fly` option behaves exactly like burning through —
   * same risk multiplier, same dice. That is what lets the headless balance
   * harness, the autoplay bots, and an aborted sequence all resolve a flyable
   * waypoint without a renderer and without shifting the statistics.
   */
  performance?: number,
): HazardResolution {
  const entries: LogEntry[] = [];
  const available = hazardOptions(state, waypoint);
  let option = available.find((entry) => entry.id === optionId);

  if (!option) {
    // An unrecognised option must never be a free pass. This is reachable now
    // that `burn` is omitted at flyable waypoints: any caller still asking for
    // it — an old bot policy, a stale save — would otherwise be handed a clean
    // transit at no cost. Fall back to the riskiest real option instead.
    option =
      available.find((entry) => entry.id === 'burn') ??
      available.find((entry) => entry.id === 'fly') ??
      available[0];
    if (!option) {
      return { grade: 'clean', headline: 'Nothing happened.', detail: '', entries };
    }
  }

  // Pay the cost first so a disaster still leaves the player poorer.
  state.inventory.propellantCells = Math.max(0, state.inventory.propellantCells - option.propellantCells);
  state.inventory.credits = Math.max(0, state.inventory.credits - option.credits);
  if (option.days > 0) {
    state.day += option.days;
    state.windowDaysLeft -= option.days;
  }

  const isFinale = waypoint.kind === 'finale';

  // The finale is gated on the heat shield rather than on generic severity.
  let risk = effectiveSeverity(state, waypoint) * option.riskMultiplier;
  if (isFinale) {
    if (state.ship.heatShield <= 0) risk = Math.max(risk, 0.72);
    else risk *= Math.max(0.26, 1 - (state.ship.heatShield - 1) * 0.22);
  }

  const roll = rng();

  // Skill replaces the roll only when a flight was actually flown.
  const flown = optionId === 'fly' && performance !== undefined;
  const grade = flown ? flightGrade(performance) : null;

  if (flown ? grade === 'clean' : roll >= risk) {
    const headline = isFinale ? 'DOWN AND INTACT' : 'CLEAN TRANSIT';
    const detail = isFinale
      ? 'The shield holds, the chutes bite, and the ship settles onto the pad at Ares Basin.'
      : `${waypoint.name} is behind you with nothing broken and nobody hurt.`;
    for (const member of state.crew) {
      if (member.alive) member.morale = clamp(member.morale + 6);
    }
    entries.push({ day: state.day, date: '', text: `${waypoint.name}: clean transit.`, tone: 'good' });
    pushLog(state, `${waypoint.name}: clean transit.`, 'good');
    return { grade: 'clean', headline, detail, entries };
  }

  if (flown ? grade === 'setback' : roll >= risk * 0.34) {
    return applySetback(state, waypoint, rng, entries);
  }

  return applyDisaster(state, waypoint, rng, entries);
}

function applySetback(
  state: GameState,
  waypoint: Waypoint,
  rng: Rng,
  entries: LogEntry[],
): HazardResolution {
  const kind = rng();
  let detail: string;

  if (kind < 0.3) {
    const damage = Math.round(10 + rng() * 18);
    state.ship.hullIntegrity = clamp(state.ship.hullIntegrity - damage);
    if (state.ship.hullPlates > 0) state.ship.hullPlates -= 1;
    detail = `You come through scraped and venting. Hull integrity down ${damage} points.`;
  } else if (kind < 0.55) {
    const lostRations = Math.round(Math.min(state.inventory.rationsKg, 70 + rng() * 140));
    const lostWater = Math.round(Math.min(state.inventory.waterL, 90 + rng() * 180));
    state.inventory.rationsKg -= lostRations;
    state.inventory.waterL -= lostWater;
    detail = `A cargo tie parted under load. ${lostRations} kg of rations and ${lostWater} L of water lost overboard.`;
  } else if (kind < 0.78) {
    state.ship.driveCoreWear = state.ship.driveCoreWear.map((w) => w + 20 + rng() * 18);
    detail = 'The cores took the strain of every correction. Real wear on all of them.';
  } else {
    const days = Math.round(3 + rng() * 5);
    state.day += days;
    state.windowDaysLeft -= days;
    for (const member of state.crew) {
      if (member.alive) member.energy = clamp(member.energy - 16);
    }
    detail = `You lose ${days} days fighting your way clear, and the crew is wrung out.`;
  }

  for (const member of state.crew) {
    if (member.alive) member.morale = clamp(member.morale - 8);
  }

  entries.push({ day: state.day, date: '', text: `${waypoint.name}: setback.`, tone: 'bad' });
  pushLog(state, `${waypoint.name}: ${detail}`, 'bad');
  return { grade: 'setback', headline: 'YOU GOT THROUGH', detail, entries };
}

function applyDisaster(
  state: GameState,
  waypoint: Waypoint,
  rng: Rng,
  entries: LogEntry[],
): HazardResolution {
  const isFinale = waypoint.kind === 'finale';
  const crew = livingCrew(state);

  const damage = Math.round(28 + rng() * 34);
  state.ship.hullIntegrity = clamp(state.ship.hullIntegrity - damage);

  let detail: string;

  if (isFinale) {
    // A failed descent is catastrophic but survivable if the shield held at all.
    const shieldless = state.ship.heatShield <= 0;
    // Even a botched descent leaves survivors in the aft section unless the
    // ship went in with no shield at all.
    const casualties = shieldless
      ? Math.max(2, Math.floor(crew.length * 0.7))
      : Math.max(1, Math.floor(crew.length * 0.4));
    for (let i = 0; i < casualties && i < crew.length; i += 1) {
      killCrew(state, crew[i], 'the descent', entries);
    }
    detail = shieldless
      ? 'Without a shield the hull opened at forty kilometres. Nothing reached the ground intact.'
      : 'The shield failed late. What lands at Ares Basin is a wreck, and not everyone is in it.';
  } else {
    const roll = rng();
    if (roll < 0.42 && crew.length > 0) {
      const victim = crew[Math.floor(rng() * crew.length)];
      killCrew(state, victim, waypoint.kind === 'hazard' ? 'a hull strike' : 'the crossing', entries);
      detail = `A strike opened the mid-section. Hull integrity down ${damage}, and the crew is one fewer.`;
    } else if (roll < 0.72) {
      const coresLost = Math.min(state.ship.driveCores, 1 + (rng() < 0.3 ? 1 : 0));
      state.ship.driveCores -= coresLost;
      state.ship.driveCoreWear.splice(0, coresLost);
      detail = `${coresLost} drive core${coresLost > 1 ? 's' : ''} destroyed outright. Hull integrity down ${damage}.`;
    } else {
      const lostRations = Math.round(state.inventory.rationsKg * (0.35 + rng() * 0.3));
      const lostCells = Math.round(state.inventory.propellantCells * (0.4 + rng() * 0.3));
      state.inventory.rationsKg -= lostRations;
      state.inventory.propellantCells -= lostCells;
      state.ship.heatShield = Math.max(0, state.ship.heatShield - 1);
      detail = `The cargo bay is opened to vacuum. ${lostRations} kg of rations and ${lostCells} propellant cells gone, and a shield set with them.`;
    }
    const days = Math.round(4 + rng() * 7);
    state.day += days;
    state.windowDaysLeft -= days;
  }

  for (const member of state.crew) {
    if (member.alive) member.morale = clamp(member.morale - 18);
  }

  entries.push({ day: state.day, date: '', text: `${waypoint.name}: disaster.`, tone: 'fatal' });
  pushLog(state, `${waypoint.name}: ${detail}`, 'fatal');
  return { grade: 'disaster', headline: isFinale ? 'HARD IMPACT' : 'IT WENT BADLY', detail, entries };
}
