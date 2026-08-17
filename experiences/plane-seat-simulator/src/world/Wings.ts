import * as THREE from "three";
import { ENGINE, WING, WING_Z, wingChordY } from "../data/cabin-layout";

const SKIN = 0xdfe3e8;
const NACELLE = 0xe9ebef;
const DARK = 0x2b3038;
const PANEL_LINE = 0x9aa4b0;

/**
 * Section profile, as fractions of chord: leading edge, back along the upper
 * surface to the trailing edge, then forward again underneath. Closed by
 * wrapping, so the last point joins the first.
 */
const AIRFOIL: Array<[number, number]> = [
  [0, 0],
  [0.012, 0.026], [0.03, 0.04], [0.06, 0.054], [0.1, 0.065],
  [0.16, 0.077], [0.24, 0.085], [0.34, 0.087], [0.45, 0.082],
  [0.56, 0.073], [0.68, 0.058], [0.8, 0.04], [0.9, 0.023], [1, 0.004],
  [1, -0.004], [0.9, -0.014], [0.8, -0.024], [0.68, -0.033],
  [0.56, -0.039], [0.45, -0.042], [0.34, -0.042], [0.24, -0.039],
  [0.16, -0.034], [0.1, -0.027], [0.06, -0.021], [0.03, -0.015], [0.012, -0.009],
];

interface Station {
  /** Leading edge point. */
  origin: THREE.Vector3;
  /** Unit vector toward the trailing edge. */
  chordDir: THREE.Vector3;
  /** Unit vector toward the profile's upper surface. */
  thickDir: THREE.Vector3;
  chord: number;
  /** Multiplier on the profile's thickness, thinning toward a tip. */
  thick: number;
}

/**
 * Skins a run of section profiles into a closed surface. Every station uses
 * the same profile, so the sections stay in step and the quads between them
 * never cross; the ends are capped with a fan so the solid reads closed.
 */
