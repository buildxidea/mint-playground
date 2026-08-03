import * as THREE from 'three';
import type { RoomId } from '../config/catalog';

export type SplatContainmentManifest = Readonly<{
  schemaVersion: 1;
  roomId: RoomId;
  sourceSplatSha256: string;
  basis: 'right-handed-y-up-meters';
  envelope: 'shared-root-collider-aabb';
  reviewStatus: 'coordinate-alignment-reviewed' | 'collider-envelope-reviewed';
  semanticAuthority: false;
  bounds: Readonly<{
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  }>;
}>;

const SHA256 = /^[0-9a-f]{64}$/;

export function validateSplatContainmentManifest(
  manifest: SplatContainmentManifest,
): SplatContainmentManifest {
  const candidate = manifest as unknown as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) {
    throw new Error('Splat containment manifest must use schema version 1');
  }
  if (!['kinetic-hall', 'precision-cell', 'crisis-bay'].includes(manifest.roomId)) {
    throw new Error('Splat containment manifest requires a known Forge room');
  }
  if (!SHA256.test(manifest.sourceSplatSha256)) {
    throw new Error('Splat containment manifest requires a full-resolution SPZ SHA-256');
  }
  if (manifest.basis !== 'right-handed-y-up-meters') {
    throw new Error('Splat containment manifest must use the runtime Y-up metric basis');
  }
  if (manifest.envelope !== 'shared-root-collider-aabb') {
    throw new Error('Splat containment must use the reviewed shared-root collider envelope');
  }
  if (
    manifest.reviewStatus !== 'coordinate-alignment-reviewed' &&
    manifest.reviewStatus !== 'collider-envelope-reviewed'
  ) {
    throw new Error('Splat containment envelope must have an accepted review status');
  }
  const values = [...manifest.bounds.min, ...manifest.bounds.max];
  if (
    values.length !== 6 ||
    !values.every(Number.isFinite) ||
    manifest.bounds.min.some((value, index) => value >= manifest.bounds.max[index])
  ) {
    throw new Error('Splat containment bounds must be finite and non-empty');
  }
  if (candidate.semanticAuthority !== false) {
    throw new Error('Unreviewed semantic occupancy cannot become containment authority');
  }
  return manifest;
}

export function getSplatContainmentBounds(manifest: SplatContainmentManifest): THREE.Box3 {
  validateSplatContainmentManifest(manifest);
  return new THREE.Box3(
    new THREE.Vector3(...manifest.bounds.min),
    new THREE.Vector3(...manifest.bounds.max),
  );
}

export function assertRuntimeBoundsMatchContainment(
  runtimeBounds: THREE.Box3,
  manifest: SplatContainmentManifest,
  toleranceMeters = 0.02,
): void {
  const expected = getSplatContainmentBounds(manifest);
  const values = [...runtimeBounds.min.toArray(), ...runtimeBounds.max.toArray()];
  if (runtimeBounds.isEmpty() || !values.every(Number.isFinite)) {
    throw new Error('Runtime World bounds must be finite and non-empty');
  }
  const maximumDifference = Math.max(
    ...runtimeBounds.min
      .toArray()
      .map((value, index) => Math.abs(value - expected.min.toArray()[index])),
    ...runtimeBounds.max
      .toArray()
      .map((value, index) => Math.abs(value - expected.max.toArray()[index])),
  );
  if (!Number.isFinite(toleranceMeters) || toleranceMeters < 0) {
    throw new Error('Containment comparison tolerance must be finite and non-negative');
  }
  if (maximumDifference > toleranceMeters) {
    throw new Error(
      `Runtime World bounds differ from the reviewed containment envelope by ${maximumDifference.toFixed(4)} m`,
    );
  }
}
