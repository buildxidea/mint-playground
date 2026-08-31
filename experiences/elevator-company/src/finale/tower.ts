/**
 * Assembles the finale tower: procedural geometry + procedural surfaces, sized
 * to the shaft it replaces and wired to the rising cut plane.
 */

import * as THREE from "three";
import { buildTenshu, TENSHU_HEIGHT } from "./tenshu";
import {
  surface,
  texBronze,
  texIshigaki,
  texPlaster,
  texRoofTile,
  texTimber,
} from "./textures";

export interface FinaleTower {
  group: THREE.Group;
  /** Every material clipped by the build plane, for the palette cross-fade. */
  materials: THREE.MeshStandardMaterial[];
  size: { height: number; width: number };
}

/**
 * Build the keep and scale it uniformly so its ridge lands at `targetHeight`.
 *
 * Uniform is the whole point: a keep is naturally about 2.17:1, and forcing it
 * onto the shaft's much narrower footprint pulled every roof that should flare
 * sideways into a vertical spike. The tower is therefore wider than the shaft
 * it replaces — the cross-dissolve still works, since both share the ground
 * plane, the build direction and the clip plane, but the silhouette changes
 * rather than matching.
 */
export function buildFinaleTower(
  targetHeight: number,
  clip: THREE.Plane
): FinaleTower {
  const geos = buildTenshu();

  // One painted surface per material, each deriving its own bump and roughness.
  // Under uniform scale the texture aspect is correct by construction.
  const mats = {
    stone: surface(texIshigaki(), { repeat: [2, 3], bump: 1.5, rough: [0.72, 0.98] }),
    plaster: surface(texPlaster(), { repeat: [2, 2], bump: 0.7, rough: [0.6, 0.86] }),
    timber: surface(texTimber(), { repeat: [1, 2], bump: 1.1, rough: [0.58, 0.9] }),
    tile: surface(texRoofTile(), { repeat: [1, 1], bump: 1.3, rough: [0.4, 0.78] }),
    bronze: surface(texBronze(), {
      repeat: [1, 1],
      bump: 0.9,
      rough: [0.28, 0.55],
      metalness: 0.85,
    }),
  };

  const group = new THREE.Group();
  const materials: THREE.MeshStandardMaterial[] = [];

  for (const key of Object.keys(mats) as (keyof typeof mats)[]) {
    const geo = geos[key];
    if (!geo) continue;
    const mat = mats[key];
    // The whole tower clips against the shared rising plane — this is what
    // makes it build from the ground up without animating a single member.
    mat.clippingPlanes = [clip];
    mat.clipShadows = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    materials.push(mat);
  }

  group.scale.setScalar(targetHeight / TENSHU_HEIGHT);

  const box = new THREE.Box3().setFromObject(group);
  return {
    group,
    materials,
    size: {
      height: Math.max(1, box.max.y - box.min.y),
      width: Math.max(1, box.max.x - box.min.x),
    },
  };
}
