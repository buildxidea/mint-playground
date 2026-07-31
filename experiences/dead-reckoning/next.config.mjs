import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const nextConfig = (phase) => ({
  output: "export",
  // Keep dev-server hot-update artifacts out of the portable production
  // directory scanned and copied by the Playground build pipeline.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next" : "dist",
  basePath: "/_experiences/dead-reckoning",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
});

export default nextConfig;
