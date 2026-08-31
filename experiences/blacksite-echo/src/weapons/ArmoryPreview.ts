import * as THREE from 'three';
import type { MintAssetRuntime } from '../assets/MintAssetRuntime';
import type { WeaponDefinition } from '../data/weapons';
import type { AttachmentSelection } from '../game/types';
import { installMintAttachments } from './WeaponViewModel';
import {
  ARMORY_WEAPON_ROTATION,
  canonicalForwardInWorld,
  disposeMintWeaponReplacementGeometry,
  prepareMintWeaponModel,
} from './WeaponPresentation';

export type ArmoryPreviewDiagnostics = {
  weaponId: string;
  ready: boolean;
  attachmentModels: number;
  mountedSlots: string[];
  replacedSlots: string[];
  replacementTrianglesRemoved: number;
  mountedAttachments: Array<{
    id: string;
    slot: string;
    scaleAxis: 'x' | 'y' | 'z';
    targetSize: number;
    measuredSize: { x: number; y: number; z: number };
    socketPosition: [number, number, number];
    mountSurfaceDistance: number;
    muzzleAxialGap: number;
    muzzleAxialOverlap: number;
    muzzleBarrelFace: [number, number, number];
  }>;
  canonicalForward: '+X';
  displayedForward: { x: number; y: number; z: number };
};

const displayedForward = new THREE.Vector3(1, 0, 0);

