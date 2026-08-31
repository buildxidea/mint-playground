import { defineConfig } from 'vite';

export default defineConfig({
  base: '/_experiences/boat-park/',
  server: {
    host: '127.0.0.1',
    port: 5192,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4192,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
