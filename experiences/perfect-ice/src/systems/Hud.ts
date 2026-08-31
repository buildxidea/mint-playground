import { LEVELS } from '../game/levels';
import type { GamePhase, LevelDefinition, RunStats, ScoreBreakdown } from '../game/types';

export type HudCallbacks = {
  onStart(): void;
  onResume(): void;
  onRetry(): void;
  onNext(): void;
  onSelectLevel(index: number): void;
  onPause(): void;
  onMute(): void;
};

export type HudSnapshot = {
  phase: GamePhase;
  level: LevelDefinition;
  coverage: number;
  elapsed: number;
  water: number;
  fuel: number;
  overlapRatio: number;
  collisions: number;
  resurfacing: boolean;
};

type PrimaryAction = 'start' | 'resume' | 'retry' | 'next';

export class Hud {
  private readonly levelNumber = this.get('#level-number');
  private readonly levelName = this.get('#level-name');
  private readonly coverageDial = this.get('#coverage-dial');
  private readonly coverageValue = this.get('#coverage-value');
  private readonly coverageTarget = this.get('#coverage-target');
  private readonly timerValue = this.get('#timer-value');
  private readonly parValue = this.get('#par-value');
  private readonly waterMeter = this.get('#water-meter');
  private readonly waterValue = this.get('#water-value');
  private readonly fuelMeter = this.get('#fuel-meter');
  private readonly fuelValue = this.get('#fuel-value');
  private readonly overlapValue = this.get('#overlap-value');
  private readonly collisionValue = this.get('#collision-value');
  private readonly statusBanner = this.get('#status-banner');
  private readonly statusText = this.get('#status-text');
  private readonly statusHint = this.get('#status-hint');
  private readonly resurfaceButton = this.get<HTMLButtonElement>('#resurface-button');
  private readonly modal = this.get('#game-modal');
  private readonly modalKicker = this.get('#modal-kicker');
  private readonly modalTitle = this.get('#modal-title');
  private readonly modalSubtitle = this.get('#modal-subtitle');
  private readonly modalBody = this.get('#modal-body');
  private readonly modalStats = this.get('#modal-stats');
  private readonly levelStrip = this.get('#level-strip');
  private readonly primaryButton = this.get<HTMLButtonElement>('#modal-primary');
  private readonly secondaryButton = this.get<HTMLButtonElement>('#modal-secondary');
  private readonly pauseButton = this.get<HTMLButtonElement>('#pause-button');
  private readonly muteButton = this.get<HTMLButtonElement>('#mute-button');
  private readonly screenFlash = this.get('#screen-flash');
  private primaryAction: PrimaryAction = 'start';
  private selectedLevel = 0;
  private starRecords = new Array<number>(LEVELS.length).fill(0);
  private unlocked = 1;

  constructor(private readonly callbacks: HudCallbacks) {
    this.primaryButton.addEventListener('click', this.onPrimary);
    this.secondaryButton.addEventListener('click', this.callbacks.onRetry);
    this.pauseButton.addEventListener('click', this.callbacks.onPause);
    this.muteButton.addEventListener('click', this.callbacks.onMute);
  }

  setProgress(stars: number[], unlocked: number): void {
    this.starRecords = LEVELS.map((_, index) => stars[index] ?? 0);
    this.unlocked = Math.max(1, Math.min(LEVELS.length, unlocked));
    this.renderLevelStrip();
  }

  showIntro(level: LevelDefinition, selectedLevel: number): void {
    this.selectedLevel = selectedLevel;
    this.primaryAction = 'start';
    this.modalKicker.textContent = `Shift ${String(level.number).padStart(2, '0')}`;
    this.modalTitle.textContent = 'Perfect Ice';
    this.modalSubtitle.textContent = `${level.name} · ${level.subtitle}`;
    this.modalBody.textContent = level.briefing;
    this.modalStats.innerHTML = [
      this.statMarkup('Coverage', `${Math.round(level.coverageTarget * 100)}%`),
      this.statMarkup('Par', this.formatTime(level.parTime)),
      this.statMarkup('Water', `${level.waterCapacity} L`),
      this.statMarkup('Best', this.starMarkup(this.starRecords[selectedLevel])),
    ].join('');
    this.primaryButton.textContent = 'Start shift';
    this.secondaryButton.hidden = true;
    this.renderLevelStrip();
    this.modal.classList.add('visible');
  }

