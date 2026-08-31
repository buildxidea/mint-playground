/**
 * Geometry primitives for the finale tower.
 *
 * Everything the tower is made of comes out of this file — there is no mesh
 * asset behind it. A `Bld` accumulates raw position/normal/uv/index arrays and
 * hands back a BufferGeometry; the primitives below are all thin wrappers that
 * push quads into one. Towers are then merged down to a handful of geometries
 * so the whole finale draws in a few calls rather than a few hundred.
 *
 * Technique follows MengTo/towers (unlicensed — reimplemented, not copied).
 */

import * as THREE from "three";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type UVQuad = [Vec2, Vec2, Vec2, Vec2];

/** Square on plan, presented corner-on to the camera. */
export const NS = 4;
export const STEP = (Math.PI * 2) / NS;
/** apothem / circumradius */
export const AP = Math.cos(Math.PI / NS);
/** face width / circumradius */
export const SW = 2 * Math.sin(Math.PI / NS);

export const faceRot = (k: number): number => Math.PI / 2 - (k + 0.5) * STEP;
export const cornRot = (k: number): number => Math.PI / 2 - k * STEP;
export const cornPt = (k: number, R: number): Vec2 => [
  Math.cos(k * STEP) * R,
  Math.sin(k * STEP) * R,
];

/** Corner point on an n-sided plan, for the styles that are not square. */
export const cPtN = (k: number, R: number, n: number): Vec2 => [
  Math.cos((k * Math.PI * 2) / n) * R,
  Math.sin((k * Math.PI * 2) / n) * R,
];

