/**
 * Modal screens for THE MARS TRAIL.
 *
 * Every non-travel phase renders into one overlay node. Event cards get the
 * full-width bottom treatment from the reference; everything else uses a
 * centred panel. All markup is built with DOM calls rather than innerHTML so
 * authored crew names can never be interpreted as markup.
 */

import {
  HARVEST_CARRY_CAP,
  HARVEST_CELL_COST,
  LEGS,
  PROFESSIONS,
  STATION_REFUND_RATE,
  STORE_ITEMS,
  YARD_REFUND_RATE,
  campOptions,
  formatDistance,
  formatMissionDate,
  ownedCount,
  stationServices,
} from '../sim';
import {
  BRIGHTNESS_OPTIONS,
  PIXELATION_OPTIONS,
  type DisplaySettings,
  type SettingOption,
} from './settings';
import type {
  CampOption,
  GameEvent,
  GameState,
  HazardOption,
  MarsTrailSim,
  ProfessionId,
  ScoreReport,
  StationService,
  Waypoint,
} from '../sim';

export interface ScreenCallbacks {
  onStart: () => void;
  onOpenTutorial: () => void;
  onCloseTutorial: () => void;
  onChooseProfession: (id: ProfessionId) => void;
  onConfirmNames: (names: string[]) => void;
  onBuy: (itemId: string, atStation: boolean) => void;
  onRefund: (itemId: string, atStation: boolean) => void;
  onDepart: () => void;
  onChooseRoute: (routeId: string) => void;
  onEventChoice: (choiceId: string) => void;
  onHazardChoice: (optionId: HazardOption['id']) => void;
  onStationService: (serviceId: string) => void;
  onLeaveStation: () => void;
  onCampOption: (optionId: string) => void;
  onHarvest: (accuracy: number) => void;
  onSkipHarvest: () => void;
  onAcknowledge: () => void;
  onRestart: () => void;
  onCloseLog: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onChangeSettings: (patch: Partial<DisplaySettings>) => void;
}

type Tone = 'primary' | 'info';

export class Screens {
  private readonly overlay = document.querySelector<HTMLElement>('#overlay')!;
  private harvestFrame = 0;
  private harvestCleanup: (() => void) | null = null;
  /** Logical id of the screen currently rendered, for scroll preservation. */
  private lastScreenId = '';
  private pendingRestore: {
    overlayScroll: number;
    cardScroll: number;
    actionId?: string;
  } | null = null;

  constructor(private readonly callbacks: ScreenCallbacks) {}

