import { Box3, Group, Object3D, Vector3 } from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { assertLoadable, getModelUrl } from "./registry";
import { JET } from "../sim/airplane";
import { createAfterburners, type Afterburners } from "../fx/afterburner";
import type { DroneState } from "../sim/state";

/**
 * Assembles the Mint supersonic jet and its afterburner plumes.
 *
 * One generated part, unlike the other aircraft: this airframe has no moving
 * geometry — no propeller, no rotors, and the landing gear is retracted, so
 * there is nothing to articulate. The only animation is the exhaust, and that
 * is built from geometry in `fx/afterburner.ts` rather than generated,
 * because it has to lengthen and flicker with the throttle every frame.
 *
 * Measured from the generated mesh:
 *
 *   bbox        0.705 x 0.170 x 0.998 normalized — long axis Z.
 *   nose        at +Z: cross-section tapers from 0.35 half-width at low Z to
 *               0.03 at high Z, so the needle points +Z and the wrapper flips
 *               it to the sim's nose = -Z.
 *   nozzles     the rearmost 8% of the mesh splits into two clusters at
 *               x = +/-0.31 m, y = -0.095 m, z = +1.075 m in body coordinates
 *               once fitted and flipped. The plumes mount there.
 *
 * Scale is set by *wingspan*, not length: `JET.span` is what the flight model
 * uses for its roll and yaw moment arms, so matching the visual to it keeps
 * the aircraft you see and the aircraft you fly the same size. Length falls
 * out at 2.26 m.
 */

const FIT = {
  /** Nozzle positions in body coordinates, metres — measured, see above. */
  nozzles: [new Vector3(0.31, -0.095, 1.075), new Vector3(-0.31, -0.095, 1.075)],
  /** Onboard camera: the forward cockpit, on the spine. */
  fpvOffset: new Vector3(0, 0.06, -0.55),
} as const;

export interface JetRig {
  root: Group;
  fpvMount: Object3D;
  /** Body-origin height above ground with the gear up, metres. */
  groundClearance: number;
  /** Collision box half-extents measured from the fitted airframe, metres. */
  collisionHalfExtents: [number, number, number];
  /** Advance the afterburners from the canonical state. */
  update(state: DroneState, dt: number): void;
  dispose(): void;
}

export async function loadJetRig(): Promise<JetRig> {
  assertLoadable("jet");

  const url = getModelUrl("jet");
  if (!url) throw new Error("jet model is not registered in mint-assets.json");

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
  airframe.scale.setScalar(JET.span / (size.x || 1));
  // Generated nose points +Z; the simulation flies nose -Z.
  airframe.rotation.y = Math.PI;
  root.add(airframe);

  const fpvMount = new Group();
  fpvMount.position.copy(FIT.fpvOffset);
  root.add(fpvMount);

  // Measure the airframe *before* the plumes exist. Exhaust is not a solid
  // part of the aircraft, and at full throttle it reaches 2.6 m aft — folding
  // that into the collision box would have the jet colliding with its own
  // flames trailing behind it.
  const assembled = new Box3().setFromObject(airframe);
  const assembledSize = new Vector3();
  assembled.getSize(assembledSize);

  const afterburners: Afterburners = createAfterburners(root, [...FIT.nozzles]);

  return {
    root,
    fpvMount,
    groundClearance: Math.max(0, -assembled.min.y),
    collisionHalfExtents: [
      assembledSize.x / 2,
      assembledSize.y / 2,
      assembledSize.z / 2,
    ],

    update(state, dt) {
      afterburners.update(state, dt);
    },

    dispose() {
      afterburners.dispose();
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
