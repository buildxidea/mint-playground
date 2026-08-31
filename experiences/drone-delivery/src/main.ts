import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');

if (!canvas) {
  throw new Error('Missing #game-canvas element.');
}

// Singleton guard: if this module ever executes twice (Vite dep-optimizer
// reloads, HMR edge cases), dispose the previous instance so exactly one game
// owns the render loop, the DOM listeners, and the test hooks.
interface GameHost {
  __DRONE_DASH_GAME__?: Game;
  __DRONE_DASH_INSTANCES__?: number;
}
const host = window as unknown as GameHost;
host.__DRONE_DASH_GAME__?.dispose();
host.__DRONE_DASH_INSTANCES__ = (host.__DRONE_DASH_INSTANCES__ ?? 0) + 1;

const game = new Game(canvas);
host.__DRONE_DASH_GAME__ = game;
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
    if (host.__DRONE_DASH_GAME__ === game) host.__DRONE_DASH_GAME__ = undefined;
  });
}
