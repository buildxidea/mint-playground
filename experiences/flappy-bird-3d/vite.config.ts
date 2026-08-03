import { defineConfig } from 'vite';

export default defineConfig({
  base: '/_experiences/flappy-bird-3d/',
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
