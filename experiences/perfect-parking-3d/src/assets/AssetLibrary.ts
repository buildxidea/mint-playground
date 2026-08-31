import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  AUDIO_MANIFEST,
  MODEL_MANIFEST,
  type AudioKey,
  type ModelKey,
} from './manifest';

export type LoadedModel = {
  template: THREE.Object3D;
  source: 'mint' | 'placeholder';
};

export type CloneModelOptions = {
  /** Optional paint tint for parked-car variants. */
  tint?: string;
  /** Parked support cars can skip expensive shadow-map rendering. */
  castShadow?: boolean;
};

/**
 * Loads Mint GLBs from public paths. Invisible placeholders only used when a
 * file is missing so greybox development can continue; production requires Mint.
 */
export class AssetLibrary {
  private readonly models = new Map<ModelKey, LoadedModel>();
  private readonly audioBuffers = new Map<AudioKey, AudioBuffer>();
  private readonly gltf = new GLTFLoader();
  private audioCtx: AudioContext | null = null;

  async loadAll(onProgress?: (label: string) => void): Promise<void> {
    for (const key of Object.keys(MODEL_MANIFEST) as ModelKey[]) {
      onProgress?.(`Loading ${key}…`);
      this.models.set(key, await this.loadModel(key));
    }

    for (const key of Object.keys(AUDIO_MANIFEST) as AudioKey[]) {
      onProgress?.(`Loading audio ${key}…`);
      const buffer = await this.loadAudio(key);
      if (buffer) this.audioBuffers.set(key, buffer);
    }
  }

  cloneModel(key: ModelKey, options: CloneModelOptions = {}): THREE.Object3D {
    const loaded = this.models.get(key);
    if (!loaded) throw new Error(`Model not loaded: ${key}`);
    const clone = loaded.template.clone(true);
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = options.castShadow ?? true;
        mesh.receiveShadow = true;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => tintMaterial(m.clone(), options.tint));
        } else if (mesh.material) {
          mesh.material = tintMaterial(mesh.material.clone(), options.tint);
        }
      }
    });
    return clone;
  }

  modelSource(key: ModelKey): 'mint' | 'placeholder' {
    return this.models.get(key)?.source ?? 'placeholder';
  }

  getAudio(key: AudioKey): AudioBuffer | undefined {
    return this.audioBuffers.get(key);
  }

  getAudioContext(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }

  private async loadModel(key: ModelKey): Promise<LoadedModel> {
    const entry = MODEL_MANIFEST[key];
    try {
      const gltf = await this.gltf.loadAsync(entry.path);
      const visual = normalizeModel(
        gltf.scene,
        entry.targetSize,
        entry.targetWidth,
        entry.forward,
        key,
      );
      // Pivot receives gameplay yaw; visual keeps baked forward offset so
      // groundVehicleMesh never wipes the authored-axis correction.
      const pivot = new THREE.Group();
      pivot.name = key;
      pivot.add(visual);
      return { template: pivot, source: 'mint' };
    } catch {
      console.warn(`[assets] Missing Mint model at ${entry.path}; using placeholder for ${key}`);
      return {
        template: createPlaceholder(key, entry.targetSize, entry.targetWidth),
        source: 'placeholder',
      };
    }
  }

  private async loadAudio(key: AudioKey): Promise<AudioBuffer | null> {
    const path = AUDIO_MANIFEST[key];
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.arrayBuffer();
      return await this.getAudioContext().decodeAudioData(data.slice(0));
    } catch {
      console.warn(`[assets] Missing Mint audio at ${path}`);
      return null;
    }
  }
}

