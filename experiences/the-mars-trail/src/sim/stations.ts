/**
 * THE MARS TRAIL — stations, campsites, and volatile harvesting.
 *
 * Stations are the forts: everything is available and everything is marked up.
 * Campsites are the between-waypoint decision layer, trading days for stats.
 * Harvesting is the hunting minigame, with the original's carry cap so it
 * cannot be ground for infinite food.
 */

import { STORE_ITEMS } from './content';
import { livingCrew, pushLog } from './state';
import type { GameState, StoreItem } from './types';

type Rng = () => number;

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

/** Markup rises with distance from Earth. Financiers negotiate it down. */
export function stationMarkup(state: GameState): number {
  const base = 1.35 + state.legIndex * 0.28;
  const discount = state.profession?.id === 'financier' ? 0.85 : 1;
  return base * discount;
}

export function stationPrice(state: GameState, item: StoreItem): number {
  const price = item.basePrice * stationMarkup(state);
  // Keep sub-credit goods readable to two decimals, everything else whole.
  return item.basePrice < 1 ? Math.round(price * 100) / 100 : Math.round(price);
}

export interface PurchaseResult {
  ok: boolean;
  message: string;
}

/** Apply a purchase of one `step` of the given item at the given unit price. */
export function purchase(
  state: GameState,
  itemId: string,
  unitPrice: number,
): PurchaseResult {
  const item = STORE_ITEMS.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, message: 'No such item.' };

  const cost = Math.round(unitPrice * item.step * 100) / 100;
  if (state.inventory.credits < cost) {
    return { ok: false, message: `Not enough credits for ${item.step} ${item.unit}.` };
  }

  state.inventory.credits = Math.round((state.inventory.credits - cost) * 100) / 100;

  switch (itemId) {
    case 'driveCores':
      state.ship.driveCores += item.step;
      for (let i = 0; i < item.step; i += 1) state.ship.driveCoreWear.push(0);
      break;
    case 'rationsKg':
      state.inventory.rationsKg += item.step;
      break;
    case 'waterL':
      state.inventory.waterL += item.step;
      break;
    case 'radSuits':
      state.inventory.radSuits += item.step;
      break;
    case 'propellantCells':
      state.inventory.propellantCells += item.step;
      break;
    case 'coolantPumps':
      state.ship.coolantPumps += item.step;
      break;
    case 'heatShield':
      state.ship.heatShield += item.step;
      break;
    case 'commsArray':
      state.ship.commsArray += item.step;
      break;
    case 'hullPlates':
      state.ship.hullPlates += item.step;
      break;
    default:
      return { ok: false, message: 'That item cannot be stowed.' };
  }

  return { ok: true, message: `Bought ${item.step} ${item.unit} of ${item.name}.` };
}

/**
 * Refund rates when selling stock back.
 *
 * At the yard you have not left yet, so adjusting the order is free — that is
 * the same forgiveness the original store gives you before departure. At a
 * station you are unloading cargo onto someone who knows you have no choice,
 * so it is a real loss and never a way to farm credits off the markup.
 */
export const YARD_REFUND_RATE = 1;
export const STATION_REFUND_RATE = 0.45;

/** How many units of an item are currently aboard. */
export function ownedCount(state: GameState, itemId: string): number {
  switch (itemId) {
    case 'driveCores':
      return state.ship.driveCores;
    case 'rationsKg':
      return state.inventory.rationsKg;
    case 'waterL':
      return state.inventory.waterL;
    case 'radSuits':
      return state.inventory.radSuits;
    case 'propellantCells':
      return state.inventory.propellantCells;
    case 'coolantPumps':
      return state.ship.coolantPumps;
    case 'heatShield':
      return state.ship.heatShield;
    case 'commsArray':
      return state.ship.commsArray;
    case 'hullPlates':
      return state.ship.hullPlates;
    default:
      return 0;
  }
}

/**
 * Minimum an item can be sold down to. Only drive cores have a floor, and only
 * once underway — the ship cannot be left unable to fly between ports.
 */