  hide(): void {
    this.stopHarvest();
    this.overlay.hidden = true;
    this.overlay.classList.remove('is-event');
    this.overlay.replaceChildren();
    this.lastScreenId = '';
    this.pendingRestore = null;
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Build a fresh card in the overlay.
   *
   * Buying or selling rebuilds the whole panel, which would otherwise throw the
   * player back to the top of a long store list and drop keyboard focus on
   * every single click. `screenId` identifies the logical screen: when a
   * rebuild renders the *same* screen, scroll position and focus are carried
   * across; a genuinely different screen still starts at the top.
   */
  private card(screenId: string, options: { event?: boolean } = {}): HTMLElement {
    this.stopHarvest();

    const sameScreen = screenId === this.lastScreenId;
    // Both nodes can scroll: `.overlay-card` has its own max-height and
    // overflow, and it is the one destroyed on every rebuild, so capturing
    // only the overlay would restore nothing on the panels that actually
    // scroll — the stores.
    const previousOverlayScroll = this.overlay.scrollTop;
    const previousCardScroll =
      this.overlay.querySelector<HTMLElement>('.overlay-card')?.scrollTop ?? 0;
    const focused = document.activeElement as HTMLElement | null;
    const focusedAction =
      sameScreen && focused && this.overlay.contains(focused) ? focused.dataset.actionId : undefined;

    this.overlay.hidden = false;
    this.overlay.classList.toggle('is-event', Boolean(options.event));
    this.overlay.replaceChildren();

    const card = document.createElement('div');
    card.className = 'overlay-card';
    this.overlay.appendChild(card);

    this.lastScreenId = screenId;
    this.pendingRestore = sameScreen
      ? {
          overlayScroll: previousOverlayScroll,
          cardScroll: previousCardScroll,
          actionId: focusedAction,
        }
      : null;

    // Restore on a microtask: the calling render method builds its DOM
    // synchronously, so by the time this runs the card has its full height.
    // Doing it here means none of the fourteen render methods has to remember.
    queueMicrotask(() => this.restoreScroll());
    return card;
  }

  /**
   * Reapply the scroll offset and focus captured in `card()`. Called at the end
   * of each render, once the new content exists and has a height to scroll to.
   */
  private restoreScroll(): void {
    const restore = this.pendingRestore;
    this.pendingRestore = null;
    const card = this.overlay.querySelector<HTMLElement>('.overlay-card');

    if (!restore) {
      this.overlay.scrollTop = 0;
      if (card) card.scrollTop = 0;
      return;
    }

    this.overlay.scrollTop = restore.overlayScroll;
    if (card) card.scrollTop = restore.cardScroll;

    if (restore.actionId) {
      const target = this.overlay.querySelector<HTMLElement>(
        `[data-action-id="${CSS.escape(restore.actionId)}"]`,
      );
      // preventScroll matters: focusing would otherwise scroll the element into
      // view and undo the offset that was just restored.
      target?.focus({ preventScroll: true });
    }
  }

  private eyebrow(parent: HTMLElement, text: string): void {
    const node = document.createElement('div');
    node.className = 'card-eyebrow';
    node.textContent = text;
    parent.appendChild(node);
  }

  private title(parent: HTMLElement, text: string, options: { cursor?: boolean; bad?: boolean } = {}): void {
    const node = document.createElement('h1');
    node.className = 'card-title';
    if (options.bad) node.classList.add('is-bad');
    node.textContent = text;
    if (options.cursor) {
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      cursor.textContent = ' ';
      node.appendChild(cursor);
    }
    parent.appendChild(node);
  }

  private body(parent: HTMLElement, text: string): void {
    const node = document.createElement('p');
    node.className = 'card-body';
    node.textContent = text;
    parent.appendChild(node);
  }

  private note(parent: HTMLElement, text: string): void {
    const node = document.createElement('div');
    node.className = 'card-note';
    node.textContent = text;
    parent.appendChild(node);
  }

  private choices(parent: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'card-choices';
    parent.appendChild(row);
    return row;
  }

  private button(
    parent: HTMLElement,
    label: string,
    onClick: () => void,
    options: { tone?: Tone; detail?: string; disabled?: boolean } = {},
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = options.tone === 'info' ? 'info' : 'primary';
    button.disabled = Boolean(options.disabled);

    const text = document.createElement('span');
    text.textContent = label;
    button.appendChild(text);

    if (options.detail) {
      const detail = document.createElement('span');
      detail.className = 'choice-detail';
      detail.textContent = options.detail;
      button.appendChild(detail);
    }

    button.addEventListener('click', onClick);
    parent.appendChild(button);
    return button;
  }

  private optionRow(
    parent: HTMLElement,
    name: string,
    detail: string,
    cost: string,
    onClick: () => void,
    disabled = false,
    actionId?: string,
  ): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option-row';
    button.disabled = disabled;
    if (actionId) button.dataset.actionId = actionId;

    const nameNode = document.createElement('span');
    nameNode.className = 'option-name';
    nameNode.textContent = name;

    const detailNode = document.createElement('span');
    detailNode.className = 'option-detail';
    detailNode.textContent = detail;

    const costNode = document.createElement('span');
    costNode.className = 'option-cost';
    costNode.textContent = cost;

    button.append(nameNode, detailNode, costNode);
    button.addEventListener('click', onClick);
    parent.appendChild(button);
  }

  // ------------------------------------------------------------------ title

  renderTitle(): void {
    const card = this.card('title');
    card.classList.add('title-screen');

    // The title screen gets its own large treatment rather than the standard
    // card heading, which is sized for event and station panels.
    const mark = document.createElement('h1');
    mark.className = 'title-mark';
    mark.textContent = 'The Mars Trail';
    card.appendChild(mark);

    const sub = document.createElement('div');
    sub.className = 'title-sub';
    sub.textContent = 'Canaveral Orbital Yard — March 2091';
    card.appendChild(sub);

    const blurb = document.createElement('p');
    blurb.className = 'title-blurb';
    blurb.textContent =
      '225 million kilometres to Ares Basin. The transfer window closes in 340 days. Ration the food, spare the drive cores, pick your risks. Most captains do not arrive with everyone.';
    card.appendChild(blurb);

    const row = this.choices(card);
    row.style.justifyContent = 'center';
    this.button(row, 'Begin the crossing', this.callbacks.onStart);
    this.button(row, 'Full briefing', this.callbacks.onOpenTutorial, { tone: 'info' });

    this.appendHowToPlay(card);
  }

