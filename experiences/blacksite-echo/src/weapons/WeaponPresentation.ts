import * as THREE from 'three';
import type { AttachmentSelection, AttachmentSlot } from '../game/types';
import {
  BOX_EXCLUSIVE_WEAPON_IDS,
  OPS_LOADOUT_WEAPON_IDS,
  type BoxExclusiveWeaponId,
  type OpsLoadoutWeaponId,
  type WeaponDefinition,
  type WeaponId,
} from '../data/weapons';

type Axis = 'x' | 'y' | 'z';
type CalibratedWeaponId = OpsLoadoutWeaponId;

/** Box exclusives reuse calibrated ops mounts until per-gun sockets are authored. */
const BOX_EXCLUSIVE_PROFILE_DONORS: Record<
  BoxExclusiveWeaponId,
  CalibratedWeaponId
> = {
  'ray-gun': 'aegis-p11',
  'volt-caster': 'kestrel-9',
  'nightfall-50': 'morrow-dmr12',
  'hellion-aa': 'talon-m4',
  'pyre-thrower': 'brimstone-lmg6',
  'rupture-rpg': 'brimstone-lmg6',
  'specter-pdw': 'kestrel-9',
  'storm-howler': 'brimstone-lmg6',
  'magnum-rex': 'aegis-p11',
  'wraith-burst': 'arx-7',
};

function calibratedWeaponId(weaponId: WeaponId): CalibratedWeaponId {
  if ((OPS_LOADOUT_WEAPON_IDS as readonly string[]).includes(weaponId)) {
    return weaponId as CalibratedWeaponId;
  }
  return BOX_EXCLUSIVE_PROFILE_DONORS[weaponId as BoxExclusiveWeaponId];
}

type WeaponAssetProfile = {
  rotation: [number, number, number];
};

type AttachmentAssetProfile = {
  slot: AttachmentSlot;
  rotation: [number, number, number];
  scaleAxis: Axis;
  mountAxis: Axis;
  mountSign: 1 | -1;
};

type AttachmentMountPose = {
  position: [number, number, number];
  targetSize: number;
  rotation?: [number, number, number];
};

type ReplacementBox = {
  min: [number, number, number];
  max: [number, number, number];
};

type WeaponReplacementProfile = {
  stockCutX?: number;
  muzzleCutX: number;
  magazine?: ReplacementBox;
  grip?: ReplacementBox;
};

export type ModeledAttachmentId =
  | 'optic-holo'
  | 'optic-2x'
  | 'muzzle-comp'
  | 'muzzle-suppressor'
  | 'mag-extended'
  | 'mag-fast'
  | 'grip-vertical'
  | 'grip-angled'
  | 'stock-stable'
  | 'stock-collapsed';

/**
 * Spatial contract for every weapon after it crosses the Mint import boundary:
 * muzzle/ballistic forward is +X and the top rail is +Y.
 */
const CALIBRATED_WEAPON_ASSET_PROFILES: Record<
  CalibratedWeaponId,
  WeaponAssetProfile
> = {
  'arx-7': { rotation: [0, Math.PI, 0] },
  'kestrel-9': { rotation: [0, 0, 0] },
  'morrow-dmr12': { rotation: [0, 0, 0] },
  'brimstone-lmg6': { rotation: [0, Math.PI / 2, 0] },
  'talon-m4': { rotation: [0, Math.PI / 2, 0] },
  'aegis-p11': { rotation: [0, Math.PI, 0] },
};

export const WEAPON_ASSET_PROFILES = Object.fromEntries(
  [...OPS_LOADOUT_WEAPON_IDS, ...BOX_EXCLUSIVE_WEAPON_IDS].map((id) => [
    id,
    CALIBRATED_WEAPON_ASSET_PROFILES[calibratedWeaponId(id)],
  ]),
) as Record<WeaponId, WeaponAssetProfile>;

/**
 * The source attachments arrive bounds-centered, but their modeling axes are
 * not consistent. Every profile therefore declares its full canonical
 * rotation, the dimension used for physical sizing, and the authored surface
 * that touches the weapon. No attachment is allowed to fall through to an
 * identity/longest-axis guess.
 */
const ATTACHMENT_ASSET_PROFILES: Record<
  ModeledAttachmentId,
  AttachmentAssetProfile
