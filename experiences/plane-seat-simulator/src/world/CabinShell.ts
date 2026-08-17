import * as THREE from "three";
import {
  AISLE_X,
  BIN,
  BIN_Z0,
  BIN_Z1,
  CORRIDOR,
  CORRIDOR_X,
  CROWN,
  crownOffset,
  crownYAt,
  DIMS,
  PANEL_TILT,
  panelV,
  WALL,
  wallSurfaceX,
  WINDOWS,
} from "../data/cabin-layout";

const WHITE = 0xf7f7f9;
const PANEL = 0xf1f2f4;
const TRIM = 0xe8e9ed;
const CARPET = 0x76808f;
const AISLE_STRIP = 0x3d4451;

/** Depth of the window reveal, i.e. the apparent fuselage wall thickness. */
const WINDOW_DEPTH = 0.1;

const PANEL_LEN = panelV(WALL.panelTopY);

function panelMaterial(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

/** Draws a rounded-rectangle outline (airliner window profile) onto a path. */
function roundedRect(
  target: THREE.Path | THREE.Shape,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  radius: number,
) {
  const r = Math.min(radius, hw, hh);
  target.moveTo(cx - hw + r, cy - hh);
  target.lineTo(cx + hw - r, cy - hh);
  target.absarc(cx + hw - r, cy - hh + r, r, -Math.PI / 2, 0, false);
  target.lineTo(cx + hw, cy + hh - r);
  target.absarc(cx + hw - r, cy + hh - r, r, 0, Math.PI / 2, false);
  target.lineTo(cx - hw + r, cy + hh);
  target.absarc(cx - hw + r, cy + hh - r, r, Math.PI / 2, Math.PI, false);
  target.lineTo(cx - hw, cy - hh + r);
  target.absarc(cx - hw + r, cy - hh + r, r, Math.PI, Math.PI * 1.5, false);
}

/**
 * Cross-section of the crown shell: an arc band on the fuselage circle,
 * `halfWidth` either side of the centerline. Built in XY so extruding it runs
 * the arch straight down the cabin.
 */
function crownSection(halfWidth: number, thickness: number) {
  const steps = 32;
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const x = -halfWidth + (2 * halfWidth * i) / steps;
    if (i === 0) shape.moveTo(x, crownYAt(x));
    else shape.lineTo(x, crownYAt(x));
  }
  for (let i = steps; i >= 0; i--) {
    const x = -halfWidth + (2 * halfWidth * i) / steps;
    shape.lineTo(...crownOffset(x, thickness));
  }
  shape.closePath();
  return shape;
}

/**
 * One window: an inner bezel flange on the cabin side, a recessed reveal
 * tunnel giving the fuselage real thickness, and a glass pane outboard.
 * Built in local XY with the cabin side at z = 0 and outboard toward -Z.
 */
function makeWindow(
  hw: number,
  hh: number,
  frameMat: THREE.Material,
  glassMat: THREE.Material,
) {
  const group = new THREE.Group();
  const r = Math.min(hw, hh) * 0.78;

  const reveal = new THREE.Shape();
  roundedRect(reveal, 0, 0, hw + 0.02, hh + 0.02, r + 0.02);
  const revealHole = new THREE.Path();
  roundedRect(revealHole, 0, 0, hw, hh, r);
  reveal.holes.push(revealHole);
  const revealMesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(reveal, { depth: WINDOW_DEPTH, bevelEnabled: false }),
    frameMat,
  );
  revealMesh.position.z = -WINDOW_DEPTH;
  group.add(revealMesh);

  const bezel = new THREE.Shape();
  roundedRect(bezel, 0, 0, hw + 0.06, hh + 0.06, r + 0.055);
  const bezelHole = new THREE.Path();
  roundedRect(bezelHole, 0, 0, hw, hh, r);
  bezel.holes.push(bezelHole);
  const bezelMesh = new THREE.Mesh(new THREE.ShapeGeometry(bezel, 16), frameMat);
  bezelMesh.position.z = 0.005;
  group.add(bezelMesh);

  const paneShape = new THREE.Shape();
  roundedRect(paneShape, 0, 0, hw, hh, r);
  const pane = new THREE.Mesh(new THREE.ShapeGeometry(paneShape, 16), glassMat);
  pane.position.z = -WINDOW_DEPTH + 0.008;
  group.add(pane);

  return group;
}

