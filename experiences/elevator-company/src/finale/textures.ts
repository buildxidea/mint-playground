/**
 * Procedural surfaces for the finale tower.
 *
 * Every map here is painted into a canvas at runtime — no image assets, no
 * network. Bump and roughness are *derived* from each colour map rather than
 * authored separately, so one painted surface does the work of three.
 *
 * Technique follows MengTo/towers (unlicensed — reimplemented, not copied);
 * towers used AI-generated WebP source images where these are painted in code.
 */

import * as THREE from "three";

// ---------- deterministic noise ----------

/** Small fast PRNG. Seeded so the tower is identical on every rebuild. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Noise2D = (x: number, y: number) => number;

/** Value noise on a 256x256 lattice with smoothstep interpolation. */
export function makeNoise(seed: number): Noise2D {
  const rnd = mulberry32(seed),
    p = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) p[i] = rnd();
  const at = (x: number, y: number) => p[((y & 255) << 8) + (x & 255)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  return function (x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      xf = sm(x - xi),
      yf = sm(y - yi);
    const a = at(xi, yi),
      b = at(xi + 1, yi),
      c = at(xi, yi + 1),
      d = at(xi + 1, yi + 1);
    return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
  };
}

/** Fractal sum of `oct` octaves, normalised to roughly 0..1. */
export function fbm(
  n: Noise2D,
  x: number,
  y: number,
  oct: number,
  gain = 0.5
): number {
  let s = 0,
    a = 0.5,
    f = 1,
    tot = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(x * f, y * f);
    tot += a;
    a *= gain;
    f *= 2;
  }
  return s / tot;
}

// ---------- canvas helpers ----------

export function cv(w: number, h?: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h || w;
  return c;
}

function ctx(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d");
  if (!g) throw new Error("2d context unavailable");
  return g;
}

