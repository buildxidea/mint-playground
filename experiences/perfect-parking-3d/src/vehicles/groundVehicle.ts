import * as THREE from 'three';
import type { AsphaltBounds } from '../levels/asphalt';
import { FLOOR_SURFACE_Y } from './VehicleController';

const _box = new THREE.Box3();
const _meshBox = new THREE.Box3();

/** Two millimeters above the visible 6 mm asphalt wearing course. */
export const VEHICLE_GROUND_CLEARANCE = 0.008;

/** Tight world AABB including every mesh vertex (catches wheel bottoms). */
export function preciseWorldBounds(root: THREE.Object3D, target = _box): THREE.Box3 {
  target.makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    // InstancedMesh.geometry only describes the untransformed source shape.
    // Its aggregate bounding box applies every instance matrix (wheel/hub
    // positions and scales), which is the rendered footprint we must ground.
    const instanced = mesh as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      instanced.computeBoundingBox();
      if (!instanced.boundingBox) return;
      _meshBox.copy(instanced.boundingBox).applyMatrix4(instanced.matrixWorld);
      target.union(_meshBox);
      return;
    }

    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox) return;
    _meshBox.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
    target.union(_meshBox);
  });
  if (target.isEmpty()) target.setFromObject(root);
  return target;
}

/**
 * Place a vehicle mesh on the lot and seat its lowest vertex on the visible
 * asphalt. Body roll/pitch is applied before the final vertical correction so
 * suspension lean cannot leave the whole vehicle floating or below ground.
 */
export function groundVehicleMesh(
  mesh: THREE.Object3D,
  x: number,
  z: number,
  yaw: number,
  floorY = FLOOR_SURFACE_Y,
  bodyPitch = 0,
  bodyRoll = 0,
): void {
  mesh.position.set(x, floorY, z);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.set(bodyPitch, yaw, bodyRoll);
  mesh.updateMatrixWorld(true);

  const box = preciseWorldBounds(mesh);
  mesh.position.y += floorY + VEHICLE_GROUND_CLEARANCE - box.min.y;
  mesh.updateMatrixWorld(true);
}

/** World-space clearance of lowest mesh vertex above floor (negative = penetrating). */
export function measureGroundClearance(
  mesh: THREE.Object3D,
  floorY = FLOOR_SURFACE_Y,
): number {
  const box = preciseWorldBounds(mesh);
  return box.min.y - floorY;
}

/** Minimum rendered-footprint clearance to the visible asphalt edge. */
export function measureAsphaltClearance(
  mesh: THREE.Object3D,
  bounds: AsphaltBounds,
): number {
  const box = preciseWorldBounds(mesh);
  return Math.min(
    box.min.x - bounds.minX,
    bounds.maxX - box.max.x,
    box.min.z - bounds.minZ,
    bounds.maxZ - box.max.z,
  );
}
