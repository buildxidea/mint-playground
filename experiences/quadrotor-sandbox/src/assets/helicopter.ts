import {
  AdditiveBlending,
  Box3,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { assertLoadable, getPackItemUrls } from "./registry";
import { VEHICLE } from "../sim/config";
import type { DroneState } from "../sim/state";

/**
 * Assembles the Mint helicopter parts into a rig.
 *
 * The helicopter flies on the *quadrotor's* flight model and PID cascade,
 * unchanged — it is a different airframe wearing the same controls, which is
 * what was asked for, and it means one tuned controller instead of two to
 * keep in sync. Nothing in this file touches dynamics; it only projects the
 * canonical state onto geometry.
 *
 * Everything below was measured from the generated meshes, and every one of
 * the three obvious assumptions turned out to be wrong, so none of it is
 * guessed:
 *
 *   fuselage    0.385 x 0.549 x 0.998 normalized, long axis Z. The cabin's
 *               geometry is concentrated in the +Z fifths (2513/1990 vertices
 *               vs 825/155 at the tail), so the generated nose points +Z and
 *               the wrapper flips it 180 degrees to the sim's nose = -Z.
 *   main rotor  spin axis Z, disc plane XY (rms spread 0.088/0.091/0.055) —
 *               *not* the flat-in-XZ layout the prompt asked for. Its blades
 *               also lie on a diagonal within that plane, so it is scaled by
 *               measured tip radius rather than by a bounding-box axis, which
 *               would have come out ~40% small.
 *   tail rotor  spin axis Y, disc plane XZ (rms 0.198/0.036/0.084), as asked.
 *
 * Each rotor therefore gets a mount wrapper that turns its own spin axis into
 * the axis the aircraft needs, and spins about its own local axis inside it.
 */

const PART = { fuselage: 0, mainRotor: 1, tailRotor: 2 } as const;

/** Calibration table — every number that positions generated art. */
const FIT = {
  /** Fuselage length nose-to-tail, metres. Sets the rig's overall scale. */
  fuselageLength: 1.15,
  /** Main rotor disc diameter, metres. */
  mainRotorDiameter: 1.3,
  /** Rotor plane height above the body origin — measured mast top is 0.307. */
  mainRotorHeight: 0.31,
  /** Tail rotor disc diameter, metres. */
  tailRotorDiameter: 0.26,
  /**
   * Tail rotor hub in body coordinates. Z from the measured tail end (+0.575
   * after the flip, pulled slightly inboard); X and Y placed on the boom's
   * side and centreline by eye — the one part of this table not derived from
   * a measurement, and the first thing to nudge if it looks off.
   */
  tailRotorOffset: new Vector3(0.045, 0.06, 0.54),
  /** Onboard camera: in the cabin, looking out over the nose. */
  fpvOffset: new Vector3(0, 0.05, -0.3),
} as const;

/** Rotor speed at which the blur disc is fully opaque, as a fraction of max. */
const FULL_BLUR = 0.5;
const PEAK_OPACITY = 0.26;

export interface HelicopterRig {
  root: Group;
  mainRotor: Object3D;
  tailRotor: Object3D;
  fpvMount: Object3D;
  /** Body-origin height above ground when resting on its skids, metres. */
  groundClearance: number;
  /** Collision box half-extents measured from the assembled rig, metres. */
  collisionHalfExtents: [number, number, number];
  /** Project rotor spin and blur from the canonical state. */
  update(state: DroneState): void;
  dispose(): void;
}

/** Scale and recentre a part so a chosen bounding-box axis measures `target`. */
function fitByAxis(object: Object3D, axis: "x" | "y" | "z", target: number) {
  const box = new Box3().setFromObject(object);
  const size = new Vector3();
  const centre = new Vector3();
  box.getSize(size);
  box.getCenter(centre);
  object.position.sub(centre);

  const wrapper = new Group();
  wrapper.add(object);
  wrapper.scale.setScalar(target / (size[axis] || 1));
  return wrapper;
}

/**
 * Scale a rotor so its swept disc measures `diameter`, using the farthest
 * vertex from the hub. A bounding-box axis is the wrong ruler for a rotor
 * whose blades sit on a diagonal: the main rotor's tips reach 0.717 while its
 * widest box axis is 0.998, so fitting by the box would undersize it badly.
 * The hub is left at the object's origin, which is where the parts put it.
 */
function fitRotorByRadius(object: Object3D, diameter: number) {
  const vertex = new Vector3();
  let radius = 0;
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      radius = Math.max(radius, vertex.length());
    }
  });

  const wrapper = new Group();
  wrapper.add(object);
  wrapper.scale.setScalar(radius > 0 ? diameter / (2 * radius) : 1);
  return wrapper;
}

