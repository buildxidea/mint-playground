import { defineConfig } from "vite";

// The port comes from the PORT environment variable when the harness assigns
// one; no port is hardcoded here or in the dev script.
const port = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  base: "/_experiences/rubix-cube/",
  build: { target: "es2022" },
  server: {
    port,
    strictPort: false,
  },
});
