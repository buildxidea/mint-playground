import registry from "../mint-assets.json";

interface RegistryArtifact {
  runtimeUrl?: string;
  [key: string]: unknown;
}

interface RegistryAsset {
  mode: string;
  artifacts: Record<string, RegistryArtifact>;
}

const assets = registry.assets as unknown as Record<string, RegistryAsset>;

/** Published capsules have one canonical Mint CDN source per artifact. */
export function artifactMirrorUrl(assetKey: string, artifactId: string): string | undefined {
  return assets[assetKey]?.artifacts[artifactId]?.runtimeUrl;
}

/** Resolve an artifact to the exact durable URL recorded in the registry. */
export function localArtifactUrl(assetKey: string, artifactId: string): string {
  const artifact = assets[assetKey]?.artifacts[artifactId];
  if (!artifact?.runtimeUrl) {
    throw new Error(`Missing runtime artifact ${assetKey}/${artifactId} in mint-assets.json`);
  }
  return artifact.runtimeUrl;
}
