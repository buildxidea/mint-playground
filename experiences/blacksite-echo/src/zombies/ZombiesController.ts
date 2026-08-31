import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import type { PlayerController } from '../player/PlayerController';
import type { ZombiesResult } from '../game/types';
import {
  BuyableRegistry,
  type RoomNavigationState,
} from './BuyableRegistry';
import { HordeDirector } from './HordeDirector';
import { MysteryBox } from './MysteryBox';
import { PackAPunch } from './PackAPunch';
import { PerkSystem } from './PerkSystem';
import { PointsEconomy } from './PointsEconomy';
import { PowerUpSystem, type PowerUpHudState } from './PowerUpSystem';
import { RoundDirector } from './RoundDirector';
import { ZombiesArena } from './ZombiesArena';
import type { ZombiesInteractableVisualId } from './ZombiesArena';
import {
  LAST_STAND_SECONDS,
  STARTING_POINTS,
  type PerkId,
  type ZombieArchetype,
} from './zombiesData';

export type ZombiesHudState = {
  round: number;
  points: number;
  prompt: string;
  progress: number;
  perks: PerkId[];
  powerUpBanner: string;
  powerUps: PowerUpHudState;
  lastStand: boolean;
  lastStandProgress: number;
  powerOn: boolean;
  boxSpinning: boolean;
};

export type ZombiesControllerCallbacks = {
  grantWeapon: (weaponId: string, ammoOnly: boolean) => void;
  refillAllAmmo: () => void;
  upgradeWeapon: (weaponId: string) => void;
  getHeldWeaponId: () => string;
  onRoundStart: (round: number) => void;
  onPurchase: () => void;
  onPowerOn: () => void;
  onBoxSpin: () => void;
  onPowerUp: () => void;
  onZombieAttack: () => void;
  onZombieDeath: () => void;
  onGameOver: (result: ZombiesResult) => void;
};

export const ZOMBIE_HEADSHOT_DAMAGE_MULTIPLIER = 2.25;

export type ZombieHitContext = {
  knife?: boolean;
  headshot?: boolean;
};

export class ZombiesController {
  readonly arena = new ZombiesArena();
  readonly economy = new PointsEconomy();
  readonly rounds = new RoundDirector();
  readonly horde = new HordeDirector();
  readonly buyables = new BuyableRegistry();
  readonly powerUps = new PowerUpSystem();
  readonly box = new MysteryBox(2);
  readonly perks = new PerkSystem();
  readonly packAPunch = new PackAPunch();

  kills = 0;
  lastStand = false;
  private lastStandTimer = 0;
  private startedAt = 0;
  private active = false;
  private callbacks: ZombiesControllerCallbacks | null = null;
  private rng = Math.random;

  setCallbacks(callbacks: ZombiesControllerCallbacks): void {
    this.callbacks = callbacks;
  }

  setRandomSource(random: () => number): void {
    this.rng = random;
  }

  start(scene: THREE.Scene): void {
    this.active = true;
    this.kills = 0;
    this.lastStand = false;
    this.lastStandTimer = 0;
    this.startedAt = performance.now();
    this.economy.reset(STARTING_POINTS);
    this.rounds.reset();
    this.horde.reset();
    this.buyables.reset();
    this.powerUps.reset();
    this.box.reset();
    this.perks.reset();
    this.packAPunch.reset();
    this.arena.resetInteractableVisuals();
    this.horde.setScene(scene);
    this.powerUps.setScene(scene);
    this.horde.setEntryTarget(this.arena.anchors.playerStart);
    this.horde.configureSpawnPoints(this.arena.anchors.spawnPoints);
    this.buyables.configure({
      wallBuys: this.arena.anchors.wallBuys,
      doors: this.arena.anchors.doors,
      barriers: this.arena.anchors.barriers,
      powerSwitch: this.arena.anchors.powerSwitchInteraction,
      mysteryBox: this.arena.anchors.mysteryBoxLocations[0]!.clone(),
      perks: this.arena.anchors.perks,
      packAPunch: this.arena.anchors.packAPunch,
    });
    // Maps Outbreak has no power-switch progression — unlock box immediately.
    if (this.arena.isMapsOutbreakActive()) {
      this.buyables.powerOn = true;
      this.arena.setPowerVisual(true);
    } else {
      this.arena.setPowerVisual(false);
    }
    this.horde.setBarrierBreachHandler((barrierId) => {
      this.buyables.damageBarrier(barrierId, 1);
    });
    for (const event of this.rounds.begin()) {
      if (event.type === 'round-start') this.callbacks?.onRoundStart(event.round);
    }
  }