> = {
  'optic-holo': {
    slot: 'optic',
    rotation: [0, Math.PI / 2, 0],
    scaleAxis: 'x',
    mountAxis: 'y',
    mountSign: -1,
  },
  'optic-2x': {
    slot: 'optic',
    rotation: [0, Math.PI / 2, 0],
    scaleAxis: 'x',
    mountAxis: 'y',
    mountSign: -1,
  },
  'muzzle-comp': {
    slot: 'muzzle',
    rotation: [0, 0, 0],
    scaleAxis: 'x',
    mountAxis: 'x',
    mountSign: -1,
  },
  'muzzle-suppressor': {
    slot: 'muzzle',
    rotation: [0, 0, 0],
    scaleAxis: 'x',
    mountAxis: 'x',
    mountSign: -1,
  },
  'mag-extended': {
    slot: 'magazine',
    rotation: [0, 0, 0],
    scaleAxis: 'y',
    mountAxis: 'y',
    mountSign: 1,
  },
  'mag-fast': {
    slot: 'magazine',
    rotation: [0, 0, 0],
    scaleAxis: 'y',
    mountAxis: 'y',
    mountSign: 1,
  },
  'grip-vertical': {
    slot: 'grip',
    rotation: [0, 0, 0],
    scaleAxis: 'y',
    mountAxis: 'y',
    mountSign: 1,
  },
  'grip-angled': {
    slot: 'grip',
    rotation: [0, 0, 0],
    scaleAxis: 'x',
    mountAxis: 'y',
    mountSign: 1,
  },
  'stock-stable': {
    slot: 'stock',
    rotation: [0, Math.PI, 0],
    scaleAxis: 'x',
    mountAxis: 'x',
    mountSign: 1,
  },
  'stock-collapsed': {
    slot: 'stock',
    rotation: [0, 0, -Math.PI / 2],
    scaleAxis: 'x',
    mountAxis: 'x',
    mountSign: 1,
  },
};

/**
 * The weapon assets contain their standard furniture in the same primitive as
 * the receiver. These canonical-space regions remove only that baked furniture
 * when a modeled replacement is selected. Muzzle cut planes remove triangles
 * by centroid; their sockets are calibrated separately to the surviving
 * barrel shoulder so crossing triangles form a clean connector.
 */
const WEAPON_REPLACEMENT_PROFILES: Record<
  CalibratedWeaponId,
  WeaponReplacementProfile
> = {
  'arx-7': {
    stockCutX: -0.18,
    muzzleCutX: 0.395,
    magazine: {
      min: [-0.105, -0.19, -0.08],
      max: [0.085, -0.015, 0.08],
    },
    grip: {
      min: [0.08, -0.15, -0.085],
      max: [0.36, 0.08, 0.085],
    },
  },
  'kestrel-9': {
    stockCutX: -0.09,
    muzzleCutX: 0.287,
    magazine: {
      min: [-0.045, -0.21, -0.085],
      max: [0.14, 0.045, 0.085],
    },
    grip: {
      min: [0.14, -0.21, -0.085],
      max: [0.37, 0.08, 0.085],
    },
  },
  'morrow-dmr12': {
    stockCutX: -0.275,
    muzzleCutX: 0.521,
    magazine: {
      min: [-0.105, -0.145, -0.08],
      max: [0.13, 0.04, 0.08],
    },
    grip: {
      min: [0.14, -0.125, -0.08],
      max: [0.4, 0.07, 0.08],
    },
  },
  'brimstone-lmg6': {
    stockCutX: -0.27,
    muzzleCutX: 0.531,
    magazine: {
      min: [-0.2, -0.205, -0.12],
      max: [0.11, 0.05, 0.12],
    },
    grip: {
      min: [0.11, -0.14, -0.09],
      max: [0.4, 0.075, 0.09],
    },
  },
  'talon-m4': {
    stockCutX: -0.08,
    muzzleCutX: 0.411,
  },
  'aegis-p11': {
    // The P11's long rectangular nose is its baked integral suppressor, not
    // receiver geometry. Cut it at the slide face so alternate muzzle devices
    // replace the whole unit instead of being appended to its cap.
    muzzleCutX: 0.04,
  },
};

/**
 * The delivered weapon GLBs are single-mesh assets without authored sockets.
 * These per-asset poses are therefore the authoritative runtime mount
 * contract. Replacement-shaped magazines and stocks are seated into the
 * baked standard component instead of being appended to its outside edge.
 * Units are meters after weapon normalization.
 */
