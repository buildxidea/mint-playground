import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface Environment {
  group: THREE.Group;
  /** Terrain height under any point — the ground contract for placing things. */
  groundHeightAt(x: number, z: number): number;
  update(dt: number): void;
}

/**
 * Hand-built stylised landscape: rolling hills, conifer and broadleaf trees,
 * boulders, tall grass and flowers, with a distant mountain ring and a bright
 * cloudy sky.
 *
 * This replaced a Gaussian-splat world. Splats smear badly once the camera
 * leaves the captured region, and the camera has to sit well back because
 * Snorlax is large. Real geometry has no such limit and reads clean from every
 * angle, which is what the reference art looks like.
 *
 * Every repeated prop is one merged geometry drawn as an InstancedMesh, so the
 * whole landscape costs a handful of draw calls and a handful of shader
 * programs rather than one per branch.
 */

/** Everything is sized against Snorlax, who is ~13.6 units across. */
const GROUND_RADIUS = 460;
/**
 * Where props start. Kept tight so grass and trees still hug him.
 */
const CLEARING_RADIUS = 34;
/**
 * Where the ground stops being dead level. Much wider than the prop clearing,
 * because Snorlax grows with every waking and needs level ground under his
 * whole footprint. Flat versus gently rolling is imperceptible this far out.
 */
const FLAT_RADIUS = 90;
const HILLS_FADE = 90;

const PALETTE = {
  skyTop: "#63b7e8",
  skyHorizon: "#d6ecf6",
  grassNear: "#9ed36f",
  grassFar: "#79b45a",
  clearing: "#bda175",
  pineDark: "#2f5f42",
  pineLight: "#3f7a52",
  birchCanopy: "#9ccf6e",
  birchTrunk: "#d6d2c4",
  bark: "#7a5d43",
  rock: "#a6a69b",
  mountain: "#93b8ad",
  grassBlade: "#8ec763",
};

/**
 * Smooth rolling hills, flat in the middle. Analytic so the same function
 * grounds Snorlax, trees, rocks and grass without any raycasting.
 */
export function terrainHeight(x: number, z: number): number {
  const distance = Math.hypot(x, z);
  const rolling =
    Math.sin(x * 0.011) * Math.cos(z * 0.013) * 9 +
    Math.sin(x * 0.023 + 1.7) * Math.cos(z * 0.019 + 0.6) * 4.5 +
    Math.sin((x + z) * 0.007 + 2.3) * 6;
  // Ease the hills in beyond the clearing so there is no crease at the edge.
  const t = THREE.MathUtils.clamp((distance - FLAT_RADIUS) / HILLS_FADE, 0, 1);
  return rolling * (t * t * (3 - 2 * t));
}

/**
 * Bakes a flat colour into a geometry so merged parts keep their own colour.
 *
 * Also normalises to non-indexed and drops UVs: mergeGeometries returns null
 * if the parts disagree on either, and three's primitives are inconsistent —
 * cylinders and cones are indexed, icosahedrons are not.
 */
function coloured(geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute("uv");

  const colour = new THREE.Color(hex);
  const count = flat.attributes.position.count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    data[i * 3] = colour.r;
    data[i * 3 + 1] = colour.g;
    data[i * 3 + 2] = colour.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(data, 3));
  return flat;
}

/** mergeGeometries returns null on mismatched attributes; never ship that. */
function mergeParts(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error(`Could not merge ${what} geometry — parts disagree on attributes.`);
  merged.computeBoundingSphere();
  return merged;
}

function makeSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(PALETTE.skyTop) },
      horizonColor: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        gl_FragColor = vec4(mix(horizonColor, topColor, smoothstep(-0.05, 0.6, h)), 1.0);
      }
    `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(GROUND_RADIUS * 2.2, 32, 20), material);
}

function makeTerrain(): THREE.Mesh {
  const segments = 150;
  const geometry = new THREE.PlaneGeometry(GROUND_RADIUS * 2, GROUND_RADIUS * 2, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const colors: number[] = [];
  const near = new THREE.Color(PALETTE.grassNear);
  const far = new THREE.Color(PALETTE.grassFar);
  const dirt = new THREE.Color(PALETTE.clearing);
  const colour = new THREE.Color();

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, terrainHeight(x, z));

    const distance = Math.hypot(x, z);
    colour.lerpColors(near, far, THREE.MathUtils.clamp(distance / GROUND_RADIUS, 0, 1) ** 0.6);
    // A worn, trodden patch where Snorlax sleeps, like a clearing on a path.
    const worn = 1 - THREE.MathUtils.smoothstep(distance, CLEARING_RADIUS * 0.35, CLEARING_RADIUS * 1.1);
    colour.lerp(dirt, worn * 0.7);
    // Break up the flat fill so large areas do not read as one solid colour.
    // A plain multiply, not offsetHSL: that round-trips through HSL per vertex
    // and dominated scene build time across 22k vertices.
    colour.multiplyScalar(1 + Math.sin(x * 0.05) * Math.cos(z * 0.043) * 0.06);
    colors.push(colour.r, colour.g, colour.b);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

/** One merged conifer: trunk plus stacked tiers. */
function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunkHeight = 6;
  const trunk = new THREE.CylinderGeometry(0.5, 0.8, trunkHeight, 6);
  trunk.translate(0, trunkHeight / 2, 0);
  parts.push(coloured(trunk, PALETTE.bark));

  for (let i = 0; i < 4; i += 1) {
    const tier = new THREE.ConeGeometry(5.4 - i * 1.05, 7 - i * 0.9, 7);
    tier.translate(0, trunkHeight + 2.4 + (i / 4) * 11, 0);
    parts.push(coloured(tier, i % 2 === 0 ? PALETTE.pineDark : PALETTE.pineLight));
  }
  return mergeParts(parts, "pine");
}

/** One merged broadleaf: pale trunk plus a clump of canopy blobs. */
function broadleafGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunkHeight = 9;
  const trunk = new THREE.CylinderGeometry(0.45, 0.7, trunkHeight, 6);
  trunk.translate(0, trunkHeight / 2, 0);
  parts.push(coloured(trunk, PALETTE.birchTrunk));

  const offsets: [number, number, number][] = [
    [0, trunkHeight + 2, 0],
    [2.1, trunkHeight + 4.4, -1.4],
    [-2.3, trunkHeight + 4.9, 1.2],
  ];
  offsets.forEach(([x, y, z], i) => {
    const canopy = new THREE.IcosahedronGeometry(4.6 - i * 0.7, 1);
    canopy.scale(1, 0.85, 1);
    canopy.translate(x, y, z);
    parts.push(coloured(canopy, PALETTE.birchCanopy));
  });
  return mergeParts(parts, "broadleaf");
}

/** Places instances of one geometry, returning a single-draw-call mesh. */
function instance(
  geometry: THREE.BufferGeometry,
  placements: { position: THREE.Vector3; rotationY: number; scale: THREE.Vector3; tint?: THREE.Color }[],
  options: { castShadow?: boolean; receiveShadow?: boolean; flatShading?: boolean } = {},
): THREE.InstancedMesh {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: options.flatShading ?? true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const dummy = new THREE.Object3D();
  placements.forEach((placement, i) => {
    dummy.position.copy(placement.position);
    dummy.rotation.set(0, placement.rotationY, 0);
    dummy.scale.copy(placement.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (placement.tint) mesh.setColorAt(i, placement.tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  return mesh;
}

const uniform = (s: number) => new THREE.Vector3(s, s, s);

function treePlacements(count: number) {
  const pines: Parameters<typeof instance>[1] = [];
  const broadleaves: Parameters<typeof instance>[1] = [];
  const taken: [number, number][] = [];
  const tint = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    // Trees cluster in loose stands, never inside the clearing.
    const radius = CLEARING_RADIUS + 18 + Math.pow(Math.random(), 0.7) * GROUND_RADIUS * 0.72;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (taken.some(([px, pz]) => Math.hypot(px - x, pz - z) < 15)) continue;
    taken.push([x, z]);

    const scale = 0.9 + Math.random() * 0.9;
    const placement = {
      position: new THREE.Vector3(x, terrainHeight(x, z) - 0.4, z),
      rotationY: Math.random() * Math.PI * 2,
      scale: new THREE.Vector3(scale * (0.9 + Math.random() * 0.2), scale, scale * (0.9 + Math.random() * 0.2)),
      tint: tint.clone().setScalar(1 + (Math.random() - 0.5) * 0.22),
    };
    (Math.random() < 0.62 ? pines : broadleaves).push(placement);
  }
  return { pines, broadleaves };
}

function rockPlacements(count: number) {
  const out: Parameters<typeof instance>[1] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = CLEARING_RADIUS + 6 + Math.random() * GROUND_RADIUS * 0.6;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const size = 2 + Math.random() * 7;
    out.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) + size * 0.1, z),
      rotationY: Math.random() * Math.PI,
      scale: new THREE.Vector3(size, size * (0.55 + Math.random() * 0.3), size),
      tint: new THREE.Color().setScalar(1 + (Math.random() - 0.5) * 0.26),
    });
  }
  return out;
}

function grassPlacements(count: number) {
  const out: Parameters<typeof instance>[1] = [];
  for (let i = 0; i < count; i += 1) {
    // Denser near the clearing, thinning out with distance.
    const radius = CLEARING_RADIUS * 0.5 + Math.pow(Math.random(), 0.55) * GROUND_RADIUS * 0.62;
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const s = 0.7 + Math.random() * 1.5;
    out.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) - 0.3, z),
      rotationY: Math.random() * Math.PI,
      scale: new THREE.Vector3(s, s * (0.8 + Math.random() * 0.9), s),
      tint: new THREE.Color().setScalar(1 + (Math.random() - 0.5) * 0.3),
    });
  }
  return out;
}

const FLOWER_COLOURS = ["#f2a8c6", "#ffffff", "#f7d873", "#e8b3e0"];

function flowerPlacements(count: number) {
  const out: Parameters<typeof instance>[1] = [];
  // Flowers grow in patches rather than evenly scattered.
  const patches = Math.max(1, Math.floor(count / 26));
  const centres: [number, number, string][] = [];
  for (let p = 0; p < patches; p += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = CLEARING_RADIUS * 0.8 + Math.random() * GROUND_RADIUS * 0.45;
    centres.push([
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      FLOWER_COLOURS[Math.floor(Math.random() * FLOWER_COLOURS.length)],
    ]);
  }
  for (let i = 0; i < count; i += 1) {
    const [cx, cz, colour] = centres[i % centres.length];
    const x = cx + (Math.random() - 0.5) * 28;
    const z = cz + (Math.random() - 0.5) * 28;
    const s = 0.7 + Math.random() * 0.6;
    out.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) + 0.9, z),
      rotationY: Math.random() * Math.PI,
      scale: uniform(s),
      tint: new THREE.Color(colour),
    });
  }
  return out;
}

function mountainPlacements(count: number) {
  const out: Parameters<typeof instance>[1] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.12;
    const radius = GROUND_RADIUS * (0.86 + Math.random() * 0.18);
    const height = 70 + Math.random() * 90;
    out.push({
      position: new THREE.Vector3(Math.cos(angle) * radius, height * 0.35, Math.sin(angle) * radius),
      rotationY: Math.random() * Math.PI,
      scale: new THREE.Vector3(height * (0.9 + Math.random() * 0.7), height, height * (0.9 + Math.random() * 0.7)),
      tint: new THREE.Color().setScalar(1 + (Math.random() - 0.5) * 0.16),
    });
  }
  return out;
}

function makeClouds(): THREE.InstancedMesh {
  const puff = coloured(new THREE.SphereGeometry(1, 10, 8), "#ffffff");
  const placements: Parameters<typeof instance>[1] = [];
  for (let i = 0; i < 22; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 150 + Math.random() * GROUND_RADIUS * 0.9;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const y = 150 + Math.random() * 90;
    const lumps = 4 + Math.floor(Math.random() * 4);
    for (let p = 0; p < lumps; p += 1) {
      const s = 16 + Math.random() * 20;
      placements.push({
        position: new THREE.Vector3(cx + p * 18 - lumps * 8, y + Math.random() * 7, cz + Math.random() * 12),
        rotationY: 0,
        scale: new THREE.Vector3(s, s * (0.45 + Math.random() * 0.2), s * 0.8),
      });
    }
  }
  const mesh = instance(puff, placements, { flatShading: false });
  // Clouds sit above the fog and should not be shaded by it.
  mesh.material = new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false });
  return mesh;
}

export function createEnvironment(scene: THREE.Scene): Environment {
  const group = new THREE.Group();

  scene.fog = new THREE.Fog(PALETTE.skyHorizon, GROUND_RADIUS * 0.45, GROUND_RADIUS * 1.35);
  scene.background = new THREE.Color(PALETTE.skyHorizon);

  const { pines, broadleaves } = treePlacements(150);
  const clouds = makeClouds();

  const blade = new THREE.ConeGeometry(0.5, 3.4, 4);
  blade.translate(0, 1.7, 0);
  const petal = new THREE.SphereGeometry(0.55, 6, 5);
  petal.scale(1, 0.55, 1);

  group.add(
    makeSky(),
    makeTerrain(),
    instance(coloured(new THREE.ConeGeometry(1, 1, 5), PALETTE.mountain), mountainPlacements(26)),
    // Nothing here casts: an InstancedMesh is frustum-culled as a single
    // object, so one distant tree would drag all 90 into the shadow pass.
    // Snorlax is the only caster, which is what the shadow camera covers.
    instance(pineGeometry(), pines, { receiveShadow: true }),
    instance(broadleafGeometry(), broadleaves, { receiveShadow: true }),
    instance(coloured(new THREE.DodecahedronGeometry(1, 0), PALETTE.rock), rockPlacements(36), {
      receiveShadow: true,
    }),
    instance(coloured(blade, PALETTE.grassBlade), grassPlacements(3600), { receiveShadow: true }),
    instance(coloured(petal, "#ffffff"), flowerPlacements(440), { flatShading: false }),
    clouds,
  );

  // Warm sun with real shadows — the whole point of using geometry.
  const sun = new THREE.DirectionalLight("#fff4dd", 2.5);
  sun.position.set(70, 120, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 320;
  const extent = 26;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;

  const sky = new THREE.HemisphereLight("#cfe9ff", "#87b96a", 1.15);
  const ambient = new THREE.AmbientLight("#fdf7e6", 0.32);
  group.add(sun, sun.target, sky, ambient);

  scene.add(group);

  return {
    group,
    groundHeightAt: terrainHeight,
    update(dt: number) {
      // Clouds drift, slowly enough to notice only if you watch for it.
      clouds.position.x += 2.2 * dt;
      if (clouds.position.x > GROUND_RADIUS * 0.5) clouds.position.x = -GROUND_RADIUS * 0.5;
    },
  };
}
