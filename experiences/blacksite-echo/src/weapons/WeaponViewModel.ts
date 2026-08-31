import * as THREE from 'three';
import type { MintAssetRuntime } from '../assets/MintAssetRuntime';
import { clipHipsYawOffsetToActorForward } from '../assets/mintCharacterFacing';
import { getAttachment, type WeaponDefinition } from '../data/weapons';
import type { AttachmentSelection } from '../game/types';
import type { WeaponSystem } from './WeaponSystem';
import {
  FIRST_PERSON_WEAPON_ROTATION,
  FIRST_PERSON_KNIFE_ROTATION,
  createRuntimeAttachmentSocket,
  disposeMintWeaponReplacementGeometry,
  getAttachmentAnchor,
  getAttachmentTargetSize,
  measureMintMuzzleAxialContact,
  measureMintWeaponSurfaceDistance,
  normalizeObjectToLength,
  prepareMintAttachmentModel,
  prepareMintKnifeModel,
  prepareMintWeaponModel,
  prepareMintWeaponReplacementGeometry,
  snapMintAttachmentAnchorToSurface,
} from './WeaponPresentation';

function mintMuzzleTextureWithDerivedAlpha(source: THREE.Texture): THREE.Texture {
  const image = source.image as
    | (CanvasImageSource & { width?: number; height?: number })
    | undefined;
  const width = Math.max(0, Number(image?.width ?? 0));
  const height = Math.max(0, Number(image?.height ?? 0));
  if (!image || width === 0 || height === 0 || typeof document === 'undefined') {
    return source.clone();
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return source.clone();
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const red = pixels.data[offset]!;
    const green = pixels.data[offset + 1]!;
    const blue = pixels.data[offset + 2]!;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const chroma = maximum - minimum;
    // The finalized atlas encodes its transparency preview as an opaque gray
    // checkerboard. Fire/smoke pixels carry warm chroma; discard neutral cells
    // and derive soft alpha from saturation plus highlight energy.
    const alpha =
      chroma < 22
        ? 0
        : THREE.MathUtils.clamp(
            chroma * 4.2 + Math.max(0, maximum - 150) * 1.35,
            0,
            255,
          );
    pixels.data[offset + 3] = Math.round(alpha);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

const gunmetal = new THREE.MeshStandardMaterial({
  color: '#3c4943',
  roughness: 0.28,
  metalness: 0.78,
});
const polymer = new THREE.MeshStandardMaterial({
  color: '#202a25',
  roughness: 0.72,
  metalness: 0.05,
});
const trim = new THREE.MeshStandardMaterial({
  color: '#aebe94',
  roughness: 0.44,
  metalness: 0.36,
});
const accent = new THREE.MeshStandardMaterial({
  color: '#b8ff3d',
  emissive: '#5c9b18',
  emissiveIntensity: 1.4,
  roughness: 0.35,
});

function box(
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  bevel = false,
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(...size, bevel ? 2 : 1, bevel ? 2 : 1, bevel ? 2 : 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  radius: number,
  length: number,
  position: [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(...position);
  mesh.castShadow = true;
  return mesh;
}

/** Dedicated camera layer so Spark's fullscreen splat pass can be underlaid. */
export const FIRST_PERSON_VIEWMODEL_LAYER = 3;

/** Draw FP meshes over Gaussian splat depth so near RAD pages cannot erase them. */
function applyFirstPersonDepthPolicy(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
    object.renderOrder = Math.max(object.renderOrder, 10);
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) {
      return;
    }
    object.frustumCulled = false;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material || !('depthTest' in material)) continue;
      material.depthTest = false;
      material.depthWrite = false;
      if (
        material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshPhysicalMaterial
      ) {
        // Keep a readable floor under the Spark overlay pass even if fill
        // lights are momentarily masked by layer filters.
        material.emissive = material.emissive ?? new THREE.Color('#000000');
        material.emissive.lerp(new THREE.Color('#9aa894'), 0.35);
        material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.45);
      }
      material.needsUpdate = true;
    }
  });
}

/**
 * The Mint first-person arms artifact is a full-body skinned operator. Collapse
 * head / neck / leg bones so only the arm chain remains visible in camera.
 * Do not scale Hips/Spine — arms are parented under that chain.
 */
function clipFirstPersonBodyMeshes(root: THREE.Object3D): void {
  const hideBone =
    /^(Head|Neck|head|neck|head_end|headfront|LeftUpLeg|RightUpLeg|LeftLeg|RightLeg|LeftFoot|RightFoot|LeftToeBase|RightToeBase|LeftToe_End|RightToe_End|mixamorigHead|mixamorigNeck|mixamorigLeftUpLeg|mixamorigRightUpLeg|mixamorigLeftLeg|mixamorigRightLeg|mixamorigLeftFoot|mixamorigRightFoot)/i;
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) {
      for (const bone of object.skeleton.bones) {
        if (hideBone.test(bone.name)) {
          bone.scale.set(0.001, 0.001, 0.001);
        }
      }
    }
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
    const hideMesh =
      /head|skull|hair|helmet|torso|chest|pelvis|hip|leg|foot|thigh|calf|boot|abdomen|neck|body|spine/i;
    const keepMesh = /arm|hand|finger|wrist|forearm|shoulder|clavicle|weapon/i;
    if (hideMesh.test(object.name) && !keepMesh.test(object.name)) {
      object.visible = false;
    }
  });
}

export type ViewModelLocomotion = {
  speed: number;
  forward: number;
  strafe: number;
  sprinting: boolean;
  crouching: boolean;
};

