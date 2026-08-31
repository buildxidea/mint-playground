import { JELLY, SPAWN, SWIM } from '../config';
import type { BubbleRing } from '../entities/BubbleRing';
import type { Jellyfish } from '../entities/Jellyfish';
import type { Fish } from '../entities/Fish';

export type CollisionEvents = {
  ringsPassed: BubbleRing[];
  ringsMissed: number;
  bouncedOn: Jellyfish | null;
  stung: boolean;
};

/**
 * Sphere/plane tests for the three interactions: ring pass (crossing the ring
 * plane inside its radius), jelly cap bounce (contact with the bell from
 * above), and tentacle sting (contact with the hanging cylinder).
 */
export class CollisionSystem {
  private readonly events: CollisionEvents = {
    ringsPassed: [],
    ringsMissed: 0,
    bouncedOn: null,
    stung: false,
  };

  check(fish: Fish, previousZ: number, rings: BubbleRing[], jellies: Jellyfish[]): CollisionEvents {
    this.events.ringsPassed.length = 0;
    this.events.ringsMissed = 0;
    this.events.bouncedOn = null;
    this.events.stung = false;

    const position = fish.position;

    for (const ring of rings) {
      if (ring.passed) continue;
      const ringZ = ring.group.position.z;
      // Fish travels -Z: it crossed this ring's plane during the last step?
      if (previousZ >= ringZ && position.z < ringZ) {
        const dx = position.x - ring.group.position.x;
        const dy = position.y - ring.group.position.y;
        const lateral = Math.hypot(dx, dy);
        ring.passed = true;
        if (lateral <= SPAWN.ringRadius) {
          this.events.ringsPassed.push(ring);
        } else {
          this.events.ringsMissed += 1;
        }
      }
    }

    for (const jelly of jellies) {
      if (!jelly.interactive) continue;
      const jellyPos = jelly.group.position;
      const dx = position.x - jellyPos.x;
      const dz = position.z - jellyPos.z;

      // Cap bounce: near the bell sphere, approaching from above its equator.
      if (jelly.bounceCooldown <= 0) {
        const dy = position.y - jellyPos.y;
        const distSq = dx * dx + dy * dy + dz * dz;
        const reach = JELLY.capRadius + SWIM.fishRadius;
        if (distSq <= reach * reach && dy > -0.3) {
          this.events.bouncedOn = jelly;
          continue;
        }
      }

      // Tentacle sting: horizontal cylinder below the bell.
      if (fish.invulnerable <= 0 && !this.events.stung) {
        const top = jellyPos.y - 0.4;
        const bottom = jellyPos.y - JELLY.tentacleLength;
        if (position.y < top && position.y > bottom) {
          const horizontal = Math.hypot(dx, dz);
          if (horizontal <= JELLY.tentacleRadius + SWIM.fishRadius) {
            this.events.stung = true;
          }
        }
      }
    }

    return this.events;
  }
}
