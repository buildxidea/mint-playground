import * as THREE from 'three';
import type {
  SplatNavigationSurface,
  SplatWorldPortal,
} from './SplatNavigationSurface';

export type SplatFramePortal = {
  id: string;
  fromId: string;
  toId: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  prefetchFrom: THREE.Vector3;
  prefetchTo: THREE.Vector3;
  direction: THREE.Vector3;
  radius: number;
  continuous: true;
  ready: boolean;
  traversalPolygon: THREE.Vector2[];
  transitionPolygon: THREE.Vector2[];
};

export type SplatFrameTransition = {
  fromId: string;
  toId: string;
  destination: THREE.Vector3;
  continuous: true;
};

export type SplatFramePrefetchOptions = {
  lookDirection?: THREE.Vector3 | null;
  limit?: number;
};

/** Resolves render ownership only through validated authored portal overlap. */
export class SplatFrameCompletion {
  readonly portals: SplatFramePortal[] = [];
  private surface: SplatNavigationSurface | null = null;

  clear(): void {
    this.surface = null;
    this.portals.length = 0;
  }

  buildFromSurface(surface: SplatNavigationSurface): void {
    this.surface = surface;
    this.portals.length = 0;
    for (const portal of surface.portals) {
      this.portals.push(this.fromWorldPortal(portal));
    }
  }

  setPortalReady(portalId: string, ready: boolean): void {
    const portal = this.portals.find((candidate) => candidate.id === portalId);
    if (!portal) return;
    portal.ready = ready;
    this.surface?.setPortalReady(portalId, ready);
  }

  resolve(
    previous: THREE.Vector3,
    current: THREE.Vector3,
    frameOwner: string | null,
  ): SplatFrameTransition | null {
    for (const portal of this.portals) {
      if (!portal.ready) continue;
      const seam = portal.from.clone().lerp(portal.to, 0.5);
      if (
        frameOwner === portal.fromId &&
        this.crossed(
          previous,
          current,
          seam,
          portal.direction,
          portal.radius,
          portal.transitionPolygon,
        )
      ) {
        return {
          fromId: portal.fromId,
          toId: portal.toId,
          destination: current.clone(),
          continuous: true,
        };
      }
      const reverseDirection = portal.direction.clone().negate();
      if (
        frameOwner === portal.toId &&
        this.crossed(
          previous,
          current,
          seam,
          reverseDirection,
          portal.radius,
          portal.transitionPolygon,
        )
      ) {
        return {
          fromId: portal.toId,
          toId: portal.fromId,
          destination: current.clone(),
          continuous: true,
        };
      }
    }
    return null;
  }

  prefetchTarget(
    position: THREE.Vector3,
    frameOwner: string | null,
    maximumDistance = 18,
    options: SplatFramePrefetchOptions = {},
  ): string | null {
    return (
      this.prefetchTargets(position, frameOwner, maximumDistance, {
        ...options,
        limit: 1,
      })[0] ?? null
    );
  }

  /**
   * Rank doorway destinations the player is approaching so Spark can page
   * them before a cut aperture reveals empty space. Optional look direction
   * prefers the doorway the camera faces without requiring the player to
   * already be standing in the traversal polygon.
   */
  prefetchTargets(
    position: THREE.Vector3,
    frameOwner: string | null,
    maximumDistance = 18,
    options: SplatFramePrefetchOptions = {},
  ): string[] {
    const limit = Math.max(1, options.limit ?? 1);
    const look = options.lookDirection;
    const maximumDistanceSq = maximumDistance * maximumDistance;
    // Prefer a view-facing doorway by roughly a third of the approach radius
    // so looking at a farther cut still warms it ahead of a nearer rear door.
    const facingBoostSq = maximumDistanceSq * 0.12;
    const ranked: Array<{ id: string; score: number }> = [];
    const bestById = new Map<string, number>();

    for (const portal of this.portals) {
      const endpoint =
        frameOwner === portal.fromId
          ? {
              point: portal.prefetchFrom,
              id: portal.toId,
              toward: portal.direction,
            }
          : frameOwner === portal.toId
            ? {
                point: portal.prefetchTo,
                id: portal.fromId,
                toward: portal.direction.clone().negate(),
              }
            : null;
      if (!endpoint) continue;
      const dx = position.x - endpoint.point.x;
      const dz = position.z - endpoint.point.z;
      // Residency must begin while approaching the doorway owned by the
      // current room. Measuring to the far-side socket delayed long links
      // until the player had already crossed into their traversal polygon.
      // Once inside that polygon, keep the same destination warm until the
      // frame owner changes.
      const insideTraversal = this.pointInPolygon(
        new THREE.Vector2(position.x, position.z),
        portal.traversalPolygon,
      );
      const distanceSq = insideTraversal ? 0 : dx * dx + dz * dz;
      if (distanceSq > maximumDistanceSq) continue;

      let facing = 0;
      if (look && look.lengthSq() > 1e-6) {
        const toDoorX = endpoint.point.x - position.x;
        const toDoorZ = endpoint.point.z - position.z;
        const toDoorLengthSq = toDoorX * toDoorX + toDoorZ * toDoorZ;
        if (toDoorLengthSq > 1e-6) {
          const inv = 1 / Math.sqrt(toDoorLengthSq);
          facing = Math.max(
            0,
            look.x * toDoorX * inv + look.z * toDoorZ * inv,
          );
        } else {
          facing = Math.max(
            0,
            look.x * endpoint.toward.x + look.z * endpoint.toward.z,
          );
        }
      }

      const score = distanceSq - facing * facingBoostSq;
      const previous = bestById.get(endpoint.id);
      if (previous === undefined || score < previous) {
        bestById.set(endpoint.id, score);
      }
    }

    for (const [id, score] of bestById) {
      ranked.push({ id, score });
    }
    ranked.sort((a, b) => a.score - b.score);
    return ranked.slice(0, limit).map((entry) => entry.id);
  }

