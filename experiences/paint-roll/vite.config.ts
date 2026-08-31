import { defineConfig } from 'vite';

export default defineConfig({
  base: '/_experiences/paint-roll/',
  server: {
    host: '127.0.0.1',
    port: 5193,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4193,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
