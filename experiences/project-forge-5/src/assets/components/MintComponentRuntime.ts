import * as THREE from 'three';
import { clone as cloneSkinnedGraph } from 'three/addons/utils/SkeletonUtils.js';
import { createMintGltfLoader } from '../createMintGltfLoader';
import { disposeObject3D } from '../../utils/dispose';

export type AxisDirection = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

export type MintComponentSourceBasis = Readonly<{
  /** Physical length represented by one source-space unit. */
  metersPerUnit: number;
  up: AxisDirection;
  forward: AxisDirection;
}>;

/**
 * Scene-wide spatial contract for imported robot components.
 *
 * Three.js is right-handed. Simulation positions are meters, +Y is up, and
 * actors look toward -Z when their heading is zero.
 */
export const MINT_COMPONENT_WORLD_CONTRACT = Object.freeze({
  handedness: 'right-handed' as const,
  units: 'meters' as const,
  up: '+Y' as const,
  forward: '-Z' as const,
});

export const DEFAULT_MINT_COMPONENT_SOURCE_BASIS: MintComponentSourceBasis = Object.freeze({
  metersPerUnit: 1,
  up: '+Y',
  forward: '-Z',
});

export type MintComponentResourceOwnership = 'loader' | 'external';

export type MintComponentLoadProgress = Readonly<{
  assetId: string;
  url: string;
  loadedBytes: number;
  totalBytes: number | null;
  fraction: number | null;
}>;

export type MintComponentLoadRequest = Readonly<{
  assetId: string;
  url: string;
  name?: string;
  sourceBasis?: MintComponentSourceBasis;
  /**
   * `loader` reference-counts shared instances and releases their resources
   * after the final instance is disposed. `external` only detaches instances.
   */
  resourceOwnership?: MintComponentResourceOwnership;
  onProgress?(progress: MintComponentLoadProgress): void;
}>;

export type MintComponentDiagnostics = Readonly<{
  meshCount: number;
  skinnedMeshCount: number;
  uniqueGeometryCount: number;
  uniqueMaterialCount: number;
  uniqueTextureCount: number;
  vertexCount: number;
  triangleCount: number;
  animationClipCount: number;
  sourceBasis: MintComponentSourceBasis;
  correctionScale: number;
  correctionQuaternion: readonly [number, number, number, number];
  importedRootTransform: Readonly<{
    position: readonly [number, number, number];
    quaternion: readonly [number, number, number, number];
    scale: readonly [number, number, number];
  }>;
}>;

export type MintComponentBounds = Readonly<{
  /** Bounds with the imported glTF root transform intact, before correction. */
  imported: THREE.Box3;
  /** Bounds after source-axis and source-unit correction, at presentation identity. */
  corrected: THREE.Box3;
}>;

export type MintComponentInstanceOptions = Readonly<{
  name?: string;
}>;

export interface MintComponentInstance {
  readonly assetId: string;
  readonly url: string;
  readonly root: THREE.Group;
  readonly correction: THREE.Group;
  readonly imported: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
  readonly bounds: MintComponentBounds;
  readonly diagnostics: MintComponentDiagnostics;
  readonly resourceOwnership: MintComponentResourceOwnership;
  readonly disposed: boolean;
  createSharedInstance(options?: MintComponentInstanceOptions): MintComponentInstance;
  getWorldBounds(target?: THREE.Box3): THREE.Box3;
  dispose(): void;
}

type ProgressLike = {
  loaded: number;
  total?: number;
};

export type MintComponentGltf = {
  scene: THREE.Object3D;
  animations?: THREE.AnimationClip[];
};

export type MintComponentGltfRuntime = {
  loader: {
    loadAsync(url: string, onProgress?: (event: ProgressLike) => void): Promise<MintComponentGltf>;
  };
  dispose(): void;
};

export type MintComponentLoaderDependencies = Readonly<{
  createGltfRuntime(): MintComponentGltfRuntime;
  cloneImportedGraph(source: THREE.Object3D): THREE.Object3D;
}>;