export async function loadHelicopterRig(): Promise<HelicopterRig> {
  assertLoadable("helicopter");

  const urls = getPackItemUrls("helicopter");
  if (urls.length <= PART.tailRotor) {
    throw new Error(
      `helicopter is missing pack items: expected ${PART.tailRotor + 1}, found ${urls.length}`,
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

  const [fuselageRaw, mainRaw, tailRaw] = await Promise.all([
    load(PART.fuselage),
    load(PART.mainRotor),
    load(PART.tailRotor),
  ]);

  const root = new Group();

  // Fuselage: long axis is nose-to-tail, and the generated nose points +Z, so
  // the wrapper turns it to face -Z.
  const fuselage = fitByAxis(fuselageRaw, "z", FIT.fuselageLength);
  fuselage.rotation.y = Math.PI;
  root.add(fuselage);

  // Main rotor: its disc lies in XY and it spins about its own Z, so the mount
  // lays that Z over onto the aircraft's +Y.
  const mainRotor = fitRotorByRadius(mainRaw, FIT.mainRotorDiameter);
  const mainMount = new Group();
  mainMount.rotation.x = -Math.PI / 2;
  mainMount.position.set(0, FIT.mainRotorHeight, 0);
  mainMount.add(mainRotor);
  root.add(mainMount);

  // Main rotor blur: a separate translucent disc, never a change to the
  // generated blades' materials. Two blades at speed read as a disc, and
  // without this they strobe badly at any frame rate.
  const blurDisc = new Mesh(
    new CircleGeometry(FIT.mainRotorDiameter / 2, 48),
    new MeshBasicMaterial({
      color: 0xb9c6cf,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  blurDisc.rotation.x = -Math.PI / 2;
  blurDisc.position.set(0, FIT.mainRotorHeight + 0.004, 0);
  root.add(blurDisc);

  // Tail rotor: disc already lies in XZ spinning about its own Y, so the mount
  // only has to tip that Y over to the lateral axis.
  const tailRotor = fitRotorByRadius(tailRaw, FIT.tailRotorDiameter);
  const tailMount = new Group();
  tailMount.rotation.z = Math.PI / 2;
  tailMount.position.copy(FIT.tailRotorOffset);
  tailMount.add(tailRotor);
  root.add(tailMount);

  const fpvMount = new Group();
  fpvMount.position.copy(FIT.fpvOffset);
  root.add(fpvMount);

  const assembled = new Box3().setFromObject(root);
  const size = new Vector3();
  assembled.getSize(size);
  const groundClearance = Math.max(0, -assembled.min.y);

  const blurMaterial = blurDisc.material as MeshBasicMaterial;

  return {
    root,
    mainRotor,
    tailRotor,
    fpvMount,
    groundClearance,
    collisionHalfExtents: [size.x / 2, size.y / 2, size.z / 2],

    update(state) {
      // The multirotor model fills all four rotor slots identically; the
      // helicopter reads slot 0 for the main rotor and gears the tail rotor
      // up from it, as a real tail rotor is driven off the same engine.
      const angle = state.motorAngle[0];
      // Each rotor turns about its own axis *inside* its mount: the main
      // rotor's is Z, the tail rotor's is Y.
      mainRotor.rotation.z = angle;
      tailRotor.rotation.y = angle * 4.2;

      const fraction = state.motorOmega[0] / VEHICLE.maxRotorOmega;
      const blur = Math.min(1, fraction / FULL_BLUR);
      blurMaterial.opacity = blur * blur * PEAK_OPACITY;
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
