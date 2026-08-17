import * as THREE from "three";
import {
  BIN,
  BIN_Z0,
  BIN_Z1,
  isBinOpen,
  ROW_COUNT,
  ROW_PITCH,
  rowZ,
} from "../data/cabin-layout";
const SHELL = 0xfafafb;
const DOOR = 0xf4f5f7;
const CAVITY = 0xd3d6db;
const SEAM = 0xc9ccd2;

/**
 * Bin underside: just the moulded panel seams. The vents, reading lights and
 * signs are real geometry from the service-unit models placed per row.
 */
function makePsuTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f2f3f5";
  ctx.fillRect(0, 0, w, h);

  // Seam at the row boundary.
  ctx.strokeStyle = "#d6d9de";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(2, h);
  ctx.stroke();

  // Recessed panel outline around the service-unit cutout.
  ctx.strokeStyle = "#e2e4e8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(40, 34, w - 80, h - 68, 10);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Slightly bowed bin door, hinged at its top edge (the local origin) so that
 * opening is a plain rotation. The bow is measured from the door's own run so
 * the panel stays a gentle curve instead of ballooning past its width.
 */
function makeDoorGeometry(dir: number, run: number, drop: number, bayLen: number) {
  const t = 0.022;
  const bow = 0.05;
  const outerCtrl = dir * (run * 0.5 + bow);
  const innerCtrl = outerCtrl - dir * t;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(outerCtrl, -drop * 0.5, dir * run, -drop);
  shape.lineTo(dir * run, -drop - t);
  shape.quadraticCurveTo(innerCtrl, -drop * 0.5 - t, 0, -t);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: bayLen, bevelEnabled: false });
}

/**
 * Overhead luggage bins: a continuous housing with a cavity notch, plus one
 * hinged door per seat row. Open bays reveal the cavity for stowed bags.
 */
export class OverheadBins {
  readonly group = new THREE.Group();

  constructor() {
    const shellMat = new THREE.MeshStandardMaterial({
      color: SHELL,
      roughness: 0.85,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: DOOR,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const cavityMat = new THREE.MeshStandardMaterial({
      color: CAVITY,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    const seamMat = new THREE.MeshStandardMaterial({ color: SEAM, roughness: 1 });
    const psuMat = new THREE.MeshStandardMaterial({
      map: makePsuTexture(),
      roughness: 0.75,
    });
    const L = BIN_Z1 - BIN_Z0;
    const midZ = (BIN_Z0 + BIN_Z1) / 2;
    (psuMat.map as THREE.Texture).repeat.set(1, L / ROW_PITCH);

    const bayLen = ROW_PITCH - BIN.bayGap;
    // Door span from the hinge at the cavity mouth down to the front lip.
    const doorRun = BIN.cavityFrontX - BIN.innerTopX + 0.02;
    const doorDrop = BIN.innerTopY - (BIN.cavityFloorY - 0.04);

    for (const side of ["port", "starboard"] as const) {
      const dir = side === "port" ? -1 : 1;

      // Continuous housing: outer wall, top, cavity ceiling, back, floor, lip,
      // and the underside that carries the service panel.
      const profile: Array<[number, number]> = [
        [BIN.outerX, BIN.bottomY],
        [BIN.outerX, BIN.topY],
        [BIN.innerTopX, BIN.innerTopY],
        [BIN.cavityBackX, BIN.cavityCeilY],
        [BIN.cavityBackX, BIN.cavityFloorY - 0.02],
        [BIN.cavityFrontX, BIN.cavityFloorY],
        [BIN.cavityFrontX, BIN.bottomY],
      ];
      const shape = new THREE.Shape();
      profile.forEach(([x, y], i) => {
        if (i === 0) shape.moveTo(dir * x, y);
        else shape.lineTo(dir * x, y);
      });
      shape.closePath();
      const housing = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false }),
        shellMat,
      );
      housing.position.z = BIN_Z0;
      this.group.add(housing);

      // Cavity liner so the recess reads darker than the white shell.
      const liner = new THREE.Mesh(
        new THREE.BoxGeometry(BIN.cavityBackX - BIN.cavityFrontX, 0.012, L),
        cavityMat,
      );
      liner.position.set(
        dir * ((BIN.cavityFrontX + BIN.cavityBackX) / 2),
        BIN.cavityFloorY + 0.006,
        midZ,
      );
      this.group.add(liner);

      const linerBack = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, BIN.cavityCeilY - BIN.cavityFloorY, L),
        cavityMat,
      );
      linerBack.position.set(
        dir * (BIN.cavityBackX - 0.008),
        (BIN.cavityFloorY + BIN.cavityCeilY) / 2,
        midZ,
      );
      this.group.add(linerBack);

      // Service panel on the bin underside.
      const psu = new THREE.Mesh(
        new THREE.PlaneGeometry(BIN.outerX - BIN.cavityFrontX - 0.06, L),
        psuMat,
      );
      psu.rotation.x = Math.PI / 2;
      psu.rotation.z = dir === -1 ? Math.PI : 0;
      psu.position.set(
        dir * ((BIN.cavityFrontX + BIN.outerX) / 2),
        BIN.bottomY - 0.002,
        midZ,
      );
      this.group.add(psu);

      const doorGeo = makeDoorGeometry(dir, doorRun, doorDrop, bayLen);
      const dividerGeo = new THREE.BoxGeometry(
        BIN.cavityBackX - BIN.cavityFrontX,
        BIN.cavityCeilY - BIN.cavityFloorY,
        0.012,
      );

      for (let row = 1; row <= ROW_COUNT; row++) {
        const z0 = rowZ(row) - ROW_PITCH / 2 + BIN.bayGap / 2;
        const open = isBinOpen(side, row);

        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(dir * BIN.innerTopX, BIN.innerTopY, z0);
        // Hinge is the local origin, so opening is a plain rotation about it.
        door.rotation.z = open ? dir * BIN.openAngle : 0;
        door.name = `bin-door-${side}-${row}`;
        this.group.add(door);

        if (!open) {
          // Latch recess, centered on the closed door face.
          const latch = new THREE.Mesh(
            new THREE.BoxGeometry(0.015, 0.03, 0.09),
            seamMat,
          );
          latch.position.set(
            dir * (BIN.cavityFrontX + 0.005),
            BIN.cavityFloorY + 0.11,
            z0 + bayLen / 2,
          );
          this.group.add(latch);
        }

        // Bay divider inside the cavity.
        const divider = new THREE.Mesh(dividerGeo, cavityMat);
        divider.position.set(
          dir * ((BIN.cavityFrontX + BIN.cavityBackX) / 2),
          (BIN.cavityFloorY + BIN.cavityCeilY) / 2,
          z0 - BIN.bayGap / 2,
        );
        this.group.add(divider);
      }
    }
  }
}
