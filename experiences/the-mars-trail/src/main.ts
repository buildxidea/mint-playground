import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');

if (!canvas) {
  throw new Error('Missing #game-canvas element.');
}

const game = new Game(canvas);

void game.start().catch((error: unknown) => {
  const status = document.querySelector<HTMLElement>('#boot-status');
  if (status) {
    status.hidden = false;
    status.classList.add('is-error');
    status.textContent = `Startup failed — ${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