  /**
   * The home-page primer. Three cards covering the only things a new captain
   * genuinely needs before the outfitting screen; everything else is on the
   * full briefing.
   */
  private appendHowToPlay(card: HTMLElement): void {
    const section = document.createElement('section');
    section.className = 'howto';

    const heading = document.createElement('h2');
    heading.className = 'howto-heading';
    heading.textContent = 'How to play';
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'howto-grid';

    const primer: Array<[string, string, string]> = [
      [
        '1',
        'Outfit once, at the yard',
        'Spend the whole budget here. Prices only climb, and you cannot land without a heat shield.',
      ],
      [
        '2',
        'Set the burn and the rations',
        'A harder burn covers more ground and wears the drive and crew. Fuller rations hold health and empty the hold sooner.',
      ],
      [
        '3',
        'Camp and service the drive',
        'Camp to service the cores, wash, rest, or patch the hull. Skip the maintenance and you go adrift with a healthy crew and a dead engine.',
      ],
    ];

    for (const [step, title, text] of primer) {
      const item = document.createElement('article');
      item.className = 'howto-card';

      const stepNode = document.createElement('span');
      stepNode.className = 'howto-step';
      stepNode.textContent = step;

      const titleNode = document.createElement('h3');
      titleNode.className = 'howto-card-title';
      titleNode.textContent = title;

      const textNode = document.createElement('p');
      textNode.className = 'howto-card-text';
      textNode.textContent = text;

      item.append(stepNode, titleNode, textNode);
      grid.appendChild(item);
    }

    section.appendChild(grid);

    const footnote = document.createElement('p');
    footnote.className = 'howto-footnote';
    footnote.textContent =
      'Reach Ares Basin with someone alive. You lose if all die, the window closes, or the last core burns out.';
    section.appendChild(footnote);

    card.appendChild(section);
  }

  // -------------------------------------------------------------- tutorial

  /** The full briefing. Reachable from the title screen and the travel HUD. */
  renderTutorial(): void {
    const card = this.card('tutorial');
    this.eyebrow(card, 'Briefing');
    this.title(card, 'How to play');
    this.body(
      card,
      'Food, crew condition, and time. Nothing improves all three at once — every choice trades one for another.',
    );

    this.tutorialSection(card, 'The two dials', [
      [
        'Burn rate',
        'Harder burns cover more ground but wear the cores and exhaust the crew. Coasting is gentle on everything except the calendar.',
      ],
      [
        'Rations',
        'Fuller rations hold health, energy, and morale. Thinner ones stretch the hold, bleed the crew, and invite blight.',
      ],
    ]);

    this.tutorialSection(card, 'Reading a crew card', [
      ['Health', 'The one that kills. Falls when the crew starves, exhausts, or sickens.'],
      ['Energy', 'Burned by the pace, restored by food and rest.'],
      ['Hygiene', 'Only ever falls in transit. A hygiene cycle at camp is the only mid-leg fix.'],
      ['Morale', 'Isolation, filth, hunger, and every death drag it down. The Deep Quiet is worst.'],
      [
        'Dose',
        'The one bar where full is bad. Only an infirmary flushes it. Rad suits blunt it; nothing stops it.',
      ],
    ]);

    this.tutorialSection(card, 'Drive cores are your team', [
      [
        'They drive the ship',
        'Cores ride a ring around the hull. Load is shared across every core installed, so six wear far slower than two.',
      ],
      [
        'They fail one at a time',
        'A burned-out core leaves the ring and the rest close up. A spare coolant pump can sometimes save one. Below two you are adrift and the run is over.',
      ],
      [
        'Service them or lose the run',
        'Camp for maintenance whenever a core is worn, and refit at any station you can afford. Captains who never service go adrift three runs in four.',
      ],
    ]);

    this.tutorialSection(card, 'Hazards — four ways through', [
      ['Burn straight through', 'Free and instant. Also the most likely to cost you a crew member.'],
      ['Creep on thrusters', 'Costs days and propellant. Roughly halves the risk.'],
      ['Hire a tug escort', 'Costs credits. Very nearly safe, if you can still afford it.'],
      ['Hold for a clean window', 'Costs only days — but days are the deadline you are racing.'],
    ]);

    this.tutorialSection(card, 'Places to stop', [
      [
        'Stations',
        'Resupply, repair, refit, infirmary, shore leave. Markup climbs with distance, so the cheap fix is always the one you passed.',
      ],
      [
        'Camp',
        'Any travel day. Wash, rest, patch the hull, tend hydroponics, service the cores. Costs days, never credits.',
      ],
      [
        'Harvest fields',
        `Stop the needle in the band at ice and salvage waypoints. The tether carries ${HARVEST_CARRY_CAP} kg at most; each EVA costs ${HARVEST_CELL_COST} cells and a day.`,
      ],
    ]);

    this.tutorialSection(card, 'Scoring', [
      [
        'Crew is worth the most',
        'Survivors outscore cargo, weighted by arrival health.',
      ],
      [
        'Poverty pays',
        'Corporate Financier starts rich at ×1. Terraform Homesteader starts with nothing at ×3.',
      ],
    ]);

    const row = this.choices(card);
    this.button(row, 'Got it ▸', this.callbacks.onCloseTutorial);
  }

