import * as THREE from 'three';
import type { PropLibrary } from '../assets/props';
import { CollisionWorld } from '../sim/collision';
import { packageColor, type PackageColorId } from '../sim/config';
import type { RouteDef } from './routes';

export interface PadInfo {
  kind: 'dispatch' | 'delivery';
  color: PackageColorId | null;
  /** Centre of the pad's top surface, world space. */
  center: THREE.Vector3;
  radius: number;
  ring: THREE.Mesh;
}

export interface CityWorld {
  group: THREE.Group;
  collision: CollisionWorld;
  dispatch: PadInfo;
  pads: PadInfo[];
  clouds: THREE.Object3D[];
  dispose(): void;
}

const PAD_BASE_RADIUS = 2;

/**
 * Instantiates a route into meshes and colliders. Buildings and rooftop props
 * are measured with Box3 after placement, so collider sizes always match
 * whatever the generated art actually is.
 */
export function buildCity(route: RouteDef, props: PropLibrary): CityWorld {
  const group = new THREE.Group();
  const collision = new CollisionWorld();
  const disposables: Array<{ dispose(): void }> = [];

  group.add(createGround(disposables));
  createAvenues(group, disposables);

  // Buildings first: rooftop pads and dressing need their measured tops.
  const buildingTops: THREE.Vector3[] = [];
  route.buildings.forEach((def, index) => {
    const building = props.spawn(def.kind, def.scale ?? 1);
    building.position.set(def.pos[0], 0, def.pos[1]);
    building.rotation.y = def.rotY ?? 0;
    group.add(building);

    const box = new THREE.Box3().setFromObject(building);
    collision.boxes.push({ box, label: 'building' });
    const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    buildingTops.push(top);

    for (const dressing of def.roof ?? []) {
      const prop = props.spawn(dressing);
      // Offset dressing away from the pad spot at the roof centre.
      const offset = dressing === 'antenna' ? 0.32 : 0.3;
      prop.position.set(
        top.x + (box.max.x - box.min.x) * offset,
        top.y,
        top.z + (box.max.z - box.min.z) * (index % 2 === 0 ? offset : -offset),
      );
      group.add(prop);
      collision.boxes.push({ box: new THREE.Box3().setFromObject(prop), label: dressing });
    }
  });

  // Parks: grass patches with tree rings. Built before pads so ground
  // deliveries can sit on them.
  for (const park of route.parks ?? []) {
    buildPark(group, collision, props, park.pos[0], park.pos[1], park.radius, disposables);
  }

  // Bridges: procedural pastel spans (deck, rails, pillars). Mid-span deck-top
  // positions come back so deliveries can target a bridge.
  const bridgeDecks: THREE.Vector3[] = (route.bridges ?? []).map((bridge) =>
    buildBridge(group, collision, bridge.from, bridge.to, bridge.height, disposables),
  );

  // Delivery pads — on a rooftop, on the ground/park, or mid-span on a
  // bridge. The logic centre is the pad's actual deck surface, found by
  // raycasting the placed prop at its middle (bounding boxes lie about it),
  // and a thin collider under the deck lets the drone rest ON the pad.
  const makeDeliveryPad = (
    x: number,
    z: number,
    baseY: number,
    delivery: RouteDef['deliveries'][number],
  ): PadInfo => {
    const pad = props.spawn('landingPad', delivery.padScale);
    pad.position.set(x, baseY, z);
    group.add(pad);
    const radius = PAD_BASE_RADIUS * delivery.padScale;
    const deckY = surfaceHeightAt(pad, x, z, baseY + 5) ?? baseY;
    collision.boxes.push({
      box: new THREE.Box3(
        new THREE.Vector3(x - radius, baseY, z - radius),
        new THREE.Vector3(x + radius, deckY, z + radius),
      ),
      label: 'landing pad',
    });
    return {
      kind: 'delivery',
      color: delivery.color,
      center: new THREE.Vector3(x, deckY, z),
      radius,
      ring: addPadRing(group, x, deckY, z, radius, packageColor(delivery.color), disposables),
    };
  };

  const pads: PadInfo[] = route.deliveries.map((delivery) => {
    if (delivery.building !== undefined) {
      const top = buildingTops[delivery.building];
      return makeDeliveryPad(top.x, top.z, top.y, delivery);
    }
    if (delivery.bridge !== undefined) {
      const deck = bridgeDecks[delivery.bridge];
      return makeDeliveryPad(deck.x, deck.z, deck.y, delivery);
    }
    const [gx, gz] = delivery.ground ?? [0, 0];
    return makeDeliveryPad(gx, gz, 0, delivery);
  });

  // Dispatch pad on the ground: a scaled-up landing platform. (The dedicated
  // dispatch-pad asset ships with a kiosk hut that read as clutter, so the
  // clean pad model is used for both roles.)
  const dispatchProp = props.spawn('landingPad', 1.5);
  dispatchProp.position.set(route.dispatch[0], 0, route.dispatch[1]);
  group.add(dispatchProp);
  const dispatchDeckY = surfaceHeightAt(dispatchProp, route.dispatch[0], route.dispatch[1], 20) ?? 0;
  collision.boxes.push({
    box: new THREE.Box3(
      new THREE.Vector3(route.dispatch[0] - 2.7, 0, route.dispatch[1] - 2.7),
      new THREE.Vector3(route.dispatch[0] + 2.7, dispatchDeckY, route.dispatch[1] + 2.7),
    ),
    label: 'dispatch pad',
  });
  const dispatch: PadInfo = {
    kind: 'dispatch',
    color: null,
    center: new THREE.Vector3(route.dispatch[0], dispatchDeckY, route.dispatch[1]),
    radius: 3,
    ring: addPadRing(
      group,
      route.dispatch[0],
      dispatchDeckY,
      route.dispatch[1],
      3,
      new THREE.Color('#39c6ce'),
      disposables,
    ),
  };

  for (const [x, z] of route.trees) {
    const tree = props.spawn('tree', 0.85 + ((x * 7 + z * 13) % 5) * 0.08);
    tree.position.set(x, 0, z);
    group.add(tree);
    collision.boxes.push({ box: new THREE.Box3().setFromObject(tree), label: 'tree' });
  }

  const pylonTops = new Map<string, THREE.Vector3>();
  for (const [x, z] of route.pylons) {
    const pylon = props.spawn('pylon');
    pylon.position.set(x, 0, z);
    group.add(pylon);
    const box = new THREE.Box3().setFromObject(pylon);
    collision.boxes.push({ box, label: 'pylon' });
    pylonTops.set(`${x},${z}`, new THREE.Vector3(x, box.max.y, z));
  }

  for (const wire of route.wires) {
    const start = pylonTops.get(`${wire.from[0]},${wire.from[1]}`);
    const end = pylonTops.get(`${wire.to[0]},${wire.to[1]}`);
    if (!start || !end) continue;
    addWire(group, collision, start, end, wire.sag, disposables);
  }

  // Outskirt filler: a deterministic scatter of extra buildings and trees in
  // the ring beyond the authored city, so every route sits inside a town that
  // continues to the horizon instead of ending at the last pad. Every piece of
  // authored infrastructure reserves its own keep-out radius so nothing
  // spawns inside a crane sweep, under a bridge, or on a pad.
  const occupied: OccupiedSpot[] = [
    { x: route.dispatch[0], z: route.dispatch[1], r: 10 },
    ...route.buildings.map((b) => ({ x: b.pos[0], z: b.pos[1], r: 13 })),
    ...(route.parks ?? []).map((p) => ({ x: p.pos[0], z: p.pos[1], r: p.radius + 6 })),
    ...route.pylons.map(([x, z]) => ({ x, z, r: 6 })),
    ...route.trees.map(([x, z]) => ({ x, z, r: 4 })),
    ...route.deliveries
      .filter((d) => d.ground)
      .map((d) => ({ x: d.ground![0], z: d.ground![1], r: 8 })),
    ...route.hazards.flatMap((h) =>
      h.kind === 'crane' ? [{ x: h.pos[0], z: h.pos[1], r: h.jib + 5 }] : [],
    ),
    ...(route.bridges ?? []).flatMap((b) => {
      const spots: OccupiedSpot[] = [];
      const span = Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1]);
      const steps = Math.max(2, Math.ceil(span / 8));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        spots.push({
          x: b.from[0] + (b.to[0] - b.from[0]) * t,
          z: b.from[1] + (b.to[1] - b.from[1]) * t,
          r: 8,
        });
      }
      return spots;
    }),
  ];
  scatterOutskirts(group, collision, props, route.id, occupied);
  warnHazardOverlaps(route, collision);

  // Decorative drifting clouds, deterministic placement.
  const clouds: THREE.Object3D[] = [];
  for (let i = 0; i < route.clouds; i += 1) {
    const cloud = props.spawn('cloud', 0.8 + ((i * 37) % 7) * 0.12);
    const angle = (i / route.clouds) * Math.PI * 2 + i * 0.7;
    cloud.position.set(Math.cos(angle) * (30 + (i % 3) * 12), 26 + ((i * 11) % 5) * 4, Math.sin(angle) * (30 + (i % 4) * 10) - 8);
    group.add(cloud);
    clouds.push(cloud);
  }

  return {
    group,
    collision,
    dispatch,
    pads,
    clouds,
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

/** Small deterministic PRNG so filler layouts are stable per route. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPark(
  group: THREE.Group,
  collision: CollisionWorld,
  props: PropLibrary,
  x: number,
  z: number,
  radius: number,
  disposables: Array<{ dispose(): void }>,
): void {
  const grassGeometry = new THREE.CircleGeometry(radius, 36);
  const grassMaterial = new THREE.MeshStandardMaterial({ color: '#9fdc9a', roughness: 0.95 });
  disposables.push(grassGeometry, grassMaterial);
  const grass = new THREE.Mesh(grassGeometry, grassMaterial);
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(x, 0.05, z);
  grass.receiveShadow = true;
  group.add(grass);

  // Tree ring around the rim, leaving the middle open for a pad.
  const count = Math.max(4, Math.round(radius * 0.9));
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + x * 0.3 + z * 0.17;
    const r = radius * (0.72 + ((i * 37) % 4) * 0.05);
    const tree = props.spawn('tree', 0.7 + ((i * 13) % 5) * 0.09);
    tree.position.set(x + Math.cos(angle) * r, 0, z + Math.sin(angle) * r);
    group.add(tree);
    collision.boxes.push({ box: new THREE.Box3().setFromObject(tree), label: 'tree' });
  }
}

/**
 * Procedural pastel skybridge: a deck with side rails on slim pillars. Built
 * from primitives because spans vary per route and stretching a generated
 * model would distort it. Returns the mid-span deck-top position.
 */
function buildBridge(
  group: THREE.Group,
  collision: CollisionWorld,
  from: [number, number],
  to: [number, number],
  height: number,
  disposables: Array<{ dispose(): void }>,
): THREE.Vector3 {
  const start = new THREE.Vector3(from[0], height, from[1]);
  const end = new THREE.Vector3(to[0], height, to[1]);
  const span = start.distanceTo(end);
  const angle = Math.atan2(end.x - start.x, end.z - start.z);
  const mid = start.clone().lerp(end, 0.5);

  const WIDTH = 4.4;
  const DECK = 0.55;
  const deckMaterial = new THREE.MeshStandardMaterial({ color: '#f6e7d3', roughness: 0.85 });
  const railMaterial = new THREE.MeshStandardMaterial({ color: '#ef8f7c', roughness: 0.7 });
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 });
  const deckGeometry = new THREE.BoxGeometry(WIDTH, DECK, span);
  const railGeometry = new THREE.BoxGeometry(0.28, 0.9, span);
  disposables.push(deckMaterial, railMaterial, pillarMaterial, deckGeometry, railGeometry);

  const bridge = new THREE.Group();
  bridge.position.copy(mid).setY(0);
  bridge.rotation.y = angle;

  const deck = new THREE.Mesh(deckGeometry, deckMaterial);
  deck.position.y = height - DECK / 2;
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);

  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.position.set((side * (WIDTH - 0.3)) / 2, height + 0.45, 0);
    rail.castShadow = true;
    bridge.add(rail);
  }

  const pillarCount = Math.max(2, Math.round(span / 9));
  for (let i = 0; i < pillarCount; i += 1) {
    const t = pillarCount === 1 ? 0.5 : i / (pillarCount - 1);
    const localZ = (t - 0.5) * (span - 3);
    const pillarGeometry = new THREE.BoxGeometry(1.1, height - DECK, 1.1);
    disposables.push(pillarGeometry);
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(0, (height - DECK) / 2, localZ);
    pillar.castShadow = true;
    bridge.add(pillar);

    // Pillar collider in world space.
    const world = new THREE.Vector3(Math.sin(angle) * localZ, 0, Math.cos(angle) * localZ).add(
      new THREE.Vector3(mid.x, 0, mid.z),
    );
    collision.boxes.push({
      box: new THREE.Box3(
        new THREE.Vector3(world.x - 0.8, 0, world.z - 0.8),
        new THREE.Vector3(world.x + 0.8, height - DECK, world.z + 0.8),
      ),
      label: 'bridge pillar',
    });
  }
  group.add(bridge);

  // Deck collider: chunked AABBs along the span (conservative for diagonal
  // bridges, exact for axis-aligned ones).
  const chunks = Math.max(2, Math.ceil(span / 5));
  const half = new THREE.Vector3(WIDTH / 2 + 0.2, 0, WIDTH / 2 + 0.2);
  for (let i = 0; i < chunks; i += 1) {
    const a = start.clone().lerp(end, i / chunks);
    const b = start.clone().lerp(end, (i + 1) / chunks);
    const min = new THREE.Vector3(Math.min(a.x, b.x), height - DECK, Math.min(a.z, b.z)).sub(half.clone().setY(0));
    const max = new THREE.Vector3(Math.max(a.x, b.x), height, Math.max(a.z, b.z)).add(half.clone().setY(0));
    min.y = height - DECK;
    max.y = height;
    collision.boxes.push({ box: new THREE.Box3(min, max), label: 'bridge deck' });
  }

  return new THREE.Vector3(mid.x, height, mid.z);
}

