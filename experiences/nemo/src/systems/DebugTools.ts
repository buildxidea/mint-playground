import GUI from 'lil-gui';
import { CAMERA, SWIM } from '../config';

export type DebugTuning = {
  exposure: number;
  maxDpr: number;
};

/** Optional tuning panel, enabled with ?debug in the URL. */
export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: 'Race tuning' });
    this.gui.add(SWIM, 'baseSpeed', 6, 24, 0.5);
    this.gui.add(SWIM, 'boostSpeed', 12, 32, 0.5);
    this.gui.add(SWIM, 'bounceSpeed', 20, 50, 0.5);
    this.gui.add(SWIM, 'lateralSpeed', 4, 20, 0.5);
    this.gui.add(SWIM, 'verticalSpeed', 4, 18, 0.5);
    this.gui.add(CAMERA, 'lag', 0.02, 0.5, 0.01);
    this.gui.add(CAMERA, 'maxFov', 55, 90, 1);
    this.gui.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    this.gui.add(tuning, 'exposure', 0.6, 1.8, 0.01).onChange(onChange);
  }

  setHidden(hidden: boolean): void {
    if (!this.gui) return;
    if (hidden) this.gui.hide();
    else this.gui.show();
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
