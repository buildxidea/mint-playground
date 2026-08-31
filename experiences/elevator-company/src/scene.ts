import * as THREE from "three";
import type { AssetMap } from "./assets-load";
import { BUTTON_FLOORS, PASSENGERS, STOPS, ROOF_STORY, storyY } from "./content";
import { buildFinaleTower } from "./finale/tower";
import { buildLandscape, type Landscape } from "./finale/landscape";
import { addOfficeProps, addPenthouseProps } from "./room-props";

export const DOOR_Z = -1.12;
export const DOOR_CLOSED_X = 0.6;
export const DOOR_OPEN_X = 1.78;
export const DIORAMA_Z = -1.4;
const TOWER_HEIGHT = 256;
/**
 * How far apart a generated room's side walls are pushed. Wide enough that the
 * wall ends sit outside the sightline through the doorway from every camera the
 * ride uses, so a floor never reads as a small box you are looking into.
 */
const ROOM_WIDTH = 11;
/**
 * Where a generated room's front face is seated.
 *
 * Must clear the back of the cab, which reaches z = -1.37. Rooms used to sit
 * at -0.06, putting their frontmost 1.31 units inside the car — survivable
 * while the rooms were large and that region was empty wall, but once they were
 * scaled to true size the furniture came forward with it and ended up standing
 * among the passengers, and the car visibly passed through each room on the way
 * up. Seated behind the cab there is nothing left to intersect.
 */
const ROOM_FRONT_Z = -1.45;
/**
 * How far the laid floor slab sits above each room's own floor. Small enough
 * that passengers standing at the measured floor height show no gap, large
 * enough that the two surfaces never contend for the same depth.
 */
const FLOOR_SLAB_LIFT = 0.015;
/**
 * Lift wall and lobby surfaces in the approach shot. Well below white on
 * purpose: under a flat ambient of 6 anything near white clips out and the
 * room loses all its structure.
 */
const LOBBY_WALL = 0xa9aeb2;

export interface World {
  scene: THREE.Scene;
  cabGroup: THREE.Group;
  /** Height of the cab's floor above the cab group's origin. */
  cabFloorOffset: number;
  /** World Y of each floor's walkable surface, keyed by story. */
  floorTops: Map<number, number>;
  doorL: THREE.Group;
  doorR: THREE.Group;
  dioramas: Map<number, THREE.Group>;
  dioramaLights: Map<number, THREE.PointLight>;
  tower: THREE.Group;
  shell: THREE.Mesh;
  shaft: THREE.Group;
  counterweight: THREE.Mesh;
  cable: THREE.Mesh;
  slabs: THREE.InstancedMesh;
  stars: THREE.Points;
  moon: THREE.Mesh;
  roofDeck: THREE.Group;
  cabLight: THREE.PointLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;
  buttonHits: THREE.Mesh[];
  buttonPanel: THREE.Group;
  landingIndicator: THREE.Mesh | null;
  passengerRoots: Map<string, THREE.Group>;
  /** Rising plane that reveals the tower from the ground up. */
  towerClip: THREE.Plane;
  /** Height and plan width of the finale tower, for the build animation. */
  towerSize: { height: number; width: number };
  /** The tower's materials, for the night-to-paper palette cross-fade. */
  towerMaterials: THREE.MeshStandardMaterial[];
  /** Terrain, ridges, grass, stones and sky dome for the finale. */
  landscape: Landscape;
  /** Glowing line riding the top of the built section. */
  buildLine: THREE.Mesh;
  rain: THREE.LineSegments;
  snow: THREE.Points;
}

/** Falling precipitation around the tower, used only on the rooftop. */
function makeRain(count: number, spread: number, height: number): THREE.LineSegments {
  const pos = new Float32Array(count * 6);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * spread;
    const y = Math.random() * height;
    const z = (Math.random() - 0.5) * spread;
    const len = 2.6 + Math.random() * 3.4;
    pos[i * 6] = x;
    pos[i * 6 + 1] = y;
    pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x;
    pos[i * 6 + 4] = y - len;
    pos[i * 6 + 5] = z;
    speeds[i] = 60 + Math.random() * 55;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({
      color: 0xc8d8e8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    }),
  );
  mesh.userData = { speeds, spread, height };
  mesh.frustumCulled = false;
  return mesh;
}

function makeSnow(count: number, spread: number, height: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const drift = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * spread;
    speeds[i] = 5 + Math.random() * 7;
    drift[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xf4f6f8,
      // Small on purpose. The volume now travels with the camera, so flakes
      // pass close to the lens where size attenuation blows them up; at 1.5
      // the overdraw from those near flakes alone cost about ten frames.
      size: 0.7,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
      fog: false,
    }),
  );
  mesh.userData = { speeds, drift, spread, height };
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Stone floor tiles. Perspective convergence of the grout lines is what
 * actually makes a flat plane read as a floor.
 */
function makeFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#9d9a93";
  ctx.fillRect(0, 0, 512, 512);

  // Faint veining so each tile is not perfectly uniform.
  for (let i = 0; i < 700; i++) {
    const g = 150 + Math.random() * 45;
    ctx.fillStyle = `rgba(${g | 0}, ${(g - 3) | 0}, ${(g - 10) | 0}, 0.05)`;
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * 512,
      Math.random() * 512,
      6 + Math.random() * 46,
      3 + Math.random() * 16,
      Math.random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Four tiles per texture tile, with a darker recessed grout joint.
  ctx.strokeStyle = "#7c7972";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.moveTo(1, 0);
  ctx.lineTo(1, 512);
  ctx.moveTo(0, 1);
  ctx.lineTo(512, 1);
  ctx.stroke();
  // Highlight along one side of each joint for a chamfered edge.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(261, 0);
  ctx.lineTo(261, 512);
  ctx.moveTo(0, 261);
  ctx.lineTo(512, 261);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Oak plank flooring. The generated foyer bakes its lighting into its own
 * albedo, which reads as hard triangular wedges under our lights, so its
 * floor is covered with a clean procedural one.
 */
function makeWoodFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const PLANKS = 4;
  const w = 512 / PLANKS;

  for (let i = 0; i < PLANKS; i++) {
    const shade = 152 + Math.random() * 26;
    ctx.fillStyle = `rgb(${shade | 0}, ${(shade - 26) | 0}, ${(shade - 62) | 0})`;
    ctx.fillRect(i * w, 0, w, 512);

    // Grain running along the plank.
    for (let g = 0; g < 26; g++) {
      const gy = Math.random() * 512;
      ctx.strokeStyle = `rgba(${(shade - 34) | 0}, ${(shade - 58) | 0}, ${(shade - 86) | 0}, ${0.12 + Math.random() * 0.16})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(i * w + 3, gy);
      ctx.bezierCurveTo(
        i * w + w * 0.35, gy + (Math.random() - 0.5) * 16,
        i * w + w * 0.7, gy + (Math.random() - 0.5) * 16,
        i * w + w - 3, gy + (Math.random() - 0.5) * 10,
      );
      ctx.stroke();
    }

    // Plank seam plus a highlight on its far side.
    ctx.strokeStyle = "rgba(60, 40, 24, 0.55)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(i * w + 0.5, 0);
    ctx.lineTo(i * w + 0.5, 512);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 236, 208, 0.22)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(i * w + 2.6, 0);
    ctx.lineTo(i * w + 2.6, 512);
    ctx.stroke();
  }

  // Staggered butt joints across the planks.
  ctx.strokeStyle = "rgba(60, 40, 24, 0.5)";
  ctx.lineWidth = 2;
  for (let i = 0; i < PLANKS; i++) {
    const jy = ((i * 137) % 512);
    ctx.beginPath();
    ctx.moveTo(i * w, jy);
    ctx.lineTo(i * w + w, jy);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Push a room's side walls apart without resizing anything standing in it.
 *
 * Scaling the room in x would widen the walls and fatten every piece of
 * furniture with them, because a generated room is a single mesh. So this
 * displaces instead of scaling: vertices out near the left and right extremes
 * are translated outward by a fixed amount, and everything inboard of the
 * threshold is left exactly where it is. Walls move, furniture does not.
 *
 * Wall, floor and ceiling polygons span the threshold and simply stretch to
 * follow, which is what widens the room. Their texture stretches with them in
 * that outer band — the cost of keeping the furniture honest.
 *
 * Normals are untouched on purpose: the surfaces being moved face ±x, ±y or
 * ±z, and a translation along x leaves those unchanged.
 */
function widenRoomWalls(model: THREE.Object3D, targetWidth: number): void {
  model.updateWorldMatrix(true, true);
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    if (!pos) return;

    // Work in the geometry's own space, converting the wanted world width
    // through this mesh's x scale.
    const sx = new THREE.Vector3().setFromMatrixColumn(mesh.matrixWorld, 0).length();
    if (sx < 1e-6) return;

    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2;
    const halfLocal = (bb.max.x - bb.min.x) / 2;
    if (halfLocal < 1e-6) return;

    const growWorld = targetWidth / 2 - halfLocal * sx;
    if (growWorld <= 0) return;
    const growLocal = growWorld / sx;

    // Everything past this is wall and the outer reaches of floor and ceiling.
    // Furniture sits comfortably inboard of it.
    const threshold = halfLocal * 0.72;

    for (let i = 0; i < pos.count; i++) {
      const d = pos.getX(i) - cx;
      if (d > threshold) pos.setX(i, pos.getX(i) + growLocal);
      else if (d < -threshold) pos.setX(i, pos.getX(i) - growLocal);
    }
    pos.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  });
}

/**
 * A floor tone for a diorama, derived from that stop's ambient mood so each
 * floor keeps its identity. Darkened and pulled toward neutral: the mood colour
 * describes light in the room, and reused raw it reads as a lit panel rather
 * than something being stood on.
 */
function dioramaFloorColor(ambient: number): THREE.Color {
  const c = new THREE.Color(ambient);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s * 0.55, Math.min(0.34, hsl.l * 0.5));
}

/** Landing floor-indicator screen above the doors. */
export function drawLandingIndicator(
  world: World,
  label: string,
  dir: -1 | 0 | 1,
): void {
  const mesh = world.landingIndicator;
  if (!mesh) return;
  const canvas = mesh.userData.canvas as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0c0e0f";
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = "#ffb257";
  if (dir !== 0) {
    const cy = 48;
    ctx.beginPath();
    if (dir > 0) {
      ctx.moveTo(58, cy - 22);
      ctx.lineTo(78, cy + 14);
      ctx.lineTo(38, cy + 14);
    } else {
      ctx.moveTo(58, cy + 22);
      ctx.lineTo(78, cy - 14);
      ctx.lineTo(38, cy - 14);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = "700 58px 'Avenir Next', 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, dir === 0 ? 128 : 152, 50);
  (mesh.userData.texture as THREE.CanvasTexture).needsUpdate = true;
}

/** Plain brushed-steel sliding door leaf (placeholder for the Mint model). */
function makeProceduralDoorLeaf(): THREE.Group {
  const group = new THREE.Group();
  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 2.62, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0xe0e4e7,
      metalness: 0.92,
      roughness: 0.22,
    }),
  );
  leaf.position.y = 1.31;
  group.add(leaf);
  // Slim darker edge strip along the meeting edge, like real lift doors.
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 2.62, 0.065),
    new THREE.MeshStandardMaterial({
      color: 0x9aa0a4,
      metalness: 0.85,
      roughness: 0.4,
    }),
  );
  strip.position.set(0.59, 1.31, 0);
  group.add(strip);
  return group;
}

/** Small engraved-style label for a live floor button. */
function buttonLabelTexture(label: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#33373a";
  ctx.font = "600 30px 'Avenir Next', 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 32, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

export function buildWorld(assets: AssetMap): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x494f4a);
  scene.fog = new THREE.Fog(0x494f4a, 26, 110);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xcfd6c8, 0x33362f, 0.85);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x9aa094, 0.5);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.1);
  keyLight.position.set(3, 8, 6);
  scene.add(keyLight);

  // ---------- elevator cab ----------
  const cabGroup = new THREE.Group();
  scene.add(cabGroup);

  const cab = assets.get("elevator-cab");
  if (cab) cabGroup.add(cab);

  const cabLight = new THREE.PointLight(0xffe2b0, 10, 8, 1.6);
  cabLight.position.set(0, 2.35, 0);
  cabGroup.add(cabLight);
  // Soft warm fill so the cab walls read brighter without shifting the
  // scene's overall palette.
  const cabFill = new THREE.PointLight(0xfff6e8, 3, 6, 1.8);
  cabFill.position.set(0, 0.85, 0.3);
  cabGroup.add(cabFill);

  // Door pair: one panel, instanced and mirrored. PLACEHOLDER: generated
  // door leaves kept arriving with baked ornament and regens are blocked on
  // Mint credits, so a plain brushed-steel slab stands in for now.
  const doorL = new THREE.Group();
  const doorR = new THREE.Group();
  const panel = assets.get("door-panel") ?? makeProceduralDoorLeaf();
  if (panel) {
    doorL.add(panel);
    const clone = panel.clone(true);
    clone.scale.x *= -1;
    // Mirroring flips winding; give the clone its own double-sided materials
    // so single-sided faces stay visible.
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((mat) => {
          const copy = mat.clone();
          copy.side = THREE.DoubleSide;
          return copy;
        });
      } else {
        const copy = mesh.material.clone();
        copy.side = THREE.DoubleSide;
        mesh.material = copy;
      }
    });
    doorR.add(clone);
  }
  doorL.position.set(-DOOR_CLOSED_X, 0, DOOR_Z);
  doorR.position.set(DOOR_CLOSED_X, 0, DOOR_Z);
  cabGroup.add(doorL, doorR);

  // Steel control panel: 7 live floor buttons plus dummy placeholders, built
  // procedurally (the generated cab is prompted with bare walls).
  const buttonHits: THREE.Mesh[] = [];
  const panelGroup = new THREE.Group();
  panelGroup.position.set(-1.16, 1.32, -0.5);
  panelGroup.rotation.y = Math.PI / 2; // plate faces the cab centre (+x)
  cabGroup.add(panelGroup);

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 1.2, 0.025),
    new THREE.MeshStandardMaterial({
      color: 0xb4b8bb,
      metalness: 0.85,
      roughness: 0.32,
    }),
  );
  panelGroup.add(plate);

  const buttonGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.016, 20);
  buttonGeo.rotateX(Math.PI / 2);
  const hitGeo = new THREE.SphereGeometry(0.048, 8, 8);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const realMat = new THREE.MeshStandardMaterial({
    color: 0xdadddf,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0xc9a86a,
    emissiveIntensity: 0.12,
  });
  const dummyMat = new THREE.MeshStandardMaterial({
    color: 0x989da1,
    metalness: 0.85,
    roughness: 0.4,
  });

  const COLS = [-0.135, -0.045, 0.045, 0.135];
  const ROW0 = 0.47;
  const ROW_STEP = 0.128;
  // Real stops run down the third column, roof at the top.
  const REAL_COL = 2;
  const BUTTON_Z = 0.021;

  let realIndex = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      const x = COLS[col];
      const y = ROW0 - row * ROW_STEP;
      const isReal = col === REAL_COL && realIndex < BUTTON_FLOORS.length;
      const button = new THREE.Mesh(
        buttonGeo,
        (isReal ? realMat : dummyMat).clone(),
      );
      button.position.set(x, y, BUTTON_Z);
      button.userData.baseZ = BUTTON_Z;
      panelGroup.add(button);

      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.set(x, y, BUTTON_Z);
      panelGroup.add(hit);

      if (isReal) {
        const bf = BUTTON_FLOORS[realIndex++];
        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(0.034, 0.034),
          new THREE.MeshBasicMaterial({
            map: buttonLabelTexture(bf.label),
            transparent: true,
          }),
        );
        label.position.set(x, y, BUTTON_Z + 0.0095);
        panelGroup.add(label);
        hit.userData = { story: bf.story, label: bf.label, button };
      } else {
        hit.userData = { dummy: true, button };
      }
      buttonHits.push(hit);
    }
  }

  // ---------- floor dioramas ----------
  const dioramas = new Map<number, THREE.Group>();
  const dioramaLights = new Map<number, THREE.PointLight>();
  let landingIndicator: THREE.Mesh | null = null;
  for (const stop of STOPS) {
    if (!stop.dioramaKey) continue;
    const model = assets.get(stop.dioramaKey);
    if (stop.dioramaKey === "landing") {
      // The lift bay itself is always procedural so its aperture lines up
      // exactly with the cab doors. The room around it is the generated
      // foyer when available, or a plain shell when it is not.
      const foyer = assets.get("foyer");
      const holder = new THREE.Group();
      holder.position.set(0, storyY(stop.story), 0);
      const wallShape = new THREE.Shape();
      wallShape.moveTo(-12, 0);
      wallShape.lineTo(12, 0);
      wallShape.lineTo(12, 3.95);
      wallShape.lineTo(-12, 3.95);
      wallShape.closePath();
      // Aperture slightly smaller than the door pair (±1.2 × 2.62) so the
      // wall overlaps the panels on every edge — no see-through gaps.
      const doorHole = new THREE.Path();
      doorHole.moveTo(-1.15, 0);
      doorHole.lineTo(1.15, 0);
      doorHole.lineTo(1.15, 2.55);
      doorHole.lineTo(-1.15, 2.55);
      doorHole.closePath();
      wallShape.holes.push(doorHole);
      const wall = new THREE.Mesh(
        new THREE.ExtrudeGeometry(wallShape, { depth: 0.12, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({ color: LOBBY_WALL, roughness: 0.85 }),
      );
      wall.position.z = -1.38;
      holder.add(wall);
      const steelMat = new THREE.MeshStandardMaterial({
        color: 0xb4b8bb,
        metalness: 0.85,
        roughness: 0.3,
      });
      // Head casing and indicator sit proud of the wall's camera-facing
      // plane (z = -1.38); anything behind it is hidden from the lobby.
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.14, 0.1), steelMat);
      frame.position.set(0, 2.64, -1.43);
      holder.add(frame);
      for (const jx of [-1.42, 1.42]) {
        const jamb = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 2.72, 0.1),
          steelMat,
        );
        jamb.position.set(jx, 1.35, -1.43);
        holder.add(jamb);
      }

      // Floor indicator screen above the doors.
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.38, 0.09),
        new THREE.MeshStandardMaterial({
          color: 0x22262a,
          roughness: 0.45,
          metalness: 0.4,
        }),
      );
      housing.position.set(0, 3.02, -1.43);
      holder.add(housing);

      const indicatorCanvas = document.createElement("canvas");
      indicatorCanvas.width = 256;
      indicatorCanvas.height = 96;
      const indicatorTex = new THREE.CanvasTexture(indicatorCanvas);
      indicatorTex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.74, 0.26),
        new THREE.MeshBasicMaterial({ map: indicatorTex, toneMapped: false }),
      );
      screen.position.set(0, 3.02, -1.481);
      screen.rotation.y = Math.PI;
      screen.userData.canvas = indicatorCanvas;
      screen.userData.texture = indicatorTex;
      holder.add(screen);
      landingIndicator = screen;
      // The visitor now starts well back from the doors, so the bay needs a
      // real room around it: floor, ceiling and lighting down the approach.
      const LOBBY_BACK = -1.26;
      const LOBBY_FRONT = -17;
      const LOBBY_DEPTH = LOBBY_BACK - LOBBY_FRONT;
      const LOBBY_MID = (LOBBY_BACK + LOBBY_FRONT) / 2;
      // Sits just under the generated foyer's own ceiling, which measures
      // about 3.35. Held higher, a band opened up between the two through
      // which the foyer's roof structure — it carries geometry all the way to
      // 8.2 — was visible as stripes across the top of the approach shot.
      // Below it, this slab is simply the ceiling and everything above is
      // hidden behind it.
      const CEIL_Y = 3.26;

      if (foyer) {
        // Generated foyer: its open face is seated against the lift wall so
        // the visitor stands inside the room looking toward the doors.
        holder.add(foyer);
        // The generated foyer's albedo is near white, which under flat ambient
        // clips out to a featureless white field — the wall, its panels and the
        // ceiling all disappear into each other. Tinting the material scales
        // that albedo down so the room reads as light grey with its structure
        // visible. It is one mesh, so the tint necessarily reaches the whole
        // room; the wood floor laid over it keeps its own colour.
        foyer.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            if (std.color) std.color.setHex(LOBBY_WALL);
          }
        });
        const room = new THREE.Box3().setFromObject(foyer);
        foyer.position.z = -1.34 - room.max.z;
        // Clear of the shaft slab, which also sits at y = 0 and would
        // z-fight with the foyer's floor right in front of the doors.
        foyer.position.y = 0.025;
        // The generated room is open above its rear wall; cap the far end so
        // the sky does not show through behind the planting.
        const placed = new THREE.Box3().setFromObject(foyer);
        const backWall = new THREE.Mesh(
          new THREE.BoxGeometry(placed.max.x - placed.min.x + 1.5, CEIL_Y, 0.12),
          new THREE.MeshStandardMaterial({ color: LOBBY_WALL, roughness: 0.9 }),
        );
        // Keep it inside the ceiling's span, otherwise the sky shows in the
        // strip between the ceiling's far edge and the wall.
        backWall.position.set(
          0,
          CEIL_Y / 2,
          Math.max(placed.min.z + 0.4, LOBBY_FRONT + 0.07),
        );
        holder.add(backWall);

        // Close the sides too. The ceiling spans 24m but the generated foyer's
        // own walls are only about 11m apart, so without these the strip
        // between them showed the bare scene background as two dark wedges in
        // the upper corners of the approach shot.
        const sideX = (placed.max.x - placed.min.x + 1.5) / 2;
        for (const sx of [-sideX, sideX]) {
          const side = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, CEIL_Y, LOBBY_DEPTH),
            new THREE.MeshStandardMaterial({ color: LOBBY_WALL, roughness: 0.9 }),
          );
          side.position.set(sx, CEIL_Y / 2, LOBBY_MID);
          holder.add(side);
        }

        // Clean oak floor laid over the generated one, whose baked shading
        // shows as hard wedges once our own lights fall on it.
        const deckBack = -1.34;
        const deckFront = Math.max(placed.min.z, LOBBY_FRONT);
        const deckDepth = deckBack - deckFront;
        const deckWidth = placed.max.x - placed.min.x - 0.25;
        const woodTex = makeWoodFloorTexture();
        woodTex.repeat.set(deckWidth / 0.92, deckDepth / 2.6);
        const deck = new THREE.Mesh(
          new THREE.BoxGeometry(deckWidth, 0.05, deckDepth),
          new THREE.MeshStandardMaterial({
            map: woodTex,
            roughness: 0.72,
            metalness: 0,
          }),
        );
        deck.position.set(0, 0.045, (deckBack + deckFront) / 2);
        holder.add(deck);
      } else {
        const floor = new THREE.Mesh(
          new THREE.BoxGeometry(24, 0.1, LOBBY_DEPTH),
          // Matte tiled stone. A polished floor mirrors the environment at
          // grazing angles and blows out the whole lower frame.
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: (() => {
              const tex = makeFloorTexture();
              tex.repeat.set(24 / 2.6, LOBBY_DEPTH / 2.6);
              return tex;
            })(),
            roughness: 0.78,
            metalness: 0,
          }),
        );
        // Sits a hair above the shaft slab so the two never z-fight.
        floor.position.set(0, -0.03, LOBBY_MID);
        holder.add(floor);

        // Close the room off: without an end wall and returns, the view out
        // of the open cab doors runs straight past the lobby into empty sky.
        const roomMat = new THREE.MeshStandardMaterial({
          color: 0xb9b5ad,
          roughness: 0.92,
        });
        const endWall = new THREE.Mesh(
          new THREE.BoxGeometry(24, 3.95, 0.12),
          roomMat,
        );
        endWall.position.set(0, 1.975, LOBBY_FRONT);
        holder.add(endWall);
        for (const sx of [-12, 12]) {
          const side = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 3.95, LOBBY_DEPTH),
            roomMat,
          );
          side.position.set(sx, 1.975, LOBBY_MID);
          holder.add(side);
        }
      }

      const ceiling = new THREE.Mesh(
        new THREE.BoxGeometry(24, 0.12, LOBBY_DEPTH),
        new THREE.MeshStandardMaterial({
          color: LOBBY_WALL,
          roughness: 0.95,
          emissive: 0x3a3833,
          emissiveIntensity: 1,
        }),
      );
      ceiling.position.set(0, CEIL_Y, LOBBY_MID);
      holder.add(ceiling);

      // Recessed ceiling strips receding toward the lift.
      const stripMat = new THREE.MeshStandardMaterial({
        color: 0xfff6e6,
        emissive: 0xfff0d8,
        emissiveIntensity: 0.55,
        roughness: 0.4,
      });
      for (let i = 0; i < 5; i++) {
        const z = -2.9 - i * 2.9;
        for (const sx of [-3.1, 3.1]) {
          const strip = new THREE.Mesh(
            new THREE.BoxGeometry(2.4, 0.05, 0.34),
            stripMat,
          );
          // Hang the strips a clear 5cm below the ceiling slab. At the previous
          // offset their tops sat 5mm under it, and two large parallel surfaces
          // that close z-fight into a shimmering ribbed pattern across the
          // whole ceiling.
          strip.position.set(sx, CEIL_Y - 0.14, z);
          holder.add(strip);
        }
      }

      // No downlights aimed at the lift wall: they spill a hard glow under
      // the indicator and across the door heads. The ceiling fills alone
      // light this end of the room.
      for (let i = 0; i < 4; i++) {
        const z = -4.6 - i * 3.2;
        const fill = new THREE.PointLight(0xfff2e0, 2.0, 10, 1.8);
        fill.position.set(0, CEIL_Y - 0.4, z);
        holder.add(fill);
      }

      // Wall detailing so the bay still reads as a lobby from a distance: a
      // pair of panels flanking the doors. Detailing sits proud of the wall's
      // camera-facing plane (z = -1.38), not inside the extrusion.
      //
      // No skirting board: a dark stone strip along the foot of the wall read
      // as a brown band across the bottom of the approach shot rather than as
      // trim.
      const WALL_FACE = -1.4;
      const panelMat = new THREE.MeshStandardMaterial({
        color: 0xcfd2d4,
        roughness: 0.7,
      });
      for (const px of [-2.45, 2.45]) {
        const sidePanel = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 3.1, 0.05),
          panelMat,
        );
        sidePanel.position.set(px, 1.66, WALL_FACE);
        holder.add(sidePanel);
      }
      // Plain-shell furnishings. The generated foyer ships its own reception
      // desk, planting and seating, so these are only for the fallback room.
      if (!foyer) {
        const darkMat = new THREE.MeshStandardMaterial({
          color: 0x4b4b49,
          roughness: 0.6,
          metalness: 0.15,
        });
        const stoneMat = new THREE.MeshStandardMaterial({
          color: 0xa39c8e,
          roughness: 0.75,
        });
        const leafMat = new THREE.MeshStandardMaterial({
          color: 0x46614a,
          roughness: 0.85,
        });

        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(4.6, 1.05, 0.75),
          darkMat,
        );
        counter.position.set(-5.4, 0.52, -6.6);
        holder.add(counter);
        const counterTop = new THREE.Mesh(
          new THREE.BoxGeometry(4.8, 0.07, 0.9),
          stoneMat,
        );
        counterTop.position.set(-5.4, 1.08, -6.6);
        holder.add(counterTop);
        const backPanel = new THREE.Mesh(
          new THREE.BoxGeometry(5.4, 2.5, 0.12),
          stoneMat,
        );
        backPanel.position.set(-5.4, 1.25, -7.5);
        holder.add(backPanel);

        for (const pz of [-5.2, -9.4]) {
          const pot = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.7, 0.7),
            darkMat,
          );
          pot.position.set(3.9, 0.35, pz);
          holder.add(pot);
          const foliage = new THREE.Mesh(
            new THREE.SphereGeometry(0.62, 12, 10),
            leafMat,
          );
          foliage.position.set(3.9, 1.16, pz);
          foliage.scale.set(1, 1.25, 1);
          holder.add(foliage);
        }

        const bench = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.12, 0.62),
          stoneMat,
        );
        bench.position.set(5.2, 0.44, -12.2);
        holder.add(bench);
        for (const bx of [4.25, 6.15]) {
          const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.38, 0.5),
            darkMat,
          );
          leg.position.set(bx, 0.19, -12.2);
          holder.add(leg);
        }

        for (const cx of [-8.6, 8.6]) {
          for (const cz of [-5.4, -11.2]) {
            const column = new THREE.Mesh(
              new THREE.BoxGeometry(0.55, 3.95, 0.55),
              stoneMat,
            );
            column.position.set(cx, 1.975, cz);
            holder.add(column);
          }
        }
      }

      scene.add(holder);
      dioramas.set(stop.story, holder);
      continue;
    }
    if (!model) continue;
    const holder = new THREE.Group();
    holder.position.set(0, storyY(stop.story), DIORAMA_Z);
    holder.add(model);
    // Room depths vary per generated model; measure each one and seat its
    // front face just behind the door plane so nothing pokes into the cab.
    // The landing is special: its aperture wall (bbox +z side after yaw)
    // sits AT the door plane so the cab doors show inside its steel frame.
    // Spread the side walls out past the doorway so their ends are never in
    // frame. Done before the room is seated, since it changes the bounds.
    widenRoomWalls(model, ROOM_WIDTH);

    const roomBox = new THREE.Box3().setFromObject(model);
    model.position.z =
      stop.dioramaKey === "landing"
        ? 0.16 - roomBox.max.z
        : ROOM_FRONT_Z - roomBox.max.z;
    scene.add(holder);
    dioramas.set(stop.story, holder);
    // No room glow: it pooled a coloured hotspot across surfaces that are
    // already pure reflection, which is most of what read as haze. The rooms
    // now take only the scene's ambient and hemisphere. `dioramaLights` stays
    // in the World so the rest of the app keeps its shape; it is simply empty.
  }

  // ---------- shaft (x-ray view) ----------
  const shaft = new THREE.Group();
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x5a5f58,
    metalness: 0.4,
    roughness: 0.6,
  });
  const railGeo = new THREE.BoxGeometry(0.14, TOWER_HEIGHT, 0.14);
  const railL = new THREE.Mesh(railGeo, railMat);
  railL.position.set(-1.38, TOWER_HEIGHT / 2, 0.82);
  const railR = railL.clone();
  railR.position.x = 1.38;
  shaft.add(railL, railR);

  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x2e2e2a, roughness: 0.8 }),
  );
  shaft.add(cable);

  const counterweight = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.5, 0.22),
    new THREE.MeshStandardMaterial({
      color: 0x3c4038,
      metalness: 0.3,
      roughness: 0.7,
    }),
  );
  counterweight.position.z = 0.95;
  shaft.add(counterweight);
  scene.add(shaft);

  // ---------- passing floor slabs (seen in x-ray; sell vertical motion) ----------
  // Each slab has a rectangular cutout around the shaft so the cab, its
  // sliding doors, and the camera never intersect a floor while travelling.
  const slabCount = ROOF_STORY + 1;
  const slabShape = new THREE.Shape();
  slabShape.moveTo(-3.8, -3.8);
  slabShape.lineTo(3.8, -3.8);
  slabShape.lineTo(3.8, 3.8);
  slabShape.lineTo(-3.8, 3.8);
  slabShape.closePath();
  const shaftHole = new THREE.Path();
  // Shape y maps to world -z: rear edge z=+1.55, front (door-side) z=-1.35.
  shaftHole.moveTo(-2.3, -1.55);
  shaftHole.lineTo(2.3, -1.55);
  shaftHole.lineTo(2.3, 1.35);
  shaftHole.lineTo(-2.3, 1.35);
  shaftHole.closePath();
  slabShape.holes.push(shaftHole);
  const slabGeo = new THREE.ExtrudeGeometry(slabShape, {
    depth: 0.16,
    bevelEnabled: false,
  });
  slabGeo.rotateX(-Math.PI / 2);
  const slabMat = new THREE.MeshStandardMaterial({
    color: 0x3f453f,
    roughness: 0.9,
    transparent: true,
    opacity: 0.85,
  });
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, slabCount);
  const m = new THREE.Matrix4();
  for (let s = 0; s <= ROOF_STORY; s++) {
    m.setPosition(0, storyY(s) - 0.16, 0);
    slabs.setMatrixAt(s, m);
  }
  slabs.instanceMatrix.needsUpdate = true;
  scene.add(slabs);

  // ---------- translucent building shell (x-ray) ----------
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(8.6, TOWER_HEIGHT, 8.6),
    new THREE.MeshBasicMaterial({
      color: 0x76816f,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shell.position.y = TOWER_HEIGHT / 2;
  scene.add(shell);

  // ---------- sky ----------
  const starGeo = new THREE.BufferGeometry();
  const starCount = 700;
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 320 + Math.random() * 160;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.9);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 30;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: 0xe8e4d8,
      size: 0.9,
      transparent: true,
      opacity: 0.0,
      sizeAttenuation: false,
      fog: false,
    }),
  );
  scene.add(stars);

  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(18, 40),
    new THREE.MeshBasicMaterial({
      color: 0xe9ded0,
      transparent: true,
      opacity: 0,
      fog: false,
    }),
  );
  moon.position.set(-90, storyY(ROOF_STORY) + 70, -260);
  scene.add(moon);

  // ---------- ground lobby light (intro shot) ----------
  const lobbyLight = new THREE.PointLight(0xfff2dd, 4, 11, 1.6);
  lobbyLight.position.set(0, 3.0, -3.2);
  scene.add(lobbyLight);

  // ---------- roof deck ----------
  const roofDeck = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(10.5, 0.3, 10.5),
    new THREE.MeshStandardMaterial({ color: 0x494f47, roughness: 0.95 }),
  );
  deck.position.y = storyY(ROOF_STORY) - 0.15;
  roofDeck.add(deck);
  const parapetMat = new THREE.MeshStandardMaterial({
    color: 0x3c423b,
    roughness: 0.9,
  });
  for (const [px, pz, w, d] of [
    [0, -5.1, 10.5, 0.3],
    [0, 5.1, 10.5, 0.3],
    [-5.1, 0, 0.3, 10.5],
    [5.1, 0, 0.3, 10.5],
  ]) {
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), parapetMat);
    parapet.position.set(px, storyY(ROOF_STORY) + 0.5, pz);
    roofDeck.add(parapet);
  }
  scene.add(roofDeck);

  // ---------- tower (finale reveal) ----------
  // Generated, not loaded: the keep is built from primitives at runtime so the
  // style can change without swapping an asset. Clips against a rising plane,
  // so it assembles from the ground up with nothing animated per-member.
  const towerClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const finaleTower = buildFinaleTower(TOWER_HEIGHT, towerClip);
  const tower = finaleTower.group;
  const towerMaterials = finaleTower.materials;
  tower.visible = false;
  scene.add(tower);
  const towerSize = finaleTower.size;

  // The world the tower stands in. Authored at the keep's native scale and
  // scaled by the same factor, so hills, grass and building stay in the
  // proportions they were designed for.
  const landscape = buildLandscape({ scale: tower.scale.x });
  landscape.group.visible = false;
  landscape.sky.visible = false;
  scene.add(landscape.group, landscape.sky);

  // Bright seam riding the top of the finished section.
  const buildLine = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.5, 1),
    new THREE.MeshBasicMaterial({
      color: 0xfff2d8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    }),
  );
  buildLine.visible = false;
  scene.add(buildLine);

  // Sized to travel with the camera during the finale rather than to sit over
  // the tower, so the fall reaches the edges of the frame however far the
  // camera pulls back. Counts are up with the volume to hold the density.
  const rain = makeRain(6000, 660, 660);
  const snow = makeSnow(5000, 660, 660);
  rain.visible = false;
  snow.visible = false;
  scene.add(rain, snow);

  // ---------- passengers ----------
  const passengerRoots = new Map<string, THREE.Group>();
  for (const def of PASSENGERS) {
    const model = assets.get(def.key);
    if (!model) continue;
    const root = new THREE.Group();
    root.add(model);
    root.userData = { passengerKey: def.key };
    root.traverse((o) => {
      o.userData.passengerKey = def.key;
    });
    // The hotel guest's suitcase is generated as a bare frame with no panels,
    // so it reads as see-through. Fill it. Measured in her local space, the
    // frame occupies x -0.34..-0.17, y 0.36..0.83, z -0.21..0.31; this body is
    // inset slightly inside that so the frame still reads as its edging.
    if (def.key === "passenger-guest") {
      const caseBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.44, 0.49),
        new THREE.MeshStandardMaterial({
          color: 0xa2855e,
          roughness: 1,
          metalness: 0,
          envMapIntensity: 0,
        }),
      );
      caseBody.position.set(-0.255, 0.595, 0.05);
      caseBody.userData.passengerKey = def.key;
      root.add(caseBody);
    }

    scene.add(root);
    passengerRoots.set(def.key, root);
  }

  // Measure walkable surfaces. Generated rooms carry their own floor slabs,
  // so a passenger placed at the story's origin stands buried up to the
  // ankles; sample each room and the cab for the real standing height.
  scene.updateMatrixWorld(true);
  const probe = new THREE.Raycaster();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  function surfaceY(
    target: THREE.Object3D,
    baseY: number,
    samples: [number, number][],
  ): number {
    // Per sample take the topmost floor-height surface (skipping ceilings and
    // handrails, and ignoring the slab's underside); across samples take the
    // lowest, so a probe that landed on a desk or bench is discarded.
    let best = Number.POSITIVE_INFINITY;
    for (const [sx, sz] of samples) {
      probe.set(origin.set(sx, baseY + 3.2, sz), DOWN);
      let top = Number.NEGATIVE_INFINITY;
      for (const hit of probe.intersectObject(target, true)) {
        const dy = hit.point.y - baseY;
        if (dy >= -0.06 && dy < 0.6) top = Math.max(top, hit.point.y);
      }
      if (Number.isFinite(top)) best = Math.min(best, top);
    }
    return Number.isFinite(best) ? best : baseY;
  }

  const cabFloorOffset =
    surfaceY(cabGroup, 0, [
      [0, 0],
      [0.6, -0.4],
      [-0.6, 0.3],
    ]) - 0;

  const floorTops = new Map<number, number>();
  for (const [story, holder] of dioramas) {
    floorTops.set(
      story,
      surfaceY(holder, storyY(story), [
        [0, -2.8],
        [1.4, -3.4],
        [-1.4, -3.4],
      ]),
    );
  }

  // ---------- solid diorama floors ----------
  // The generated rooms are a single mesh with metalness 1, so their floor has
  // no diffuse colour at all — it renders as environment smeared across rough
  // metal, which reads as a blur rather than a surface. Lay an opaque slab over
  // it at the height the passengers actually stand on, the same way the ground
  // floor gets a clean oak floor over its baked one.
  for (const [story, holder] of dioramas) {
    if (story === 0) continue;
    const stop = STOPS.find((s) => s.story === story);
    if (!stop) continue;

    const top = floorTops.get(story) ?? storyY(story);
    holder.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(holder);
    if (!isFinite(box.min.x) || box.isEmpty()) continue;

    // Slightly overfill the room so no seam of the original floor shows at the
    // walls, and stop just short of the door plane so it never enters the cab.
    const pad = 0.3;
    const width = box.max.x - box.min.x + pad * 2;
    const zBack = box.min.z - pad;
    const zFront = Math.min(box.max.z, DIORAMA_Z + 0.06);
    const depth = Math.max(0.5, zFront - zBack);

    const floorTone = dioramaFloorColor(stop.mood.ambient);
    // The penthouse is boarded in oak rather than laid in stone, so it takes
    // the same plank texture the ground-floor foyer uses, in a lighter tone.
    const woodFloor = story === 60;
    if (woodFloor) floorTone.setHex(0xc8a678);

    const floorMat = new THREE.MeshStandardMaterial({
      color: floorTone,
      map: woodFloor ? (() => {
        const t = makeWoodFloorTexture();
        t.repeat.set(2.4, 1.4);
        return t;
      })() : null,
      roughness: 0.98,
      metalness: 0,
      // The scene environment is what puts the sheen on everything else here.
      // A floor asked to be solid must not take any of it.
      envMapIntensity: 0,
    });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), floorMat);
    slab.receiveShadow = true;
    slab.position.set(
      (box.min.x + box.max.x) / 2 - holder.position.x,
      // Sit the slab's face a hair PROUD of the room's own floor. Landing it
      // exactly on `top` put two large parallel surfaces at identical depth,
      // which z-fights into bands sweeping across the floor as the car moves.
      top - holder.position.y - 0.03 + FLOOR_SLAB_LIFT,
      (zBack + zFront) / 2 - holder.position.z,
    );
    holder.add(slab);

    // Set dressing, laid over the generated room for the same reason the slab
    // is: nothing inside a single-mesh room can be changed on its own.
    const standY = top - holder.position.y + FLOOR_SLAB_LIFT;
    if (story === 12) addOfficeProps(holder, standY);
    if (story === 60) addPenthouseProps(holder, standY, standY + 3.0);
  }

  return {
    scene,
    cabGroup,
    cabFloorOffset,
    floorTops,
    doorL,
    doorR,
    dioramas,
    dioramaLights,
    tower,
    shell,
    shaft,
    counterweight,
    cable,
    slabs,
    stars,
    moon,
    roofDeck,
    cabLight,
    hemi,
    ambient,
    keyLight,
    buttonHits,
    buttonPanel: panelGroup,
    landingIndicator,
    passengerRoots,
    towerClip,
    towerSize,
    towerMaterials,
    landscape,
    buildLine,
    rain,
    snow,
  };
}
