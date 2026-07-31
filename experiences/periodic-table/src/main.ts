import type { ElementData } from './types';
import elementsJson from './data/elements.json';
import { App } from './app';

const overlay = document.getElementById('overlay')!;

function showError(message: string): void {
  overlay.classList.add('error');
  overlay.classList.remove('hidden');
  overlay.querySelector('.title')!.textContent = 'Unable to start';
  overlay.querySelector('.detail')!.textContent = message;
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

try {
  if (!supportsWebGL()) {
    showError('This experience needs WebGL, which your browser or device has disabled.');
  } else {
    const elements = elementsJson as ElementData[];
    if (!Array.isArray(elements) || elements.length !== 118) {
      throw new Error('element dataset failed to load');
    }
    const app = new App(document.getElementById('app')!, elements);
    app.onFirstFrame = () => overlay.classList.add('hidden');
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__pt3dApp = app;
    }
  }
} catch (err) {
  console.error(err);
  showError('Something went wrong while starting the 3D scene. Try reloading the page.');
}