const DEFAULT_DEPENDENCIES: MintComponentLoaderDependencies = {
  createGltfRuntime: createMintGltfLoader,
  cloneImportedGraph: (source) => cloneSkinnedGraph(source),
};

export class MintComponentLoadError extends Error {
  constructor(
    readonly assetId: string,
    readonly url: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`Mint component "${assetId}" (${url}) ${message}`, options);
    this.name = 'MintComponentLoadError';
  }
}

class SharedResourceLease {
  private references = 0;
  private resourcesDisposed = false;

  constructor(
    private readonly resourceRoot: THREE.Object3D,
    readonly ownership: MintComponentResourceOwnership,
  ) {}

  retain(): void {
    if (this.resourcesDisposed) {
      throw new Error('Mint component resources have already been disposed');
    }
    this.references += 1;
  }

  release(): void {
    if (this.references <= 0) {
      throw new Error('Mint component resource lease was released more than once');
    }
    this.references -= 1;
    if (this.references === 0 && this.ownership === 'loader') {
      this.resourcesDisposed = true;
      disposeObject3D(this.resourceRoot);
    }
  }
}

type InstanceConstruction = {
  assetId: string;
  url: string;
  name: string;
  sourceBasis: MintComponentSourceBasis;
  imported: THREE.Object3D;
  animations: readonly THREE.AnimationClip[];
  lease: SharedResourceLease;
  dependencies: MintComponentLoaderDependencies;
  register(instance: MintComponentInstanceImpl): void;
  unregister(instance: MintComponentInstanceImpl): void;
};

class MintComponentInstanceImpl implements MintComponentInstance {
  readonly root = new THREE.Group();
  readonly correction = new THREE.Group();
  readonly bounds: MintComponentBounds;
  readonly diagnostics: MintComponentDiagnostics;
  private isDisposed = false;

  constructor(private readonly construction: InstanceConstruction) {
    const { imported, name, sourceBasis, lease } = construction;
    const correctionQuaternion = correctionForSourceBasis(sourceBasis);
    const importedBounds = measureBounds(imported, 'imported');
    const importedRootTransform = snapshotTransform(imported);

    this.root.name = name;
    this.root.userData.mintComponentAssetId = construction.assetId;
    this.root.userData.spatialContract = MINT_COMPONENT_WORLD_CONTRACT;
    this.correction.name = `${name}:source-correction`;
    this.correction.quaternion.copy(correctionQuaternion);
    this.correction.scale.setScalar(sourceBasis.metersPerUnit);
    this.correction.add(imported);
    this.root.add(this.correction);

    const correctedBounds = measureBounds(this.root, 'corrected');
    this.bounds = {
      imported: importedBounds,
      corrected: correctedBounds,
    };
    this.diagnostics = collectDiagnostics(
      imported,
      construction.animations,
      sourceBasis,
      correctionQuaternion,
      importedRootTransform,
    );

    lease.retain();
    construction.register(this);
  }

  get assetId(): string {
    return this.construction.assetId;
  }

  get url(): string {
    return this.construction.url;
  }

  get imported(): THREE.Object3D {
    return this.construction.imported;
  }

  get animations(): readonly THREE.AnimationClip[] {
    return this.construction.animations;
  }

  get resourceOwnership(): MintComponentResourceOwnership {
    return this.construction.lease.ownership;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  createSharedInstance(options: MintComponentInstanceOptions = {}): MintComponentInstance {
    this.assertActive();
    const imported = this.construction.dependencies.cloneImportedGraph(this.imported);
    return new MintComponentInstanceImpl({
      ...this.construction,
      name: options.name ?? `${this.root.name}:instance`,
      imported,
    });
  }

  getWorldBounds(target = new THREE.Box3()): THREE.Box3 {
    this.assertActive();
    this.root.updateWorldMatrix(true, true);
    return target.setFromObject(this.root);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.root.removeFromParent();
    this.correction.remove(this.imported);
    this.root.remove(this.correction);
    this.construction.unregister(this);
    this.construction.lease.release();
  }

  private assertActive(): void {
    if (this.isDisposed) {
      throw new Error(`Mint component "${this.assetId}" instance has been disposed`);
    }
  }
}

/**
 * Loads independent Mint GLBs. The returned hierarchy is always:
 *
 * presentation root (consumer-owned pose)
 *   -> source correction (axis and meters-per-unit normalization)
 *      -> imported glTF scene (canonical local transform, never rewritten)
 */
export class MintComponentLoader {
  private readonly instances = new Set<MintComponentInstanceImpl>();
  private isDisposed = false;

