/**
 * The world the finale tower stands in: a simplex heightfield with distant
 * ridges, GPU grass, scattered field stones, and a painted sky dome.
 *
 * Everything here is authored at the tower's *native* scale — the same units
 * the keep is drawn in before `buildFinaleTower` scales it up — and the whole
 * group is then scaled by the same factor. That keeps the tower, the hills and
 * the grass in the proportions they were designed for instead of each being
 * tuned separately.
 *
 * Technique and tuning follow MengTo/towers (unlicensed — reimplemented, not
 * copied).
 */

import * as THREE from "three";

// ---------- simplex noise ----------

/**
 * 2D simplex with a seeded permutation. Separate from the value noise in
 * `textures.ts`: that one paints texture canvases, this one has to be smooth
 * enough to differentiate for terrain normals.
 */
const NZ = (() => {
  const g3 = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const perm = new Uint8Array(512),
    pp = new Uint8Array(256);
  let sd = 1337;
  for (let i = 0; i < 256; i++) pp[i] = i;
  for (let i = 255; i > 0; i--) {
    sd = (sd * 1664525 + 1013904223) & 0xffffffff;
    const j = (sd >>> 16) % (i + 1),
      t = pp[i];
    pp[i] = pp[j];
    pp[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = pp[i & 255];

  const F2 = 0.5 * (Math.sqrt(3) - 1),
    G2 = (3 - Math.sqrt(3)) / 6;

  function sn(xin: number, yin: number): number {
    const sk = (xin + yin) * F2,
      i = Math.floor(xin + sk),
      j = Math.floor(yin + sk);
    const t = (i + j) * G2,
      x0 = xin - (i - t),
      y0 = yin - (j - t);
    let i1: number, j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2,
      y1 = y0 - j1 + G2,
      x2 = x0 - 1 + 2 * G2,
      y2 = y0 - 1 + 2 * G2;
    const ii = i & 255,
      jj = j & 255;
    let n0 = 0,
      n1 = 0,
      n2 = 0,
      t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = g3[perm[ii + perm[jj]] & 7];
      t0 *= t0;
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = g3[perm[ii + i1 + perm[jj + j1]] & 7];
      t1 *= t1;
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = g3[perm[ii + 1 + perm[jj + 1]] & 7];
      t2 *= t2;
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  function fbm(x: number, y: number, o: number): number {
    let s = 0,
      a = 0.5,
      f = 1;
    for (let i = 0; i < o; i++) {
      s += sn(x * f, y * f) * a;
      a *= 0.5;
      f *= 2.02;
    }
    return s;
  }

  /** Ridged multifractal — this is what makes the distant hills read as
   *  mountains rather than dunes. */
  function ridged(x: number, y: number, o: number): number {
    let s = 0,
      a = 0.5,
      f = 1,
      pv = 1;
    for (let i = 0; i < o; i++) {
      let n = 1 - Math.abs(sn(x * f, y * f));
      n *= n;
      n *= pv;
      pv = n;
      s += n * a;
      a *= 0.5;
      f *= 2.03;
    }
    return s;
  }

  return { sn, fbm, ridged };
})();

const sm01 = (t: number): number => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

// ---------- heightfield ----------

/** Where the flat apron around the tower ends and the hills begin. */
const FLAT_R = 104,
  HILL_R = 224;

/**
 * Height is analytic, so the grass and stone scatter can sample it exactly at
 * any point with no lookup grid.
 */
export function landH(x: number, z: number): number {
  const r = Math.hypot(x, z),
    s = 0.0042;
  const mid = NZ.fbm(x * s * 3.2 + 4, z * s * 3.2 + 9, 4);
  const fine = NZ.fbm(x * s * 11 + 21, z * s * 11 + 3, 3);
  const soft = sm01((r - 20) / 78) * 2.4 * (mid * 0.62 + fine * 0.38);
  const k = sm01((r - FLAT_R) / (HILL_R - FLAT_R));
  const grow = 0.3 + Math.min(1, r / 620) * 2.35;
  const big = NZ.ridged(x * s + 11, z * s + 7, 5);
  const hill = (big * 20 + mid * 4.6 + fine * 1.2 - 5.6) * k * grow;
  return soft + hill;
}

function landN(x: number, z: number, e = 1.2): [number, number, number] {
  const hx = landH(x + e, z) - landH(x - e, z),
    hz = landH(x, z + e) - landH(x, z - e);
  return [-hx / (2 * e), 1, -hz / (2 * e)];
}

function landSlope(x: number, z: number): number {
  const n = landN(x, z);
  const l = Math.hypot(n[0], n[1], n[2]);
  return Math.acos(n[1] / l);
}

// ---------- theme ----------

export interface LandTheme {
  /** Six sky-dome gradient stops, top to horizon. */
  sky: number[];
  fog: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  grass: number;
  stars: number;
  /** Key light, by azimuth/elevation in turns rather than a position, so it
   *  can be placed at any world scale. */
  sun: { az: number; el: number; color: number; int: number };
  /** Hemisphere sky colour, ground colour, intensity. */
  hemi: { sky: number; ground: number; int: number };
  amb: { color: number; int: number };
}

/** The warm paper morning — the look of the reference. */
export const MORNING: LandTheme = {
  sky: [0x7ba4d6, 0xa9c3de, 0xd8c9a8, 0xf2d3a2, 0xffd79a, 0xe0b27c],
  fog: 0xf0d6a8,
  fogNear: 60,
  fogFar: 560,
  ground: 0xf0dcb8,
  grass: 0xfff0d2,
  stars: 0,
  sun: { az: -0.8, el: 0.235, color: 0xffb245, int: 1.46 },
  hemi: { sky: 0xffe0a2, ground: 0xd6bc82, int: 0.24 },
  amb: { color: 0xffdca0, int: 0.06 },
};

export const NOON: LandTheme = {
  sky: [0x2f76c8, 0x5f9cdb, 0x95c0e6, 0xbcd8ee, 0xd8e7f0, 0xcdcfc6],
  fog: 0xdde7ec,
  fogNear: 60,
  fogFar: 560,
  ground: 0xe6e2d6,
  grass: 0xffffff,
  stars: 0,
  sun: { az: -0.4, el: 0.8, color: 0xfff4e4, int: 1.06 },
  hemi: { sky: 0xdcecff, ground: 0xcfc6ae, int: 0.32 },
  amb: { color: 0xeef4ff, int: 0.06 },
};

export const SUNSET: LandTheme = {
  sky: [0x3c3a72, 0x7e4f74, 0xc96450, 0xff9a3d, 0xffc169, 0xc8722f],
  fog: 0xef9a52,
  fogNear: 60,
  fogFar: 560,
  ground: 0xd69c66,
  grass: 0xffdcb2,
  stars: 0.1,
  sun: { az: 0.92, el: 0.135, color: 0xff8a34, int: 1.62 },
  hemi: { sky: 0xffb877, ground: 0x6a3a22, int: 0.3 },
  amb: { color: 0xffb27a, int: 0.09 },
};

export const NIGHT: LandTheme = {
  sky: [0x05070e, 0x080d18, 0x0e1728, 0x141f36, 0x1a2740, 0x0b111c],
  fog: 0x131c2e,
  fogNear: 60,
  fogFar: 560,
  ground: 0x353c4c,
  grass: 0x8ea0c4,
  stars: 1.0,
  sun: { az: 0.5, el: 0.72, color: 0x9fb6de, int: 0.5 },
  hemi: { sky: 0x2e3a54, ground: 0x0d0f14, int: 0.22 },
  amb: { color: 0x5c6a8c, int: 0.05 },
};

export const LAND_THEMES = { morning: MORNING, noon: NOON, sunset: SUNSET, night: NIGHT };

const SKY_STOPS = [0, 0.28, 0.46, 0.6, 0.74, 1.0];

// ---------- build ----------

export interface Landscape {
  /** Terrain, grass and stones, scaled to world units. */
  group: THREE.Group;
  /** The sky dome, added separately so it is never clipped by the group. */
  sky: THREE.Mesh;
  /** World-space fog distances for the active theme. */
  fogNear: number;
  fogFar: number;
  fogColor: THREE.Color;
  setTheme(t: LandTheme): void;
  update(dt: number): void;
  counts: { terrainTris: number; grass: number; stones: number };
}

export interface LandscapeOpts {
  /** Same factor the tower is scaled by, so proportions match. */
  scale: number;
  theme?: LandTheme;
}

export function buildLandscape(opts: LandscapeOpts): Landscape {
  const S = opts.scale;
  const theme = opts.theme ?? MORNING;
  const group = new THREE.Group();
  group.scale.setScalar(S);

  // ---------- terrain: a polar grid, so resolution follows the long lens ----
  const AN = 900,
    RN = 52,
    R0 = 2.0,
    R1 = 700;
  const vcount = AN * RN;
  const pos = new Float32Array(vcount * 3),
    col = new Float32Array(vcount * 3),
    nor = new Float32Array(vcount * 3);
  const idx: number[] = [];

  const cGrass = new THREE.Color(0x5f6d3e),
    cScrub = new THREE.Color(0x4e5c36),
    cDry = new THREE.Color(0x938b5c),
    cSoil = new THREE.Color(0x8b7a5b),
    cSand = new THREE.Color(0xb0a483),
    cRock = new THREE.Color(0x6f6a5e),
    cRockD = new THREE.Color(0x453f38);
  const t1 = new THREE.Color(),
    t2 = new THREE.Color();

  // Rings space exponentially, so triangles bunch near the tower and stretch
  // toward the horizon where nothing needs the detail.
  const rAt = (k: number) => R0 * Math.pow(R1 / R0, k / (RN - 1));

  for (let ri = 0; ri < RN; ri++) {
    const r = rAt(ri);
    for (let ai = 0; ai < AN; ai++) {
      const th = (ai / AN) * Math.PI * 2,
        x = Math.cos(th) * r,
        z = Math.sin(th) * r;
      const h = landH(x, z),
        i = ri * AN + ai;
      pos[i * 3] = x;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = z;

      const n = landN(x, z, Math.max(1.0, r * 0.03));
      const l = Math.hypot(n[0], n[1], n[2]);
      nor[i * 3] = n[0] / l;
      nor[i * 3 + 1] = n[1] / l;
      nor[i * 3 + 2] = n[2] / l;

      // Slope drives rock, height drives dryness, flat ground stays sward.
      const sl = Math.acos(n[1] / l);
      const rocky = sm01((sl - 0.3) / 0.42);
      const dry = sm01((h - 6) / 26);
      const band = Math.sin(h * 0.9) * 0.5 + 0.5;
      const patch = NZ.fbm(x * 0.021 + 3, z * 0.021 + 8, 3) * 0.5 + 0.5;
      t1.copy(cGrass).lerp(cScrub, patch);
      t1.lerp(cDry, Math.max(0, NZ.fbm(x * 0.055, z * 0.055, 2)) * 0.34);
      t1.lerp(cDry, dry * 0.62);
      t1.lerp(cSand, sm01((h - 22) / 24) * 0.6);
      t1.lerp(cSoil, sm01((0.16 - sl) / 0.16) * 0.16);
      t2.copy(cRock).lerp(cRockD, band);
      t1.lerp(t2, rocky * 0.86);
      const shade = 0.88 + 0.12 * band;
      col[i * 3] = t1.r * shade;
      col[i * 3 + 1] = t1.g * shade;
      col[i * 3 + 2] = t1.b * shade;
    }
  }
  for (let ri = 0; ri < RN - 1; ri++)
    for (let ai = 0; ai < AN; ai++) {
      const a0 = ri * AN + ai,
        a1 = ri * AN + ((ai + 1) % AN),
        b0 = a0 + AN,
        b1 = a1 + AN;
      idx.push(a0, b1, b0, a0, a1, b1);
    }

  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  tg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  tg.setIndex(idx);
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  // ---------- grass: instanced ribbons shaped entirely in the vertex shader --
  const grassUni = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.84, 0.54) },
    uWindAmp: { value: 0.3 },
    uThickness: { value: 0.042 },
    uRestBend: { value: 0.26 },
    // The blade colour is mixed in the shader, so settled snow has to reach it
    // there — the material colour multiplies and cannot lighten it.
    uSnow: { value: 0 },
  };

  const BSEG = 5,
    bpos: number[] = [],
    bidx: number[] = [];
  for (let sI = 0; sI < BSEG; sI++) {
    const t = sI / BSEG;
    bpos.push(-0.5, t, 0, 0.5, t, 0);
  }
  bpos.push(0, 1, 0);
  for (let sI = 0; sI < BSEG - 1; sI++) {
    const a = sI * 2;
    bidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  bidx.push((BSEG - 1) * 2, (BSEG - 1) * 2 + 1, BSEG * 2);

  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.Float32BufferAttribute(bpos, 3));
  bg.setIndex(bidx);

  const grassMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  grassMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, grassUni);
    sh.vertexShader =
      `
      uniform float uTime,uWindAmp,uThickness,uRestBend;
      uniform vec2 uWind;
      attribute vec4 aParams;
      varying float vT; varying float vTint;
    ` +
      sh.vertexShader
        .replace(
          "#include <beginnormal_vertex>",
          `
        float gT=position.y, gH=aParams.x, gPh=aParams.y, gAng=aParams.z;
        float gCa=cos(gAng), gSa=sin(gAng);
        vT=gT; vTint=aParams.w;
        vec3 gRoot=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);
        float gWave=0.5+0.5*sin(gPh*1.73);
        float gRest=uRestBend*(0.58+gWave*0.42)*pow(gT,1.42)*gH;
        float gRa=gAng+sin(gPh*0.71)*0.52;
        float w1=sin(uTime*1.7+gPh+gRoot.x*0.14+gRoot.z*0.11);
        float w2=sin(uTime*0.4+gRoot.x*0.02+gRoot.z*0.017);
        vec2 gForce=uWind*uWindAmp*(0.55+0.45*w2)*(0.55+0.45*w1);
        float gShape=pow(gT,1.55)*(0.42+gH*0.62);
        vec2 gBend=gForce*gShape+vec2(cos(gRa),sin(gRa))*gRest;
        vec3 objectNormal=normalize(
          vec3(-gSa,0.0,gCa)+vec3(gCa,0.0,gSa)*position.x*2.2
          +vec3(0.0,0.62*gT,0.0)+vec3(gBend.x,0.0,gBend.y)*0.42);
      `
        )
        .replace(
          "#include <begin_vertex>",
          `
        float gTaper=max(0.02,1.0-gT*0.92);
        vec2 gRib=vec2(position.x*gCa-position.z*gSa,
                       position.x*gSa+position.z*gCa)*uThickness*gTaper;
        vec3 transformed=vec3(gRib.x,gT*gH,gRib.y);
        transformed.xz+=gBend;
        transformed.y-=abs(gRest)*pow(gT,1.7)*(0.24+gWave*0.08);
      `
        );
    sh.fragmentShader =
      `
      uniform float uSnow;
      varying float vT; varying float vTint;
    ` +
      sh.fragmentShader.replace(
        "#include <color_fragment>",
        `
      #include <color_fragment>
      vec3 gBase=vec3(0.042,0.062,0.030)*(0.74+vTint*0.54);
      vec3 gTip =vec3(0.225,0.290,0.132)*(0.76+vTint*0.56);
      gBase=mix(gBase,vec3(0.60,0.65,0.72),uSnow*0.86);
      gTip =mix(gTip ,vec3(0.90,0.94,1.00),uSnow);
      diffuseColor.rgb*=mix(gBase,gTip,pow(vT,0.82))*1.18;
    `
      );
  };
  grassMat.customProgramCacheKey = () => "finale-grass";

  const GRASS_N = window.innerWidth < 768 ? 24000 : 104000;
  const grass = new THREE.InstancedMesh(bg, grassMat, GRASS_N);
  // The instances span the whole disc; the base geometry's bounding sphere is
  // meaningless, so culling would pop the entire field.
  grass.frustumCulled = false;
  grass.receiveShadow = true;

  const aP = new Float32Array(GRASS_N * 4),
    m4 = new THREE.Matrix4();
  let n = 0,
    guard = 0;
  while (n < GRASS_N && guard < GRASS_N * 12) {
    guard++;
    const th = Math.random() * Math.PI * 2;
    const r = 3 + Math.pow(Math.random(), 0.55) * 112;
    const x = Math.cos(th) * r,
      z = Math.sin(th) * r;
    if (landSlope(x, z) > 0.6) continue;
    // Feather the field out toward its edge rather than ending on a circle.
    const edge = 1 - sm01((r - 34) / 74);
    if (Math.random() > 0.1 + edge * 0.86) continue;
    m4.makeTranslation(x, landH(x, z) - 0.02, z);
    grass.setMatrixAt(n, m4);
    aP[n * 4] = (0.085 + Math.pow(Math.random(), 1.5) * 0.2) * (0.42 + edge * 0.58);
    aP[n * 4 + 1] = Math.random() * 6.283;
    aP[n * 4 + 2] = Math.random() * 6.283;
    aP[n * 4 + 3] = Math.random();
    n++;
  }
  grass.count = n;
  grass.instanceMatrix.needsUpdate = true;
  bg.setAttribute("aParams", new THREE.InstancedBufferAttribute(aP, 4));
  group.add(grass);

  // ---------- field stones ----------
  const STONE_N = 2400;
  const sgeo = new THREE.IcosahedronGeometry(1, 0);
  const smat = new THREE.MeshStandardMaterial({
    color: 0x8d8676,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const stones = new THREE.InstancedMesh(sgeo, smat, STONE_N);
  stones.frustumCulled = false;
  stones.castShadow = true;
  stones.receiveShadow = true;
  const sm = new THREE.Matrix4(),
    sq = new THREE.Quaternion(),
    se = new THREE.Euler(),
    sv = new THREE.Vector3(),
    ss = new THREE.Vector3();
  let sn2 = 0,
    sguard = 0;
  while (sn2 < STONE_N && sguard < STONE_N * 12) {
    sguard++;
    const th = Math.random() * Math.PI * 2;
    const r = 6 + Math.pow(Math.random(), 0.7) * 240;
    const x = Math.cos(th) * r,
      z = Math.sin(th) * r;
    if (landSlope(x, z) > 0.75) continue;
    const sc = 0.06 + Math.pow(Math.random(), 2.1) * 0.22;
    se.set(Math.random() * 3, Math.random() * 6.283, Math.random() * 3);
    sq.setFromEuler(se);
    // Sink each stone slightly so it sits in the ground rather than on it.
    sv.set(x, landH(x, z) - sc * 0.35, z);
    ss.set(sc, sc * (0.6 + Math.random() * 0.5), sc);
    sm.compose(sv, sq, ss);
    stones.setMatrixAt(sn2, sm);
    sn2++;
  }
  stones.count = sn2;
  stones.instanceMatrix.needsUpdate = true;
  group.add(stones);

  // ---------- sky dome ----------
  // Kept out of the scaled group and sized in world units, so it always sits
  // outside the terrain no matter how the group is scaled.
  const skyCan = document.createElement("canvas");
  skyCan.width = 8;
  skyCan.height = 512;
  const skyTex = new THREE.CanvasTexture(skyCan);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyMat = new THREE.MeshBasicMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    map: skyTex,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(R1 * S * 1.25, 32, 24), skyMat);
  sky.renderOrder = -20;

  const fogColor = new THREE.Color(theme.fog);

  function paintSky(cols: number[]): void {
    const g = skyCan.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 0, 512);
    cols.forEach((c, i) =>
      grd.addColorStop(SKY_STOPS[i], "#" + ("000000" + c.toString(16)).slice(-6))
    );
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 512);
    skyTex.needsUpdate = true;
  }

  const land: Landscape = {
    group,
    sky,
    fogNear: theme.fogNear * S,
    fogFar: theme.fogFar * S,
    fogColor,
    counts: { terrainTris: idx.length / 3, grass: n, stones: sn2 },
    setTheme(t: LandTheme) {
      paintSky(t.sky);
      terrainMat.color.setHex(t.ground);
      grassMat.color.setHex(t.grass);
      fogColor.setHex(t.fog);
      land.fogNear = t.fogNear * S;
      land.fogFar = t.fogFar * S;
    },
    update(dt: number) {
      grassUni.uTime.value += dt;
    },
  };

  land.setTheme(theme);
  return land;
}
