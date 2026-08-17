export type Side = "port" | "starboard";
export type Facing = "fwd" | "aft";

export type LocationId = string;

/** Meters, in world axes. */
export type Vec3 = [number, number, number];

export interface SeatDef {
  id: LocationId;
  kind: "passenger" | "crew";
  side: Side;
  row: number;
  /** Floor-level seat center, meters. */
  pos: [number, number, number];
  facing: Facing;
}

export interface ExitDef {
  id: string;
  type: "door" | "overwing";
  side: Side;
  z: number;
}

export interface WindowDef {
  side: Side;
  z: number;
  /** Center height. */
  y: number;
  rx: number;
  ry: number;
}

export interface CabinDims {
  /** Interior length, cockpit bulkhead (z=0) to rear wall. */
  length: number;
  /** Interior wall-to-wall width. */
  width: number;
  /** Floor-to-ceiling height. */
  height: number;
  wallThickness: number;
}

export interface Pose {
  position: [number, number, number];
  yaw: number;
  pitch: number;
}
