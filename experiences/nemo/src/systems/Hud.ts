import { SWIM } from '../config';

/**
 * DOM HUD: score/combo/distance/best readouts, the zoned speed meter with
 * boost reserve, the title and pause overlays, and the sting vignette flash.
 */
export class Hud {
  private readonly scoreValue = this.getElement('#score-value');
  private readonly comboValue = this.getElement('#combo-value');
  private readonly distanceValue = this.getElement('#distance-value');
  private readonly bestValue = this.getElement('#best-value');
  private readonly speedFill = this.getElement('#speed-fill');
  private readonly speedReadout = this.getElement('#speed-readout');
  private readonly boostFill = this.getElement('#boost-fill');
  private readonly titleOverlay = this.getElement('#title-overlay');
  private readonly menuOverlay = this.getElement('#menu-overlay');
  private readonly stingVignette = this.getElement('#sting-vignette');
  private readonly hudRoot = this.getElement('#hud');

  /** Wire the gear button and pause-menu buttons to game actions. */
  bindMenu(handlers: {
    onSettings: () => void;
    onResume: () => void;
    onRestart: () => void;
    onEnd: () => void;
  }): void {
    this.getElement('#settings-button').addEventListener('click', handlers.onSettings);
    this.getElement('#resume-button').addEventListener('click', handlers.onResume);
    this.getElement('#restart-button').addEventListener('click', handlers.onRestart);
    this.getElement('#end-button').addEventListener('click', handlers.onEnd);
  }

  update(
    score: number,
    combo: number,
    distance: number,
    best: number,
    speed: number,
    boostReserve: number,
  ): void {
    this.scoreValue.textContent = String(score);
    this.comboValue.textContent = `x${combo}`;
    this.comboValue.classList.toggle('combo-hot', combo >= 4);
    this.distanceValue.textContent = `${Math.floor(distance)}m`;
    this.bestValue.textContent = String(best);

    const ratio = Math.min(1, speed / SWIM.bounceSpeed);
    this.speedFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.speedFill.classList.toggle('speed-boost', speed > SWIM.baseSpeed + 1);
    this.speedFill.classList.toggle('speed-bounce', speed > SWIM.boostSpeed + 1);
    this.speedReadout.textContent = `${speed.toFixed(0)}`;
    this.boostFill.style.width = `${(boostReserve * 100).toFixed(1)}%`;
  }

  showTitle(best: number): void {
    this.bestValue.textContent = String(best);
    this.titleOverlay.classList.remove('hidden');
    this.hudRoot.classList.add('hidden');
  }

  hideTitle(): void {
    this.titleOverlay.classList.add('hidden');
    this.hudRoot.classList.remove('hidden');
  }

  setMenu(open: boolean): void {
    this.menuOverlay.classList.toggle('hidden', !open);
  }

  flashSting(): void {
    this.stingVignette.classList.remove('sting-active');
    // Force a reflow so re-adding the class restarts the animation.
    void this.stingVignette.offsetWidth;
    this.stingVignette.classList.add('sting-active');
  }

  popScore(): void {
    this.scoreValue.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
      { duration: 200, easing: 'ease-out' },
    );
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