  constructor(
    private readonly dependencies: MintComponentLoaderDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async load(request: MintComponentLoadRequest): Promise<MintComponentInstance> {
    if (this.isDisposed) {
      throw new MintComponentLoadError(
        request.assetId,
        request.url,
        'cannot load because its loader has been disposed',
      );
    }
    assertLoadRequest(request);

    const sourceBasis = validateSourceBasis(
      request.sourceBasis ?? DEFAULT_MINT_COMPONENT_SOURCE_BASIS,
    );
    let runtime: MintComponentGltfRuntime | null = null;
    let gltf: MintComponentGltf | null = null;
    let handedOff = false;

    try {
      runtime = this.dependencies.createGltfRuntime();
      gltf = await runtime.loader.loadAsync(request.url, (event) => {
        const total =
          Number.isFinite(event.total) && Number(event.total) > 0 ? Number(event.total) : null;
        request.onProgress?.({
          assetId: request.assetId,
          url: request.url,
          loadedBytes: event.loaded,
          totalBytes: total,
          fraction: total === null ? null : Math.min(1, Math.max(0, event.loaded / total)),
        });
      });
      if (!isObject3D(gltf.scene)) {
        throw new Error('completed without an Object3D scene');
      }
      if (this.isDisposed) {
        throw new Error('finished after its loader was disposed');
      }
      if (gltf.scene.parent) {
        throw new Error('returned an imported scene that already has a parent');
      }

      const lease = new SharedResourceLease(gltf.scene, request.resourceOwnership ?? 'loader');
      const instance = new MintComponentInstanceImpl({
        assetId: request.assetId,
        url: request.url,
        name: request.name ?? `mint-component:${request.assetId}`,
        sourceBasis,
        imported: gltf.scene,
        animations: Object.freeze([...(gltf.animations ?? [])]),
        lease,
        dependencies: this.dependencies,
        register: (registered) => this.instances.add(registered),
        unregister: (registered) => this.instances.delete(registered),
      });
      handedOff = true;
      return instance;
    } catch (error) {
      if (gltf && !handedOff && isObject3D(gltf.scene)) {
        gltf.scene.removeFromParent();
        disposeObject3D(gltf.scene);
      }
      if (error instanceof MintComponentLoadError) throw error;
      throw new MintComponentLoadError(request.assetId, request.url, 'failed to load', {
        cause: error,
      });
    } finally {
      runtime?.dispose();
    }
  }

  unload(instance: MintComponentInstance): boolean {
    if (!(instance instanceof MintComponentInstanceImpl) || !this.instances.has(instance)) {
      return false;
    }
    instance.dispose();
    return true;
  }

  unloadAll(): void {
    for (const instance of [...this.instances]) instance.dispose();
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unloadAll();
  }
}

function assertLoadRequest(request: MintComponentLoadRequest): void {
  if (!request.assetId.trim()) throw new Error('Mint component assetId must not be empty');
  if (!request.url.trim()) throw new Error('Mint component URL must not be empty');
}

function validateSourceBasis(sourceBasis: MintComponentSourceBasis): MintComponentSourceBasis {
  if (!Number.isFinite(sourceBasis.metersPerUnit) || sourceBasis.metersPerUnit <= 0) {
    throw new Error('Mint component metersPerUnit must be a finite positive number');
  }
  const up = axisVector(sourceBasis.up);
  const forward = axisVector(sourceBasis.forward);
  if (Math.abs(up.dot(forward)) > 1e-9) {
    throw new Error('Mint component source up and forward axes must be orthogonal');
  }
  return Object.freeze({ ...sourceBasis });
}

function correctionForSourceBasis(sourceBasis: MintComponentSourceBasis): THREE.Quaternion {
  const up = axisVector(sourceBasis.up);
  const forward = axisVector(sourceBasis.forward);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const backward = forward.clone().negate();
  const sourceOrientation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, backward),
  );
  return sourceOrientation.invert();
}

