import { defineConfig } from "vite";

// Honor a harness-assigned port so the dev server never fights another
// project for 5173.
const assignedPort = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  base: "./",
  server: assignedPort ? { port: assignedPort, strictPort: true } : {},
});