  private tutorialSection(card: HTMLElement, heading: string, rows: Array<[string, string]>): void {
    const section = document.createElement('section');
    section.className = 'tutorial-section';

    const title = document.createElement('h2');
    title.className = 'tutorial-heading';
    title.textContent = heading;
    section.appendChild(title);

    const list = document.createElement('dl');
    list.className = 'tutorial-list';

    for (const [term, description] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = description;
      list.append(dt, dd);
    }

    section.appendChild(list);
    card.appendChild(section);
  }

  // ------------------------------------------------------------- profession

  renderProfessionSelect(): void {
    const card = this.card('profession');
    this.eyebrow(card, 'Step 1 of 3');
    this.title(card, 'Who are you');
    this.body(
      card,
      'Your trade sets your budget and your score. The poorer you start, the more the crossing is worth.',
    );

    const list = document.createElement('div');
    list.className = 'option-list';
    card.appendChild(list);

    for (const profession of PROFESSIONS) {
      this.optionRow(
        list,
        profession.name,
        `${profession.blurb} ${profession.perk}`,
        `${profession.startingCredits} cr · ×${profession.scoreMultiplier}`,
        () => this.callbacks.onChooseProfession(profession.id),
      );
    }
  }

  // ------------------------------------------------------------ crew naming

  renderCrewNaming(state: GameState): void {
    const card = this.card('crew-naming');
    this.eyebrow(card, 'Step 2 of 3');
    this.title(card, 'Name your crew');
    this.body(card, 'You are the first name on the manifest. The other four are trusting you with the rest.');

    const grid = document.createElement('div');
    grid.className = 'name-grid';
    card.appendChild(grid);

    const inputs: HTMLInputElement[] = [];
    state.crew.forEach((member, index) => {
      const row = document.createElement('div');
      row.className = 'name-row';

      const label = document.createElement('label');
      label.textContent = index === 0 ? 'Captain' : `Crew ${index + 1}`;
      label.htmlFor = `crew-name-${index}`;

      const input = document.createElement('input');
      input.id = `crew-name-${index}`;
      input.type = 'text';
      input.maxLength = 14;
      input.value = member.name;
      input.autocomplete = 'off';
      input.spellcheck = false;

      row.append(label, input);
      grid.appendChild(row);
      inputs.push(input);
    });

    const row = this.choices(card);
    this.button(row, 'To the outfitters ▸', () => {
      const names = inputs.map((input, index) => input.value.trim() || state.crew[index].name);
      this.callbacks.onConfirmNames(names);
    });
  }

  // ------------------------------------------------------------ outfitting

  renderOutfitting(sim: MarsTrailSim, warning: string): void {
    const state = sim.get();
    const card = this.card('outfitting');
    this.eyebrow(card, 'Step 3 of 3');
    this.title(card, "Yard Requisition");
    this.body(
      card,
      'Everything you get for eight months, at the only honest prices on the trail. Two cores move the ship; four to six reach Mars.',
    );

    this.renderStore(card, sim, state, false);

    const warn = document.createElement('div');
    warn.className = 'store-warning';
    warn.textContent = warning;
    card.appendChild(warn);

    const row = this.choices(card);
    this.button(row, 'Leave the yard ▸', this.callbacks.onDepart);
  }

