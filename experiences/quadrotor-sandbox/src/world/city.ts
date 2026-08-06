import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from "three";
import { createMintGltfLoader } from "../assets/gltf-runtime";
import { assertLoadable, getPackItemUrls } from "../assets/registry";
import type { PlacedProp } from "./props";

/**
 * The metropolitan downtown both aircraft share.
 *
 * Layout: a street grid of Mint-generated buildings around the landing pad
 * (kept clear as a plaza at the origin), with an airstrip avenue along the
 * east edge for the plane. Every placed building becomes a static box
 * collider through the same `PlacedProp` pipeline the yard props used, so a
 * building strike reaches the crash policy as a scenery contact — no new
 * crash rules needed.
 *
 * Buildings are fitted by *height* from a design table, and their collider
 * half-extents are then measured from the fitted art rather than hand-typed —
 * the one lesson this project keeps re-learning is that a second hand-written
 * copy of a dimension goes stale the moment the first one changes.
 */

/** City airstrip: a flat runway avenue on the east edge, running along Z. */
export const CITY_RUNWAY = {
  x: 160,
  halfWidth: 9,
  zMin: -160,
  zMax: 160,
  height: 0,
} as const;

/** Plane spawn: south end of the strip, nose toward -Z (identity heading). */
export const CITY_RUNWAY_SPAWN = { x: CITY_RUNWAY.x, z: 130 } as const;

/**
 * Design heights per pack item, metres, and a footprint cap that keeps
 * streets flyable: a building whose fitted footprint would exceed the cap is
 * scaled down until it fits, trading height for street width.
 */
const BUILDINGS = [
  { key: "glassTower", item: 0, height: 58 },
  { key: "setbackTower", item: 1, height: 52 },
  { key: "cornerOffice", item: 2, height: 28 },
  { key: "apartmentBlock", item: 3, height: 24 },
  { key: "podiumTower", item: 4, height: 36 },
  { key: "concreteMidRise", item: 5, height: 20 },
  { key: "storefrontBlock", item: 6, height: 9 },
  { key: "hotelTower", item: 7, height: 44 },
] as const;

type BuildingKey = (typeof BUILDINGS)[number]["key"];

const MAX_FOOTPRINT = 30;
/** Street-grid block spacing, metres. */
const BLOCK = 44;

/**
 * The downtown plan, one entry per placed building: grid column/row (block
 * units, origin at the pad plaza) plus a quarter-turn count. The four blocks
 * around the origin stay open as the plaza, and everything east of column 2
 * stays clear for the airstrip. Tall towers cluster in an inner ring so the
 * skyline reads from the pad; heights taper toward the edges.
 */
const PLAN: ReadonlyArray<[kind: BuildingKey, col: number, row: number, turns: number]> = [
  // Inner ring — the skyline.
  ["glassTower", 1, 1, 0],
  ["setbackTower", -1, 1, 1],
  ["hotelTower", -1, -1, 2],
  ["podiumTower", 1, -1, 3],
  ["cornerOffice", 0, 1, 2],
  ["apartmentBlock", 0, -1, 0],
  ["concreteMidRise", 1, 0, 1],
  ["storefrontBlock", -1, 0, 3],
  // Second ring.
  ["setbackTower", 2, 1, 2],
  ["glassTower", -2, -1, 1],
  ["hotelTower", 2, -1, 0],
  ["apartmentBlock", -2, 1, 0],
  ["concreteMidRise", -2, 0, 2],
  ["podiumTower", 0, 2, 1],
  ["cornerOffice", 0, -2, 3],
  ["apartmentBlock", 1, 2, 0],
  ["storefrontBlock", -1, 2, 1],
  ["concreteMidRise", 1, -2, 2],
  ["storefrontBlock", -1, -2, 0],
  ["glassTower", 2, 0, 3],
  ["hotelTower", -2, 2, 1],
  ["setbackTower", -2, -2, 3],
  ["cornerOffice", 2, 2, 0],
  ["podiumTower", 2, -2, 2],
  // Outer ring — lower, city tapering off.
  ["apartmentBlock", 0, 3, 0],
  ["concreteMidRise", -1, 3, 1],
  ["storefrontBlock", 1, 3, 2],
  ["cornerOffice", -3, 1, 0],
  ["apartmentBlock", -3, 0, 3],
  ["storefrontBlock", -3, -1, 1],
  ["concreteMidRise", -3, 2, 0],
  ["podiumTower", -3, -2, 2],
  ["apartmentBlock", 0, -3, 1],
  ["storefrontBlock", -1, -3, 3],
  ["concreteMidRise", 1, -3, 0],
  ["cornerOffice", -2, 3, 2],
  ["storefrontBlock", -3, 3, 0],
  ["apartmentBlock", 2, 3, 1],
  ["concreteMidRise", 2, -3, 3],
  ["storefrontBlock", -2, -3, 2],
] as const;