  getHudState(): ZombiesHudState {
    return {
      round: this.rounds.round,
      points: this.economy.points,
      prompt: this.buyables.interactionPrompt,
      progress: this.buyables.interactionProgress,
      perks: this.perks.list(),
      powerUpBanner: this.powerUps.activeBanner,
      powerUps: this.powerUps.getHudState(),
      lastStand: this.lastStand,
      lastStandProgress: this.lastStand
        ? 1 - this.lastStandTimer / LAST_STAND_SECONDS
        : 0,
      powerOn: this.buyables.powerOn,
      boxSpinning: this.box.state === 'spinning',
    };
  }

  getRoomNavigation(playerPosition: THREE.Vector3): RoomNavigationState {
    return this.buyables.getRoomNavigation(playerPosition);
  }

  update(
    delta: number,
    player: PlayerController,
    input: InputController,
    sampleFootY?: (x: number, z: number, preferY: number) => number,
    options?: {
      invulnerable?: boolean;
      playerRoomId?: string | null;
      hordeAlreadyUpdated?: boolean;
      interactionReserved?: boolean;
    },
  ): void {
    if (!this.active) return;

    if (this.lastStand) {
      this.lastStandTimer -= delta;
      if (this.lastStandTimer <= 0) {
        this.fail();
        return;
      }
      if (this.perks.canSelfRevive() && input.wasPressed('KeyE')) {
        this.selfRevive(player);
      } else if (this.perks.canSelfRevive() && this.lastStandTimer < LAST_STAND_SECONDS - 3.5) {
        this.selfRevive(player);
      }
    }

    for (const event of this.rounds.update(delta)) {
      if (event.type === 'round-start') this.callbacks?.onRoundStart(event.round);
    }

    if (!options?.hordeAlreadyUpdated) {
      this.updateHordeFixed(delta, player, sampleFootY, options);
    }

    this.economy.setDoublePoints(this.powerUps.doublePointsActive);

    if (options?.interactionReserved) {
      this.buyables.reserveInteraction(delta);
    } else {
      for (const event of this.buyables.update(
        delta,
        player.position,
        input,
        this.economy,
      )) {
        this.handleBuyable(event, player);
      }
    }
    this.arena.updateInteractableVisuals(delta);

    const boxEvent = this.box.update(delta);
    if (boxEvent?.type === 'grant') {
      this.callbacks?.grantWeapon(boxEvent.weaponId, false);
      this.buyables.markWeaponOwned(boxEvent.weaponId);
    } else if (boxEvent?.type === 'teddy-move') {
      const loc = this.arena.anchors.mysteryBoxLocations[boxEvent.locationIndex];
      if (loc) {
        this.buyables.setMysteryBoxPosition(loc);
        this.arena.moveMysteryBoxVisual(boxEvent.locationIndex);
      }
    }

    for (const event of this.powerUps.update(delta, player.position)) {
      if (event.type === 'pickup') this.callbacks?.onPowerUp();
      if (event.type === 'max-ammo') this.callbacks?.refillAllAmmo();
      if (event.type === 'nuke') {
        const defeated = this.horde.defeatAll();
        this.emitZombieDeathCues(defeated);
        this.kills += defeated;
        this.economy.awardMany('kill', defeated, 10);
        for (const roundEvent of this.rounds.notifyDefeated(defeated)) {
          if (roundEvent.type === 'round-clear') {
            /* intermission begins */
          }
        }
      }
      if (event.type === 'carpenter') this.buyables.repairAllBarriers();
      if (event.type === 'expired' && event.kind === 'double-points') {
        this.economy.setDoublePoints(false);
      }
    }
  }

  updateHordeFixed(
    delta: number,
    player: PlayerController,
    sampleFootY?: (x: number, z: number, preferY: number) => number,
    options?: { invulnerable?: boolean; playerRoomId?: string | null },
  ): void {
    if (!this.active) return;
    const attacks = this.horde.update(
      delta,
      player.position,
      this.rounds,
      sampleFootY,
      options?.playerRoomId,
    );
    for (const attack of attacks) {
      if (this.lastStand || options?.invulnerable) continue;
      this.callbacks?.onZombieAttack();
      player.damage(attack.damage);
      if (player.health <= 0) this.enterLastStand(player);
    }
  }

