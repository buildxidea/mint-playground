import { PATTERN_LABEL, type Level } from '../game/levels';
import type { LevelProgress, LevelResult } from './Scoring';

const percent = (value: number) => `${Math.round(value * 100)}%`;

export type TitleEntry = {
  level: Level;
  index: number;
  unlocked: boolean;
  progress: LevelProgress | undefined;
};

export type TitleHandlers = {
  onStart(): void;
  onSelect(index: number): void;
};

export type SettingsHandlers = {
  onResume(): void;
  onRestart(): void;
  onMenu(): void;
  onToggleMute(): void;
  muted: boolean;
};

/** The instructions are a separate page so every entry point can open them
 *  in a new tab rather than burying them in a dialog. Built from BASE_URL so it
 *  survives being served from a repository sub-path on GitHub Pages. */
export const HOW_TO_PLAY_URL = `${import.meta.env.BASE_URL}how-to-play.html`;

export class Hud {
  private readonly levelIndex = this.element('#level-index');
  private readonly levelName = this.element('#level-name');
  private readonly patternIcon = this.element('#pattern-icon');
  private readonly patternLabel = this.element('#pattern-label');
  private readonly fuelFill = this.element('#fuel-fill');
  private readonly coverageValue = this.element('#coverage-value');
  private readonly overlay = this.element('#overlay');
  private readonly overlayCard = this.element('#overlay-card');
  private readonly titleScreen = this.element('#title-screen');
  private readonly muteButton = this.element('#mute-button');
  private readonly hudRoot = this.element('#hud');

  /** Reflects the mute state on the HUD button. */
  setMuted(muted: boolean): void {
    this.muteButton.setAttribute('aria-pressed', String(muted));
    const label = muted ? 'Unmute sound' : 'Mute sound';
    this.muteButton.setAttribute('aria-label', label);
    this.muteButton.setAttribute('title', label);
  }

  onMuteClick(handler: () => void): void {
    this.muteButton.addEventListener('click', handler);
  }

