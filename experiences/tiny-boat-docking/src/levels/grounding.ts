import * as THREE from 'three';

/** Clearance above the calm water plane (y=0). Waves stay under ~0.04. */
export const WATER_CLEARANCE = 0.32;

/**
 * After final world transform, lift an object so its bounds sit clearly above water.
 * Call only after position/rotation/scale are set.
 */
export function liftAboveWater(object: THREE.Object3D, clearance = WATER_CLEARANCE): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.y)) return;
  if (box.min.y < clearance) {
    object.position.y += clearance - box.min.y;
    object.updateMatrixWorld(true);
  }
}

/**
 * Floating props/boats: allow a tiny draft so they read as floating, not hovering.
 */
export function liftFloating(object: THREE.Object3D, draft = 0.05): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.y)) return;
  const targetMin = -Math.abs(draft);
  object.position.y += targetMin - box.min.y;
  object.updateMatrixWorld(true);

  // Keep the visual mass from reading as sunk under an opaque water plane.
  const mid = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).y;
  const minMid = 0.35;
  if (mid < minMid) {
    object.position.y += minMid - mid;
  }
}