  onZombieDamaged(
    zombieId: string,
    damage: number,
    knifeOrContext: boolean | ZombieHitContext = false,
    legacyHeadshot = false,
  ): {
    defeated: boolean;
    points: number;
    appliedDamage: number;
    headshot: boolean;
  } {
    const zombie = this.horde.zombies.find((z) => z.id === zombieId);
    if (!zombie || zombie.isDefeated()) {
      return { defeated: false, points: 0, appliedDamage: 0, headshot: false };
    }
    const context: ZombieHitContext =
      typeof knifeOrContext === 'boolean'
        ? { knife: knifeOrContext, headshot: legacyHeadshot }
        : knifeOrContext;
    const knife = context.knife ?? false;
    const headshot = !knife && (context.headshot ?? false);
    const finiteDamage = Number.isFinite(damage) ? Math.max(0, damage) : 0;
    const applied = this.powerUps.instaKillActive && finiteDamage > 0
      ? 99999
      : finiteDamage * (headshot ? ZOMBIE_HEADSHOT_DAMAGE_MULTIPLIER : 1);
    const healthBefore = zombie.health;
    const result = this.horde.damageZombie(zombie, applied);
    const appliedDamage = Math.max(0, healthBefore - zombie.health);
    if (appliedDamage <= 0) {
      return { defeated: false, points: 0, appliedDamage: 0, headshot };
    }
    let points = this.economy.award(headshot ? 'headshot' : 'hit');
    if (result.defeated) {
      this.callbacks?.onZombieDeath();
      this.kills += 1;
      points += this.economy.award(knife ? 'knife' : 'kill');
      this.powerUps.onKill(zombie.group.position.clone(), this.rng);
      for (const event of this.rounds.notifyDefeated(1)) {
        void event;
      }
    }
    return { defeated: result.defeated, points, appliedDamage, headshot };
  }

  private handleBuyable(
    event: ReturnType<BuyableRegistry['update']>[number],
    player: PlayerController,
  ): void {
    this.callbacks?.onPurchase();
    switch (event.type) {
      case 'wall-buy':
        this.callbacks?.grantWeapon(event.weaponId, event.ammoOnly);
        break;
      case 'door':
        this.arena.openDoor(event.doorId);
        this.horde.unlockZone(event.unlocks);
        this.economy.award('door');
        break;
      case 'barrier-repair':
        this.economy.award('repair');
        break;
      case 'power-on':
        this.arena.setPowerVisual(true);
        this.callbacks?.onPowerOn();
        break;
      case 'power-retrigger':
        // Keep progression powered; replay the restore cue for the player.
        this.arena.setPowerVisual(true);
        this.callbacks?.onPowerOn();
        break;
      case 'mystery-box':
        this.callbacks?.onBoxSpin();
        this.box.startSpin(this.callbacks?.getHeldWeaponId());
        this.arena.activateInteractable('mystery-box');
        break;
      case 'perk':
        this.perks.purchase(event.perkId);
        this.buyables.markPerkOwned(event.perkId);
        player.health = Math.min(this.perks.maxHealth(), player.health + 50);
        this.arena.activateInteractable(`perk-${event.perkId}`);
        break;
      case 'pack-a-punch': {
        const held = this.callbacks?.getHeldWeaponId() ?? '';
        if (this.packAPunch.canUpgrade(held, true) && this.packAPunch.upgrade(held)) {
          this.callbacks?.upgradeWeapon(held);
          this.arena.activateInteractable('pack-a-punch');
        }
        break;
      }
      default:
        break;
    }
  }

  private enterLastStand(player: PlayerController): void {
    // Quick Pulse prevents one lethal hit before a down occurs. Without it,
    // zero health is immediately terminal; there is no delayed bleed-out state.
    if (this.perks.canSelfRevive()) {
      this.perks.consumeSelfRevive();
      this.lastStand = false;
      this.lastStandTimer = 0;
      player.health = this.perks.maxHealth();
      return;
    }
    this.lastStand = false;
    this.lastStandTimer = 0;
    player.health = 0;
    this.fail();
  }