function axisVector(axis: AxisDirection): THREE.Vector3 {
  switch (axis) {
    case '+X':
      return new THREE.Vector3(1, 0, 0);
    case '-X':
      return new THREE.Vector3(-1, 0, 0);
    case '+Y':
      return new THREE.Vector3(0, 1, 0);
    case '-Y':
      return new THREE.Vector3(0, -1, 0);
    case '+Z':
      return new THREE.Vector3(0, 0, 1);
    case '-Z':
      return new THREE.Vector3(0, 0, -1);
  }
}

function measureBounds(root: THREE.Object3D, label: string): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root);
  const values = [...bounds.min.toArray(), ...bounds.max.toArray()];
  if (
    bounds.isEmpty() ||
    !values.every(Number.isFinite) ||
    bounds.getSize(new THREE.Vector3()).length() <= 1e-9
  ) {
    throw new Error(`Mint component ${label} bounds must be finite and non-empty`);
  }
  return bounds;
}

function collectDiagnostics(
  imported: THREE.Object3D,
  animations: readonly THREE.AnimationClip[],
  sourceBasis: MintComponentSourceBasis,
  correctionQuaternion: THREE.Quaternion,
  importedRootTransform: MintComponentDiagnostics['importedRootTransform'],
): MintComponentDiagnostics {
  let meshCount = 0;
  let skinnedMeshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  imported.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount += 1;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshCount += 1;
    const geometry = mesh.geometry;
    if (geometry) {
      geometries.add(geometry);
      const positionCount = geometry.getAttribute('position')?.count ?? 0;
      const instanceMultiplier = (mesh as THREE.InstancedMesh).isInstancedMesh
        ? (mesh as THREE.InstancedMesh).count
        : 1;
      vertexCount += positionCount * instanceMultiplier;
      const elementCount = geometry.index?.count ?? positionCount;
      triangleCount += Math.floor(elementCount / 3) * instanceMultiplier;
    }
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (isTexture(value)) textures.add(value);
      }
    }
  });

  return Object.freeze({
    meshCount,
    skinnedMeshCount,
    uniqueGeometryCount: geometries.size,
    uniqueMaterialCount: materials.size,
    uniqueTextureCount: textures.size,
    vertexCount,
    triangleCount,
    animationClipCount: animations.length,
    sourceBasis,
    correctionScale: sourceBasis.metersPerUnit,
    correctionQuaternion: tuple4(correctionQuaternion.toArray()),
    importedRootTransform,
  });
}

function snapshotTransform(
  object: THREE.Object3D,
): MintComponentDiagnostics['importedRootTransform'] {
  return Object.freeze({
    position: tuple3(object.position.toArray()),
    quaternion: tuple4(object.quaternion.toArray()),
    scale: tuple3(object.scale.toArray()),
  });
}

function tuple3(values: number[]): readonly [number, number, number] {
  return [values[0], values[1], values[2]];
}

function tuple4(values: number[]): readonly [number, number, number, number] {
  return [values[0], values[1], values[2], values[3]];
}

function isTexture(value: unknown): value is THREE.Texture {
  return Boolean(
    value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture,
  );
}

function isObject3D(value: unknown): value is THREE.Object3D {
  return Boolean(
    value && typeof value === 'object' && (value as { isObject3D?: boolean }).isObject3D,
  );
}
