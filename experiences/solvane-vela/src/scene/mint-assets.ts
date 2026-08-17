import registryJson from "../../mint-assets.json";

type MintRegistry = {
  assets: Record<string, { artifacts?: Record<string, { runtimeUrl?: string }> }>;
};

export function mintModelUrl(assetKey: string, artifactId = "original_glb") {
  const url = (registryJson as MintRegistry).assets[assetKey]?.artifacts?.[artifactId]?.runtimeUrl;
  if (!url) throw new Error(`Missing Mint CDN artifact ${assetKey}:${artifactId}`);
  return url;
}
