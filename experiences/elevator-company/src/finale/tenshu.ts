/**
 * 天守 — the Japanese keep, generated rather than modelled.
 *
 * The tower is a stack of storeys, each capped by a hipped roof. Roof surfaces
 * are not meshes: `roofPoint` maps (panel, across, down) to a point in space,
 * and everything else — tile courses, barrel ribs, hip ridges, fascia, soffit —
 * is placed by evaluating that same function. Change `lift`, `tip`, `flare` or
 * `pow` and the whole roof re-curves consistently.
 *
 * Technique follows MengTo/towers (unlicensed — reimplemented, not copied).
 */

import * as THREE from "three";
import { AP, Bld, cornPt, faceRot, mergeGeos, NS, STEP, type Vec2, type Vec3 } from "./builder";

/** One roof's shape parameters. */
export interface RoofOpts {
  /** Eave height and ridge/top height. */
  yE: number;
  yT: number;
  /** Eave circumradius. */
  RE: number;
  /** Truncated roofs stop at this inner radius; ridged roofs set `ridge`. */
  trunc?: number;
  ridge?: number;
  /** Corner lift, and how far the hip tip curls up past it. */
  lift: number;
  tip?: number;
  /** Slope curvature. Higher is more concave. */
  pow?: number;
  /** Outward flare at the corners. */
  flare?: number;
}

export interface StoreyOpts {
  y0: number;
  y1: number;
  R: number;
}

/** Layer table for a five-storey keep, in tower-local units. */
export const L = {
  ishi: { y0: 0.0, y1: 3.3, R0: 3.36, R1: 2.66, pow: 1.85 },
  s1: { y0: 3.16, y1: 5.06, R: 2.56 },
  roof1: { yE: 5.06, yT: 6.26, RE: 3.32, trunc: 2.0, lift: 0.15, tip: 0.11, pow: 1.3 },
  s2: { y0: 6.14, y1: 7.74, R: 2.18 },
  roof2: { yE: 7.74, yT: 8.8, RE: 2.84, trunc: 1.73, lift: 0.13, tip: 0.1, pow: 1.3 },
  s3: { y0: 8.68, y1: 10.2, R: 1.8 },
  roof3: { yE: 10.2, yT: 11.1, RE: 2.42, trunc: 1.66, lift: 0.12, tip: 0.09, pow: 1.3 },
  s4: { y0: 11.04, y1: 12.4, R: 1.46 },
  roof4: { yE: 12.4, yT: 13.46, RE: 2.22, ridge: 0.72, lift: 0.16, tip: 0.12, pow: 1.26 },
} as const;

/** Overall height of the keep at unit scale, for fitting it to the shaft. */
export const TENSHU_HEIGHT = L.roof4.yT + 1.1;
/** Plan width across the widest course of the base, at unit scale. */
export const TENSHU_WIDTH = L.ishi.R0 * 2;

/**
 * 扇の勾配 — the fan slope. Vertical where it meets the coping, flaring out
 * toward the footing, so the base looks like it is bearing weight.
 */
export function ishiR(y: number): number {
  const f = Math.max(0, Math.min(1, (y - L.ishi.y0) / (L.ishi.y1 - L.ishi.y0)));
  return L.ishi.R1 + (L.ishi.R0 - L.ishi.R1) * Math.pow(1 - f, L.ishi.pow);
}

const RQ = Math.SQRT1_2;

/** Where panel `k`'s inner edge lands on a true ridge of half-length `Lh`. */
function ridgePt(k: number, Lh: number): Vec2 {
  const m = ((k % 4) + 4) % 4;
  return m === 0 || m === 1 ? [RQ * Lh, RQ * Lh] : [-RQ * Lh, -RQ * Lh];
}

/**
 * The one function the whole roof is built from.
 *
 * @param p panel index, 0..NS-1
 * @param u across the panel, -1 at one hip to +1 at the other
 * @param t down the slope, 0 at the ridge to 1 at the eave (>1 overshoots,
 *          which is how the barrel tiles get their drip past the fascia)
 */
