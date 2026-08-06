import { Box3, Group, Object3D, Vector3 } from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { assertLoadable, getModelUrl } from "./registry";

/**
 * Assembles the Mint stainless-steel starship.
 *
 * A single part, unlike the shuttle-style stack: this vehicle has no strap-on
 * boosters, which is the whole reason it flies differently. Everything it
 * needs is in one mesh, and nothing on it moves.
 *
 * Measured from the generated mesh, before any fitting:
 *
 *   bbox     0.350 x 0.998 x 0.299 normalized — long axis Y, standing upright
 *            as asked.
 *   profile  radial extent from the bottom up runs 0.188, 0.188, 0.121, 0.109,
 *            …, 0.156, 0.082 — widest at the base where the two large aft
 *            flaps are, narrowing through the barrel, and closing to a point
 *            at the top. The nose is at +Y, the same convention as the launch
 *            stack's parts, and is tipped here to the sim's nose = -Z.
 *
 * Body axes match the rest of the project: nose is -Z, thrust along the nose,
 * exhaust out +Z. A vehicle on the pad is an airframe pitched ninety degrees
 * nose-up, which is what lets the cameras, the ground constraint and the crash
 * policy work on it without knowing it is a rocket.
 */

/** Fitted height of the vehicle, metres — taller than the shuttle stack. */
const DESIGN_HEIGHT = 13;

export interface StarshipRig {
  root: Group;
  fpvMount: Object3D;
  /** Body-origin height above ground when standing on the pad, metres. */
  groundClearance: number;
  collisionHalfExtents: [number, number, number];
  /** Engine nozzles at the base, body coordinates. */
  nozzles: Vector3[];
  /** Overall length, metres — nose to nozzle. */
  length: number;
  dispose(): void;
}

export async function loadStarshipRig(): Promise<StarshipRig> {
  assertLoadable("starship");

  const url = getModelUrl("starship");
  if (!url) throw new Error("starship model is not registered in mint-assets.json");

  const loader = createMintGltfLoader();
  const gltf = await loader.loadAsync(url);
  const raw = gltf.scene;
  raw.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });

  const root = new Group();

  const box = new Box3().setFromObject(raw);
  const size = new Vector3();
  const centre = new Vector3();
  box.getSize(size);
  box.getCenter(centre);
  raw.position.sub(centre);

  const inner = new Group();
  inner.add(raw);
  inner.scale.setScalar(DESIGN_HEIGHT / (size.y || 1));

  const hull = new Group();
  hull.add(inner);
  // Long axis Y with the nose at +Y; the sim flies nose -Z.
  hull.rotation.x = -Math.PI / 2;
  root.add(hull);

  const assembled = new Box3().setFromObject(hull);
  const assembledSize = new Vector3();
  assembled.getSize(assembledSize);
  const base = assembledSize.z / 2;

  // Three engines clustered at the base, spread across the barrel rather than
  // the flap span — the flaps are what make the bounding box wide.
  const spread = assembledSize.x * 0.11;
  const nozzles = [
    new Vector3(0, spread, base),
    new Vector3(spread, -spread * 0.6, base),
    new Vector3(-spread, -spread * 0.6, base),
  ];

  const fpvMount = new Group();
  // Just below the nose, on the spine.
  fpvMount.position.set(0, assembledSize.y * 0.18, -base + 1.4);
  root.add(fpvMount);

  return {
    root,
    fpvMount,
    nozzles,
    length: assembledSize.z,

    // Standing on the pad the vehicle is pitched ninety degrees nose-up, so
    // the drop from the body origin to the ground is half its *length*.
    groundClearance: assembledSize.z / 2,

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
