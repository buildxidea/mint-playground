/** The matte wearing course that players recognize as the driveable asphalt. */
export const VISIBLE_ASPHALT_WIDTH = 25.5;
export const VISIBLE_ASPHALT_DEPTH = 19.2;

export type AsphaltBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export const VISIBLE_ASPHALT_BOUNDS: AsphaltBounds = {
  minX: -VISIBLE_ASPHALT_WIDTH / 2,
  maxX: VISIBLE_ASPHALT_WIDTH / 2,
  minZ: -VISIBLE_ASPHALT_DEPTH / 2,
  maxZ: VISIBLE_ASPHALT_DEPTH / 2,
};

/** Visible breathing room between a car footprint and the asphalt edge/curb. */
export const ASPHALT_EDGE_CLEARANCE = 0.12;

/**
 * Minimum clearance from an oriented rectangular footprint to the asphalt
 * edge. A negative value means part of the footprint is outside the asphalt.
 */
export function footprintAsphaltClearance(
  x: number,
  z: number,
  yaw: number,
  width: number,
  length: number,
  bounds: AsphaltBounds = VISIBLE_ASPHALT_BOUNDS,
): number {
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  const extentX = cos * (width / 2) + sin * (length / 2);
  const extentZ = sin * (width / 2) + cos * (length / 2);
  return Math.min(
    x - extentX - bounds.minX,
    bounds.maxX - (x + extentX),
    z - extentZ - bounds.minZ,
    bounds.maxZ - (z + extentZ),
  );
}
