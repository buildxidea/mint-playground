import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { createMintGltfLoader } from '../assets/createMintGltfLoader';
import { disposeObject3D } from '../utils/dispose';
import { LatestLoadLifecycle } from './LatestLoadLifecycle';
import {
  assertMintWorldAlignment,
  inspectMintWorldAlignment,
  type MintWorldAlignmentDiagnostics,
} from './MintWorldAlignment';
import { parseMintWorldRuntimeManifest, type MintWorldRuntimeManifest } from './MintWorldManifest';

export type { MintWorldRuntimeManifest } from './MintWorldManifest';

export type MintWorldSplatRuntime = THREE.Object3D & {
  initialized: Promise<unknown>;
  getBoundingBox(centersOnly?: boolean): THREE.Box3;
  dispose(): void;
};

type MintWorldGltfRuntime = {
  loader: {
    loadAsync(url: string): Promise<{ scene: THREE.Group }>;
  };
  dispose(): void;
};

export type MintWorldLoaderDependencies = {
  createSparkRenderer(renderer: THREE.WebGLRenderer): THREE.Object3D & { dispose(): void };
  createSplat(url: string): MintWorldSplatRuntime;
  createGltfRuntime(): MintWorldGltfRuntime;
};

export type LoadedMintWorld = {
  manifest: MintWorldRuntimeManifest;
  root: THREE.Group;
  splat: MintWorldSplatRuntime;
  collider: THREE.Group;
  bounds: THREE.Box3;
  alignment: MintWorldAlignmentDiagnostics;
};

const DEFAULT_DEPENDENCIES: MintWorldLoaderDependencies = {
  createSparkRenderer: (renderer) =>
    new SparkRenderer({
      renderer,
      enableLod: true,
      onDirty: () => undefined,
    }),
  createSplat: (url) =>
    new SplatMesh({
      url,
      fileType: SplatFileType.RAD,
      paged: true,
      raycastable: false,
      onFrame: () => undefined,
    }),
  createGltfRuntime: createMintGltfLoader,
};

function assertUsableBounds(bounds: THREE.Box3): void {
  const components = [...bounds.min.toArray(), ...bounds.max.toArray()];
  const diagonal = bounds.getSize(new THREE.Vector3()).length();
  if (bounds.isEmpty() || !components.every(Number.isFinite) || diagonal <= 0.001) {
    throw new Error('Mint World collider must have finite, non-empty geometry bounds');
  }
}

/**
 * Production Mint World session loader. RAD and collider remain identity
 * siblings beneath one shared, manifest-owned placement root.
 */