export type ViewModelAttachmentMode = 'hand-bone' | 'camera-space';

/** Weapon-local point that should sit in the RightHand palm (+X = muzzle). */
const FP_WEAPON_GRIP_POINT = new THREE.Vector3(-0.09, -0.045, 0);
const FP_KNIFE_GRIP_POINT = new THREE.Vector3(0.02, -0.01, 0.01);

/**
 * Stab path from the lower-right pocket toward the crosshair. Z stays far
 * enough forward that the handle clears the near plane.
 */
const FP_STAB_KNIFE_START = new THREE.Vector3(0.26, -0.22, -0.48);
const FP_STAB_KNIFE_APEX = new THREE.Vector3(0.08, -0.08, -0.7);

const _handWorld = new THREE.Vector3();
const _gripWorld = new THREE.Vector3();
const _weaponForward = new THREE.Vector3();
const _cameraForward = new THREE.Vector3();
const _muzzleLocal = new THREE.Vector3();
const _stabPos = new THREE.Vector3();
const _stabTip = new THREE.Vector3();
/**
 * Tip axis used for stab aiming. `prepareMintKnifeModel` documents +X tip;
 * if the silhouette reads handle-first, flip this vector.
 */
const _knifeTipAxis = new THREE.Vector3(1, 0, 0);

function resolveHandBone(
  root: THREE.Object3D,
  side: 'Right' | 'Left',
): THREE.Object3D | null {
  const candidates = [
    `${side}Hand`,
    `mixamorig${side}Hand`,
    `mixamorig:${side}Hand`,
    `${side.toLowerCase()}Hand`,
  ];
  for (const name of candidates) {
    const found = root.getObjectByName(name);
    if (found) return found;
  }
  let bone: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (bone || !(object instanceof THREE.SkinnedMesh)) return;
    for (const entry of object.skeleton.bones) {
      if (
        candidates.some(
          (name) => entry.name === name || entry.name.endsWith(name),
        )
      ) {
        bone = entry;
        return;
      }
    }
  });
  return bone;
}

export function createWeaponModel(
  weapon: WeaponDefinition,
  attachments: AttachmentSelection,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `weapon-${weapon.id}`;
  const s = weapon.silhouette;
  const receiver = box(
    [s.length * 0.48, s.bodyHeight, s.bodyWidth],
    [0, 0, 0],
    gunmetal,
    true,
  );
  root.add(receiver);
  root.add(
    box(
      [s.length * 0.36, s.bodyHeight * 0.74, s.bodyWidth * 0.92],
      [-s.length * 0.12, -s.bodyHeight * 0.02, 0],
      polymer,
    ),
  );

  const barrelCenter = s.length * 0.24 + s.barrel * 0.5;
  root.add(cylinder(s.bodyWidth * 0.2, s.barrel, [barrelCenter, 0.018, 0], gunmetal));
  const muzzle = cylinder(
    s.bodyWidth * 0.27,
    0.08,
    [barrelCenter + s.barrel * 0.5 + 0.03, 0.018, 0],
    attachments.muzzle === 'muzzle-suppressor' ? polymer : trim,
  );
  muzzle.name = 'muzzle';
  if (attachments.muzzle === 'muzzle-suppressor') muzzle.scale.x = 2.5;
  root.add(muzzle);

  if (s.stock > 0) {
    root.add(
      box(
        [s.stock, s.bodyHeight * 0.7, s.bodyWidth * 0.8],
        [-s.length * 0.24 - s.stock * 0.48, -s.bodyHeight * 0.03, 0],
        attachments.stock === 'stock-collapsed' ? gunmetal : polymer,
      ),
    );
    root.add(
      box(
        [0.08, s.bodyHeight * 1.28, s.bodyWidth * 1.04],
        [-s.length * 0.24 - s.stock + 0.02, -0.02, 0],
        polymer,
      ),
    );
  }

  const gripMesh = box(
    [0.09, 0.22, s.bodyWidth * 0.74],
    [-s.length * 0.06, -0.17, 0],
    polymer,
  );
  gripMesh.rotation.z = -0.2;
  root.add(gripMesh);

  if (s.magazine !== 'tube') {
    const magWidth = s.magazine === 'drum' ? 0.2 : 0.11;
    const magHeight = s.magazine === 'drum' ? 0.23 : 0.27;
    const magazine = box(
      [magWidth, magHeight, s.bodyWidth * (s.magazine === 'drum' ? 1.5 : 0.85)],
      [s.length * 0.05, -0.19, 0],
      polymer,
    );
    if (s.magazine === 'curved') magazine.rotation.z = -0.14;
    if (attachments.magazine === 'mag-extended') magazine.scale.y = 1.28;
    root.add(magazine);
  } else {
    root.add(
      cylinder(
        s.bodyWidth * 0.16,
        s.barrel * 0.82,
        [barrelCenter - 0.03, -0.065, 0],
        polymer,
      ),
    );
  }

  const topRail = box(
    [s.length * 0.3, 0.025, s.bodyWidth * 0.45],
    [0.01, s.bodyHeight * 0.58, 0],
    trim,
  );
  root.add(topRail);

  if (attachments.optic !== 'optic-iron') {
    const opticGroup = new THREE.Group();
    opticGroup.position.set(0.01, s.bodyHeight * 0.82, 0);
    opticGroup.add(
      box(
        attachments.optic === 'optic-2x'
          ? [0.24, 0.095, 0.095]
          : [0.12, 0.11, 0.085],
        [0, 0, 0],
        polymer,
      ),
    );
    const lens = cylinder(
      0.036,
      0.008,
      [attachments.optic === 'optic-2x' ? 0.12 : 0.06, 0, 0],
      accent,
    );
    opticGroup.add(lens);
    root.add(opticGroup);
  } else {
    root.add(box([0.03, 0.07, 0.025], [0.11, s.bodyHeight * 0.77, 0], trim));
  }

  if (attachments.grip !== 'grip-standard' && weapon.id !== 'aegis-p11') {
    const foregrip = box(
      [0.055, attachments.grip === 'grip-vertical' ? 0.16 : 0.1, 0.055],
      [s.length * 0.18, -0.12, 0],
      polymer,
    );
    if (attachments.grip === 'grip-angled') foregrip.rotation.z = -0.4;
    root.add(foregrip);
  }

  for (let i = 0; i < 4; i += 1) {
    root.add(
      box(
        [0.018, 0.008, s.bodyWidth * 1.03],
        [-s.length * 0.13 + i * 0.055, s.bodyHeight * 0.52, 0],
        accent,
      ),
    );
  }
  root.userData.muzzlePosition = new THREE.Vector3(
    barrelCenter + s.barrel * 0.5 + (attachments.muzzle === 'muzzle-suppressor' ? 0.16 : 0.08),
    0.018,
    0,
  );
  root.userData.attachmentSummary = Object.values(attachments)
    .map((id) => getAttachment(id).name)
    .join(', ');
  return root;
}

