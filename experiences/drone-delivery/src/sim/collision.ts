import * as THREE from 'three';

export interface BoxCollider {
  box: THREE.Box3;
  /** What the drone hit, for messaging. */
  label: string;
}

export interface SegmentCollider {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  label: string;
}

export interface SphereCollider {
  center: THREE.Vector3;
  radius: number;
  label: string;
}

export interface CollisionHit {
  label: string;
  /** Push-out direction for the drone, unit length. */
  normal: THREE.Vector3;
  depth: number;
}

const closest = new THREE.Vector3();
const seg = new THREE.Vector3();
const toCenter = new THREE.Vector3();

/**
 * Static world colliders plus per-frame dynamic ones (hazards). The drone is
 * a single sphere — plenty for pastel rooftops and power lines.
 */
export class CollisionWorld {
  readonly boxes: BoxCollider[] = [];
  readonly segments: SegmentCollider[] = [];
  readonly spheres: SphereCollider[] = [];

  clear(): void {
    this.boxes.length = 0;
    this.segments.length = 0;
    this.spheres.length = 0;
  }

  /** First hit against the drone sphere, or null. */
  test(center: THREE.Vector3, radius: number): CollisionHit | null {
    for (const collider of this.boxes) {
      collider.box.clampPoint(center, closest);
      toCenter.subVectors(center, closest);
      const distSq = toCenter.lengthSq();
      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        const normal =
          dist > 1e-5
            ? toCenter.clone().divideScalar(dist)
            : new THREE.Vector3(0, 1, 0);
        return { label: collider.label, normal, depth: radius - dist };
      }
    }

    for (const collider of this.segments) {
      closestPointOnSegment(collider.start, collider.end, center, closest);
      toCenter.subVectors(center, closest);
      const combined = radius + collider.radius;
      const distSq = toCenter.lengthSq();
      if (distSq < combined * combined) {
        const dist = Math.sqrt(distSq);
        const normal =
          dist > 1e-5
            ? toCenter.clone().divideScalar(dist)
            : new THREE.Vector3(0, 1, 0);
        return { label: collider.label, normal, depth: combined - dist };
      }
    }

    for (const collider of this.spheres) {
      toCenter.subVectors(center, collider.center);
      const combined = radius + collider.radius;
      const distSq = toCenter.lengthSq();
      if (distSq < combined * combined) {
        const dist = Math.sqrt(distSq);
        const normal =
          dist > 1e-5
            ? toCenter.clone().divideScalar(dist)
            : new THREE.Vector3(0, 1, 0);
        return { label: collider.label, normal, depth: combined - dist };
      }
    }

    return null;
  }

  /**
   * Highest box top directly under the point (for rooftop touchdowns).
   * Returns the ground height when nothing is underneath.
   */
  supportHeight(point: THREE.Vector3, ground = 0): number {
    let best = ground;
    for (const collider of this.boxes) {
      const { min, max } = collider.box;
      if (
        point.x >= min.x &&
        point.x <= max.x &&
        point.z >= min.z &&
        point.z <= max.z &&
        max.y <= point.y + 0.5 &&
        max.y > best
      ) {
        best = max.y;
      }
    }
    return best;
  }
}

function closestPointOnSegment(
  a: THREE.Vector3,
  b: THREE.Vector3,
  point: THREE.Vector3,
  out: THREE.Vector3,
): void {
  seg.subVectors(b, a);
  const t = THREE.MathUtils.clamp(
    point.clone().sub(a).dot(seg) / Math.max(seg.lengthSq(), 1e-8),
    0,
    1,
  );
  out.copy(a).addScaledVector(seg, t);
}