  showPause(level: LevelDefinition): void {
    this.primaryAction = 'resume';
    this.modalKicker.textContent = `Shift ${String(level.number).padStart(2, '0')}`;
    this.modalTitle.textContent = 'On break';
    this.modalSubtitle.textContent = level.name;
    this.modalBody.textContent = 'The clock is stopped and the assembly is raised. Resume when your route is clear.';
    this.modalStats.innerHTML = '';
    this.primaryButton.textContent = 'Resume';
    this.secondaryButton.textContent = 'Restart shift';
    this.secondaryButton.hidden = false;
    this.levelStrip.hidden = true;
    this.modal.classList.add('visible');
  }

  showComplete(level: LevelDefinition, stats: RunStats, score: ScoreBreakdown, hasNext: boolean): void {
    this.primaryAction = hasNext ? 'next' : 'retry';
    this.modalKicker.textContent = 'Sheet restored';
    this.modalTitle.textContent = this.starMarkup(score.stars).replaceAll('☆', '');
    this.modalTitle.classList.add('star-row');
    this.modalSubtitle.textContent = `${score.total.toFixed(1)} points · ${level.name}`;
    this.modalBody.textContent = score.stars === 3
      ? 'A glassy finish and a disciplined route. That is a championship sheet.'
      : score.stars === 2
        ? 'A strong clean. Reduce overlap and protect your remaining water for the third star.'
        : 'The rink is ready, but the route left points behind. Tighter turns will save water and time.';
    this.modalStats.innerHTML = [
      this.statMarkup('Coverage', `${(stats.coverage * 100).toFixed(1)}%`),
      this.statMarkup('Efficiency', `${score.efficiency.toFixed(1)} / 20`),
      this.statMarkup('Water left', `${stats.water.toFixed(0)} L`),
      this.statMarkup('Collisions', String(stats.collisions)),
    ].join('');
    this.primaryButton.textContent = hasNext ? 'Next shift' : 'Drive again';
    this.secondaryButton.textContent = 'Retry shift';
    this.secondaryButton.hidden = false;
    this.levelStrip.hidden = false;
    this.renderLevelStrip();
    this.modal.classList.add('visible');
  }

  showFailure(level: LevelDefinition, reason: string, stats: RunStats): void {
    this.primaryAction = 'retry';
    this.modalKicker.textContent = 'Shift incomplete';
    this.modalTitle.textContent = 'Not yet';
    this.modalTitle.classList.remove('star-row');
    this.modalSubtitle.textContent = reason;
    this.modalBody.textContent = 'The remaining dull patches are still counted. Retry with the assembly raised during turns and use cleaner parallel spacing.';
    this.modalStats.innerHTML = [
      this.statMarkup('Coverage', `${(stats.coverage * 100).toFixed(1)}%`),
      this.statMarkup('Needed', `${Math.round(level.coverageTarget * 100)}%`),
      this.statMarkup('Water', `${stats.water.toFixed(0)} L`),
      this.statMarkup('Fuel', `${stats.fuel.toFixed(0)}%`),
    ].join('');
    this.primaryButton.textContent = 'Retry shift';
    this.secondaryButton.textContent = 'Choose rink';
    this.secondaryButton.hidden = false;
    this.levelStrip.hidden = false;
    this.renderLevelStrip();
    this.modal.classList.add('visible');
  }

  hideModal(): void {
    this.modal.classList.remove('visible');
    this.modalTitle.classList.remove('star-row');
  }

  update(snapshot: HudSnapshot): void {
    const percent = Math.min(100, snapshot.coverage * 100);
    this.levelNumber.textContent = String(snapshot.level.number).padStart(2, '0');
    this.levelName.textContent = snapshot.level.name;
    this.coverageValue.textContent = `${percent.toFixed(percent >= 99 ? 0 : 1)}%`;
    this.coverageTarget.textContent = `${Math.round(snapshot.level.coverageTarget * 100)}%`;
    this.coverageDial.style.setProperty('--coverage', `${percent * 3.6}deg`);
    this.timerValue.textContent = this.formatTime(snapshot.elapsed);
    this.parValue.textContent = `Par ${this.formatTime(snapshot.level.parTime)}`;
    const waterPercent = Math.max(0, Math.min(100, (snapshot.water / snapshot.level.waterCapacity) * 100));
    const fuelPercent = Math.max(0, Math.min(100, (snapshot.fuel / snapshot.level.fuelCapacity) * 100));
    this.waterMeter.style.width = `${waterPercent}%`;
    this.waterValue.textContent = snapshot.water.toFixed(0);
    this.fuelMeter.style.width = `${fuelPercent}%`;
    this.fuelValue.textContent = snapshot.fuel.toFixed(0);
    this.overlapValue.textContent = `${Math.round(snapshot.overlapRatio * 100)}%`;
    this.collisionValue.textContent = String(snapshot.collisions);
    this.setResurfacing(snapshot.resurfacing, snapshot.water > 0, snapshot.phase);
  }

