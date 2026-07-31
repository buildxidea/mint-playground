import { defineConfig } from "vite";

// GitHub Pages serves this project site under /compound-visualization/.
// Apply that base only for the production build so local dev stays at "/".
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/compound-visualization/" : "/",
  server: {
    host: true,
  },
}));
