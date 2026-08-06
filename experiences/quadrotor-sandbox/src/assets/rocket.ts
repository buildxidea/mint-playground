import { Box3, Group, Object3D, Vector3 } from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { assertLoadable, getPackItemUrls } from "./registry";

/**
 * Assembles the Mint launch-stack parts into a rocket.
 *
 * Three generated parts — orbiter, propellant tank, booster — with the booster
 * loaded once and placed twice. They are separate models specifically so the
 * boosters can be jettisoned in flight; a single-mesh stack could not shed
 * anything.
 *
 * Measured from the generated meshes, before any fitting:
 *
 *   orbiter   0.666 x 0.998 x 0.443 normalized, long axis Y. Radial extent
 *             from the bottom up runs 0.275, 0.37, 0.342, 0.241, 0.206, 0.22,
 *             0.222, 0.211 — widest a fifth of the way up, which is the wing,
 *             and narrowing toward the top, which is the nose. It stands
 *             nose-up as asked.
 *   tank      0.182 x 0.998 x 0.209, radius a constant 0.107 tapering to 0.082
 *             at the top: the ogive nose cone, also up.
 *   booster   0.096 x 0.998 x 0.096, radius a flat 0.047 the whole way. A
 *             1:10 cylinder — more slender than the 1:7 asked for, and it
 *             reads better on the stack for it.
 *
 * Every part came back normalized to the same 0.998 height, so the stack's
 * proportions do not exist in the assets at all — they are built here, by
 * fitting each part to a design height and then placing the others from the
 * *measured* result rather than from a table of guessed offsets.
 *
 * Body axes match the rest of the project: nose is -Z. The parts model their
 * long axis as Y, so each is tipped -90° about X to bring its nose to -Z. That
 * makes a rocket on the pad an airframe pitched ninety degrees nose-up, which
 * is what lets the cameras, the ground constraint and the crash policy work on
 * it without knowing it is a rocket.
 */

const PART = { orbiter: 0, tank: 1, booster: 2 } as const;

/** Design heights of the fitted parts, metres. The tank is the spine. */
const FIT = {
  tankHeight: 12,
  boosterHeight: 11.6,
  orbiterLength: 9.5,
  /** Gap between the tank's flank and a booster, metres. */
  boosterGap: 0.06,
  /** How deeply the orbiter nestles against the tank, as a fraction of its
   * own half-thickness. Below 1 it overlaps rather than floating alongside. */
  orbiterHug: 0.55,
} as const;

export interface RocketRig {
  root: Group;
  /** Camera mount, high on the stack looking along the nose. */
  fpvMount: Object3D;
  /** Body-origin height above ground when standing on the pad, metres. */
  groundClearance: number;
  /** Collision box half-extents measured from the assembled stack, metres. */
  collisionHalfExtents: [number, number, number];
  /** Orbiter main-engine nozzles, body coordinates. */
  coreNozzles: Vector3[];
  /** Booster nozzles, body coordinates. Empty once they are jettisoned. */
  boosterNozzles: Vector3[];
  /** Overall stack length, metres — nose to nozzle. */
  length: number;
  /**
   * Drop the boosters from the stack. Returns the world transforms they were
   * at, so the caller can leave falling debris behind if it wants to.
   */
  jettison(): void;
  /** Put the boosters back. Called from the pilot's reset. */
  restore(): void;
  dispose(): void;
}

/** Fit a part so its long (Y) axis measures `height`, recentred on its own
 * bounds, and tipped so its nose points along body -Z. */
function fitUpright(raw: Object3D, height: number): { group: Group; size: Vector3 } {
  const box = new Box3().setFromObject(raw);
  const size = new Vector3();
  const centre = new Vector3();
  box.getSize(size);
  box.getCenter(centre);
  raw.position.sub(centre);

  const inner = new Group();
  inner.add(raw);
  inner.scale.setScalar(height / (size.y || 1));

  const group = new Group();
  group.add(inner);
  // Long axis Y with the nose at +Y; the sim flies nose -Z.
  group.rotation.x = -Math.PI / 2;

  const fitted = new Vector3();
  new Box3().setFromObject(group).getSize(fitted);
  return { group, size: fitted };
}