const WEAPON_ATTACHMENT_PROFILES: Record<
  CalibratedWeaponId,
  Record<ModeledAttachmentId, AttachmentMountPose>
> = {
  'arx-7': {
    'optic-holo': { position: [0.04, 0.115, 0], targetSize: 0.135 },
    'optic-2x': { position: [0.055, 0.112, 0], targetSize: 0.215 },
    'muzzle-comp': { position: [0.431, 0.105, 0.013], targetSize: 0.135 },
    'muzzle-suppressor': { position: [0.431, 0.105, 0.013], targetSize: 0.23 },
    'mag-extended': {
      position: [-0.03, -0.02, 0],
      targetSize: 0.275,
      rotation: [0, 0, -0.08],
    },
    'mag-fast': {
      position: [-0.03, -0.02, 0],
      targetSize: 0.22,
      rotation: [0, 0, -0.08],
    },
    'grip-vertical': { position: [0.19, 0.055, 0], targetSize: 0.16 },
    'grip-angled': {
      position: [0.19, 0.052, 0],
      targetSize: 0.18,
      rotation: [0, 0, -0.18],
    },
    'stock-stable': { position: [-0.18, 0.018, 0], targetSize: 0.32 },
    'stock-collapsed': {
      position: [-0.18, 0.018, 0],
      targetSize: 0.245,
      rotation: [0, 0, -0.06],
    },
  },
  'kestrel-9': {
    'optic-holo': { position: [0.035, 0.105, 0], targetSize: 0.11 },
    'optic-2x': { position: [0.045, 0.102, 0], targetSize: 0.165 },
    'muzzle-comp': { position: [0.294, 0.132, 0.004], targetSize: 0.1 },
    'muzzle-suppressor': { position: [0.294, 0.132, 0.004], targetSize: 0.17 },
    'mag-extended': {
      position: [0.08, -0.025, 0],
      targetSize: 0.22,
      rotation: [0, 0, 0.13],
    },
    'mag-fast': {
      position: [0.08, -0.025, 0],
      targetSize: 0.18,
      rotation: [0, 0, 0.13],
    },
    'grip-vertical': { position: [0.205, 0.035, 0], targetSize: 0.135 },
    'grip-angled': {
      position: [0.205, 0.035, 0],
      targetSize: 0.145,
      rotation: [0, 0, -0.14],
    },
    'stock-stable': { position: [-0.09, 0.025, 0], targetSize: 0.3 },
    'stock-collapsed': {
      position: [-0.09, 0.025, 0],
      targetSize: 0.22,
      rotation: [0, 0, -0.04],
    },
  },
  'morrow-dmr12': {
    'optic-holo': { position: [0.035, 0.115, 0], targetSize: 0.145 },
    'optic-2x': { position: [0.065, 0.112, 0], targetSize: 0.24 },
    'muzzle-comp': { position: [0.531, 0.087, -0.018], targetSize: 0.145 },
    'muzzle-suppressor': { position: [0.531, 0.087, -0.018], targetSize: 0.265 },
    'mag-extended': { position: [-0.045, -0.02, 0], targetSize: 0.265 },
    'mag-fast': { position: [-0.045, -0.02, 0], targetSize: 0.22 },
    'grip-vertical': { position: [0.25, 0.045, 0], targetSize: 0.17 },
    'grip-angled': {
      position: [0.25, 0.045, 0],
      targetSize: 0.195,
      rotation: [0, 0, -0.16],
    },
    'stock-stable': { position: [-0.275, 0.015, 0], targetSize: 0.34 },
    'stock-collapsed': {
      position: [-0.275, 0.015, 0],
      targetSize: 0.26,
      rotation: [0, 0, -0.05],
    },
  },
  'brimstone-lmg6': {
    'optic-holo': { position: [0.035, 0.16, 0], targetSize: 0.145 },
    'optic-2x': { position: [0.055, 0.157, 0], targetSize: 0.225 },
    'muzzle-comp': { position: [0.525, 0.053, -0.003], targetSize: 0.145 },
    'muzzle-suppressor': { position: [0.525, 0.053, -0.003], targetSize: 0.255 },
    'mag-extended': { position: [-0.07, -0.025, 0], targetSize: 0.245 },
    'mag-fast': { position: [-0.07, -0.025, 0], targetSize: 0.205 },
    'grip-vertical': { position: [0.245, 0.045, 0], targetSize: 0.17 },
    'grip-angled': {
      position: [0.245, 0.045, 0],
      targetSize: 0.19,
      rotation: [0, 0, -0.14],
    },
    'stock-stable': { position: [-0.27, 0.015, 0], targetSize: 0.315 },
    'stock-collapsed': {
      position: [-0.27, 0.015, 0],
      targetSize: 0.245,
      rotation: [0, 0, -0.04],
    },
  },
  'talon-m4': {
    'optic-holo': { position: [0.025, 0.105, 0], targetSize: 0.13 },
    'optic-2x': { position: [0.045, 0.102, 0], targetSize: 0.2 },
    'muzzle-comp': { position: [0.465, 0.084, -0.012], targetSize: 0.125 },
    'muzzle-suppressor': { position: [0.465, 0.084, -0.012], targetSize: 0.215 },
    'mag-extended': { position: [-0.025, -0.02, 0], targetSize: 0.215 },
    'mag-fast': { position: [-0.025, -0.02, 0], targetSize: 0.18 },
    'grip-vertical': { position: [0.28, 0.045, 0], targetSize: 0.15 },
    'grip-angled': {
      position: [0.28, 0.045, 0],
      targetSize: 0.17,
      rotation: [0, 0, -0.16],
    },
    'stock-stable': { position: [-0.08, 0.012, 0], targetSize: 0.34 },
    'stock-collapsed': {
      position: [-0.08, 0.012, 0],
      targetSize: 0.26,
      rotation: [0, 0, -0.05],
    },
  },
  'aegis-p11': {
    'optic-holo': { position: [0.01, 0.073, 0], targetSize: 0.075 },
    'optic-2x': { position: [0.02, 0.071, 0], targetSize: 0.115 },
    'muzzle-comp': { position: [0.09, 0.053, 0.005], targetSize: 0.065 },
    'muzzle-suppressor': { position: [0.09, 0.053, 0.005], targetSize: 0.125 },
    'mag-extended': {
      position: [-0.205, -0.025, 0],
      targetSize: 0.165,
      rotation: [0, 0, -0.1],
    },
    'mag-fast': {
      position: [-0.205, -0.025, 0],
      targetSize: 0.135,
      rotation: [0, 0, -0.1],
    },
    'grip-vertical': { position: [0.055, 0.005, 0], targetSize: 0.09 },
    'grip-angled': {
      position: [0.055, 0.005, 0],
      targetSize: 0.1,
      rotation: [0, 0, -0.12],
    },
    'stock-stable': { position: [-0.22, 0.005, 0], targetSize: 0.19 },
    'stock-collapsed': {
      position: [-0.22, 0.005, 0],
      targetSize: 0.145,
      rotation: [0, 0, -0.04],
    },
  },
};

