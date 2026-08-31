import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { WORLD_EXTENT } from "../cube/constants";

/**
 * Camera orbit around a cube that never moves.
 *
 * Panning is disabled outright and the target is pinned to the origin, so
 * there is no interaction anywhere that can push the cube off centre. Zoom
 * only changes camera distance.
 */

/** Bounding sphere of the cube - safe for any orientation it can be spun to. */
const CUBE_RADIUS = (WORLD_EXTENT / 2) * Math.sqrt(3);

/** Headroom so the cube never touches the frame edge or the control bar. */
const MARGIN = 1.14;

/**
 * Distance at which the whole cube fits.
 *
 * A fixed multiple of the cube's size is not enough: the limiting dimension is
 * whichever of the vertical or horizontal field of view is narrower, and the
 * horizontal one depends on the window's aspect ratio. On a short or narrow
 * window the vertical FOV wins and the cube gets cropped, which is exactly
 * what a constant distance misses.
 */
export function fitDistance(camera: THREE.PerspectiveCamera): number {
  const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const limiting = Math.min(vHalf, hHalf);
  return (CUBE_RADIUS / Math.sin(limiting)) * MARGIN;
}

export function createOrbit(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);

  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.7;

  controls.minDistance = CUBE_RADIUS * 0.9;
  controls.maxDistance = CUBE_RADIUS * 12;

  controls.target.set(0, 0, 0);
  controls.update();

  return controls;
}

/** Frame the cube on a corner so three faces are visible, as in the brief. */
export function frameCube(camera: THREE.PerspectiveCamera): void {
  const direction = new THREE.Vector3(1, 0.78, 1).normalize();
  camera.position.copy(direction.multiplyScalar(fitDistance(camera)));
  camera.lookAt(0, 0, 0);
}

/**
 * After a resize, push the camera out if the cube no longer fits.
 *
 * Only ever moves outward, and never changes the viewing angle, so a
 * deliberate zoom-out or a rotated view survives; the only thing it corrects
 * is the cube being clipped by a window that got smaller.
 */
export function ensureFits(camera: THREE.PerspectiveCamera): void {
  const needed = fitDistance(camera);
  if (camera.position.length() < needed) camera.position.setLength(needed);
}
