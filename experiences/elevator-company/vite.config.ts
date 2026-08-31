import { defineConfig } from "vite";

export default defineConfig({
  base: "/_experiences/elevator-company/",
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
