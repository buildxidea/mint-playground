import { Box3, Group, Object3D, Vector3 } from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { assertLoadable, getModelUrl } from "./registry";
import { BOMBER } from "../sim/airplane";

/**
 * Assembles the Mint stealth flying wing.
 *
 * The simplest rig in the project, and deliberately so. There is no propeller,
 * no rotor, no landing gear and no afterburner: the engines are buried and the
 * exhausts are slots on the upper surface, which is the entire design point of
 * the aircraft. Nothing about it moves, so unlike every other airframe here it
 * needs no per-frame update at all.
 *
 * Measured from the generated mesh, before any fitting:
 *
 *   bbox          0.998 x 0.072 x 0.404 normalized — span along X, and only
 *                 7% as thick as it is wide.
 *   planform      cross-span width along Z runs 0.25 → 0.88 → 1.00 → 0.54 →
 *                 0.25 → 0.20 → 0.25 → 0.06 → 0.00. The single point at +Z is
 *                 the nose apex and the widest station is 0.28 behind it, so
 *                 the leading edge sweeps back to wingtips that sit aft — a
 *                 flying-wing planform, nose pointing +Z like the jet and the
 *                 bush plane, and flipped here to the sim's nose = -Z.
 *   centre body   height peaks at 0.036 at mid-span and falls to roughly zero
 *                 at both tips, so the bulge is central and the canopy sits
 *                 just forward of it, which is where the camera mount goes.
 *
 * Scale comes from `BOMBER.span`, as with every other aircraft: the flight
 * model's roll and yaw moment arms are derived from the span, so matching the
 * art to it keeps the aircraft you see and the one you fly the same size.
 * Length falls out at 1.05 m, giving the 2.5:1 span-to-length ratio the real
 * aircraft has.
 */

const FIT = {
  /** Onboard camera mount: under the canopy, just forward of the peak. */
  fpvOffset: new Vector3(0, 0.05, -0.22),
} as const;

export interface BomberRig {
  root: Group;
  fpvMount: Object3D;
  /** Body-origin height above ground resting on its belly, metres. */
  groundClearance: number;
  /** Collision box half-extents measured from the fitted airframe, metres. */
  collisionHalfExtents: [number, number, number];
  dispose(): void;
}

export async function loadBomberRig(): Promise<BomberRig> {
  assertLoadable("bomber");

  const url = getModelUrl("bomber");
  if (!url) throw new Error("bomber model is not registered in mint-assets.json");

  const loader = createMintGltfLoader();
  const gltf = await loader.loadAsync(url);
  const airframeRaw = gltf.scene;
  airframeRaw.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });

  const root = new Group();

  const box = new Box3().setFromObject(airframeRaw);
  const size = new Vector3();
  const centre = new Vector3();
  box.getSize(size);
  box.getCenter(centre);
  airframeRaw.position.sub(centre);

  const airframe = new Group();
  airframe.add(airframeRaw);
  airframe.scale.setScalar(BOMBER.span / (size.x || 1));
  // Generated nose points +Z; the simulation flies nose -Z.
  airframe.rotation.y = Math.PI;
  root.add(airframe);

  const fpvMount = new Group();
  fpvMount.position.copy(FIT.fpvOffset);
  root.add(fpvMount);

  const assembled = new Box3().setFromObject(airframe);
  const assembledSize = new Vector3();
  assembled.getSize(assembledSize);

  return {
    root,
    fpvMount,
    groundClearance: Math.max(0, -assembled.min.y),
    collisionHalfExtents: [
      assembledSize.x / 2,
      assembledSize.y / 2,
      assembledSize.z / 2,
    ],

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