export function roofPoint(o: RoofOpts, p: number, u: number, t: number): Vec3 {
  const tc = Math.min(1, t),
    over = Math.max(0, t - 1);
  const g = 1 - Math.pow(1 - tc, o.pow ?? 1.3);
  const f = (u + 1) / 2;

  // Outer edge: interpolate along the eave between two plan corners.
  const oa = cornPt(p + 1, 1),
    ob = cornPt(p, 1);
  const ox = oa[0] + (ob[0] - oa[0]) * f,
    oz = oa[1] + (ob[1] - oa[1]) * f;

  // Inner edge: a truncated roof closes on a square, a ridged one on a line.
  const ia = o.trunc ? cornPt(p + 1, o.trunc) : ridgePt(p + 1, o.ridge!),
    ib = o.trunc ? cornPt(p, o.trunc) : ridgePt(p, o.ridge!);
  const ix = ia[0] + (ib[0] - ia[0]) * f,
    iz = ia[1] + (ib[1] - ia[1]) * f;

  // Corner weighting: 0 at mid-panel, 1 at the hips. Everything characteristic
  // about the profile — the lift, the flare — rides on this.
  const corner = Math.pow(Math.abs(u), 2.0);
  const flare = 1 + (o.flare ?? 0.028) * corner * Math.pow(tc, 3.2);
  const RE = o.RE * flare;
  const y =
    o.yT -
    (o.yT - o.yE) * g +
    o.lift * corner * Math.pow(tc, 2.6) -
    over * (o.yT - o.yE) * 0.45;

  return [ix + (ox * RE - ix) * t, y, iz + (oz * RE - iz) * t];
}

export interface RoofGeos {
  surf: THREE.BufferGeometry;
  soffit: THREE.BufferGeometry;
  ribs: THREE.BufferGeometry;
  ridge: THREE.BufferGeometry;
  fascia: THREE.BufferGeometry;
  cap: THREE.BufferGeometry;
}

