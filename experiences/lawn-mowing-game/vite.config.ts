import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * GitHub Pages serves this project from https://<user>.github.io/<repo>/, so the
 * production build needs that sub-path baked in. Dev and the Playwright suite
 * stay on '/' — everything in the app reads `import.meta.env.BASE_URL` rather
 * than hardcoding either one.
 */
const REPOSITORY_BASE = '/_experiences/lawn-mowing-game/';

/**
 * 5188 is only a convenient default — the Playwright config points at it. When
 * a launcher assigns a port through PORT, honour that instead, and only insist
 * on the exact port when one was explicitly handed to us.
 */
const devPort = Number(process.env.PORT ?? 5188);
const previewPort = Number(process.env.PORT ?? 4188);
const portWasAssigned = Boolean(process.env.PORT);

export default defineConfig(() => ({
  base: REPOSITORY_BASE,
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: portWasAssigned,
  },
  preview: {
    host: '127.0.0.1',
    port: previewPort,
    strictPort: portWasAssigned,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        // The instructions are a real second page so the in-game button can
        // open them in a new tab.
        main: resolve(import.meta.dirname, 'index.html'),
        howToPlay: resolve(import.meta.dirname, 'how-to-play.html'),
      },
    },
  },
}));