export class MintWorldLoader {
  private readonly sparkRenderer: THREE.Object3D & { dispose(): void };
  private readonly lifecycle = new LatestLoadLifecycle();
  private readonly pendingCancellations = new Set<() => void>();
  private active: LoadedMintWorld | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    private readonly dependencies: MintWorldLoaderDependencies = DEFAULT_DEPENDENCIES,
  ) {
    this.sparkRenderer = dependencies.createSparkRenderer(renderer);
    this.scene.add(this.sparkRenderer);
  }

  async load(manifest: MintWorldRuntimeManifest): Promise<LoadedMintWorld> {
    const validatedManifest = parseMintWorldRuntimeManifest(manifest);
    const loadRevision = this.lifecycle.begin();
    this.cancelPendingLoads();
    this.unloadActive();

    const root = new THREE.Group();
    root.name = `mint-world:${validatedManifest.roomId}`;
    root.userData.productionAsset = true;
    root.position.set(...validatedManifest.rootTransform.position);
    root.rotation.set(...validatedManifest.rootTransform.rotation);
    root.scale.setScalar(validatedManifest.rootTransform.uniformScale);
    this.scene.add(root);

    const splat = this.dependencies.createSplat(validatedManifest.runtime.runtimeUrl);
    splat.name = 'mint-world-rad';
    if (validatedManifest.visualTransform) {
      splat.position.set(...validatedManifest.visualTransform.position);
      splat.rotation.set(...validatedManifest.visualTransform.rotation);
      splat.scale.setScalar(validatedManifest.visualTransform.uniformScale);
    }
    splat.userData.presentationFrame = validatedManifest.visualTransform
      ? 'declared-visual-to-collider-v1'
      : 'shared-root-v1';
    root.add(splat);

    const mintGltf = this.dependencies.createGltfRuntime();
    let collider: THREE.Group | null = null;
    let colliderDisposed = false;
    let splatDisposed = false;
    let cancelled = false;
    let rejectCancellation: (reason: Error) => void = () => undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const disposeSplat = (): void => {
      if (splatDisposed) return;
      splatDisposed = true;
      splat.dispose();
    };
    const disposeCollider = (): void => {
      if (!collider || colliderDisposed) return;
      colliderDisposed = true;
      root.remove(collider);
      disposeObject3D(collider);
      collider = null;
    };
    const cancel = (): void => {
      if (cancelled) return;
      cancelled = true;
      this.scene.remove(root);
      disposeSplat();
      disposeCollider();
      rejectCancellation(new Error('Mint World load was superseded or unloaded'));
    };
    this.pendingCancellations.add(cancel);

    try {
      const colliderPromise = mintGltf.loader
        .loadAsync(validatedManifest.runtime.collider.runtimeUrl)
        .then((gltf) => {
          collider = gltf.scene;
          if (cancelled || !this.lifecycle.isCurrent(loadRevision)) {
            disposeCollider();
          }
          return gltf.scene;
        });
      const [splatResult, colliderResult] = await Promise.race([
        Promise.allSettled([splat.initialized, colliderPromise]),
        cancellation,
      ]);

      if (splatResult.status === 'rejected' || colliderResult.status === 'rejected') {
        const reasons = [splatResult, colliderResult]
          .filter((result) => result.status === 'rejected')
          .map((result) => String(result.reason));
        throw new AggregateError(reasons, 'Mint World RAD/collider load failed');
      }
      if (!this.lifecycle.isCurrent(loadRevision)) {
        throw new Error('Mint World load was superseded or unloaded');
      }
      if (colliderResult.status !== 'fulfilled') {
        throw new Error('Mint World collider load completed without a scene');
      }
      collider = colliderResult.value;

      collider.name = 'mint-world-collider';
      root.add(collider);
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(collider);
      assertUsableBounds(bounds);
      const initialSplatBounds = splat.getBoundingBox(false);
      const alignment = assertMintWorldAlignment(
        inspectMintWorldAlignment(
          root,
          splat,
          collider,
          initialSplatBounds.isEmpty() ? null : initialSplatBounds,
          validatedManifest.visualTransform !== undefined,
        ),
      );
      const { acceleratedRaycast, MeshBVH } = await import('three-mesh-bvh');
      collider.traverse((object) => {
        object.visible = false;
        object.userData.physicsSource = 'mint-world-collider';
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry instanceof THREE.BufferGeometry) {
          mesh.geometry.boundsTree ??= new MeshBVH(mesh.geometry, { indirect: true });
          mesh.raycast = acceleratedRaycast;
        }
      });
      const loaded = { manifest: validatedManifest, root, splat, collider, bounds, alignment };
      this.active = loaded;
      return loaded;
    } catch (error) {
      root.remove(splat);
      disposeSplat();
      disposeCollider();
      this.scene.remove(root);
      throw error;
    } finally {
      this.pendingCancellations.delete(cancel);
      mintGltf.dispose();
    }
  }

  unload(): void {
    this.lifecycle.invalidate();
    this.cancelPendingLoads();
    this.unloadActive();
  }

  refreshAlignment(): MintWorldAlignmentDiagnostics | null {
    if (!this.active) return null;
    const splatBounds = this.active.splat.getBoundingBox(false);
    const alignment = inspectMintWorldAlignment(
      this.active.root,
      this.active.splat,
      this.active.collider,
      splatBounds.isEmpty() ? null : splatBounds,
      this.active.manifest.visualTransform !== undefined,
    );
    this.active.alignment = alignment;
    return alignment;
  }

  private cancelPendingLoads(): void {
    for (const cancel of [...this.pendingCancellations]) cancel();
  }

  private unloadActive(): void {
    if (!this.active) return;
    this.active.splat.dispose();
    disposeObject3D(this.active.collider);
    this.active.root.remove(this.active.splat, this.active.collider);
    this.scene.remove(this.active.root);
    this.active = null;
  }

  dispose(): void {
    if (!this.lifecycle.dispose()) return;
    this.cancelPendingLoads();
    this.unloadActive();
    this.scene.remove(this.sparkRenderer);
    this.sparkRenderer.dispose();
  }
}
