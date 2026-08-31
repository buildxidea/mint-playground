import type { ParkedVehicleId } from './GenericParkedCars';

export type ObstacleKind = 'cone' | 'barrier' | 'bollard' | 'booth' | 'curb';

export type ObstacleDef = {
  kind: ObstacleKind;
  x: number;
  z: number;
  yaw?: number;
};

export type BayDef = {
  x: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
};

export type ParkedCarDef = {
  vehicle: ParkedVehicleId;
  tint: string;
};

export type ParkingSpaceDef = BayDef & {
  target?: boolean;
  occupied?: ParkedCarDef;
};

export type RoadMarkDef = {
  kind: 'arrow' | 'crosswalk' | 'stop-line';
  x: number;
  z: number;
  yaw: number;
};

export type DriveRoutePoint = {
  x: number;
  z: number;
  /** Desired car yaw at this point; omitted for ordinary path following. */
  yaw?: number;
  /** Reach this point while reversing. */
  reverse?: boolean;
  /** Optional deterministic-QA arrival tolerances for precision maneuvers. */
  positionTolerance?: number;
  yawTolerance?: number;
};

export type ChallengeDef = {
  id: number;
  name: string;
  blurb: string;
  parTime: number;
  spawn: { x: number; z: number; yaw: number };
  bay: BayDef;
  obstacles: ObstacleDef[];
  parkingSpaces: ParkingSpaceDef[];
  roadMarks: RoadMarkDef[];
  /** Authored, collision-checked route used by deterministic full-level QA. */
  driveRoute: DriveRoutePoint[];
};

const SPACE_W = 2.8;
const SPACE_L = 5.8;
const PARALLEL_L = 6.8;

const PAINT = {
  red: '#d95d55',
  blue: '#4d78aa',
  teal: '#3d8f87',
  gold: '#c89f4a',
  cream: '#d8d0b5',
  plum: '#7d5a78',
  green: '#5f875d',
  slate: '#687583',
} as const;

function space(
  x: number,
  z: number,
  yaw: number,
  occupied?: ParkedCarDef,
  length = SPACE_L,
): ParkingSpaceDef {
  return { x, z, yaw, width: SPACE_W, length, occupied };
}

function target(bay: BayDef): ParkingSpaceDef {
  return { ...bay, target: true };
}

function parked(vehicle: ParkedVehicleId, tint: string): ParkedCarDef {
  return { vehicle, tint };
}

