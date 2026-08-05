import * as THREE from "three";
import {
  createSeatOccupantEye,
  seatedBasis,
} from "./seatOccupantRig";

// Seat transforms describe the modeled chair anchor. A person's eye is forward
// of the seat back; keeping that offset explicit prevents the camera from
// starting inside the selected chair or a procedural seat-back plane.
export { SEATED_EYE_FORWARD_OFFSET_M } from "./seatOccupantRig";

export function seatedForward(yawRad: number): THREE.Vector3 {
  return seatedBasis(yawRad).forward;
}

export function createSeatedEyePosition(
  surface: THREE.Vector3,
  yawRad: number,
  eyeHeightM: number,
  heightOffsetM = 0,
): THREE.Vector3 {
  return createSeatOccupantEye(surface, yawRad, eyeHeightM, heightOffsetM);
}
