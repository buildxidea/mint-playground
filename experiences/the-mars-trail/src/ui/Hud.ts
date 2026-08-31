/**
 * The persistent travel HUD.
 *
 * Layout follows the reference frames exactly: date tile and space-weather dial
 * top-left, days-to-waypoint chip beside them, four resource readouts top-right,
 * the waypoint ticker on the left edge, five crew cards along the bottom, and
 * the dot-matrix status block in the bottom-right corner.
 */

import { ILLNESS_LABELS, formatDistance, missionDate } from '../sim';
import type { BurnRate, CrewMember, GameState, RationLevel } from '../sim';
import type { GameAssets } from '../assets/GameAssets';

/** Circumference of the dial arc, matching r=17 in the markup. */
const DIAL_CIRCUMFERENCE = 2 * Math.PI * 17;

const BURN_LABELS: Record<BurnRate, string> = {
  coasting: 'Coasting',
  standard: 'Standard',
  hard: 'Hard Burn',
};

const RATION_LABELS: Record<RationLevel, string> = {
  filling: 'Filling',
  meager: 'Meager',
  bare: 'Bare Bones',
};

interface HudCallbacks {
  onBurnRate: (rate: BurnRate) => void;
  onRations: (level: RationLevel) => void;
  onAdvance: () => void;
  onCamp: () => void;
  onLog: () => void;
  onHelp: () => void;
}

export class Hud {
  private readonly root = this.element('#hud');
  private readonly dateMonth = this.element('#date-month');
  private readonly dateDay = this.element('#date-day');
  private readonly dialValue = this.element('#dial-value');
  private readonly dialCore = this.element('#dial-core');
  private readonly daysChip = this.element('#days-chip');
  private readonly statBurn = this.element('#stat-burn');
  private readonly statRations = this.element('#stat-rations');
  private readonly statMass = this.element('#stat-mass');
  private readonly statCredits = this.element('#stat-credits');
  private readonly tickerName = this.element('#ticker-name');
  private readonly tickerDistance = this.element('#ticker-distance');
  private readonly banner = this.element('#center-banner');
  private readonly crewBar = this.element('#crew-bar');
  private readonly dotMatrix = this.element('#dot-matrix');
  private readonly controls = this.element('#travel-controls');
  private readonly marsFill = this.element('#mars-fill');
  private readonly marsMarker = this.element('#mars-marker');
  private readonly marsValue = this.element('#mars-value');
  private readonly advanceButton = this.element('#btn-advance') as HTMLButtonElement;
  private readonly campButton = this.element('#btn-camp') as HTMLButtonElement;

  /** Crew card nodes are built once and updated in place. */
  private crewCards: Array<{
    root: HTMLElement;
    portrait: HTMLImageElement;
    name: HTMLElement;
    tag: HTMLElement;
    bars: Record<'health' | 'energy' | 'hygiene' | 'morale' | 'radDose', HTMLElement>;
  }> = [];

  private dots: HTMLElement[] = [];
  private builtCrewFor = '';

  constructor(
    private readonly assets: GameAssets,
    callbacks: HudCallbacks,
  ) {
    this.dialValue.style.strokeDasharray = String(DIAL_CIRCUMFERENCE);

    this.root.querySelectorAll<HTMLButtonElement>('[data-burn]').forEach((button) => {
      button.addEventListener('click', () => callbacks.onBurnRate(button.dataset.burn as BurnRate));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-rations]').forEach((button) => {
      button.addEventListener('click', () =>
        callbacks.onRations(button.dataset.rations as RationLevel),
      );
    });
    this.advanceButton.addEventListener('click', callbacks.onAdvance);
    this.campButton.addEventListener('click', callbacks.onCamp);
    this.element('#btn-log').addEventListener('click', callbacks.onLog);
    this.element('#btn-help').addEventListener('click', callbacks.onHelp);

    this.buildDotMatrix();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /**
   * Force the crew cards to rebuild on the next update.
   *
   * The cards are cached against the roster signature, so portraits that arrive
   * after the first render — asset loading finishes well after the HUD's first
   * paint — would otherwise never be attached.
   */
  invalidateCrewCards(): void {
    this.builtCrewFor = '';
  }