export const FIRST_PERSON_WEAPON_ROTATION = new THREE.Euler(0, Math.PI / 2, 0);
/** Canonical knife +X (blade tip) points down the camera look axis (-Z). */
export const FIRST_PERSON_KNIFE_ROTATION = new THREE.Euler(
  0,
  Math.PI / 2,
  -0.16,
);
export const ARMORY_WEAPON_ROTATION = new THREE.Euler(0.04, -0.2, -0.025);
export const ENEMY_HAND_WEAPON_ROTATION = new THREE.Euler(
  THREE.MathUtils.degToRad(-8),
  -Math.PI / 2,
  THREE.MathUtils.degToRad(-8),
);

function wrapWithCanonicalRotation(
  source: THREE.Group,
  rotation: [number, number, number],
  name: string,
): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  source.rotation.set(...rotation);
  source.name = `${name}-source`;
  root.add(source);
  return root;
}

export function normalizeObjectToLength(
  object: THREE.Object3D,
  targetLongestAxis: number,
): void {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) return;
  object.scale.multiplyScalar(targetLongestAxis / longest);
  object.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(object);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.updateMatrixWorld(true);
}

/**
 * The finalized tanto GLB is authored with its blade tip on local -X and its
 * handle on +X. Rotate once at the import boundary so every melee consumer can
 * rely on blade-forward +X, matching the firearm muzzle-forward contract.
 */
