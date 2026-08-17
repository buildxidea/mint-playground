import * as THREE from "three";
import { CORRIDOR, CORRIDOR_X } from "../data/cabin-layout";

const SHELL = 0xf2f3f5;
const TRIM = 0xe4e6ea;
const CARPET = 0x76808f;
const AISLE_STRIP = 0x3d4451;
const DOOR = 0xdfe2e7;
const METAL = 0x9aa1ab;

function panel(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.62,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
}

/** Placard face, drawn to a canvas so the lettering is real rather than implied. */
function makePlacard(lines: string[], accent: string, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f4f2";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 7;
  ctx.strokeRect(5, 5, 246, 118);
  ctx.fillStyle = accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Shrink to fit rather than trusting a fixed size: "NO ADMITTANCE" runs off
  // the canvas at the size a one-word placard wants.
  const inner = 256 - 34;
  let size = lines.length > 1 ? 34 : 44;
  const widest = () => {
    ctx.font = `bold ${size}px Arial`;
    return Math.max(...lines.map((l) => ctx.measureText(l).width));
  };
  while (size > 10 && widest() > inner) size -= 1;
  ctx.font = `bold ${size}px Arial`;
  lines.forEach((line, i) => {
    ctx.fillText(line, 128, 64 + (i - (lines.length - 1) / 2) * (size + 8));
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
}

/**
 * The walk-forward out of the cabin: a narrow corridor running from the
 * bulkhead archway to the flight deck door at its far end. Sealed on every
 * face, since it reaches forward of the fuselage shell, which stops at z = 0.
 */
export class CockpitCorridor {
  readonly group = new THREE.Group();

  constructor() {
    const shellMat = panel(SHELL);
    const trimMat = panel(TRIM);
    const doorMat = new THREE.MeshStandardMaterial({
      color: DOOR,
      roughness: 0.45,
      metalness: 0.25,
      side: THREE.DoubleSide,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: METAL,
      roughness: 0.35,
      metalness: 0.8,
    });

    const { frontZ, backZ, halfWidth, ceilingY, wall } = CORRIDOR;
    const depth = backZ - frontZ;
    const midZ = (frontZ + backZ) / 2;

    // Floor, carrying the aisle runner forward so the walk reads continuous.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 2 + wall * 2, 0.08, depth),
      new THREE.MeshStandardMaterial({ color: CARPET, roughness: 1 }),
    );
    floor.position.set(CORRIDOR_X, -0.04, midZ);
    this.group.add(floor);

    const runner = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.01, depth),
      new THREE.MeshStandardMaterial({ color: AISLE_STRIP, roughness: 1 }),
    );
    runner.position.set(CORRIDOR_X, 0.005, midZ);
    this.group.add(runner);

    // Side walls, with a rubbing strip at hand height.
    for (const dir of [-1, 1]) {
      const side = new THREE.Mesh(
        new THREE.BoxGeometry(wall, ceilingY, depth),
        shellMat,
      );
      side.position.set(CORRIDOR_X + dir * halfWidth, ceilingY / 2, midZ);
      this.group.add(side);

      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.05, depth - 0.1),
        trimMat,
      );
      rail.position.set(
        CORRIDOR_X + dir * (halfWidth - wall / 2 - 0.01),
        0.98,
        midZ,
      );
      this.group.add(rail);
    }

    // Ceiling with a lit panel, and a lamp to match it.
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 2 + wall * 2, wall, depth),
      shellMat,
    );
    ceiling.position.set(CORRIDOR_X, ceilingY, midZ);
    this.group.add(ceiling);

    const lightPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(halfWidth * 1.1, depth * 0.62),
      new THREE.MeshBasicMaterial({ color: 0xfff6e8 }),
    );
    lightPanel.rotation.x = Math.PI / 2;
    lightPanel.position.set(CORRIDOR_X, ceilingY - wall / 2 - 0.004, midZ);
    this.group.add(lightPanel);

    const lamp = new THREE.PointLight(0xfff2e0, 0.85, 4.2, 1.8);
    lamp.position.set(CORRIDOR_X, ceilingY - 0.15, midZ + 0.2);
    this.group.add(lamp);

    this.addCockpitDoor(shellMat, trimMat, doorMat, metalMat);
  }

  /** Forward end wall, its door leaf, and the hardware around it. */
  private addCockpitDoor(
    shellMat: THREE.Material,
    trimMat: THREE.Material,
    doorMat: THREE.Material,
    metalMat: THREE.Material,
  ) {
    const { frontZ, halfWidth, ceilingY, wall, doorWidth, doorHeight } = CORRIDOR;
    const x0 = CORRIDOR_X - doorWidth / 2;
    const x1 = CORRIDOR_X + doorWidth / 2;
    const left = CORRIDOR_X - halfWidth;
    const right = CORRIDOR_X + halfWidth;

    // End wall, built around the door opening.
    const endPieces: Array<[number, number, number, number]> = [
      [left, x0, 0, ceilingY],
      [x1, right, 0, ceilingY],
      [x0, x1, doorHeight, ceilingY],
    ];
    for (const [a, b, y0, y1] of endPieces) {
      if (b - a <= 0.001 || y1 - y0 <= 0.001) continue;
      const piece = new THREE.Mesh(
        new THREE.BoxGeometry(b - a, y1 - y0, wall),
        shellMat,
      );
      piece.position.set((a + b) / 2, (y0 + y1) / 2, frontZ);
      this.group.add(piece);
    }

    // Frame around the opening, then the leaf itself set into it.
    for (const x of [x0, x1]) {
      const jamb = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, doorHeight + 0.04, wall + 0.02),
        trimMat,
      );
      jamb.position.set(x, doorHeight / 2, frontZ);
      this.group.add(jamb);
    }
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth + 0.07, 0.035, wall + 0.02),
      trimMat,
    );
    head.position.set(CORRIDOR_X, doorHeight, frontZ);
    this.group.add(head);

    const leafZ = frontZ + wall / 2 + 0.012;
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth - 0.02, doorHeight - 0.02, 0.05),
      doorMat,
    );
    leaf.position.set(CORRIDOR_X, doorHeight / 2, leafZ);
    this.group.add(leaf);

    // Raised panel on the leaf, so it is not a bare slab. Everything mounted
    // on the door sits proud of this, or it swallows them.
    const inset = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth - 0.16, doorHeight - 0.34, 0.012),
      trimMat,
    );
    inset.position.set(CORRIDOR_X, doorHeight / 2 + 0.05, leafZ + 0.026);
    this.group.add(inset);
    const insetFace = leafZ + 0.032;

    // Viewing port, dark from the cabin side.
    const port = new THREE.Mesh(
      new THREE.CircleGeometry(0.045, 20),
      new THREE.MeshStandardMaterial({
        color: 0x1b2027,
        roughness: 0.2,
        metalness: 0.4,
      }),
    );
    port.position.set(CORRIDOR_X, 1.58, insetFace + 0.012);
    this.group.add(port);
    const portRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.008, 8, 20),
      metalMat,
    );
    portRing.position.copy(port.position);
    this.group.add(portRing);

    // Handle and the keypad that unlocks the door.
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.16, 0.03),
      metalMat,
    );
    handle.position.set(x1 - 0.11, 1.03, insetFace + 0.02);
    this.group.add(handle);

    const keypad = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.13, 0.018),
      new THREE.MeshStandardMaterial({
        color: 0x2a2f37,
        roughness: 0.5,
        metalness: 0.3,
      }),
    );
    keypad.position.set(x1 + 0.11, 1.25, frontZ + wall / 2 + 0.01);
    this.group.add(keypad);

    const placard = makePlacard(["NO ADMITTANCE"], "#b3261e", 0.3, 0.11);
    placard.position.set(CORRIDOR_X, 1.78, insetFace + 0.014);
    this.group.add(placard);

    const crew = makePlacard(["FLIGHT", "DECK"], "#1f2a37", 0.16, 0.1);
    crew.position.set(CORRIDOR_X, doorHeight + 0.11, frontZ + wall / 2 + 0.006);
    this.group.add(crew);
  }
}
