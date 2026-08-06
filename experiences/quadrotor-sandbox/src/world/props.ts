import { Box3, Group, Object3D, Vector3 } from "three";
import { createMintGltfLoader } from "../assets/gltf-runtime";
import { assertLoadable, getPackItemUrls } from "../assets/registry";

/**
 * Yard obstacles.
 *
 * The generated props arrive normalized into unit boxes, so each one is scaled
 * back to a real-world dimension here. `fitAxis` names the axis whose true
 * size we know: for a shipping container that is its length, for a mast its
 * height. Scaling by the wrong axis is what makes generated scenery look
 * subtly toy-like.
 *
 * Measured normalized bounds, for reference:
 *   container 0.475 x 0.498 x 0.998 (long axis Z)
 *   scaffold  0.510 x 0.998 x 0.322
 *   barrier   0.564 x 0.799 x 0.998
 *   drum      0.604 x 0.998 x 0.998 (circular in YZ, on its rim)
 *   mast      0.189 x 0.998 x 0.189
 *   cone      0.533 x 0.998 x 0.533
 *
 * `collider` is the half-extent of an axis-aligned box approximating the prop,
 * in metres, recorded now so milestone 2 can build Rapier colliders from this
 * same table rather than inventing a second source of truth.
 */

interface PropKind {
  /** Index within the generated pack. */
  item: number;
  /** Axis whose real-world size is known. */
  fitAxis: "x" | "y" | "z";
  /** True size along `fitAxis`, metres. */
  fitSize: number;
  /** Half-extents of the box collider, metres, before rotation. */
  collider: [number, number, number];
  /**
   * Mass in kg when the prop is knockable, or `null` to anchor it in place.
   * Only things a 900 g aircraft could plausibly disturb are dynamic; a
   * six-tonne shipping container staying put is not a limitation.
   */
  mass: number | null;
}

const KINDS = {
  container: { item: 0, fitAxis: "z", fitSize: 6.06, collider: [1.45, 1.3, 3.03], mass: null },
  scaffold: { item: 1, fitAxis: "y", fitSize: 4.0, collider: [1.02, 2.0, 0.65], mass: null },
  barrier: { item: 2, fitAxis: "y", fitSize: 1.0, collider: [0.35, 0.5, 0.63], mass: null },
  drum: { item: 3, fitAxis: "y", fitSize: 2.0, collider: [0.6, 1.0, 1.0], mass: null },
  mast: { item: 4, fitAxis: "y", fitSize: 6.0, collider: [0.57, 3.0, 0.57], mass: null },
  cone: { item: 5, fitAxis: "y", fitSize: 0.7, collider: [0.19, 0.35, 0.19], mass: 1.6 },
} satisfies Record<string, PropKind>;

export type PropKindId = keyof typeof KINDS;

interface Placement {
  kind: PropKindId;
  /** Ground position; Y is derived so the prop rests on the ground. */
  x: number;
  z: number;
  /** Heading, radians. */
  rotation?: number;
}

/**
 * The yard layout. Spread wide enough to fly between, with the pad at the
 * origin kept clear and a couple of tall verticals to give the space height as
 * well as width — a flat scatter of obstacles reads as a plane, not a volume.
 */
const LAYOUT: Placement[] = [
  { kind: "container", x: -11, z: -7, rotation: 0.18 },
  { kind: "container", x: 13, z: 8, rotation: -1.42 },
  { kind: "scaffold", x: 6.5, z: -9 },
  { kind: "scaffold", x: -8, z: 11, rotation: 0.6 },
  { kind: "mast", x: 17, z: -13 },
  { kind: "mast", x: -19, z: 4, rotation: 0.9 },
  { kind: "drum", x: 4.2, z: 5.6, rotation: 0.35 },
  { kind: "drum", x: -5.4, z: -4.4, rotation: -0.8 },
  { kind: "barrier", x: 2.6, z: -3.4, rotation: 0.1 },
  { kind: "barrier", x: 3.4, z: -3.3, rotation: 0.1 },
  { kind: "barrier", x: -3.1, z: 2.9, rotation: 1.5 },
  { kind: "cone", x: 1.6, z: 1.5 },
  { kind: "cone", x: -1.7, z: 1.4 },
  { kind: "cone", x: 1.5, z: -1.6 },
  { kind: "cone", x: -1.6, z: -1.5 },
];

export interface PlacedProp {
  /** Prop family name — yard kinds or city building ids; informational only. */
  kind: string;
  object: Object3D;
  /** World position of the collider centre. */
  centre: Vector3;
  /** Box collider half-extents, metres. */
  halfExtents: [number, number, number];
  rotation: number;
  /** Mass in kg if knockable, or null when the prop is anchored. */
  mass: number | null;
}

// Accepts any parent so the yard can live in a toggleable group; placements
// are in world coordinates, so the parent must sit at the origin untransformed.
export async function loadYardProps(scene: Object3D): Promise<PlacedProp[]> {
  assertLoadable("yard-props");

  const urls = getPackItemUrls("yard-props");
  const loader = createMintGltfLoader();

  // Load each distinct kind once, then clone per placement.
  const used = [...new Set(LAYOUT.map((p) => p.kind))];
  const templates = new Map<PropKindId, Object3D>();

  await Promise.all(
    used.map(async (kind) => {
      const spec = KINDS[kind];
      const url = urls[spec.item];
      if (!url) throw new Error(`yard-props is missing pack item ${spec.item} (${kind})`);

      const gltf = await loader.loadAsync(url);
      const source = gltf.scene;

      const box = new Box3().setFromObject(source);
      const size = new Vector3();
      box.getSize(size);
      const scale = spec.fitSize / (size[spec.fitAxis] || 1);

      // Recentre horizontally and sit the prop's base on the ground plane.
      const centre = new Vector3();
      box.getCenter(centre);
      source.position.set(-centre.x, -box.min.y, -centre.z);

      const wrapper = new Group();
      wrapper.add(source);
      wrapper.scale.setScalar(scale);

      source.traverse((child) => {
        child.castShadow = true;
        child.receiveShadow = true;
      });

      templates.set(kind, wrapper);
    }),
  );

  const placed: PlacedProp[] = [];
  for (const spot of LAYOUT) {
    const template = templates.get(spot.kind);
    if (!template) continue;

    const object = template.clone(true);
    object.position.set(spot.x, 0, spot.z);
    object.rotation.y = spot.rotation ?? 0;
    scene.add(object);

    const spec = KINDS[spot.kind];
    placed.push({
      kind: spot.kind,
      object,
      centre: new Vector3(spot.x, spec.collider[1], spot.z),
      halfExtents: spec.collider,
      rotation: spot.rotation ?? 0,
      mass: spec.mass,
    });
  }

  return placed;
}