interface OccupiedSpot {
  x: number;
  z: number;
  /** Keep-out radius: new filler must stay this far from the spot's centre. */
  r: number;
}

function isFree(occupied: OccupiedSpot[], x: number, z: number, r: number): boolean {
  return !occupied.some((spot) => Math.hypot(x - spot.x, z - spot.z) < spot.r + r);
}

/**
 * Extra town beyond the authored playfield, seeded per route: a mid ring of
 * small blocks and trees, and an outer ring of larger silhouettes. Everything
 * respects the keep-out radii of the authored infrastructure and of each
 * previously placed filler piece.
 */
function scatterOutskirts(
  group: THREE.Group,
  collision: CollisionWorld,
  props: PropLibrary,
  routeId: number,
  occupied: OccupiedSpot[],
): void {
  const rng = mulberry32(routeId * 7919 + 17);
  const kinds = ['aptSmall', 'aptMedium', 'aptSmall', 'tower'] as const;

  const place = (radiusMin: number, radiusMax: number, treeChance: number, count: number) => {
    let placed = 0;
    for (let attempt = 0; attempt < count * 7 && placed < count; attempt += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = radiusMin + rng() * (radiusMax - radiusMin);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      if (rng() < treeChance) {
        if (!isFree(occupied, x, z, 3)) continue;
        occupied.push({ x, z, r: 3 });
        placed += 1;
        const tree = props.spawn('tree', 0.7 + rng() * 0.5);
        tree.position.set(x, 0, z);
        group.add(tree);
        continue; // filler trees are scenery only
      }

      const kind = kinds[Math.floor(rng() * kinds.length)];
      const scale = kind === 'tower' ? 0.6 + rng() * 0.35 : 0.7 + rng() * 0.45;
      if (!isFree(occupied, x, z, 8)) continue;
      occupied.push({ x, z, r: 8 });
      placed += 1;
      const building = props.spawn(kind, scale);
      building.position.set(x, 0, z);
      building.rotation.y = Math.floor(rng() * 4) * (Math.PI / 2);
      group.add(building);
      collision.boxes.push({ box: new THREE.Box3().setFromObject(building), label: 'building' });
    }
  };

  // Mid ring: small blocks and greenery just past the playfield.
  place(42, 55, 0.45, 14);
  // Outer ring: the skyline that carries to the horizon.
  place(55, 88, 0.2, 26);
}