export function prepareMintKnifeModel(source: THREE.Group): THREE.Group {
  const canonical = wrapWithCanonicalRotation(
    source,
    [0, Math.PI, 0],
    'mint-combat-knife-canonical',
  );
  // Keep the first-person blade readable through forward foreshortening.
  // World-space melee range is unchanged.
  normalizeObjectToLength(canonical, 0.56);
  canonical.userData.canonicalForward = '+X';
  canonical.userData.sourceBladeForward = '-X';
  return canonical;
}

function normalizeObjectAxisToSize(
  object: THREE.Object3D,
  axis: Axis,
  targetSize: number,
): void {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const measuredSize = size[axis];
  if (!Number.isFinite(measuredSize) || measuredSize <= 0) return;
  object.scale.multiplyScalar(targetSize / measuredSize);
  object.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(object);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.updateMatrixWorld(true);
}

function getAttachmentAssetProfile(
  attachmentId: string,
  expectedSlot?: AttachmentSlot,
): AttachmentAssetProfile {
  if (!(attachmentId in ATTACHMENT_ASSET_PROFILES)) {
    throw new Error(`Missing spatial profile for modeled attachment: ${attachmentId}`);
  }
  const profile =
    ATTACHMENT_ASSET_PROFILES[attachmentId as ModeledAttachmentId];
  if (expectedSlot && profile.slot !== expectedSlot) {
    throw new Error(
      `Attachment ${attachmentId} is configured for ${profile.slot}, not ${expectedSlot}`,
    );
  }
  return profile;
}

function getAttachmentMountPose(
  weaponId: WeaponId,
  attachmentId: string,
): AttachmentMountPose {
  const calibrated = calibratedWeaponId(weaponId);
  if (!(attachmentId in WEAPON_ATTACHMENT_PROFILES[calibrated])) {
    throw new Error(
      `Missing ${weaponId} mount calibration for attachment: ${attachmentId}`,
    );
  }
  return WEAPON_ATTACHMENT_PROFILES[calibrated][
    attachmentId as ModeledAttachmentId
  ];
}

function isInsideReplacementBox(
  point: THREE.Vector3,
  box: ReplacementBox,
): boolean {
  return (
    point.x >= box.min[0] &&
    point.x <= box.max[0] &&
    point.y >= box.min[1] &&
    point.y <= box.max[1] &&
    point.z >= box.min[2] &&
    point.z <= box.max[2]
  );
}

function getWeaponReplacementProfile(
  weaponId: WeaponId,
): WeaponReplacementProfile {
  return WEAPON_REPLACEMENT_PROFILES[calibratedWeaponId(weaponId)];
}

export function prepareMintWeaponReplacementGeometry(
  model: THREE.Group,
  attachments: AttachmentSelection,
  weapon: WeaponDefinition,
): void {
  const profile = getWeaponReplacementProfile(weapon.id);
  const activeSlots: AttachmentSlot[] = [];
  const removePredicates: Array<(point: THREE.Vector3) => boolean> = [];

  if (
    attachments.stock !== 'stock-standard' &&
    profile.stockCutX !== undefined
  ) {
    activeSlots.push('stock');
    removePredicates.push((point) => point.x < profile.stockCutX!);
  }
  if (attachments.muzzle !== 'muzzle-standard') {
    activeSlots.push('muzzle');
    removePredicates.push((point) => point.x > profile.muzzleCutX);
  }
  if (attachments.magazine !== 'mag-standard' && profile.magazine) {
    activeSlots.push('magazine');
    removePredicates.push((point) =>
      isInsideReplacementBox(point, profile.magazine!),
    );
  }
  if (attachments.grip !== 'grip-standard' && profile.grip) {
    activeSlots.push('grip');
    removePredicates.push((point) => isInsideReplacementBox(point, profile.grip!));
  }

  if (removePredicates.length === 0) {
    model.userData.replacementGeometry = {
      activeSlots,
      originalTriangles: 0,
      removedTriangles: 0,
    };
    return;
  }

  model.updateMatrixWorld(true);
  const modelInverse = model.matrixWorld.clone().invert();
  const localMatrix = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  let originalTriangles = 0;
  let removedTriangles = 0;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const sourceGeometry = object.geometry;
    const index = sourceGeometry.getIndex();
    const position = sourceGeometry.getAttribute('position');
    if (!index || !position) return;

    localMatrix.multiplyMatrices(modelInverse, object.matrixWorld);
    const keptIndices: number[] = [];
    originalTriangles += index.count / 3;

    for (let offset = 0; offset < index.count; offset += 3) {
      const indexA = index.getX(offset);
      const indexB = index.getX(offset + 1);
      const indexC = index.getX(offset + 2);
      a.set(position.getX(indexA), position.getY(indexA), position.getZ(indexA));
      b.set(position.getX(indexB), position.getY(indexB), position.getZ(indexB));
      c.set(position.getX(indexC), position.getY(indexC), position.getZ(indexC));
      centroid
        .copy(a)
        .add(b)
        .add(c)
        .multiplyScalar(1 / 3)
        .applyMatrix4(localMatrix);
      if (removePredicates.some((predicate) => predicate(centroid))) {
        removedTriangles += 1;
        continue;
      }
      keptIndices.push(indexA, indexB, indexC);
    }

    const trimmedGeometry = sourceGeometry.clone();
    trimmedGeometry.setIndex(keptIndices);
    trimmedGeometry.clearGroups();
    trimmedGeometry.addGroup(0, keptIndices.length, 0);
    trimmedGeometry.computeBoundingBox();
    trimmedGeometry.computeBoundingSphere();
    object.geometry = trimmedGeometry;
    object.userData.mintReplacementGeometry = true;
  });

  model.userData.replacementGeometry = {
    activeSlots,
    originalTriangles,
    removedTriangles,
  };
}

