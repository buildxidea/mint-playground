import './styles.css';
import { ForgeApp } from './app/ForgeApp';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const operatorRoot = document.querySelector<HTMLElement>('#operator-ui');

if (!canvas || !operatorRoot) {
  throw new Error('Forge-5 bootstrap elements are missing.');
}

const app = await ForgeApp.create(canvas, operatorRoot);
app.start();
sessionStorage.removeItem('forge5:chunk-recovery-at');

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.dispose();
  });
}