  private selfRevive(player: PlayerController): void {
    if (!this.perks.canSelfRevive()) return;
    this.perks.consumeSelfRevive();
    this.lastStand = false;
    this.lastStandTimer = 0;
    player.health = this.perks.maxHealth();
  }

  private fail(): void {
    this.active = false;
    this.callbacks?.onGameOver({
      roundReached: this.rounds.round,
      kills: this.kills,
      points: this.economy.points,
      timeMs: performance.now() - this.startedAt,
    });
  }

  /** Test / debug helpers */
  grantPoints(amount: number): void {
    this.economy.points += amount;
  }

  forcePowerOn(): void {
    this.buyables.powerOn = true;
    this.arena.setPowerVisual(true);
    this.callbacks?.onPowerOn();
  }

  forceClearRound(): void {
    const living = this.horde.livingCount();
    this.horde.defeatAll();
    this.emitZombieDeathCues(living);
    this.kills += living;
    for (const event of this.rounds.forceClearForTest()) {
      void event;
    }
  }

  forceBeginNextRound(): void {
    const living = this.horde.livingCount();
    this.horde.defeatAll();
    this.emitZombieDeathCues(living);
    this.kills += living;
    this.horde.clearSpawnCooldown();
    for (const event of this.rounds.forceBeginNextRoundForTest()) {
      if (event.type === 'round-start') this.callbacks?.onRoundStart(event.round);
    }
  }

  forceLethalHitForTest(player: PlayerController): void {
    if (!this.active) return;
    player.armor = 0;
    player.health = 0;
    this.enterLastStand(player);
  }

  forceSpawnPowerUp(kind: import('./zombiesData').PowerUpKind): void {
    this.powerUps.spawnPickup(kind, this.arena.anchors.playerStart.clone().add(new THREE.Vector3(0, 0, 1.5)));
  }

  forcePurchasePerk(perkId: PerkId): void {
    this.perks.purchase(perkId);
    this.buyables.markPerkOwned(perkId);
    this.arena.activateInteractable(`perk-${perkId}`);
  }

  freezeInteractableAtPeak(id: ZombiesInteractableVisualId): boolean {
    return this.arena.freezeInteractableAtPeak(id);
  }

