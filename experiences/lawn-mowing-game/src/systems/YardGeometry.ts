import type { Level, Obstacle, Rect } from '../game/levels';

export type Bounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
};

function rectContains(rect: Rect, x: number, z: number, inset = 0): boolean {
  const hw = rect.w / 2 - inset;
  const hd = rect.d / 2 - inset;
  return Math.abs(x - rect.x) <= hw && Math.abs(z - rect.z) <= hd;
}

/**
 * Distance from a point to a rectangle's boundary, negative inside.
 * Only the outside case is exact, which is all the collision path needs.
 */
function rectDistance(rect: Rect, x: number, z: number): number {
  const dx = Math.abs(x - rect.x) - rect.w / 2;
  const dz = Math.abs(z - rect.z) - rect.d / 2;
  const outsideX = Math.max(dx, 0);
  const outsideZ = Math.max(dz, 0);
  const outside = Math.hypot(outsideX, outsideZ);
  const inside = Math.min(Math.max(dx, dz), 0);
  return outside + inside;
}

/**
 * Queries the shape of one level's yard. Everything that needs to know
 * "can I mow here" or "can I drive here" goes through this so the coverage
 * denominator, the collision test, and the grass placement can never disagree.
 */
export class YardGeometry {
  readonly bounds: Bounds;
  readonly maskBounds: Bounds;

  constructor(private readonly level: Level) {
    this.bounds = YardGeometry.boundsOf(level.yard);
    this.maskBounds = YardGeometry.padded(this.bounds, 1.5);
  }

  /** Inside the turf, ignoring obstacles. */
  isOnTurf(x: number, z: number): boolean {
    return this.level.yard.some((rect) => rectContains(rect, x, z));
  }

  /** Inside the turf and not covered by a hole or a prop. Drives coverage %. */
  isMowable(x: number, z: number): boolean {
    if (!this.isOnTurf(x, z)) return false;
    for (const hole of this.level.holes) {
      if (rectContains(hole, x, z)) return false;
    }
    for (const obstacle of this.level.obstacles) {
      if (this.obstacleContains(obstacle, x, z, 0)) return false;
    }
    return true;
  }

  /**
   * Can the mower's center sit here? Keeps the deck on the turf and out of
   * every prop.
   */
  canOccupy(x: number, z: number, radius: number): boolean {
    if (!this.level.yard.some((rect) => rectContains(rect, x, z, radius * 0.7))) {
      // An L-shaped yard is two overlapping rectangles, so the inset test can
      // reject the seam. Fall back to a plain containment test there.
      if (!this.isOnTurf(x, z)) return false;
    }
    for (const obstacle of this.level.obstacles) {
      if (this.obstacleContains(obstacle, x, z, radius)) return false;
    }
    return true;
  }

  private obstacleContains(obstacle: Obstacle, x: number, z: number, margin: number): boolean {
    if (obstacle.shape === 'circle') {
      const dx = x - obstacle.x;
      const dz = z - obstacle.z;
      return dx * dx + dz * dz <= (obstacle.r + margin) * (obstacle.r + margin);
    }
    return rectDistance(obstacle, x, z) <= margin;
  }

  static boundsOf(rects: Rect[]): Bounds {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const rect of rects) {
      minX = Math.min(minX, rect.x - rect.w / 2);
      maxX = Math.max(maxX, rect.x + rect.w / 2);
      minZ = Math.min(minZ, rect.z - rect.d / 2);
      maxZ = Math.max(maxZ, rect.z + rect.d / 2);
    }
    return YardGeometry.describe(minX, maxX, minZ, maxZ);
  }

  static padded(bounds: Bounds, pad: number): Bounds {
    return YardGeometry.describe(
      bounds.minX - pad,
      bounds.maxX + pad,
      bounds.minZ - pad,
      bounds.maxZ + pad,
    );
  }

  private static describe(minX: number, maxX: number, minZ: number, maxZ: number): Bounds {
    return {
      minX,
      maxX,
      minZ,
      maxZ,
      width: maxX - minX,
      depth: maxZ - minZ,
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
    };
  }
}
