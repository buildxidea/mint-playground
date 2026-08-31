import registryJson from "../mint-assets.json";

interface RuntimeArtifact {
  role?: string;
  runtimeUrl?: string;
}

interface RuntimeRegistry {
  assets: Record<string, { artifacts: Record<string, RuntimeArtifact> }>;
}

const registry = registryJson as RuntimeRegistry;

function modelUrl(key: string): string {
  const artifacts = Object.values(registry.assets[key]?.artifacts ?? {});
  const model = artifacts.find((artifact) => artifact.role === "canonical_model");
  if (!model?.runtimeUrl) throw new Error(`Missing published Mint model: ${key}`);
  return model.runtimeUrl;
}

export const MODEL_URLS: Record<string, string> = {
  "elevator-cab": modelUrl("elevator-cab"),
  // "door-panel" intentionally absent: two Mint door generations came back
  // with baked-on ornament, so a plain procedural steel leaf stands in
  // (see makeProceduralDoorLeaf in scene.ts).
  tower: modelUrl("tower"),
  foyer: modelUrl("foyer"),
  "passenger-bellhop": modelUrl("passenger-bellhop"),
  "passenger-guest": modelUrl("passenger-guest"),
  "passenger-worker-a": modelUrl("passenger-worker-a"),
  "passenger-worker-b": modelUrl("passenger-worker-b"),
  "passenger-resident": modelUrl("passenger-resident"),
  "passenger-server": modelUrl("passenger-server"),
  "passenger-evening": modelUrl("passenger-evening"),
  "diorama-hotel": modelUrl("diorama-hotel"),
  "diorama-office": modelUrl("diorama-office"),
  "diorama-apartment": modelUrl("diorama-apartment"),
  "diorama-restaurant": modelUrl("diorama-restaurant"),
  "diorama-penthouse": modelUrl("diorama-penthouse"),
};