/**
 * Dev guard: warn when a crane jib or blimp orbit sweeps through a taller
 * collider. Catches authored-data overlaps as soon as a route is built.
 */
function warnHazardOverlaps(route: RouteDef, collision: CollisionWorld): void {
  for (const hazard of route.hazards) {
    if (hazard.kind === 'crane') {
      const jibY = hazard.height * 0.92;
      for (const { box, label } of collision.boxes) {
        if (label === 'crane mast') continue;
        const cx = THREE.MathUtils.clamp(hazard.pos[0], box.min.x, box.max.x);
        const cz = THREE.MathUtils.clamp(hazard.pos[1], box.min.z, box.max.z);
        const dist = Math.hypot(cx - hazard.pos[0], cz - hazard.pos[1]);
        if (dist < hazard.jib + 0.8 && box.max.y > jibY - 0.5) {
          console.warn(
            `[route ${route.id}] crane at (${hazard.pos}) jib h=${jibY.toFixed(1)} sweeps through ${label} (top ${box.max.y.toFixed(1)})`,
          );
        }
      }
    } else {
      for (const { box, label } of collision.boxes) {
        const cx = THREE.MathUtils.clamp(hazard.center[0], box.min.x, box.max.x);
        const cz = THREE.MathUtils.clamp(hazard.center[2], box.min.z, box.max.z);
        const near = Math.hypot(cx - hazard.center[0], cz - hazard.center[2]);
        const far = Math.hypot(
          Math.max(Math.abs(box.min.x - hazard.center[0]), Math.abs(box.max.x - hazard.center[0])),
          Math.max(Math.abs(box.min.z - hazard.center[2]), Math.abs(box.max.z - hazard.center[2])),
        );
        const crossesRing = near <= hazard.radius + 2.4 && far >= hazard.radius - 2.4;
        if (crossesRing && box.max.y > hazard.center[1] - 2.4) {
          console.warn(
            `[route ${route.id}] blimp orbit y=${hazard.center[1]} r=${hazard.radius} crosses ${label} (top ${box.max.y.toFixed(1)})`,
          );
        }
      }
    }
  }
}

