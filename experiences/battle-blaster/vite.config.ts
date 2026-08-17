import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: Boolean(process.env.PORT),
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
