import type {
  CabinDims,
  ExitDef,
  LocationId,
  Pose,
  SeatDef,
  Side,
  WindowDef,
} from "./layout-types";

// World basis: meters, Y up, nose toward -Z side of the cabin (z=0 is the
// cockpit bulkhead), z grows aft. Port = -X, starboard = +X. Yaw 0 looks
// toward the nose (-Z).
//
// Narrow-body airliner, 2-3 economy layout: seats A/B port of the (offset)
// aisle, C/D/E starboard.

export const DIMS: CabinDims = {
  length: 20.2,
  width: 3.3,
  height: 2.2,
  wallThickness: 0.06,
};

export const HALF_W = DIMS.width / 2; // 1.65

/** The 2-3 layout puts the aisle slightly port of the centerline. */
export const AISLE_X = -0.12;

/**
 * Sidewall cross-section, shared by the shell, doors, hatches, and placards:
 * the skirt flares out from the floor edge, then the window panel tilts back
 * inward toward the overhead bins.
 */
export const WALL = {
  skirtBottomX: 1.5,
  skirtTopX: 1.62,
  skirtTopY: 0.55,
  panelTopX: 1.42,
  panelTopY: 1.8,
};

/** Inward lean of the window panel, radians. */
export const PANEL_TILT = Math.atan(
  (WALL.skirtTopX - WALL.panelTopX) / (WALL.panelTopY - WALL.skirtTopY),
);

/** World height -> distance along the tilted panel from its base. */
export function panelV(worldY: number) {
  return (worldY - WALL.skirtTopY) / Math.cos(PANEL_TILT);
}

/** Half-width of the cabin at a given height, on the panel surface. */
export function wallSurfaceX(worldY: number) {
  return WALL.skirtTopX - Math.sin(PANEL_TILT) * panelV(worldY);
}

/**
 * The cabin closes over on a circular crown rather than a flat lid. The arch
 * springs off the top of the upper sidewalls; that spring line sits high
 * enough to clear both the overhead bins and the lavatory roof, which the
 * arch would otherwise cut straight through.
 */
export const CROWN = {
  springX: WALL.panelTopX,
  springY: 2.1,
  peakY: 2.32,
};

/** Circle through (springX, springY) and (0, peakY), centered on x = 0. */
export const CROWN_CENTER_Y =
  (CROWN.peakY ** 2 - CROWN.springY ** 2 - CROWN.springX ** 2) /
  (2 * (CROWN.peakY - CROWN.springY));
export const CROWN_RADIUS = CROWN.peakY - CROWN_CENTER_Y;

/** Ceiling height at a given half-width, on the crown circle. */
export function crownYAt(x: number) {
  const dx = Math.min(Math.abs(x), CROWN_RADIUS);
  return CROWN_CENTER_Y + Math.sqrt(CROWN_RADIUS ** 2 - dx ** 2);
}

/** Point on the crown circle pushed out by `offset`, i.e. its outer face. */
export function crownOffset(x: number, offset: number): [number, number] {
  const scale = (CROWN_RADIUS + offset) / CROWN_RADIUS;
  return [x * scale, CROWN_CENTER_Y + (crownYAt(x) - CROWN_CENTER_Y) * scale];
}

/**
 * Interior half-width of the fuselage at a given height, walking the whole
 * cross-section: flared skirt, tilted window panel, short vertical upper
 * sidewall, then the crown. Lets anything that must stay inside the cabin —
 * the orbit camera, for one — ask how much room it has at its own height.
 */
export function cabinHalfWidthAt(y: number) {
  if (y <= WALL.skirtTopY) {
    const k = Math.max(y, 0) / WALL.skirtTopY;
    return WALL.skirtBottomX + (WALL.skirtTopX - WALL.skirtBottomX) * k;
  }
  if (y <= WALL.panelTopY) return wallSurfaceX(y);
  if (y <= CROWN.springY) return WALL.panelTopX;
  const dy = y - CROWN_CENTER_Y;
  return Math.sqrt(Math.max(CROWN_RADIUS ** 2 - dy ** 2, 0));
}

export const SEATED_EYE = 1.05;
export const STANDING_EYE = 1.6;
export const WALK_RADIUS = 0.22;
export const WALK_SPEED = 1.6;

/** Per-seat footprint (pick proxies / collision tiles inside a bench). */
export const SEAT_FOOT = { w: 0.47, h: 1.1, d: 0.7 };

