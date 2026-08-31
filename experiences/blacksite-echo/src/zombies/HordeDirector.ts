import * as THREE from 'three';
import { Zombie, type ZombieAttackEvent } from './Zombie';
import {
  CONCURRENT_ZOMBIE_CAP,
  zombieArchetypeForSpawn,
  type ZombieArchetype,
  type ZoneId,
} from './zombiesData';
import type { RoundDirector } from './RoundDirector';
import {
  ZombieCampusNavigator,
  type ZombieCampusRoom,
} from './ZombieCampusNavigator';
import type { SplatFramePortal } from '../world/SplatFrameCompletion';
import type { SplatContainment } from '../world/SplatContainment';
import type { SplatNavigationSurface } from '../world/SplatNavigationSurface';

export type ZombieSpawnPoint = {
  id: string;
  zone: ZoneId;
  position: THREE.Vector3;
  /** Matching window/barrier buyable the zombie climbs through. */
  barrierId?: string;
  roomId?: string;
  outsidePosition?: THREE.Vector3;
  landingPosition?: THREE.Vector3;
};

const SPAWN_INTERVAL = 0.62;

export class HordeDirector {
  readonly zombies: Zombie[] = [];
  readonly campusNavigation = new ZombieCampusNavigator();
  private spawnPoints: ZombieSpawnPoint[] = [];
  private unlockedZones = new Set<ZoneId>(['spawn']);
  private nextId = 1;
  private spawnSequence = 1;
  private scene: THREE.Scene | null = null;
  private entryTarget = new THREE.Vector3(0, 1, 2);
  private readonly previousZombiePosition = new THREE.Vector3();
  private spawnCooldown = 0;
  private spawnCursor = 0;
  private visibleFallbacksAllowed = true;
  private pendingMintFailures = 0;
  private mintAttachFailures = 0;
  private onBarrierBreached: ((barrierId: string) => void) | null = null;
  /** Maps Outbreak: retry alternate landings / direct-spawn when entry stalls. */
  private mapsFullMapPursuit = false;
  private mintFactory:
    | ((
        archetype: ZombieArchetype,
      ) => Promise<{
        visual: THREE.Object3D;
        clips: Record<string, THREE.AnimationClip>;
      } | null>)
    | null = null;

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setMintFactory(
    factory: (
      archetype: ZombieArchetype,
    ) => Promise<{
      visual: THREE.Object3D;
      clips: Record<string, THREE.AnimationClip>;
    } | null>,
  ): void {
    this.mintFactory = factory;
  }

  setVisibleFallbacksAllowed(allowed: boolean): void {
    this.visibleFallbacksAllowed = allowed;
  }

  setEntryTarget(position: THREE.Vector3): void {
    this.entryTarget.copy(position);
  }

  setBarrierBreachHandler(handler: ((barrierId: string) => void) | null): void {
    this.onBarrierBreached = handler;
  }

  setMapsFullMapPursuit(enabled: boolean): void {
    this.mapsFullMapPursuit = enabled;
  }

  configureSpawnPoints(points: ZombieSpawnPoint[]): void {
    this.spawnPoints = points.map((p) => ({
      ...p,
      position: p.position.clone(),
      outsidePosition: p.outsidePosition?.clone(),
      landingPosition: p.landingPosition?.clone(),
    }));
    this.spawnCursor = 0;
  }

  configureCampusNavigation(
    rooms: ZombieCampusRoom[],
    portals: SplatFramePortal[],
    surface?: SplatNavigationSurface,
    containment?: SplatContainment,
  ): void {
    this.campusNavigation.configure(rooms, portals, surface, containment);
  }

  assignZombieNavigationRoom(
    zombie: Zombie,
    roomId?: string | null,
  ): string | null {
    return this.campusNavigation.assignRoom(zombie, roomId);
  }

  resetNavigationDiagnostics(): void {
    this.campusNavigation.resetActors();
    for (const zombie of this.zombies) {
      this.campusNavigation.registerSpawn(zombie);
    }
  }

  unlockZone(zone: ZoneId): void {
    this.unlockedZones.add(zone);
  }

  /** Allow the next fillSpawns call to emit immediately (new round / tests). */
  clearSpawnCooldown(): void {
    this.spawnCooldown = 0;
  }

  reset(): void {
    for (const zombie of this.zombies) {
      zombie.group.removeFromParent();
    }
    this.zombies.length = 0;
    this.unlockedZones = new Set(['spawn']);
    this.nextId = 1;
    this.spawnSequence = 1;
    this.spawnCooldown = 0;
    this.spawnCursor = 0;
    this.pendingMintFailures = 0;
    this.mintAttachFailures = 0;
    this.mapsFullMapPursuit = false;
    this.campusNavigation.resetActors();
  }

