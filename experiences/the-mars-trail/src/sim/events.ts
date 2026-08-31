/**
 * THE MARS TRAIL — random event table.
 *
 * Events are authored as weighted definitions with resolvers. `rollEvent`
 * returns a UI-safe `GameEvent` (no functions), and `resolveEventChoice` looks
 * the definition back up to apply the consequence. Keeping the resolver out of
 * the state object means state stays serialisable.
 */

import { currentLeg, livingCrew, pushLog } from './state';
import type { GameEvent, GameState, Illness } from './types';

type Rng = () => number;

interface EventChoiceDef {
  id: string;
  label: string;
  tone?: 'primary' | 'info';
  requires?: { credits?: number; propellantCells?: number; rationsKg?: number };
  /** Applies the consequence and returns the outcome text shown to the player. */
  resolve: (state: GameState, rng: Rng) => string;
}

interface EventDef {
  id: string;
  title: string;
  body: (state: GameState) => string;
  /** Relative selection weight. Return 0 to make the event impossible right now. */
  weight: (state: GameState) => number;
  choices: EventChoiceDef[];
}

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function randomLiving(state: GameState, rng: Rng) {
  const crew = livingCrew(state);
  if (crew.length === 0) return null;
  return crew[Math.floor(rng() * crew.length)];
}

function adjustAll(
  state: GameState,
  key: 'health' | 'energy' | 'hygiene' | 'morale' | 'radDose',
  delta: number,
): void {
  for (const member of state.crew) {
    if (member.alive) member[key] = clamp(member[key] + delta);
  }
}

function afflict(state: GameState, illness: Illness, rng: Rng): string | null {
  const victim = randomLiving(state, rng);
  if (!victim || victim.illness !== 'none') return null;
  victim.illness = illness;
  victim.illnessDays = 0;
  return victim.name;
}

/** Skip a number of days without travelling. Returns the days actually lost. */
function loseDays(state: GameState, days: number): number {
  state.day += days;
  state.windowDaysLeft -= days;
  return days;
}

