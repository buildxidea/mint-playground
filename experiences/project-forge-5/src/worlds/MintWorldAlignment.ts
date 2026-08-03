import * as THREE from 'three';

export type SerializedVector3 = Readonly<{ x: number; y: number; z: number }>;
export type SerializedBox3 = Readonly<{
  min: SerializedVector3;
  max: SerializedVector3;
  center: SerializedVector3;
  size: SerializedVector3;
}>;

export type MintWorldAlignmentDiagnostics = Readonly<{
  schemaVersion: 1;
  basis: 'right-handed-y-up-meters';
  status: 'aligned' | 'aligned-pending-visual-bounds' | 'blocked';
  failures: readonly string[];
  rootMatrixWorld: readonly number[];
  splatLocalMatrix: readonly number[];
  splatMatrixWorld: readonly number[];
  colliderLocalMatrix: readonly number[];
  colliderMatrixWorld: readonly number[];
  childTransformMaxDelta: number;
  splatLocalBounds: SerializedBox3 | null;
  splatWorldBounds: SerializedBox3 | null;
  colliderWorldBounds: SerializedBox3;
  centerDistanceMeters: number | null;
  diagonalRatio: number | null;
  colliderCenterInsideSplatBounds: boolean | null;
  intersection: Readonly<{
    exists: boolean | null;
    colliderVolumeCoverage: number | null;
  }>;
}>;

const MATRIX_EPSILON = 1e-6;
const MIN_COLLIDER_VOLUME_COVERAGE = 0.05;
const MAX_CENTER_DISTANCE_TO_COLLIDER_DIAGONAL = 0.8;
const MIN_DIAGONAL_RATIO = 0.2;
const MAX_DIAGONAL_RATIO = 20;

function serializeVector(vector: THREE.Vector3): SerializedVector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function serializeBox(box: THREE.Box3): SerializedBox3 {
  return {
    min: serializeVector(box.min),
    max: serializeVector(box.max),
    center: serializeVector(box.getCenter(new THREE.Vector3())),
    size: serializeVector(box.getSize(new THREE.Vector3())),
  };
}

function matrixElements(matrix: THREE.Matrix4): readonly number[] {
  return [...matrix.elements];
}

function matrixMaxDelta(left: THREE.Matrix4, right: THREE.Matrix4): number {
  return left.elements.reduce(
    (maximum, component, index) => Math.max(maximum, Math.abs(component - right.elements[index])),
    0,
  );
}

function boxVolume(box: THREE.Box3): number {
  if (box.isEmpty()) return 0;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(0, size.x) * Math.max(0, size.y) * Math.max(0, size.z);
}

function isFiniteUsableBox(box: THREE.Box3): boolean {
  const components = [...box.min.toArray(), ...box.max.toArray()];
  const diagonal = box.getSize(new THREE.Vector3()).length();
  return !box.isEmpty() && components.every(Number.isFinite) && diagonal > 0.001;
}

