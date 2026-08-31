import registryJson from '../../mint-assets.json';

// Thin, typed adapter over the project-owned mint-assets.json registry. This is
// the single place that translates Mint's durable logical keys + local file
// paths into browser URLs. Runtime code never talks to Mint MCP.
//
// Adapted from the source quadrotor sandbox project: asset-pack items all share
// the `canonical_model` role and are distinguished by their pack index.

export interface ArtifactRecord {
  artifactId: string;
  role: string;
  format: string;
  contentType: string;
  filename?: string;
  localPath?: string;
  runtimeUrl?: string;
  loaderHint: string;
  byteSize?: number;
  usesDraco?: boolean;
  requiresDraco?: boolean;
  requiresMeshopt?: boolean;
  requiresKtx2?: boolean;
  unknownRequiredExtensions?: string[];
}

export interface AssetRecord {
  source: { assetType: string; assetId: string };
  mode: string;
  artifacts: Record<string, ArtifactRecord>;
  thumbnailUrl?: string;
}

interface Registry {
  assetRoot: string;
  assets: Record<string, AssetRecord>;
}

const registry = registryJson as unknown as Registry;

/** Convert a project-local `public/...` path into a browser URL. */
export function toBrowserUrl(artifact: ArtifactRecord): string {
  if (artifact.runtimeUrl) return artifact.runtimeUrl;
  if (!artifact.localPath) throw new Error(`Missing runtime URL for ${artifact.artifactId}`);
  const normalized = artifact.localPath.replaceAll('\\', '/');
  const publicPrefix = 'public/';
  const rel = normalized.startsWith(publicPrefix)
    ? normalized.slice(publicPrefix.length)
    : normalized;
  return `${import.meta.env.BASE_URL}${rel}`;
}

export function hasAsset(key: string): boolean {
  return Boolean(registry.assets[key]);
}

export function getAsset(key: string): AssetRecord {
  const asset = registry.assets[key];
  if (!asset) {
    throw new Error(`Mint asset "${key}" is not registered in mint-assets.json`);
  }
  return asset;
}

/**
 * Pack item GLBs in authored order. Mint encodes the item ordinal in the
 * artifact id as `asset_pack_item_glb:<pack>:<index>:<item>`; sorting on that
 * index keeps the runtime's part order locked to the authored item order.
 */
export function getPackItemUrls(key: string): string[] {
  if (!hasAsset(key)) return [];
  const items = Object.entries(getAsset(key).artifacts)
    .filter(([, artifact]) => artifact.loaderHint === 'gltf' && artifact.format === 'glb')
    .map(([artifactKey, artifact]) => {
      const parts = artifactKey.split(':');
      const index = Number.parseInt(parts[2] ?? '', 10);
      return { index: Number.isFinite(index) ? index : 0, artifact };
    })
    .sort((a, b) => a.index - b.index);

  return items.map((i) => toBrowserUrl(i.artifact));
}

/** Browser URL for the canonical model GLB of a single-model asset. */
export function getModelUrl(key: string): string | null {
  if (!hasAsset(key)) return null;
  const asset = getAsset(key);
  const model =
    Object.values(asset.artifacts).find((a) => a.role === 'canonical_model') ??
    Object.values(asset.artifacts).find((a) => a.loaderHint === 'gltf');
  return model ? toBrowserUrl(model) : null;
}

/** Browser URL for the audio artifact of an audio asset, or null. */
export function getAudioUrl(key: string): string | null {
  if (!hasAsset(key)) return null;
  const asset = getAsset(key);
  const audio = Object.values(asset.artifacts).find((a) => a.loaderHint === 'audio');
  return audio ? toBrowserUrl(audio) : null;
}

/**
 * Assert the runtime can actually decode everything this asset needs, before
 * a loader fails deep inside a parse with a less obvious message.
 */
export function assertLoadable(key: string): void {
  const asset = getAsset(key);
  for (const art of Object.values(asset.artifacts)) {
    if (art.unknownRequiredExtensions && art.unknownRequiredExtensions.length > 0) {
      throw new Error(
        `Asset "${key}" needs unsupported glTF extensions: ${art.unknownRequiredExtensions.join(', ')}`,
      );
    }
    if (art.requiresMeshopt) {
      throw new Error(`Asset "${key}" requires a Meshopt decoder that is not configured.`);
    }
    if (art.requiresKtx2) {
      throw new Error(`Asset "${key}" requires a KTX2 loader that is not configured.`);
    }
  }
}
