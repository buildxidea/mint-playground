import * as THREE from "three";
import type { AssetLibrary } from "../assets/AssetLibrary";
import {
  AFT_GALLEY,
  BIN,
  binCavityAnchor,
  EXITS,
  GALLEY,
  LAVATORY,
  OPEN_BINS,
  PANEL_TILT,
  ROW_COUNT,
  rowZ,
  SEAT_FOOT,
  SEATS,
  wallSurfaceX,
} from "../data/cabin-layout";

/** Height the exit hatches and door placards are centered on. */
// Kept low enough that the hatch clears the underside of the overhead bins.
const HATCH_Y = 1.03;
const PLACARD_Y = 1.72;

function makeExitPlacard(): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = "#c1272d";
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = "#c1272d";
  ctx.font = "bold 64px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("EXIT", 128, 52);
  const tex = new THREE.CanvasTexture(canvas);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.11),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
}

/**
 * Places Mint-generated furniture from the layout data, plus invisible seat
 * pick proxies (always present, independent of model load state).
 */
export class CabinFurnishings {
  readonly group = new THREE.Group();
  /**
   * Lavatory fixtures live in their own top-level group so the lavatory
   * mirrors can render the room without dragging the whole cabin along.
   */
  readonly lavatoryGroup = new THREE.Group();
  /** Raycast targets carrying userData.locationId. */
  readonly pickProxies: THREE.Mesh[] = [];

  constructor() {
    const proxyMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    for (const seat of SEATS) {
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(SEAT_FOOT.w, SEAT_FOOT.h, SEAT_FOOT.d),
        proxyMat,
      );
      proxy.position.set(seat.pos[0], SEAT_FOOT.h / 2, seat.pos[2]);
      proxy.userData.locationId = seat.id;
      this.pickProxies.push(proxy);
      this.group.add(proxy);
    }

    // EXIT placards above each exit, lying flat on the tilted sidewall.
    for (const exit of EXITS) {
      const dir = exit.side === "port" ? -1 : 1;
      const placard = makeExitPlacard();
      placard.rotation.order = "ZYX";
      placard.rotation.y = -dir * (Math.PI / 2);
      placard.rotation.z = dir * PANEL_TILT;
      placard.position.set(dir * (wallSurfaceX(PLACARD_Y) - 0.012), PLACARD_Y, exit.z);
      this.group.add(placard);
    }
  }

  /** Called whenever a model template becomes available. */
  populate(library: AssetLibrary) {
    // Clear previously placed furniture (keep proxies/placards).
    for (const parent of [this.group, this.lavatoryGroup]) {
      const stale = parent.children.filter((c) => c.name.startsWith("furn:"));
      stale.forEach((c) => parent.remove(c));
    }

    const placeIn = (
      parent: THREE.Group,
      obj: THREE.Group | null,
      name: string,
      pos: [number, number, number],
      yaw: number,
      tilt = 0,
    ) => {
      if (!obj) return;
      obj.name = `furn:${name}`;
      obj.position.set(...pos);
      obj.rotation.order = "ZYX";
      obj.rotation.y = yaw;
      obj.rotation.z = tilt;
      parent.add(obj);
    };
    const place = (
      obj: THREE.Group | null,
      name: string,
      pos: [number, number, number],
      yaw: number,
      tilt = 0,
    ) => placeIn(this.group, obj, name, pos, yaw, tilt);

    // One identical seat per seat position, driven straight off the layout,
    // so every seat in the cabin is the same model facing the nose.
    for (const seat of SEATS) {
      place(
        library.instance("economy-seat"),
        `seat-${seat.id}`,
        [seat.pos[0], 0, seat.pos[2]],
        0,
      );
    }

    // Doors and hatches lie flat against the tilted sidewall, which is solid
    // behind them, so no daylight can leak around their edges.
    for (const exit of EXITS) {
      const dir = exit.side === "port" ? -1 : 1;
      const isDoor = exit.type === "door";
      const key = isDoor ? "cabin-door" : "emergency-exit-door";
      // Doors stand on the floor; hatches are centered at window height.
      const anchorY = isDoor ? 0 : HATCH_Y;
      const surfaceY = isDoor ? 0.6 : HATCH_Y;
      place(
        library.instance(key),
        exit.id,
        [dir * (wallSurfaceX(surfaceY) - 0.02), anchorY, exit.z],
        -dir * (Math.PI / 2),
        dir * PANEL_TILT,
      );
    }

    // Service unit above each row: vents, reading lights, call buttons and
    // the seatbelt sign, hung from the bin underside. The port side has the
    // two-seat panel, starboard the three-seat panel.
    const psuX = (BIN.cavityFrontX + BIN.outerX) / 2;
    // The panel is face-anchored, so this puts the face flush with the bin
    // underside and the housing tucked up inside it.
    const psuY = BIN.bottomY - 0.005;
    for (let row = 1; row <= ROW_COUNT; row++) {
      const z = rowZ(row);
      // Yawed so the panel's top edge points forward, keeping the seatbelt
      // and no-smoking icons upright as a seated passenger looks up.
      place(library.instance("psu-panel-double"), `psu-${row}-port`, [-psuX, psuY, z], Math.PI);
      place(library.instance("psu-panel-triple"), `psu-${row}-stbd`, [psuX, psuY, z], Math.PI);
    }

    // Bags stowed in the open overhead bays, sitting on the cavity floor.
    const bagKeys = ["carry-on-suitcase", "duffel-bag", "backpack"] as const;
    OPEN_BINS.forEach((bin, i) => {
      const [x, y, z] = binCavityAnchor(bin.side, bin.row);
      const slots = [-0.19, 0.19];
      slots.forEach((offset, j) => {
        const key = bagKeys[(i + j) % bagKeys.length];
        place(
          library.instance(key),
          `bag-${bin.side}-${bin.row}-${j}`,
          [x, y + 0.01, z + offset],
          0,
        );
      });
    });

    place(library.instance("galley-unit"), "galley", GALLEY.pos, GALLEY.yaw);

    place(
      library.instance("galley-unit"),
      "aft-galley",
      AFT_GALLEY.pos,
      AFT_GALLEY.yaw,
    );

    // Lavatory fixtures: toilet and vanity side by side along the aft wall,
    // both facing the door, with clear standing room in between.
    const lav = LAVATORY;
    placeIn(
      this.lavatoryGroup,
      library.instance("lav-toilet"),
      "lav-toilet",
      [1.02, 0, lav.backZ - 0.48],
      Math.PI,
    );
    // Basin on the forward wall, directly opposite the toilet.
    placeIn(
      this.lavatoryGroup,
      library.instance("lav-vanity"),
      "lav-vanity",
      [0.8, 0, lav.frontZ + 0.3],
      0,
    );
    // Door hangs on the inboard wall facing the aisle, just inside the
    // opening. Stray geometry is trimmed at load, so the model's own center
    // is the panel and no housing juts into the room.
    placeIn(
      this.lavatoryGroup,
      library.instance("lav-door"),
      "lav-door",
      [lav.minX + lav.doorInset, 0, (lav.doorMinZ + lav.doorMaxZ) / 2],
      -Math.PI / 2,
    );
  }
}