export function inspectMintWorldAlignment(
  root: THREE.Object3D,
  splat: THREE.Object3D,
  collider: THREE.Object3D,
  splatLocalBounds: THREE.Box3 | null,
  declaredVisualTransform = false,
): MintWorldAlignmentDiagnostics {
  root.updateMatrixWorld(true);
  const colliderWorldBounds = new THREE.Box3().setFromObject(collider);
  if (!isFiniteUsableBox(colliderWorldBounds)) {
    throw new Error('Mint collider must have finite, non-empty bounds');
  }

  const usableSplatBounds =
    splatLocalBounds && isFiniteUsableBox(splatLocalBounds) ? splatLocalBounds : null;
  const splatWorldBounds = usableSplatBounds
    ? usableSplatBounds.clone().applyMatrix4(splat.matrixWorld)
    : null;
  const splatCenter = splatWorldBounds?.getCenter(new THREE.Vector3()) ?? null;
  const colliderCenter = colliderWorldBounds.getCenter(new THREE.Vector3());
  const centerDistanceMeters = splatCenter?.distanceTo(colliderCenter) ?? null;
  const splatDiagonal = splatWorldBounds?.getSize(new THREE.Vector3()).length() ?? null;
  const colliderDiagonal = colliderWorldBounds.getSize(new THREE.Vector3()).length();
  const diagonalRatio = splatDiagonal === null ? null : splatDiagonal / colliderDiagonal;
  const intersectionBox = splatWorldBounds?.clone().intersect(colliderWorldBounds) ?? null;
  const intersectionVolume = intersectionBox ? boxVolume(intersectionBox) : null;
  const colliderVolume = boxVolume(colliderWorldBounds);
  const colliderVolumeCoverage =
    intersectionVolume === null || colliderVolume <= 0 ? null : intersectionVolume / colliderVolume;
  const colliderCenterInsideSplatBounds = splatWorldBounds?.containsPoint(colliderCenter) ?? null;
  const childTransformMaxDelta = matrixMaxDelta(splat.matrix, collider.matrix);
  const failures: string[] = [];

  if (childTransformMaxDelta > MATRIX_EPSILON && !declaredVisualTransform) {
    failures.push(
      `RAD and collider child transforms diverge by ${childTransformMaxDelta.toExponential(3)}`,
    );
  }
  if (splatWorldBounds) {
    if (!splatWorldBounds.intersectsBox(colliderWorldBounds)) {
      failures.push('RAD and collider world bounds do not intersect');
    } else if (
      colliderVolumeCoverage !== null &&
      colliderVolumeCoverage < MIN_COLLIDER_VOLUME_COVERAGE
    ) {
      failures.push(
        `RAD covers only ${(colliderVolumeCoverage * 100).toFixed(2)}% of collider volume`,
      );
    }
    if (!colliderCenterInsideSplatBounds) {
      failures.push('Collider center is outside the RAD world bounds');
    }
    if (
      centerDistanceMeters !== null &&
      centerDistanceMeters > colliderDiagonal * MAX_CENTER_DISTANCE_TO_COLLIDER_DIAGONAL
    ) {
      failures.push(
        `RAD/collider centers are ${centerDistanceMeters.toFixed(3)} m apart for a ${colliderDiagonal.toFixed(3)} m collider diagonal`,
      );
    }
    if (
      diagonalRatio !== null &&
      (diagonalRatio < MIN_DIAGONAL_RATIO || diagonalRatio > MAX_DIAGONAL_RATIO)
    ) {
      failures.push(`RAD/collider diagonal ratio ${diagonalRatio.toFixed(3)} is implausible`);
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    basis: 'right-handed-y-up-meters',
    status:
      failures.length > 0
        ? 'blocked'
        : splatWorldBounds
          ? 'aligned'
          : 'aligned-pending-visual-bounds',
    failures,
    rootMatrixWorld: matrixElements(root.matrixWorld),
    splatLocalMatrix: matrixElements(splat.matrix),
    splatMatrixWorld: matrixElements(splat.matrixWorld),
    colliderLocalMatrix: matrixElements(collider.matrix),
    colliderMatrixWorld: matrixElements(collider.matrixWorld),
    childTransformMaxDelta,
    splatLocalBounds: usableSplatBounds ? serializeBox(usableSplatBounds) : null,
    splatWorldBounds: splatWorldBounds ? serializeBox(splatWorldBounds) : null,
    colliderWorldBounds: serializeBox(colliderWorldBounds),
    centerDistanceMeters,
    diagonalRatio,
    colliderCenterInsideSplatBounds,
    intersection: {
      exists: splatWorldBounds?.intersectsBox(colliderWorldBounds) ?? null,
      colliderVolumeCoverage,
    },
  });
}

export function assertMintWorldAlignment(
  diagnostics: MintWorldAlignmentDiagnostics,
): MintWorldAlignmentDiagnostics {
  if (diagnostics.status === 'blocked') {
    throw new Error(
      `Mint World RAD/collider alignment failed:\n- ${diagnostics.failures.join('\n- ')}`,
    );
  }
  return diagnostics;
}
