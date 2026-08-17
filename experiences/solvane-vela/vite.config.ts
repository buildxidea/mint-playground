import { defineConfig, type Plugin } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Dev-only helper: POST /__shot with a data URL body saves a screenshot to
 * .debug-shots/ so offscreen WebGL captures can be inspected during
 * development. Not part of the production build.
 */
function debugShotPlugin(): Plugin {
  return {
    name: "debug-shot",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__shot", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const name = new URL(req.url ?? "/", "http://x").searchParams.get("name") ?? "shot";
            const match = body.match(/^data:image\/(\w+);base64,(.+)$/s);
            if (!match) throw new Error("expected data URL");
            const dir = join(server.config.root, ".debug-shots");
            mkdirSync(dir, { recursive: true });
            const file = join(dir, `${name}.${match[1] === "jpeg" ? "jpg" : match[1]}`);
            writeFileSync(file, Buffer.from(match[2], "base64"));
            res.end(file);
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [debugShotPlugin()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
  },
});