  diagnostics(): Array<{
    id: string;
    fromId: string;
    toId: string;
    from: { x: number; y: number; z: number };
    to: { x: number; y: number; z: number };
    radius: number;
    continuous: true;
    ready: boolean;
  }> {
    return this.portals.map((portal) => ({
      id: portal.id,
      fromId: portal.fromId,
      toId: portal.toId,
      from: {
        x: portal.from.x,
        y: portal.from.y,
        z: portal.from.z,
      },
      to: {
        x: portal.to.x,
        y: portal.to.y,
        z: portal.to.z,
      },
      radius: portal.radius,
      continuous: true,
      ready: portal.ready,
    }));
  }

  private fromWorldPortal(portal: SplatWorldPortal): SplatFramePortal {
    // Portal sockets describe the source scans; the baked reachable supports
    // are the runtime doorway authority. Long transformed links can otherwise
    // leave prefetch measuring to a socket tens of metres off the path.
    const prefetchFrom =
      this.surface?.portalApproachPoint(
        portal.source.id,
        portal.source.fromRoomId,
        0,
      ) ?? portal.from.clone();
    const prefetchTo =
      this.surface?.portalApproachPoint(
        portal.source.id,
        portal.source.toRoomId,
        0,
      ) ?? portal.to.clone();
    const direction = portal.to.clone().sub(portal.from).setY(0);
    const distance = direction.length();
    if (distance > 1e-6) direction.divideScalar(distance);
    const radius = Math.max(
      0.1,
      portal.source.width * 0.5,
    );
    return {
      id: portal.source.id,
      fromId: portal.source.fromRoomId,
      toId: portal.source.toRoomId,
      from: portal.from.clone(),
      to: portal.to.clone(),
      prefetchFrom,
      prefetchTo,
      direction,
      radius,
      continuous: true,
      ready: this.surface?.isPortalOpen(portal.source.id) ?? false,
      traversalPolygon: portal.traversalPolygon.map((point) => point.clone()),
      transitionPolygon: portal.transitionPolygon.map((point) => point.clone()),
    };
  }

  private crossed(
    previous: THREE.Vector3,
    current: THREE.Vector3,
    center: THREE.Vector3,
    normal: THREE.Vector3,
    radius: number,
    transitionPolygon: THREE.Vector2[],
  ): boolean {
    const previousOffset = previous.clone().sub(center);
    const currentOffset = current.clone().sub(center);
    const previousDistance = previousOffset.dot(normal);
    const currentDistance = currentOffset.dot(normal);
    if (previousDistance > 0 || currentDistance < 0) return false;
    const denominator = previousDistance - currentDistance;
    if (Math.abs(denominator) < 1e-6) return false;
    const t = THREE.MathUtils.clamp(previousDistance / denominator, 0, 1);
    const crossing = previous.clone().lerp(current, t).sub(center);
    const worldCrossing = previous.clone().lerp(current, t);
    if (
      transitionPolygon.length >= 3 &&
      !this.pointInPolygon(
        new THREE.Vector2(worldCrossing.x, worldCrossing.z),
        transitionPolygon,
      )
    ) {
      return false;
    }
    crossing.addScaledVector(normal, -crossing.dot(normal));
    crossing.y = 0;
    return crossing.lengthSq() <= radius * radius;
  }

  private pointInPolygon(
    point: THREE.Vector2,
    polygon: THREE.Vector2[],
  ): boolean {
    let inside = false;
    for (
      let current = 0, previous = polygon.length - 1;
      current < polygon.length;
      previous = current++
    ) {
      const a = polygon[current]!;
      const b = polygon[previous]!;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x <
          ((b.x - a.x) * (point.y - a.y)) /
            (b.y - a.y + Number.EPSILON) +
            a.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  }
}
