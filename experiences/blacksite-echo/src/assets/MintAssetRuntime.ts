import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { MINT_MANIFEST } from './AssetCatalog';

export type MintArtifactKind =
  | 'model'
  | 'material'
  | 'image'
  | 'audio'
  | 'animation';

export type MintArtifactRecord = {
  id: string;
  kind: MintArtifactKind;
  status: 'final';
  publicPath: string;
  suggestedPath?: string;
  loaderHint?: string;
  chatUrl?: string;
  license?: string;
  bytes?: number;
  metadata?: Record<string, unknown>;
};

export type MintWorldRuntime = {
  runtimeUrl: string;
  collider: {
    runtimeUrl: string;
  };
};

export type MintWorldRole = 'operations' | 'mission' | 'zombies';

export type MintWorldRecord = {
  id: string;
  role: MintWorldRole;
  /** Mission campus slot. Hub/spawn is 0; satellites are 1+. */
  roomIndex?: number;
  status: 'final';
  integrationMode: 'remote_stream';
  chatUrl?: string;
  runtime: MintWorldRuntime;
  placement?: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
  };
  metadata?: Record<string, unknown>;
};

export type MintProjectManifest = {
  schemaVersion: number;
  provider: 'mint';
  mode: 'automatic';
  status: string;
  endpoint: string;
  reason?: string;
  artifacts: MintArtifactRecord[];
  world?: MintWorldRecord | null;
  worlds?: MintWorldRecord[];
  expectedArtifacts?: string[];
  productionPolicy?: {
    visibleFallbacks: boolean;
    audibleFallbacks: boolean;
  };
  coverage?: {
    passed: boolean;
    missing: string[];
    blockers: string[];
  };
  runtimeMcpCalls: false;
};

const manifest = MINT_MANIFEST as unknown as MintProjectManifest;
const MINT_DRACO_DECODER_PATH =
  'https://cdn.mint.gg/runtime/draco/gltf/three-0.184.0/';

function isSafePublicPath(path: string): boolean {
  if (path.startsWith('/assets/mint/') && !path.includes('..')) return true;
  try {
    const url = new URL(path);
    return url.protocol === 'https:' && url.hostname === 'cdn.mint.gg';
  } catch {
    return false;
  }
}

function validateWorld(world: MintWorldRecord | null | undefined): MintWorldRecord | null {
  if (!world || world.status !== 'final' || world.integrationMode !== 'remote_stream') {
    return null;
  }
  if (
    !world.runtime?.runtimeUrl?.startsWith('https://') ||
    !world.runtime.collider?.runtimeUrl?.startsWith('https://')
  ) {
    return null;
  }
  return world;
}

export class MintAssetRuntime {
  private readonly dracoLoader = new DRACOLoader().setDecoderPath(
    MINT_DRACO_DECODER_PATH,
  );
  private readonly gltfLoader = new GLTFLoader().setDRACOLoader(
    this.dracoLoader,
  );
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly modelCache = new Map<string, Promise<GLTF>>();
  private readonly textureCache = new Map<string, Promise<THREE.Texture>>();
  private readonly animationCache = new Map<string, Promise<THREE.AnimationClip[]>>();

  get status(): string {
    return manifest.status;
  }

  dispose(): void {
    this.dracoLoader.dispose();
  }

  get visibleFallbacksAllowed(): boolean {
    return manifest.productionPolicy?.visibleFallbacks ?? true;
  }

  get audibleFallbacksAllowed(): boolean {
    return manifest.productionPolicy?.audibleFallbacks ?? true;
  }

  get coveragePassed(): boolean {
    return manifest.coverage?.passed ?? false;
  }

  get coverageBlockers(): string[] {
    return [...(manifest.coverage?.blockers ?? [])];
  }

  get finalArtifactCount(): number {
    return manifest.artifacts.filter(
      (artifact) => artifact.status === 'final' && isSafePublicPath(artifact.publicPath),
    ).length;
  }

  get world(): MintWorldRecord | null {
    return this.getWorld('mission');
  }

  private get worldCandidates(): MintWorldRecord[] {
    if (manifest.worlds?.length) return manifest.worlds;
    return manifest.world ? [manifest.world] : [];
  }

  getWorld(role: MintWorldRole): MintWorldRecord | null {
    const matches = this.listWorlds(role);
    if (matches.length === 0) return null;
    if (role === 'mission' || role === 'zombies') {
      return (
        matches.find((world) => (world.roomIndex ?? 0) === 0) ?? matches[0] ?? null
      );
    }
    return matches[0] ?? null;
  }

  listWorlds(role: MintWorldRole): MintWorldRecord[] {
    return this.worldCandidates
      .map((world) => validateWorld(world))
      .filter((world): world is MintWorldRecord => world !== null)
      .filter((world) => world.role === role)
      .sort((a, b) => (a.roomIndex ?? 0) - (b.roomIndex ?? 0));
  }

  get finalWorldCount(): number {
    return this.worldCandidates
      .map((world) => validateWorld(world))
      .filter((world): world is MintWorldRecord => world !== null).length;
  }

  getArtifact(id: string, kind?: MintArtifactKind): MintArtifactRecord | null {
    const artifact = manifest.artifacts.find(
      (entry) =>
        entry.id === id &&
        entry.status === 'final' &&
        (!kind || entry.kind === kind) &&
        isSafePublicPath(entry.publicPath),
    );
    return artifact ?? null;
  }

  listArtifacts(kind?: MintArtifactKind): MintArtifactRecord[] {
    return manifest.artifacts.filter(
      (artifact) =>
        artifact.status === 'final' &&
        (!kind || artifact.kind === kind) &&
        isSafePublicPath(artifact.publicPath),
    );
  }

