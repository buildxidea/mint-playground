import registryJson from '../../mint-assets.json';

interface RuntimeArtifact {
  artifactId: string;
  role?: string;
  runtimeUrl?: string;
}

interface RuntimeRegistry {
  assets: Record<string, { artifacts: Record<string, RuntimeArtifact> }>;
}

const registry = registryJson as RuntimeRegistry;

export function mintArtifactUrl(key: string, role: string): string {
  const artifacts = Object.values(registry.assets[key]?.artifacts ?? {});
  const artifact = artifacts.find((candidate) => candidate.role === role);
  if (!artifact?.runtimeUrl) throw new Error(`Missing published Mint artifact: ${key}/${role}`);
  return artifact.runtimeUrl;
}