function loft(stations: Station[], flip: boolean): THREE.BufferGeometry {
  const n = AIRFOIL.length;
  const positions: number[] = [];
  const scratch = new THREE.Vector3();

  for (const s of stations) {
    for (const [c, t] of AIRFOIL) {
      scratch
        .copy(s.origin)
        .addScaledVector(s.chordDir, c * s.chord)
        .addScaledVector(s.thickDir, t * s.chord * s.thick);
      positions.push(scratch.x, scratch.y, scratch.z);
    }
  }

  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let s = 0; s < stations.length - 1; s++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      quad(s * n + i, s * n + j, (s + 1) * n + j, (s + 1) * n + i);
    }
  }
  // Caps: a triangle fan off each end ring's first vertex.
  const last = (stations.length - 1) * n;
  for (let i = 1; i < n - 1; i++) {
    if (flip) {
      index.push(0, i, i + 1);
      index.push(last, last + i + 1, last + i);
    } else {
      index.push(0, i + 1, i);
      index.push(last, last + i, last + i + 1);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(index);
  geom.computeVertexNormals();
  return geom;
}

/** Planform control points, inboard to tip. */
const PLAN = [
  { x: WING.rootX, le: WING.rootLE, te: WING.rootTE, thick: 1.35 },
  { x: WING.kinkX, le: WING.kinkLE, te: WING.kinkTE, thick: 1.1 },
  { x: WING.tipX, le: WING.tipLE, te: WING.tipTE, thick: 0.75 },
];

/** Samples the planform, subdividing each panel so the dihedral reads smooth. */
function wingStations(dir: number): Station[] {
  const chordDir = new THREE.Vector3(0, 0, 1);
  const thickDir = new THREE.Vector3(0, 1, 0);
  const out: Station[] = [];
  for (let p = 0; p < PLAN.length - 1; p++) {
    const a = PLAN[p];
    const b = PLAN[p + 1];
    const steps = 6;
    const lastPanel = p === PLAN.length - 2;
    for (let i = 0; i <= steps; i++) {
      // The next panel opens on this station, so only the last one closes.
      if (i === steps && !lastPanel) break;
      const k = i / steps;
      const x = a.x + (b.x - a.x) * k;
      const le = a.le + (b.le - a.le) * k;
      const te = a.te + (b.te - a.te) * k;
      out.push({
        origin: new THREE.Vector3(dir * x, wingChordY(x), WING_Z + le),
        chordDir,
        thickDir,
        chord: te - le,
        thick: a.thick + (b.thick - a.thick) * k,
      });
    }
  }
  return out;
}

/** Upturned tip fin: sections stack upward with thickness across the span. */
function sharkletStations(dir: number): Station[] {
  const chordDir = new THREE.Vector3(0, 0, 1);
  const thickDir = new THREE.Vector3(dir, 0, 0);
  const tipChord = WING.tipTE - WING.tipLE;
  const baseY = wingChordY(WING.tipX);
  const steps = [
    { up: -0.05, x: 0, chord: 1.0, le: 0, thick: 0.8 },
    { up: 0.45, x: 0.07, chord: 0.74, le: 0.34, thick: 0.62 },
    { up: 0.78, x: 0.13, chord: 0.55, le: 0.6, thick: 0.5 },
    { up: 1.0, x: 0.18, chord: 0.36, le: 0.78, thick: 0.38 },
  ];
  return steps.map((s) => ({
    origin: new THREE.Vector3(
      dir * (WING.tipX + s.x),
      baseY + s.up * WING.sharklet,
      WING_Z + WING.tipLE + s.le,
    ),
    chordDir,
    thickDir,
    chord: tipChord * s.chord,
    thick: s.thick,
  }));
}

/**
 * Everything outside the fuselage: a lofted swept wing with dihedral, its
 * sharklet, the underslung engine, and the trailing-edge hardware. Sized to
 * narrow-body proportions, so from an overwing row the wing fills the view
 * the way it does on a real aircraft.
 */
export class Wings {
  readonly group = new THREE.Group();

  constructor() {
    const skinMat = new THREE.MeshStandardMaterial({
      color: SKIN,
      roughness: 0.42,
      metalness: 0.5,
      side: THREE.DoubleSide,
    });
    const nacelleMat = new THREE.MeshStandardMaterial({
      color: NACELLE,
      roughness: 0.34,
      metalness: 0.55,
      side: THREE.DoubleSide,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: DARK,
      roughness: 0.55,
      metalness: 0.7,
      side: THREE.DoubleSide,
    });
    const lineMat = new THREE.LineBasicMaterial({ color: PANEL_LINE });

    for (const dir of [-1, 1]) {
      const flip = dir < 0;
      const stations = wingStations(dir);
      this.group.add(new THREE.Mesh(loft(stations, flip), skinMat));
      this.group.add(new THREE.Mesh(loft(sharkletStations(dir), flip), skinMat));

      this.addPanelLines(stations, dir, lineMat);
      this.addFlapFairings(dir, skinMat);
      this.addEngine(dir, nacelleMat, darkMat);

      // Navigation light on the sharklet: green to starboard, red to port.
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 10, 8),
        new THREE.MeshBasicMaterial({ color: dir > 0 ? 0x35e06a : 0xf0453c }),
      );
      light.position.set(
        dir * (WING.tipX + 0.18),
        wingChordY(WING.tipX) + WING.sharklet,
        WING_Z + WING.tipLE + 0.9,
      );
      this.group.add(light);
    }
  }

  /** Hinge lines for the spoilers, flaps and aileron, laid on the upper skin. */
  private addPanelLines(
    stations: Station[],
    dir: number,
    material: THREE.LineBasicMaterial,
  ) {
    const pts: number[] = [];
    const surface = (s: Station, c: number) => {
      // Upper-surface height at this chord fraction, read off the profile.
      let t = 0;
      for (let i = 1; i < AIRFOIL.length; i++) {
        const [c0, t0] = AIRFOIL[i - 1];
        const [c1, t1] = AIRFOIL[i];
        if (t1 < 0) break;
        if (c >= c0 && c <= c1 && c1 > c0) {
          t = t0 + ((t1 - t0) * (c - c0)) / (c1 - c0);
          break;
        }
      }
      return new THREE.Vector3()
        .copy(s.origin)
        .addScaledVector(s.chordDir, c * s.chord)
        .addScaledVector(s.thickDir, t * s.chord * s.thick + 0.015);
    };

    for (const frac of [0.63, 0.74]) {
      for (let i = 0; i < stations.length - 1; i++) {
        const a = surface(stations[i], frac);
        const b = surface(stations[i + 1], frac);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    // Chordwise breaks between control surfaces.
    for (const i of [3, 6, 9]) {
      const s = stations[Math.min(i, stations.length - 1)];
      const a = surface(s, 0.63);
      const b = surface(s, 0.99);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geom, material);
    lines.userData.side = dir;
    this.group.add(lines);
  }

  /** Teardrop fairings carrying the flap tracks under the trailing edge. */
  private addFlapFairings(dir: number, material: THREE.Material) {
    const profile = [
      [0.0, 0.0],
      [0.13, 0.3],
      [0.18, 0.8],
      [0.17, 1.5],
      [0.11, 2.2],
      [0.0, 2.7],
    ].map(([r, u]) => new THREE.Vector2(r, u));

    for (const x of [2.7, 4.3, 6.9]) {
      const k = (x - WING.rootX) / (WING.tipX - WING.rootX);
      const le = WING.rootLE + (WING.tipLE - WING.rootLE) * k;
      const te = WING.rootTE + (WING.tipTE - WING.rootTE) * k;
      const fairing = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), material);
      // Lathe spins about local Y; tipping it lays the teardrop along the chord.
      fairing.rotation.x = Math.PI / 2;
      fairing.position.set(
        dir * x,
        wingChordY(x) - 0.12 - 0.04 * (1 - k),
        WING_Z + te - 1.9 + (te - le) * 0.05,
      );
      this.group.add(fairing);
    }
  }

  /** Nacelle, fan, exhaust and pylon, hung ahead of and below the wing. */
  private addEngine(
    dir: number,
    nacelleMat: THREE.Material,
    darkMat: THREE.Material,
  ) {
    const engine = new THREE.Group();
    engine.position.set(dir * ENGINE.x, ENGINE.y, ENGINE.frontZ);

    const r = ENGINE.radius;
    // Radius against distance aft of the inlet plane: duct interior, round
    // over the lip, then the cowl tapering to the nozzle.
    const cowl = [
      [0.8 * r, 0.42],
      [0.78 * r, 0.2],
      [0.77 * r, 0.03],
      [0.83 * r, 0.0],
      [0.91 * r, 0.02],
      [0.97 * r, 0.11],
      [1.0 * r, 0.45],
      [1.0 * r, 1.0],
      [0.97 * r, 1.75],
      [0.89 * r, 2.45],
      [0.78 * r, 3.05],
      [0.69 * r, ENGINE.length],
    ].map(([rad, u]) => new THREE.Vector2(rad, u));
    // Lathe spins about local Y; tipping it +90 deg runs the axis aft (+Z),
    // so the profile's distance-aft figures land where they read.
    const nacelle = new THREE.Mesh(new THREE.LatheGeometry(cowl, 28), nacelleMat);
    nacelle.rotation.x = Math.PI / 2;
    engine.add(nacelle);

    // Fan: a dark disc set back inside the duct, with blades and a spinner.
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.8 * r, 28),
      darkMat,
    );
    face.rotation.y = Math.PI;
    face.position.z = 0.44;
    engine.add(face);

    const bladeGeo = new THREE.BoxGeometry(0.022, 0.72 * r, 0.14);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const blade = new THREE.Mesh(bladeGeo, nacelleMat);
      blade.position.set(
        Math.cos(a) * 0.42 * r,
        Math.sin(a) * 0.42 * r,
        0.4,
      );
      blade.rotation.z = a - Math.PI / 2;
      blade.rotation.y = 0.5;
      engine.add(blade);
    }

    const spinner = new THREE.Mesh(
      new THREE.ConeGeometry(0.15 * r, 0.4, 16),
      darkMat,
    );
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = 0.22;
    engine.add(spinner);

    const plug = new THREE.Mesh(
      new THREE.ConeGeometry(0.42 * r, 0.95, 20),
      darkMat,
    );
    plug.rotation.x = Math.PI / 2;
    plug.position.z = ENGINE.length + 0.2;
    engine.add(plug);

    this.group.add(engine);

    // Pylon bridging the nacelle crown to the wing underside.
    const wingY = wingChordY(ENGINE.x);
    const under = wingY - 0.2;
    const top = ENGINE.y + r;
    const pylon = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, Math.max(under - top, 0.1) + 0.16, 2.0),
      nacelleMat,
    );
    pylon.position.set(
      dir * ENGINE.x,
      (top + under) / 2,
      ENGINE.frontZ + ENGINE.length * 0.55,
    );
    this.group.add(pylon);
  }
}