function refundFloor(itemId: string, atStation: boolean): number {
  if (itemId === 'driveCores' && atStation) return 2;
  return 0;
}

export function canRefund(state: GameState, itemId: string, atStation: boolean): boolean {
  return ownedCount(state, itemId) > refundFloor(itemId, atStation);
}

/**
 * Sell one purchase step back. Refunds proportionally when fewer than a full
 * step remains, so a part-filled hold can still be emptied.
 */
export function refund(
  state: GameState,
  itemId: string,
  unitPrice: number,
  rate: number,
  atStation: boolean,
): PurchaseResult {
  const item = STORE_ITEMS.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, message: 'No such item.' };

  const floor = refundFloor(itemId, atStation);
  const owned = ownedCount(state, itemId);
  const units = Math.min(item.step, owned - floor);

  if (units <= 0) {
    return {
      ok: false,
      message:
        itemId === 'driveCores' && atStation
          ? 'You cannot fly on fewer than two cores.'
          : `No ${item.name.toLowerCase()} to sell back.`,
    };
  }

  const value = Math.round(unitPrice * units * rate * 100) / 100;
  state.inventory.credits = Math.round((state.inventory.credits + value) * 100) / 100;

  switch (itemId) {
    case 'driveCores':
      state.ship.driveCores -= units;
      // Drop the most worn cores first; you would not sell your best ones.
      state.ship.driveCoreWear.sort((a, b) => a - b).splice(state.ship.driveCores, units);
      break;
    case 'rationsKg':
      state.inventory.rationsKg -= units;
      break;
    case 'waterL':
      state.inventory.waterL -= units;
      break;
    case 'radSuits':
      state.inventory.radSuits -= units;
      break;
    case 'propellantCells':
      state.inventory.propellantCells -= units;
      break;
    case 'coolantPumps':
      state.ship.coolantPumps -= units;
      break;
    case 'heatShield':
      state.ship.heatShield -= units;
      break;
    case 'commsArray':
      state.ship.commsArray -= units;
      break;
    case 'hullPlates':
      state.ship.hullPlates -= units;
      break;
    default:
      return { ok: false, message: 'That item cannot be sold back.' };
  }

  return {
    ok: true,
    message: `Sold back ${Math.round(units)} ${item.unit} for ${value} credits.`,
  };
}

export interface StationService {
  id: string;
  label: string;
  detail: string;
  credits: number;
  days: number;
  available: boolean;
}

export function stationServices(state: GameState): StationService[] {
  const refitPrice = Math.round(70 * stationMarkup(state));
  const hullPrice = Math.round(90 * stationMarkup(state));
  return [
    {
      id: 'refit-cores',
      label: 'Refit the drive cores',
      detail: 'Every core rebuilt to near-new.',
      credits: refitPrice,
      days: 3,
      available: state.inventory.credits >= refitPrice && state.ship.driveCores > 0,
    },
    {
      id: 'hull-repair',
      label: 'Pressure-test and reweld the hull',
      detail: 'Hull back to full.',
      credits: hullPrice,
      days: 4,
      available: state.inventory.credits >= hullPrice && state.ship.hullIntegrity < 100,
    },
    {
      id: 'shore-leave',
      label: 'Shore leave',
      detail: 'Real gravity, hot water, and someone else\'s cooking. The crew comes back different.',
      credits: Math.round(40 * stationMarkup(state)),
      days: 5,
      available: state.inventory.credits >= Math.round(40 * stationMarkup(state)),
    },
    {
      id: 'medical',
      label: 'Station infirmary',
      detail: 'Treats all illness, flushes dose.',
      credits: Math.round(110 * stationMarkup(state)),
      days: 4,
      available:
        state.inventory.credits >= Math.round(110 * stationMarkup(state)) &&
        state.crew.some((m) => m.alive && (m.illness !== 'none' || m.radDose > 25)),
    },
  ];
}