  private renderStore(card: HTMLElement, sim: MarsTrailSim, state: GameState, atStation: boolean): void {
    const grid = document.createElement('div');
    grid.className = 'store-grid';
    card.appendChild(grid);

    const refundRate = atStation ? STATION_REFUND_RATE : YARD_REFUND_RATE;

    for (const item of STORE_ITEMS) {
      const unitPrice = sim.price(item, atStation);
      const stepCost = Math.round(unitPrice * item.step * 100) / 100;
      const affordable = state.inventory.credits >= stepCost;
      const sellable = sim.canRefund(item.id, atStation);

      const row = document.createElement('div');
      row.className = 'store-row';

      const name = document.createElement('span');
      name.className = 'store-name';
      name.textContent = item.name;

      const owned = document.createElement('span');
      owned.className = 'store-owned';
      owned.textContent = `${Math.round(ownedCount(state, item.id))} ${item.unit}`;

      const price = document.createElement('span');
      price.className = 'store-price';
      price.textContent = `${stepCost} cr / ${item.step}`;

      const stepper = document.createElement('span');
      stepper.className = 'store-stepper';

      const sell = document.createElement('button');
      sell.type = 'button';
      sell.className = 'store-step-button';
      sell.textContent = '−';
      sell.disabled = !sellable;
      sell.dataset.actionId = `sell:${item.id}`;
      sell.setAttribute(
        'aria-label',
        `Sell back ${item.step} ${item.unit} of ${item.name}`,
      );
      sell.title = sellable
        ? `Sell back for ${Math.round(stepCost * refundRate * 100) / 100} cr`
        : item.id === 'driveCores' && atStation
          ? 'You cannot fly on fewer than two cores'
          : 'None aboard';
      sell.addEventListener('click', () => this.callbacks.onRefund(item.id, atStation));

      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'store-step-button';
      buy.textContent = '+';
      buy.disabled = !affordable;
      buy.dataset.actionId = `buy:${item.id}`;
      buy.setAttribute('aria-label', `Buy ${item.step} ${item.unit} of ${item.name}`);
      buy.title = affordable ? `Buy for ${stepCost} cr` : 'Not enough credits';
      buy.addEventListener('click', () => this.callbacks.onBuy(item.id, atStation));

      const stepLabel = document.createElement('span');
      stepLabel.className = 'store-step-size';
      stepLabel.textContent = String(item.step);

      stepper.append(sell, stepLabel, buy);

      const desc = document.createElement('span');
      desc.className = 'store-desc';
      desc.textContent = item.description;

      row.append(name, owned, price, stepper, desc);
      grid.appendChild(row);
    }

    const summary = document.createElement('div');
    summary.className = 'store-summary';
    for (const [label, value] of [
      ['Credits', Math.round(state.inventory.credits)],
      ['Drive cores', state.ship.driveCores],
      ['Rations', `${Math.round(state.inventory.rationsKg)} kg`],
      ['Water', `${Math.round(state.inventory.waterL)} L`],
      ['Propellant', Math.floor(state.inventory.propellantCells)],
      ['Rad suits', state.inventory.radSuits],
      ['Shield sets', state.ship.heatShield],
    ] as Array<[string, string | number]>) {
      const entry = document.createElement('span');
      entry.textContent = `${label} `;
      const strong = document.createElement('strong');
      strong.textContent = String(value);
      entry.appendChild(strong);
      summary.appendChild(entry);
    }
    card.appendChild(summary);

    const refundNote = document.createElement('div');
    refundNote.className = 'store-refund-note';
    refundNote.textContent = atStation
      ? `Selling back at a station returns ${Math.round(STATION_REFUND_RATE * 100)}% of the asking price.`
      : 'You have not left yet, so anything sold back at the yard refunds in full.';
    card.appendChild(refundNote);
  }


  // -------------------------------------------------------------- leg chart

  renderLegSelect(state: GameState): void {
    const leg = LEGS[state.legIndex];
    const card = this.card(`leg-select:${state.legIndex}`);

    this.eyebrow(card, `Leg ${leg.index + 1} of ${LEGS.length}`);
    this.title(card, leg.title, { cursor: true });
    this.body(card, `${leg.from} to ${leg.to}. Choose your route.`);

    for (const route of leg.routes) {
      const chart = document.createElement('div');
      chart.className = 'leg-chart';

      const track = document.createElement('div');
      track.className = 'leg-track';

      const waypoints = leg.waypoints.filter((wp) => !wp.routeId || wp.routeId === route.id);
      const scale = route.distanceMultiplier;

      this.appendChartNode(track, leg.from, 'origin', '0 km');
      for (const waypoint of waypoints) {
        const link = document.createElement('div');
        link.className = 'leg-link';
        track.appendChild(link);
        this.appendChartNode(
          track,
          waypoint.name,
          waypoint.kind,
          formatDistance(waypoint.kmFromLegStart * scale),
        );
      }

      chart.appendChild(track);
      card.appendChild(chart);

      const list = document.createElement('div');
      list.className = 'option-list';
      card.appendChild(list);

      const distance = formatDistance(leg.baseKm * route.distanceMultiplier);
      const risk =
        route.severityMultiplier > 1.25
          ? 'High risk'
          : route.severityMultiplier > 0.95
            ? 'Moderate risk'
            : 'Lower risk';
      this.optionRow(
        list,
        route.name,
        route.description,
        `${distance} · ${risk}${route.hasStation ? ' · Port' : ''}`,
        () => this.callbacks.onChooseRoute(route.id),
      );
    }
  }

  private appendChartNode(track: HTMLElement, label: string, kind: string, distance: string): void {
    const node = document.createElement('div');
    node.className = `leg-node is-${kind}`;

    const mark = document.createElement('div');
    mark.className = 'node-mark';

    const name = document.createElement('div');
    name.className = 'node-label';
    name.textContent = label;

    const dist = document.createElement('div');
    dist.className = 'node-distance';
    dist.textContent = distance;

    node.append(mark, name, dist);
    track.appendChild(node);
  }

  // ------------------------------------------------------------ event card

  renderEvent(event: GameEvent): void {
    const card = this.card(`event:${event.id}`, { event: true });
    this.eyebrow(card, 'Ship’s log');
    this.title(card, event.title, { bad: true });
    this.body(card, event.body);

    const row = this.choices(card);
    for (const choice of event.choices) {
      this.button(row, choice.label, () => this.callbacks.onEventChoice(choice.id), {
        tone: choice.tone === 'info' ? 'info' : 'primary',
      });
    }
  }