  /** Enable or disable the travel actions without hiding the readouts. */
  setControlsEnabled(enabled: boolean): void {
    this.controls
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => (button.disabled = !enabled));
  }

  update(
    state: GameState,
    readouts: { daysToNext: number; nextName: string; kmToNext: number; crossing: number },
  ): void {
    // Overall distance to Mars, so the per-leg ticker always has a scale
    // behind it. Without this the player only ever sees the next waypoint.
    const crossing = Math.max(0, Math.min(1, readouts.crossing));
    this.marsFill.style.width = `${crossing * 100}%`;
    this.marsMarker.style.left = `${crossing * 100}%`;
    this.marsValue.textContent = `${Math.round(crossing * 100)}%`;

    const date = missionDate(state.day);
    this.dateMonth.textContent = date.monthLabel;
    this.dateDay.textContent = String(date.day);

    // Space-weather dial: arc length is solar activity, colour is severity.
    const activity = state.weather.solarActivity;
    this.dialValue.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - activity));
    const dialColor = activity > 0.75 ? 'var(--red)' : activity > 0.5 ? 'var(--amber)' : 'var(--green)';
    this.dialValue.style.stroke = dialColor;
    this.dialCore.style.background = dialColor;
    this.dialCore.style.opacity = String(0.28 + activity * 0.5);
    this.dialCore.title = `Space weather: ${state.weather.label}`;

    this.daysChip.textContent = Number.isFinite(readouts.daysToNext)
      ? `${readouts.daysToNext} d`
      : '— d';

    this.setStat(this.statBurn, BURN_LABELS[state.burnRate], state.burnRate === 'hard' ? 'warning' : 'ok');
    this.setStat(
      this.statRations,
      RATION_LABELS[state.rations],
      state.rations === 'bare' ? 'critical' : state.rations === 'meager' ? 'warning' : 'ok',
    );
    this.setStat(
      this.statMass,
      `${Math.round(state.inventory.rationsKg)} kg`,
      state.inventory.rationsKg < 120 ? 'critical' : state.inventory.rationsKg < 400 ? 'warning' : 'ok',
    );
    this.setStat(this.statCredits, String(Math.round(state.inventory.credits)), 'ok');

    this.tickerName.textContent = readouts.nextName;
    this.tickerDistance.textContent = formatDistance(readouts.kmToNext);

    this.updateCrew(state);
    this.updateDots(state);
    this.updateBanner(state);
    this.syncToggles(state);
  }

  private setStat(node: HTMLElement, label: string, tone: 'ok' | 'warning' | 'critical'): void {
    const labelNode = node.querySelector('.stat-label');
    if (labelNode) labelNode.textContent = label;
    node.classList.toggle('is-warning', tone === 'warning');
    node.classList.toggle('is-critical', tone === 'critical');
  }

  private syncToggles(state: GameState): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-burn]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.burn === state.burnRate));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-rations]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.rations === state.rations));
    });
  }

  private updateCrew(state: GameState): void {
    // Rebuild only when the roster identity changes, not every frame.
    const signature = state.crew.map((member) => member.id + member.name).join('|');
    if (signature !== this.builtCrewFor) {
      this.buildCrewCards(state);
      this.builtCrewFor = signature;
    }

    state.crew.forEach((member, index) => {
      const card = this.crewCards[index];
      if (!card) return;

      card.root.classList.toggle('is-dead', !member.alive);
      card.name.textContent = member.name;

      const tag = this.tagFor(member);
      card.tag.textContent = tag.text;
      card.tag.hidden = tag.text === '';
      card.tag.classList.toggle('is-dead', tag.dead);

      this.setBar(card.bars.health, member.health, 'var(--stat-health)');
      this.setBar(card.bars.energy, member.energy, 'var(--stat-energy)');
      this.setBar(card.bars.hygiene, member.hygiene, 'var(--stat-hygiene)');
      this.setBar(card.bars.morale, member.morale, 'var(--stat-morale)');
      // Dose is the one bar where a full bar is bad, so it fills as it rises.
      this.setBar(card.bars.radDose, member.radDose, 'var(--stat-dose)');
    });
  }

  private tagFor(member: CrewMember): { text: string; dead: boolean } {
    if (!member.alive) return { text: 'LOST', dead: true };
    if (member.illness !== 'none') return { text: ILLNESS_LABELS[member.illness], dead: false };
    if (member.radDose > 70) return { text: 'HIGH DOSE', dead: false };
    if (member.health < 30) return { text: 'FAILING', dead: false };
    return { text: '', dead: false };
  }

  private setBar(node: HTMLElement, value: number, color: string): void {
    node.style.width = `${Math.max(0, Math.min(100, value))}%`;
    node.style.background = color;
  }

  private buildCrewCards(state: GameState): void {
    this.crewBar.replaceChildren();
    this.crewCards = [];

    state.crew.forEach((member, index) => {
      const card = document.createElement('div');
      card.className = 'crew-card';

      const portrait = document.createElement('img');
      portrait.className = 'crew-portrait';
      portrait.alt = '';
      // The source art is 1024px square but displays at ~40px. Explicit
      // dimensions stop it forcing layout, and async decode keeps five
      // megabytes of portraits off the first-frame critical path.
      portrait.width = 40;
      portrait.height = 46;
      portrait.decoding = 'async';
      portrait.loading = 'lazy';
      const url = this.assets.portraitFor(index);
      if (url) portrait.src = url;
      card.appendChild(portrait);

      const body = document.createElement('div');
      body.className = 'crew-body';

      const nameRow = document.createElement('div');
      nameRow.className = 'crew-name-row';
      const name = document.createElement('span');
      name.className = 'crew-name';
      name.textContent = member.name;
      const tag = document.createElement('span');
      tag.className = 'crew-tag';
      tag.hidden = true;
      nameRow.append(name, tag);
      body.appendChild(nameRow);

      const bars = document.createElement('div');
      bars.className = 'crew-bars';
      const fills = {} as Record<'health' | 'energy' | 'hygiene' | 'morale' | 'radDose', HTMLElement>;
      for (const key of ['health', 'energy', 'hygiene', 'morale', 'radDose'] as const) {
        const track = document.createElement('div');
        track.className = 'crew-bar-track';
        const fill = document.createElement('div');
        fill.className = 'crew-bar-fill';
        track.appendChild(fill);
        bars.appendChild(track);
        fills[key] = fill;
      }
      body.appendChild(bars);
      card.appendChild(body);
      this.crewBar.appendChild(card);

      this.crewCards.push({ root: card, portrait, name, tag, bars: fills });
    });
  }

  private buildDotMatrix(): void {
    this.dotMatrix.replaceChildren();
    this.dots = [];
    // 8x4 grid: one row per ship system group, read left to right.
    for (let i = 0; i < 32; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      this.dotMatrix.appendChild(dot);
      this.dots.push(dot);
    }
  }

  /**
   * Row 1 drive cores, row 2 hull integrity, row 3 consumables, row 4 spares.
   * Each row is an eight-segment gauge.
   */
  private updateDots(state: GameState): void {
    const setRow = (row: number, filled: number, tone: 'on' | 'warn' | 'bad') => {
      for (let i = 0; i < 8; i += 1) {
        const dot = this.dots[row * 8 + i];
        dot.className = 'dot';
        if (i < filled) dot.classList.add(`is-${tone}`);
      }
    };

    const cores = state.ship.driveCores;
    setRow(0, Math.min(8, cores), cores <= 2 ? 'bad' : cores <= 3 ? 'warn' : 'on');

    const hull = state.ship.hullIntegrity;
    setRow(1, Math.round((hull / 100) * 8), hull < 40 ? 'bad' : hull < 70 ? 'warn' : 'on');

    const supply = Math.min(1, state.inventory.rationsKg / 1200);
    setRow(2, Math.round(supply * 8), supply < 0.15 ? 'bad' : supply < 0.35 ? 'warn' : 'on');

    const spares =
      state.ship.coolantPumps + state.ship.heatShield + state.ship.commsArray + state.ship.hullPlates;
    setRow(3, Math.min(8, spares), spares <= 1 ? 'bad' : spares <= 3 ? 'warn' : 'on');
  }

  private updateBanner(state: GameState): void {
    const crew = state.crew.filter((member) => member.alive);
    const starving = state.inventory.rationsKg <= 0 && crew.length > 0;
    const thirsty = state.inventory.waterL <= 0 && crew.length > 0;
    const adrift = state.ship.driveCores <= 0;

    let text = '';
    if (adrift) text = '☠ The ship is adrift';
    else if (starving) text = '☠ Your crew is starving';
    else if (thirsty) text = '☠ Your crew is out of water';
    else if (crew.some((member) => member.health < 20)) text = '☠ Your crew is failing';

    this.banner.hidden = text === '';
    this.banner.textContent = text;
    this.banner.classList.toggle('is-bad', text !== '');
  }

  private element(selector: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Missing HUD element: ${selector}`);
    return node;
  }
}
