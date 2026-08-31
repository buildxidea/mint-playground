import * as THREE from "three";
import { PASSENGERS, type PassengerDef, storyY } from "./content";
import { windowForStory } from "./timeline";

/**
 * Passenger positions are a pure function of beat time, so boarding and
 * exiting scrub cleanly when the visitor scrolls backwards.
 */

interface Choreo {
  def: PassengerDef;
  boardStart: number;
  boardEnd: number;
  turnEnd: number;
  exitStart: number;
  exitEnd: number;
  boardY: number;
  exitY: number;
}

/**
 * z of the doorway, and how wide a lane through it the walk may use.
 *
 * Walking straight from a diorama position to a cab slot cuts the corner: the
 * line crosses the door plane well outside the aperture, so a passenger passes
 * through the door frame rather than the opening. Every walk is therefore
 * routed through a waypoint in the doorway, which is also how people actually
 * board — funnelling toward the middle and spreading out once inside.
 */
const GATE_Z = -1.12;
const GATE_SPREAD = 0.3;

/** Position along `from -> gate -> to`, with the gate at the halfway mark. */
function throughDoorway(
  fx: number,
  fz: number,
  tx: number,
  tz: number,
  gx: number,
  u: number,
): [number, number] {
  if (u < 0.5) {
    const v = u * 2;
    return [fx + (gx - fx) * v, fz + (GATE_Z - fz) * v];
  }
  const v = (u - 0.5) * 2;
  return [gx + (tx - gx) * v, GATE_Z + (tz - GATE_Z) * v];
}

const choreos: Choreo[] = PASSENGERS.map((def, i) => {
  const bw = windowForStory(def.boardStory);
  const ew = windowForStory(def.exitStory);
  if (!bw || !ew) throw new Error(`No stop window for passenger ${def.key}`);
  const bSpan = bw.closeStart - bw.open;
  const eSpan = ew.closeStart - ew.open;
  const jitter = (i % 3) * 0.06;
  // Exits use the first 45% of a dwell, entries the back 50% — so at floor 12
  // Amara steps out before Daichi and Naomi step in.
  const boardStart = bw.open + bSpan * (0.5 + jitter * 0.3);
  const boardEnd = boardStart + bSpan * 0.4;
  return {
    def,
    boardStart,
    boardEnd,
    turnEnd: boardEnd + 0.18,
    exitStart: ew.open + eSpan * (0.04 + jitter * 0.5),
    exitEnd: ew.open + eSpan * (0.42 + jitter * 0.3),
    boardY: storyY(def.boardStory),
    exitY: storyY(def.exitStory),
  };
});

function smooth(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

const FACE_DOORS = Math.PI; // riding: face -z (the doors), backs to camera

function walkYaw(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

function lerpAngle(a: number, b: number, u: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

const BOB_FREQ = 8.5;
/** Minimum horizontal gap between two people standing or walking. */
const MIN_SEPARATION = 0.54;

export interface FloorHeights {
  /** Cab floor height above the cab group's origin. */
  cabOffset: number;
  /** World Y of a story's walkable surface. */
  storyTop: (story: number) => number;
}

export function updatePassengers(
  t: number,
  cabY: number,
  roots: Map<string, THREE.Group>,
  floors: FloorHeights,
): void {
  for (const c of choreos) {
    const root = roots.get(c.def.key);
    if (!root) continue;
    const { def } = c;
    const [sx, sz] = def.slot;
    const [fx, fz] = def.from;
    const [tx, tz] = def.to;

    // Stand on the surface that is actually drawn, not the story origin.
    const boardFloor = floors.storyTop(def.boardStory);
    const exitFloor = floors.storyTop(def.exitStory);
    const cabFloor = cabY + floors.cabOffset;

    let x: number, y: number, z: number, yaw: number;
    let bob = 0;

    if (t < c.boardStart) {
      // Waiting in the origin diorama, facing the landing doors.
      x = fx;
      z = fz;
      y = boardFloor;
      yaw = 0;
    } else if (t < c.boardEnd) {
      const u = smooth((t - c.boardStart) / (c.boardEnd - c.boardStart));
      const gx = sx * GATE_SPREAD;
      [x, z] = throughDoorway(fx, fz, sx, sz, gx, u);
      y = boardFloor + (cabFloor - boardFloor) * u;
      // Face the leg being walked, not the overall direction, or the turn
      // through the doorway reads as sliding sideways.
      yaw = u < 0.5 ? walkYaw(gx - fx, GATE_Z - fz) : walkYaw(sx - gx, sz - GATE_Z);
      bob = Math.sin(u * Math.PI * BOB_FREQ) * 0.02;
    } else if (t < c.turnEnd) {
      // The classic elevator about-face after stepping in.
      const u = smooth((t - c.boardEnd) / (c.turnEnd - c.boardEnd));
      x = sx;
      z = sz;
      y = cabFloor;
      yaw = lerpAngle(walkYaw(sx - fx, sz - fz), FACE_DOORS, u);
    } else if (t < c.exitStart) {
      x = sx;
      z = sz;
      y = cabFloor;
      yaw = FACE_DOORS;
    } else if (t < c.exitEnd) {
      const u = smooth((t - c.exitStart) / (c.exitEnd - c.exitStart));
      const gx = sx * GATE_SPREAD;
      [x, z] = throughDoorway(sx, sz, tx, tz, gx, u);
      y = cabFloor + (exitFloor - cabFloor) * u;
      yaw = u < 0.5 ? walkYaw(gx - sx, GATE_Z - sz) : walkYaw(tx - gx, tz - GATE_Z);
      bob = Math.sin(u * Math.PI * BOB_FREQ) * 0.02;
    } else {
      // Arrived: stands in the destination room, looking back at the car.
      x = tx;
      z = tz;
      y = exitFloor;
      yaw = 0;
    }

    root.position.set(x, y + bob, z);
    root.rotation.y = yaw;
  }

  // Scripted paths can cross, which reads as people walking through each
  // other. Relax any overlapping pair apart horizontally. This is computed
  // fresh from the frame's own positions, so scrubbing stays deterministic.
  const crowd = choreos
    .map((c) => roots.get(c.def.key))
    .filter((r): r is THREE.Group => r !== undefined && r.visible);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < crowd.length; i++) {
      for (let j = i + 1; j < crowd.length; j++) {
        const a = crowd[i];
        const b = crowd[j];
        // Only people sharing a floor can collide.
        if (Math.abs(a.position.y - b.position.y) > 1.4) continue;
        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        let dist = Math.hypot(dx, dz);
        if (dist >= MIN_SEPARATION) continue;
        if (dist < 1e-4) {
          // Exactly coincident: break the tie along x.
          dx = 1;
          dz = 0;
          dist = 1;
        }
        const push = (MIN_SEPARATION - dist) / 2;
        const nx = (dx / dist) * push;
        const nz = (dz / dist) * push;
        a.position.x -= nx;
        a.position.z -= nz;
        b.position.x += nx;
        b.position.z += nz;
      }
    }
  }
}

export function passengerByKey(key: string): PassengerDef | undefined {
  return PASSENGERS.find((p) => p.key === key);
}