  /** Outcome card shown after any resolved event, hazard, service, or camp. */
  renderOutcome(title: string, text: string, options: { bad?: boolean } = {}): void {
    const card = this.card('outcome', { event: true });
    this.eyebrow(card, 'Outcome');
    this.title(card, title, { bad: options.bad });
    this.body(card, text);
    const row = this.choices(card);
    this.button(row, 'Continue ▸', this.callbacks.onAcknowledge);
  }

  // ---------------------------------------------------------------- hazard

  renderHazard(waypoint: Waypoint, options: HazardOption[], severity: number, state: GameState): void {
    const card = this.card(`hazard:${waypoint.id}`, { event: true });
    this.eyebrow(card, waypoint.kind === 'finale' ? 'Final approach' : 'Hazard');
    this.title(card, waypoint.name, { bad: true });
    this.body(card, waypoint.description);

    const risk = severity > 0.55 ? 'SEVERE' : severity > 0.35 ? 'SERIOUS' : 'MODERATE';
    let noteText = `Assessed severity ${risk} · Space weather ${state.weather.label} · Hull ${Math.round(state.ship.hullIntegrity)}%`;
    if (waypoint.kind === 'finale') {
      // The shield is the single most important read on this card.
      noteText +=
        state.ship.heatShield > 0
          ? ` · Heat shield ${state.ship.heatShield} set(s)`
          : ' · NO HEAT SHIELD ABOARD';
    }
    this.note(card, noteText);

    const row = this.choices(card);
    for (const option of options) {
      const costs: string[] = [];
      if (option.days > 0) costs.push(`${option.days} d`);
      if (option.propellantCells > 0) costs.push(`${option.propellantCells} cells`);
      if (option.credits > 0) costs.push(`${option.credits} cr`);
      const detail = option.available
        ? `${option.detail}${costs.length ? ` (${costs.join(' · ')})` : ' (free)'}`
        : (option.unavailableReason ?? 'Unavailable');

      this.button(row, option.label, () => this.callbacks.onHazardChoice(option.id), {
        tone: option.id === 'burn' ? 'primary' : 'info',
        detail,
        disabled: !option.available,
      });
    }
  }

  // --------------------------------------------------------------- station

  renderStation(sim: MarsTrailSim, waypoint: Waypoint, message: string): void {
    const state = sim.get();
    const card = this.card(`station:${waypoint.id}`);
    this.eyebrow(card, 'Docked');
    this.title(card, waypoint.name);
    this.body(card, waypoint.description);
    this.note(card, `${formatMissionDate(state.day)} · ${state.windowDaysLeft} days of window left`);

    const services = stationServices(state);
    if (services.length > 0) {
      const list = document.createElement('div');
      list.className = 'option-list';
      card.appendChild(list);

      for (const service of services) {
        this.appendServiceRow(list, service);
      }
    }

    this.renderStore(card, sim, state, true);

    if (message) {
      const warn = document.createElement('div');
      warn.className = 'store-warning';
      warn.textContent = message;
      card.appendChild(warn);
    }

    const row = this.choices(card);
    this.button(row, 'Undock and continue ▸', this.callbacks.onLeaveStation);
  }

  private appendServiceRow(list: HTMLElement, service: StationService): void {
    const costs = [`${service.credits} cr`, `${service.days} d`].join(' · ');
    this.optionRow(
      list,
      service.label,
      service.detail,
      service.available ? costs : 'Cannot afford',
      () => this.callbacks.onStationService(service.id),
      !service.available,
      `service:${service.id}`,
    );
  }

  // ------------------------------------------------------------------ camp

  renderCamp(state: GameState, waypoint: Waypoint | null): void {
    const card = this.card(`camp:${waypoint?.id ?? 'voluntary'}`);
    this.eyebrow(card, waypoint ? 'Landmark' : 'Camp');
    this.title(card, waypoint ? waypoint.name : 'Make camp');
    this.body(
      card,
      waypoint
        ? waypoint.description
        : 'Cut the burn and hold station. Nothing here costs credits, and everything here costs days.',
    );
    this.note(card, `${state.windowDaysLeft} days of transfer window remaining`);

    const list = document.createElement('div');
    list.className = 'option-list';
    card.appendChild(list);

    for (const option of campOptions(state)) {
      this.appendCampRow(list, option);
    }

    const row = this.choices(card);
    this.button(row, 'Resume the burn ▸', this.callbacks.onAcknowledge, { tone: 'info' });
  }

  private appendCampRow(list: HTMLElement, option: CampOption): void {
    this.optionRow(
      list,
      option.label,
      option.detail,
      option.available ? `${option.days} d` : 'Unavailable',
      () => this.callbacks.onCampOption(option.id),
      !option.available,
    );
  }

  // --------------------------------------------------------------- harvest

