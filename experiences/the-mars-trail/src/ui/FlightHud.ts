/**
 * Real-time readout shown while flying.
 *
 * Deliberately sparse: during a sequence the player's eyes are on the corridor,
 * so this carries only what changes a decision — how far through you are, how
 * hard you have been hit, and whether you have drifted off the lane.
 */

import type { FlightRunView } from '../flight/model/types';

/** Climb fraction past which the ascent has left Earth behind. */
const LEFT_EARTH_AT = 0.42;

export class FlightHud {
  private readonly root = this.element('#flight-hud');
  private readonly title = this.element('#flight-title');
  private readonly progress = this.element('#flight-progress');
  private readonly warning = this.element('#flight-warning');
  private readonly speed = this.element('#flight-speed');
  private readonly hits = this.element('#flight-hits');
  private readonly health = this.element('#flight-health');
  private readonly prompt = this.element('#flight-prompt');
  private readonly sign = this.element('#flight-sign');
  private readonly place = this.element('#flight-place');
  private readonly hint = this.element('#flight-hint');

  private lastHits = -1;
  private placeName: string | null = null;

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  setTitle(text: string): void {
    this.title.textContent = text;
    this.lastHits = -1;
  }

  /** Null in open space, where there is no place to name. */
  setPlace(text: string | null): void {
    this.placeName = text;
    if (text) this.place.textContent = text;
  }

  update(view: FlightRunView): void {
    this.progress.style.width = `${Math.round(view.progress * 100)}%`;
    this.speed.textContent = String(Math.round(view.speed * 10));

    if (view.hits !== this.lastHits) {
      this.lastHits = view.hits;
      this.hits.textContent = String(view.hits);
      // Colour the impact count once it starts to matter.
      this.hits.style.color = view.hits >= 4 ? 'var(--red)' : view.hits > 0 ? 'var(--amber)' : '';
    }

    // With the camera on the nose there is no horizon to judge the lane
    // against, so the warning has to say which way back.
    // Called out the moment the field arrives, because the transition from an
    // empty sky to a corridor full of rock is otherwise unannounced.
    this.sign.hidden = !view.hazardWarning;

    // Hidden in open space, and on the ascent once Earth is behind you.
    this.place.hidden = this.placeName === null || view.climb >= LEFT_EARTH_AT;

    // Hull health, as a bar rather than a number to infer from impacts.
    this.health.style.width = `${Math.max(0, view.health)}%`;
    this.health.style.background =
      view.health <= 30 ? 'var(--red)' : view.health <= 60 ? 'var(--amber)' : 'var(--green)';

    // The launch is a sequence, so it tells you what it wants next.
    const prompts: Record<string, string> = {
      pad: 'PRESS SPACE TO IGNITE',
      ignition: 'LIFTING — HOLD W TO CLIMB FASTER',
      boost: view.altitude > 120 ? 'PRESS Z — STAGE' : 'HOLD W',
      staged: '',
      flying: '',
    };
    const prompt = prompts[view.stage] ?? '';
    this.prompt.hidden = prompt === '';
    if (prompt) this.prompt.textContent = prompt;

    this.hint.textContent =
      view.stage === 'flying' || view.stage === 'staged'
        ? 'WASD or mouse · Esc abort'
        : 'W throttle · A/D gimbal · Z stage · Esc abort';

    this.warning.hidden = !view.offCorridor;
    if (view.offCorridor) {
      const arrows: string[] = [];
      if (view.driftX > 0) arrows.push('◀');
      if (view.driftX < 0) arrows.push('▶');
      if (view.driftY > 0) arrows.push('▼');
      if (view.driftY < 0) arrows.push('▲');
      this.warning.textContent = `${arrows.join(' ')} OFF CORRIDOR ${arrows.join(' ')}`;
    }
  }

  private element(selector: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Missing flight HUD element: ${selector}`);
    return node;
  }
}
