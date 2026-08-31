/**
 * Autonomous playthrough policies for THE MARS TRAIL.
 *
 * Used for bot playtesting and for capturing genuine end-of-run states without
 * clicking through 270 in-game days by hand. These drive the real simulation
 * through the real commands — nothing here bypasses a rule or writes an
 * outcome directly, so an ending produced by a bot is an ending a player could
 * actually reach.
 */

import type { MarsTrailSim } from './index';
import type { BurnRate, ProfessionId, RationLevel } from './types';

export type AutoplayStyle = 'careful' | 'reckless' | 'starve' | 'dawdle';

interface Policy {
  profession: ProfessionId;
  burn: BurnRate;
  rations: RationLevel;
  buy: Array<[string, number]>;
  /** Service worn drive cores at camp. The habit that decides most runs. */
  maintain: boolean;
  /** Prefer safe hazard options over burning through. */
  cautiousHazards: boolean;
  /** Flex rations against remaining food. */
  adaptiveRations: boolean;
  /**
   * Always take the slowest safe option — hold at every hazard and camp at any
   * excuse. Models a captain who never accepts risk and runs out of calendar.
   */
  stall?: boolean;
}

const POLICIES: Record<AutoplayStyle, Policy> = {
  // Reaches Mars most of the time.
  careful: {
    profession: 'financier',
    burn: 'standard',
    rations: 'filling',
    buy: [
      ['driveCores', 5],
      ['heatShield', 1],
      ['rationsKg', 12],
      ['waterL', 8],
      ['radSuits', 2],
    ],
    maintain: true,
    cautiousHazards: true,
    adaptiveRations: true,
  },
  // Two cores and no servicing: burns them out and goes adrift.
  reckless: {
    profession: 'financier',
    burn: 'hard',
    rations: 'filling',
    buy: [
      ['driveCores', 2],
      ['heatShield', 1],
      ['rationsKg', 10],
      ['waterL', 8],
    ],
    maintain: false,
    cautiousHazards: false,
    adaptiveRations: false,
  },
  // Barely any food, no shielding, always burns through: kills the crew.
  starve: {
    profession: 'homesteader',
    burn: 'hard',
    rations: 'bare',
    buy: [
      ['driveCores', 3],
      ['rationsKg', 1],
      ['waterL', 2],
    ],
    maintain: false,
    cautiousHazards: false,
    adaptiveRations: false,
  },
  // Coasts, camps constantly, holds at every hazard: runs out of window.
  dawdle: {
    profession: 'financier',
    burn: 'coasting',
    rations: 'filling',
    buy: [
      ['driveCores', 5],
      ['heatShield', 1],
      ['rationsKg', 12],
      ['waterL', 8],
    ],
    maintain: true,
    cautiousHazards: true,
    adaptiveRations: false,
    stall: true,
  },
};

export interface AutoplayResult {
  outcome: string;
  steps: number;
  day: number;
  leg: number;
  survivors: number;
}

/**
 * Play a complete run under the given style. Returns once the simulation
 * reaches a terminal outcome or the step guard trips.
 */
export function autoplay(sim: MarsTrailSim, style: AutoplayStyle, seed: number): AutoplayResult {
  const policy = POLICIES[style];
  sim.reset(seed);
  sim.beginProfessionSelect();
  sim.chooseProfession(policy.profession);
  sim.nameCrew([]);

  for (const [itemId, steps] of policy.buy) {
    for (let i = 0; i < steps; i += 1) sim.buy(itemId, false);
  }
  sim.setBurnRate(policy.burn);
  sim.setRations(policy.rations);

  const departure = sim.depart();
  if (!departure.ok) {
    return { outcome: 'no-departure', steps: 0, day: sim.get().day, leg: 1, survivors: 5 };
  }

  const GUARD = 4000;
  let steps = 0;

  while (sim.get().outcome === 'in-progress' && steps < GUARD) {
    steps += 1;
    const state = sim.get();

    switch (state.phase) {
      case 'leg-select': {
        const leg = sim.leg();
        const route = policy.cautiousHazards
          ? (leg.routes.find((r) => r.hasStation) ?? leg.routes[0])
          : leg.routes.reduce((a, b) => (a.distanceMultiplier <= b.distanceMultiplier ? a : b));
        sim.chooseRoute(route.id);
        break;
      }

      case 'travel': {
        if (policy.adaptiveRations) {
          const alive = state.crew.filter((m) => m.alive).length || 1;
          const daysAhead = Math.max(1, Math.round(state.windowDaysLeft * 0.6));
          const need = 2 * alive * daysAhead;
          if (state.inventory.rationsKg > need) sim.setRations('filling');
          else if (state.inventory.rationsKg > need * 0.55) sim.setRations('meager');
          else sim.setRations('bare');
        }

        const worn = state.ship.driveCoreWear.some((w) => w > 55);
        const tired = state.crew.some(
          (m) => m.alive && (m.hygiene < 35 || m.energy < 30 || m.morale < 35),
        );
        const holed = state.ship.hullIntegrity < 70 && state.ship.hullPlates > 0;
        const shouldCamp = policy.maintain ? worn || tired || holed : tired;

        // The staller camps at every excuse; that is how it burns its window.
        const campFloor = policy.stall ? 4 : 60;
        if ((shouldCamp || policy.stall) && state.windowDaysLeft > campFloor) sim.makeCamp();
        else sim.step();
        break;
      }

      case 'event':
        sim.chooseEventOption(state.activeEvent?.choices[0]?.id ?? '');
        break;

      case 'hazard': {
        const options = sim.hazardOptions();
        const pick = policy.stall
          ? // Six days of station-keeping rather than one day of paid escort.
            (options.find((o) => o.id === 'hold' && o.available) ??
            options.find((o) => o.id === 'creep' && o.available) ??
            options[0])
          : policy.cautiousHazards
            ? (options.find((o) => o.id === 'escort' && o.available) ??
              options.find((o) => o.id === 'creep' && o.available) ??
              options.find((o) => o.id === 'hold' && o.available) ??
              options[0])
            : options[0];
        sim.resolveHazard(pick.id);
        if (sim.get().outcome === 'in-progress') sim.leaveWaypoint();
        break;
      }

      case 'station':
        if (policy.cautiousHazards) {
          if (state.inventory.rationsKg < 700) sim.buy('rationsKg', true);
          if (state.ship.heatShield < 2) sim.buy('heatShield', true);
          if (state.ship.hullIntegrity < 75) sim.stationService('hull-repair');
          if (state.crew.some((m) => m.alive && m.illness !== 'none')) sim.stationService('medical');
        }
        sim.leaveWaypoint();
        break;

      case 'harvest':
        sim.harvest(0.55);
        sim.leaveWaypoint();
        break;

      case 'camp': {
        const alive = state.crew.filter((m) => m.alive);
        const worstHygiene = alive.length ? Math.min(...alive.map((m) => m.hygiene)) : 100;
        let option = 'hydroponics';
        if (policy.maintain && state.ship.driveCoreWear.some((w) => w > 55)) option = 'maintenance';
        else if (state.ship.hullIntegrity < 70 && state.ship.hullPlates > 0) option = 'hull-patch';
        else if (worstHygiene < 45 && state.inventory.waterL >= 60) option = 'hygiene';
        sim.campOption(option);
        sim.leaveWaypoint();
        break;
      }

      default:
        steps = GUARD;
        break;
    }
  }

  const final = sim.get();
  return {
    outcome: final.outcome,
    steps,
    day: final.day,
    leg: final.legIndex + 1,
    survivors: final.crew.filter((m) => m.alive).length,
  };
}
