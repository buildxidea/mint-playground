import registryJson from "../../mint-assets.json";

interface RegistryArtifact {
  artifactId?: string;
  role?: string;
  format?: string;
  localPath?: string;
  runtimeUrl?: string;
  loaderHint?: string;
  requiresDraco?: boolean;
}

interface RegistryAsset {
  artifacts?: Record<string, RegistryArtifact>;
}

interface Registry {
  registryVersion?: number;
  assetRoot?: string;
  assets?: Record<string, RegistryAsset>;
}

const registry = registryJson as Registry;

export const FURNITURE_KEYS = [
  "economy-seat",
  "lav-toilet",
  "lav-vanity",
  "lav-door",
  "cabin-door",
  "emergency-exit-door",
  "galley-unit",
  "psu-panel-triple",
  "psu-panel-double",
  "carry-on-suitcase",
  "duffel-bag",
  "backpack",
] as const;

export type FurnitureKey = (typeof FURNITURE_KEYS)[number];

/**
 * Converts a registry filesystem path (Vite public root) to a browser URL.
 * Resolved against the deployment base rather than the server root, so a build
 * served from a subpath still finds its models — a GitHub Pages project site
 * lives at /<repo>/, where a leading slash would miss by one directory.
 */
function toBrowserUrl(localPath: string): string {
  const normalized = localPath.replace(/\\/g, "/");
  const rel = normalized.startsWith("public/")
    ? normalized.slice("public/".length)
    : normalized;
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return new URL(rel, base).href;
}

/** Resolves the GLB URL for a synced registry key, or null if not synced yet. */
export function modelUrlFor(key: FurnitureKey): string | null {
  const artifacts = registry.assets?.[key]?.artifacts;
  if (!artifacts) return null;
  const list = Object.values(artifacts);
  const pick =
    list.find((a) => a.artifactId === "optimized_glb") ??
    list.find((a) => a.role === "canonical_model" && a.format === "glb") ??
    list.find((a) => a.format === "glb");
  if (pick?.runtimeUrl) return pick.runtimeUrl;
  return pick?.localPath ? toBrowserUrl(pick.localPath) : null;
}

export function syncedKeys(): FurnitureKey[] {
  return FURNITURE_KEYS.filter((key) => modelUrlFor(key) !== null);
}
