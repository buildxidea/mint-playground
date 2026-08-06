import { Box3, Group, Object3D, Vector3 } from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { assertLoadable, getPackItemUrls } from "./registry";
import { REFERENCE_ARM_LENGTH, VEHICLE } from "../sim/config";

/**
 * Assembles the Mint drone parts into a rig the simulation can drive.
 *
 * The parts arrive normalized into roughly unit boxes centred on the origin,
 * so real scale has to be re-established here. `VEHICLE.motors` is the
 * authority for where the rotors are: the art is fitted to the physics, never
 * the other way round.
 *
 * Measured from the generated meshes (bounds via the shared loader):
 *
 *   fuselage      0.971 x 0.260 x 0.998, motor pads at mean radius 0.565
 *   propeller     0.998 x 0.131 x 0.873, disc flat in XZ, hub centred
 *   landing skid  0.514 x 0.998 x 0.857, long axis +Y
 *   camera pod    0.998 x 0.928 x 0.580
 *
 * The fuselage already includes its four arms and motor pads, so the pack's
 * standalone arm part is not used in the assembly — mounting it again would
 * duplicate every arm. It stays in the registry as part of the delivered pack.
 *
 * Note: the generated frame is a slightly "stretched X" (front arms a little
 * shorter than the rear), while the flight model uses a symmetric X. The
 * resulting offset is about 4% of the arm length — around a centimetre at this
 * scale — and is cosmetic only.
 */

/** Index of each item within the generated pack, in the order it was authored. */
const PART = {
  fuselage: 0,
  motorArm: 1,
  propeller: 2,
  landingSkid: 3,
  cameraPod: 4,
} as const;

/**
 * Every absolute dimension below was measured or tuned against the original
 * 5-inch racer. `SCALE` carries them to whatever airframe `VEHICLE.armLength`
 * currently specifies, so resizing the drone in `sim/config.ts` is the only
 * edit needed — nothing here goes stale the way a second hardcoded copy would.
 */
const SCALE = VEHICLE.armLength / REFERENCE_ARM_LENGTH;

/**
 * Calibration table. Every number that positions generated art lives here, so
 * a visual correction is a one-line edit rather than a hunt through the rig.
 */
const FIT = {
  /** Normalized-unit radius of the fuselage's motor pads, measured. Intrinsic
   * to the generated mesh, not a physical size — not scaled. */
  fuselagePadRadius: 0.565,
  /** Propeller diameter, metres — a 5-inch prop on the reference airframe. */
  propellerDiameter: 0.127 * SCALE,
  /** Height of the rotor plane above the frame centre, metres. */
  propellerHeight: 0.035 * SCALE,
  /** Landing skid height, metres. */
  skidHeight: 0.05 * SCALE,
  /** Skid mounting height relative to the frame centre, metres. */
  skidOffsetY: -0.022 * SCALE,
  /** Camera pod width, metres. */
  podWidth: 0.035 * SCALE,
  /** Camera pod mount point, metres, in body coordinates. */
  podOffset: new Vector3(0, 0.004 * SCALE, -0.062 * SCALE),
} as const;

export interface DroneRig {
  /** Body root. Projected each frame from the canonical simulation state. */
  root: Group;
  /** The four propellers, in mixer order, spun from `state.motorAngle`. */
  propellers: Object3D[];
  /** Camera pod, used as the mount point for the onboard view. */
  gimbal: Object3D;
  /** Rotor plane diameter and height, metres — what the parts were actually
   * fitted to, for anything (prop blur, effects) that needs to match them
   * without re-deriving or duplicating the numbers. */
  propellerDiameter: number;
  propellerHeight: number;
  /**
   * Distance from the body origin down to the lowest point of the airframe,
   * metres. Measured from the assembled rig rather than assumed, so the
   * aircraft rests on its skids instead of floating above or sinking into the
   * pad when the fit table changes.
   */
  groundClearance: number;
  dispose(): void;
}

/** Uniformly scale and recentre a loaded part so a chosen axis measures `target`. */
function fitPart(object: Object3D, axis: "x" | "y" | "z", target: number) {
  const box = new Box3().setFromObject(object);
  const size = new Vector3();
  const centre = new Vector3();
  box.getSize(size);
  box.getCenter(centre);

  const extent = size[axis] || 1;
  const scale = target / extent;

  // Recentre first, in the part's own units, then scale the wrapper.
  object.position.sub(centre);

  const wrapper = new Group();
  wrapper.add(object);
  wrapper.scale.setScalar(scale);
  return wrapper;
}

export async function loadDroneRig(): Promise<DroneRig> {
  assertLoadable("drone-quad");

  const urls = getPackItemUrls("drone-quad");
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

  const root = new Group();

  // The fuselage sets the scale for everything: its pads must land on the
  // rotor positions the flight model uses.
  const fuselageScale = VEHICLE.armLength / FIT.fuselagePadRadius;
  const fuselageBox = new Box3().setFromObject(fuselageRaw);
  const fuselageCentre = new Vector3();
  fuselageBox.getCenter(fuselageCentre);
  fuselageRaw.position.sub(fuselageCentre);
  const fuselage = new Group();
  fuselage.add(fuselageRaw);
  fuselage.scale.setScalar(fuselageScale);
  root.add(fuselage);

  const propellers: Object3D[] = [];
  for (let i = 0; i < 4; i += 1) {
    const motor = VEHICLE.motors[i];

    const propeller = fitPart(
      i === 0 ? propellerRaw : propellerRaw.clone(true),
      "x",
      FIT.propellerDiameter,
    );
    propeller.position.set(motor.x, FIT.propellerHeight, motor.z);
    root.add(propeller);
    propellers.push(propeller);

    const skid = fitPart(skidRaw.clone(true), "y", FIT.skidHeight);
    skid.position.set(
      motor.x * 0.72,
      FIT.skidOffsetY - FIT.skidHeight / 2,
      motor.z * 0.72,
    );
    root.add(skid);
  }

  const gimbal = fitPart(podRaw, "x", FIT.podWidth);
  gimbal.position.copy(FIT.podOffset);
  root.add(gimbal);

  const assembled = new Box3().setFromObject(root);
  const groundClearance = Math.max(0, -assembled.min.y);

  return {
    root,
    propellers,
    gimbal,
    propellerDiameter: FIT.propellerDiameter,
    propellerHeight: FIT.propellerHeight,
    groundClearance,
    dispose() {
      root.traverse((child) => {
        const mesh = child as Partial<{
          geometry: { dispose(): void };
          material: unknown;
        }>;
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