  /**
   * The hunting minigame. A needle sweeps a track and the player stops it inside
   * a target zone; proximity to the centre becomes harvest accuracy. The carry
   * cap then throws away everything above 120 kg, exactly as the original's
   * 100 lb limit does.
   */
  renderHarvest(state: GameState, waypoint: Waypoint): void {
    const card = this.card(`harvest:${waypoint.id}`);
    this.eyebrow(card, 'Harvest');
    this.title(card, waypoint.name);
    this.body(card, waypoint.description);

    const affordable = state.inventory.propellantCells >= HARVEST_CELL_COST;
    this.note(
      card,
      `EVA costs ${HARVEST_CELL_COST} propellant cells and one day · the tether rig carries ${HARVEST_CARRY_CAP} kg at most`,
    );

    const meter = document.createElement('div');
    meter.className = 'harvest-meter';

    const zone = document.createElement('div');
    zone.className = 'harvest-zone';
    zone.style.left = '38%';
    zone.style.width = '24%';

    const needle = document.createElement('div');
    needle.className = 'harvest-needle';
    needle.style.left = '0%';

    meter.append(zone, needle);
    card.appendChild(meter);

    const readout = document.createElement('div');
    readout.className = 'harvest-readout';
    const hint = document.createElement('span');
    hint.textContent = 'Stop the needle in the marked band';
    const cells = document.createElement('span');
    cells.textContent = 'Propellant ';
    const cellsValue = document.createElement('strong');
    cellsValue.textContent = String(Math.floor(state.inventory.propellantCells));
    cells.appendChild(cellsValue);
    readout.append(hint, cells);
    card.appendChild(readout);

    const row = this.choices(card);
    const fireButton = this.button(
      row,
      'Fire the harpoon',
      () => {
        const position = this.stopHarvest();
        // Accuracy peaks at the centre of the band and falls off outside it.
        const distance = Math.abs(position - 0.5);
        const accuracy = Math.max(0.04, 1 - distance * 2.6);
        this.callbacks.onHarvest(accuracy);
      },
      { disabled: !affordable },
    );
    if (!affordable) fireButton.title = 'Not enough propellant for the EVA';

    this.button(row, 'Stay aboard', this.callbacks.onSkipHarvest, { tone: 'info' });

    if (affordable) this.startHarvest(needle);
  }

  private harvestPosition = 0;

  private startHarvest(needle: HTMLElement): void {
    let direction = 1;
    let position = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      position += direction * delta * 0.85;
      if (position >= 1) {
        position = 1;
        direction = -1;
      } else if (position <= 0) {
        position = 0;
        direction = 1;
      }
      this.harvestPosition = position;
      needle.style.left = `${position * 100}%`;
      this.harvestFrame = requestAnimationFrame(tick);
    };

