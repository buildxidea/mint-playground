import type { Color } from 'three';
import type { Swatch } from '../game/palette';

const SURFACE_LABELS = ['N', 'E', 'S', 'W'];

/** Room coverage, per-surface progress, paint supply, and the swatch bar. */
export class Hud {
  readonly root: HTMLElement;

  private readonly coverageValue: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly swatchButtons: HTMLButtonElement[] = [];
  private readonly prompt: HTMLElement;
  private readonly surfacePips: HTMLElement[] = [];
  private readonly surfaceFills: HTMLElement[] = [];

  constructor(
    parent: HTMLElement,
    palette: readonly Swatch[],
    onSwatch: (index: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'hud';

    const coverage = document.createElement('div');
    coverage.className = 'hud-coverage chunky';
    this.coverageValue = document.createElement('span');
    this.coverageValue.className = 'value';
    this.coverageValue.textContent = '0%';
    const coverageLabel = document.createElement('span');
    coverageLabel.className = 'label';
    coverageLabel.textContent = 'room painted';
    coverage.append(this.coverageValue, coverageLabel);

    // Four walls means "which one did I miss?" is a real question, so each gets
    // its own visible progress bar.
    const surfaces = document.createElement('div');
    surfaces.className = 'surface-pips';
    SURFACE_LABELS.forEach((label) => {
      const pip = document.createElement('div');
      pip.className = 'pip';
      const bar = document.createElement('div');
      bar.className = 'pip-bar';
      const fill = document.createElement('div');
      fill.className = 'pip-fill';
      bar.append(fill);
      const text = document.createElement('span');
      text.className = 'pip-label';
      text.textContent = label;
      pip.append(bar, text);
      surfaces.append(pip);
      this.surfacePips.push(pip);
      this.surfaceFills.push(fill);
    });

    const bottom = document.createElement('div');
    bottom.className = 'hud-bottom';

    this.meter = document.createElement('div');
    this.meter.className = 'paint-meter';
    this.meterFill = document.createElement('div');
    this.meterFill.className = 'fill';
    const meterCaption = document.createElement('div');
    meterCaption.className = 'caption';
    meterCaption.textContent = 'paint';
    this.meter.append(this.meterFill, meterCaption);

    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    palette.forEach((swatch, index) => {
      const button = document.createElement('button');
      button.className = 'swatch';
      button.type = 'button';
      button.style.background = `#${swatch.hex.toString(16).padStart(6, '0')}`;
      button.title = swatch.name;
      button.setAttribute('aria-label', swatch.name);
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(index + 1);
      button.append(key);
      button.addEventListener('click', () => onSwatch(index));
      this.swatchButtons.push(button);
      swatches.append(button);
    });

    const hints = document.createElement('div');
    hints.className = 'hud-hints';
    hints.innerHTML = [
      '<span>WASD MOVE</span>',
      '<span><b>SPACE</b> REFILL</span>',
      '<span>1-8 COLOUR</span>',
      '<span>R RESTART</span>',
    ].join('');

    bottom.append(this.meter, swatches, hints);

    this.prompt = document.createElement('div');
    this.prompt.className = 'hud-prompt';

    this.root.append(coverage, surfaces, bottom, this.prompt);
    parent.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('visible', visible);
  }

  setCoverage(fraction: number): void {
    this.coverageValue.textContent = `${Math.floor(fraction * 100)}%`;
  }

  setSurfaceProgress(index: number, fraction: number, active: boolean): void {
    const fill = this.surfaceFills[index];
    const pip = this.surfacePips[index];
    if (!fill || !pip) return;
    fill.style.transform = `scaleY(${Math.max(0, Math.min(1, fraction))})`;
    pip.classList.toggle('active', active);
    pip.classList.toggle('complete', fraction >= 0.995);
  }

  setPaint(fraction: number, color: Color): void {
    this.meterFill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
    this.meterFill.style.backgroundColor = `#${color.getHexString()}`;
    this.meter.classList.toggle('empty', fraction <= 0.001);
    this.meter.classList.toggle('low', fraction <= 0.25);
  }

  setActiveSwatch(index: number): void {
    this.swatchButtons.forEach((button, i) => {
      button.classList.toggle('active', i === index);
    });
  }

  setPrompt(text: string | null): void {
    this.prompt.textContent = text ?? '';
    this.prompt.classList.toggle('visible', Boolean(text));
  }
}