export function applyStationService(state: GameState, serviceId: string): string {
  const service = stationServices(state).find((entry) => entry.id === serviceId);
  if (!service || !service.available) return 'The yard turns you away.';

  state.inventory.credits -= service.credits;
  state.day += service.days;
  state.windowDaysLeft -= service.days;

  switch (serviceId) {
    case 'refit-cores':
      state.ship.driveCoreWear = state.ship.driveCoreWear.map(() => 4);
      pushLog(state, 'Drive cores refitted to near-new wear.', 'good');
      return 'Every core comes back inside factory tolerance.';
    case 'hull-repair':
      state.ship.hullIntegrity = 100;
      state.ship.hullPlates += 1;
      pushLog(state, 'Hull rewelded and pressure-tested.', 'good');
      return 'The hull is sound again, and they threw in a spare plate.';
    case 'shore-leave':
      for (const member of state.crew) {
        if (!member.alive) continue;
        member.morale = clamp(member.morale + 34);
        member.hygiene = 100;
        member.energy = clamp(member.energy + 30);
      }
      pushLog(state, 'Shore leave taken. Morale restored.', 'good');
      return 'Five days of gravity and hot water. They come back like people again.';
    case 'medical': {
      let treated = 0;
      for (const member of state.crew) {
        if (!member.alive) continue;
        if (member.illness !== 'none') treated += 1;
        member.illness = 'none';
        member.illnessDays = 0;
        member.radDose = clamp(member.radDose * 0.35);
        member.health = clamp(member.health + 22);
      }
      pushLog(state, `Infirmary treated ${treated} illnesses and flushed dose.`, 'good');
      return `The infirmary clears ${treated} active case${treated === 1 ? '' : 's'} and chelates everyone down to a survivable dose.`;
    }
    default:
      return 'Nothing was done.';
  }
}

export interface CampOption {
  id: string;
  label: string;
  detail: string
  days: number;
  available: boolean;
}

export function campOptions(state: GameState): CampOption[] {
  return [
    {
      id: 'hygiene',
      label: 'Run a hygiene cycle',
      detail: 'Restores hygiene. Costs water.',
      days: 2,
      available: state.inventory.waterL >= 60,
    },
    {
      id: 'hydroponics',
      label: 'Tend the hydroponics',
      detail: 'Yields rations, lifts morale.',
      days: 2,
      available: true,
    },
    {
      id: 'maintenance',
      label: 'Drive maintenance',
      detail: 'Rolls back core wear. The habit that decides most runs.',
      days: 3,
      available: state.ship.driveCores > 0,
    },
    {
      id: 'hull-patch',
      label: 'Patch the hull',
      detail: 'Weld plates over every breach you can find. The only repair available between ports.',
      days: 2,
      available: state.ship.hullPlates > 0 && state.ship.hullIntegrity < 100,
    },
    {
      id: 'rest',
      label: 'Stand down and rest',
      detail: 'Energy and morale recover.',
      days: 4,
      available: true,
    },
  ];
}