  livingCount(): number {
    return this.zombies.filter((z) => !z.isDefeated()).length;
  }

  get proceduralFallbackCount(): number {
    return this.zombies.filter(
      (zombie) => !zombie.isDefeated() && zombie.hasPlaceholderVisual,
    ).length;
  }

  get mintFailureCount(): number {
    return this.mintAttachFailures;
  }

  update(
    delta: number,
    playerPosition: THREE.Vector3,
    rounds: RoundDirector,
    sampleFootY?: (x: number, z: number, preferY: number) => number,
    playerRoomId?: string | null,
  ): ZombieAttackEvent[] {
    if (this.pendingMintFailures > 0) {
      rounds.notifyDefeated(this.pendingMintFailures);
      this.pendingMintFailures = 0;
    }
    this.spawnCooldown = Math.max(0, this.spawnCooldown - delta);
    this.fillSpawns(rounds, playerRoomId);
    const attacks: ZombieAttackEvent[] = [];
    for (const zombie of this.zombies) {
      const wasDefeated = zombie.isDefeated();
      this.previousZombiePosition.copy(zombie.group.position);
      const navigation = this.campusNavigation.plan(
        zombie,
        playerPosition,
        playerRoomId,
      );
      const attack = zombie.update(
        delta,
        playerPosition,
        sampleFootY,
        navigation.intent,
      );
      this.campusNavigation.commit(
        zombie,
        navigation,
        this.previousZombiePosition,
        delta,
        sampleFootY,
      );
      if (wasDefeated) continue;
      if (
        zombie.state === 'entry-commit' &&
        this.campusNavigation.commitEntry(
          zombie,
          zombie.group.position.clone(),
        )
      ) {
        const breach = zombie.consumeEntryEvent();
        if (breach?.barrierId) {
          this.onBarrierBreached?.(breach.barrierId);
        }
      }
      if (attack) attacks.push(attack);
    }
    return attacks;
  }

  damageZombie(
    zombie: Zombie,
    damage: number,
  ): { defeated: boolean; staggered: boolean } {
    const result = zombie.hit(damage);
    return result;
  }

  defeatAll(): number {
    let count = 0;
    for (const zombie of this.zombies) {
      if (!zombie.isDefeated()) {
        zombie.hit(99999);
        count += 1;
      }
    }
    return count;
  }

  private fillSpawns(
    rounds: RoundDirector,
    playerRoomId?: string | null,
  ): void {
    if (this.spawnCooldown > 0) return;
    const living = this.livingCount();
    const capacity = Math.max(0, CONCURRENT_ZOMBIE_CAP - living);
    const toSpawn = Math.min(1, capacity, rounds.spawnBudgetRemaining);
    if (toSpawn <= 0) return;

    const unlockedPoints = this.spawnPoints.filter((p) =>
      this.unlockedZones.has(p.zone),
    );
    const localPoints = playerRoomId
      ? unlockedPoints.filter((point) => point.roomId === playerRoomId)
      : [];
    const adjacentRoomIds = playerRoomId
      ? this.adjacentOpenRoomIds(playerRoomId)
      : [];
    const adjacentPoints =
      adjacentRoomIds.length > 0
        ? unlockedPoints.filter(
            (point) => point.roomId && adjacentRoomIds.includes(point.roomId),
          )
        : [];
    // Prefer the player's room, then ready-adjacent rooms so cross-map pursuit
    // is exercised once doorway residency opens, then any unlocked spawn.
    const points =
      localPoints.length > 0
        ? localPoints
        : adjacentPoints.length > 0
          ? adjacentPoints
          : unlockedPoints;
    if (points.length === 0) return;

    let spawned = 0;
    const attempts = this.mapsFullMapPursuit
      ? Math.min(points.length, 4)
      : toSpawn;
    for (let i = 0; i < attempts && spawned < toSpawn; i += 1) {
      const point = points[this.spawnCursor % points.length];
      this.spawnCursor += 1;
      if (!point) break;
      const archetype = zombieArchetypeForSpawn(
        rounds.round,
        this.spawnSequence,
      );
      const route = this.computeEntryRoute(point);
      let outside = route.outside;
      let inside = route.inside;
      // Maps Outbreak seats outside+landing on the same navmesh pad. Prefer
      // direct interior spawn so the horde can chase across the full footprint
      // instead of stalling on cosmetic barrier crawls.
      const preferDirect = this.mapsFullMapPursuit;
      if (!this.campusNavigation.canCommitEntry(inside, this.zombies)) {
        if (!this.mapsFullMapPursuit) return;
        const openLanding = this.findOpenLanding(inside);
        if (!openLanding) continue;
        inside = openLanding;
        outside = openLanding;
      }
      this.spawnSequence += 1;
      const recycled =
        this.zombies.find(
          (zombie) =>
            zombie.readyForRecycle && zombie.archetype === archetype,
        ) ?? this.zombies.find((zombie) => zombie.readyForRecycle);
      if (recycled) {
        const needsNewMintVisual = recycled.archetype !== archetype;
        recycled.reset(preferDirect ? inside : outside, rounds.round, archetype);
        if (preferDirect) {
          this.admitMapsInterior(recycled, inside, point.roomId);
        } else {
          recycled.beginBarrierEntry(outside, inside, route.barrierId);
          this.campusNavigation.registerSpawn(recycled, outside);
        }
        if (needsNewMintVisual) void this.attachMint(recycled, archetype);
        spawned += 1;
        continue;
      }
      const zombie = new Zombie(
        `z-${this.nextId++}`,
        (preferDirect ? inside : outside).clone(),
        rounds.round,
        archetype,
        this.visibleFallbacksAllowed,
      );
      if (preferDirect) {
        this.admitMapsInterior(zombie, inside, point.roomId);
      } else {
        zombie.beginBarrierEntry(outside, inside, route.barrierId);
        this.campusNavigation.registerSpawn(zombie, outside);
      }
      this.scene?.add(zombie.group);
      this.zombies.push(zombie);
      void this.attachMint(zombie, archetype);
      spawned += 1;
    }
    if (spawned > 0) {
      rounds.notifySpawned(spawned);
      this.spawnCooldown = SPAWN_INTERVAL;
    }
  }

