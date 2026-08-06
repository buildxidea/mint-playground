import { defineConfig } from "vite";

export default defineConfig({
  base: "/_experiences/clicky/",
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
