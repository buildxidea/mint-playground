import * as THREE from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

let configured = false;

/** Enable BVH traversal for meshes that opt in by building a bounds tree. */
export function configureBvhRaycasting(): void {
  if (configured) return;
  configured = true;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  const fallback = THREE.Mesh.prototype.raycast;
  THREE.Mesh.prototype.raycast = function bvhAwareRaycast(raycaster, intersects) {
    if ((this as THREE.InstancedMesh).isInstancedMesh || !this.geometry.boundsTree) {
      fallback.call(this, raycaster, intersects);
      return;
    }
    acceleratedRaycast.call(this, raycaster, intersects);
  };
}