export function disposeMintWeaponReplacementGeometry(
  model: THREE.Object3D,
): void {
  model.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.userData.mintReplacementGeometry === true
    ) {
      object.geometry.dispose();
    }
  });
}

/**
 * Measures a prospective socket against the surviving weapon surface. This is
 * intentionally evaluated after baked-furniture removal and before modeled
 * attachments are added, so a small value represents a real retained contact
 * face rather than another attachment.
 */
export function measureMintWeaponSurfaceDistance(
  model: THREE.Group,
  point: THREE.Vector3,
): number {
  model.updateMatrixWorld(true);
  const modelInverse = model.matrixWorld.clone().invert();
  const localMatrix = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  let closestDistanceSquared = Number.POSITIVE_INFINITY;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let ancestor: THREE.Object3D | null = object;
    while (ancestor && ancestor !== model) {
      if (ancestor.userData.attachmentId) return;
      ancestor = ancestor.parent;
    }
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    const index = object.geometry.getIndex();
    const count = index?.count ?? position.count;
    localMatrix.multiplyMatrices(modelInverse, object.matrixWorld);

    for (let offset = 0; offset < count; offset += 3) {
      const indexA = index?.getX(offset) ?? offset;
      const indexB = index?.getX(offset + 1) ?? offset + 1;
      const indexC = index?.getX(offset + 2) ?? offset + 2;
      a.set(position.getX(indexA), position.getY(indexA), position.getZ(indexA))
        .applyMatrix4(localMatrix);
      b.set(position.getX(indexB), position.getY(indexB), position.getZ(indexB))
        .applyMatrix4(localMatrix);
      c.set(position.getX(indexC), position.getY(indexC), position.getZ(indexC))
        .applyMatrix4(localMatrix);
      triangle.set(a, b, c).closestPointToPoint(point, closest);
      closestDistanceSquared = Math.min(
        closestDistanceSquared,
        closest.distanceToSquared(point),
      );
    }
  });

  return Number.isFinite(closestDistanceSquared)
    ? Math.sqrt(closestDistanceSquared)
    : Number.POSITIVE_INFINITY;
}

