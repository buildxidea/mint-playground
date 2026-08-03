import * as THREE from 'three';
import { clone as cloneSkinnedGraph } from 'three/addons/utils/SkeletonUtils.js';
import { disposeObject3D } from '../../utils/dispose';
import { createMintGltfLoader } from '../createMintGltfLoader';
import { KINETIC_HALL_PROP_DEFINITION } from './inventory';
import { applyMintPropResetPose, parseMintPropPlacements } from './placements';
import type {
  ActiveMintPropSession,
  MintPropPackDefinition,
  MintPropPlacement,
  MintPropInstance,
} from './types';

export type MintPropGltf = {
  scene: THREE.Object3D;
};

export type MintPropGltfRuntime = {
  loader: {
    loadAsync(url: string): Promise<MintPropGltf>;
  };
  dispose(): void;
};

export type MintPropSessionDependencies = Readonly<{
  createGltfRuntime(): MintPropGltfRuntime;
  cloneImportedGraph(source: THREE.Object3D): THREE.Object3D;
}>;

const DEFAULT_DEPENDENCIES: MintPropSessionDependencies = {
  createGltfRuntime: createMintGltfLoader,
  cloneImportedGraph: (source) => cloneSkinnedGraph(source),
};

export class MintPropSessionSupersededError extends Error {
  constructor() {
    super('Mint prop session load was superseded, unloaded, or disposed');
    this.name = 'MintPropSessionSupersededError';
  }
}

export class MintPropAssetLoadError extends Error {
  constructor(
    readonly assetId: string,
    readonly url: string,
    options?: ErrorOptions,
  ) {
    super(`Mint prop "${assetId}" (${url}) failed to load`, options);
    this.name = 'MintPropAssetLoadError';
  }
}

/**
 * Owns a transactional set of room-scoped Mint prop presentations.
 *
 * Every unique GLB is loaded once per candidate session through Mint's shared
 * Draco-compatible loader. Repeated placements clone the imported graph while
 * sharing immutable render resources. The imported glTF root transform remains
 * canonical; reset poses are applied only to an outer presentation group.
 */
export class MintPropSession {
  private revision = 0;
  private disposed = false;
  private activeSession: ActiveMintPropSession | null = null;
  private readonly pendingCancellations = new Set<() => void>();

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly dependencies: MintPropSessionDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  get active(): ActiveMintPropSession | null {
    return this.activeSession;
  }

  async load(
    inputPlacements: readonly MintPropPlacement[],
    definition: MintPropPackDefinition = KINETIC_HALL_PROP_DEFINITION,
  ): Promise<ActiveMintPropSession> {
    if (this.disposed) throw new Error('Mint prop session has been disposed');
    const placements = parseMintPropPlacements(inputPlacements, definition.byId, definition.name);
    const loadRevision = ++this.revision;
    this.cancelPendingLoads();

    let runtime: MintPropGltfRuntime;
    try {
      runtime = this.dependencies.createGltfRuntime();
    } catch (error) {
      throw new Error('Mint prop session could not create its GLB runtime', { cause: error });
    }

    const loadedScenes = new Set<THREE.Object3D>();
    let acceptingResults = true;
    let rejectCancellation: (reason: Error) => void = () => undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const cleanupLoadedScenes = (): void => {
      for (const scene of loadedScenes) {
        scene.removeFromParent();
        disposeObject3D(scene);
      }
      loadedScenes.clear();
    };
    const cancel = (): void => {
      if (!acceptingResults) return;
      acceptingResults = false;
      cleanupLoadedScenes();
      rejectCancellation(new MintPropSessionSupersededError());
    };
    this.pendingCancellations.add(cancel);

    const uniqueAssetIds = [...new Set(placements.map(({ assetId }) => assetId))];
    const loadJobs = uniqueAssetIds.map(async (assetId) => {
      const asset = definition.byId[assetId];
      if (!asset) {
        throw new MintPropAssetLoadError(assetId, 'unresolved');
      }
      try {
        const gltf = await runtime.loader.loadAsync(asset.publicUrl);
        if (!isDetachedObject3D(gltf.scene)) {
          throw new Error('completed without a detached Object3D scene');
        }
        if (!acceptingResults || this.disposed || loadRevision !== this.revision) {
          disposeObject3D(gltf.scene);
          throw new MintPropSessionSupersededError();
        }
        loadedScenes.add(gltf.scene);
        return [assetId, gltf.scene] as const;
      } catch (error) {
        if (error instanceof MintPropSessionSupersededError) throw error;
        throw new MintPropAssetLoadError(asset.id, asset.publicUrl, { cause: error });
      }
    });
    const runtimeSettlement = Promise.allSettled(loadJobs).then(() => runtime.dispose());
    void runtimeSettlement.catch(() => undefined);

    let candidateRoot: THREE.Group | null = null;
    try {
      const loadedEntries = await Promise.race([Promise.all(loadJobs), cancellation]);
      await runtimeSettlement;
      if (!acceptingResults || this.disposed || loadRevision !== this.revision) {
        throw new MintPropSessionSupersededError();
      }

      const loadedByAsset = new Map<string, THREE.Object3D>(loadedEntries);
      const built = this.buildCandidate(definition, placements, loadedByAsset, loadedScenes);
      candidateRoot = built.root;

      if (!acceptingResults || this.disposed || loadRevision !== this.revision) {
        throw new MintPropSessionSupersededError();
      }

      acceptingResults = false;
      const previous = this.activeSession;
      this.parent.add(built.root);
      this.activeSession = built;
      if (previous) disposeActiveSession(previous);
      candidateRoot = null;
      return built;
    } catch (error) {
      acceptingResults = false;
      if (candidateRoot) {
        disposeObject3D(candidateRoot);
        candidateRoot.clear();
      }
      cleanupLoadedScenes();
      throw error;
    } finally {
      this.pendingCancellations.delete(cancel);
    }
  }