/** Colour map — sRGB, tiling, anisotropic. */
export function toTex(c: HTMLCanvasElement, rx = 1, ry = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Data map (bump, roughness) — stays linear, never colour-managed. */
export function toLin(c: HTMLCanvasElement, rx = 1, ry = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

/**
 * Height field from a colour map's luminance, centred on the map's own mean so
 * a dark surface doesn't come out uniformly sunken.
 */
export function bumpFrom(
  src: HTMLCanvasElement,
  strength = 1
): HTMLCanvasElement {
  const w = src.width,
    h = src.height;
  const a = ctx(src).getImageData(0, 0, w, h).data;
  let mean = 0;
  for (let i = 0; i < a.length; i += 4)
    mean += a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11;
  mean /= a.length / 4;

  const out = cv(w, h),
    g2 = ctx(out),
    img = g2.createImageData(w, h),
    o = img.data;
  for (let i = 0; i < a.length; i += 4) {
    const v = a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11;
    const m = Math.max(0, Math.min(255, 128 + (v - mean) * strength));
    o[i] = o[i + 1] = o[i + 2] = m;
    o[i + 3] = 255;
  }
  g2.putImageData(img, 0, 0);
  return out;
}

/** Rougher where the surface reads darker and more porous. */
export function roughFrom(
  src: HTMLCanvasElement,
  lo: number,
  hi: number
): HTMLCanvasElement {
  const w = src.width,
    h = src.height;
  const a = ctx(src).getImageData(0, 0, w, h).data;
  const out = cv(w, h),
    g2 = ctx(out),
    img = g2.createImageData(w, h),
    o = img.data;
  for (let i = 0; i < a.length; i += 4) {
    const v = (a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) / 255;
    const r = Math.max(0, Math.min(255, 255 * (hi - (hi - lo) * v)));
    o[i] = o[i + 1] = o[i + 2] = r;
    o[i + 3] = 255;
  }
  g2.putImageData(img, 0, 0);
  return out;
}

/** Paint a canvas pixel by pixel from a colour function. */
function paint(
  S: number,
  fn: (x: number, y: number) => [number, number, number]
): HTMLCanvasElement {
  const c = cv(S),
    g = ctx(c),
    img = g.createImageData(S, S),
    d = img.data;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const [r, gg, b] = fn(x, y);
      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, gg));
      d[i + 2] = Math.max(0, Math.min(255, b));
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- painted surfaces ----------

/**
 * 石垣 — the battered stone base. Irregular polygonal blocks with deep joints,
 * laid in courses that jitter so no two rows line up.
 */
export function texIshigaki(seed = 11): HTMLCanvasElement {
  const S = 512,
    n = makeNoise(seed),
    rnd = mulberry32(seed ^ 0x5f);
  // Pre-roll a per-course offset so joints stagger rather than stack.
  const rows = 9;
  const rowOff: number[] = [];
  for (let i = 0; i < rows; i++) rowOff.push(rnd());

  return paint(S, (x, y) => {
    const fy = (y / S) * rows;
    const row = Math.floor(fy);
    const inRow = fy - row;
    const cols = 7;
    const fx = (x / S) * cols + rowOff[row % rows] * 3;
    const col = Math.floor(fx);
    const inCol = fx - col;

    // Wobble the block edges with noise so the joints read as split stone.
    const wob = (fbm(n, x / 26, y / 26, 3, 0.55) - 0.5) * 0.16;
    const edge = Math.min(
      Math.min(inRow + wob, 1 - inRow + wob),
      Math.min(inCol + wob, 1 - inCol + wob)
    );
    const joint = Math.max(0, Math.min(1, edge / 0.09));

    // Each block gets its own base value so the wall reads as many stones.
    const stone = mulberry32((row * 73856093) ^ (col * 19349663))();
    const grain = fbm(n, x / 9, y / 9, 3, 0.5);
    const l = (0.62 + stone * 0.24 + grain * 0.22) * (0.42 + joint * 0.58);
    return [150 * l, 146 * l, 133 * l];
  });
}

/**
 * 白壁 — lime plaster. Nearly flat, with a faint trowel drift and the odd
 * hairline crack, otherwise it reads as plastic.
 */
export function texPlaster(seed = 23): HTMLCanvasElement {
  const S = 256,
    n = makeNoise(seed);
  return paint(S, (x, y) => {
    const drift = fbm(n, x / 60, y / 60, 3, 0.5);
    const tooth = fbm(n, x / 5, y / 5, 2, 0.5);
    // A sparse crack field: only the thin ridge near 0.5 darkens.
    const cr = Math.abs(fbm(n, x / 90, y / 34, 2, 0.6) - 0.5);
    const crack = cr < 0.012 ? 0.72 : 1;
    const l = (0.9 + drift * 0.12 + tooth * 0.06) * crack;
    return [238 * l, 233 * l, 220 * l];
  });
}

/**
 * 本瓦 — clay roof tile. Horizontal courses of pantile, each course darker at
 * its overlap, with soot and weathering pooled toward the bottom.
 */
export function texRoofTile(seed = 37): HTMLCanvasElement {
  const S = 512,
    n = makeNoise(seed);
  const courses = 14;
  return paint(S, (x, y) => {
    const fy = (y / S) * courses;
    const inC = fy - Math.floor(fy);
    // The lower lip of each course sits proud and catches light; the head of
    // the next course tucks under it and goes dark.
    const lip = inC < 0.16 ? 0.55 + inC * 1.8 : 1;
    const bulge = 0.86 + Math.sin(inC * Math.PI) * 0.2;

    // Round barrel tiles running down the slope.
    const cols = 11;
    const fx = (x / S) * cols;
    const inX = fx - Math.floor(fx);
    const barrel = 0.82 + Math.sin(inX * Math.PI) * 0.26;

    const weather = fbm(n, x / 40, y / 30, 3, 0.55);
    const soot = fbm(n, x / 12, y / 12, 2, 0.5);
    const l = lip * bulge * barrel * (0.78 + weather * 0.3 + soot * 0.12);
    return [78 * l, 82 * l, 86 * l];
  });
}

/**
 * 木 — dressed timber. Grain runs along +Y here; the caller rotates the UVs
 * for members that lie horizontally.
 */
export function texTimber(seed = 53): HTMLCanvasElement {
  const S = 256,
    n = makeNoise(seed);
  return paint(S, (x, y) => {
    // Stretching the noise hard in one axis is what turns it into grain.
    const g = fbm(n, x / 3.2, y / 46, 4, 0.55);
    const ring = 0.5 + 0.5 * Math.sin(g * 34);
    const knot = fbm(n, x / 70, y / 70, 2, 0.5);
    const l = 0.56 + ring * 0.22 + knot * 0.24;
    return [104 * l, 74 * l, 48 * l];
  });
}

/** 鯱 — antique bronze for finials, shachihoko and hardware. */
export function texBronze(seed = 61): HTMLCanvasElement {
  const S = 256,
    n = makeNoise(seed);
  return paint(S, (x, y) => {
    const v = fbm(n, x / 40, y / 40, 3, 0.55),
      f = fbm(n, x / 8, y / 8, 2, 0.5);
    const l = 0.74 + v * 0.44 + f * 0.2;
    return [168 * l, 130 * l, 74 * l];
  });
}

// ---------- material assembly ----------

export interface SurfaceOpts {
  /** UV repeat. */
  repeat?: [number, number];
  bump?: number;
  /** Roughness range mapped from luminance: [lit, shadowed]. */
  rough?: [number, number];
  metalness?: number;
  color?: number;
}

/**
 * Wrap a painted canvas into a standard material, deriving its bump and
 * roughness maps from the same pixels. Returns the material plus the maps so
 * the palette cross-fade can retint them later.
 */
export function surface(
  canvas: HTMLCanvasElement,
  o: SurfaceOpts = {}
): THREE.MeshStandardMaterial {
  const [rx, ry] = o.repeat ?? [1, 1];
  const [lo, hi] = o.rough ?? [0.55, 0.95];
  const mat = new THREE.MeshStandardMaterial({
    map: toTex(canvas, rx, ry),
    bumpMap: toLin(bumpFrom(canvas, o.bump ?? 1), rx, ry),
    bumpScale: 0.35,
    roughnessMap: toLin(roughFrom(canvas, lo, hi), rx, ry),
    roughness: 1,
    metalness: o.metalness ?? 0,
    color: o.color ?? 0xffffff,
  });
  return mat;
}