  /** The landing page: wordmark, a big play button, a link out to the full
   *  instructions, and the yard picker, all over the live 3D scene. */
  showTitle(entries: TitleEntry[], handlers: TitleHandlers): void {
    const nextIndex =
      entries.find((entry) => entry.unlocked && !entry.progress?.passed)?.index ?? 0;
    const started = entries.some((entry) => entry.progress);

    this.titleScreen.innerHTML = `
      <nav class="title-nav">
        <span class="nav-mark">
          <span class="nav-stripes" aria-hidden="true"></span>
          Mowed
        </span>
        <span class="nav-links">
          <a class="nav-link" href="${HOW_TO_PLAY_URL}" target="_blank" rel="noopener">
            How to play
          </a>
        </span>
      </nav>

      <section class="title-hero">
        <h1>Mowed</h1>
        <p class="tagline">
          Five overgrown yards. One tank of fuel each. Cut them into clean
          parallel stripes before you run dry.
        </p>
        <div class="hero-actions">
          <button type="button" class="start-button" id="start-button">
            ${started ? `Continue &middot; Yard ${nextIndex + 1}` : 'Play'}
          </button>
          <a
            class="ghost-button"
            id="how-to-play-link"
            href="${HOW_TO_PLAY_URL}"
            target="_blank"
            rel="noopener"
          >
            How to play
          </a>
        </div>
        <p class="start-hint">
          or press <span class="key-cap">Enter</span> &middot; drive with
          <span class="key-cap">W</span><span class="key-cap">A</span><span class="key-cap">S</span><span class="key-cap">D</span>
        </p>
      </section>

      <section class="yard-strip">
        <h2>The yards</h2>
        <div class="yard-list">
          ${entries.map((entry) => this.yardRow(entry)).join('')}
        </div>
      </section>
    `;

    this.titleScreen.hidden = false;
    // The play HUD has nothing to say on the landing page.
    this.hudRoot.hidden = true;

    this.titleScreen
      .querySelector<HTMLButtonElement>('#start-button')
      ?.addEventListener('click', () => handlers.onStart());

    for (const button of this.titleScreen.querySelectorAll<HTMLButtonElement>('.yard-row')) {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.index);
        if (!Number.isNaN(index)) handlers.onSelect(index);
      });
    }
  }

  hideTitle(): void {
    this.titleScreen.hidden = true;
    this.hudRoot.hidden = false;
  }

  private yardRow(entry: TitleEntry): string {
    const { level, index, unlocked, progress } = entry;
    const grade = !unlocked
      ? '<span class="yard-grade is-locked">Locked</span>'
      : progress
        ? `<span class="yard-grade">${progress.grade}</span>`
        : '<span class="yard-grade is-unplayed">New</span>';

    return `
      <button type="button" class="yard-row" data-index="${index}" ${unlocked ? '' : 'disabled'}>
        <span class="yard-top">
          <span class="yard-number">Yard ${index + 1}</span>
          ${grade}
        </span>
        <span class="yard-name">${level.name}</span>
        <span class="yard-pattern">
          <span class="pattern-icon pattern-${level.target}" aria-hidden="true"></span>
          <span>${PATTERN_LABEL[level.target]}</span>
        </span>
      </button>
    `;
  }

  setLevel(level: Level, index: number, total: number): void {
    this.levelIndex.textContent = `${index + 1} / ${total}`;
    this.levelName.textContent = level.name;
    this.patternIcon.className = `pattern-icon pattern-${level.target}`;
    this.patternLabel.textContent = PATTERN_LABEL[level.target];
  }

  update(fuelFraction: number, coverage: number): void {
    const clamped = Math.max(0, Math.min(1, fuelFraction));
    this.fuelFill.style.width = `${clamped * 100}%`;
    this.fuelFill.classList.toggle('is-low', clamped <= 0.3 && clamped > 0.12);
    this.fuelFill.classList.toggle('is-critical', clamped <= 0.12);
    this.coverageValue.textContent = percent(coverage);
  }

  showIntro(level: Level, index: number, total: number): void {
    this.overlayCard.innerHTML = `
      <h1>${level.name}</h1>
      <p>
        Yard ${index + 1} of ${total} — ${PATTERN_LABEL[level.target].toLowerCase()} lanes.
        ${level.hint}
      </p>
      <div class="key-hints">
        <span><kbd>Enter</kbd> start mowing</span>
        <span><kbd>WASD</kbd> drive</span>
        <span><kbd>F</kbd> finish early</span>
        <span><kbd>M</kbd> menu</span>
      </div>
    `;
    this.showOverlay();
  }

  /** Settings, reachable from the gear button or Esc. Pauses the yard. */
  showSettings(handlers: SettingsHandlers): void {
    this.overlayCard.innerHTML = `
      <h1>Settings</h1>
      <p>The grass is not going anywhere.</p>
      <div class="dialog-actions">
        <button type="button" class="dialog-action is-primary" data-action="resume">
          <span>Resume mowing</span><span class="action-key">Esc</span>
        </button>
        <a
          class="dialog-action"
          href="${HOW_TO_PLAY_URL}"
          target="_blank"
          rel="noopener"
          data-action="how-to-play"
        >
          <span>How to play</span><span class="action-key">New tab</span>
        </a>
        <button type="button" class="dialog-action" data-action="mute">
          <span>Sound</span
          ><span class="action-key">${handlers.muted ? 'Muted' : 'On'}</span>
        </button>
        <button type="button" class="dialog-action" data-action="restart">
          <span>Restart this yard</span><span class="action-key">R</span>
        </button>
        <button type="button" class="dialog-action" data-action="menu">
          <span>Back to the main menu</span><span class="action-key">M</span>
        </button>
      </div>
    `;
    this.showOverlay();

    this.bindAction('resume', handlers.onResume);
    this.bindAction('restart', handlers.onRestart);
    this.bindAction('menu', handlers.onMenu);
    this.bindAction('mute', handlers.onToggleMute);
  }

  private bindAction(name: string, handler: () => void): void {
    this.overlayCard
      .querySelector<HTMLElement>(`[data-action="${name}"]`)
      ?.addEventListener('click', handler);
  }

  showResults(
    level: Level,
    result: LevelResult,
    isLastLevel: boolean,
    ranOutOfFuel: boolean,
  ): void {
    const coverageMiss = result.coverage < level.pass.coverage;
    const patternMiss = result.pattern < level.pass.pattern;

    const headline = result.passed
      ? isLastLevel
        ? 'Every yard on the street'
        : 'Yard done'
      : ranOutOfFuel
        ? 'Out of fuel'
        : 'Not quite done';

    const advice = result.passed
      ? isLastLevel
        ? 'That is the last yard. Replay any level for a better grade.'
        : 'Next yard is ready when you are.'
      : coverageMiss
        ? `You need ${percent(level.pass.coverage)} coverage to pass this yard.`
        : `Your lanes need to match the ${PATTERN_LABEL[level.target].toLowerCase()} pattern more closely.`;

    this.overlayCard.innerHTML = `
      <h2>${headline}</h2>
      <div class="grade-stamp${result.passed ? '' : ' is-fail'}">${result.grade}</div>
      <div class="result-rows">
        <div class="result-row${coverageMiss ? ' is-miss' : ''}">
          <span>Coverage</span><strong>${percent(result.coverage)}</strong>
        </div>
        <div class="result-row${patternMiss ? ' is-miss' : ''}">
          <span>Pattern match</span><strong>${percent(result.pattern)}</strong>
        </div>
        <div class="result-row">
          <span>Fuel left</span><strong>${percent(result.fuelRemaining)}</strong>
        </div>
        <div class="result-row">
          <span>Wasted overlap</span><strong>${percent(result.overlap)}</strong>
        </div>
      </div>
      <p>${advice}</p>
      <div class="key-hints">
        ${
          result.passed && !isLastLevel
            ? '<span><kbd>Enter</kbd> next yard</span>'
            : '<span><kbd>Enter</kbd> mow it again</span>'
        }
        <span><kbd>R</kbd> retry</span>
        <span><kbd>M</kbd> menu</span>
      </div>
    `;
    this.showOverlay();
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
  }

  private showOverlay(): void {
    this.overlay.hidden = false;
  }

  private element(selector: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`Missing HUD element: ${selector}`);
    return found;
  }
}
