import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { LAVATORY as LAV } from "../data/cabin-layout";

const SHELL = 0xf6f7f8;
const TRIM = 0xe6e8ea;
const FLOOR = 0x3f4650;

function panel(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
}

/** Small placard decal, e.g. the no-smoking sign beside the door. */
function makePlacard(text: string, accent: string): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 120);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(52, 64, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(34, 82);
  ctx.lineTo(70, 46);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.font = "bold 26px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 160, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.11),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
}

/**
 * Enclosed lavatory module in the aft starboard corner: four square-cornered
 * walls, a ceiling with a light panel, and a floor. The inboard wall carries
 * the doorway; the outboard wall carries a window aperture whose reveal runs
 * out to the fuselage window beside it, so daylight still reaches the room
 * without the interior taking the fuselage's lean. Mint fixtures are placed
 * inside by CabinFurnishings.
 */
export class Lavatory {
  readonly group = new THREE.Group();
  private mirrors: Reflector[] = [];
  /** Index of the mirror whose reflection refreshes this frame. */
  private live = 0;

  constructor() {
    const shellMat = panel(SHELL);
    const trimMat = panel(TRIM);
    const depth = LAV.backZ - LAV.frontZ;
    const width = LAV.maxX - LAV.minX;
    const midZ = (LAV.frontZ + LAV.backZ) / 2;
    const midX = (LAV.minX + LAV.maxX) / 2;
    const h = LAV.ceilingY;
    const t = LAV.wall;

    // Inboard wall faces the aisle and carries the doorway: two jambs plus a
    // header, all running along Z.
    const jambs: Array<[number, number]> = [
      [LAV.frontZ, LAV.doorMinZ],
      [LAV.doorMaxZ, LAV.backZ],
    ];
    for (const [a, b] of jambs) {
      if (b - a <= 0.001) continue;
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(t, h, b - a), shellMat);
      jamb.position.set(LAV.minX, h / 2, (a + b) / 2);
      this.group.add(jamb);
    }
    // Clears the full height of the Mint bifold door in the opening.
    const doorH = 1.92;
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(t, h - doorH, LAV.doorMaxZ - LAV.doorMinZ),
      shellMat,
    );
    header.position.set(
      LAV.minX,
      (h + doorH) / 2,
      (LAV.doorMinZ + LAV.doorMaxZ) / 2,
    );
    this.group.add(header);

    // Aft wall.
    const aft = new THREE.Mesh(new THREE.BoxGeometry(width, h, t), shellMat);
    aft.position.set(midX, h / 2, LAV.backZ);
    this.group.add(aft);

    // Forward wall, now solid.
    const front = new THREE.Mesh(new THREE.BoxGeometry(width, h, t), shellMat);
    front.position.set(midX, h / 2, LAV.frontZ);
    this.group.add(front);

    // Outboard wall, built as four pieces around the window aperture so the
    // room stays a plain box instead of following the fuselage curve.
    const winZ0 = LAV.windowZ - LAV.windowHalfW;
    const winZ1 = LAV.windowZ + LAV.windowHalfW;
    const winY0 = LAV.windowY - LAV.windowHalfH;
    const winY1 = LAV.windowY + LAV.windowHalfH;
    const outboardPieces: Array<[number, number, number, number]> = [
      // [yCenter, height, zCenter, depth]
      [winY0 / 2, winY0, midZ, depth],
      [(winY1 + h) / 2, h - winY1, midZ, depth],
      [LAV.windowY, winY1 - winY0, (LAV.frontZ + winZ0) / 2, winZ0 - LAV.frontZ],
      [LAV.windowY, winY1 - winY0, (winZ1 + LAV.backZ) / 2, LAV.backZ - winZ1],
    ];
    for (const [y, hgt, z, d] of outboardPieces) {
      const piece = new THREE.Mesh(new THREE.BoxGeometry(t, hgt, d), shellMat);
      piece.position.set(LAV.maxX, y, z);
      this.group.add(piece);
    }

    // Reveal running from the aperture out to the fuselage panel, so the gap
    // behind the wall reads as a window recess rather than an open seam.
    const revealX = (LAV.maxX + 1.56) / 2;
    const revealD = 1.56 - LAV.maxX;
    const revealW = winZ1 - winZ0;
    const revealH = winY1 - winY0;
    for (const y of [winY0, winY1]) {
      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(revealD, 0.02, revealW),
        trimMat,
      );
      sill.position.set(revealX, y, LAV.windowZ);
      this.group.add(sill);
    }
    for (const z of [winZ0, winZ1]) {
      const jamb = new THREE.Mesh(
        new THREE.BoxGeometry(revealD, revealH, 0.02),
        trimMat,
      );
      jamb.position.set(revealX, LAV.windowY, z);
      this.group.add(jamb);
    }

    // Ceiling with a recessed light panel.
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(width, t, depth),
      shellMat,
    );
    ceiling.position.set(midX, h, midZ);
    this.group.add(ceiling);

    const lightPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.5, depth * 0.45),
      new THREE.MeshBasicMaterial({ color: 0xfffaf0 }),
    );
    lightPanel.rotation.x = Math.PI / 2;
    lightPanel.position.set(midX, h - t / 2 - 0.004, midZ);
    this.group.add(lightPanel);

    const lamp = new THREE.PointLight(0xfff4e4, 0.9, 3.2, 1.8);
    lamp.position.set(midX, h - 0.12, midZ);
    this.group.add(lamp);

    // Dark non-slip floor.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.012, depth),
      new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95 }),
    );
    floor.position.set(midX, 0.008, midZ);
    this.group.add(floor);

    // Mirrors are real planar reflectors: each renders the room from its
    // mirrored viewpoint into its own target. A metallic material would only
    // reflect an environment map, and there is none here, which is why the
    // glass used to go black as soon as the cabin lights carried the scene.
    const addMirror = (
      w: number,
      hgt: number,
      pos: [number, number, number],
      yaw: number,
      texture: number,
    ) => {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.05, hgt + 0.05, 0.015),
        trimMat,
      );
      frame.rotation.y = yaw;
      frame.position.set(...pos);
      this.group.add(frame);

      // Glass sits proud of its frame on the side the mirror faces.
      const glass = new Reflector(new THREE.PlaneGeometry(w, hgt), {
        textureWidth: texture,
        textureHeight: texture,
        color: 0xbcc6cc,
        clipBias: 0.003,
      });
      glass.rotation.y = yaw;
      glass.position.set(
        pos[0] + Math.sin(yaw) * 0.011,
        pos[1],
        pos[2] + Math.cos(yaw) * 0.011,
      );
      this.mirrors.push(glass);
      this.group.add(glass);
    };

    // Main mirror over the basin on the forward wall, a second above the
    // toilet on the aft wall, and a side mirror aft of the doorway.
    addMirror(0.66, 0.58, [0.8, 1.52, LAV.frontZ + t / 2 + 0.006], 0, 512);
    addMirror(0.42, 0.5, [1.02, 1.55, LAV.backZ - t / 2 - 0.006], Math.PI, 256);
    addMirror(0.44, 0.5, [LAV.minX + t / 2 + 0.008, 1.5, 19.78], Math.PI / 2, 256);

    // Slim stowage shelf under the side mirror.
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.03, 0.46),
      trimMat,
    );
    shelf.position.set(LAV.minX + 0.09, 1.18, 19.78);
    this.group.add(shelf);

    // No-smoking placard above the doorway, facing the aisle.
    const placard = makePlacard("NO SMOKING", "#c1272d");
    placard.rotation.y = -Math.PI / 2;
    placard.position.set(
      LAV.minX - t / 2 - 0.004,
      1.985,
      (LAV.doorMinZ + LAV.doorMaxZ) / 2,
    );
    this.group.add(placard);
  }

  /**
   * Narrows what the mirrors render. Each reflector re-renders the scene into
   * its own target, so three mirrors would otherwise cost three extra cabins
   * a frame. The room is sealed, so its reflections only need the lavatory,
   * its fixtures, and whatever shows through the window; every other
   * top-level object is hidden for the duration of the pass.
   *
   * A pass costs about the same however little it draws — the render-target
   * switch dominates — so only the mirror `update` has nominated refreshes on
   * any given frame. The others draw their previous frame's texture, which
   * also keeps them from nesting passes inside each other.
   */
  reflectOnly(objects: THREE.Object3D[]) {
    const keep = new Set(objects);
    this.mirrors.forEach((mirror, i) => {
      const base = mirror.onBeforeRender;
      mirror.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        if (i !== this.live) return;
        const hidden = scene.children.filter((c) => c.visible && !keep.has(c));
        for (const o of hidden) o.visible = false;
        base.call(mirror, renderer, scene, camera, geometry, material, group);
        for (const o of hidden) o.visible = true;
      };
    });
  }

  /** Hands the next frame's reflection pass to the next mirror in turn. */
  update() {
    if (this.mirrors.length > 0) {
      this.live = (this.live + 1) % this.mirrors.length;
    }
  }
}
