import './styles.css';
import { Game } from './game/Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui-root');
const status = document.getElementById('status');

if (!canvas || !uiRoot || !status) {
  throw new Error('The page is missing #scene, #ui-root, or #status.');
}

const game = new Game(canvas, uiRoot, status);
void game.start();

// Vite HMR would otherwise leak a WebGL context and a running loop per edit.
if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