function normalizeModel(
  source: THREE.Object3D,
  targetSize: number,
  targetWidth: number | undefined,
  forward: 'negZ' | 'posZ' | 'negX' | 'posX',
  key?: ModelKey,
): THREE.Group {
  const isVehicle =
    key === 'compact_car' || key === 'sports_car' || key === 'delivery_van';
  const normalized = new THREE.Group();
  normalized.name = `${key ?? 'model'}-normalized`;
  normalized.add(source);

  // Drive convention: yaw 0 faces +Z. Bake the authored forward correction on
  // the source, then size the unrotated wrapper in gameplay X/Z axes.
  const yawOffset =
    forward === 'negZ'
      ? Math.PI
      : forward === 'posX'
        ? -Math.PI / 2
        : forward === 'negX'
          ? Math.PI / 2
          : 0;
  source.rotation.y = yawOffset;
  normalized.userData.yawOffset = yawOffset;
  normalized.updateMatrixWorld(true);

  const orientedSize = new THREE.Box3()
    .setFromObject(normalized)
    .getSize(new THREE.Vector3());
  if (isVehicle && targetWidth) {
    normalized.scale.x *= targetWidth / Math.max(0.001, orientedSize.x);
    normalized.scale.z *= targetSize / Math.max(0.001, orientedSize.z);
    // Preserve authored height while correcting the two gameplay footprint axes.
    const planarScale = Math.sqrt(normalized.scale.x * normalized.scale.z);
    normalized.scale.y *= planarScale;
  } else {
    const basis =
      key === 'asphalt_lot'
        ? Math.max(orientedSize.x, orientedSize.z, 0.001)
        : Math.max(orientedSize.x, orientedSize.y, orientedSize.z, 0.001);
    normalized.scale.multiplyScalar(targetSize / basis);
  }

  seatAndCenter(normalized);

  // Flatten thick ground-like meshes so gameplay reads as a painted lot, not a curb.
  if (key === 'asphalt_lot' || key === 'parking_bay') {
    normalized.updateMatrixWorld(true);
    const tall = new THREE.Box3().setFromObject(normalized);
    const height = tall.max.y - tall.min.y;
    const targetH = key === 'asphalt_lot' ? 0.28 : 0.04;
    if (height > targetH * 1.5) {
      normalized.scale.y *= targetH / height;
      seatAndCenter(normalized);
    }
  }

  normalized.updateMatrixWorld(true);

  // Record footprint in this node's local space for facing diagnostics.
  const foot = new THREE.Box3().setFromObject(normalized).getSize(new THREE.Vector3());
  normalized.userData.footprintX = foot.x;
  normalized.userData.footprintZ = foot.z;
  return normalized;
}

function seatAndCenter(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
}

function tintMaterial(material: THREE.Material, tint?: string): THREE.Material {
  if (!tint) return material;
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial || standard.transparent || !standard.color) {
    return material;
  }
  const hsl = { h: 0, s: 0, l: 0 };
  standard.color.getHSL(hsl);
  // Preserve dark tires/glass and near-neutral chrome. Paint broad colored or
  // light body panels, keeping authored roughness/metalness/texture detail.
  if (hsl.l > 0.24 && (hsl.s > 0.12 || hsl.l > 0.62)) {
    standard.color.lerp(new THREE.Color(tint), 0.7);
  }
  return material;
}

function createPlaceholder(
  key: ModelKey,
  targetSize: number,
  targetWidth?: number,
): THREE.Object3D {
  const group = new THREE.Group();
  const mat = (color: string) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });

  if (key === 'compact_car' || key === 'sports_car' || key === 'delivery_van') {
    const w = targetWidth ?? (key === 'delivery_van' ? 2.1 : key === 'sports_car' ? 1.85 : 1.7);
    const h = key === 'delivery_van' ? 2.1 : key === 'sports_car' ? 1.2 : 1.4;
    const l = targetSize;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h * 0.55, l * 0.9),
      mat(key === 'sports_car' ? '#2bb3a3' : key === 'delivery_van' ? '#e8d28a' : '#e4573d'),
    );
    body.position.y = h * 0.4;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.85, h * 0.4, l * 0.4),
      mat('#9fd7e8'),
    );
    cabin.position.set(0, h * 0.75, key === 'delivery_van' ? 0.3 : -0.2);
    group.add(body, cabin);
  } else if (key === 'parking_bay') {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 5.4),
      new THREE.MeshStandardMaterial({ color: '#3a3f45', roughness: 0.9 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.01;
    const lines = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 5.1),
      new THREE.MeshBasicMaterial({ color: '#f4f1e6', transparent: true, opacity: 0.35 }),
    );
    lines.rotation.x = -Math.PI / 2;
    lines.position.y = 0.02;
    group.add(pad, lines);
  } else if (key === 'traffic_cone') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 12), mat('#ff6a2b'));
    cone.position.y = 0.35;
    group.add(cone);
  } else if (key === 'concrete_barrier') {
    // Length along Z to match post-bake gameplay convention.
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.85, 2.2), mat('#c5c2b8'));
    b.position.y = 0.42;
    group.add(b);
  } else if (key === 'bollard') {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 12), mat('#f0d24a'));
    p.position.y = 0.45;
    group.add(p);
  } else if (key === 'parking_booth') {
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), mat('#6f8fa8'));
    booth.position.y = 1.2;
    group.add(booth);
  } else if (key === 'asphalt_lot') {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: '#4a4e55', roughness: 0.95 }),
    );
    floor.position.y = -0.06;
    floor.receiveShadow = true;
    group.add(floor);
  } else if (key === 'curb_piece') {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.28, 3), mat('#d0cdc4'));
    curb.position.y = 0.14;
    group.add(curb);
  }

  return group;
}