  getPublicUrl(id: string, kind?: MintArtifactKind): string | null {
    return this.getArtifact(id, kind)?.publicPath ?? null;
  }

  getSemanticPaths(
    id: string,
    metadataKey = 'semanticPaths',
  ): Record<string, string> {
    const artifact = this.getArtifact(id);
    const value = artifact?.metadata?.[metadataKey];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && isSafePublicPath(entry[1]),
      ),
    );
  }

  getRoleSemanticPaths(
    id: string,
    role: string,
  ): Record<string, string> {
    const artifact = this.getArtifact(id, 'animation');
    const rolePaths = artifact?.metadata?.rolePaths;
    if (!rolePaths || typeof rolePaths !== 'object' || Array.isArray(rolePaths)) return {};
    const value = (rolePaths as Record<string, unknown>)[role];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && isSafePublicPath(entry[1]),
      ),
    );
  }

  async instantiateModel(id: string): Promise<THREE.Group | null> {
    const artifact = this.getArtifact(id, 'model');
    if (!artifact) return null;
    let pending = this.modelCache.get(id);
    if (!pending) {
      pending = this.gltfLoader.loadAsync(artifact.publicPath);
      this.modelCache.set(id, pending);
    }
    const gltf = await pending;
    const instance = cloneSkeleton(gltf.scene) as THREE.Group;
    instance.name = `mint-${id}`;
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = true;
    });
    return instance;
  }

  async loadTexture(id: string): Promise<THREE.Texture | null> {
    const artifact = this.getArtifact(id, 'image');
    if (!artifact) return null;
    let pending = this.textureCache.get(id);
    if (!pending) {
      pending = this.textureLoader.loadAsync(artifact.publicPath).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        return texture;
      });
      this.textureCache.set(id, pending);
    }
    return pending;
  }

  async createPbrMaterial(role: string): Promise<THREE.MeshStandardMaterial | null> {
    const artifact = this.getArtifact('pbr-material-kit', 'material');
    const roleMaps = artifact?.metadata?.roleMaps;
    if (!roleMaps || typeof roleMaps !== 'object' || Array.isArray(roleMaps)) return null;
    const maps = (roleMaps as Record<string, unknown>)[role];
    if (!maps || typeof maps !== 'object' || Array.isArray(maps)) return null;
    const mapPaths = maps as Record<string, unknown>;
    const load = async (key: string, srgb = false): Promise<THREE.Texture | null> => {
      const publicPath = mapPaths[key];
      if (typeof publicPath !== 'string' || !isSafePublicPath(publicPath)) return null;
      let pending = this.textureCache.get(publicPath);
      if (!pending) {
        pending = this.textureLoader.loadAsync(publicPath).then((texture) => {
          texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.needsUpdate = true;
          return texture;
        });
        this.textureCache.set(publicPath, pending);
      }
      return pending;
    };
    const [map, normalMap, roughnessMap, metalnessMap] = await Promise.all([
      load('baseColor', true),
      load('normal'),
      load('roughness'),
      load('metalness'),
    ]);
    if (!map) return null;
    return new THREE.MeshStandardMaterial({
      map,
      normalMap,
      roughnessMap,
      metalnessMap,
      color: '#ffffff',
      roughness: roughnessMap ? 1 : 0.65,
      metalness: metalnessMap ? 1 : 0.15,
    });
  }

  async loadAnimationPath(path: string): Promise<THREE.AnimationClip[]> {
    if (!isSafePublicPath(path)) return [];
    let pending = this.animationCache.get(path);
    if (!pending) {
      pending = this.gltfLoader.loadAsync(path).then((gltf) =>
        gltf.animations.map((clip) => clip.clone()),
      );
      this.animationCache.set(path, pending);
    }
    return pending;
  }

  async loadAnimationSet(
    id: string,
    metadataKey = 'semanticPaths',
  ): Promise<Record<string, THREE.AnimationClip>> {
    const paths = this.getSemanticPaths(id, metadataKey);
    const loaded = await Promise.all(
      Object.entries(paths).map(async ([semantic, path]) => {
        const clips = await this.loadAnimationPath(path);
        return [semantic, clips[0] ?? null] as const;
      }),
    );
    return Object.fromEntries(
      loaded.filter(
        (entry): entry is readonly [string, THREE.AnimationClip] => entry[1] !== null,
      ),
    );
  }

  async loadRoleAnimationSet(
    id: string,
    role: string,
  ): Promise<Record<string, THREE.AnimationClip>> {
    const paths = this.getRoleSemanticPaths(id, role);
    const loaded = await Promise.all(
      Object.entries(paths).map(async ([semantic, path]) => {
        const clips = await this.loadAnimationPath(path);
        return [semantic, clips[0] ?? null] as const;
      }),
    );
    return Object.fromEntries(
      loaded.filter(
        (entry): entry is readonly [string, THREE.AnimationClip] => entry[1] !== null,
      ),
    );
  }

  diagnostics(): {
    status: string;
    finalArtifacts: number;
    worldReady: boolean;
    worldsReady: number;
    coveragePassed: boolean;
    coverageBlockers: string[];
    visibleFallbacksAllowed: boolean;
    audibleFallbacksAllowed: boolean;
    runtimeMcpCalls: false;
  } {
    return {
      status: this.status,
      finalArtifacts: this.finalArtifactCount,
      worldReady: this.world !== null,
      worldsReady: this.finalWorldCount,
      coveragePassed: this.coveragePassed,
      coverageBlockers: this.coverageBlockers,
      visibleFallbacksAllowed: this.visibleFallbacksAllowed,
      audibleFallbacksAllowed: this.audibleFallbacksAllowed,
      runtimeMcpCalls: false,
    };
  }
}