const DEFAULT_UV: UVQuad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export class Bld {
  private p: number[] = [];
  private n: number[] = [];
  private u: number[] = [];
  private i: number[] = [];

  vert(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number
  ): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.u.push(u, v);
    return this.p.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.i.push(a, b, c, a, c, d);
  }

  /** A planar quad. The normal is derived from the winding, so callers only
   *  have to get the corner order right. Degenerate quads fall back to +Y
   *  rather than emitting a NaN normal. */
  face(P: [Vec3, Vec3, Vec3, Vec3], uv?: UVQuad): void {
    const ax = P[1][0] - P[0][0],
      ay = P[1][1] - P[0][1],
      az = P[1][2] - P[0][2];
    const bx = P[2][0] - P[0][0],
      by = P[2][1] - P[0][1],
      bz = P[2][2] - P[0][2];
    let nx = ay * bz - az * by,
      ny = az * bx - ax * bz,
      nz = ax * by - ay * bx;
    const Ln = Math.hypot(nx, ny, nz);
    if (Ln < 1e-9) {
      nx = 0;
      ny = 1;
      nz = 0;
    } else {
      nx /= Ln;
      ny /= Ln;
      nz /= Ln;
    }
    const t = uv || DEFAULT_UV;
    const a = this.vert(P[0][0], P[0][1], P[0][2], nx, ny, nz, t[0][0], t[0][1]);
    const b = this.vert(P[1][0], P[1][1], P[1][2], nx, ny, nz, t[1][0], t[1][1]);
    const c = this.vert(P[2][0], P[2][1], P[2][2], nx, ny, nz, t[2][0], t[2][1]);
    const d = this.vert(P[3][0], P[3][1], P[3][2], nx, ny, nz, t[3][0], t[3][1]);
    this.quad(a, b, c, d);
  }

  /** Box, rotated first about its own Z then about Y. The Z rotation is what
   *  lets bracket arms and rafters lean without a separate primitive. */
  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    ry = 0,
    uvs = 1,
    rz = 0
  ): void {
    const hx = sx / 2,
      hy = sy / 2,
      hz = sz / 2,
      S = uvs;
    const cz2 = Math.cos(rz),
      sz2 = Math.sin(rz);
    const co = Math.cos(ry),
      si = Math.sin(ry);
    const V: Vec3[] = [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [hx, hy, hz],
      [-hx, hy, hz],
    ];
    const W = V.map((v): Vec3 => {
      const x = v[0] * cz2 - v[1] * sz2,
        y = v[0] * sz2 + v[1] * cz2,
        z = v[2];
      return [cx + x * co + z * si, cy + y, cz - x * si + z * co];
    });
    const uv = (w: number, h: number): UVQuad => [
      [0, 0],
      [w * S, 0],
      [w * S, h * S],
      [0, h * S],
    ];
    this.face([W[4], W[5], W[6], W[7]], uv(sx, sy));
    this.face([W[1], W[0], W[3], W[2]], uv(sx, sy));
    this.face([W[5], W[1], W[2], W[6]], uv(sz, sy));
    this.face([W[0], W[4], W[7], W[3]], uv(sz, sy));
    this.face([W[7], W[6], W[2], W[3]], uv(sx, sz));
    this.face([W[0], W[1], W[5], W[4]], uv(sx, sz));
  }

  /** Prism or frustum on the square plan, measured by circumradius. */
  prism(
    y0: number,
    y1: number,
    R0: number,
    R1: number,
    uvS = 1,
    capTop = false,
    capBot = false,
    vOff = 0
  ): void {
    const S = uvS,
      v0 = vOff * S;
    for (let k = 0; k < NS; k++) {
      const a = cornPt(k, R0),
        b = cornPt(k + 1, R0),
        c = cornPt(k + 1, R1),
        d = cornPt(k, R1);
      const P: [Vec3, Vec3, Vec3, Vec3] = [
        [b[0], y0, b[1]],
        [a[0], y0, a[1]],
        [d[0], y1, d[1]],
        [c[0], y1, c[1]],
      ];
      const w = Math.hypot(P[1][0] - P[0][0], P[1][2] - P[0][2]),
        h = Math.abs(y1 - y0);
      this.face(P, [
        [0, v0],
        [w * S, v0],
        [w * S, v0 + h * S],
        [0, v0 + h * S],
      ]);
    }
    if (capTop) this.cap(y1, R1, S, true);
    if (capBot) this.cap(y0, R0, S, false);
  }

  /** Triangle fan closing off one end of a square-plan prism. */
  private cap(y: number, R: number, S: number, up: boolean): void {
    for (let k = 1; k < NS - 1; k++) {
      const a = cornPt(0, R);
      const b = cornPt(up ? k : k + 1, R);
      const c = cornPt(up ? k + 1 : k, R);
      this.face(
        [
          [a[0], y, a[1]],
          [b[0], y, b[1]],
          [c[0], y, c[1]],
          [c[0], y, c[1]],
        ],
        [
          [0, 0],
          [b[0] * S, b[1] * S],
          [c[0] * S, c[1] * S],
          [c[0] * S, c[1] * S],
        ]
      );
    }
  }

  /** Prism on an n-sided plan — octagonal drums, hexagonal eaves. */
  prismN(
    y0: number,
    y1: number,
    R0: number,
    R1: number,
    n: number,
    uvS = 1,
    capTop = false,
    capBot = false
  ): void {
    const S = uvS;
    for (let k = 0; k < n; k++) {
      const a = cPtN(k, R0, n),
        b = cPtN(k + 1, R0, n),
        c = cPtN(k + 1, R1, n),
        d = cPtN(k, R1, n);
      const P: [Vec3, Vec3, Vec3, Vec3] = [
        [b[0], y0, b[1]],
        [a[0], y0, a[1]],
        [d[0], y1, d[1]],
        [c[0], y1, c[1]],
      ];
      const w = Math.hypot(P[1][0] - P[0][0], P[1][2] - P[0][2]),
        h = Math.abs(y1 - y0);
      this.face(P, [
        [0, 0],
        [w * S, 0],
        [w * S, h * S],
        [0, h * S],
      ]);
    }
    if (capTop) this.capN(y1, R1, n, true);
    if (capBot) this.capN(y0, R0, n, false);
  }

  private capN(y: number, R: number, n: number, up: boolean): void {
    for (let k = 1; k < n - 1; k++) {
      const a = cPtN(0, R, n);
      const b = cPtN(up ? k : k + 1, R, n);
      const c = cPtN(up ? k + 1 : k, R, n);
      this.face([
        [a[0], y, a[1]],
        [b[0], y, b[1]],
        [c[0], y, c[1]],
        [c[0], y, c[1]],
      ]);
    }
  }

  /** Sweep a fixed plan outline upward, scaling it by a profile — this is what
   *  gives the shikhara and prang their curved batter. Returns the top ring so
   *  the caller can land a finial on it. */
  sweepPlan(
    plan: Vec2[],
    y0: number,
    y1: number,
    steps: number,
    prof: (t: number) => number,
    uvS = 1
  ): Vec3[] {
    const S = uvS,
      N = plan.length,
      rings: Vec3[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        y = y0 + (y1 - y0) * t,
        k = prof(t),
        ring: Vec3[] = [];
      for (let j = 0; j < N; j++) ring.push([plan[j][0] * k, y, plan[j][1] * k]);
      rings.push(ring);
    }
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < N; j++) {
        const j2 = (j + 1) % N;
        this.face([rings[i][j2], rings[i][j], rings[i + 1][j], rings[i + 1][j2]], [
          [0, (i / steps) * S * 6],
          [1, (i / steps) * S * 6],
          [1, ((i + 1) / steps) * S * 6],
          [0, ((i + 1) / steps) * S * 6],
        ]);
      }
    return rings[steps];
  }

  /** Surface of revolution — onion cupolas, amalaka discs, finial pots. `rib`
   *  pinches the profile into vertical flutes. */
  lathe(
    cx: number,
    cy: number,
    cz: number,
    y0: number,
    y1: number,
    prof: (t: number) => number,
    steps: number,
    seg: number,
    uvS = 1,
    rib = 0
  ): void {
    const S = uvS,
      rings: Vec3[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        y = cy + y0 + (y1 - y0) * t,
        r = prof(t),
        ring: Vec3[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const rr = r * (rib ? 1 + rib * Math.cos((a * seg) / 2) : 1);
        ring.push([cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr]);
      }
      rings.push(ring);
    }
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        this.face([rings[i][j2], rings[i][j], rings[i + 1][j], rings[i + 1][j2]], [
          [0, (i / steps) * S * 4],
          [1, (i / steps) * S * 4],
          [1, ((i + 1) / steps) * S * 4],
          [0, ((i + 1) / steps) * S * 4],
        ]);
      }
  }

  /** Annulus standing on a face plane, outward normal +Z before `ry`. */
  ring(
    cx: number,
    cy: number,
    cz: number,
    rIn: number,
    rOut: number,
    depth: number,
    ry = 0,
    segs = 36,
    uvS = 1
  ): void {
    this.arc(cx, cy, cz, rIn, rOut, depth, ry, 0, Math.PI * 2, segs, uvS);
  }

  /** Partial annulus band on a face plane — arch heads and window brows. */
  arc(
    cx: number,
    cy: number,
    cz: number,
    rIn: number,
    rOut: number,
    depth: number,
    ry = 0,
    a0 = 0,
    a1 = Math.PI * 2,
    segs = 24,
    uvS = 1
  ): void {
    const N = segs,
      S = uvS,
      co = Math.cos(ry),
      si = Math.sin(ry);
    const M = (x: number, y: number, z: number): Vec3 => [
      cx + x * co + z * si,
      cy + y,
      cz - x * si + z * co,
    ];
    for (let i = 0; i < N; i++) {
      const t0 = a0 + ((a1 - a0) * i) / N,
        t1 = a0 + ((a1 - a0) * (i + 1)) / N;
      const p = (r: number, a: number, z: number): Vec3 =>
        M(Math.cos(a) * r, Math.sin(a) * r, z);
      const uv: UVQuad = [
        [0, (i / N) * S * 10],
        [1, (i / N) * S * 10],
        [1, ((i + 1) / N) * S * 10],
        [0, ((i + 1) / N) * S * 10],
      ];
      this.face(
        [p(rIn, t0, depth / 2), p(rOut, t0, depth / 2), p(rOut, t1, depth / 2), p(rIn, t1, depth / 2)],
        uv
      );
      this.face(
        [p(rIn, t1, depth / 2), p(rIn, t1, -depth / 2), p(rIn, t0, -depth / 2), p(rIn, t0, depth / 2)],
        uv
      );
      this.face(
        [p(rOut, t0, depth / 2), p(rOut, t0, -depth / 2), p(rOut, t1, -depth / 2), p(rOut, t1, depth / 2)],
        uv
      );
    }
  }

  /** Filled polygon on a face plane, fanned from a centre point. */
  fan(pts: Vec2[], zz: number, ry = 0, cx?: number, cy?: number): void {
    const co = Math.cos(ry),
      si = Math.sin(ry);
    const M = (x: number, y: number): Vec3 => [x * co + zz * si, y, -x * si + zz * co];
    let mx = 0,
      my = 0;
    if (cx === undefined) {
      for (const q of pts) {
        mx += q[0];
        my += q[1];
      }
      mx /= pts.length;
      my /= pts.length;
    } else {
      mx = cx;
      my = cy!;
    }
    const C = M(mx, my);
    for (let i = 0; i < pts.length - 1; i++) {
      const A = M(pts[i][0], pts[i][1]),
        B = M(pts[i + 1][0], pts[i + 1][1]);
      this.face([C, A, B, B], [
        [0.5, 0.5],
        [0, 0],
        [1, 0],
        [1, 0],
      ]);
    }
  }

  /** Swept tube along a polyline, with a parallel-transport-ish frame. Used for
   *  cables, ridge ropes and the thin members of finials. `r` may vary along
   *  the sweep. */
  tube(pts: Vec3[], r: number | ((t: number) => number), sides = 6, uvS = 1): void {
    const N = sides,
      S = uvS,
      rings: number[][] = [];
    if (pts.length < 2) return;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      let t: Vec3;
      if (k === 0) t = [pts[1][0] - p[0], pts[1][1] - p[1], pts[1][2] - p[2]];
      else if (k === pts.length - 1)
        t = [p[0] - pts[k - 1][0], p[1] - pts[k - 1][1], p[2] - pts[k - 1][2]];
      else
        t = [
          pts[k + 1][0] - pts[k - 1][0],
          pts[k + 1][1] - pts[k - 1][1],
          pts[k + 1][2] - pts[k - 1][2],
        ];
      let tl = Math.hypot(t[0], t[1], t[2]);
      if (tl < 1e-9) {
        t = [0, 1, 0];
        tl = 1;
      }
      t = [t[0] / tl, t[1] / tl, t[2] / tl];
      // Near-vertical segments need a different reference up, or the cross
      // product collapses.
      const up: Vec3 = Math.abs(t[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
      let n1: Vec3 = [
        t[1] * up[2] - t[2] * up[1],
        t[2] * up[0] - t[0] * up[2],
        t[0] * up[1] - t[1] * up[0],
      ];
      let l1 = Math.hypot(n1[0], n1[1], n1[2]);
      if (l1 < 1e-9) {
        n1 = [1, 0, 0];
        l1 = 1;
      }
      n1 = [n1[0] / l1, n1[1] / l1, n1[2] / l1];
      const n2: Vec3 = [
        t[1] * n1[2] - t[2] * n1[1],
        t[2] * n1[0] - t[0] * n1[2],
        t[0] * n1[1] - t[1] * n1[0],
      ];
      const ring: number[] = [];
      const rr = typeof r === "function" ? r(k / (pts.length - 1)) : r;
      for (let sI = 0; sI < N; sI++) {
        const a = (sI / N) * Math.PI * 2,
          dx = Math.cos(a),
          dy = Math.sin(a);
        const nx = n1[0] * dx + n2[0] * dy,
          ny = n1[1] * dx + n2[1] * dy,
          nz = n1[2] * dx + n2[2] * dy;
        ring.push(
          this.vert(
            p[0] + nx * rr,
            p[1] + ny * rr,
            p[2] + nz * rr,
            nx,
            ny,
            nz,
            (sI / N) * S,
            (k / (pts.length - 1)) * S * 3
          )
        );
      }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++)
      for (let sI = 0; sI < N; sI++) {
        const s2 = (sI + 1) % N;
        this.quad(rings[k][sI], rings[k][s2], rings[k + 1][s2], rings[k + 1][sI]);
      }
  }

  /** Absorb an already-built geometry into this accumulator, so members made
   *  by different primitives can still land in one material group. */
  append(g: THREE.BufferGeometry | null | undefined): void {
    if (!g || !g.attributes.position.count) return;
    const base = this.p.length / 3;
    const pos = g.attributes.position.array as ArrayLike<number>;
    const nor = g.attributes.normal.array as ArrayLike<number>;
    const uvv = g.attributes.uv.array as ArrayLike<number>;
    for (let i = 0; i < pos.length; i++) this.p.push(pos[i]);
    for (let i = 0; i < nor.length; i++) this.n.push(nor[i]);
    for (let i = 0; i < uvv.length; i++) this.u.push(uvv[i]);
    const ia = g.index!.array;
    for (let i = 0; i < ia.length; i++) this.i.push(ia[i] + base);
  }

  /** True once anything has been pushed — cheaper than building an empty geo. */
  get empty(): boolean {
    return this.p.length === 0;
  }

  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i);
    return g;
  }
}