export interface City {
  group: Group;
  props: PlacedProp[];
}

/** Fit a raw building: base on y=0, centred in XZ, height per table. */
function fitBuilding(raw: Object3D, targetHeight: number) {
  const box = new Box3().setFromObject(raw);
  const size = new Vector3();
  const centre = new Vector3();
  box.getSize(size);
  box.getCenter(centre);
  raw.position.set(-centre.x, -box.min.y, -centre.z);

  let scale = targetHeight / (size.y || 1);
  const footprint = Math.max(size.x, size.z) * scale;
  if (footprint > MAX_FOOTPRINT) scale *= MAX_FOOTPRINT / footprint;

  const wrapper = new Group();
  wrapper.add(raw);
  wrapper.scale.setScalar(scale);

  // Fitted world-space half-extents, measured — the collider's source of truth.
  const half: [number, number, number] = [
    (size.x * scale) / 2,
    (size.y * scale) / 2,
    (size.z * scale) / 2,
  ];
  return { wrapper, half };
}

export async function buildCity(parent: Object3D): Promise<City> {
  assertLoadable("city-buildings");
  const urls = getPackItemUrls("city-buildings");

  const loader = createMintGltfLoader();
  const templates = new Map<BuildingKey, { wrapper: Group; half: [number, number, number] }>();

  await Promise.all(
    BUILDINGS.map(async (spec) => {
      const url = urls[spec.item];
      if (!url) throw new Error(`city-buildings is missing pack item ${spec.item} (${spec.key})`);
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((child) => {
        child.castShadow = true;
        child.receiveShadow = true;
      });
      templates.set(spec.key, fitBuilding(gltf.scene, spec.height));
    }),
  );

  const group = new Group();
  const props: PlacedProp[] = [];

  for (const [kind, col, row, turns] of PLAN) {
    const template = templates.get(kind);
    if (!template) continue;

    const object = template.wrapper.clone(true);
    const rotation = (turns * Math.PI) / 2;
    object.position.set(col * BLOCK, 0, row * BLOCK);
    object.rotation.y = rotation;
    group.add(object);

    // Quarter turns swap the footprint axes; the collider follows.
    const [hx, hy, hz] = template.half;
    const swapped = turns % 2 === 1;
    props.push({
      kind,
      object,
      centre: new Vector3(col * BLOCK, hy, row * BLOCK),
      halfExtents: [swapped ? hz : hx, hy, swapped ? hx : hz],
      rotation: 0,
      mass: null,
    });
  }

  // The airstrip avenue: asphalt, centreline dashes, threshold bars.
  const stripLength = CITY_RUNWAY.zMax - CITY_RUNWAY.zMin;
  const strip = new Mesh(
    new PlaneGeometry(CITY_RUNWAY.halfWidth * 2, stripLength),
    new MeshStandardMaterial({ color: 0x2e3234, roughness: 0.9, metalness: 0.02 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(CITY_RUNWAY.x, 0.02, (CITY_RUNWAY.zMin + CITY_RUNWAY.zMax) / 2);
  strip.receiveShadow = true;
  group.add(strip);

  const paint = new MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 });
  for (let z = CITY_RUNWAY.zMin + 12; z < CITY_RUNWAY.zMax - 6; z += 18) {
    const dash = new Mesh(new PlaneGeometry(0.5, 7), paint);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(CITY_RUNWAY.x, 0.04, z);
    group.add(dash);
  }

  parent.add(group);
  return { group, props };
}
