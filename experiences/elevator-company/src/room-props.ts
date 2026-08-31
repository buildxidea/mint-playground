/**
 * Hand-built set dressing for the generated rooms.
 *
 * The generated rooms are each a single mesh sharing one material, so nothing
 * inside them can be recoloured or replaced on its own. Anything that needs to
 * read differently has to be built and laid over the top — which is also how
 * the ground floor already gets its clean oak floor.
 *
 * Everything here is authored in holder-local space: the holder sits at
 * (0, storyY, DIORAMA_Z), so local z is world z + 1.4.
 *
 * Lighting is a single flat ambient (see flat-look.ts), so "lit" fittings are
 * MeshBasicMaterial — unlit, and therefore rendered at their full colour
 * regardless of the scene. That reads as a lamp being on without reintroducing
 * any of the glow that was deliberately removed.
 */

import * as THREE from "three";

// Same tones as the rest of the page, just opaque.
const CREAM = 0xe4dfd2;
const UPHOLSTERY = 0xd8d2c4;
const BRASS = 0xc9a86a;
const LAMP_ON = 0xfff2d4;
const LEAF_A = 0x5f7d4f;
const LEAF_B = 0x496b3d;

const matte = (color: number, roughness = 1) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMapIntensity: 0 });

/** Unlit, so it reads as a fitting that is switched on. */
const lit = (color = LAMP_ON) => new THREE.MeshBasicMaterial({ color });

function box(
  parent: THREE.Object3D,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  ry = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

function cyl(
  parent: THREE.Object3D,
  mat: THREE.Material,
  rTop: number,
  rBot: number,
  h: number,
  x: number,
  y: number,
  z: number,
  seg = 12,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * A potted shrub.
 *
 * Built from overlapping rounded clumps rather than long flat blades: blades
 * read as scattered shards from any angle where they are edge-on, which is
 * most of them. Clumps hold their shape from everywhere.
 */
function plant(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  scale = 1,
): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  parent.add(g);

  // Glazed pot.
  cyl(g, matte(0x6f6553, 0.85), 0.24, 0.17, 0.36, 0, 0.18, 0);
  cyl(g, matte(0x7d7361, 0.8), 0.26, 0.26, 0.05, 0, 0.365, 0);
  cyl(g, matte(0x3a332a, 1), 0.22, 0.22, 0.04, 0, 0.385, 0);

  const leafA = matte(LEAF_A, 0.95);
  const leafB = matte(LEAF_B, 0.95);

  // A few woody stems so the canopy has something to sit on.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const st = cyl(g, matte(0x5a4a38, 0.95), 0.022, 0.03, 0.42, Math.cos(a) * 0.05, 0.6, Math.sin(a) * 0.05, 6);
    st.rotation.z = Math.cos(a) * 0.16;
  }

  // Canopy: clumps on two tiers, sized down toward the crown.
  const tiers: [number, number, number][] = [
    [0.78, 0.34, 7],
    [1.02, 0.26, 6],
    [1.2, 0.17, 4],
  ];
  let n = 0;
  for (const [cy, spread, count] of tiers) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + cy * 2.1;
      const r = spread * (0.55 + ((n * 29) % 7) / 7 * 0.45);
      const s = 0.17 + ((n * 41) % 9) / 9 * 0.1;
      const clump = new THREE.Mesh(
        new THREE.IcosahedronGeometry(s, 1),
        n % 2 ? leafA : leafB,
      );
      clump.position.set(Math.cos(a) * r, cy + ((n * 17) % 5) / 5 * 0.08, Math.sin(a) * r);
      clump.scale.set(1, 0.82, 1);
      g.add(clump);
      n++;
    }
  }
}

/** Floor lamp with a shade that is switched on. */
function floorLamp(parent: THREE.Object3D, x: number, y: number, z: number): void {
  const brass = matte(BRASS, 0.6);
  cyl(parent, brass, 0.16, 0.19, 0.04, x, y + 0.02, z);
  cyl(parent, brass, 0.025, 0.025, 1.5, x, y + 0.77, z, 8);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.29, 0.34, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: LAMP_ON, side: THREE.DoubleSide }),
  );
  shade.position.set(x, y + 1.66, z);
  parent.add(shade);
  // Caps the top so the shade does not read as an open tube from above.
  cyl(parent, lit(), 0.2, 0.2, 0.02, x, y + 1.82, z, 16);
}

