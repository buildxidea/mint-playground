import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: Boolean(process.env.PORT),
  },
});