/**
 * Concatenate geometries that share a material. Assumes position/normal/uv and
 * an index on every input, which everything out of `Bld` has. This is what
 * keeps the finished tower down to a handful of draw calls.
 */
export function mergeGeos(
  list: (THREE.BufferGeometry | null | undefined)[]
): THREE.BufferGeometry | null {
  const geos = list.filter(
    (g): g is THREE.BufferGeometry => !!g && g.attributes.position.count > 0
  );
  if (!geos.length) return null;

  let total = 0;
  for (const g of geos) total += g.attributes.position.count;

  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uvv = new Float32Array(total * 2);
  const idx: number[] = [];
  let off = 0,
    po = 0,
    uo = 0;

  for (const g of geos) {
    pos.set(g.attributes.position.array as ArrayLike<number>, po);
    nor.set(g.attributes.normal.array as ArrayLike<number>, po);
    uvv.set(g.attributes.uv.array as ArrayLike<number>, uo);
    const ia = g.index!.array;
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + off);
    off += g.attributes.position.count;
    po += g.attributes.position.array.length;
    uo += g.attributes.uv.array.length;
  }

  const G = new THREE.BufferGeometry();
  G.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  G.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  G.setAttribute("uv", new THREE.Float32BufferAttribute(uvv, 2));
  G.setIndex(idx);
  return G;
}