/** Multi-arm chandelier, hung from the ceiling. */
function chandelier(
  parent: THREE.Object3D,
  x: number,
  ceilY: number,
  z: number,
): void {
  const brass = matte(BRASS, 0.55);
  const drop = 0.62;
  cyl(parent, brass, 0.03, 0.03, drop, x, ceilY - drop / 2, z, 8);
  cyl(parent, brass, 0.14, 0.1, 0.09, x, ceilY - drop - 0.04, z);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.022, 8, 28), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, ceilY - drop - 0.3, z);
  parent.add(ring);

  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.018, 8, 22), brass);
  inner.rotation.x = Math.PI / 2;
  inner.position.set(x, ceilY - drop - 0.02, z);
  parent.add(inner);

  const ARMS = 8;
  for (let i = 0; i < ARMS; i++) {
    const a = (i / ARMS) * Math.PI * 2;
    const px = x + Math.cos(a) * 0.52;
    const pz = z + Math.sin(a) * 0.52;
    cyl(parent, brass, 0.02, 0.02, 0.2, px, ceilY - drop - 0.19, pz, 6);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), lit());
    bulb.position.set(px, ceilY - drop - 0.05, pz);
    parent.add(bulb);
  }
}

/** A wide, low sofa with proper arms and cushions. */
function sofa(parent: THREE.Object3D, x: number, y: number, z: number, ry = 0): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  parent.add(g);

  const body = matte(UPHOLSTERY, 0.95);
  const legs = matte(BRASS, 0.5);

  box(g, body, 2.5, 0.3, 0.95, 0, 0.42, 0);
  box(g, body, 2.5, 0.62, 0.22, 0, 0.79, -0.37);
  box(g, body, 0.24, 0.52, 0.95, -1.13, 0.68, 0);
  box(g, body, 0.24, 0.52, 0.95, 1.13, 0.68, 0);
  for (const cx of [-0.56, 0.56]) box(g, matte(CREAM, 0.95), 1.06, 0.16, 0.82, cx, 0.63, 0.03);
  for (const [lx, lz] of [[-1.05, 0.38], [1.05, 0.38], [-1.05, -0.38], [1.05, -0.38]])
    cyl(g, legs, 0.035, 0.035, 0.28, lx, 0.14, lz, 8);
}

function armchair(parent: THREE.Object3D, x: number, y: number, z: number, ry: number): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  parent.add(g);
  const body = matte(UPHOLSTERY, 0.95);
  box(g, body, 0.92, 0.28, 0.86, 0, 0.44, 0);
  box(g, body, 0.92, 0.58, 0.2, 0, 0.78, -0.33);
  box(g, body, 0.18, 0.44, 0.86, -0.37, 0.66, 0);
  box(g, body, 0.18, 0.44, 0.86, 0.37, 0.66, 0);
  box(g, matte(CREAM, 0.95), 0.7, 0.14, 0.72, 0, 0.63, 0.02);
  for (const [lx, lz] of [[-0.34, 0.32], [0.34, 0.32], [-0.34, -0.32], [0.34, -0.32]])
    cyl(g, matte(BRASS, 0.5), 0.03, 0.03, 0.3, lx, 0.15, lz, 8);
}

/** Oakwood tones for the Japanese interior on floor 60. */
const OAK_LIGHT = 0xb99a6f;
const OAK_MID = 0xa07f57;
const OAK_DARK = 0x6b5136;
const SHOJI = 0xe6dcc6;

/**
 * A shoji screen: a paper panel behind a dark timber lattice. Built as one
 * panel plus its bars rather than a texture, so it holds up close.
 */
function shoji(
  parent: THREE.Object3D,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
): void {
  const paper = matte(SHOJI, 1);
  const frame = matte(OAK_DARK, 0.9);
  box(parent, paper, w, h, 0.04, x, y, z);
  // Outer frame.
  box(parent, frame, w, 0.07, 0.06, x, y + h / 2, z + 0.02);
  box(parent, frame, w, 0.07, 0.06, x, y - h / 2, z + 0.02);
  box(parent, frame, 0.07, h, 0.06, x - w / 2, y, z + 0.02);
  box(parent, frame, 0.07, h, 0.06, x + w / 2, y, z + 0.02);
  // Lattice: three verticals, four horizontals.
  for (let i = 1; i <= 3; i++)
    box(parent, frame, 0.035, h, 0.05, x - w / 2 + (w * i) / 4, y, z + 0.02);
  for (let i = 1; i <= 4; i++)
    box(parent, frame, w, 0.03, 0.05, x, y - h / 2 + (h * i) / 5, z + 0.02);
}