export const ROW_COUNT = 20;
// Rows sit slightly forward of the old position to free real depth for the
// aft lavatory and its vestibule.
const ROW_Z0 = 2.0;
export const ROW_PITCH = 0.8;

/** Seat x centers: A/B port double, C/D/E starboard triple. */
const SEAT_X: Record<string, number> = {
  A: -1.13,
  B: -0.66,
  C: 0.42,
  D: 0.89,
  E: 1.36,
};

export const PORT_BENCH_X = (SEAT_X.A + SEAT_X.B) / 2; // -0.895
export const STARBOARD_BENCH_X = (SEAT_X.C + SEAT_X.E) / 2; // 0.89

export function rowZ(row: number) {
  return ROW_Z0 + (row - 1) * ROW_PITCH;
}

export const SEATS: SeatDef[] = Array.from(
  { length: ROW_COUNT },
  (_, i): SeatDef[] => {
    const row = i + 1;
    return (["A", "B", "C", "D", "E"] as const).map(
      (letter): SeatDef => ({
        id: `${row}${letter}`,
        kind: "passenger",
        side: letter === "A" || letter === "B" ? "port" : "starboard",
        row,
        pos: [SEAT_X[letter], 0, rowZ(row)],
        facing: "fwd",
      }),
    );
  },
).flat();

export const EXITS: ExitDef[] = [
  { id: "EXIT-MAIN", type: "door", side: "port", z: 0.95 },
  { id: "EXIT-OW-L1", type: "overwing", side: "port", z: rowZ(8) },
  { id: "EXIT-OW-L2", type: "overwing", side: "port", z: rowZ(9) },
  { id: "EXIT-OW-R1", type: "overwing", side: "starboard", z: rowZ(8) },
  { id: "EXIT-OW-R2", type: "overwing", side: "starboard", z: rowZ(9) },
  // Aft service door sits between the last row and the lavatory bulkhead.
  { id: "EXIT-REAR", type: "door", side: "port", z: 18.15 },
];

/**
 * Overhead bin cross-section, shared by the bin geometry and by whatever
 * stows luggage inside it. One bay per seat row.
 */
export const BIN = {
  innerTopX: 0.54,
  innerTopY: 2.14,
  outerX: 1.46,
  topY: 2.18,
  bottomY: 1.62,
  cavityCeilY: 2.1,
  cavityBackX: 1.42,
  cavityFloorY: 1.74,
  cavityFrontX: 0.6,
  /** Seam between adjacent bay doors. */
  bayGap: 0.035,
  /**
   * How far an open door swings up, radians. Tuned so the panel lies just
   * under the cavity ceiling, clearing the bags stowed below it.
   */
  openAngle: 1.3,
};

/** Bins span the seating zone only; the vestibules stay clear. */
export const BIN_Z0 = ROW_Z0 - ROW_PITCH / 2;
export const BIN_Z1 = ROW_Z0 + (ROW_COUNT - 0.5) * ROW_PITCH;

/** Bays left open with luggage visible inside. */
export const OPEN_BINS: Array<{ side: Side; row: number }> = [
  { side: "port", row: 4 },
  { side: "starboard", row: 7 },
  { side: "port", row: 11 },
  { side: "starboard", row: 14 },
  { side: "port", row: 17 },
  { side: "starboard", row: 19 },
];

export function isBinOpen(side: Side, row: number) {
  return OPEN_BINS.some((b) => b.side === side && b.row === row);
}

/** Floor center of a bin cavity, where stowed bags rest. */
export function binCavityAnchor(side: Side, row: number): [number, number, number] {
  const dir = side === "port" ? -1 : 1;
  return [
    dir * ((BIN.cavityFrontX + BIN.cavityBackX) / 2),
    BIN.cavityFloorY,
    rowZ(row),
  ];
}

/**
 * Enclosed lavatory module in the aft starboard corner: a square-cornered box
 * with its own outboard wall rather than a wedge following the fuselage, so
 * the interior reads as a rectangular room. A window aperture in that wall
 * looks through to the fuselage window beside it. The door is on the inboard
 * face, opening into the aft vestibule.
 */
