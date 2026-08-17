import {
  AFT_GALLEY,
  AISLE_X,
  CORRIDOR,
  DIMS,
  EXITS,
  GALLEY,
  LAVATORY,
  ROW_COUNT,
  rowZ,
  SEATS,
} from "./cabin-layout";
import type { Vec3 } from "./layout-types";

export type TargetKind = "cabin" | "section" | "seat" | "room" | "exit";

/**
 * Something the overview camera can frame and orbit. `focus` is the point it
 * turns around; `pick` is the half-extent box a click has to land in.
 */
export interface InspectTarget {
  id: string;
  label: string;
  kind: TargetKind;
  focus: Vec3;
  /** Resting orbit radius, and the range the wheel may pull it through. */
  distance: number;
  minDistance: number;
  maxDistance: number;
  /** Half-extents of the pick proxy, centered on `pickCenter ?? focus`. */
  pick: Vec3;
  pickCenter?: Vec3;
  /**
   * Box the camera is confined to instead of the cabin at large. Enclosed
   * targets need it: orbiting the lavatory from cabin distance would only
   * ever show you the outside of its walls.
   */
  cameraBox?: { min: Vec3; max: Vec3 };
}

/** Whole-cabin view: the state the overview opens on and Esc returns to. */
export const CABIN_TARGET: InspectTarget = {
  id: "CABIN",
  label: "Cabin",
  kind: "cabin",
  focus: [AISLE_X, 1.15, DIMS.length / 2],
  distance: 7.5,
  minDistance: 2,
  maxDistance: 13,
  pick: [0, 0, 0],
};

/** Forward, mid and aft thirds of the seating zone. */
const SECTION_ROWS: Array<[string, number, number]> = [
  ["Forward cabin", 1, 7],
  ["Mid cabin", 8, 14],
  ["Aft cabin", 15, ROW_COUNT],
];

const sections: InspectTarget[] = SECTION_ROWS.map(([label, first, last]) => {
  const z0 = rowZ(first) - 0.4;
  const z1 = rowZ(last) + 0.4;
  const mid = (z0 + z1) / 2;
  return {
    id: `SECTION-${first}`,
    label,
    kind: "section",
    focus: [AISLE_X, 1.1, mid],
    distance: 6,
    minDistance: 2,
    maxDistance: 11,
    pick: [DIMS.width / 2, 1.1, (z1 - z0) / 2],
    pickCenter: [0, 1.1, mid],
  };
});

const seats: InspectTarget[] = SEATS.map((seat) => ({
  id: seat.id,
  label: `Seat ${seat.id}`,
  kind: "seat",
  focus: [seat.pos[0], 0.8, seat.pos[2]],
  distance: 1.5,
  minDistance: 0.7,
  maxDistance: 4.5,
  pick: [0.235, 0.55, 0.35],
  pickCenter: [seat.pos[0], 0.55, seat.pos[2]],
}));

const rooms: InspectTarget[] = [
  {
    id: LAVATORY.id,
    label: "Lavatory",
    kind: "room",
    focus: [
      (LAVATORY.minX + LAVATORY.maxX) / 2,
      1.15,
      (LAVATORY.frontZ + LAVATORY.backZ) / 2,
    ],
    distance: 1.1,
    minDistance: 0.55,
    maxDistance: 1.7,
    pick: [
      (LAVATORY.maxX - LAVATORY.minX) / 2,
      LAVATORY.ceilingY / 2,
      (LAVATORY.backZ - LAVATORY.frontZ) / 2,
    ],
    pickCenter: [
      (LAVATORY.minX + LAVATORY.maxX) / 2,
      LAVATORY.ceilingY / 2,
      (LAVATORY.frontZ + LAVATORY.backZ) / 2,
    ],
    cameraBox: {
      min: [LAVATORY.minX + 0.3, 0.6, LAVATORY.frontZ + 0.3],
      max: [LAVATORY.maxX - 0.3, 1.85, LAVATORY.backZ - 0.3],
    },
  },
  {
    id: "COCKPIT-DOOR",
    label: "Flight deck door",
    kind: "room",
    focus: [AISLE_X, 1.15, CORRIDOR.frontZ + 0.8],
    distance: 1.4,
    minDistance: 0.7,
    maxDistance: 2.3,
    pick: [CORRIDOR.doorWidth / 2, CORRIDOR.doorHeight / 2, 0.06],
    pickCenter: [AISLE_X, CORRIDOR.doorHeight / 2, CORRIDOR.frontZ + 0.06],
    // Confined to the corridor, which is the only place it can be seen from.
    cameraBox: {
      min: [AISLE_X - 0.28, 0.7, CORRIDOR.frontZ + 0.4],
      max: [AISLE_X + 0.28, 1.85, CORRIDOR.backZ - 0.15],
    },
  },
  {
    id: "GALLEY-FWD",
    label: "Forward galley",
    kind: "room",
    focus: [GALLEY.pos[0], 1, GALLEY.pos[2]],
    distance: 2,
    minDistance: 0.9,
    maxDistance: 5,
    pick: [0.65, 0.8, 0.4],
    pickCenter: [GALLEY.pos[0], 0.8, GALLEY.pos[2]],
  },
  {
    id: "GALLEY-AFT",
    label: "Aft galley",
    kind: "room",
    focus: [AFT_GALLEY.pos[0], 1, AFT_GALLEY.pos[2] - 0.15],
    distance: 2,
    minDistance: 0.9,
    maxDistance: 5,
    pick: [0.65, 0.8, 0.4],
    pickCenter: [AFT_GALLEY.pos[0], 0.8, AFT_GALLEY.pos[2]],
  },
];

const EXIT_LABEL: Record<string, string> = {
  "EXIT-MAIN": "Forward door",
  "EXIT-REAR": "Aft service door",
};

const exits: InspectTarget[] = EXITS.map((exit) => {
  const dir = exit.side === "port" ? -1 : 1;
  const door = exit.type === "door";
  const label =
    EXIT_LABEL[exit.id] ?? `Overwing exit ${exit.side === "port" ? "L" : "R"}`;
  return {
    id: exit.id,
    label,
    kind: "exit",
    focus: [dir * 1.05, door ? 1.05 : 1.12, exit.z],
    distance: door ? 2.4 : 2,
    minDistance: 0.9,
    maxDistance: 5,
    pick: door ? [0.2, 0.95, 0.6] : [0.16, 0.55, 0.42],
    pickCenter: [dir * 1.45, door ? 1 : 1.12, exit.z],
  };
});

/**
 * Everything clickable. Sections are kept apart because they blanket the seats
 * they contain: a click resolves against the specific targets first and only
 * falls back to a section when it misses all of them.
 */
export const SPECIFIC_TARGETS: InspectTarget[] = [...seats, ...rooms, ...exits];
export const SECTION_TARGETS: InspectTarget[] = sections;

const BY_ID = new Map<string, InspectTarget>(
  [CABIN_TARGET, ...SPECIFIC_TARGETS, ...SECTION_TARGETS].map((t) => [t.id, t]),
);

export function inspectTarget(id: string): InspectTarget | undefined {
  return BY_ID.get(id);
}