    this.harvestFrame = requestAnimationFrame(tick);
    this.harvestCleanup = () => cancelAnimationFrame(this.harvestFrame);
  }

  /** Stop the sweep and return the needle's final normalised position. */
  private stopHarvest(): number {
    if (this.harvestCleanup) {
      this.harvestCleanup();
      this.harvestCleanup = null;
    }
    return this.harvestPosition;
  }

  // ----------------------------------------------------------------- score

  renderScore(state: GameState, report: ScoreReport): void {
    const card = this.card('score');
    const arrived = state.outcome === 'arrived';

    this.eyebrow(card, arrived ? 'Mission complete' : 'Mission lost');
    this.title(card, report.outcomeHeadline, { bad: !arrived });
    this.body(
      card,
      arrived
        ? `${formatMissionDate(state.day)}. The ship is down, the manifest is filed, and the colony is taking inventory of what you brought them.`
        : `${formatMissionDate(state.day)}. The crossing ended here, ${formatDistance(state.kmTotal)} out from Canaveral.`,
    );

    const lines = document.createElement('div');
    lines.className = 'score-lines';
    card.appendChild(lines);

    for (const line of report.lines) {
      const row = document.createElement('div');
      row.className = 'score-line';

      const label = document.createElement('div');
      label.className = 'score-label';
      label.textContent = line.label;
      const detail = document.createElement('span');
      detail.className = 'score-detail';
      detail.textContent = line.detail;
      label.appendChild(detail);

      const points = document.createElement('div');
      points.className = 'score-points';
      points.textContent = String(line.points);

      row.append(label, points);
      lines.appendChild(row);
    }

    const total = document.createElement('div');
    total.className = 'score-total';
    const totalLabel = document.createElement('span');
    totalLabel.textContent = `Total ×${report.multiplier} multiplier`;
    const totalValue = document.createElement('span');
    totalValue.textContent = String(report.total);
    total.append(totalLabel, totalValue);
    card.appendChild(total);

    const rating = document.createElement('div');
    rating.className = 'score-rating';
    rating.textContent = report.rating;
    card.appendChild(rating);

    const lost = state.crew.filter((member) => !member.alive);
    if (lost.length > 0) {
      const memorial = document.createElement('div');
      memorial.className = 'memorial';
      for (const member of lost) {
        const entry = document.createElement('div');
        entry.className = 'memorial-entry';
        entry.textContent = `${member.name} — died of ${member.causeOfDeath ?? 'unknown causes'} on ${formatMissionDate(member.diedOnDay ?? state.day)}`;
        memorial.appendChild(entry);
      }
      card.appendChild(memorial);
    }

    const row = this.choices(card);
    this.button(row, 'Outfit another crossing', this.callbacks.onRestart);
  }

  // -------------------------------------------------------------- settings

  /**
   * Display settings. Presentation only — nothing here touches the simulation,
   * so it is safe to open and change mid-run without pausing anything.
   */
  renderSettings(settings: DisplaySettings): void {
    const card = this.card('settings');
    this.eyebrow(card, 'Display');
    this.title(card, 'Settings');
    this.body(
      card,
      'These change how the game looks, never how it plays. Your choices are remembered between sessions.',
    );

    this.settingGroup(
      card,
      'Pixelation',
      'The scene renders into a small buffer and is scaled up. A larger buffer keeps the same palette and scanline treatment but resolves more detail.',
      PIXELATION_OPTIONS,
      settings.internalHeight,
      (value) => this.callbacks.onChangeSettings({ internalHeight: value }),
      (option) => `${option.value}p`,
    );

    this.settingGroup(
      card,
      'Brightness',
      'Applied before the palette clamp, so the colour steps land on graded values rather than being stretched afterwards.',
      BRIGHTNESS_OPTIONS,
      settings.exposure,
      (value) => this.callbacks.onChangeSettings({ exposure: value }),
    );

    this.settingGroup(
      card,
      'Retro treatment',
      'The original pixel-art look: a clamped palette, ordered dither, and scanlines. Off renders the scene cleanly with filmic tone mapping.',
      [
        { label: 'Off', value: false, detail: 'Modern. Default.' },
        { label: 'On', value: true, detail: 'The authored pixel look.' },
      ],
      settings.retro,
      (value) => this.callbacks.onChangeSettings({ retro: value }),
    );

    this.settingGroup(
      card,
      'Retro filter',
      'Recolours the whole scene to a single-hue CRT phosphor green with scanlines.',
      [
        { label: 'Off', value: false, detail: 'Full colour.' },
        { label: 'On', value: true, detail: 'Monochrome green.' },
      ],
      settings.phosphor,
      (value) => this.callbacks.onChangeSettings({ phosphor: value }),
    );

    const row = this.choices(card);
    this.button(row, 'Done ▸', this.callbacks.onCloseSettings);
  }

  private settingGroup<T extends string | number | boolean>(
    card: HTMLElement,
    heading: string,
    explanation: string,
    options: Array<SettingOption<T>>,
    current: T,
    onPick: (value: T) => void,
    badge?: (option: SettingOption<T>) => string,
  ): void {
    const section = document.createElement('section');
    section.className = 'setting-group';

    const title = document.createElement('h2');
    title.className = 'setting-heading';
    title.textContent = heading;

    const note = document.createElement('p');
    note.className = 'setting-explain';
    note.textContent = explanation;

    const row = document.createElement('div');
    row.className = 'setting-options';

    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'setting-option';
      button.dataset.actionId = `setting:${heading}:${String(option.value)}`;
      button.setAttribute('aria-pressed', String(option.value === current));

      const label = document.createElement('span');
      label.className = 'setting-option-label';
      label.textContent = badge ? `${option.label} · ${badge(option)}` : option.label;

      const detail = document.createElement('span');
      detail.className = 'setting-option-detail';
      detail.textContent = option.detail;

      button.append(label, detail);
      button.addEventListener('click', () => onPick(option.value));
      row.appendChild(button);
    }

    section.append(title, note, row);
    card.appendChild(section);
  }

  // ------------------------------------------------------------------- log

  renderLog(state: GameState): void {
    const card = this.card('log');
    // The list scrolls, not the card, so Close stays reachable however long
    // the voyage record gets.
    card.classList.add('log-card');
    this.eyebrow(card, 'Ship’s log');
    this.title(card, 'Voyage record');

    const list = document.createElement('div');
    list.className = 'log-list';
    card.appendChild(list);

    const entries = state.log.slice().reverse();
    if (entries.length === 0) {
      this.body(card, 'Nothing logged yet.');
    }

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = `log-entry is-${entry.tone}`;

      const date = document.createElement('div');
      date.className = 'log-date';
      date.textContent = entry.date;

      const text = document.createElement('div');
      text.className = 'log-text';
      text.textContent = entry.text;

      row.append(date, text);
      list.appendChild(row);
    }

    const row = this.choices(card);
    this.button(row, 'Close', this.callbacks.onCloseLog);
  }
}
