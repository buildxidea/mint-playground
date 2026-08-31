/**
 * THE MARS TRAIL — simulation facade.
 *
 * One object owns the state and the seeded RNG. The renderer and UI read state
 * and call commands; they never mutate state directly. Everything here is
 * browser-free so the whole model can be exercised in a plain Node test.
 */

import { LEGS, STORE_ITEMS, TOTAL_MISSION_KM, activeWaypoints, professionById } from './content';
import { resolveEventChoice, rollEvent } from './events';
import { resolveHazard, hazardOptions, type HazardOptionId, type HazardResolution } from './hazards';
import { scoreRun, type ScoreReport } from './score';
import {
  STATION_REFUND_RATE,
  YARD_REFUND_RATE,
  applyCampOption,
  applyStationService,
  canRefund,
  purchase,
  refund,
  resolveHarvest,
  stationPrice,
  type HarvestResult,
} from './stations';
import {
  applyProfession,
  createCrew,
  createInitialState,
  currentLeg,
  currentRoute,
  kmToNextWaypoint,
  legDistance,
  legWaypoints,
  livingCrew,
  nextWaypoint,
  pushLog,
} from './state';
import { advanceDay, kmPerDay, restDays } from './tick';
import type {
  BurnRate,
  GameState,
  ProfessionId,
  RationLevel,
  StoreItem,
  Waypoint,
} from './types';
import { createSeededRandom } from '../utils/random';

export * from './types';
export { FLYABLE_WAYPOINTS, flightSequenceFor } from './content';
export {
  LEGS,
  TOTAL_MISSION_KM,
  PROFESSIONS,
  STORE_ITEMS,
  ILLNESS_LABELS,
  CREW_SIZE,
  TRANSFER_WINDOW_DAYS,
} from './content';
export { formatDistance, formatMissionDate, missionDate } from './state';
export {
  HARVEST_CARRY_CAP,
  HARVEST_CELL_COST,
  STATION_REFUND_RATE,
  YARD_REFUND_RATE,
  campOptions,
  canRefund,
  ownedCount,
  stationPrice,
  stationServices,
} from './stations';
export { hazardOptions, effectiveSeverity, flightGrade } from './hazards';
export type { HazardOption, HazardOptionId, HazardResolution } from './hazards';
export type { ScoreReport, ScoreLine } from './score';
export type { StationService, CampOption, HarvestResult } from './stations';
export { autoplay } from './autoplay';
export type { AutoplayStyle, AutoplayResult } from './autoplay';

export type SimListener = (state: GameState) => void;

export class MarsTrailSim {
  private state: GameState = createInitialState();
  private rng: () => number;
  private listeners = new Set<SimListener>();

  /** Text of the last resolved event or hazard, surfaced on the outcome card. */
  lastOutcomeText = '';

  constructor(private seed = 20910314) {
    this.rng = createSeededRandom(seed);
  }

  // ---- observation -------------------------------------------------------

  get(): GameState {
    return this.state;
  }