export class ArmoryPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.02, 20);
  private readonly modelRoot = new THREE.Group();
  private model: THREE.Group | null = null;
  private revision = 0;
  private elapsed = 0;
  private dragYaw = 0;
  private dragPitch = 0;
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private weaponId = '';
  private selectedAttachmentId = '';
  private highlightedMaterials: THREE.Material[] = [];

  constructor(
    private readonly viewport: HTMLElement,
    private readonly assets: MintAssetRuntime,
  ) {
    this.scene.background = new THREE.Color('#070c09');
    this.scene.add(this.camera, this.modelRoot);
    this.modelRoot.rotation.copy(ARMORY_WEAPON_ROTATION);

    const hemisphere = new THREE.HemisphereLight('#dfffe3', '#101713', 3.1);
    const key = new THREE.DirectionalLight('#f2fff0', 5.4);
    key.position.set(-2.4, 3.2, 4.5);
    const rim = new THREE.DirectionalLight('#9dff37', 4.6);
    rim.position.set(3.5, 1.2, -3.6);
    const fill = new THREE.DirectionalLight('#7bb8ff', 2.1);
    fill.position.set(0, -1.4, 3);
    this.scene.add(hemisphere, key, rim, fill);

    const stage = new THREE.Mesh(
      new THREE.CircleGeometry(1.25, 64),
      new THREE.MeshBasicMaterial({
        color: '#0f1912',
        transparent: true,
        opacity: 0.74,
      }),
    );
    stage.rotation.x = -Math.PI / 2;
    stage.position.y = -0.56;
    this.scene.add(stage);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.735, 96),
      new THREE.MeshBasicMaterial({
        color: '#8fe42e',
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.555;
    this.scene.add(ring);

    this.camera.position.set(0.04, 0.18, 2.25);
    this.camera.lookAt(0, -0.02, 0);
    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    this.viewport.addEventListener('pointermove', this.onPointerMove);
    this.viewport.addEventListener('pointerup', this.onPointerUp);
    this.viewport.addEventListener('pointercancel', this.onPointerUp);
    this.viewport.addEventListener('dblclick', this.onDoubleClick);
  }

  async setWeapon(
    weapon: WeaponDefinition,
    attachments: AttachmentSelection,
    selectedAttachmentId = '',
  ): Promise<void> {
    const revision = ++this.revision;
    this.weaponId = weapon.id;
    this.selectedAttachmentId = selectedAttachmentId;
    this.viewport.dataset.weaponId = weapon.id;
    this.viewport.dataset.previewReady = 'false';
    this.viewport.setAttribute('aria-busy', 'true');
    this.setStatus('Loading Mint platform…');
    try {
      const source = await this.assets.instantiateModel(`weapon-${weapon.id}`);
      if (!source || revision !== this.revision) return;
      const model = prepareMintWeaponModel(source, weapon);
      await installMintAttachments(model, attachments, this.assets, weapon);
      if (revision !== this.revision) return;
      this.clearModel();
      this.model = model;
      this.modelRoot.add(model);
      this.highlightSelectedAttachment();
      this.frameModel();
      this.viewport.dataset.previewReady = 'true';
      this.viewport.setAttribute('aria-busy', 'false');
      this.setStatus('Drag to rotate // double-click to reset');
    } catch (error) {
      if (revision !== this.revision) return;
      this.viewport.dataset.previewReady = 'error';
      this.viewport.setAttribute('aria-busy', 'false');
      this.setStatus('Mint platform preview unavailable');
      console.warn(`Armory preview failed to load: ${weapon.id}`, error);
    }
  }

  update(delta: number, reducedMotion: boolean): void {
    this.elapsed += delta;
    const idleYaw = reducedMotion || this.dragging ? 0 : Math.sin(this.elapsed * 0.34) * 0.08;
    this.modelRoot.rotation.set(
      ARMORY_WEAPON_ROTATION.x + this.dragPitch,
      ARMORY_WEAPON_ROTATION.y + this.dragYaw + idleYaw,
      ARMORY_WEAPON_ROTATION.z,
    );
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.model || !this.viewport.isConnected || this.viewport.offsetParent === null) return;
    const canvas = renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const rect = this.viewport.getBoundingClientRect();
    const left = Math.max(canvasRect.left, rect.left);
    const right = Math.min(canvasRect.right, rect.right);
    const top = Math.max(canvasRect.top, rect.top);
    const bottom = Math.min(canvasRect.bottom, rect.bottom);
    const width = Math.floor(right - left);
    const height = Math.floor(bottom - top);
    if (width < 2 || height < 2) return;

    const x = Math.floor(left - canvasRect.left);
    const y = Math.floor(canvasRect.bottom - bottom);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    renderer.setScissorTest(true);
    renderer.setScissor(x, y, width, height);
    renderer.setViewport(x, y, width, height);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  diagnostics(): ArmoryPreviewDiagnostics {
    if (this.model) canonicalForwardInWorld(this.modelRoot, displayedForward);
    const replacementGeometry = this.model?.userData.replacementGeometry as
      | { activeSlots?: string[]; removedTriangles?: number }
      | undefined;
    const mountedSlots: string[] = [];
    const mountedAttachments: ArmoryPreviewDiagnostics['mountedAttachments'] = [];
    this.model?.traverse((object) => {
      if (object.name.startsWith('mint-attachment-') && object.userData.slot) {
        const slot = String(object.userData.slot);
        const measuredSize = object.userData.calibratedSize as
          | { x?: number; y?: number; z?: number }
          | undefined;
        const socketPosition = Array.isArray(object.userData.socketPosition)
          ? object.userData.socketPosition
          : [0, 0, 0];
        mountedSlots.push(slot);
        mountedAttachments.push({
          id: String(object.userData.attachmentId ?? ''),
          slot,
          scaleAxis: object.userData.scaleAxis as 'x' | 'y' | 'z',
          targetSize: Number(object.userData.targetSize ?? 0),
          measuredSize: {
            x: Number(measuredSize?.x ?? 0),
            y: Number(measuredSize?.y ?? 0),
            z: Number(measuredSize?.z ?? 0),
          },
          socketPosition: [
            Number(socketPosition[0] ?? 0),
            Number(socketPosition[1] ?? 0),
            Number(socketPosition[2] ?? 0),
          ],
          mountSurfaceDistance: Number(
            object.userData.mountSurfaceDistance ?? Number.POSITIVE_INFINITY,
          ),
          muzzleAxialGap: Number(
            object.userData.muzzleAxialGap ?? Number.POSITIVE_INFINITY,
          ),
          muzzleAxialOverlap: Number(object.userData.muzzleAxialOverlap ?? 0),
          muzzleBarrelFace: Array.isArray(object.userData.muzzleBarrelFace)
            ? [
                Number(object.userData.muzzleBarrelFace[0] ?? Number.NaN),
                Number(object.userData.muzzleBarrelFace[1] ?? Number.NaN),
                Number(object.userData.muzzleBarrelFace[2] ?? Number.NaN),
              ]
            : [Number.NaN, Number.NaN, Number.NaN],
        });
      }
    });
    return {
      weaponId: this.weaponId,
      ready: Boolean(this.model) && this.viewport.dataset.previewReady === 'true',
      attachmentModels: mountedSlots.length,
      mountedSlots,
      replacedSlots: replacementGeometry?.activeSlots ?? [],
      replacementTrianglesRemoved: Number(
        replacementGeometry?.removedTriangles ?? 0,
      ),
      mountedAttachments,
      canonicalForward: '+X',
      displayedForward: {
        x: displayedForward.x,
        y: displayedForward.y,
        z: displayedForward.z,
      },
    };
  }

  dispose(): void {
    this.viewport.removeEventListener('pointerdown', this.onPointerDown);
    this.viewport.removeEventListener('pointermove', this.onPointerMove);
    this.viewport.removeEventListener('pointerup', this.onPointerUp);
    this.viewport.removeEventListener('pointercancel', this.onPointerUp);
    this.viewport.removeEventListener('dblclick', this.onDoubleClick);
    this.clearModel();
    for (const object of this.scene.children) {
      if (!(object instanceof THREE.Mesh)) continue;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  }

  private frameModel(): void {
    if (!this.model) return;
    const viewportRect = this.viewport.getBoundingClientRect();
    if (viewportRect.width > 0 && viewportRect.height > 0) {
      this.camera.aspect = viewportRect.width / viewportRect.height;
    }
    this.model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.model);
    const size = bounds.getSize(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.1, this.camera.aspect));
    const distance =
      Math.max(
        (size.y * 0.5) / Math.tan(verticalFov / 2),
        (size.x * 0.5) / Math.tan(horizontalFov / 2),
      ) *
        1.34 +
      size.z * 0.55;
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    this.camera.position.set(0.04, size.y * 0.12, Math.max(0.72, distance));
    this.camera.near = Math.max(0.01, distance - radius * 2.2);
    this.camera.far = distance + radius * 4.5;
    this.camera.lookAt(0, -size.y * 0.04, 0);
    this.camera.updateProjectionMatrix();
  }

  private highlightSelectedAttachment(): void {
    if (!this.model || !this.selectedAttachmentId) return;
    const selected = this.model.getObjectByName(
      `mint-attachment-${this.selectedAttachmentId}`,
    );
    selected?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const highlighted = materials.map((material) => {
        const clone = material.clone();
        if (
          clone instanceof THREE.MeshStandardMaterial ||
          clone instanceof THREE.MeshPhysicalMaterial
        ) {
          clone.emissive.set('#7abf24');
          clone.emissiveIntensity = 0.48;
        }
        this.highlightedMaterials.push(clone);
        return clone;
      });
      object.material = Array.isArray(object.material) ? highlighted : highlighted[0];
    });
  }

  private clearModel(): void {
    if (this.model) {
      this.modelRoot.remove(this.model);
      disposeMintWeaponReplacementGeometry(this.model);
    }
    this.model = null;
    this.highlightedMaterials.forEach((material) => material.dispose());
    this.highlightedMaterials = [];
  }

  private setStatus(value: string): void {
    const status = this.viewport.querySelector<HTMLElement>('[data-preview-status]');
    if (status) status.textContent = value;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.viewport.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const deltaX = event.clientX - this.pointerX;
    const deltaY = event.clientY - this.pointerY;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.dragYaw += deltaX * 0.009;
    this.dragPitch = THREE.MathUtils.clamp(this.dragPitch + deltaY * 0.006, -0.42, 0.42);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.dragging = false;
    if (this.viewport.hasPointerCapture(event.pointerId)) {
      this.viewport.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onDoubleClick = (): void => {
    this.dragYaw = 0;
    this.dragPitch = 0;
  };
}