export const LAVATORY = {
  id: "LAV" as LocationId,
  // Inboard wall sits clear of the aisle runner so neither the wall nor the
  // door ever encroaches on the walkway.
  minX: 0.18,
  /**
   * Outboard wall stands inboard of the sidewall panel, which leans in to
   * x = 1.40 by the time it reaches the lavatory ceiling. Keeping clear of
   * that lets the wall run straight from floor to ceiling.
   */
  maxX: 1.38,
  frontZ: 18.45,
  backZ: 20.15,
  ceilingY: 2.05,
  wall: 0.05,
  /**
   * Doorway on the inboard wall, so the door faces the aisle broadside and
   * you turn into it rather than walking head-on at it.
   */
  doorMinZ: 18.62,
  doorMaxZ: 19.44,
  /** Door panel center, measured inboard from the wall it hangs on. */
  doorInset: 0.06,
  /** Window aperture in the outboard wall, aligned with the fuselage window. */
  windowZ: 19.3,
  windowY: 1.12,
  windowHalfW: 0.2,
  windowHalfH: 0.24,
  /** Standing aft of the basin, facing it and the mirror above it. */
  standPoint: [0.52, 0, 19.7] as [number, number, number],
  lookYaw: -0.28,
  lookPitch: -0.3,
};

/** Aft galley filling the rear port corner beside the lavatory. */
export const AFT_GALLEY = {
  pos: [-0.95, 0, 19.75] as [number, number, number],
  yaw: Math.PI,
  aabb: { minX: -HALF_W, maxX: -0.25, minZ: 19.3, maxZ: DIMS.length },
};

export const GALLEY = {
  /** Galley cabinet against the starboard wall at the front. */
  pos: [1.0, 0, 1.05] as [number, number, number],
  yaw: -Math.PI / 2, // front faces the aisle (-X)
  aabb: { minX: 0.35, maxX: HALF_W, minZ: 0.5, maxZ: 1.62 },
};

/**
 * Corridor running forward out of the cabin, through the bulkhead at z = 0 to
 * the flight deck door at its far end. Narrower and lower than the cabin, the
 * way the space between the forward galley and the closet is on a real
 * narrow-body, so the walk forward reads as leaving the cabin.
 */
export const CORRIDOR = {
  /** Forward end, where the cockpit door hangs. Aft end is the bulkhead. */
  frontZ: -2.0,
  backZ: 0,
  halfWidth: 0.47,
  ceilingY: 2.08,
  wall: 0.05,
  /** Opening cut through the cabin bulkhead. */
  archWidth: 0.94,
  archHeight: 2.04,
  /** Cockpit door leaf. */
  doorWidth: 0.76,
  doorHeight: 1.96,
};

/** Center of the corridor floor, on the aisle. */
export const CORRIDOR_X = AISLE_X;

/** Wing center (outside the fuselage), aligned with the overwing exits. */
export const WING_Z = (rowZ(8) + rowZ(9)) / 2;

/**
 * Wing planform, to narrow-body proportions: a ~35 m span on a 3.3 m fuselage,
 * swept back with a trailing-edge kink where the inboard flaps end. Chordwise
 * figures are relative to WING_Z; x is measured out from the centerline.
 */
export const WING = {
  rootX: 1.5,
  kinkX: 5.6,
  tipX: 17.2,
  /** Chord line height at the root; the rest follows the dihedral. */
  rootY: -0.35,
  dihedral: (5 * Math.PI) / 180,
  rootLE: -2.6,
  rootTE: 3.4,
  kinkLE: -0.8,
  kinkTE: 3.6,
  tipLE: 4.3,
  tipTE: 5.65,
  /** Sharklet height above the tip chord line. */
  sharklet: 1.55,
};

/** Chord line height at a spanwise station, following the dihedral. */
export function wingChordY(x: number) {
  return WING.rootY + Math.max(x - WING.rootX, 0) * Math.tan(WING.dihedral);
}

/**
 * Engine, mirrored per side. Slung ahead of and below the leading edge at
 * roughly a third of the semi-span, which is where a real one hangs.
 */
export const ENGINE = {
  x: 5.6,
  y: -1.72,
  /** Inlet plane; the nacelle runs aft from here. */
  frontZ: WING_Z - 2.8,
  length: 3.6,
  radius: 1.12,
};

/** Nacelle center, i.e. what a passenger looking at the engine aims for. */
export const ENGINE_Z = ENGINE.frontZ + ENGINE.length / 2;

const EXIT_ROW_Z = new Set(EXITS.filter((e) => e.type === "overwing").map((e) => e.z));

/** Center height of the window in the overwing hatch, measured off the model. */
export const HATCH_WINDOW_Y = 1.28;

/** Center height of a cabin window. */
export const WINDOW_Y = 1.12;