/**
 * Procedural airliner fuselage interior: carpet floor, flared skirt, tilted
 * window panels with recessed windows, overhead luggage bins, cove panels
 * arching into a white ceiling, and wings outside the overwing rows.
 */
export class CabinShell {
  readonly group = new THREE.Group();

  constructor() {
    const wallMat = panelMaterial(WHITE);
    const panelMat = panelMaterial(PANEL);
    const trimMat = panelMaterial(TRIM);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xdcebf8,
      transparent: true,
      opacity: 0.12,
      roughness: 0.04,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const L = DIMS.length;

    // Floor: carpet with a darker aisle runner (offset to the 2-3 aisle).
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(DIMS.width, 0.08, L),
      new THREE.MeshStandardMaterial({ color: CARPET, roughness: 1 }),
    );
    floor.position.set(0, -0.04, L / 2);
    this.group.add(floor);

    const aisle = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.01, L),
      new THREE.MeshStandardMaterial({ color: AISLE_STRIP, roughness: 1 }),
    );
    aisle.position.set(AISLE_X, 0.005, L / 2);
    this.group.add(aisle);

    // Skirt panels (floor edge flaring out to the window-panel base).
    {
      const run = Math.hypot(WALL.skirtTopX - WALL.skirtBottomX, WALL.skirtTopY);
      const angle = Math.atan(
        (WALL.skirtTopX - WALL.skirtBottomX) / WALL.skirtTopY,
      );
      for (const dir of [-1, 1]) {
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.03, run, L), panelMat);
        skirt.rotation.z = -dir * angle;
        skirt.position.set(
          dir * ((WALL.skirtBottomX + WALL.skirtTopX) / 2),
          WALL.skirtTopY / 2,
          L / 2,
        );
        this.group.add(skirt);
      }
    }

    // Window panels: extruded shapes with rounded-rectangle window apertures,
    // tilted inward like a real fuselage cross-section. Door and exit
    // positions stay solid so nothing can leak around a mounted door model.
    for (const side of ["port", "starboard"] as const) {
      const dir = side === "port" ? -1 : 1;
      const sideWindows = WINDOWS.filter((w) => w.side === side);

      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(L, 0);
      shape.lineTo(L, PANEL_LEN);
      shape.lineTo(0, PANEL_LEN);
      shape.closePath();
      for (const w of sideWindows) {
        const hh = w.ry / Math.cos(PANEL_TILT);
        const hole = new THREE.Path();
        roundedRect(hole, w.z, panelV(w.y), w.rx, hh, Math.min(w.rx, hh) * 0.78);
        shape.holes.push(hole);
      }
      const wall = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, {
          depth: DIMS.wallThickness,
          bevelEnabled: false,
        }),
        wallMat,
      );
      // Local +X maps to world +Z; the panel leans inboard as it rises.
      wall.rotation.order = "ZYX";
      wall.rotation.y = -Math.PI / 2;
      wall.rotation.z = dir * PANEL_TILT;
      wall.position.set(
        dir === -1 ? -WALL.skirtTopX : WALL.skirtTopX + DIMS.wallThickness,
        WALL.skirtTopY,
        0,
      );
      this.group.add(wall);

      for (const w of sideWindows) {
        const win = makeWindow(
          w.rx,
          w.ry / Math.cos(PANEL_TILT),
          trimMat,
          glassMat,
        );
        win.rotation.order = "ZYX";
        win.rotation.y = dir === -1 ? Math.PI / 2 : -Math.PI / 2;
        win.rotation.z = dir * PANEL_TILT;
        win.position.set(dir * (wallSurfaceX(w.y) - 0.004), w.y, w.z);
        this.group.add(win);
      }
    }

    // Cove panels bridging each bin's inner top edge to the ceiling strip,
    // with a warm light strip washing up into the cove. The bins themselves
    // are built by OverheadBins.
    const binRun = BIN_Z1 - BIN_Z0;
    const binMidZ = (BIN_Z0 + BIN_Z1) / 2;
    /** Where the coves hand off to the crown, between the two bin runs. */
    const coveTopX = 0.34;
    for (const dir of [-1, 1]) {
      const from = new THREE.Vector2(BIN.innerTopX, BIN.innerTopY);
      const to = new THREE.Vector2(coveTopX, crownYAt(coveTopX));
      const run = from.distanceTo(to) + 0.06;
      const cove = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, run, binRun),
        wallMat,
      );
      cove.rotation.z = dir * Math.atan2(from.x - to.x, to.y - from.y);
      cove.position.set(
        dir * ((from.x + to.x) / 2),
        (from.y + to.y) / 2,
        binMidZ,
      );
      this.group.add(cove);

      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.015, binRun),
        new THREE.MeshBasicMaterial({ color: 0xfff4e2 }),
      );
      strip.position.set(dir * (BIN.innerTopX - 0.03), BIN.innerTopY + 0.03, binMidZ);
      this.group.add(strip);
    }

    // Crown shell, arched on the fuselage circle. Between the bins only the
    // strip inboard of the coves is ever seen, so that is all it spans there.
    // Fore and aft, where there are no bins, the arch carries the full width
    // and closes the cabin — without it the sky shows straight through above
    // the galleys and lavatory.
    const addCrown = (halfWidth: number, z0: number, z1: number) => {
      if (z1 - z0 <= 0.01) return;
      const crown = new THREE.Mesh(
        new THREE.ExtrudeGeometry(crownSection(halfWidth, 0.04), {
          depth: z1 - z0,
          bevelEnabled: false,
        }),
        wallMat,
      );
      crown.position.z = z0;
      this.group.add(crown);
    };

    const openZones: Array<[number, number]> = [
      [0, BIN_Z0],
      [BIN_Z1, L],
    ];
    addCrown(coveTopX, BIN_Z0, BIN_Z1);
    for (const [z0, z1] of openZones) {
      addCrown(CROWN.springX, z0, z1);

      // Upper sidewall carrying the arch down onto the window panels.
      const span = z1 - z0;
      if (span <= 0.01) continue;
      const midSpan = (z0 + z1) / 2;
      for (const dir of [-1, 1]) {
        const upper = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, CROWN.springY - 1.74, span),
          wallMat,
        );
        upper.position.set(
          dir * WALL.panelTopX,
          (CROWN.springY + 1.74) / 2,
          midSpan,
        );
        this.group.add(upper);
      }
    }

    // Front bulkhead, broken by the archway into the cockpit corridor. Built
    // as four slabs around the opening rather than a shape with a hole, so the
    // bulkhead keeps its thickness on every edge of the arch.
    const bulkX = DIMS.width / 2 + 0.15;
    const bulkTop = CROWN.peakY + 0.25;
    const bulkBottom = -0.25;
    const archX0 = CORRIDOR_X - CORRIDOR.archWidth / 2;
    const archX1 = CORRIDOR_X + CORRIDOR.archWidth / 2;
    // Spans as [x0, x1, y0, y1], turned into slabs below.
    const bulkPieces: Array<[number, number, number, number]> = [
      [-bulkX, archX0, bulkBottom, bulkTop],
      [archX1, bulkX, bulkBottom, bulkTop],
      [archX0, archX1, CORRIDOR.archHeight, bulkTop],
      // Threshold under the arch, closing the gap down to the floor slab.
      [archX0, archX1, bulkBottom, 0],
    ];
    for (const [x0, x1, y0, y1] of bulkPieces) {
      if (x1 - x0 <= 0.001 || y1 - y0 <= 0.001) continue;
      const piece = new THREE.Mesh(
        new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.08),
        wallMat,
      );
      piece.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.04);
      this.group.add(piece);
    }
    // Reveal lining the archway, so the cut edge reads as a finished jamb.
    for (const x of [archX0, archX1]) {
      const jamb = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, CORRIDOR.archHeight, 0.08),
        trimMat,
      );
      jamb.position.set(x, CORRIDOR.archHeight / 2, -0.04);
      this.group.add(jamb);
    }
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(CORRIDOR.archWidth, 0.02, 0.08),
      trimMat,
    );
    lintel.position.set(CORRIDOR_X, CORRIDOR.archHeight, -0.04);
    this.group.add(lintel);

    // Rear wall.
    const rear = new THREE.Mesh(
      new THREE.BoxGeometry(DIMS.width + 0.3, CROWN.peakY + 0.5, 0.08),
      wallMat,
    );
    rear.position.set(0, CROWN.peakY / 2,L + 0.04);
    this.group.add(rear);

    // Wings are built by Wings.ts, which owns everything outside the fuselage.
  }
}