/** Tessellate one roof and everything that sits on it. */
export function buildRoof(o: RoofOpts): RoofGeos {
  const surf = new Bld(),
    soff = new Bld(),
    ribs = new Bld(),
    ridge = new Bld(),
    fascia = new Bld(),
    cap = new Bld();

  const NU = 20,
    NT = 13,
    TH = 0.1,
    DROP = 0.032;

  for (let p = 0; p < NS; p++) {
    const top: Vec3[][] = [],
      bot: Vec3[][] = [];
    for (let it = 0; it <= NT; it++) {
      const rT: Vec3[] = [],
        rB: Vec3[] = [],
        t = it / NT;
      for (let iu = 0; iu <= NU; iu++) {
        const u = -1 + (2 * iu) / NU,
          s = roofPoint(o, p, u, t);
        rT.push([s[0], s[1] - DROP, s[2]]);
        rB.push([s[0], s[1] - DROP - TH, s[2]]);
      }
      top.push(rT);
      bot.push(rB);
    }

    for (let it = 0; it < NT; it++)
      for (let iu = 0; iu < NU; iu++) {
        surf.face([top[it + 1][iu], top[it + 1][iu + 1], top[it][iu + 1], top[it][iu]], [
          [0, (it / NT) * 2.0],
          [1, (it / NT) * 2.0],
          [1, ((it + 1) / NT) * 2.0],
          [0, ((it + 1) / NT) * 2.0],
        ]);
        soff.face([bot[it][iu], bot[it][iu + 1], bot[it + 1][iu + 1], bot[it + 1][iu]], [
          [0, it / NT],
          [1, it / NT],
          [1, (it + 1) / NT],
          [0, (it + 1) / NT],
        ]);
      }

    // Fascia board closing the eave edge between surface and soffit.
    for (let iu = 0; iu < NU; iu++)
      fascia.face([top[NT][iu], top[NT][iu + 1], bot[NT][iu + 1], bot[NT][iu]], [
        [(iu / NU) * 3, 0],
        [((iu + 1) / NU) * 3, 0],
        [((iu + 1) / NU) * 3, 1],
        [(iu / NU) * 3, 1],
      ]);

    // 丸瓦 — round barrel tiles running down the slope, each finished with a
    // fatter drip tile that overhangs the fascia.
    const NR = Math.max(14, Math.round(o.RE * 8.0));
    for (let ir = 1; ir < NR; ir++) {
      const u = -1 + (2 * ir) / NR,
        pts: Vec3[] = [];
      for (let it = 1; it <= NT + 1; it++) {
        const t = Math.min(1.04, it / NT),
          s = roofPoint(o, p, u, t);
        pts.push([s[0], s[1] - DROP + 0.01, s[2]]);
      }
      const rr = 0.024 + 0.01 * (o.RE / 3.3);
      ribs.tube(pts, rr, 6, 1);
      const e = pts[pts.length - 1],
        e2 = pts[pts.length - 2];
      const dx = e[0] - e2[0],
        dy = e[1] - e2[1],
        dz = e[2] - e2[2],
        dl = Math.hypot(dx, dy, dz) || 1;
      ribs.tube(
        [e, [e[0] + (dx / dl) * 0.045, e[1] + (dy / dl) * 0.045, e[2] + (dz / dl) * 0.045]],
        rr * 1.8,
        8,
        1
      );
    }

    // 降棟 — the plastered hip ridge along u = +1, curling up at the tip.
    const hip: Vec3[] = [];
    for (let it = 0; it <= NT + 1; it++) {
      const t = Math.min(1.05, it / NT),
        s = roofPoint(o, p, 1, t);
      hip.push([s[0], s[1] - DROP + 0.052, s[2]]);
    }
    cap.tube(hip, 0.062, 6, 1);
    const tip = hip[hip.length - 1],
      tp = hip[hip.length - 2];
    const vx = tip[0] - tp[0],
      vz = tip[2] - tp[2],
      vl = Math.hypot(vx, vz) || 1;
    const tr = o.tip ?? 0.1;
    cap.tube(
      [
        tip,
        [tip[0] - (vx / vl) * 0.06, tip[1] + tr * 0.6, tip[2] - (vz / vl) * 0.06],
        [tip[0] - (vx / vl) * 0.09, tip[1] + tr, tip[2] - (vz / vl) * 0.09],
      ],
      0.046,
      6,
      1
    );
  }

  // A truncated roof needs its inner opening decked, or lamplight from the
  // storey below shows straight through it.
  if (o.trunc) {
    const yc = o.yT - DROP,
      c: Vec2[] = [];
    for (let k = 0; k < NS; k++) c.push(cornPt(k, o.trunc * 1.02));
    for (let k = 1; k < NS - 1; k++)
      surf.face([
        [c[0][0], yc, c[0][1]],
        [c[k + 1][0], yc, c[k + 1][1]],
        [c[k][0], yc, c[k][1]],
        [c[k][0], yc, c[k][1]],
      ]);
  }

  // 大棟 — the main ridge with its 鬼瓦 end blocks, only on the top roof.
  if (!o.trunc && o.ridge !== undefined) {
    const m0 = ridgePt(0, o.ridge),
      m2 = ridgePt(2, o.ridge),
      yR = o.yT - DROP + 0.1;
    cap.tube([[m0[0], yR, m0[1]], [0, yR + 0.015, 0], [m2[0], yR, m2[1]]], 0.085, 6, 1);
    for (const m of [m0, m2])
      ridge.box(m[0], yR + 0.075, m[1], 0.3, 0.24, 0.2, Math.atan2(m[0], m[1]), 4);
  }

  return {
    surf: surf.geo(),
    soffit: soff.geo(),
    ribs: ribs.geo(),
    ridge: ridge.geo(),
    fascia: fascia.geo(),
    cap: cap.geo(),
  };
}

export interface TenshuGeos {
  stone: THREE.BufferGeometry | null;
  plaster: THREE.BufferGeometry | null;
  timber: THREE.BufferGeometry | null;
  tile: THREE.BufferGeometry | null;
  bronze: THREE.BufferGeometry | null;
}

