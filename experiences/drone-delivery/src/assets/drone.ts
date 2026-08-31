import * as THREE from 'three';
import { createMintGltfLoader } from './gltf-runtime';
import { assertLoadable, getPackItemUrls } from './registry';
import { ARM_LENGTH, MOTORS, REFERENCE_ARM_LENGTH } from '../sim/config';

/**
 * Assembles the Mint drone parts into a rig the game can drive. Carried over
 * from the source quadrotor sandbox: the parts arrive normalized into roughly
 * unit boxes centred on the origin, so real scale is re-established here, and
 * `MOTORS` is the authority for where the rotors are — the art is fitted to
 * the flight model, never the other way round.
 *
 * The fuselage already includes its four arms and motor pads, so the pack's
 * standalone arm part (index 1) is not mounted — doing so would duplicate
 * every arm.
 */

const PART = {
  fuselage: 0,
  motorArm: 1,
  propeller: 2,
  landingSkid: 3,
  cameraPod: 4,
} as const;

const SCALE = ARM_LENGTH / REFERENCE_ARM_LENGTH;

/** Calibration table measured against the generated meshes. */
const FIT = {
  /** Normalized-unit radius of the fuselage's motor pads (intrinsic, unscaled). */
  fuselagePadRadius: 0.565,
  propellerDiameter: 0.127 * SCALE,
  propellerHeight: 0.035 * SCALE,
  skidHeight: 0.05 * SCALE,
  skidOffsetY: -0.022 * SCALE,
  podWidth: 0.035 * SCALE,
  podOffset: new THREE.Vector3(0, 0.004 * SCALE, -0.062 * SCALE),
} as const;

export interface DroneRig {
  root: THREE.Group;
  propellers: THREE.Object3D[];
  gimbal: THREE.Object3D;
  propellerDiameter: number;
  groundClearance: number;
  /** Tint the livery accent color on the airframe. */
  setLivery(accent: THREE.Color): void;
  dispose(): void;
}

function fitPart(object: THREE.Object3D, axis: 'x' | 'y' | 'z', target: number): THREE.Group {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  const extent = size[axis] || 1;
  const scale = target / extent;

  object.position.sub(centre);
  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.scale.setScalar(scale);
  return wrapper;
}

export async function loadDroneRig(): Promise<DroneRig> {
  assertLoadable('drone-quad');

  const urls = getPackItemUrls('drone-quad');
  if (urls.length <= PART.cameraPod) {
    throw new Error(
      `drone-quad is missing pack items: expected ${PART.cameraPod + 1}, found ${urls.length}`,
    );
  }

  const loader = createMintGltfLoader();
  const load = async (index: number) => {
    const gltf = await loader.loadAsync(urls[index]);
    gltf.scene.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return gltf.scene;
  };

  const [fuselageRaw, propellerRaw, skidRaw, podRaw] = await Promise.all([
    load(PART.fuselage),
    load(PART.propeller),
    load(PART.landingSkid),
    load(PART.cameraPod),
  ]);

  const root = new THREE.Group();

  // The fuselage sets the scale: its pads must land on the rotor positions.
  const fuselageScale = ARM_LENGTH / FIT.fuselagePadRadius;
  const fuselageBox = new THREE.Box3().setFromObject(fuselageRaw);
  const fuselageCentre = new THREE.Vector3();
  fuselageBox.getCenter(fuselageCentre);
  fuselageRaw.position.sub(fuselageCentre);
  const fuselage = new THREE.Group();
  fuselage.add(fuselageRaw);
  fuselage.scale.setScalar(fuselageScale);
  root.add(fuselage);

  const propellers: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i += 1) {
    const motor = MOTORS[i];

    const propeller = fitPart(
      i === 0 ? propellerRaw : propellerRaw.clone(true),
      'x',
      FIT.propellerDiameter,
    );
    propeller.position.set(motor.x, FIT.propellerHeight, motor.z);
    root.add(propeller);
    propellers.push(propeller);

    const skid = fitPart(skidRaw.clone(true), 'y', FIT.skidHeight);
    skid.position.set(motor.x * 0.72, FIT.skidOffsetY - FIT.skidHeight / 2, motor.z * 0.72);
    root.add(skid);
  }

  const gimbal = fitPart(podRaw, 'x', FIT.podWidth);
  gimbal.position.copy(FIT.podOffset);
  root.add(gimbal);

  const assembled = new THREE.Box3().setFromObject(root);
  const groundClearance = Math.max(0, -assembled.min.y);

  // Livery tinting: clone the fuselage materials once so each drone color is
  // a cheap uniform edit, leaving the authored maps untouched.
  const tintTargets: THREE.MeshStandardMaterial[] = [];
  const cloneForTint = (m: THREE.Material) => {
    const clone = (m as THREE.MeshStandardMaterial).clone();
    tintTargets.push(clone);
    return clone;
  };
  fuselage.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Keep single materials single: an array material on ungrouped geometry
    // renders nothing.
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(cloneForTint)
      : cloneForTint(mesh.material);
  });

  return {
    root,
    propellers,
    gimbal,
    propellerDiameter: FIT.propellerDiameter,
    groundClearance,
    setLivery(accent: THREE.Color) {
      for (const material of tintTargets) {
        material.color.copy(accent).lerp(new THREE.Color('#ffffff'), 0.35);
      }
    },
    dispose() {
      root.traverse((child) => {
        const mesh = child as Partial<{ geometry: { dispose(): void }; material: unknown }>;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
          for (const m of material) (m as { dispose(): void }).dispose();
        } else if (material) {
          (material as { dispose(): void }).dispose();
        }
      });
      root.clear();
    },
  };
}