  reset(): void {
    this.activeSession?.reset();
  }

  unload(): void {
    this.revision += 1;
    this.cancelPendingLoads();
    this.unloadActive();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.cancelPendingLoads();
    this.unloadActive();
  }

  private buildCandidate(
    definition: MintPropPackDefinition,
    placements: readonly MintPropPlacement[],
    loadedByAsset: ReadonlyMap<string, THREE.Object3D>,
    loadedScenes: Set<THREE.Object3D>,
  ): ActiveMintPropSession {
    const root = new THREE.Group();
    root.name = `mint-props:${definition.roomId}`;
    root.userData.productionAsset = true;
    root.userData.mintAssetPackId = definition.assetPackId;
    root.userData.roomId = definition.roomId;

    const firstInstanceUsed = new Set<string>();
    const instances: MintPropInstance[] = [];
    try {
      for (const placement of placements) {
        const asset = definition.byId[placement.assetId];
        if (!asset) {
          throw new Error(`Unknown Mint prop asset "${placement.assetId}"`);
        }
        const canonical = loadedByAsset.get(placement.assetId);
        if (!canonical) {
          throw new Error(`Mint prop "${placement.assetId}" completed without a loaded scene`);
        }
        const imported = firstInstanceUsed.has(placement.assetId)
          ? this.dependencies.cloneImportedGraph(canonical)
          : canonical;
        firstInstanceUsed.add(placement.assetId);
        loadedScenes.delete(imported);

        const presentation = new THREE.Group();
        presentation.name = `mint-prop:${placement.instanceId}`;
        presentation.userData.mintPropInstanceId = placement.instanceId;
        presentation.userData.mintPropAssetId = asset.id;
        presentation.userData.rigidPropReady = asset.capabilities.rigidPropReady;
        presentation.userData.articulatedInteractionReady =
          asset.capabilities.articulatedInteractionReady;
        applyMintPropResetPose(presentation, placement.resetPose);
        presentation.add(imported);
        root.add(presentation);

        instances.push(
          Object.freeze({
            placement,
            asset,
            root: presentation,
            imported,
            reset: () => applyMintPropResetPose(presentation, placement.resetPose),
          }),
        );
      }
    } catch (error) {
      disposeObject3D(root);
      root.clear();
      throw error;
    }

    const frozenInstances = Object.freeze(instances);
    return Object.freeze({
      root,
      instances: frozenInstances,
      reset: () => {
        for (const instance of frozenInstances) instance.reset();
      },
    });
  }

  private cancelPendingLoads(): void {
    for (const cancel of [...this.pendingCancellations]) cancel();
  }

  private unloadActive(): void {
    if (!this.activeSession) return;
    disposeActiveSession(this.activeSession);
    this.activeSession = null;
  }
}

function disposeActiveSession(active: ActiveMintPropSession): void {
  active.root.removeFromParent();
  disposeObject3D(active.root);
  active.root.clear();
}

function isDetachedObject3D(value: unknown): value is THREE.Object3D {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { isObject3D?: boolean }).isObject3D &&
    !(value as THREE.Object3D).parent,
  );
}