  subscribe(listener: SimListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  // ---- derived readouts --------------------------------------------------

  leg() {
    return currentLeg(this.state);
  }

  route() {
    return currentRoute(this.state);
  }

  waypoints(): Waypoint[] {
    return legWaypoints(this.state);
  }

  nextWaypoint(): Waypoint | null {
    return nextWaypoint(this.state);
  }

  kmToNext(): number {
    return kmToNextWaypoint(this.state);
  }

  daysToNext(): number {
    const rate = kmPerDay(this.state);
    if (rate <= 0) return Infinity;
    return Math.max(1, Math.ceil(this.kmToNext() / rate));
  }

  /** 0-1 of the whole Earth-to-Mars crossing covered so far. */
  crossingProgress(): number {
    return Math.max(0, Math.min(1, this.state.kmTotal / TOTAL_MISSION_KM));
  }

  legRemaining(): number {
    return Math.max(0, legDistance(this.state) - this.state.kmIntoLeg);
  }

  living() {
    return livingCrew(this.state);
  }

  score(): ScoreReport {
    return scoreRun(this.state);
  }

  price(item: StoreItem, atStation: boolean): number {
    return atStation ? stationPrice(this.state, item) : item.basePrice;
  }

  // ---- setup commands ----------------------------------------------------

  reset(seed = this.seed): void {
    this.seed = seed;
    this.rng = createSeededRandom(seed);
    this.state = createInitialState();
    this.lastOutcomeText = '';
    this.emit();
  }

  beginProfessionSelect(): void {
    this.state.phase = 'profession';
    this.emit();
  }

  chooseProfession(id: ProfessionId): void {
    applyProfession(this.state, professionById(id));
    this.state.phase = 'crew-naming';
    this.emit();
  }

  nameCrew(names: string[]): void {
    const seeded = createCrew(names);
    // Preserve the homesteader/engineer starting bonuses already applied.
    this.state.crew = seeded;
    this.state.phase = 'outfitting';
    this.emit();
  }

  buy(itemId: string, atStation = false): string {
    const item = this.storeItem(itemId);
    if (!item) return 'No such item.';
    const result = purchase(this.state, itemId, this.price(item, atStation));
    this.emit();
    return result.message;
  }

  /** Sell one purchase step back. Full price at the yard, a loss at a station. */
  refund(itemId: string, atStation = false): string {
    const item = this.storeItem(itemId);
    if (!item) return 'No such item.';
    const result = refund(
      this.state,
      itemId,
      this.price(item, atStation),
      atStation ? STATION_REFUND_RATE : YARD_REFUND_RATE,
      atStation,
    );
    this.emit();
    return result.message;
  }

  canRefund(itemId: string, atStation = false): boolean {
    return canRefund(this.state, itemId, atStation);
  }

  private storeItem(itemId: string): StoreItem | undefined {
    return STORE_ITEMS.find((entry) => entry.id === itemId);
  }

  /** Leave the yard. Fails while the ship cannot actually fly. */
  depart(): { ok: boolean; reason?: string } {
    if (this.state.ship.driveCores < 2) {
      return { ok: false, reason: 'You need at least two drive cores to leave the yard.' };
    }
    if (this.state.inventory.rationsKg < 100) {
      return { ok: false, reason: 'Departing with under 100 kg of rations is suicide. Buy food.' };
    }
    if (this.state.inventory.waterL < 100) {
      return { ok: false, reason: 'You need water aboard. Buy at least 100 litres.' };
    }
    pushLog(this.state, 'Cleared the Canaveral Orbital Yard. Mars is 225 million kilometres away.', 'neutral');
    this.state.phase = 'leg-select';
    this.emit();
    return { ok: true };
  }

  // ---- travel commands ---------------------------------------------------

  setBurnRate(rate: BurnRate): void {
    this.state.burnRate = rate;
    this.emit();
  }

  setRations(level: RationLevel): void {
    this.state.rations = level;
    this.emit();
  }

  chooseRoute(routeId: string): void {
    this.state.routeId = routeId;
    this.state.kmIntoLeg = 0;
    this.state.nextWaypointIndex = 0;
    const leg = currentLeg(this.state);
    const route = leg.routes.find((r) => r.id === routeId);
    pushLog(this.state, `Leg ${leg.index + 1}: ${route?.name ?? 'route set'}.`, 'neutral');
    this.state.phase = 'travel';
    this.emit();
  }

  /** Advance one day of travel and route into whatever it triggered. */
  step(): void {
    if (this.state.phase !== 'travel') return;
    const result = advanceDay(this.state, this.rng);

    if (this.state.outcome !== 'in-progress') {
      this.finish();
      return;
    }

    if (result.reachedWaypoint) {
      this.enterWaypoint(result.reachedWaypoint);
    } else if (result.triggeredEvent) {
      this.state.activeEvent = result.triggeredEvent;
      this.state.phase = 'event';
    }
    this.emit();
  }

  private enterWaypoint(waypoint: Waypoint): void {
    switch (waypoint.kind) {
      case 'station':
        this.state.phase = 'station';
        break;
      case 'harvest':
        this.state.phase = 'harvest';
        break;
      case 'hazard':
      case 'finale':
        this.state.phase = 'hazard';
        break;
      case 'landmark':
      default:
        this.state.phase = 'camp';
        break;
    }
  }

  /** Camp between waypoints. The only mid-leg way to restore hygiene and rest. */
  makeCamp(): void {
    if (this.state.phase !== 'travel') return;
    this.state.voluntaryCamp = true;
    this.state.phase = 'camp';
    this.emit();
  }

  /** Called by the UI after a waypoint interaction finishes. */
  leaveWaypoint(): void {
    // A voluntary camp is not a waypoint, so it must not consume one.
    if (this.state.voluntaryCamp) {
      this.state.voluntaryCamp = false;
      this.state.phase = 'travel';
      this.emit();
      return;
    }

    const waypoints = legWaypoints(this.state);
    const finished = waypoints[this.state.nextWaypointIndex];
    this.state.nextWaypointIndex += 1;

    const wasFinale = finished?.kind === 'finale';
    if (wasFinale) {
      this.state.outcome = 'arrived';
      this.finish();
      return;
    }

    // Leg complete when every waypoint on the route is behind you.
    if (this.state.nextWaypointIndex >= waypoints.length) {
      if (this.state.legIndex >= LEGS.length - 1) {
        this.state.outcome = 'arrived';
        this.finish();
        return;
      }
      this.state.legIndex += 1;
      this.state.routeId = null;
      this.state.kmIntoLeg = 0;
      this.state.nextWaypointIndex = 0;
      this.state.phase = 'leg-select';
      this.emit();
      return;
    }

    this.state.phase = 'travel';
    this.emit();
  }

  // ---- interaction commands ---------------------------------------------

  chooseEventOption(choiceId: string): string {
    const event = this.state.activeEvent;
    if (!event) return '';
    const text = resolveEventChoice(this.state, event.id, choiceId, this.rng);
    this.lastOutcomeText = text;
    this.state.activeEvent = null;
    if (this.state.windowDaysLeft <= 0) {
      this.state.outcome = 'window-closed';
      this.finish();
      return text;
    }
    this.state.phase = 'travel';
    this.emit();
    return text;
  }

  hazardOptions() {
    const waypoint = this.nextWaypoint();
    if (!waypoint) return [];
    return hazardOptions(this.state, waypoint);
  }

  /**
   * @param performance 0-1 flight result when the player flew this hazard.
   *   Omitted, the `fly` option resolves on the same dice as burning through.
   */
  resolveHazard(optionId: HazardOptionId, performance?: number): HazardResolution | null {
    const waypoint = this.nextWaypoint();
    if (!waypoint) return null;
    const resolution = resolveHazard(this.state, waypoint, optionId, this.rng, performance);
    this.lastOutcomeText = resolution.detail;

    // A hazard can kill the run outright.
    if (livingCrew(this.state).length === 0) {
      this.state.outcome = 'lost-crew';
      this.finish();
    } else if (this.state.windowDaysLeft <= 0) {
      this.state.outcome = 'window-closed';
      this.finish();
    }
    this.emit();
    return resolution;
  }

  stationService(serviceId: string): string {
    const text = applyStationService(this.state, serviceId);
    this.lastOutcomeText = text;
    if (this.state.windowDaysLeft <= 0) {
      this.state.outcome = 'window-closed';
      this.finish();
    }
    this.emit();
    return text;
  }

  campOption(optionId: string): string {
    const text = applyCampOption(this.state, optionId, this.rng);
    this.lastOutcomeText = text;
    if (this.state.windowDaysLeft <= 0) {
      this.state.outcome = 'window-closed';
      this.finish();
    }
    this.emit();
    return text;
  }

  harvest(accuracy: number): HarvestResult {
    const result = resolveHarvest(this.state, accuracy, this.rng);
    this.lastOutcomeText = result.message;
    this.emit();
    return result;
  }

  rest(days: number): void {
    restDays(this.state, days, this.rng);
    if (this.state.outcome !== 'in-progress') this.finish();
    this.emit();
  }

  private finish(): void {
    this.state.phase = this.state.outcome === 'arrived' ? 'arrived' : 'lost';
    this.state.score = scoreRun(this.state).total;
    this.state.retroFilterUnlocked = true;
    this.emit();
  }

  // ---- test seams -------------------------------------------------------

  /** Reseed mid-run. Used by the deterministic screenshot hooks. */
  reseed(seed: number): void {
    this.seed = seed;
    this.rng = createSeededRandom(seed);
  }

  /** Force a random event for QA of the event card. */
  forceEvent(): void {
    const event = rollEvent(this.state, () => 0.01);
    if (event) {
      this.state.activeEvent = event;
      this.state.phase = 'event';
      this.emit();
    }
  }

  /** Jump straight into a travelling state with a viable ship, for QA. */
  primeForTravel(legIndex = 0): void {
    applyProfession(this.state, professionById('engineer'));
    this.state.crew = createCrew([]);
    this.state.ship.driveCores = 5;
    this.state.ship.driveCoreWear = [0, 0, 0, 0, 0];
    this.state.ship.heatShield = 2;
    this.state.ship.commsArray = 1;
    this.state.ship.coolantPumps = 2;
    this.state.ship.hullPlates = 2;
    this.state.inventory.rationsKg = 1600;
    this.state.inventory.waterL = 1400;
    this.state.inventory.propellantCells = 160;
    this.state.inventory.radSuits = 5;
    this.state.legIndex = legIndex;
    this.state.routeId = LEGS[legIndex].routes[0].id;
    this.state.kmIntoLeg = 0;
    this.state.nextWaypointIndex = 0;
    this.state.phase = 'travel';
    this.emit();
  }

  /** Waypoints for the star chart, including ones the current route skips. */
  legChart(legIndex: number, routeId: string | null) {
    const leg = LEGS[legIndex];
    return { leg, waypoints: activeWaypoints(leg, routeId) };
  }
}
