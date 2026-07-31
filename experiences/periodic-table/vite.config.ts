import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