export function measureMintMuzzleAxialContact(
  model: THREE.Group,
  socketPosition: THREE.Vector3,
): {
  gap: number;
  overlap: number;
  barrelFace: [number, number, number];
} {
  model.updateMatrixWorld(true);
  const modelInverse = model.matrixWorld.clone().invert();
  const localMatrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const corridorRadius = 0.055;
  const rearSearchDistance = 0.16;
  const candidates: THREE.Vector3[] = [];
  let forwardmostBarrelPoint = Number.NEGATIVE_INFINITY;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let ancestor: THREE.Object3D | null = object;
    while (ancestor && ancestor !== model) {
      if (ancestor.userData.attachmentId) return;
      ancestor = ancestor.parent;
    }
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    const geometryIndex = object.geometry.getIndex();
    const vertexCount = geometryIndex?.count ?? position.count;
    localMatrix.multiplyMatrices(modelInverse, object.matrixWorld);

    for (let offset = 0; offset < vertexCount; offset += 1) {
      const index = geometryIndex?.getX(offset) ?? offset;
      point
        .set(
          position.getX(index),
          position.getY(index),
          position.getZ(index),
        )
        .applyMatrix4(localMatrix);
      if (
        Math.abs(point.y - socketPosition.y) > corridorRadius ||
        Math.abs(point.z - socketPosition.z) > corridorRadius ||
        point.x < socketPosition.x - rearSearchDistance
      ) {
        continue;
      }
      candidates.push(point.clone());
      forwardmostBarrelPoint = Math.max(forwardmostBarrelPoint, point.x);
    }
  });

  if (!Number.isFinite(forwardmostBarrelPoint)) {
    return {
      gap: Number.POSITIVE_INFINITY,
      overlap: 0,
      barrelFace: [Number.NaN, Number.NaN, Number.NaN],
    };
  }
  const facePoints = candidates.filter(
    (candidate) => candidate.x >= forwardmostBarrelPoint - 0.012,
  );
  const median = (values: number[]): number => {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) * 0.5
      : values[middle];
  };
  return {
    gap: Math.max(0, socketPosition.x - forwardmostBarrelPoint),
    overlap: Math.max(0, forwardmostBarrelPoint - socketPosition.x),
    barrelFace: [
      forwardmostBarrelPoint,
      median(facePoints.map((candidate) => candidate.y)),
      median(facePoints.map((candidate) => candidate.z)),
    ],
  };
}

function findFirstMintWeaponSurfaceIntersection(
  model: THREE.Group,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
): THREE.Vector3 | null {
  model.updateMatrixWorld(true);
  const modelInverse = model.matrixWorld.clone().invert();
  const localMatrix = new THREE.Matrix4();
  const ray = new THREE.Ray(origin, direction.clone().normalize());
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const hit = new THREE.Vector3();
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestHit: THREE.Vector3 | null = null;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let ancestor: THREE.Object3D | null = object;
    while (ancestor && ancestor !== model) {
      if (ancestor.userData.attachmentId) return;
      ancestor = ancestor.parent;
    }
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    const index = object.geometry.getIndex();
    const count = index?.count ?? position.count;
    localMatrix.multiplyMatrices(modelInverse, object.matrixWorld);

    for (let offset = 0; offset < count; offset += 3) {
      const indexA = index?.getX(offset) ?? offset;
      const indexB = index?.getX(offset + 1) ?? offset + 1;
      const indexC = index?.getX(offset + 2) ?? offset + 2;
      a.set(position.getX(indexA), position.getY(indexA), position.getZ(indexA))
        .applyMatrix4(localMatrix);
      b.set(position.getX(indexB), position.getY(indexB), position.getZ(indexB))
        .applyMatrix4(localMatrix);
      c.set(position.getX(indexC), position.getY(indexC), position.getZ(indexC))
        .applyMatrix4(localMatrix);
      const intersection = ray.intersectTriangle(a, b, c, false, hit);
      if (!intersection) continue;
      const distance = origin.distanceTo(intersection);
      if (distance >= closestDistance) continue;
      closestDistance = distance;
      closestHit = intersection.clone();
    }
  });

  return closestHit;
}

/**
 * Seats underside mount faces on the geometry that remains after replacement
 * trimming. The authored pose continues to choose the correct longitudinal
 * location and centerline; the vertical ray snap removes asset-to-asset gaps.
 * Muzzle devices keep their explicit barrel-face calibrations because a
 * centerline ray can pass through the open bore and hit receiver geometry.
 */