  setMuted(muted: boolean): void {
    this.muteButton.textContent = muted ? '×' : '♪';
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
  }

  pulseCollision(): void {
    this.statusBanner.animate(
      [{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.05)' }, { transform: 'translateX(-50%) scale(1)' }],
      { duration: 190, easing: 'ease-out' },
    );
    this.screenFlash.animate([{ opacity: 0.22 }, { opacity: 0 }], { duration: 120, easing: 'ease-out' });
  }

  pulseMilestone(): void {
    this.coverageDial.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  }

  flashComplete(): void {
    this.screenFlash.style.background = '#bffaff';
    this.screenFlash.animate([{ opacity: 0.48 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
  }

  flashFailure(): void {
    this.screenFlash.style.background = '#ff6f4d';
    this.screenFlash.animate([{ opacity: 0.32 }, { opacity: 0 }], { duration: 280, easing: 'ease-out' });
  }

  dispose(): void {
    this.primaryButton.removeEventListener('click', this.onPrimary);
    this.secondaryButton.removeEventListener('click', this.callbacks.onRetry);
    this.pauseButton.removeEventListener('click', this.callbacks.onPause);
    this.muteButton.removeEventListener('click', this.callbacks.onMute);
  }

  private readonly onPrimary = (): void => {
    if (this.primaryAction === 'start') this.callbacks.onStart();
    if (this.primaryAction === 'resume') this.callbacks.onResume();
    if (this.primaryAction === 'retry') this.callbacks.onRetry();
    if (this.primaryAction === 'next') this.callbacks.onNext();
  };

  private setResurfacing(active: boolean, hasWater: boolean, phase: GamePhase): void {
    this.resurfaceButton.setAttribute('aria-pressed', String(active));
    if (phase !== 'playing') {
      this.statusBanner.dataset.tone = 'ready';
      this.statusText.textContent = phase === 'paused' ? 'Shift paused' : 'Assembly raised';
      this.statusHint.textContent = 'R / A button';
      return;
    }
    if (!hasWater) {
      this.statusBanner.dataset.tone = 'warning';
      this.statusText.textContent = 'Tank empty';
      this.statusHint.textContent = 'Shift is ending';
    } else if (active) {
      this.statusBanner.dataset.tone = 'active';
      this.statusText.textContent = 'Resurfacing';
      this.statusHint.textContent = 'Keep the strip aligned';
    } else {
      this.statusBanner.dataset.tone = 'ready';
      this.statusText.textContent = 'Assembly raised';
      this.statusHint.textContent = 'R / A button';
    }
  }

  private renderLevelStrip(): void {
    this.levelStrip.hidden = false;
    this.levelStrip.replaceChildren();
    LEVELS.forEach((level, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `level-button${index === this.selectedLevel ? ' selected' : ''}`;
      button.disabled = index >= this.unlocked;
      button.setAttribute('aria-label', `${level.name}${button.disabled ? ', locked' : ''}`);
      const number = document.createElement('b');
      number.textContent = String(level.number).padStart(2, '0');
      const stars = document.createElement('span');
      stars.textContent = button.disabled ? 'LOCK' : this.starMarkup(this.starRecords[index]);
      button.append(number, stars);
      button.addEventListener('click', () => {
        this.selectedLevel = index;
        this.callbacks.onSelectLevel(index);
      });
      this.levelStrip.append(button);
    });
  }

  private statMarkup(label: string, value: string): string {
    return `<div class="modal-stat"><span>${label}</span><b>${value}</b></div>`;
  }

  private starMarkup(stars: number): string {
    return `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0');
    const remainder = Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  private get<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
