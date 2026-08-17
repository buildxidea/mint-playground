import {
  AFT_GALLEY,
  CORRIDOR,
  CORRIDOR_X,
  DIMS,
  GALLEY,
  HALF_W,
  LAVATORY,
  SEAT_FOOT,
  SEATS,
  WALK_RADIUS,
} from "../data/cabin-layout";

interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Static XZ collision volumes derived from the layout data. */
export class Colliders {
  private boxes: Aabb[] = [];

  constructor() {
    // Per-seat tiles; adjacent seats merge into bench-shaped obstacles.
    for (const seat of SEATS) {
      const [x, , z] = seat.pos;
      this.boxes.push({
        minX: x - SEAT_FOOT.w / 2,
        maxX: x + SEAT_FOOT.w / 2,
        minZ: z - SEAT_FOOT.d / 2 + 0.04,
        maxZ: z + SEAT_FOOT.d / 2 - 0.04,
      });
    }
    // Galley cabinet.
    this.boxes.push({ ...GALLEY.aabb });

    // Cockpit corridor: the bulkhead is solid either side of its archway, and
    // the corridor's own walls channel you forward to the flight deck door.
    const archX0 = CORRIDOR_X - CORRIDOR.archWidth / 2;
    const archX1 = CORRIDOR_X + CORRIDOR.archWidth / 2;
    this.boxes.push(
      { minX: -HALF_W, maxX: archX0, minZ: -0.1, maxZ: 0.02 },
      { minX: archX1, maxX: HALF_W, minZ: -0.1, maxZ: 0.02 },
      {
        minX: CORRIDOR_X - CORRIDOR.halfWidth - CORRIDOR.wall,
        maxX: CORRIDOR_X - CORRIDOR.halfWidth,
        minZ: CORRIDOR.frontZ,
        maxZ: CORRIDOR.backZ,
      },
      {
        minX: CORRIDOR_X + CORRIDOR.halfWidth,
        maxX: CORRIDOR_X + CORRIDOR.halfWidth + CORRIDOR.wall,
        minZ: CORRIDOR.frontZ,
        maxZ: CORRIDOR.backZ,
      },
      // The flight deck door stays shut.
      {
        minX: CORRIDOR_X - CORRIDOR.halfWidth,
        maxX: CORRIDOR_X + CORRIDOR.halfWidth,
        minZ: CORRIDOR.frontZ - CORRIDOR.wall,
        maxZ: CORRIDOR.frontZ + CORRIDOR.wall,
      },
    );

    // Aft galley in the rear port corner.
    this.boxes.push({ ...AFT_GALLEY.aabb });

    // Lavatory module: inboard wall split around the doorway, plus the
    // forward, aft, and outboard walls. The doorway itself stays walkable.
    const lav = LAVATORY;
    this.boxes.push(
      // Inboard wall, split around the doorway.
      { minX: lav.minX - lav.wall, maxX: lav.minX + lav.wall, minZ: lav.frontZ, maxZ: lav.doorMinZ },
      { minX: lav.minX - lav.wall, maxX: lav.minX + lav.wall, minZ: lav.doorMaxZ, maxZ: lav.backZ },
      { minX: lav.minX, maxX: HALF_W, minZ: lav.backZ - lav.wall, maxZ: lav.backZ + lav.wall },
      { minX: lav.minX, maxX: HALF_W, minZ: lav.frontZ - lav.wall, maxZ: lav.frontZ + lav.wall },
      { minX: lav.maxX - lav.wall, maxX: HALF_W, minZ: lav.frontZ, maxZ: lav.backZ },
      // Toilet on the aft wall, basin facing it from the forward wall. Both
      // volumes are trimmed back from the models so the floor between them
      // stays wide enough to walk through.
      { minX: 0.76, maxX: 1.3, minZ: lav.backZ - 0.62, maxZ: lav.backZ - lav.wall },
      { minX: 0.45, maxX: 1.16, minZ: lav.frontZ + lav.wall, maxZ: lav.frontZ + 0.5 },
    );
  }

  /**
   * Per-axis circle-vs-AABB resolution: move on one axis at a time and clamp
   * out of any box we penetrate, which yields natural wall sliding.
   */
  moveCircle(x: number, z: number, dx: number, dz: number): { x: number; z: number } {
    const r = WALK_RADIUS;
    // Lower sidewall panels sit at ~|x| = 1.5 near the floor.
    const wallX = HALF_W - 0.15 - r;
    let nx = x + dx;
    for (const b of this.boxes) {
      if (nx > b.minX - r && nx < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) {
        nx = dx > 0 ? b.minX - r : b.maxX + r;
      }
    }
    nx = Math.min(wallX, Math.max(-wallX, nx));
    let nz = z + dz;
    for (const b of this.boxes) {
      if (nx > b.minX - r && nx < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) {
        nz = dz > 0 ? b.minZ - r : b.maxZ + r;
      }
    }
    // Forward limit reaches into the corridor now; the bulkhead and corridor
    // walls above are what keep you out of it anywhere but the archway.
    nz = Math.min(
      DIMS.length - r - 0.1,
      Math.max(CORRIDOR.frontZ + CORRIDOR.wall + r, nz),
    );
    return { x: nx, z: nz };
  }
}
