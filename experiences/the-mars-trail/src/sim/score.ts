/** THE MARS TRAIL — final scoring, in the spirit of the original's tally. */

import { TRANSFER_WINDOW_DAYS } from './content';
import { livingCrew } from './state';
import type { GameState } from './types';

export interface ScoreLine {
  label: string;
  detail: string;
  points: number;
}

export interface ScoreReport {
  lines: ScoreLine[];
  subtotal: number;
  multiplier: number;
  total: number;
  rating: string;
  outcomeHeadline: string;
}

export function scoreRun(state: GameState): ScoreReport {
  const lines: ScoreLine[] = [];
  const survivors = livingCrew(state);
  const arrived = state.outcome === 'arrived';

  // Crew is worth far more than cargo, as in the original.
  const crewPoints = survivors.reduce((sum, m) => sum + 100 + Math.round((m.health / 100) * 250), 0);
  lines.push({
    label: 'Surviving crew',
    detail: `${survivors.length} of ${state.crew.length}, scored on arrival health`,
    points: crewPoints,
  });

  const corePoints = state.ship.driveCores * 30;
  lines.push({
    label: 'Drive cores',
    detail: `${state.ship.driveCores} still running`,
    points: corePoints,
  });

  const rationPoints = Math.floor(state.inventory.rationsKg / 100) * 10;
  lines.push({
    label: 'Rations remaining',
    detail: `${Math.round(state.inventory.rationsKg)} kg`,
    points: rationPoints,
  });

  const waterPoints = Math.floor(state.inventory.waterL / 100) * 5;
  lines.push({
    label: 'Water remaining',
    detail: `${Math.round(state.inventory.waterL)} L`,
    points: waterPoints,
  });

  const cellPoints = Math.floor(state.inventory.propellantCells);
  lines.push({
    label: 'Propellant',
    detail: `${Math.floor(state.inventory.propellantCells)} cells`,
    points: cellPoints,
  });

  const sparePoints =
    state.ship.coolantPumps * 12 +
    state.ship.heatShield * 20 +
    state.ship.commsArray * 15 +
    state.ship.hullPlates * 10 +
    state.inventory.radSuits * 6;
  lines.push({
    label: 'Spares and shielding',
    detail: 'Pumps, shield sets, arrays, plates, suits',
    points: sparePoints,
  });

  const creditPoints = Math.floor(state.inventory.credits / 5);
  lines.push({
    label: 'Credits on hand',
    detail: `${Math.round(state.inventory.credits)} credits`,
    points: creditPoints,
  });

  const hullPoints = arrived ? Math.round(state.ship.hullIntegrity * 1.5) : 0;
  lines.push({
    label: 'Ship condition',
    detail: arrived ? `${Math.round(state.ship.hullIntegrity)}% hull integrity` : 'Ship did not arrive',
    points: hullPoints,
  });

  const arrivalPoints = arrived ? 500 : 0;
  lines.push({
    label: 'Reached Ares Basin',
    detail: arrived ? 'Mission accomplished' : 'Never made planetfall',
    points: arrivalPoints,
  });

  const daysUsed = TRANSFER_WINDOW_DAYS - state.windowDaysLeft;
  const timePoints = arrived ? Math.max(0, state.windowDaysLeft) * 4 : 0;
  lines.push({
    label: 'Window remaining',
    detail: arrived ? `${Math.max(0, state.windowDaysLeft)} days spare after ${daysUsed} in transit` : '—',
    points: timePoints,
  });

  const subtotal = lines.reduce((sum, line) => sum + line.points, 0);
  const multiplier = state.profession?.scoreMultiplier ?? 1;
  const total = subtotal * multiplier;

  return {
    lines,
    subtotal,
    multiplier,
    total,
    rating: ratingFor(total, arrived, state),
    outcomeHeadline: headlineFor(state),
  };
}

/**
 * The rating has to describe the actual ending, not just success or failure.
 * Going adrift or missing the window usually leaves the crew alive and well —
 * reporting that as "Lost With All Hands" is simply untrue, and it is the most
 * common way to lose.
 */
function ratingFor(total: number, arrived: boolean, state: GameState): string {
  if (!arrived) {
    const survivors = livingCrew(state).length;
    if (survivors === 0) return 'Lost With All Hands';
    switch (state.outcome) {
      case 'adrift':
        return survivors === state.crew.length
          ? 'Adrift With A Living Crew'
          : `Adrift — ${survivors} Still Aboard`;
      case 'window-closed':
        return survivors === state.crew.length
          ? 'Marooned In Transit'
          : `Marooned — ${survivors} Still Aboard`;
      default:
        return `Lost — ${survivors} Still Aboard`;
    }
  }
  if (total >= 6000) return 'Colony Founder';
  if (total >= 4200) return 'Master Of The Crossing';
  if (total >= 2800) return 'Veteran Captain';
  if (total >= 1600) return 'Competent Captain';
  if (total >= 800) return 'Survivor';
  return 'Barely Aboard';
}

function headlineFor(state: GameState): string {
  const survivors = livingCrew(state).length;
  switch (state.outcome) {
    case 'arrived':
      return survivors === state.crew.length
        ? 'ARES BASIN — ALL HANDS DELIVERED'
        : `ARES BASIN — ${survivors} OF ${state.crew.length} DELIVERED`;
    case 'lost-crew':
      return 'NO SURVIVORS';
    case 'window-closed':
      return 'THE WINDOW CLOSED';
    case 'adrift':
      return 'ADRIFT — NO DRIVE';
    default:
      return 'MISSION IN PROGRESS';
  }
}
