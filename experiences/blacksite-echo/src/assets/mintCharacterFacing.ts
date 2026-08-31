import * as THREE from 'three';

function headfrontDirection(root: THREE.Object3D): THREE.Vector3 | null {
  root.updateWorldMatrix(true, true);
  let head: THREE.Object3D | undefined;
  let headfront: THREE.Object3D | undefined;
  root.traverse((object) => {
    if (!head && (object.name === 'Head' || object.name === 'head')) {
      head = object;
    }
    if (
      !headfront &&
      (object.name === 'headfront' || object.name === 'Headfront')
    ) {
      headfront = object;
    }
  });
  if (!head || !headfront) return null;
  const headPos = new THREE.Vector3();
  const frontPos = new THREE.Vector3();
  head.getWorldPosition(headPos);
  headfront.getWorldPosition(frontPos);
  const direction = frontPos.sub(headPos);
  direction.y = 0;
  if (direction.lengthSq() < 1e-8) return null;
  return direction.normalize();
}

/** Yaw to rotate an imported character so its authored face points at +Z. */
export function modelHeadfrontYawOffsetToActorForward(
  root: THREE.Object3D,
  targetForward: THREE.Vector3 = new THREE.Vector3(0, 0, 1),
): number {
  const currentForward = headfrontDirection(root);
  if (!currentForward) return 0;
  const target = targetForward.clone();
  target.y = 0;
  if (target.lengthSq() < 1e-8) return 0;
  target.normalize();
  const currentYaw = Math.atan2(currentForward.x, currentForward.z);
  const targetYaw = Math.atan2(target.x, target.z);
  const deltaYaw = targetYaw - currentYaw;
  return Math.atan2(Math.sin(deltaYaw), Math.cos(deltaYaw));
}

/** Yaw to rotate a character root so a clip's hips facing aligns with +Z. */
export function clipHipsYawOffsetToActorForward(
  clip: THREE.AnimationClip | undefined,
  targetForward: THREE.Vector3 = new THREE.Vector3(0, 0, 1),
): number {
  if (!clip) return 0;
  const hipsQuatTrack = clip.tracks.find(
    (track) => /hips/i.test(track.name) && track.name.endsWith('.quaternion'),
  );
  if (!hipsQuatTrack || hipsQuatTrack.values.length < 4) return 0;

  const q0 = new THREE.Quaternion(
    hipsQuatTrack.values[0]!,
    hipsQuatTrack.values[1]!,
    hipsQuatTrack.values[2]!,
    hipsQuatTrack.values[3]!,
  );
  // Bone-local +Z after hips quaternion — same basis AnimationMixer applies.
  const currentForward = new THREE.Vector3(0, 0, 1).applyQuaternion(q0);
  currentForward.y = 0;
  if (currentForward.lengthSq() < 1e-8) return 0;
  currentForward.normalize();

  const target = targetForward.clone();
  target.y = 0;
  if (target.lengthSq() < 1e-8) return 0;
  target.normalize();

  const currentYaw = Math.atan2(currentForward.x, currentForward.z);
  const targetYaw = Math.atan2(target.x, target.z);
  const deltaYaw = targetYaw - currentYaw;
  return Math.atan2(Math.sin(deltaYaw), Math.cos(deltaYaw));
}

export function measureHeadfrontDotActorForward(
  root: THREE.Object3D,
  actorYaw: number,
): number | null {
  root.updateWorldMatrix(true, true);
  const actorForward = new THREE.Vector3(
    Math.sin(actorYaw),
    0,
    Math.cos(actorYaw),
  );

  const authoredHeadForward = headfrontDirection(root);
  if (authoredHeadForward) {
    return authoredHeadForward.dot(actorForward);
  }

  let hips: THREE.Object3D | undefined;
  root.traverse((object) => {
    if (!hips && (object.name === 'Hips' || object.name === 'hips')) {
      hips = object;
    }
  });

  // Some imported rigs omit the authored face marker. Fall back to hips +Z.
  if (hips) {
    const hipsForward = new THREE.Vector3(0, 0, 1).transformDirection(
      hips.matrixWorld,
    );
    hipsForward.y = 0;
    if (hipsForward.lengthSq() > 1e-8) {
      return hipsForward.normalize().dot(actorForward);
    }
  }
  return null;
}

/**
 * Measures the visible rig's authored face direction against a world target.
 * The Head -> headfront marker includes presentation offsets and animation
 * pose, so acceptance telemetry does not accidentally validate only an
 * invisible navigation root.
 */
export function measureHeadfrontDotWorldTarget(
  root: THREE.Object3D,
  target: THREE.Vector3,
  fallbackActorYaw: number,
): number {
  root.updateWorldMatrix(true, true);
  const origin = root.getWorldPosition(new THREE.Vector3());
  const towardTarget = target.clone().sub(origin).setY(0);
  if (towardTarget.lengthSq() < 1e-8) return 1;
  towardTarget.normalize();

  const visibleForward = headfrontDirection(root);
  if (visibleForward) return visibleForward.dot(towardTarget);

  return new THREE.Vector3(
    Math.sin(fallbackActorYaw),
    0,
    Math.cos(fallbackActorYaw),
  ).dot(towardTarget);
}

/**
 * Returns the world-yaw correction that makes the visible Head -> headfront
 * direction face a target. Null means the rig has no usable authored marker.
 */
export function headfrontYawCorrectionToWorldTarget(
  root: THREE.Object3D,
  target: THREE.Vector3,
): number | null {
  root.updateWorldMatrix(true, true);
  const visibleForward = headfrontDirection(root);
  if (!visibleForward) return null;

  const origin = root.getWorldPosition(new THREE.Vector3());
  const towardTarget = target.clone().sub(origin).setY(0);
  if (towardTarget.lengthSq() < 1e-8) return 0;
  towardTarget.normalize();

  const visibleYaw = Math.atan2(visibleForward.x, visibleForward.z);
  const targetYaw = Math.atan2(towardTarget.x, towardTarget.z);
  const correction = targetYaw - visibleYaw;
  return Math.atan2(Math.sin(correction), Math.cos(correction));
}
