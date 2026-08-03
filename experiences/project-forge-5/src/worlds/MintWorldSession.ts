import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type {
  LoadedMintWorld,
  MintWorldLoader,
  MintWorldRuntimeManifest,
  MintWorldSplatRuntime,
} from './MintWorldLoader';

export type ActiveMintWorldSession = {
  world: LoadedMintWorld;
  physics: {
    meshes: number;
    triangles: number;
  };
};

export type MintVisualSurfaceSample = Readonly<{
  point: Readonly<{ x: number; y: number; z: number }>;
  distanceMeters: number;
}>;

type MintWorldSessionLoader = Pick<
  MintWorldLoader,
  'load' | 'unload' | 'dispose' | 'refreshAlignment'
>;

const DEFAULT_RETRY_DELAYS_MS = [250, 750] as const;

function isTransientAssetLoadFailure(error: unknown): boolean {
  return error instanceof AggregateError && error.message === 'Mint World RAD/collider load failed';
}

/**
 * Owns the production room lifecycle. A session is ready only after RAD,
 * collider GLB, collider bounds, and fixed Rapier trimeshes all succeed.
 */
export class MintWorldSession {
  private loader: MintWorldSessionLoader | null;
  private loaderPromise: Promise<MintWorldSessionLoader> | null = null;
  private active: ActiveMintWorldSession | null = null;
  private loadRevision = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly physicsWorld: PhysicsWorld,
    loader?: MintWorldSessionLoader,
    private readonly retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
  ) {
    this.loader = loader ?? null;
  }

  async load(manifest: MintWorldRuntimeManifest): Promise<ActiveMintWorldSession> {
    const revision = ++this.loadRevision;
    this.clearActive();
    const loader = this.loader ?? (await this.ensureLoader());
    if (this.disposed || revision !== this.loadRevision) {
      throw new Error('Mint World session load was superseded or disposed');
    }
    let world: LoadedMintWorld;
    let attempt = 0;
    while (true) {
      try {
        world = await loader.load(manifest);
        break;
      } catch (error) {
        if (this.disposed || revision !== this.loadRevision) throw error;
        const retryDelay = this.retryDelaysMs[attempt];
        if (retryDelay === undefined || !isTransientAssetLoadFailure(error)) throw error;
        attempt += 1;
        console.warn(
          `Transient Mint World asset load failed; retrying ${manifest.roomId} (${attempt}/${this.retryDelaysMs.length})`,
        );
        await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelay));
        if (this.disposed || revision !== this.loadRevision) {
          throw new Error('Mint World session load was superseded or disposed', { cause: error });
        }
      }
    }
    if (this.disposed || revision !== this.loadRevision) {
      loader.unload();
      throw new Error('Mint World session load was superseded or disposed');
    }
    try {
      const physics = this.physicsWorld.buildMintCollider(world.collider);
      const active = { world, physics };
      this.active = active;
      return active;
    } catch (error) {
      this.physicsWorld.clearEnvironment();
      loader.unload();
      throw error;
    }
  }

  unload(): void {
    this.loadRevision += 1;
    this.clearActive();
  }

  get alignmentDiagnostics(): LoadedMintWorld['alignment'] | null {
    return this.active?.world.alignment ?? null;
  }

  refreshAlignment(): LoadedMintWorld['alignment'] | null {
    const alignment = this.loader?.refreshAlignment();
    if (alignment && this.active) this.active.world.alignment = alignment;
    return alignment ?? this.active?.world.alignment ?? null;
  }

  sampleVisualSurface(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistanceMeters: number,
  ): readonly MintVisualSurfaceSample[] {
    if (
      !this.active ||
      ![
        origin.x,
        origin.y,
        origin.z,
        direction.x,
        direction.y,
        direction.z,
        maxDistanceMeters,
      ].every(Number.isFinite) ||
      direction.lengthSq() < 1e-8 ||
      maxDistanceMeters <= 0
    ) {
      return [];
    }
    const splat = this.active.world.splat as MintWorldSplatRuntime & {
      raycastable?: boolean;
    };
    const previousRaycastable = splat.raycastable;
    splat.raycastable = true;
    this.active.world.root.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(
      origin,
      direction.clone().normalize(),
      0,
      maxDistanceMeters,
    );
    try {
      return raycaster.intersectObject(splat, false).map((intersection) => ({
        point: {
          x: intersection.point.x,
          y: intersection.point.y,
          z: intersection.point.z,
        },
        distanceMeters: intersection.distance,
      }));
    } finally {
      splat.raycastable = previousRaycastable;
    }
  }

  private clearActive(): void {
    if (this.active) {
      this.physicsWorld.clearEnvironment();
      this.active = null;
    }
    this.loader?.unload();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadRevision += 1;
    this.clearActive();
    this.loader?.dispose();
    this.loader = null;
  }

  private async ensureLoader(): Promise<MintWorldSessionLoader> {
    if (this.disposed) throw new Error('Mint World session is disposed');
    if (this.loader) return this.loader;
    this.loaderPromise ??= import('./MintWorldLoader')
      .then(({ MintWorldLoader }) => {
        const loader = new MintWorldLoader(this.scene, this.renderer);
        if (this.disposed) {
          loader.dispose();
          throw new Error('Mint World session is disposed');
        }
        this.loader = loader;
        return loader;
      })
      .catch((error: unknown) => {
        this.loaderPromise = null;
        throw error;
      });
    return this.loaderPromise;
  }
}