  getDebugSnapshot(): {
    round: number;
    points: number;
    powerOn: boolean;
    living: number;
    pendingSpawns: number;
    perks: PerkId[];
    kills: number;
    playerStart: { x: number; y: number; z: number };
    wallBuys: Array<{ id: string; x: number; y: number; z: number }>;
    mysteryBox: { x: number; y: number; z: number } | null;
    doors: Array<{ id: string; x: number; y: number; z: number }>;
    spawnPoints: Array<{
      id: string;
      zone: string;
      x: number;
      y: number;
      z: number;
      barrierId?: string;
      roomId?: string;
      outsidePosition?: { x: number; y: number; z: number };
      landingPosition?: { x: number; y: number; z: number };
    }>;
    barriers: Array<{ id: string; x: number; y: number; z: number }>;
    archetypeCounts: {
      shambler: number;
      sprinter: number;
      brute: number;
    };
    zombies: Array<{
      id: string;
      archetype: ZombieArchetype;
      state: string;
      health: number;
      x: number;
      y: number;
      z: number;
      hasMintVisual: boolean;
      hasPlaceholderVisual: boolean;
      headTarget: { x: number; y: number; z: number } | null;
      presentationBounds: {
        minY: number;
        maxY: number;
        height: number;
      } | null;
      deathAnimation: string | null;
      deathAnimationSeconds: number;
      deathElapsedSeconds: number;
      deathSettled: boolean;
      deathVisualBounds: {
        minY: number;
        maxY: number;
        height: number;
        floorError: number;
      } | null;
      navigation: {
        roomId: string | null;
        targetRoomId: string | null;
        nextRoomId: string | null;
        roomsVisited: string[];
        portalTransitions: number;
        distanceWalked: number;
        currentStuckSeconds: number;
        maxStuckSeconds: number;
        remainingPathDistance: number;
        noProgressSeconds: number;
        maxNoProgressSeconds: number;
        facingPlayerDot: number;
        minimumFacingPlayerDot: number;
        facingViolationSamples: number;
        coverageDistance: number;
        repathCount: number;
        recoveryCount: number;
        waypointCount: number;
        waypointIndex: number;
        coverageByRoom: Array<{
          roomId: string;
          minX: number;
          maxX: number;
          minZ: number;
          maxZ: number;
          spanX: number;
          spanZ: number;
        }>;
      };
    }>;
    proceduralFallbacks: number;
    mintAttachFailures: number;
    campusNavigation: {
      configured: boolean;
      roomCount: number;
      portalCount: number;
      playerRoomId: string | null;
      postEntryZombieOutsideCoverageCount: number;
    };
  } {
    return {
      round: this.rounds.round,
      points: this.economy.points,
      powerOn: this.buyables.powerOn,
      living: this.horde.livingCount(),
      pendingSpawns: this.rounds.spawnBudgetRemaining,
      perks: this.perks.list(),
      kills: this.kills,
      proceduralFallbacks: this.horde.proceduralFallbackCount,
      mintAttachFailures: this.horde.mintFailureCount,
      campusNavigation: this.horde.campusNavigation.diagnostics(),
      archetypeCounts: {
        shambler: this.horde.zombies.filter(
          (zombie) =>
            !zombie.isDefeated() && zombie.archetype === 'shambler',
        ).length,
        sprinter: this.horde.zombies.filter(
          (zombie) =>
            !zombie.isDefeated() && zombie.archetype === 'sprinter',
        ).length,
        brute: this.horde.zombies.filter(
          (zombie) =>
            !zombie.isDefeated() && zombie.archetype === 'brute',
        ).length,
      },
      playerStart: {
        x: this.arena.anchors.playerStart.x,
        y: this.arena.anchors.playerStart.y,
        z: this.arena.anchors.playerStart.z,
      },
      wallBuys: this.arena.anchors.wallBuys.map((wall) => ({
        id: wall.id,
        x: wall.position.x,
        y: wall.position.y,
        z: wall.position.z,
      })),
      mysteryBox: this.arena.anchors.mysteryBoxLocations[0]
        ? {
            x: this.arena.anchors.mysteryBoxLocations[0].x,
            y: this.arena.anchors.mysteryBoxLocations[0].y,
            z: this.arena.anchors.mysteryBoxLocations[0].z,
          }
        : null,
      doors: this.arena.anchors.doors.map((door) => ({
        id: door.id,
        x: door.position.x,
        y: door.position.y,
        z: door.position.z,
      })),
      spawnPoints: this.arena.anchors.spawnPoints.map((point) => ({
        id: point.id,
        zone: point.zone,
        x: point.position.x,
        y: point.position.y,
        z: point.position.z,
        barrierId: point.barrierId,
        roomId: point.roomId,
        outsidePosition: point.outsidePosition
          ? {
              x: point.outsidePosition.x,
              y: point.outsidePosition.y,
              z: point.outsidePosition.z,
            }
          : undefined,
        landingPosition: point.landingPosition
          ? {
              x: point.landingPosition.x,
              y: point.landingPosition.y,
              z: point.landingPosition.z,
            }
          : undefined,
      })),
      barriers: this.arena.anchors.barriers.map((barrier) => ({
        id: barrier.id,
        x: barrier.position.x,
        y: barrier.position.y,
        z: barrier.position.z,
      })),
      zombies: this.horde.zombies.map((zombie) => {
        const navigation = this.horde.campusNavigation.diagnosticsFor(zombie);
        return {
          id: zombie.id,
          archetype: zombie.archetype,
          state: zombie.state,
          health: zombie.health,
          x: zombie.group.position.x,
          y: zombie.group.position.y,
          z: zombie.group.position.z,
          hasMintVisual: zombie.hasMintVisual,
          hasPlaceholderVisual: zombie.hasPlaceholderVisual,
          headTarget: zombie.headTargetWorld,
          presentationBounds: zombie.presentationBounds,
          deathAnimation: zombie.deathAnimation,
          deathAnimationSeconds: zombie.deathAnimationSeconds,
          deathElapsedSeconds: zombie.deathElapsedSeconds,
          deathSettled: zombie.deathSettled,
          deathVisualBounds: zombie.deathVisualBounds,
          navigation,
        };
      }),
    };
  }

  private emitZombieDeathCues(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.callbacks?.onZombieDeath();
    }
  }
}
