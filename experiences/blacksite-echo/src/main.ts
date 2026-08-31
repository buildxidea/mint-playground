import './styles.css';
import { Game } from './game/Game';
import { ensureMapsFeaturedServiceWorker } from './maps-zombies';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiRoot = document.querySelector<HTMLElement>('#ui-root');

if (!canvas || !uiRoot) {
  throw new Error('Missing required Blacksite: Echo application root.');
}

// Featured Maps Outbreak Cache API SW (Range-aware). Best-effort at boot so
// Play → shared map can serve warmed RAD/collider without waiting for OPEN.
void ensureMapsFeaturedServiceWorker();

let game: Game | null = null;

try {
  game = await Game.create(canvas, uiRoot);
  game.start();
} catch (error) {
  console.error('Blacksite: Echo failed to initialize.', error);
  const message =
    error instanceof Error ? error.message : 'Unknown initialization failure';
  const errorNode = uiRoot.querySelector<HTMLElement>('#loading-error');
  const retry = uiRoot.querySelector<HTMLButtonElement>('#loading-retry');
  const screen = uiRoot.querySelector<HTMLElement>('.loading-screen');
  if (errorNode && retry && screen) {
    screen.setAttribute('aria-busy', 'false');
    screen.classList.add('loading-failed');
    errorNode.textContent = message;
    errorNode.classList.remove('hidden');
    retry.classList.remove('hidden');
    retry.addEventListener('click', () => window.location.reload(), { once: true });
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => game?.dispose());
}