const EVENTS: EventDef[] = [
  {
    id: 'solar-flare',
    title: 'SOLAR FLARE INBOUND',
    body: (state) =>
      `An active region has flared. Particle front arrives in under an hour. Solar activity reads ${state.weather.label.toLowerCase()}, and you have ${state.inventory.radSuits} rad suits aboard for ${livingCrew(state).length} crew.`,
    weight: (state) => state.weather.flareRisk * 26,
    choices: [
      {
        id: 'shelter',
        label: 'Shelter in the water jacket',
        resolve: (state) => {
          const days = loseDays(state, 2);
          adjustAll(state, 'radDose', 3);
          adjustAll(state, 'morale', -4);
          return `You crowd the crew into the reclaim bay and wait it out. ${days} days lost, but the dose was small.`;
        },
      },
      {
        id: 'suits',
        label: 'Suit up and hold course',
        requires: {},
        resolve: (state, rng) => {
          const coverage = Math.min(1, state.inventory.radSuits / Math.max(1, livingCrew(state).length));
          const dose = 22 * (1 - coverage * 0.7);
          adjustAll(state, 'radDose', dose);
          if (coverage < 0.6 && rng() < 0.4) {
            const name = afflict(state, 'radiation-sickness', rng);
            if (name) return `You hold course. Shielding was thin, and ${name} is already showing symptoms.`;
          }
          return `You hold course through the front. Everyone takes dose, but the schedule survives.`;
        },
      },
      {
        id: 'run',
        label: 'Hard burn out of the cone',
        requires: { propellantCells: 14 },
        tone: 'info',
        resolve: (state) => {
          state.inventory.propellantCells -= 14;
          adjustAll(state, 'radDose', 6);
          adjustAll(state, 'energy', -8);
          return 'You spend propellant to angle out of the worst of it. Expensive, and it worked.';
        },
      },
    ],
  },
  {
    id: 'micrometeoroid',
    title: 'HULL BREACH',
    body: () =>
      'A grain of iron punched clean through the outer hull and out the far side. Atmosphere is venting through two holes you cannot see at once.',
    weight: (state) => 6 + state.weather.debrisDensity * 14,
    choices: [
      {
        id: 'patch',
        label: 'Patch with a hull plate',
        resolve: (state) => {
          if (state.ship.hullPlates <= 0) {
            state.ship.hullIntegrity = clamp(state.ship.hullIntegrity - 22);
            return 'You have no plates. The patch is sealant, tape, and hope. Integrity is down.';
          }
          state.ship.hullPlates -= 1;
          state.ship.hullIntegrity = clamp(state.ship.hullIntegrity - 4);
          loseDays(state, 1);
          return 'A clean patch on both sides. One plate spent, one day lost.';
        },
      },
      {
        id: 'seal',
        label: 'Seal the compartment',
        tone: 'info',
        resolve: (state, rng) => {
          state.ship.hullIntegrity = clamp(state.ship.hullIntegrity - 10);
          const lost = Math.round(40 + rng() * 90);
          state.inventory.rationsKg = Math.max(0, state.inventory.rationsKg - lost);
          return `You close the bulkhead and write off what was inside. ${lost} kg of rations lost with it.`;
        },
      },
      {
        id: 'eva',
        label: 'EVA repair now',
        resolve: (state, rng) => {
          state.ship.hullIntegrity = clamp(state.ship.hullIntegrity + 2);
          adjustAll(state, 'energy', -10);
          if (rng() < 0.22) {
            const name = afflict(state, 'decompression-trauma', rng);
            if (name) return `The repair holds, but ${name} took a suit tear doing it.`;
          }
          return 'Two crew go out and weld it properly. Exhausting, and the hull is sound.';
        },
      },
    ],
  },
  {
    id: 'coolant-leak',
    title: 'COOLANT LOOP FAILING',
    body: () =>
      'Pressure in the primary loop is falling. Left alone, the drive cores will cook themselves inside a week.',
    weight: () => 9,
    choices: [
      {
        id: 'replace',
        label: 'Replace the pump',
        resolve: (state) => {
          if (state.ship.coolantPumps <= 0) {
            state.ship.driveCoreWear = state.ship.driveCoreWear.map((w) => w + 22);
            return 'No spare pump aboard. You run the loop at half pressure and the cores pay for it.';
          }
          state.ship.coolantPumps -= 1;
          loseDays(state, 1);
          return 'A spare pump goes in and the loop holds at pressure. One day in the engine bay.';
        },
      },
      {
        id: 'jury-rig',
        label: 'Jury-rig the loop',
        tone: 'info',
        resolve: (state, rng) => {
          const engineer = state.profession?.id === 'engineer';
          if (engineer || rng() < 0.5) {
            state.ship.driveCoreWear = state.ship.driveCoreWear.map((w) => w + 6);
            return engineer
              ? 'You know this loop. A bypass, a clamp, and it runs better than it did.'
              : 'The bypass holds. Some extra wear on the cores, no days lost.';
          }
          state.ship.driveCoreWear = state.ship.driveCoreWear.map((w) => w + 30);
          return 'The bypass fails overnight. The cores ran hot for eleven hours.';
        },
      },
    ],
  },
  {
    id: 'derelict',
    title: 'DERELICT ON THE SCOPE',
    body: () =>
      'A transit hull, older than yours, tumbling slow with no transponder. Someone did not make it. Their tanks might still be full.',
    weight: (state) => (currentLeg(state).index <= 3 ? 7 : 2),
    choices: [
      {
        id: 'board',
        label: 'Match velocity and board',
        requires: { propellantCells: 8 },
        resolve: (state, rng) => {
          state.inventory.propellantCells -= 8;
          loseDays(state, 2);
          adjustAll(state, 'morale', -6);
          const roll = rng();
          if (roll < 0.15) {
            const name = afflict(state, 'cabin-psychosis', rng);
            return name
              ? `You find the crew still strapped in their bunks. ${name} has not slept since.`
              : 'You find the crew still strapped in their bunks. Nobody speaks for two days.';
          }
          const rations = Math.round(90 + rng() * 160);
          const water = Math.round(120 + rng() * 200);
          const cells = Math.round(10 + rng() * 25);
          state.inventory.rationsKg += rations;
          state.inventory.waterL += water;
          state.inventory.propellantCells += cells;
          return `Salvage: ${rations} kg rations, ${water} L water, ${cells} propellant cells. Nobody talks about where it came from.`;
        },
      },
      {
        id: 'log-and-pass',
        label: 'Log the position and pass',
        tone: 'info',
        resolve: () => 'You transmit the coordinates to Gateway traffic control and keep your burn.',
      },
    ],
  },
  {
    id: 'reclaim-failure',
    title: 'WATER RECLAIM FAULT',
    body: () => 'The reclaim centrifuge has thrown a bearing. Recovery efficiency is down to a third.',
    weight: () => 8,
    choices: [
      {
        id: 'repair',
        label: 'Strip and rebuild it',
        resolve: (state) => {
          loseDays(state, 2);
          adjustAll(state, 'energy', -8);
          return 'Two days on your back under the centrifuge. Efficiency restored.';
        },
      },
      {
        id: 'accept',
        label: 'Run it as it is',
        tone: 'info',
        resolve: (state, rng) => {
          const lost = Math.round(120 + rng() * 200);
          state.inventory.waterL = Math.max(0, state.inventory.waterL - lost);
          return `You keep flying. ${lost} L of water goes out with the waste before you give in and fix it.`;
        },
      },
    ],
  },
  {
    id: 'comms-degraded',
    title: 'COMMS ARRAY DEGRADED',
    body: () =>
      'The high-gain dish has lost alignment. Earth is a whisper and getting quieter. Navigation updates have stopped.',
    weight: (state) => (state.ship.commsArray > 0 ? 7 : 0),
    choices: [
      {
        id: 'realign',
        label: 'EVA and realign the dish',
        resolve: (state) => {
          loseDays(state, 1);
          adjustAll(state, 'energy', -7);
          adjustAll(state, 'morale', 4);
          return 'The dish comes back. Hearing Earth again is worth more than the day it cost.';
        },
      },
      {
        id: 'swap',
        label: 'Swap in the spare array',
        resolve: (state) => {
          if (state.ship.commsArray <= 1) {
            state.ship.commsArray = 0;
            adjustAll(state, 'morale', -10);
            return 'There is no spare. The dish stays dark and so does Earth.';
          }
          state.ship.commsArray -= 1;
          return 'The spare goes up. Full signal restored inside a shift.';
        },
      },
    ],
  },
  {
    id: 'hydroponics-bloom',
    title: 'THE GREENS CAME IN',
    body: () =>
      'For no reason anyone can explain, the hydroponics rack has gone riotous. There is more food than the trays were rated for.',
    weight: (state) => (state.profession?.id === 'homesteader' ? 9 : 4),
    choices: [
      {
        id: 'harvest',
        label: 'Harvest everything',
        resolve: (state, rng) => {
          const bonus = Math.round((state.profession?.id === 'homesteader' ? 140 : 80) + rng() * 90);
          state.inventory.rationsKg += bonus;
          adjustAll(state, 'morale', 9);
          adjustAll(state, 'health', 3);
          return `${bonus} kg of fresh growth into the stores. The crew eats something green for the first time in weeks.`;
        },
      },
    ],
  },
  {
    id: 'distress-beacon',
    title: 'DISTRESS BEACON',
    body: () =>
      'A narrowband automated call, eleven light-minutes out. A survey crew, engine dead, four aboard. Answering it means a course change you cannot afford.',
    weight: (state) => (currentLeg(state).index >= 1 && currentLeg(state).index <= 3 ? 5 : 0),
    choices: [
      {
        id: 'answer',
        label: 'Answer the call',
        requires: { propellantCells: 18 },
        resolve: (state, rng) => {
          state.inventory.propellantCells -= 18;
          loseDays(state, 5);
          adjustAll(state, 'morale', 18);
          const given = Math.min(state.inventory.rationsKg, 140);
          state.inventory.rationsKg -= given;
          const credits = Math.round(80 + rng() * 160);
          state.inventory.credits += credits;
          return `You reach them, transfer ${Math.round(given)} kg of rations, and take their beacon coordinates for the salvage board. Five days gone, ${credits} credits owed to you, and a crew that remembers what you did.`;
        },
      },
      {
        id: 'ignore',
        label: 'Log it and hold course',
        tone: 'info',
        resolve: (state) => {
          adjustAll(state, 'morale', -14);
          return 'You forward the beacon to Gateway and say nothing else about it. The silence aboard lasts a week.';
        },
      },
    ],
  },
  {
    id: 'crew-dispute',
    title: 'IT CAME TO BLOWS',
    body: (state) => {
      const crew = livingCrew(state);
      const a = crew[0]?.name ?? 'Someone';
      const b = crew[1]?.name ?? 'someone else';
      return `${a} and ${b} have not spoken in nine days, and this morning that ended badly. The galley is wrecked and so is the watch schedule.`;
    },
    weight: (state) =>
      livingCrew(state).length >= 2 && livingCrew(state).some((m) => m.morale < 55) ? 10 : 2,
    choices: [
      {
        id: 'mediate',
        label: 'Sit them down',
        resolve: (state) => {
          loseDays(state, 1);
          adjustAll(state, 'morale', 8);
          return 'It takes a day and most of your patience, but they shake on it.';
        },
      },
      {
        id: 'discipline',
        label: 'Confine them both',
        tone: 'info',
        resolve: (state, rng) => {
          const victim = randomLiving(state, rng);
          if (victim) victim.morale = clamp(victim.morale - 22);
          adjustAll(state, 'morale', -3);
          return 'Order is restored the cheap way. Nobody thanks you for it.';
        },
      },
      {
        id: 'ignore-dispute',
        label: 'Let them sort it out',
        tone: 'info',
        resolve: (state, rng) => {
          if (rng() < 0.45) {
            adjustAll(state, 'morale', -10);
            const name = afflict(state, 'cabin-psychosis', rng);
            return name
              ? `They do not sort it out. ${name} has stopped coming to the galley entirely.`
              : 'They do not sort it out. The ship gets colder.';
          }
          adjustAll(state, 'morale', 3);
          return 'They sort it out themselves by the end of the week. Better this way.';
        },
      },
    ],
  },
  {
    id: 'nav-drift',
    title: 'TRAJECTORY DRIFT',
    body: () =>
      'Accumulated error has walked you off the plotted line. Uncorrected, the arrival geometry gets worse every day.',
    weight: (state) => (state.ship.commsArray <= 0 ? 14 : 6),
    choices: [
      {
        id: 'correct',
        label: 'Burn a correction',
        requires: { propellantCells: 10 },
        resolve: (state) => {
          state.inventory.propellantCells -= 10;
          return 'A short burn puts you back on the line. Clean fix.';
        },
      },
      {
        id: 'accept-drift',
        label: 'Absorb it into the approach',
        tone: 'info',
        resolve: (state) => {
          // Losing ground is modelled as distance already travelled being undone.
          const penalty = currentLeg(state).baseKm * 0.035;
          state.kmIntoLeg = Math.max(0, state.kmIntoLeg - penalty);
          state.kmTotal = Math.max(0, state.kmTotal - penalty);
          return 'You fold the error into the arrival plan and lose ground doing it.';
        },
      },
    ],
  },
  {
    id: 'spoilage',
    title: 'STORES SPOILED',
    body: () => 'A seal failed in the cold locker. What was inside is no longer food.',
    weight: () => 7,
    choices: [
      {
        id: 'accept-spoilage',
        label: 'Jettison it',
        resolve: (state, rng) => {
          const lost = Math.round(Math.min(state.inventory.rationsKg, 60 + rng() * 130));
          state.inventory.rationsKg -= lost;
          adjustAll(state, 'morale', -5);
          return `${lost} kg out the waste lock. You do not tell the crew the exact number.`;
        },
      },
      {
        id: 'eat-it',
        label: 'Cook it hot and eat it anyway',
        tone: 'info',
        resolve: (state, rng) => {
          if (rng() < 0.5) {
            const name = afflict(state, 'hydroponics-blight', rng);
            return name
              ? `It was a mistake. ${name} is the one who got the worst of it.`
              : 'It was a mistake, and the whole crew knows it by morning.';
          }
          adjustAll(state, 'morale', 2);
          return 'Cooked long enough, it is only unpleasant. Nothing lost.';
        },
      },
    ],
  },
  {
    id: 'reactor-surge',
    title: 'THE CORES RAN CLEAN',
    body: () =>
      'For eleven straight days every core has run inside tolerance with the loop cold. The engineer keeps checking the readout for a fault.',
    weight: () => 5,
    choices: [
      {
        id: 'push',
        label: 'Take the gift and push',
        resolve: (state) => {
          const bonus = currentLeg(state).baseKmPerDay * 1.6;
          state.kmIntoLeg += bonus;
          state.kmTotal += bonus;
          adjustAll(state, 'morale', 6);
          return 'You ride the good stretch hard and put real distance behind you.';
        },
      },
      {
        id: 'bank',
        label: 'Throttle back and bank the wear',
        tone: 'info',
        resolve: (state) => {
          state.ship.driveCoreWear = state.ship.driveCoreWear.map((w) => Math.max(0, w - 14));
          adjustAll(state, 'energy', 8);
          return 'You ease off while the loop is cold. The cores come back measurably fresher.';
        },
      },
    ],
  },
  {
    id: 'dust-optics',
    title: 'DUST IN THE OPTICS',
    body: () =>
      'Mars is throwing a planet-wide dust season and the approach cameras are hazing over. Navigation is going manual.',
    weight: (state) => (currentLeg(state).index === 4 ? 16 : 0),
    choices: [
      {
        id: 'clean',
        label: 'EVA and clean the optics',
        resolve: (state) => {
          loseDays(state, 1);
          adjustAll(state, 'energy', -9);
          return 'Someone goes out with a cloth and a tether. Absurd, and it works.';
        },
      },
      {
        id: 'manual',
        label: 'Fly the approach manually',
        tone: 'info',
        resolve: (state) => {
          state.ship.heatShield = Math.max(0, state.ship.heatShield - 1);
          adjustAll(state, 'energy', -14);
          adjustAll(state, 'morale', -6);
          return 'You fly it by hand and eyeball. It costs a shield set and most of the crew\'s nerve.';
        },
      },
    ],
  },
];