  private admitMapsInterior(
    zombie: Zombie,
    landing: THREE.Vector3,
    roomId?: string,
  ): void {
    zombie.setFootPosition(landing.x, landing.y, landing.z);
    this.campusNavigation.registerSpawn(zombie, landing);
    this.campusNavigation.assignRoom(zombie, roomId);
  }

  private findOpenLanding(preferred: THREE.Vector3): THREE.Vector3 | null {
    const offsets = [
      [0, 0],
      [1.2, 0],
      [-1.2, 0],
      [0, 1.2],
      [0, -1.2],
      [1.6, 1.6],
      [-1.6, 1.6],
      [1.6, -1.6],
      [-1.6, -1.6],
      [2.4, 0],
      [-2.4, 0],
      [0, 2.4],
      [0, -2.4],
    ] as const;
    for (const [dx, dz] of offsets) {
      const candidate = preferred.clone();
      candidate.x += dx;
      candidate.z += dz;
      if (this.campusNavigation.canCommitEntry(candidate, this.zombies)) {
        return candidate;
      }
    }
    return null;
  }

  private adjacentOpenRoomIds(playerRoomId: string): string[] {
    return this.campusNavigation.openNeighborRoomIds(playerRoomId);
  }

  private computeEntryRoute(point: ZombieSpawnPoint): {
    outside: THREE.Vector3;
    inside: THREE.Vector3;
    barrierId?: string;
  } {
    if (point.outsidePosition && point.landingPosition) {
      return {
        outside: point.outsidePosition.clone(),
        inside: point.landingPosition.clone(),
        barrierId: point.barrierId,
      };
    }
    const inward = this.entryTarget.clone().sub(point.position);
    inward.y = 0;
    if (inward.lengthSq() < 1e-4) {
      inward.set(0, 0, 1);
    } else {
      inward.normalize();
    }
    const outside = point.position.clone().addScaledVector(inward, -0.95);
    outside.y = point.position.y;
    const inside = point.position.clone().addScaledVector(inward, 1.15);
    inside.y = point.position.y;
    return {
      outside,
      inside,
      barrierId: point.barrierId,
    };
  }

  private async attachMint(
    zombie: Zombie,
    archetype: ZombieArchetype,
  ): Promise<void> {
    if (!this.mintFactory) return;
    try {
      const loaded = await this.mintFactory(archetype);
      if (
        loaded &&
        !zombie.isDefeated() &&
        zombie.archetype === archetype
      ) {
        zombie.attachMintVisual(loaded.visual, loaded.clips);
      } else if (!loaded && !this.visibleFallbacksAllowed) {
        this.rejectMissingMintVisual(zombie);
      }
    } catch {
      if (!this.visibleFallbacksAllowed) {
        this.rejectMissingMintVisual(zombie);
      }
    }
  }

  private rejectMissingMintVisual(zombie: Zombie): void {
    if (zombie.isDefeated()) return;
    zombie.markMintUnavailable();
    this.pendingMintFailures += 1;
    this.mintAttachFailures += 1;
  }
}
