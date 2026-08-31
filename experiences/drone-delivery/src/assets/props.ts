import * as THREE from 'three';
import { createMintGltfLoader } from './gltf-runtime';
import { assertLoadable, getModelUrl, hasAsset } from './registry';

/**
 * City prop library. Every prop is an item of the Mint "Miniature City
 * Delivery Props" pack, registered under its own `city-*` key. The models
 * arrive normalized to roughly unit boxes, so each template is fitted to a
 * real-world size along its dominant axis here. If a model has not been
 * synchronized yet, clearly-labelled procedural blockout stand-ins keep the
 * game playable.
 */

export type PropKind =
  | 'landingPad'
  | 'package'
  | 'aptSmall'
  | 'aptMedium'
  | 'tower'
  | 'pylon'
  | 'antenna'
  | 'tree'
  | 'cloud'
  | 'waterTower'
  | 'crane'
  | 'blimp';

/** Registry key and fitted world size per prop. */
const PROP_FIT: Record<PropKind, { key: string; axis: 'x' | 'y' | 'z'; size: number }> = {
  landingPad: { key: 'city-landing-pad', axis: 'x', size: 4 },
  package: { key: 'city-package-box', axis: 'x', size: 0.55 },
  aptSmall: { key: 'city-apartment-small', axis: 'y', size: 10 },
  aptMedium: { key: 'city-apartment-medium', axis: 'y', size: 18 },
  tower: { key: 'city-tower-tall', axis: 'y', size: 30 },
  pylon: { key: 'city-power-pylon', axis: 'y', size: 12 },
  antenna: { key: 'city-antenna-mast', axis: 'y', size: 4.5 },
  tree: { key: 'city-tree', axis: 'y', size: 4 },
  cloud: { key: 'city-cloud-puff', axis: 'x', size: 9 },
  waterTower: { key: 'city-water-tower', axis: 'y', size: 5 },
  crane: { key: 'city-construction-crane', axis: 'y', size: 22 },
  blimp: { key: 'city-patrol-blimp', axis: 'x', size: 6 },
};

export class PropLibrary {
  /** True when the real Mint pack is loaded (vs. procedural blockout). */
  readonly usingMintPack: boolean;

  private constructor(
    private readonly templates: Map<PropKind, THREE.Object3D>,
    usingMintPack: boolean,
  ) {
    this.usingMintPack = usingMintPack;
  }

  /**
   * Spawn a prop instance grounded so its base sits at y = 0 of the returned
   * group's origin. Callers place the group at the prop's floor position.
   */
  spawn(kind: PropKind, scale = 1): THREE.Object3D {
    const template = this.templates.get(kind);
    if (!template) throw new Error(`Unknown prop kind: ${kind}`);
    const instance = template.clone(true);
    instance.scale.multiplyScalar(scale);
    const box = new THREE.Box3().setFromObject(instance);
    instance.position.y -= box.min.y;
    const wrapper = new THREE.Group();
    wrapper.name = `prop:${kind}`;
    wrapper.add(instance);
    return wrapper;
  }

  static async load(): Promise<PropLibrary> {
    const kinds = Object.keys(PROP_FIT) as PropKind[];
    const allSynced = kinds.every((kind) => hasAsset(PROP_FIT[kind].key));
    if (allSynced) {
      const loader = createMintGltfLoader();
      const templates = new Map<PropKind, THREE.Object3D>();
      await Promise.all(
        kinds.map(async (kind) => {
          const fit = PROP_FIT[kind];
          assertLoadable(fit.key);
          const url = getModelUrl(fit.key);
          if (!url) throw new Error(`Asset "${fit.key}" has no model artifact.`);
          const gltf = await loader.loadAsync(url);
          gltf.scene.traverse((child) => {
            child.castShadow = true;
            child.receiveShadow = true;
          });
          templates.set(kind, fitTemplate(gltf.scene, fit.axis, fit.size));
        }),
      );
      return new PropLibrary(templates, true);
    }

    // PLACEHOLDER blockout: used only until the Mint city props are synced.
    const templates = new Map<PropKind, THREE.Object3D>();
    for (const kind of kinds) {
      templates.set(kind, blockout(kind, PROP_FIT[kind].size));
    }
    return new PropLibrary(templates, false);
  }
}

/** Uniformly scale and recentre so `axis` measures `size`, base centred at origin. */
function fitTemplate(object: THREE.Object3D, axis: 'x' | 'y' | 'z', size: number): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(object);
  const dims = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(dims);
  box.getCenter(centre);
  object.position.sub(centre);
  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.scale.setScalar(size / (dims[axis] || 1));
  return wrapper;
}

const BLOCKOUT_COLORS: Record<PropKind, string> = {
  landingPad: '#f4f4f2',
  package: '#c9974f',
  aptSmall: '#f2938a',
  aptMedium: '#f5d76e',
  tower: '#b3a3ec',
  pylon: '#e8e8e6',
  antenna: '#dddddd',
  tree: '#8fd6a5',
  cloud: '#ffffff',
  waterTower: '#9cc8ef',
  crane: '#f5a25d',
  blimp: '#f6b8d0',
};

function blockout(kind: PropKind, size: number): THREE.Object3D {
  const material = new THREE.MeshStandardMaterial({
    color: BLOCKOUT_COLORS[kind],
    roughness: 0.85,
  });
  let mesh: THREE.Mesh;
  switch (kind) {
    case 'landingPad':
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(size / 2, size / 2, 0.16, 32), material);
      break;
    case 'package':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.8, size), material);
      break;
    case 'pylon':
    case 'antenna':
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.02, size * 0.035, size, 8), material);
      break;
    case 'tree':
      mesh = new THREE.Mesh(new THREE.SphereGeometry(size / 2, 12, 10), material);
      break;
    case 'cloud':
    case 'blimp':
      mesh = new THREE.Mesh(new THREE.SphereGeometry(size / 2, 12, 10), material);
      mesh.scale.set(1, 0.45, 0.55);
      break;
    case 'crane':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(size * 0.06, size, size * 0.06), material);
      break;
    default:
      mesh = new THREE.Mesh(new THREE.BoxGeometry(size * 0.45, size, size * 0.45), material);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