export function normalizeMintModel(
  model: THREE.Group,
  targetLongestAxis = 1,
): void {
  normalizeObjectToLength(model, targetLongestAxis);
}

export async function installMintAttachments(
  model: THREE.Group,
  attachments: AttachmentSelection,
  assets: MintAssetRuntime,
  weapon: WeaponDefinition,
): Promise<void> {
  prepareMintWeaponReplacementGeometry(model, attachments, weapon);
  const entries = Object.entries(attachments) as Array<
    [keyof AttachmentSelection, string]
  >;
  await Promise.all(
    entries.map(async ([slot, selectedId]) => {
      const artifactId = `attachment-${selectedId}`;
      if (!assets.getArtifact(artifactId, 'model')) return;
      const source = await assets.instantiateModel(artifactId);
      if (!source) return;
      const attachment = prepareMintAttachmentModel(
        source,
        selectedId,
        slot,
        getAttachmentTargetSize(weapon, selectedId),
      );
      const authoredSocket =
        model.getObjectByName(slot) ??
        model.getObjectByName(`socket_${slot}`) ??
        model.getObjectByName(`socket-${slot}`);
      const socket =
        authoredSocket instanceof THREE.Object3D
          ? authoredSocket
          : createRuntimeAttachmentSocket(weapon, slot, selectedId);
      if (!authoredSocket) model.add(socket);
      const socketPosition = snapMintAttachmentAnchorToSurface(
        model,
        slot,
        getAttachmentAnchor(weapon, selectedId),
      );
      if (!authoredSocket) socket.position.copy(socketPosition);
      attachment.name = `mint-${artifactId}`;
      attachment.position.set(0, 0, 0);
      attachment.userData.slot = slot;
      attachment.userData.weaponId = weapon.id;
      attachment.userData.socketPosition = socketPosition.toArray();
      attachment.userData.mountSurfaceDistance =
        measureMintWeaponSurfaceDistance(model, socketPosition);
      if (slot === 'muzzle') {
        const muzzleContact = measureMintMuzzleAxialContact(model, socketPosition);
        attachment.userData.muzzleAxialGap = muzzleContact.gap;
        attachment.userData.muzzleAxialOverlap = muzzleContact.overlap;
        attachment.userData.muzzleBarrelFace = muzzleContact.barrelFace;
      }
      socket.add(attachment);
    }),
  );
  const muzzleAttachment = model.getObjectByName(
    `mint-attachment-${attachments.muzzle}`,
  );
  if (muzzleAttachment) {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(muzzleAttachment);
    const socketPosition = getAttachmentAnchor(weapon, attachments.muzzle);
    model.userData.muzzlePosition = new THREE.Vector3(
      bounds.max.x,
      socketPosition.y,
      socketPosition.z,
    );
  }
}

