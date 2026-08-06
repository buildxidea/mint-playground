import {
  AdditiveBlending,
  Box3,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { assertLoadable, getPackItemUrls } from "./registry";
import { PLANE } from "../sim/airplane";
import type { DroneState } from "../sim/state";

/**
 * Assembles the Mint bush-plane parts into a rig the fixed-wing model drives.
 *
 * Measured from the generated meshes (shared loader, node-side):
 *
 *   airframe   0.998 x 0.271 x 0.736 normalized — wingspan along X.
 *              The tall tail fin sits at the -Z end (max Y in the rear fifth
 *              is 0.136 vs 0.056 at the other end), so the generated nose
 *              points +Z and the wrapper flips it 180° to match the sim's
 *              nose = -Z convention. Detected from the geometry, not assumed
 *              from the generation prompt.
 *   propeller  0.998 x 0.127 x 0.330 — blades along X, spinner up (+Y).
 *              Mounted rotated -90° about X so the spinner faces the nose,
 *              with the spin applied on the inner object's Y axis, which the
 *              mount carries onto the aircraft's roll axis.
 *
 * `PLANE.span` (sim config) is the authority for scale, exactly as the quad's
 * rotor positions are authoritative for its parts.
 */

const PART = { airframe: 0, propeller: 1 } as const;

/**
 * Prop speed past which the blade is drawn as a disc instead of as a blade.
 *
 * This is a sampling limit, not a taste call. A two-blade prop looks identical
 * to itself every half turn, so a frame-sampled blade only reads as genuinely
 * rotating while it advances less than a quarter of that per frame — π/2 rad
 * at 60 Hz, about 94 rad/s. Past it the blade aliases into a slow or backwards
 * crawl, which is what a real propeller never does and what the disc exists to
 * replace. At `PLANE.maxPropOmega` of 900 that threshold is ~10% throttle, so
 * anything above idle reads as a disc — which is also what a real prop does.
 */
const DISC_OMEGA = (Math.PI / 2) * 60;
const PEAK_OPACITY = 0.3;

/** Calibration table — every number that positions generated art. */
const FIT = {
  /** Propeller disc diameter, metres. */
  propellerDiameter: 0.34,
  /** Prop mount in body coordinates: just ahead of the cowl. Nose is -Z. */
  propellerOffset: new Vector3(0, 0.015, -0.69),
  /** Onboard camera: cockpit, above the panel, looking past the nose. */
  fpvOffset: new Vector3(0, 0.14, -0.18),
} as const;

export interface PlaneRig {
  root: Group;
  /** Spin this about its local Y by the accumulated prop angle. */
  propeller: Object3D;
  /** Project prop spin and blur from the canonical state. */
  update(state: DroneState): void;
  /** Mount point for the onboard camera. */
  fpvMount: Object3D;
  /** Body-origin height above ground when resting on its wheels, metres. */
  groundClearance: number;
  dispose(): void;
}

export async function loadPlaneRig(): Promise<PlaneRig> {
  assertLoadable("bush-plane");

  const urls = getPackItemUrls("bush-plane");
  if (urls.length <= PART.propeller) {
    throw new Error(
      `bush-plane is missing pack items: expected ${PART.propeller + 1}, found ${urls.length}`,
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

  const [airframeRaw, propellerRaw] = await Promise.all([
    load(PART.airframe),
    load(PART.propeller),
  ]);

  const root = new Group();

  // Airframe: recentre, scale so the wingspan matches the flight model, and
  // flip nose-forward.
  const frameBox = new Box3().setFromObject(airframeRaw);
  const frameSize = new Vector3();
  const frameCentre = new Vector3();
  frameBox.getSize(frameSize);
  frameBox.getCenter(frameCentre);
  airframeRaw.position.sub(frameCentre);

  const airframe = new Group();
  airframe.add(airframeRaw);
  airframe.scale.setScalar(PLANE.span / (frameSize.x || 1));
  airframe.rotation.y = Math.PI;
  root.add(airframe);

  // Propeller: scale to disc diameter, then aim the spinner down the nose.
  const propBox = new Box3().setFromObject(propellerRaw);
  const propSize = new Vector3();
  const propCentre = new Vector3();
  propBox.getSize(propSize);
  propBox.getCenter(propCentre);
  propellerRaw.position.sub(propCentre);

  const spinner = new Group();
  spinner.add(propellerRaw);
  spinner.scale.setScalar(FIT.propellerDiameter / (propSize.x || 1));

  const propellerMount = new Group();
  propellerMount.add(spinner);
  propellerMount.rotation.x = -Math.PI / 2;
  propellerMount.position.copy(FIT.propellerOffset);
  root.add(propellerMount);

  // Prop blur: a separate translucent disc, never a change to the generated
  // blade's material. Double-sided, because unlike the quad's and the
  // helicopter's discs this one is looked at from behind — the cockpit camera
  // sits 0.5 m aft of it.
  const blurDisc = new Mesh(
    new CircleGeometry(FIT.propellerDiameter / 2, 48),
    new MeshBasicMaterial({
      color: 0xb9c6cf,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    }),
  );
  // A few millimetres aft of the blades, so the two never z-fight.
  blurDisc.position.set(
    FIT.propellerOffset.x,
    FIT.propellerOffset.y,
    FIT.propellerOffset.z + 0.006,
  );
  root.add(blurDisc);

  const fpvMount = new Group();
  fpvMount.position.copy(FIT.fpvOffset);
  root.add(fpvMount);

  const assembled = new Box3().setFromObject(root);
  const groundClearance = Math.max(0, -assembled.min.y);

  return {
    root,
    propeller: spinner,
    update(state) {
      spinner.rotation.y = state.motorAngle[0];
      const omega = state.motorOmega[0];
      const blur = Math.min(1, omega / DISC_OMEGA);
      (blurDisc.material as MeshBasicMaterial).opacity = blur * blur * PEAK_OPACITY;
      // The disc reaches full strength exactly as the blade stops being
      // trustworthy, so there is never a frame with neither one carrying the
      // read.
      spinner.visible = omega < DISC_OMEGA;
    },
    fpvMount,
    groundClearance,
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