const surfaceRaycaster = new THREE.Raycaster();

/** Y of the first surface hit casting straight down at (x, z), or null. */
function surfaceHeightAt(object: THREE.Object3D, x: number, z: number, fromY: number): number | null {
  object.updateWorldMatrix(true, true);
  surfaceRaycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
  const hits = surfaceRaycaster.intersectObject(object, true);
  return hits.length > 0 ? hits[0].point.y : null;
}

function addPadRing(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  radius: number,
  color: THREE.Color,
  disposables: Array<{ dispose(): void }>,
): THREE.Mesh {
  const geometry = new THREE.RingGeometry(radius * 0.86, radius * 1.02, 48);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  disposables.push(geometry, material);
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y + 0.06, z);
  group.add(ring);
  return ring;
}

function addWire(
  group: THREE.Group,
  collision: CollisionWorld,
  start: THREE.Vector3,
  end: THREE.Vector3,
  sag: number,
  disposables: Array<{ dispose(): void }>,
): void {
  const mid = start.clone().lerp(end, 0.5);
  mid.y = Math.min(start.y, end.y) * sag;
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);

  const geometry = new THREE.TubeGeometry(curve, 24, 0.045, 6, false);
  const material = new THREE.MeshStandardMaterial({ color: '#4c5261', roughness: 0.6 });
  disposables.push(geometry, material);
  const tube = new THREE.Mesh(geometry, material);
  tube.castShadow = true;
  group.add(tube);

  // Approximate the catenary with a few straight collider segments.
  const SEGMENTS = 4;
  const points = curve.getPoints(SEGMENTS);
  for (let i = 0; i < SEGMENTS; i += 1) {
    collision.segments.push({
      start: points[i].clone(),
      end: points[i + 1].clone(),
      radius: 0.12,
      label: 'power line',
    });
  }
}

