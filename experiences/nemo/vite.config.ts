import { defineConfig } from 'vite';

export default defineConfig({
  base: '/_experiences/nemo/',
  server: {
    host: '127.0.0.1',
    port: 5194,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4194,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        landing: 'index.html',
        game: 'play/index.html',
      },
    },
  },
});