/** Shared lot footprint is 26 x 20 meters, origin at center. */
export const CHALLENGES: ChallengeDef[] = [
  {
    id: 1,
    name: 'Offset Entry',
    blurb: 'Clear the offset gate, turn down the aisle, and square up for the bay.',
    parTime: 36,
    spawn: { x: -9.2, z: 1.1, yaw: Math.PI / 2 },
    bay: { x: 0, z: -6.1, yaw: 0, width: 3.1, length: 6.1 },
    parkingSpaces: [
      space(-8.85, -6.1, 0, parked('generic-hatchback', PAINT.blue)),
      space(-5.9, -6.1, 0, parked('sports', PAINT.gold)),
      space(-2.95, -6.1, 0),
      target({ x: 0, z: -6.1, yaw: 0, width: 3.1, length: 6.1 }),
      space(2.95, -6.1, 0),
      space(5.9, -6.1, 0, parked('generic-suv', PAINT.plum)),
      space(8.85, -6.1, 0, parked('compact', PAINT.red)),
      space(-9, 7.0, Math.PI, parked('generic-pickup', PAINT.slate), 5.4),
      space(-6, 7.0, Math.PI, parked('generic-sedan', PAINT.red), 5.4),
      space(-3, 7.0, Math.PI, parked('generic-hatchback', PAINT.gold), 5.4),
      space(3, 7.0, Math.PI, parked('generic-suv', PAINT.blue), 5.4),
      space(6, 7.0, Math.PI, parked('generic-sedan', PAINT.green), 5.4),
      space(9, 7.0, Math.PI, parked('generic-pickup', PAINT.cream), 5.4),
    ],
    obstacles: [
      { kind: 'bollard', x: -3.6, z: 3.0 },
      { kind: 'bollard', x: -3.6, z: -0.8 },
      { kind: 'barrier', x: 2.4, z: 2.4, yaw: 0 },
      { kind: 'booth', x: 11.4, z: 6.7, yaw: Math.PI },
      { kind: 'bollard', x: 10.35, z: 5.05 },
      { kind: 'bollard', x: 12.0, z: 5.05 },
    ],
    roadMarks: [
      { kind: 'arrow', x: -6.2, z: 1.1, yaw: Math.PI / 2 },
      { kind: 'arrow', x: -0.6, z: -1.0, yaw: Math.PI * 0.85 },
      { kind: 'stop-line', x: 9.8, z: 3.7, yaw: Math.PI / 2 },
    ],
    driveRoute: [
      { x: -5.4, z: 1.1 },
      { x: -1.7, z: 0.8 },
      { x: 0.2, z: -2.4, yaw: Math.PI },
      { x: 0, z: -4.3, positionTolerance: 0.9 },
      { x: 0, z: -6.1, yaw: Math.PI },
    ],
  },
  {
    id: 2,
    name: 'Angle Slot',
    blurb: 'Trace the S-bend, clear both barriers, and settle into the angled opening.',
    parTime: 45,
    spawn: { x: -8.8, z: -0.2, yaw: Math.PI / 2 },
    bay: { x: 2.5, z: -4.2, yaw: -Math.PI / 4.2, width: 3.2, length: SPACE_L },
    parkingSpaces: [
      space(-0.03, -6.55, -Math.PI / 4.2, parked('sports', PAINT.red)),
      target({
        x: 2.5,
        z: -4.2,
        yaw: -Math.PI / 4.2,
        width: 3.2,
        length: SPACE_L,
      }),
      space(5.03, -1.85, -Math.PI / 4.2),
      space(0, 7.0, Math.PI, parked('generic-sedan', PAINT.blue), 5.4),
      space(3.0, 6.95, Math.PI, parked('van', PAINT.slate), 5.4),
      space(6.0, 7.0, Math.PI, parked('generic-suv', PAINT.teal), 5.4),
      space(-9.0, 7.0, Math.PI, parked('generic-pickup', PAINT.cream), 5.4),
      space(-6.0, 7.0, Math.PI, parked('generic-hatchback', PAINT.plum), 5.4),
      space(9.0, 7.0, Math.PI, parked('generic-sedan', PAINT.green), 5.4),
    ],
    obstacles: [
      { kind: 'barrier', x: -3.5, z: -1.4, yaw: 0 },
      { kind: 'barrier', x: 1.2, z: 3.4, yaw: Math.PI / 2 },
      { kind: 'bollard', x: 4.9, z: 0.25 },
      { kind: 'bollard', x: 10.7, z: -1.5 },
      { kind: 'booth', x: 11.3, z: 6.5, yaw: Math.PI },
    ],
    roadMarks: [
      { kind: 'arrow', x: -6.4, z: 0.2, yaw: Math.PI / 2 },
      { kind: 'arrow', x: -1.8, z: 2.0, yaw: Math.PI / 4 },
      { kind: 'arrow', x: 3.4, z: 0.8, yaw: Math.PI * 0.75 },
    ],
    driveRoute: [
      { x: -5.8, z: 0.15 },
      { x: -2.4, z: 2.2 },
      { x: 2.8, z: 1.6 },
      { x: 0.0, z: -0.2 },
      { x: 1.5, z: -2.5, positionTolerance: 0.6 },
      { x: 2.65, z: -4.36, yaw: Math.PI - Math.PI / 4.2 },
    ],
  },
  {
    id: 3,
    name: 'Back It In',
    blurb: 'Turn through the setup lane, square the car, then steer backward into the row.',
    parTime: 54,
    spawn: { x: -8.7, z: 1.4, yaw: Math.PI / 2 },
    bay: { x: 2.95, z: -6.1, yaw: 0, width: SPACE_W, length: SPACE_L },
    parkingSpaces: [
      space(-8.85, -6.1, 0, parked('van', PAINT.cream)),
      space(-5.9, -6.1, 0, parked('generic-hatchback', PAINT.green)),
      space(-2.95, -6.1, 0, parked('sports', PAINT.blue)),
      space(0, -6.1, 0),
      target({ x: 2.95, z: -6.1, yaw: 0, width: SPACE_W, length: SPACE_L }),
      space(5.9, -6.1, 0, parked('generic-sedan', PAINT.slate)),
      space(8.85, -6.1, 0, parked('generic-pickup', PAINT.gold)),
      space(-9.0, 7.0, Math.PI, parked('generic-suv', PAINT.red), 5.4),
      space(6.0, 7.0, Math.PI, parked('generic-hatchback', PAINT.teal), 5.4),
      space(9.0, 7.0, Math.PI, parked('generic-sedan', PAINT.cream), 5.4),
    ],
    obstacles: [
      { kind: 'barrier', x: -3.8, z: 4.3, yaw: Math.PI / 2 },
      { kind: 'barrier', x: -5.5, z: 6.5, yaw: Math.PI / 2 },
      { kind: 'barrier', x: 0, z: 6.5, yaw: Math.PI / 2 },
      { kind: 'booth', x: -11.3, z: -6.8, yaw: 0 },
    ],
    roadMarks: [
      { kind: 'arrow', x: -6.2, z: 1.4, yaw: Math.PI / 2 },
      { kind: 'arrow', x: -1.8, z: 0.4, yaw: Math.PI / 3 },
      { kind: 'arrow', x: 2.95, z: -1.8, yaw: 0 },
    ],
    driveRoute: [
      { x: -5.7, z: 1.4 },
      { x: -2.0, z: 0.25 },
      { x: 0.3, z: -1.5 },
      { x: 2.95, z: -1.0 },
      { x: 2.95, z: 0.9, yaw: 0, positionTolerance: 0.55 },
      { x: 2.95, z: -2.5, reverse: true, positionTolerance: 0.65 },
      { x: 2.95, z: -4.3, reverse: true, positionTolerance: 0.65 },
      { x: 2.95, z: -5.2, reverse: true, positionTolerance: 0.65 },
      { x: 2.95, z: -6.1, yaw: 0, reverse: true },
    ],
  },
  {
    id: 4,
    name: 'Parallel',
    blurb: 'Cross the lot, bend into the curb lane, then reverse into the long gap.',
    parTime: 68,
    spawn: { x: -7.5, z: 3.3, yaw: Math.PI / 2 },
    bay: { x: 0.8, z: -6.5, yaw: Math.PI / 2, width: SPACE_W, length: PARALLEL_L },
    parkingSpaces: [
      space(-5.7, -6.5, Math.PI / 2, parked('generic-sedan', PAINT.teal), 5.0),
      target({
        x: 0.8,
        z: -6.5,
        yaw: Math.PI / 2,
        width: SPACE_W,
        length: PARALLEL_L,
      }),
      space(10.6, -6.5, Math.PI / 2, parked('generic-hatchback', PAINT.red), 4.6),
      space(0.0, 7.0, Math.PI, parked('generic-suv', PAINT.cream), 5.4),
      space(3.0, 7.0, Math.PI, parked('compact', PAINT.blue), 5.4),
      space(6.0, 7.0, Math.PI, parked('generic-sedan', PAINT.gold), 5.4),
      space(-9.0, 7.0, Math.PI, parked('generic-pickup', PAINT.slate), 5.4),
      space(-6.0, 7.0, Math.PI, parked('generic-hatchback', PAINT.plum), 5.4),
      space(9.0, 7.0, Math.PI, parked('generic-suv', PAINT.green), 5.4),
    ],
    obstacles: [
      { kind: 'barrier', x: 2.2, z: 3.7, yaw: Math.PI / 2 },
      { kind: 'bollard', x: 1.6, z: -2.1 },
      { kind: 'bollard', x: 8.0, z: -2.1 },
      { kind: 'bollard', x: -11, z: -7.2 },
      { kind: 'booth', x: 11.3, z: 6.6, yaw: Math.PI },
    ],
    roadMarks: [
      { kind: 'arrow', x: -6.1, z: 3.3, yaw: Math.PI / 2 },
      { kind: 'arrow', x: 0.2, z: 0.0, yaw: Math.PI * 0.8 },
      { kind: 'arrow', x: 4.9, z: -3.7, yaw: Math.PI },
    ],
    driveRoute: [
      { x: -4.8, z: 3.3 },
      { x: -1.4, z: 0.0 },
      { x: 4.7, z: 0.0 },
      { x: 4.8, z: -3.0 },
      { x: 2.6, z: -4.2 },
      { x: 2.6, z: -6.5, positionTolerance: 0.75 },
      { x: 5.5, z: -6.5, yaw: Math.PI / 2, positionTolerance: 0.65 },
      { x: 3.5, z: -6.5, reverse: true, positionTolerance: 0.7 },
      { x: 1.8, z: -6.5, reverse: true, positionTolerance: 0.65 },
      { x: 0.8, z: -6.5, yaw: Math.PI / 2, reverse: true },
    ],
  },
  {
    id: 5,
    name: 'Booth Lot',
    blurb: 'Thread the staffed chicane, change line twice, and squeeze between parked cars.',
    parTime: 78,
    spawn: { x: -9.5, z: 5.5, yaw: Math.PI / 2 },
    bay: { x: 5.0, z: -5.4, yaw: Math.PI * 0.7, width: 2.85, length: 5.8 },
    parkingSpaces: [
      space(3.18, -7.65, Math.PI * 0.7, parked('compact', PAINT.red)),
      target({
        x: 5.0,
        z: -5.4,
        yaw: Math.PI * 0.7,
        width: 2.85,
        length: 5.8,
      }),
      space(6.82, -2.89, Math.PI * 0.7, parked('generic-sedan', PAINT.green)),
      space(3.0, 7.0, Math.PI, parked('generic-hatchback', PAINT.blue), 5.4),
      space(6.0, 7.0, Math.PI, parked('generic-sedan', PAINT.gold), 5.4),
      space(9.0, 6.95, Math.PI, parked('van', PAINT.cream), 5.4),
      space(-6.5, -5.8, 0, parked('generic-suv', PAINT.slate)),
      space(-9.5, -5.8, 0, parked('sports', PAINT.teal)),
    ],
    obstacles: [
      { kind: 'booth', x: 0, z: 3.7, yaw: Math.PI / 2 },
      { kind: 'bollard', x: -1.7, z: 3.7 },
      { kind: 'bollard', x: 1.7, z: 3.7 },
      { kind: 'barrier', x: -4.0, z: -2.6, yaw: Math.PI / 2 },
      { kind: 'barrier', x: 2.0, z: 1.7, yaw: 0 },
      { kind: 'bollard', x: -2.5, z: -0.9 },
      { kind: 'bollard', x: 0.9, z: -0.9 },
    ],
    roadMarks: [
      { kind: 'crosswalk', x: 0, z: 0.8, yaw: Math.PI / 2 },
      { kind: 'stop-line', x: -2.8, z: 3.7, yaw: 0 },
      { kind: 'arrow', x: -5.8, z: 4.8, yaw: Math.PI / 2 },
      { kind: 'arrow', x: 3.0, z: 0.0, yaw: Math.PI },
    ],
    driveRoute: [
      { x: -5.2, z: 5.2, yaw: Math.PI / 2 },
      { x: -4.5, z: 1.6 },
      { x: -1.0, z: 0.4 },
      { x: -0.6, z: -2.3 },
      { x: 2.6, z: -3.65, yaw: Math.PI * 0.7 },
      { x: 5.0, z: -5.4, yaw: Math.PI * 0.7 },
    ],
  },
  {
    id: 6,
    name: 'Precision Slalom',
    blurb: 'Thread five compressed gates, recover your line, and finish in the narrow end bay.',
    parTime: 88,
    spawn: { x: -9.6, z: 5.8, yaw: Math.PI / 2 },
    bay: { x: 7.4, z: -6.25, yaw: 0, width: 2.7, length: 5.7 },
    parkingSpaces: [
      space(-9.0, -6.2, 0, parked('generic-pickup', PAINT.slate)),
      space(-6.0, -6.2, 0, parked('sports', PAINT.red)),
      space(-3.0, -6.2, 0, parked('generic-hatchback', PAINT.gold)),
      space(0.0, -6.2, 0, parked('van', PAINT.cream)),
      space(3.0, -6.2, 0, parked('generic-sedan', PAINT.teal)),
      target({ x: 7.4, z: -6.25, yaw: 0, width: 2.7, length: 5.7 }),
      space(8.9, 7.2, Math.PI, parked('compact', PAINT.plum), 5.2),
    ],
    obstacles: [
      { kind: 'barrier', x: -5.8, z: 3.25, yaw: 0 },
      { kind: 'barrier', x: -1.8, z: 5.35, yaw: 0 },
      { kind: 'barrier', x: 6.85, z: 5.0, yaw: 0 },
      { kind: 'bollard', x: 5.25, z: -0.8 },
      { kind: 'bollard', x: 9.55, z: -0.8 },
    ],
    roadMarks: [
      { kind: 'arrow', x: -7.9, z: 5.7, yaw: Math.PI / 2 },
      { kind: 'arrow', x: -3.6, z: 1.3, yaw: -Math.PI / 4 },
      { kind: 'arrow', x: 3.8, z: 1.0, yaw: Math.PI / 4 },
      { kind: 'stop-line', x: 7.4, z: -1.3, yaw: Math.PI / 2 },
    ],
    driveRoute: [
      { x: -7.3, z: 5.8 },
      { x: -4.25, z: 5.15 },
      { x: -3.3, z: 2.2 },
      { x: 0.15, z: 1.65 },
      { x: 0.6, z: 4.15 },
      { x: 4.55, z: 4.15 },
      { x: 6.45, z: 2.65 },
      { x: 7.4, z: 1.15 },
      { x: 7.4, z: -1.45 },
      { x: 7.4, z: -4.2, positionTolerance: 0.45 },
      { x: 7.4, z: -6.25, yaw: Math.PI },
    ],
  },
  {
    id: 7,
    name: 'Gate Gauntlet',
    blurb: 'Clear the compressed barricades, square up in the pocket, then commit to the narrow bay.',
    parTime: 96,
    spawn: { x: 9.4, z: 5.7, yaw: -Math.PI / 2 },
    bay: { x: -7.2, z: -6.2, yaw: 0, width: 2.7, length: 5.7 },
    parkingSpaces: [
      space(-10.1, -6.2, 0, parked('generic-suv', PAINT.green)),
      target({ x: -7.2, z: -6.2, yaw: 0, width: 2.7, length: 5.7 }),
      space(-4.25, -6.2, 0, parked('sports', PAINT.blue)),
      space(-1.3, -6.2, 0, parked('generic-sedan', PAINT.red)),
      space(1.65, -6.2, 0, parked('van', PAINT.cream)),
      space(4.6, -6.2, 0, parked('generic-hatchback', PAINT.gold)),
      space(7.55, -6.2, 0, parked('generic-pickup', PAINT.slate)),
      space(10.5, -6.2, 0, parked('compact', PAINT.plum)),
    ],
    obstacles: [
      { kind: 'barrier', x: 5.6, z: 2.8, yaw: 0 },
      { kind: 'barrier', x: 1.2, z: 6.0, yaw: 0 },
      { kind: 'barrier', x: -2.8, z: 4.35, yaw: 0 },
      { kind: 'booth', x: -10.6, z: 4.0, yaw: Math.PI / 2 },
      { kind: 'bollard', x: -8.85, z: 0.3 },
      { kind: 'bollard', x: -5.55, z: 0.3 },
    ],
    roadMarks: [
      { kind: 'arrow', x: 7.6, z: 5.7, yaw: -Math.PI / 2 },
      { kind: 'arrow', x: 3.4, z: 1.5, yaw: -Math.PI * 0.75 },
      { kind: 'arrow', x: -3.8, z: 0.8, yaw: Math.PI * 0.75 },
      { kind: 'stop-line', x: -7.2, z: -1.25, yaw: Math.PI / 2 },
    ],
    driveRoute: [
      { x: 7.3, z: 5.7 },
      { x: 4.0, z: 5.1 },
      { x: 3.4, z: 2.0 },
      { x: -0.35, z: 1.6 },
      { x: -4.0, z: 2.3 },
      { x: -7.2, z: 2.3 },
      { x: -7.2, z: 0.45, positionTolerance: 0.8 },
      { x: -7.2, z: -4.2, positionTolerance: 0.45 },
      { x: -7.2, z: -6.2, yaw: Math.PI },
    ],
  },
  {
    id: 8,
    name: 'Parallel Pinch',
    blurb: 'Navigate the extended maze, line up beside the curb, and reverse into a van-tight gap.',
    parTime: 104,
    spawn: { x: -9.5, z: 5.7, yaw: Math.PI / 2 },
    bay: { x: 0.0, z: -6.45, yaw: Math.PI / 2, width: 2.95, length: 5.95 },
    parkingSpaces: [
      space(-5.45, -6.45, Math.PI / 2, parked('generic-sedan', PAINT.teal), 4.7),
      target({
        x: 0.0,
        z: -6.45,
        yaw: Math.PI / 2,
        width: 2.95,
        length: 5.95,
      }),
      space(6.9, -6.45, Math.PI / 2, parked('generic-hatchback', PAINT.red), 4.7),
      space(-10.0, -6.45, Math.PI / 2, parked('sports', PAINT.gold), 4.4),
      space(10.0, 1.95, 0, parked('generic-suv', PAINT.blue), 5.2),
      space(10.0, 6.9, Math.PI, parked('van', PAINT.cream), 5.2),
    ],
    obstacles: [
      { kind: 'booth', x: -5.2, z: 3.8, yaw: Math.PI / 2 },
      { kind: 'barrier', x: 0.2, z: 4.7, yaw: 0 },
      { kind: 'barrier', x: 4.1, z: 2.0, yaw: 0 },
      { kind: 'barrier', x: -1.2, z: -2.4, yaw: Math.PI / 2 },
    ],
    roadMarks: [
      { kind: 'stop-line', x: -7.5, z: 3.8, yaw: 0 },
      { kind: 'crosswalk', x: -3.5, z: 1.0, yaw: Math.PI / 2 },
      { kind: 'arrow', x: 1.9, z: 0.4, yaw: Math.PI / 2 },
      { kind: 'arrow', x: 7.5, z: -1.3, yaw: Math.PI },
    ],
    driveRoute: [
      { x: -8.75, z: 5.7 },
      { x: -8.75, z: 1.2 },
      { x: -3.4, z: -0.45 },
      { x: 1.8, z: -0.2 },
      { x: 2.25, z: 3.65 },
      { x: 6.2, z: 4.5 },
      { x: 7.65, z: 0.0 },
      {
        x: 7.65,
        z: -3.25,
        positionTolerance: 0.85,
      },
      { x: 4.15, z: -4.2, reverse: true, positionTolerance: 0.75 },
      { x: 2.0, z: -6.45, reverse: true, positionTolerance: 0.7 },
      { x: 0.0, z: -6.45, yaw: Math.PI / 2, reverse: true },
    ],
  },
  {
    id: 9,
    name: 'Switchback Circuit',
    blurb: 'Run the tightened switchback without clipping a gate, then settle into the far corner.',
    parTime: 112,
    spawn: { x: -9.5, z: -5.5, yaw: Math.PI / 2 },
    bay: { x: 8.4, z: 6.15, yaw: 0, width: 2.7, length: 5.7 },
    parkingSpaces: [
      space(0.0, -7.0, 0, parked('generic-sedan', PAINT.teal), 5.2),
      space(3.0, -6.95, 0, parked('van', PAINT.cream), 5.2),
      space(6.0, -7.0, 0, parked('generic-hatchback', PAINT.gold), 5.2),
      space(-8.8, 7.0, Math.PI, parked('generic-pickup', PAINT.slate), 5.2),
      space(-5.8, 7.0, Math.PI, parked('generic-suv', PAINT.green), 5.2),
      target({ x: 8.4, z: 6.15, yaw: 0, width: 2.7, length: 5.7 }),
    ],
    obstacles: [
      { kind: 'barrier', x: -3.8, z: -3.7, yaw: 0 },
      { kind: 'barrier', x: 0.0, z: -0.8, yaw: 0 },
      { kind: 'barrier', x: 1.6, z: -3.6, yaw: 0 },
      { kind: 'booth', x: -10.0, z: 0.9, yaw: 0 },
      { kind: 'bollard', x: 10.4, z: 0.9 },
      { kind: 'bollard', x: 10.4, z: 3.0 },
    ],
    roadMarks: [
      { kind: 'arrow', x: -7.7, z: -5.3, yaw: Math.PI / 2 },
      { kind: 'arrow', x: -1.9, z: -2.3, yaw: Math.PI / 4 },
      { kind: 'arrow', x: 3.5, z: 1.0, yaw: -Math.PI / 4 },
      { kind: 'stop-line', x: 7.0, z: 3.5, yaw: Math.PI / 2 },
    ],
    driveRoute: [
      { x: -7.1, z: -5.5 },
      { x: -5.7, z: -1.2 },
      { x: -2.0, z: 1.25 },
      { x: -2.7, z: 4.25 },
      { x: 2.9, z: 5.1 },
      { x: 4.6, z: 1.0 },
      { x: 4.9, z: -2.0 },
      { x: 8.9, z: -2.3 },
      { x: 8.4, z: 2.4, yaw: 0, positionTolerance: 0.85, yawTolerance: 0.55 },
      { x: 8.55, z: 6.3, yaw: 0 },
    ],
  },
  {
    id: 10,
    name: 'The Final Exam',
    blurb: 'Clear every compressed gate, change direction twice, and reverse into the angled finish.',
    parTime: 122,
    spawn: { x: -9.6, z: 5.8, yaw: Math.PI / 2 },
    bay: {
      x: 5.0,
      z: -1.0,
      yaw: Math.PI * 0.39,
      width: 3.05,
      length: 6.0,
    },
    parkingSpaces: [
      space(-9.0, -6.8, 0, parked('generic-suv', PAINT.green), 5.2),
      space(-6.0, -6.8, 0, parked('generic-pickup', PAINT.slate), 5.2),
      target({
        x: 5.0,
        z: -1.0,
        yaw: Math.PI * 0.39,
        width: 3.05,
        length: 6.0,
      }),
      space(10.0, -1.5, 0, parked('generic-hatchback', PAINT.gold), 5.2),
      space(0.0, 7.2, Math.PI, parked('compact', PAINT.blue), 5.2),
      space(8.8, 7.2, Math.PI, parked('generic-sedan', PAINT.plum), 5.2),
    ],
    obstacles: [
      { kind: 'booth', x: -5.2, z: 3.9, yaw: Math.PI / 2 },
      { kind: 'barrier', x: -2.0, z: 4.4, yaw: 0 },
      { kind: 'barrier', x: 0.8, z: -3.6, yaw: Math.PI / 2 },
    ],
    roadMarks: [
      { kind: 'stop-line', x: -7.5, z: 3.9, yaw: 0 },
      { kind: 'crosswalk', x: -3.5, z: 0.8, yaw: Math.PI / 2 },
      { kind: 'arrow', x: 1.8, z: 2.8, yaw: Math.PI / 4 },
      { kind: 'arrow', x: -1.8, z: -4.8, yaw: -Math.PI / 2 },
    ],
    driveRoute: [
      { x: -8.75, z: 5.8 },
      { x: -8.75, z: 1.3 },
      { x: -3.5, z: -0.3 },
      { x: -0.8, z: 0.0 },
      { x: 2.3, z: 3.6 },
      { x: 6.0, z: 4.6 },
      { x: 5.5, z: 2.5 },
      { x: 5.5, z: 0.0 },
      { x: 4.0, z: -1.45 },
      { x: 3.1, z: -1.7 },
      {
        x: 5.0,
        z: -1.0,
        yaw: Math.PI * 1.39,
        reverse: true,
      },
    ],
  },
];