/**
 * Floor 60 — a Japanese room in oak rather than the generated interior.
 *
 * The generated room carries a dark media unit whose near face measures at
 * world z -5.17, so the new back wall has to sit in front of that to cover it;
 * at -5.85 it was hidden behind the very thing it was meant to hide. That puts
 * the room at 3.6 deep, which is still well clear of where the passengers
 * stand.
 */
export function addPenthouseProps(
  holder: THREE.Group,
  floorY: number,
  ceilY: number,
): void {
  const BACK_Z = -3.62;
  const H = ceilY - floorY;
  const midY = (floorY + ceilY) / 2;
  const oak = matte(OAK_LIGHT, 1);
  const oakMid = matte(OAK_MID, 0.95);
  const oakDark = matte(OAK_DARK, 0.9);

  // ---------- shell ----------
  box(holder, oak, 11.0, H, 0.1, 0, midY, BACK_Z);
  for (const sx of [-5.36, 5.36]) box(holder, oak, 0.1, H, 3.7, sx, midY, -1.85);
  box(holder, matte(OAK_MID, 1), 11.0, 0.1, 3.7, 0, ceilY, -1.85);

  // Vertical battens down the back wall, and a rail at picture height — the
  // pattern is what makes flat boards read as panelling.
  for (let i = -5; i <= 5; i++)
    box(holder, oakDark, 0.07, H, 0.05, i * 0.98, midY, BACK_Z + 0.07);
  box(holder, oakDark, 11.0, 0.09, 0.06, 0, floorY + H * 0.62, BACK_Z + 0.08);
  // Skirting and a ceiling rail, both in the darker oak.
  box(holder, oakDark, 11.0, 0.14, 0.07, 0, floorY + 0.07, BACK_Z + 0.08);
  for (const bz of [-0.6, -1.85, -3.1])
    box(holder, oakDark, 11.0, 0.12, 0.14, 0, ceilY - 0.08, bz);

  // Shoji screens across the back wall, lit from behind.
  const sw = 1.5;
  for (const sx of [-3.3, -1.65, 1.65, 3.3])
    shoji(holder, sw, H * 0.62, sx, floorY + H * 0.44, BACK_Z + 0.1);

  // ---------- furnishings ----------
  chandelier(holder, 0, ceilY, -1.9);

  // A low table on a tatami-toned mat, kept back from where people walk.
  box(holder, matte(0xc3bb9c, 1), 3.6, 0.03, 1.9, 0, floorY + 0.016, -2.5);
  box(holder, oakDark, 3.75, 0.02, 2.05, 0, floorY + 0.008, -2.5);
  box(holder, oakMid, 1.5, 0.07, 0.72, 0, floorY + 0.36, -2.5);
  for (const [lx, lz] of [[-0.62, -2.24], [0.62, -2.24], [-0.62, -2.76], [0.62, -2.76]])
    box(holder, oakDark, 0.09, 0.34, 0.09, lx, floorY + 0.17, lz);

  sofa(holder, -3.5, floorY, -2.7, Math.PI / 2.2);
  armchair(holder, 3.4, floorY, -2.5, -Math.PI / 2.2);

  // Sideboard with a pair of lit paper lamps.
  const CONSOLE_Z = -3.3;
  box(holder, oakMid, 2.4, 0.08, 0.4, 0, floorY + 0.72, CONSOLE_Z);
  box(holder, oakDark, 2.4, 0.6, 0.36, 0, floorY + 0.38, CONSOLE_Z);
  for (const lx of [-0.8, 0.8]) {
    cyl(holder, oakDark, 0.04, 0.07, 0.1, lx, floorY + 0.81, CONSOLE_Z, 10);
    const lantern = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.3, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: LAMP_ON, side: THREE.DoubleSide }),
    );
    lantern.position.set(lx, floorY + 1.01, CONSOLE_Z);
    holder.add(lantern);
    cyl(holder, lit(), 0.15, 0.15, 0.02, lx, floorY + 1.16, CONSOLE_Z, 14);
  }

  floorLamp(holder, -4.5, floorY, -1.6);
  floorLamp(holder, 4.5, floorY, -2.9);

  plant(holder, 2.15, floorY, -3.15, 1.25);
  plant(holder, -2.3, floorY, -3.15, 1.05);
  plant(holder, 4.5, floorY, -3.3, 0.95);
}