export class WeaponViewModel {
  readonly group = new THREE.Group();
  readonly muzzleFlash = new THREE.PointLight('#ffd798', 0, 2.4, 2);
  private model: THREE.Group | null = null;
  private currentId = '';
  private recoil = 0;
  private previousShotPulse = 0;
  private inspectTime = 0;
  private rebuildRevision = 0;
  private pendingMintWeaponId: string | null = null;
  private pendingMintPromise: Promise<boolean> | null = null;
  private arms: THREE.Group | null = null;
  private armsMixer: THREE.AnimationMixer | null = null;
  private readonly armsActions = new Map<string, THREE.AnimationAction>();
  private activeArmAction = '';
  private previousWeaponState = '';
  private muzzleSprite: THREE.Sprite | null = null;
  private knife: THREE.Group | null = null;
  private primaryHand: THREE.Object3D | null = null;
  private supportHand: THREE.Object3D | null = null;
  private readonly weaponGrip = new THREE.Group();
  private readonly weaponFeel = new THREE.Group();
  private readonly knifeGrip = new THREE.Group();
  private readonly armsBaseRotation = new THREE.Euler();
  private readonly armsBasePosition = new THREE.Vector3(0.22, -1.48, 0.42);
  private locomotionRoll = 0;
  private locomotionPitch = 0;
  private locomotionBob = 0;
  private meleePresentationActive = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly getAttachments: (weaponId: string) => AttachmentSelection,
    private readonly assets?: MintAssetRuntime,
  ) {
    this.group.renderOrder = 10;
    this.group.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
    this.camera.add(this.group);
    this.group.add(this.muzzleFlash);
    this.weaponGrip.name = 'fp-weapon-grip';
    this.weaponFeel.name = 'fp-weapon-feel';
    this.knifeGrip.name = 'fp-knife-grip';
    this.weaponGrip.add(this.weaponFeel);
    this.weaponGrip.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
    this.weaponFeel.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
    this.knifeGrip.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
    this.muzzleFlash.layers.set(FIRST_PERSON_VIEWMODEL_LAYER);
    // Keep FP guns/arms composited over Gaussian RAD depth. Spark splat pages
    // often write near-camera depth (water/sky shells), which would otherwise
    // erase the entire viewmodel even when the Mint GLBs are resident.
    applyFirstPersonDepthPolicy(this.group);
  }

  update(
    delta: number,
    weaponSystem: WeaponSystem,
    elapsed: number,
    locomotion?: ViewModelLocomotion,
  ): void {
    if (this.currentId !== weaponSystem.current.id) {
      this.rebuild(weaponSystem.current);
    } else if (
      !this.model &&
      this.assets?.visibleFallbacksAllowed === false &&
      !this.pendingMintPromise
    ) {
      // Mint-only mode: a failed/cancelled upgrade left the HUD weapon armed
      // with no mesh. Retry instead of staying empty forever.
      this.rebuild(weaponSystem.current);
    }
    this.armsMixer?.update(delta);
    if (weaponSystem.shotPulse > this.previousShotPulse) this.recoil = 1;
    const fired = weaponSystem.shotPulse > this.previousShotPulse;
    this.previousShotPulse = weaponSystem.shotPulse;
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 20, delta);
    this.inspectTime += delta;
    this.updateArmAnimation(weaponSystem, fired, locomotion);
    const melee = weaponSystem.state === 'melee';
    this.updateKnifePose(melee, weaponSystem);
    if (melee) {
      this.applyMeleeStabPresentation();
    } else {
      if (this.meleePresentationActive) this.clearMeleeStabPresentation();
      this.applyLocomotionOverlay(delta, weaponSystem, locomotion);
      this.reachHandToHeldItem();
    }
    if (!this.model) return;

    const handAttached = this.attachmentMode === 'hand-bone';
    this.model.visible = !melee;
    this.muzzleFlash.intensity = melee ? 0 : this.muzzleFlash.intensity;

    const ads = weaponSystem.adsFactor;
    const sprint = weaponSystem.state === 'sprinting' ? 1 : 0;
    const reload =
      weaponSystem.state === 'reloading'
        ? Math.sin(weaponSystem.reloadProgress * Math.PI)
        : 0;
    const inspect = weaponSystem.state === 'inspecting' ? 1 : 0;
    const bob = Math.sin(elapsed * 8.5) * (1 - ads) * 0.004;
    if (melee) {
      this.group.position.lerp(
        new THREE.Vector3(0.06, -0.04, -0.04),
        Math.min(1, delta * 22),
      );
      this.group.rotation.set(0, 0, 0);
    } else {
      const targetPosition = new THREE.Vector3(
        THREE.MathUtils.lerp(0.34, 0.002, ads) + sprint * (handAttached ? 0.08 : 0.13),
        THREE.MathUtils.lerp(-0.3, -0.205, ads) -
          sprint * (handAttached ? 0.08 : 0.13) -
          reload * 0.12 +
          bob,
        THREE.MathUtils.lerp(-0.58, -0.42, ads) + this.recoil * 0.055,
      );
      this.group.position.lerp(targetPosition, Math.min(1, delta * 18));
      this.group.rotation.x =
        reload * (handAttached ? 0.2 : 0.42) +
        inspect * Math.sin(this.inspectTime * 2.2) * (handAttached ? 0.14 : 0.28);
      this.group.rotation.y =
        inspect * (handAttached ? 0.4 : 0.78) + this.recoil * 0.035;
      this.group.rotation.z =
        -0.08 - sprint * (handAttached ? 0.35 : 0.68) - reload * 0.3;
    }
    this.syncMuzzleFlash(weaponSystem, elapsed, melee);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Block until arms, knife, and the equipped Mint weapon mesh are installed.
   * Call this from loading gates — `rebuild()` alone only kicks a background
   * upgrade and can open play with a null model under Mint-only policy.
   */
  async ensureMintWeaponReady(weapon: WeaponDefinition): Promise<void> {
    if (!this.arms) {
      const armsReady = await this.initializeMintArms();
      if (!armsReady) {
        throw new Error('Required first-person arms failed to decode');
      }
    }
    if (!this.knife) {
      const knifeReady = await this.initializeMintKnife();
      if (!knifeReady) {
        throw new Error('Required combat knife failed to decode');
      }
    }

    if (this.currentId !== weapon.id || !this.model) {
      this.rebuild(weapon);
      if (this.pendingMintPromise) {
        await this.pendingMintPromise;
      }
    }

    if (!this.model) {
      // One explicit retry after a cancelled revision or transient decode miss.
      const revision = ++this.rebuildRevision;
      const loaded = await this.upgradeToMintModel(weapon, revision);
      if (!loaded && this.assets?.visibleFallbacksAllowed !== false) {
        const attachments = this.getAttachments(weapon.id);
        this.model = createWeaponModel(weapon, attachments);
        this.installModel(this.model, weapon);
      }
    }

    if (!this.model) {
      throw new Error(`Required Mint weapon failed to decode: ${weapon.id}`);
    }
    this.attachEquippedToHand();
    applyFirstPersonDepthPolicy(this.group);
  }

  get weaponMeshCount(): number {
    if (!this.model) return 0;
    let count = 0;
    this.model.traverse((object) => {
      if (object instanceof THREE.Mesh) count += 1;
    });
    return count;
  }

  get hasEquippedWeaponModel(): boolean {
    return Boolean(this.model && this.currentId);
  }

  async initializeMintArms(): Promise<boolean> {
    if (!this.assets?.getArtifact('first-person-arms', 'model')) return false;
    try {
      const arms = await this.assets.instantiateModel('first-person-arms');
      if (!arms) return false;
      if (this.arms) {
        this.detachHandGrips();
        this.group.remove(this.arms);
      }
      this.arms = arms;
      this.arms.name = 'mint-first-person-arms';
      // Full-body operator: park the torso behind the near plane (+Z) so only
      // arms reach into the look direction. Yaw aligns clip facing to camera -Z.
      this.arms.position.copy(this.armsBasePosition);
      this.arms.rotation.set(0, Math.PI, 0);
      this.arms.scale.setScalar(1);
      clipFirstPersonBodyMeshes(this.arms);
      this.arms.visible = true;
      this.arms.traverse((object) => {
        object.renderOrder = 12;
        object.frustumCulled = false;
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          if (
            material instanceof THREE.MeshStandardMaterial ||
            material instanceof THREE.MeshPhysicalMaterial
          ) {
            material.emissive.lerp(new THREE.Color('#2a3428'), 0.15);
            material.emissiveIntensity = Math.max(
              material.emissiveIntensity,
              0.12,
            );
          }
        }
      });
      applyFirstPersonDepthPolicy(this.arms);
      this.group.add(this.arms);
      const clips = await this.assets.loadAnimationSet('animation-first-person-weapon');
      const facingClip = clips.idle ?? clips.aim ?? Object.values(clips)[0];
      this.arms.rotation.y =
        Math.PI + clipHipsYawOffsetToActorForward(facingClip);
      this.armsBaseRotation.copy(this.arms.rotation);
      this.armsMixer = new THREE.AnimationMixer(this.arms);
      this.armsActions.clear();
      for (const [semantic, clip] of Object.entries(clips)) {
        const action = this.armsMixer.clipAction(clip);
        action.enabled = true;
        action.setLoop(
          ['idle', 'aim', 'sprint'].includes(semantic) ? THREE.LoopRepeat : THREE.LoopOnce,
          Infinity,
        );
        action.clampWhenFinished = !['idle', 'aim', 'sprint'].includes(semantic);
        this.armsActions.set(semantic, action);
      }
      this.playArmAnimation('idle', true);
      this.bindHandGrips();
      this.attachEquippedToHand();
      const muzzleTexture = await this.assets.loadTexture('vfx-muzzle-atlas');
      if (muzzleTexture) {
        const spriteTexture = mintMuzzleTextureWithDerivedAlpha(muzzleTexture);
        spriteTexture.repeat.set(0.25, 0.5);
        spriteTexture.offset.set(0, 0.5);
        spriteTexture.needsUpdate = true;
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: spriteTexture,
            color: '#fff3d2',
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        sprite.name = 'mint-muzzle-atlas-sprite';
        sprite.scale.set(0.26, 0.18, 1);
        sprite.visible = false;
        this.muzzleSprite?.removeFromParent();
        this.muzzleSprite = sprite;
        if (this.model) this.model.add(sprite);
        else this.group.add(sprite);
      }
      return true;
    } catch (error) {
      console.warn('Mint first-person arms failed to load.', error);
      return false;
    }
  }

  async initializeMintKnife(): Promise<boolean> {
    if (!this.assets?.getArtifact('weapon-combat-knife', 'model')) return false;
    try {
      const source = await this.assets.instantiateModel('weapon-combat-knife');
      if (!source) return false;
      this.knife?.removeFromParent();
      const knife = prepareMintKnifeModel(source);
      knife.name = 'mint-combat-knife';
      knife.visible = false;
      knife.userData.meleePresentation = 'first-person-stab';
      // Base scale; melee presentation applies a larger stab scale each frame.
      knife.scale.multiplyScalar(1.2);
      knife.traverse((object) => {
        object.frustumCulled = false;
        object.renderOrder = Math.max(object.renderOrder, 15);
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          if (
            material instanceof THREE.MeshStandardMaterial ||
            material instanceof THREE.MeshPhysicalMaterial
          ) {
            material.emissive.lerp(new THREE.Color('#3a4034'), 0.2);
            material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.2);
          }
        }
      });
      applyFirstPersonDepthPolicy(knife);
      this.knife = knife;
      this.attachKnifeToGrip();
      return true;
    } catch (error) {
      console.warn('Mint combat knife failed to load.', error);
      return false;
    }
  }

  get armsVisible(): boolean {
    return Boolean(this.arms?.visible);
  }

  get armsMeshCount(): number {
    if (!this.arms) return 0;
    let count = 0;
    this.arms.traverse((object) => {
      if (object instanceof THREE.Mesh && object.visible) count += 1;
    });
    return count;
  }

  get knifeVisible(): boolean {
    return Boolean(this.knife?.visible);
  }

  get knifeMeshCount(): number {
    if (!this.knife) return 0;
    let count = 0;
    this.knife.traverse((object) => {
      if (object instanceof THREE.Mesh && object.visible) count += 1;
    });
    return count;
  }

  get attachmentMode(): ViewModelAttachmentMode {
    // "hand-bone" means the RightHand is actively reached to the held item.
    return this.primaryHand ? 'hand-bone' : 'camera-space';
  }

  get handBoneName(): string | null {
    return this.primaryHand?.name ?? null;
  }

  /** Distance from RightHand origin to the weapon grip point in world space. */
  get primaryGripDistance(): number {
    if (!this.model || !this.primaryHand || !this.model.visible) {
      return Infinity;
    }
    this.model.updateWorldMatrix(true, false);
    this.primaryHand.updateWorldMatrix(true, false);
    _gripWorld.copy(FP_WEAPON_GRIP_POINT).applyMatrix4(this.model.matrixWorld);
    this.primaryHand.getWorldPosition(_handWorld);
    return _gripWorld.distanceTo(_handWorld);
  }

  /** Distance from RightHand origin to the knife grip point while visible. */
  get knifeGripDistance(): number {
    if (!this.knife || !this.primaryHand || !this.knife.visible) return Infinity;
    this.knife.updateWorldMatrix(true, false);
    this.primaryHand.updateWorldMatrix(true, false);
    _gripWorld.copy(FP_KNIFE_GRIP_POINT).applyMatrix4(this.knife.matrixWorld);
    this.primaryHand.getWorldPosition(_handWorld);
    return _gripWorld.distanceTo(_handWorld);
  }

  /** Dot of weapon +X (muzzle) vs camera look (-Z), horizontal. */
  get weaponForwardAlignment(): number {
    if (!this.model || !this.model.visible) return -1;
    this.model.updateWorldMatrix(true, false);
    this.camera.updateWorldMatrix(true, false);
    _weaponForward
      .set(1, 0, 0)
      .transformDirection(this.model.matrixWorld)
      .setY(0)
      .normalize();
    _cameraForward
      .set(0, 0, -1)
      .transformDirection(this.camera.matrixWorld)
      .setY(0)
      .normalize();
    if (_weaponForward.lengthSq() < 1e-6 || _cameraForward.lengthSq() < 1e-6) {
      return -1;
    }
    return _weaponForward.dot(_cameraForward);
  }

  handAttachmentDiagnostics(): {
    mode: ViewModelAttachmentMode;
    handBone: string | null;
    supportHand: string | null;
    primaryGripDistance: number;
    knifeGripDistance: number;
    weaponForwardAlignment: number;
    armsVisible: boolean;
    knifeVisible: boolean;
    weaponMeshCount: number;
    activeArmAction: string;
    groupVisible: boolean;
  } {
    return {
      mode: this.attachmentMode,
      handBone: this.handBoneName,
      supportHand: this.supportHand?.name ?? null,
      primaryGripDistance: this.primaryGripDistance,
      knifeGripDistance: this.knifeGripDistance,
      weaponForwardAlignment: this.weaponForwardAlignment,
      armsVisible: this.armsVisible,
      knifeVisible: this.knifeVisible,
      weaponMeshCount: this.weaponMeshCount,
      activeArmAction: this.activeArmAction,
      groupVisible: this.group.visible,
    };
  }

  private rebuild(weapon: WeaponDefinition): void {
    if (
      this.pendingMintPromise &&
      this.pendingMintWeaponId === weapon.id
    ) {
      return;
    }
    const revision = ++this.rebuildRevision;
    if (this.model) {
      this.model.removeFromParent();
      disposeMintWeaponReplacementGeometry(this.model);
    }
    const attachments = this.getAttachments(weapon.id);
    this.model = null;
    if (this.assets?.visibleFallbacksAllowed !== false) {
      this.model = createWeaponModel(weapon, attachments);
      this.installModel(this.model, weapon);
    } else {
      // Mint-only: do not claim the weapon id until the GLB installs. Setting
      // currentId early made update() stop retrying after a failed upgrade.
      this.currentId = '';
    }
    this.pendingMintWeaponId = weapon.id;
    this.pendingMintPromise = this.upgradeToMintModel(weapon, revision).finally(
      () => {
        if (this.pendingMintWeaponId === weapon.id) {
          this.pendingMintWeaponId = null;
          this.pendingMintPromise = null;
        }
      },
    );
  }

  private installModel(model: THREE.Group, weapon: WeaponDefinition): void {
    this.model = model;
    this.model.scale.multiplyScalar(0.82);
    this.model.traverse((object) => {
      object.renderOrder = 11;
      object.frustumCulled = false;
    });
    applyFirstPersonDepthPolicy(this.model);
    this.attachWeaponToGrip();
    this.currentId = weapon.id;
    this.syncMuzzleToModel(weapon);
  }

  private async upgradeToMintModel(
    weapon: WeaponDefinition,
    revision: number,
  ): Promise<boolean> {
    if (!this.assets?.getArtifact(`weapon-${weapon.id}`, 'model')) return false;
    try {
      const source = await this.assets.instantiateModel(`weapon-${weapon.id}`);
      if (!source || revision !== this.rebuildRevision) return false;
      const generated = prepareMintWeaponModel(source, weapon);
      await installMintAttachments(
        generated,
        this.getAttachments(weapon.id),
        this.assets,
        weapon,
      );
      if (revision !== this.rebuildRevision) return false;
      if (this.model) {
        this.model.removeFromParent();
        disposeMintWeaponReplacementGeometry(this.model);
      }
      this.installModel(generated, weapon);
      return true;
    } catch (error) {
      console.warn(`Mint weapon asset failed to load: ${weapon.id}`, error);
      return false;
    }
  }

  private bindHandGrips(): void {
    if (!this.arms) return;
    this.primaryHand = resolveHandBone(this.arms, 'Right');
    this.supportHand = resolveHandBone(this.arms, 'Left');
    if (!this.primaryHand) {
      console.warn(
        'Mint first-person arms missing RightHand bone; using camera-space weapons.',
      );
      return;
    }
    this.primaryHand.add(this.weaponGrip);
    this.primaryHand.add(this.knifeGrip);
    this.weaponGrip.position.set(0, 0, 0);
    this.weaponGrip.quaternion.identity();
    this.knifeGrip.position.set(0, 0, 0);
    this.knifeGrip.quaternion.identity();
  }

  private detachHandGrips(): void {
    this.weaponGrip.removeFromParent();
    this.knifeGrip.removeFromParent();
    this.primaryHand = null;
    this.supportHand = null;
  }

  private attachEquippedToHand(): void {
    this.attachWeaponToGrip();
    this.attachKnifeToGrip();
  }

  private attachWeaponToGrip(): void {
    if (!this.model) return;
    // Keep the gun in camera space so it stays readable. The full-body arms
    // rig is parked behind the near plane; bone-parenting the gun would hide it.
    // RightHand is pulled onto the grip each frame in `reachHandToHeldItem`.
    this.group.add(this.model);
    this.weaponFeel.position.set(0, 0, 0);
    this.weaponFeel.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    this.model.rotation.copy(FIRST_PERSON_WEAPON_ROTATION);
    this.model.visible = true;
    this.model.traverse((object) => {
      object.frustumCulled = false;
      object.renderOrder = Math.max(object.renderOrder, 14);
    });
    applyFirstPersonDepthPolicy(this.model);
    if (this.muzzleSprite && this.muzzleSprite.parent !== this.model) {
      this.model.add(this.muzzleSprite);
    }
    if (this.muzzleFlash.parent !== this.model) {
      this.model.add(this.muzzleFlash);
    }
  }

  private attachKnifeToGrip(): void {
    if (!this.knife) return;
    // Camera-space knife; RightHand snaps onto the handle each melee frame.
    this.group.add(this.knife);
    this.knife.position.set(0.06, -0.1, -0.05);
    this.knife.rotation.copy(FIRST_PERSON_KNIFE_ROTATION);
  }

  private updateKnifePose(melee: boolean, weaponSystem: WeaponSystem): void {
    if (!this.knife) return;
    this.knife.visible = melee;
    if (!melee) {
      this.knife.scale.setScalar(1.15);
      return;
    }
    applyFirstPersonDepthPolicy(this.knife);
    if (this.knife.parent !== this.group) this.group.add(this.knife);
    const thrust = Math.sin(this.getMeleeProgress(weaponSystem) * Math.PI);
    _stabPos.lerpVectors(FP_STAB_KNIFE_START, FP_STAB_KNIFE_APEX, thrust);
    this.knife.position.copy(_stabPos);
    this.knife.scale.setScalar(1.02 + thrust * 0.06);
    // Tip toward the crosshair from the lower-right pocket; roll keeps the
    // double-edge silhouette readable instead of foreshortened into a slab.
    _stabTip
      .set(-0.5 + thrust * 0.12, 0.38 - thrust * 0.3, -1)
      .normalize();
    this.knife.quaternion.setFromUnitVectors(_knifeTipAxis, _stabTip);
    this.knife.rotateX(-0.25);
    this.knife.rotateZ(0.15);
  }

  /**
   * Camera-space stab with the existing combat knife. The full-body FP arms
   * mesh cannot follow a thrust (hand snap / bone swing skins into a blob), so
   * arms stay hidden for the swing and the knife carries the stab read.
   */
  private applyMeleeStabPresentation(): void {
    if (!this.meleePresentationActive) {
      this.meleePresentationActive = true;
    }
    if (this.arms) {
      this.arms.visible = false;
      this.arms.position.copy(this.armsBasePosition);
      this.arms.rotation.copy(this.armsBaseRotation);
    }
    const idle = this.armsActions.get('idle');
    if (idle) {
      idle.paused = true;
      idle.time = Math.min(0.18, idle.getClip().duration * 0.2);
    }
  }

  private clearMeleeStabPresentation(): void {
    if (!this.meleePresentationActive) return;
    const idle = this.armsActions.get('idle');
    if (idle) idle.paused = false;
    if (this.arms) {
      this.arms.visible = true;
      this.arms.position.copy(this.armsBasePosition);
      this.arms.rotation.copy(this.armsBaseRotation);
    }
    this.meleePresentationActive = false;
  }

  /**
   * Snap the RightHand onto the gun grip while the gun is camera-space.
   * The full-body rig stays parked behind the near plane.
   */
  private reachHandToHeldItem(): void {
    if (!this.primaryHand || !this.model?.visible) return;
    const parent = this.primaryHand.parent;
    if (!parent) return;
    this.model.updateWorldMatrix(true, false);
    parent.updateWorldMatrix(true, false);
    _gripWorld.copy(FP_WEAPON_GRIP_POINT).applyMatrix4(this.model.matrixWorld);
    parent.worldToLocal(_gripWorld);
    this.primaryHand.position.copy(_gripWorld);
    this.primaryHand.updateMatrixWorld(true);
  }

  private getMeleeProgress(weaponSystem: WeaponSystem): number {
    // Stab presentation is driven by the weapon-system clock, not the stretchy
    // full-body melee clip (which we intentionally do not play).
    return weaponSystem.stateProgress;
  }

  private applyLocomotionOverlay(
    delta: number,
    weaponSystem: WeaponSystem,
    locomotion?: ViewModelLocomotion,
  ): void {
    if (!this.arms) return;
    const ads = weaponSystem.adsFactor;
    const busy = ['melee', 'reloading', 'inspecting', 'equipping'].includes(
      weaponSystem.state,
    );
    const sample = locomotion ?? {
      speed: 0,
      forward: 0,
      strafe: 0,
      sprinting: false,
      crouching: false,
    };
    const moveWeight =
      busy || ads > 0.75
        ? 0
        : THREE.MathUtils.clamp(sample.speed / 4.65, 0, 1) * (1 - ads * 0.85);
    const targetRoll = -sample.strafe * 0.1 * moveWeight;
    const targetPitch =
      sample.forward * 0.035 * moveWeight - (sample.crouching ? 0.04 : 0);
    this.locomotionRoll = THREE.MathUtils.damp(
      this.locomotionRoll,
      targetRoll,
      10,
      delta,
    );
    this.locomotionPitch = THREE.MathUtils.damp(
      this.locomotionPitch,
      targetPitch,
      10,
      delta,
    );
    this.locomotionBob += sample.speed * delta * 1.4;
    const sway =
      moveWeight > 0.05
        ? Math.sin(this.locomotionBob) * 0.012 * moveWeight
        : 0;
    this.arms.position.copy(this.armsBasePosition);
    this.arms.rotation.set(
      this.armsBaseRotation.x + this.locomotionPitch + sway * 0.35,
      this.armsBaseRotation.y,
      this.armsBaseRotation.z + this.locomotionRoll + sway,
    );
  }

  private syncMuzzleToModel(weapon: WeaponDefinition): void {
    if (!this.model) return;
    const muzzle =
      this.model.userData.muzzlePosition instanceof THREE.Vector3
        ? this.model.userData.muzzlePosition
        : new THREE.Vector3(weapon.silhouette.length * 0.7, 0, 0);
    _muzzleLocal.copy(muzzle);
    if (this.muzzleFlash.parent === this.model) {
      this.muzzleFlash.position.copy(_muzzleLocal);
    } else {
      this.muzzleFlash.position.copy(_muzzleLocal).applyEuler(this.model.rotation);
    }
    this.muzzleSprite?.position.copy(this.muzzleFlash.position);
  }

  private syncMuzzleFlash(
    weaponSystem: WeaponSystem,
    flashElapsed: number,
    melee: boolean,
  ): void {
    this.muzzleFlash.intensity =
      !melee && weaponSystem.shotPulse > 0.55 ? 4.2 : 0;
    if (this.muzzleSprite) {
      this.muzzleSprite.visible = !melee && weaponSystem.shotPulse > 0.55;
      this.muzzleSprite.material.rotation = flashElapsed * 9.7;
    }
    if (!this.model || this.muzzleFlash.parent === this.model) return;
    // Camera-space fallback: keep flash aligned after model rotation.
    const muzzle =
      this.model.userData.muzzlePosition instanceof THREE.Vector3
        ? this.model.userData.muzzlePosition
        : _muzzleLocal.set(0.4, 0, 0);
    this.muzzleFlash.position.copy(muzzle).applyEuler(this.model.rotation);
    this.muzzleSprite?.position.copy(this.muzzleFlash.position);
  }

  private updateArmAnimation(
    weaponSystem: WeaponSystem,
    fired: boolean,
    locomotion?: ViewModelLocomotion,
  ): void {
    let semantic = 'idle';
    if (fired) semantic = 'fire';
    else if (weaponSystem.state === 'reloading') {
      semantic =
        weaponSystem.current.fireMode === 'shotgun' ? 'shotgun_shell_reload' : 'reload';
    } else if (weaponSystem.state === 'sprinting' || locomotion?.sprinting) {
      semantic = 'sprint';
    } else if (weaponSystem.state === 'inspecting') semantic = 'inspect';
    else if (weaponSystem.state === 'melee') {
      // Keep idle bones; camera-space knife + hand snap form the stab pose.
      semantic = 'idle';
    } else if (weaponSystem.adsFactor > 0.7) semantic = 'aim';
    else if (weaponSystem.state === 'equipping') semantic = 'equip';
    else if ((locomotion?.speed ?? 0) > 1.4 && weaponSystem.adsFactor < 0.45) {
      // No dedicated walk clip — keep idle while locomotion overlay supplies sway.
      semantic = 'idle';
    }
    if (fired || semantic !== this.previousWeaponState) {
      this.playArmAnimation(semantic, fired);
      this.previousWeaponState = semantic;
    }
  }

  private playArmAnimation(semantic: string, restart = false): void {
    const next = this.armsActions.get(semantic) ?? this.armsActions.get('idle');
    if (!next || (!restart && this.activeArmAction === semantic)) return;
    const previous = this.armsActions.get(this.activeArmAction);
    if (restart) next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (previous && previous !== next) previous.crossFadeTo(next, 0.12, false);
    this.activeArmAction = semantic;
  }
}