/** Base per-day chance that any event fires at all. */
const EVENT_BASE_CHANCE = 0.12;

export function rollEvent(state: GameState, rng: Rng): GameEvent | null {
  if (rng() > EVENT_BASE_CHANCE) return null;

  const candidates = EVENTS.map((def) => ({ def, weight: def.weight(state) })).filter(
    (entry) => entry.weight > 0,
  );
  if (candidates.length === 0) return null;

  const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = rng() * total;
  for (const entry of candidates) {
    pick -= entry.weight;
    if (pick <= 0) return toGameEvent(entry.def, state);
  }
  return toGameEvent(candidates[candidates.length - 1].def, state);
}

function toGameEvent(def: EventDef, state: GameState): GameEvent {
  return {
    id: def.id,
    title: def.title,
    body: def.body(state),
    choices: def.choices
      .filter((choice) => affordable(state, choice))
      .map((choice) => ({
        id: choice.id,
        label: choice.label,
        tone: choice.tone,
        requires: choice.requires,
      })),
  };
}

function affordable(state: GameState, choice: EventChoiceDef): boolean {
  const req = choice.requires;
  if (!req) return true;
  if (req.credits !== undefined && state.inventory.credits < req.credits) return false;
  if (req.propellantCells !== undefined && state.inventory.propellantCells < req.propellantCells)
    return false;
  if (req.rationsKg !== undefined && state.inventory.rationsKg < req.rationsKg) return false;
  return true;
}

/** Apply a chosen event option. Returns the outcome text for the follow-up card. */
export function resolveEventChoice(
  state: GameState,
  eventId: string,
  choiceId: string,
  rng: Rng,
): string {
  const def = EVENTS.find((entry) => entry.id === eventId);
  const choice = def?.choices.find((entry) => entry.id === choiceId);
  if (!def || !choice) return 'Nothing came of it.';

  const outcome = choice.resolve(state, rng);
  pushLog(state, `${def.title}: ${outcome}`, 'neutral');
  return outcome;
}

/** Exposed for tests so the table can be validated without rolling dice. */
export function eventIds(): string[] {
  return EVENTS.map((def) => def.id);
}