/**
 * Two main avenues crossing the town centre: light asphalt with a dashed
 * centreline, laid just above the block-grid ground texture.
 */
function createAvenues(group: THREE.Group, disposables: Array<{ dispose(): void }>): void {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#ddd6c8';
  context.fillRect(0, 0, 1024, 48);
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.lineWidth = 3;
  context.setLineDash([26, 20]);
  context.beginPath();
  context.moveTo(0, 24);
  context.lineTo(1024, 24);
  context.stroke();
  // Kerb lines.
  context.setLineDash([]);
  context.strokeStyle = 'rgba(120, 130, 140, 0.35)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 3);
  context.lineTo(1024, 3);
  context.moveTo(0, 45);
  context.lineTo(1024, 45);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(236, 9);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
  disposables.push(texture, geometry, material);

  const eastWest = new THREE.Mesh(geometry, material);
  eastWest.rotation.x = -Math.PI / 2;
  eastWest.position.y = 0.015;
  eastWest.receiveShadow = true;
  group.add(eastWest);

  const northSouth = new THREE.Mesh(geometry, material);
  northSouth.rotation.x = -Math.PI / 2;
  northSouth.rotation.z = Math.PI / 2;
  northSouth.position.y = 0.02;
  northSouth.receiveShadow = true;
  group.add(northSouth);
}

function createGround(disposables: Array<{ dispose(): void }>): THREE.Mesh {
  const size = 240;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create ground texture context.');

  context.fillStyle = '#cfe8cf';
  context.fillRect(0, 0, 512, 512);
  // City blocks: soft roads dividing pastel blocks.
  context.fillStyle = '#e9e4da';
  for (let i = 0; i <= 512; i += 128) {
    context.fillRect(i - 10, 0, 20, 512);
    context.fillRect(0, i - 10, 512, 20);
  }
  context.strokeStyle = 'rgba(255,255,255,0.55)';
  context.setLineDash([14, 12]);
  context.lineWidth = 3;
  for (let i = 0; i <= 512; i += 128) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i, 512);
    context.moveTo(0, i);
    context.lineTo(512, i);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);

  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
  disposables.push(geometry, material, texture);
  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}
