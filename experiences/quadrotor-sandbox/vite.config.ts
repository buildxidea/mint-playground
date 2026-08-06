import { defineConfig } from "vite";

export default defineConfig({
  base: "/_experiences/quadrotor-sandbox/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  // Rapier ships as WASM. The -compat build inlines the module as base64, so no
  // plugin is needed, but it must not be pre-bundled into a stale optimize dep.
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d-compat"],
  },
});