export function snapMintAttachmentAnchorToSurface(
  model: THREE.Group,
  slot: AttachmentSlot,
  authoredAnchor: THREE.Vector3,
): THREE.Vector3 {
  const anchor = authoredAnchor.clone();
  const insertionDepth = 0.003;

  if (slot === 'magazine' || slot === 'grip') {
    const centerHit = findFirstMintWeaponSurfaceIntersection(
      model,
      new THREE.Vector3(anchor.x, -2, anchor.z),
      new THREE.Vector3(0, 1, 0),
    );
    const nearbyHits = centerHit
      ? [centerHit]
      : [-0.012, 0.012]
          .map((zOffset) =>
            findFirstMintWeaponSurfaceIntersection(
              model,
              new THREE.Vector3(anchor.x, -2, anchor.z + zOffset),
              new THREE.Vector3(0, 1, 0),
            ),
          )
          .filter((hit): hit is THREE.Vector3 => Boolean(hit));
    if (nearbyHits.length > 0) {
      anchor.y = Math.min(...nearbyHits.map((hit) => hit.y)) + insertionDepth;
    }
  }

  return anchor;
}

export function prepareMintWeaponModel(
  source: THREE.Group,
  weapon: WeaponDefinition,
  targetLongestAxis = weapon.silhouette.length,
): THREE.Group {
  const profile = WEAPON_ASSET_PROFILES[weapon.id];
  const canonical = wrapWithCanonicalRotation(
    source,
    profile.rotation,
    `mint-weapon-canonical-${weapon.id}`,
  );
  normalizeObjectToLength(canonical, targetLongestAxis);
  const root = new THREE.Group();
  root.name = `mint-weapon-mount-${weapon.id}`;
  root.add(canonical);
  root.userData.weaponId = weapon.id;
  root.userData.canonicalForward = '+X';
  root.userData.muzzlePosition = new THREE.Vector3(targetLongestAxis * 0.52, 0, 0);
  return root;
}

export function prepareMintAttachmentModel(
  source: THREE.Group,
  attachmentId: string,
  slot: AttachmentSlot,
  targetSize: number,
): THREE.Group {
  const profile = getAttachmentAssetProfile(attachmentId, slot);
  const canonical = wrapWithCanonicalRotation(
    source,
    profile.rotation,
    `mint-attachment-canonical-${attachmentId}`,
  );
  normalizeObjectAxisToSize(canonical, profile.scaleAxis, targetSize);
  canonical.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(canonical);
  const center = bounds.getCenter(new THREE.Vector3());
  const mount = center.clone();
  mount[profile.mountAxis] =
    profile.mountSign === 1
      ? bounds.max[profile.mountAxis]
      : bounds.min[profile.mountAxis];
  canonical.position.sub(mount);
  canonical.updateMatrixWorld(true);

  const root = new THREE.Group();
  root.name = `mint-attachment-mount-${attachmentId}`;
  root.add(canonical);
  const calibratedSize = new THREE.Box3()
    .setFromObject(canonical)
    .getSize(new THREE.Vector3());
  root.userData.attachmentId = attachmentId;
  root.userData.mountPivot = {
    x: mount.x,
    y: mount.y,
    z: mount.z,
  };
  root.userData.scaleAxis = profile.scaleAxis;
  root.userData.targetSize = targetSize;
  root.userData.calibratedSize = {
    x: calibratedSize.x,
    y: calibratedSize.y,
    z: calibratedSize.z,
  };
  return root;
}

export function getAttachmentTargetSize(
  weapon: WeaponDefinition,
  attachmentId: string,
): number {
  return getAttachmentMountPose(weapon.id, attachmentId).targetSize;
}

export function getAttachmentAnchor(
  weapon: WeaponDefinition,
  attachmentId: string,
): THREE.Vector3 {
  return new THREE.Vector3(
    ...getAttachmentMountPose(weapon.id, attachmentId).position,
  );
}

export function createRuntimeAttachmentSocket(
  weapon: WeaponDefinition,
  slot: AttachmentSlot,
  attachmentId: string,
): THREE.Group {
  getAttachmentAssetProfile(attachmentId, slot);
  const pose = getAttachmentMountPose(weapon.id, attachmentId);
  const socket = new THREE.Group();
  socket.name = `runtime-socket-${weapon.id}-${slot}-${attachmentId}`;
  socket.position.set(...pose.position);
  if (pose.rotation) socket.rotation.set(...pose.rotation);
  socket.userData.weaponId = weapon.id;
  socket.userData.slot = slot;
  socket.userData.attachmentId = attachmentId;
  socket.userData.targetSize = pose.targetSize;
  socket.userData.runtimeDerived = true;
  return socket;
}

export function canonicalForwardInWorld(
  object: THREE.Object3D,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  return target.set(1, 0, 0).transformDirection(object.matrixWorld).normalize();
}