/**
 * Assemble the whole keep, grouped by material so the finished tower draws in
 * five calls rather than one per member.
 */
export function buildTenshu(): TenshuGeos {
  const stone = new Bld(),
    plaster = new Bld(),
    timber = new Bld(),
    tile = new Bld(),
    bronze = new Bld();

  // ---------- 石垣 — the battered stone base ----------
  const SEG = 16;
  for (let i = 0; i < SEG; i++) {
    const y0 = L.ishi.y0 + ((L.ishi.y1 - L.ishi.y0) * i) / SEG;
    const y1 = L.ishi.y0 + ((L.ishi.y1 - L.ishi.y0) * (i + 1)) / SEG;
    stone.prism(y0, y1, ishiR(y0), ishiR(y1), 0.55, false, i === 0);
  }

  // ---------- storeys ----------
  const storeys: StoreyOpts[] = [L.s1, L.s2, L.s3, L.s4];
  const roofs: RoofOpts[] = [L.roof1, L.roof2, L.roof3, L.roof4];

  for (let s = 0; s < storeys.length; s++) {
    const st = storeys[s];
    // Wall, very slightly battered so it doesn't read as extruded card.
    plaster.prism(st.y0, st.y1, st.R, st.R * 0.985, 0.9);

    // Sill and head bands, and the posts between them.
    timber.prism(st.y0, st.y0 + 0.1, st.R * 1.012, st.R * 1.012, 1.4);
    timber.prism(st.y1 - 0.12, st.y1, st.R * 1.012, st.R * 1.012, 1.4);

    const posts = 5;
    for (let k = 0; k < NS; k++) {
      const rot = faceRot(k);
      const half = st.R * Math.SQRT2 * 0.5;
      for (let q = 0; q <= posts; q++) {
        const x = -half + (2 * half * q) / posts;
        timber.box(
          x * Math.cos(rot),
          (st.y0 + st.y1) / 2,
          -x * Math.sin(rot),
          0.09,
          st.y1 - st.y0,
          0.09,
          rot,
          1.2
        );
      }
      // 窓 — a row of square openings set into each face, just under the head
      // band. Placed on the face plane rather than driven through the building,
      // or they protrude from both sides as shelves.
      const wy = st.y1 - 0.46;
      const a = (k + 0.5) * STEP;
      const inset = AP * st.R - 0.02;
      const wins = 2;
      const wW = half * 0.44,
        wH = 0.32;
      for (let q = 0; q < wins; q++) {
        // Spread the openings across the face, leaving a margin at each hip.
        const off = (-0.5 + (q + 0.5) / wins) * half * 1.5;
        const px = Math.cos(a) * inset - Math.sin(rot) * 0 + off * Math.cos(rot);
        const pz = Math.sin(a) * inset - off * Math.sin(rot);
        // Surround first, then the darker opening recessed inside it.
        timber.box(px, wy, pz, wW * 1.34, wH * 1.32, 0.06, rot, 1);
        plaster.box(px, wy, pz, wW, wH, 0.1, rot, 1);
      }
    }

    // ---------- roof ----------
    const r = buildRoof(roofs[s]);
    tile.append(r.surf);
    tile.append(r.ribs);
    plaster.append(r.cap);
    plaster.append(r.ridge);
    timber.append(r.soffit);
    timber.append(r.fascia);
  }

  // ---------- 鯱 and finial ----------
  const yTop = L.roof4.yT + 0.16;
  bronze.lathe(0, yTop, 0, 0, 0.9, (t) => 0.16 * (1 - t) + 0.03, 10, 12, 1);
  bronze.lathe(0, yTop, 0, 0.2, 0.34, (t) => 0.22 * Math.sin(Math.PI * t) + 0.05, 8, 12, 1);

  return {
    stone: stone.empty ? null : stone.geo(),
    plaster: plaster.empty ? null : plaster.geo(),
    timber: timber.empty ? null : timber.geo(),
    tile: tile.empty ? null : tile.geo(),
    bronze: bronze.empty ? null : bronze.geo(),
  };
}

export { mergeGeos };