export async function loadRocketRig(): Promise<RocketRig> {
  assertLoadable("launch-stack");

  const urls = getPackItemUrls("launch-stack");
  if (urls.length <= PART.booster) {
    throw new Error(
      `launch-stack is missing pack items: expected ${PART.booster + 1}, found ${urls.length}`,
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

  const [orbiterRaw, tankRaw, boosterRaw] = await Promise.all([
    load(PART.orbiter),
    load(PART.tank),
    load(PART.booster),
  ]);

  const root = new Group();

  // --- Tank: the spine everything else is placed against --------------------
  const tank = fitUpright(tankRaw, FIT.tankHeight);
  root.add(tank.group);
  // Base of the stack, body +Z, since the nose is -Z.
  const stackBase = tank.size.z / 2;

  // --- Boosters: one loaded model, placed twice -----------------------------
  const boosterGroup = new Group();
  const boosterNozzles: Vector3[] = [];
  const boosterSizes: Vector3[] = [];
  for (let i = 0; i < 2; i += 1) {
    const source = i === 0 ? boosterRaw : boosterRaw.clone(true);
    const booster = fitUpright(source, FIT.boosterHeight);
    const x = (i === 0 ? 1 : -1) * (tank.size.x / 2 + booster.size.x / 2 + FIT.boosterGap);
    // Bases flush with the tank's, so the stack sits flat on the pad.
    booster.group.position.set(x, 0, stackBase - booster.size.z / 2);
    boosterGroup.add(booster.group);
    boosterSizes.push(booster.size);
    boosterNozzles.push(new Vector3(x, 0, stackBase));
  }
  root.add(boosterGroup);

  // --- Orbiter: riding the tank's flank -------------------------------------
  const orbiter = fitUpright(orbiterRaw, FIT.orbiterLength);
  const orbiterY = tank.size.y / 2 + (orbiter.size.y / 2) * FIT.orbiterHug;
  // Tail near the base of the stack, nose partway up it.
  const orbiterZ = stackBase - orbiter.size.z / 2 - 0.3;
  orbiter.group.position.set(0, orbiterY, orbiterZ);
  root.add(orbiter.group);

  // Three main engines clustered at the orbiter's tail, in its own width.
  const tailZ = orbiterZ + orbiter.size.z / 2;
  const spread = orbiter.size.x * 0.1;
  const coreNozzles = [
    new Vector3(0, orbiterY + orbiter.size.y * 0.12, tailZ),
    new Vector3(spread, orbiterY - orbiter.size.y * 0.04, tailZ),
    new Vector3(-spread, orbiterY - orbiter.size.y * 0.04, tailZ),
  ];

  // --- Assembled measurements ----------------------------------------------
  const assembled = new Box3().setFromObject(root);
  const assembledSize = new Vector3();
  assembled.getSize(assembledSize);

  const fpvMount = new Group();
  // High on the tank, above the orbiter's nose, looking along the stack.
  fpvMount.position.set(0, tank.size.y / 2 + 0.2, -tank.size.z / 2 + 1.2);
  root.add(fpvMount);

  return {
    root,
    fpvMount,
    coreNozzles,
    boosterNozzles,
    length: assembledSize.z,

    // Standing on the pad the stack is pitched ninety degrees nose-up, so the
    // distance from the body origin down to the ground is half its *length*,
    // not half its height. The shared ground constraint takes a single number
    // and does not know about attitude, which is fine here: the only way to be
    // on the ground in any other attitude is to have crashed, and by then
    // Rapier owns the body anyway.
    groundClearance: assembledSize.z / 2,

    collisionHalfExtents: [
      assembledSize.x / 2,
      assembledSize.y / 2,
      assembledSize.z / 2,
    ],

    jettison() {
      boosterGroup.visible = false;
    },

    restore() {
      boosterGroup.visible = true;
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
