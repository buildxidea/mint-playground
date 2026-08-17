import * as THREE from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { mintModelUrl } from "./mint-assets";
import type { Dioramas } from "./Dioramas";

/**
 * Mint-generated diorama props, synced under props-* keys in
 * mint-assets.json. Each entry normalizes the GLB to `height` meters and
 * scatters one or more instances into its era slice (positions local to the
 * slice: station center is at [0, 0, 6]).
 */
interface PropSpec {
  era: string;
  url: string;
  height: number;
  placements: { at: [number, number, number]; yaw?: number; scale?: number }[];
}

const glb = (key: string) => mintModelUrl(key);

/** filled in as prop packs are synchronized */
export const PROPS: PropSpec[] = [
  // 1948 — dusty village road
  {
    era: "car-1948", url: glb("props-1948-fence"), height: 1.05,
    placements: [
      { at: [2.6, 0, 5.0], yaw: 0.15 },
      { at: [-2.8, 0, 6.6], yaw: -0.35, scale: 0.9 },
    ],
  },
  {
    era: "car-1948", url: glb("props-1948-milestone"), height: 0.7,
    placements: [{ at: [2.7, 0, 7.2], yaw: 0.5 }],
  },
  {
    era: "car-1948", url: glb("props-1948-pole"), height: 4.6,
    placements: [{ at: [-3.0, 0, 4.3], yaw: 0.2 }],
  },
  // 1987 — rain-soaked neon asphalt
  {
    era: "car-1987", url: glb("props-1987-pylon"), height: 3.7,
    placements: [{ at: [2.6, 0, 5.6], yaw: -0.4 }],
  },
  {
    era: "car-1987", url: glb("props-1987-lamp"), height: 4.1,
    placements: [{ at: [-2.8, 0, 4.4], yaw: 0.3 }],
  },
  {
    era: "car-1987", url: glb("props-1987-barrier"), height: 0.95,
    placements: [{ at: [3.2, 0, 7.1], yaw: 0.7 }],
  },
  // 1965 — coastal cliff road
  {
    era: "car-1965", url: glb("props-1965-stone"), height: 0.6,
    placements: [
      { at: [2.2, 0, 4.4] },
      { at: [2.45, 0, 5.9], yaw: 0.3 },
      { at: [2.7, 0, 7.3], yaw: 0.6, scale: 0.95 },
    ],
  },
  {
    era: "car-1965", url: glb("props-1965-sign"), height: 2.2,
    placements: [{ at: [-2.6, 0, 4.8], yaw: 0.4 }],
  },
  // 2026 — seamless studio: no props by design
  // 2040s — reflective pool
  {
    era: "car-2040", url: glb("props-2040-stele"), height: 4.4,
    placements: [{ at: [2.5, 0, 5.8], yaw: 0.2 }],
  },
  {
    era: "car-2040", url: glb("props-2040-pad"), height: 0.1,
    placements: [{ at: [-2.6, 0, 6.5] }],
  },
  // desert set — moved into the 1948 dust-bowl slice
  {
    era: "car-1948", url: glb("props-2004-cactus"), height: 2.6,
    placements: [{ at: [3.1, 0, 6.6], yaw: 2.1, scale: 0.8 }],
  },
  {
    era: "car-1948", url: glb("props-2004-signpost"), height: 1.9,
    placements: [{ at: [2.4, 0, 4.9], yaw: -0.4 }],
  },
  {
    era: "car-1948", url: glb("props-2004-rock"), height: 1.0,
    placements: [{ at: [-2.2, 0, 7.5], yaw: 1.2 }],
  },
  // 2004 — clean Japanese road (synced after the road prop pack finishes)
  {
    era: "car-2004", url: glb("props-2004road-guardrail"), height: 0.75,
    placements: [{ at: [2.35, 0, 5.6], yaw: 0.05 }],
  },
  {
    era: "car-2004", url: glb("props-2004road-pole"), height: 6.0,
    placements: [{ at: [-2.8, 0, 4.6] }],
  },
  {
    era: "car-2004", url: glb("props-2004road-sign"), height: 2.4,
    placements: [{ at: [-2.5, 0, 7.0], yaw: 0.3 }],
  },
];

export async function loadProps(dioramas: Dioramas) {
  if (PROPS.length === 0) return;
  const loader = createMintGltfLoader();
  await Promise.all(
    PROPS.map(async (spec) => {
      try {
        const gltf = await loader.loadAsync(spec.url);
        const template = gltf.scene;
        template.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.castShadow = true;
          // generated signage/neon ships with hot emissives that blow out the
          // studio grade — keep the color, drop the glow to a lit accent
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m: THREE.Material) => {
            if (!(m instanceof THREE.MeshStandardMaterial)) return;
            if (m.emissive && m.emissive.getHex() !== 0x000000) {
              m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.35);
              m.emissive.multiplyScalar(0.4);
            }
          });
        });
        // normalize height and rest on the ground
        const box = new THREE.Box3().setFromObject(template);
        const size = box.getSize(new THREE.Vector3());
        const s = size.y > 0 ? spec.height / size.y : 1;
        template.scale.setScalar(s);
        const scaled = new THREE.Box3().setFromObject(template);
        template.position.y -= scaled.min.y;

        spec.placements.forEach((p, i) => {
          const instance = i === 0 ? template : template.clone(true);
          const holder = new THREE.Group();
          holder.add(instance);
          dioramas.addProp(spec.era, holder, p.at, p.yaw ?? 0, p.scale ?? 1);
        });
      } catch (error) {
        // props are garnish — a missing prop must never break the page
        console.warn(`Prop failed to load: ${spec.url}`, error);
      }
    }),
  );
}
