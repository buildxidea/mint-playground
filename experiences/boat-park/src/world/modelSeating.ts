import * as THREE from 'three';

export interface HullSeatSpec {
  /** Hull length in meters; the model is scaled to match. */
  length: number;
  beam: number;
  /** Extra yaw for models the bow detector reads backwards. */
  modelYaw?: number;
}

/**
 * Sample mesh vertices and compare the mean half-width of the front (+Z) and
 * back (-Z) thirds. Hulls taper toward the bow, so a wider front third means
 * the model is pointing backwards.
 */
function frontIsWider(model: THREE.Object3D): boolean {
  model.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  const samples: { x: number; z: number }[] = [];
  let minZ = Infinity;
  let maxZ = -Infinity;
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = (child.geometry as THREE.BufferGeometry).getAttribute('position');
    if (!position) return;
    const stride = Math.max(1, Math.floor(position.count / 4000));
    for (let i = 0; i < position.count; i += stride) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      samples.push({ x: vertex.x, z: vertex.z });
      if (vertex.z < minZ) minZ = vertex.z;
      if (vertex.z > maxZ) maxZ = vertex.z;
    }
  });
  if (samples.length < 16) return false;
  const meanX = samples.reduce((sum, s) => sum + s.x, 0) / samples.length;
  const span = maxZ - minZ;
  const frontCut = maxZ - span * 0.3;
  const backCut = minZ + span * 0.3;
  let frontWidth = 0;
  let frontCount = 0;
  let backWidth = 0;
  let backCount = 0;
  for (const s of samples) {
    const width = Math.abs(s.x - meanX);
    if (s.z >= frontCut) {
      frontWidth += width;
      frontCount += 1;
    } else if (s.z <= backCut) {
      backWidth += width;
      backCount += 1;
    }
  }
  if (!frontCount || !backCount) return false;
  return frontWidth / frontCount > (backWidth / backCount) * 1.02;
}

/**
 * Lowest point on the model you can see looking straight down at it. On a
 * decked boat that is the deck; on an open one it is the cockpit sole. Rays
 * are kept to the inner two thirds of the footprint — ones down the flanks
 * graze the outside of the hull and report the keel.
 */
function lowestSurfaceOpenToTheSky(model: THREE.Object3D, spec: HullSeatSpec): number {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const startY = bounds.max.y + spec.length + 1;
  let lowest = Infinity;
  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < 7; j += 1) {
      origin.set(
        (i / 4 - 0.5) * spec.beam * 0.66,
        startY,
        (j / 6 - 0.5) * spec.length * 0.66,
      );
      raycaster.set(origin, down);
      const hit = raycaster.intersectObject(model, true)[0];
      if (hit) lowest = Math.min(lowest, hit.point.y);
    }
  }
  return Number.isFinite(lowest) ? lowest : bounds.max.y;
}

/**
 * Orient a generated hull bow-forward along local +Z, scale it to the spec, and
 * seat it on the waterline at y = 0.
 *
 * Draft comes from the beam, never the bounding box: masts, radar arches and
 * container stacks inflate total height and would drag the hull under.
 *
 * Returns the hull's clearance — how far its lowest surface open to the sky
 * sits above the waterline. That is the depth of sea the boat can take on its
 * topsides before the water is drawn inside it.
 *
 * Call this before parenting the model — it measures world matrices, so an
 * already-positioned parent would skew the result.
 */
export function seatHullOnWater(model: THREE.Object3D, spec: HullSeatSpec): number {
  const rawSize = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  if (rawSize.x > rawSize.z) model.rotateY(Math.PI / 2);
  if (frontIsWider(model)) model.rotateY(Math.PI);
  if (spec.modelYaw) model.rotateY(spec.modelYaw);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = spec.length / Math.max(size.z, 0.001);
  model.scale.multiplyScalar(scale);

  bounds.setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  const draft = Math.min(spec.beam * 0.16, (bounds.max.y - bounds.min.y) * 0.3);
  model.position.y -= bounds.min.y + draft;

  // Draft is a guess from the beam, and on an open boat it can put the cockpit
  // sole under water — which draws the ocean inside the hull. Float the model
  // back up until its innermost surface clears, with enough margin that the
  // swell cannot dunk it again.
  const clearance = Math.max(0.05, spec.beam * 0.06);
  const sole = lowestSurfaceOpenToTheSky(model, spec);
  if (sole < clearance) model.position.y += clearance - sole;

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return Math.max(sole, clearance);
}