export function applyCampOption(state: GameState, optionId: string, rng: Rng): string {
  const option = campOptions(state).find((entry) => entry.id === optionId);
  if (!option || !option.available) return 'Not possible right now.';

  state.day += option.days;
  state.windowDaysLeft -= option.days;

  switch (optionId) {
    case 'hygiene':
      state.inventory.waterL = Math.max(0, state.inventory.waterL - 60);
      for (const member of state.crew) {
        if (!member.alive) continue;
        member.hygiene = 100;
        member.morale = clamp(member.morale + 10);
      }
      pushLog(state, 'Hygiene cycle run. The ship smells like a ship again.', 'good');
      return 'Clean crew, clean filters. It costs water and it is always worth it.';
    case 'hydroponics': {
      const homesteader = state.profession?.id === 'homesteader';
      const yieldKg = Math.round((homesteader ? 95 : 55) + rng() * 45);
      state.inventory.rationsKg += yieldKg;
      for (const member of state.crew) {
        if (member.alive) member.morale = clamp(member.morale + 6);
      }
      pushLog(state, `Hydroponics tended: ${yieldKg} kg.`, 'good');
      return `${yieldKg} kg off the racks, and two days of everyone having something to do.`;
    }
    case 'maintenance':
      state.ship.driveCoreWear = state.ship.driveCoreWear.map((w) => Math.max(0, w - 32));
      for (const member of state.crew) {
        if (member.alive) member.energy = clamp(member.energy - 8);
      }
      pushLog(state, 'Drive maintenance completed.', 'good');
      return 'Every core re-seated and cleaned. Tiring work that buys you weeks.';
    case 'hull-patch': {
      const engineer = state.profession?.id === 'engineer';
      const platesUsed = engineer ? 1 : Math.min(state.ship.hullPlates, 2);
      state.ship.hullPlates -= platesUsed;
      const restored = engineer ? 46 : 30;
      state.ship.hullIntegrity = clamp(state.ship.hullIntegrity + restored);
      for (const member of state.crew) {
        if (member.alive) member.energy = clamp(member.energy - 10);
      }
      pushLog(state, `Hull patched: integrity up ${restored}.`, 'good');
      return `Two days of welding and ${platesUsed} plate${platesUsed === 1 ? '' : 's'}. Integrity up ${restored} points.`;
    }
    case 'rest':
      for (const member of state.crew) {
        if (!member.alive) continue;
        member.energy = 100;
        member.morale = clamp(member.morale + 20);
        member.health = clamp(member.health + 10);
      }
      pushLog(state, 'Crew stood down for four days.', 'good');
      return 'Four days of nothing at all. It works better than any of them expected.';
    default:
      return 'Nothing was done.';
  }
}

/** Propellant cost of a single harvest EVA. */
export const HARVEST_CELL_COST = 6;

/**
 * Carry cap, in kg. Straight from the original's 100 lb hunting limit: you can
 * only bring back so much regardless of how well the run goes.
 */
export const HARVEST_CARRY_CAP = 120;

export interface HarvestResult {
  rationsKg: number;
  waterL: number;
  message: string;
  cappedBy: boolean;
}

/**
 * Resolve a harvest EVA. `accuracy` is 0-1 from the aiming minigame; the sim
 * turns it into yield, then applies the carry cap.
 */
export function resolveHarvest(state: GameState, accuracy: number, rng: Rng): HarvestResult {
  if (state.inventory.propellantCells < HARVEST_CELL_COST) {
    return { rationsKg: 0, waterL: 0, cappedBy: false, message: 'Not enough propellant for the EVA.' };
  }
  state.inventory.propellantCells -= HARVEST_CELL_COST;
  state.day += 1;
  state.windowDaysLeft -= 1;

  const homesteaderBonus = state.profession?.id === 'homesteader' ? 1.3 : 1;
  const raw = (18 + accuracy * 190 * (0.85 + rng() * 0.3)) * homesteaderBonus;
  const cappedBy = raw > HARVEST_CARRY_CAP;
  const rationsKg = Math.round(Math.min(raw, HARVEST_CARRY_CAP));
  const waterL = Math.round(rationsKg * 2.4);

  state.inventory.rationsKg += rationsKg;
  state.inventory.waterL += waterL;

  for (const member of state.crew) {
    if (member.alive) member.energy = clamp(member.energy - 12);
  }

  // EVA means time outside the hull shielding.
  const suitCoverage = Math.min(1, state.inventory.radSuits / Math.max(1, livingCrew(state).length));
  for (const member of state.crew) {
    if (member.alive) member.radDose = clamp(member.radDose + 4 * (1 - suitCoverage * 0.6));
  }

  const message = cappedBy
    ? `You cut loose far more than the tether rig will carry. ${rationsKg} kg and ${waterL} L come aboard; the rest tumbles away.`
    : `${rationsKg} kg of volatiles and ${waterL} L of water recovered.`;

  pushLog(state, `Harvest EVA: ${rationsKg} kg, ${waterL} L.`, 'good');
  return { rationsKg, waterL, cappedBy, message };
}