export const WINDOWS: WindowDef[] = [
  ...(["port", "starboard"] as const).flatMap((side) =>
    Array.from({ length: ROW_COUNT }, (_, i) => rowZ(i + 1))
      .filter((z) => !EXIT_ROW_Z.has(z))
      .map((z): WindowDef => ({ side, z, y: WINDOW_Y, rx: 0.13, ry: 0.18 })),
  ),
  // The overwing hatches carry a window of their own, but the shell behind
  // them is solid at the exit rows, so looking through one used to land on
  // sidewall. These apertures sit behind the hatch glass, cut slightly wider
  // than it so the hatch frames them rather than the other way round.
  ...EXITS.filter((e) => e.type === "overwing").map(
    (e): WindowDef => ({ side: e.side, z: e.z, y: HATCH_WINDOW_Y, rx: 0.11, ry: 0.13 }),
  ),
  // Lavatory window (rear door occupies the port side there), seen through
  // the aperture in the lavatory's own outboard wall.
  { side: "starboard", z: LAVATORY.windowZ, y: LAVATORY.windowY, rx: 0.13, ry: 0.18 },
];

export function seatById(id: LocationId): SeatDef | undefined {
  return SEATS.find((s) => s.id === id);
}

export function isSeatId(id: LocationId): boolean {
  return seatById(id) !== undefined;
}

/**
 * Window seats abreast of the engine open looking at it. The engine hangs
 * well below the window line, and from the middle of a seat the sill cuts the
 * sight line off, so these poses also lean the head over to the glass — which
 * is what anyone actually does to look at the wing.
 */
function engineViewPose(seat: SeatDef): Pose | null {
  const [sx, , sz] = seat.pos;
  const isWindow = Math.abs(sx) > 1.0;
  if (!isWindow) return null;
  // The hatch window sits above eye level, so the exit rows cannot see down
  // to the engine however far you lean.
  if (EXIT_ROW_Z.has(sz)) return null;
  // Only rows ahead of the leading edge have a line on it. From the wing
  // itself and aft, the wing is between the window and the engine under it,
  // which is exactly how it looks from a real cabin.
  if (sz < ENGINE.frontZ - 2.2 || sz > ENGINE.frontZ + 1) return null;

  // Sitting upright, the sill cuts the sightline off about a centimeter short
  // of the engine, so the pose leans up to the glass as well as across to it.
  // Aimed at the nacelle crown rather than its center: the engine hangs low
  // enough that a line to its middle leaves through the bottom of the window
  // reveal, and the crown puts the whole engine in the lower half of frame.
  const dir = Math.sign(sx);
  const eyeX = dir * (wallSurfaceX(WINDOW_Y) - 0.09);
  const to = {
    x: dir * ENGINE.x - eyeX,
    y: ENGINE.y + ENGINE.radius - WINDOW_Y,
    z: ENGINE.frontZ + 0.9 - sz,
  };
  return {
    position: [eyeX, WINDOW_Y, sz],
    yaw: Math.atan2(-to.x, -to.z),
    pitch: Math.atan2(to.y, Math.hypot(to.x, to.z)),
  };
}

/** First-person pose when seated in a seat or standing in the lavatory. */
export function locationPose(id: LocationId): Pose | null {
  if (id === LAVATORY.id) {
    const [x, , z] = LAVATORY.standPoint;
    return {
      position: [x, STANDING_EYE, z],
      yaw: LAVATORY.lookYaw,
      pitch: LAVATORY.lookPitch,
    };
  }
  const seat = seatById(id);
  if (!seat) return null;
  const engineView = engineViewPose(seat);
  if (engineView) return engineView;
  const [x, , z] = seat.pos;
  return {
    position: [x, SEATED_EYE, z],
    yaw: seat.facing === "fwd" ? 0 : Math.PI,
    pitch: 0,
  };
}

/** Aisle point next to a seat, used when standing up into walk mode. */
export function standPose(id: LocationId): Pose {
  const seat = seatById(id);
  if (!seat) {
    const [x, , z] = LAVATORY.standPoint;
    return { position: [x, STANDING_EYE, z], yaw: 0, pitch: 0 };
  }
  return {
    position: [AISLE_X, STANDING_EYE, seat.pos[2]],
    yaw: seat.facing === "fwd" ? 0 : Math.PI,
    pitch: 0,
  };
}

/** Shared 2D projection so the SVG map and the 3D world cannot drift. */
export function toMap(x: number, z: number, scale: number, pad: number) {
  return { mx: pad + (x + HALF_W) * scale, my: pad + z * scale };
}
