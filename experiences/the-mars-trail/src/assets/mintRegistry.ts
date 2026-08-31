/**
 * Read-side accessor for the project's Mint asset registry.
 *
 * `mint-assets.json` is written by `scripts/sync-mint-assets.mjs` and is the
 * single record of every generated artifact. Runtime code resolves browser URLs
 * through here and never calls Mint MCP.
 */

import registryJson from '../../mint-assets.json';

interface ArtifactRecord {
  artifactId: string;
  role?: string;
  format?: string;
  contentType?: string;
  filename?: string;
  localPath?: string;
  runtimeUrl?: string;
  loaderHint?: string;
  requiresDraco?: boolean;
  usesDraco?: boolean;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

interface AssetRecord {
  source?: { assetType?: string; assetId?: string };
  transform?: { position?: number[]; rotation?: number[]; scale?: number[] };
  mode?: string;
  thumbnailUrl?: string;
  artifacts?: Record<string, ArtifactRecord>;
}

interface Registry {
  registryVersion: number;
  assetRoot: string;
  assets: Record<string, AssetRecord>;
}

const registry = registryJson as unknown as Registry;

/**
 * Deployment base path, with the trailing slash removed.
 *
 * On GitHub Pages the site lives under `/<repo>/`, not the domain root, so a
 * hard-coded `/assets/...` would 404 for every model, portrait, and sound.
 * Vite injects the configured base here, which is `/` in dev and locally.
 */
const BASE_PATH = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');

/**
 * Convert a registry filesystem path into a browser URL. Vite serves `public/`
 * from the site root, so that prefix is stripped and the deployment base is
 * applied in its place.
 */
function toBrowserUrl(localPath: string | undefined, runtimeUrl?: string): string | null {
  if (runtimeUrl) return runtimeUrl;
  if (!localPath) return null;
  const normalized = localPath.replace(/\\/g, '/');
  const publicIndex = normalized.indexOf('public/');
  const relative = publicIndex >= 0 ? normalized.slice(publicIndex + 'public/'.length) : normalized;
  return `${BASE_PATH}/${relative.replace(/^\/+/, '')}`;
}

export function hasAsset(key: string): boolean {
  return Boolean(registry.assets[key]);
}

export function assetKeys(): string[] {
  return Object.keys(registry.assets);
}

/** Every registry key that starts with the given prefix, in sorted order. */
export function assetKeysWithPrefix(prefix: string): string[] {
  return assetKeys()
    .filter((key) => key.startsWith(prefix))
    .sort();
}

/**
 * Resolve one artifact URL for an asset. Prefers a role when given, then the
 * canonical model role, then the first artifact present.
 */
export function artifactUrl(key: string, role?: string): string | null {
  const asset = registry.assets[key];
  if (!asset?.artifacts) return null;
  const artifacts = Object.values(asset.artifacts);
  if (artifacts.length === 0) return null;

  const byRole = role ? artifacts.find((entry) => entry.role === role) : undefined;
  const canonical = artifacts.find((entry) => entry.role === 'canonical_model');
  const chosen = byRole ?? canonical ?? artifacts[0];
  return toBrowserUrl(chosen.localPath, chosen.runtimeUrl);
}

/** True when the asset's chosen GLB declares a required Draco dependency. */
export function requiresDraco(key: string, role?: string): boolean {
  const asset = registry.assets[key];
  if (!asset?.artifacts) return false;
  const artifacts = Object.values(asset.artifacts);
  const byRole = role ? artifacts.find((entry) => entry.role === role) : undefined;
  const canonical = artifacts.find((entry) => entry.role === 'canonical_model');
  const chosen = byRole ?? canonical ?? artifacts[0];
  return Boolean(chosen?.requiresDraco ?? chosen?.usesDraco);
}

export function thumbnailUrl(key: string): string | null {
  return toBrowserUrl(registry.assets[key]?.thumbnailUrl);
}

/** Authored placement for an asset, editable in the registry. */
export function assetTransform(key: string): {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
} {
  const transform = registry.assets[key]?.transform;
  const triple = (
    values: number[] | undefined,
    fallback: [number, number, number],
  ): [number, number, number] =>
    values && values.length === 3 ? [values[0], values[1], values[2]] : fallback;

  return {
    position: triple(transform?.position, [0, 0, 0]),
    rotation: triple(transform?.rotation, [0, 0, 0]),
    scale: triple(transform?.scale, [1, 1, 1]),
  };
}

export const mintProjectConfigured = Object.keys(registry.assets).length > 0;