/**
 * Floor 12 — the built-in shelving reads as a set of coloured stripes rather
 * than as shelves, so a proper case is laid over it. Its near face measures at
 * world z -6.49 around x 2.2 to 2.6, which is where this sits.
 *
 * No monitors: the pair added here previously stood in front of the desk's own
 * screens and read as clutter.
 */
export function addOfficeProps(holder: THREE.Group, floorY: number): void {
  // ---------- monitors ----------
  // The desk's own screens are thin, near-wireframe geometry that reads as
  // dark slivers. Solid white panels are set just in front of them, sized to
  // cover: measured, the originals span x -0.9 to 0.8 and reach 1.67 above the
  // floor, sitting between z -3.46 and -3.85 (local -2.06 to -2.45).
  const bezel = matte(0x14151a, 0.85);
  const glass = matte(0xbcd7ea, 0.6);
  const DESK_TOP = floorY + 0.92;
  for (const [mx, mz] of [
    [-0.62, -2.12],
    [0.36, -2.2],
  ]) {
    box(holder, bezel, 0.34, 0.02, 0.2, mx, DESK_TOP + 0.01, mz);
    box(holder, bezel, 0.06, 0.24, 0.06, mx, DESK_TOP + 0.13, mz);
    const panel = box(holder, bezel, 0.86, 0.56, 0.035, mx, DESK_TOP + 0.53, mz);
    panel.rotation.x = -0.05;
    // The screen sits proud of the case on the +z face, which is the side the
    // camera is on, leaving the black surround visible as a border.
    const screen = box(holder, glass, 0.78, 0.47, 0.01, mx, DESK_TOP + 0.53, mz + 0.024);
    screen.rotation.x = -0.05;
  }

  // ---------- shelving ----------
  const caseMat = matte(OAK_MID, 0.95);
  // Close to the office's own wall tone, so the panel that hides the original
  // banding does not itself read as a dark slab pinned behind the shelves.
  const backMat = matte(0xa9aca3, 1);
  const X = 2.45;
  // The built-in shelving's nearest face measures at world -6.31, so the case
  // has to sit in front of that. At -6.42 the original's coloured bands showed
  // straight through it as black and red streaks across the shelves.
  const Z = -4.62;
  const W = 1.9;
  const HGT = 2.15;

  // Wider and taller than the case itself: the original's coloured bands run
  // past the shelving on both sides, and anything they overhang still shows.
  box(holder, backMat, W + 3.2, HGT + 0.7, 0.05, X + 0.35, floorY + (HGT + 0.7) / 2, Z - 0.16);
  box(holder, caseMat, 0.09, HGT, 0.36, X - W / 2, floorY + HGT / 2, Z);
  box(holder, caseMat, 0.09, HGT, 0.36, X + W / 2, floorY + HGT / 2, Z);
  box(holder, caseMat, W, 0.08, 0.36, X, floorY + HGT, Z);
  box(holder, caseMat, W, 0.1, 0.36, X, floorY + 0.05, Z);

  const SHELVES = 4;
  const bookTones = [0x8a4b3c, 0x3f5668, 0x6b7a4a, 0x7a6a4e, 0x4a4550, 0x93764a];
  for (let s = 1; s <= SHELVES; s++) {
    const sy = floorY + (HGT * s) / (SHELVES + 1);
    box(holder, caseMat, W - 0.1, 0.05, 0.34, X, sy, Z);
    // Books: a run of upright slabs of varying width, height and tone.
    let bx = X - W / 2 + 0.12;
    let i = s * 7;
    while (bx < X + W / 2 - 0.16) {
      const bw = 0.05 + ((i * 31) % 6) / 6 * 0.07;
      const bh = 0.26 + ((i * 17) % 5) / 5 * 0.1;
      box(holder, matte(bookTones[i % bookTones.length], 1), bw, bh, 0.26, bx + bw / 2, sy + 0.025 + bh / 2, Z);
      bx += bw + 0.012;
      i++;
    }
  }
}
