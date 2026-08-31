import * as THREE from 'three';
import {
  zombieAttackDamage,
  zombieHealthForRound,
  ZOMBIE_PRESENTATION_SCALE,
  zombieSpeedForRound,
  type ZombieArchetype,
} from './zombiesData';
import {
  headfrontYawCorrectionToWorldTarget,
  measureHeadfrontDotActorForward,
  measureHeadfrontDotWorldTarget,
} from '../assets/mintCharacterFacing';
import { ZOMBIE_SILHOUETTE_ATTACHMENT } from './ZombiePresentation';

export type ZombieState =
  | 'outside-spawn'
  | 'crawling'
  | 'entry-commit'
  | 'pursue'
  | 'attack'
  | 'stagger'
  | 'defeated';

export type ZombieAttackEvent = {
  zombie: Zombie;
  damage: number;
};

export type ZombieEntryEvent = {
  barrierId?: string;
  landing: THREE.Vector3;
};

export type ZombieMovementIntent = {
  /** Canonical world-space point the feet should move toward this frame. */
  target: THREE.Vector3;
  /** Used for portal approaches, where stopping at attack range would deadlock. */
  stopDistance?: number;
  /** False while the player is in a different logical splat room. */
  allowAttack?: boolean;
};

const ENTRY_DURATION = 1.45;
const CORPSE_SETTLE_DELAY = 0.18;
const CORPSE_GROUNDING_WINDOW = 1.25;
const CORPSE_LINGER_DURATION = 1.6;
const HEAD_HIT_PROXY_RADIUS = 0.2;
// Shared across the horde and actor recycling so round restarts do not leak a
// geometry/material pair per zombie.
const HEAD_HIT_PROXY_GEOMETRY = new THREE.SphereGeometry(
  HEAD_HIT_PROXY_RADIUS,
  10,
  8,
);
const BODY_HIT_PROXY_GEOMETRY = new THREE.BoxGeometry(0.68, 1.15, 0.44);
const HEAD_HIT_PROXY_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
  toneMapped: false,
});
const hitProxyWorldPosition = new THREE.Vector3();

export class Zombie {
  readonly group = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  state: ZombieState = 'outside-spawn';
  health: number;
  readonly id: string;
  archetype: ZombieArchetype;
  round: number;

  private speed: number;
  private baseY: number;
  private stateTime = 0;
  private attackCooldown = 0;
  private attackDamage: number;
  private mintVisual: THREE.Object3D | null = null;
  private placeholder: THREE.Group | null = null;
  private headHitProxy: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null =
    null;
  private bodyHitProxy: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null =
    null;
  private headProxyAnchor: THREE.Object3D | null = null;
  private bob = 0;
  private animationMixer: THREE.AnimationMixer | null = null;
  private readonly animationActions = new Map<string, THREE.AnimationAction>();
  private activeAnimation: string | null = null;
  private defeatAnimationDuration = 0;
  private defeatElapsed = 0;
  private corpseSettled = false;
  private entryFrom: THREE.Vector3 | null = null;
  private entryTo: THREE.Vector3 | null = null;
  private entryBarrierId: string | null = null;
  private pendingEntryEvent: ZombieEntryEvent | null = null;
  private readonly faceDirection = new THREE.Vector3();
  private readonly moveScratch = new THREE.Vector3();

  constructor(
    id: string,
    position: THREE.Vector3,
    round: number,
    archetype: ZombieArchetype,
    allowPlaceholder = true,
  ) {
    this.id = id;
    this.round = round;
    this.archetype = archetype;
    this.health = zombieHealthForRound(round, archetype);
    this.speed = zombieSpeedForRound(round, archetype);
    this.attackDamage = zombieAttackDamage(round, archetype);
    this.group.position.copy(position);
    this.baseY = position.y;
    this.group.name = `zombie-${id}`;
    this.group.userData.zombieId = id;
    this.group.userData.zombieArchetype = archetype;
    this.group.userData.presentationScale = ZOMBIE_PRESENTATION_SCALE;
    if (allowPlaceholder) this.buildPlaceholder();
    this.state = 'outside-spawn';
  }

  beginBarrierEntry(
    from: THREE.Vector3,
    to: THREE.Vector3,
    barrierId?: string,
  ): void {
    this.entryFrom = from.clone();
    this.entryTo = to.clone();
    this.entryBarrierId = barrierId ?? null;
    this.pendingEntryEvent = null;
    this.group.position.copy(from);
    this.baseY = from.y;
    this.state = 'outside-spawn';
    this.stateTime = 0;
    const dir = to.clone().sub(from);
    dir.y = 0;
    if (dir.lengthSq() > 1e-6) {
      dir.normalize();
      this.group.rotation.y = Math.atan2(dir.x, dir.z);
    }
    this.playAnimation('spawn_climb', true);
  }

  consumeEntryEvent(): ZombieEntryEvent | null {
    const event = this.pendingEntryEvent;
    this.pendingEntryEvent = null;
    return event;
  }

  attachMintVisual(
    visual: THREE.Object3D,
    clips: Record<string, THREE.AnimationClip> = {},
  ): void {
    if (this.placeholder) {
      this.group.remove(this.placeholder);
      this.placeholder = null;
    }
    this.mintVisual?.removeFromParent();
    this.mintVisual = visual;
    this.mintVisual.scale.multiplyScalar(ZOMBIE_PRESENTATION_SCALE);
    this.mintVisual.userData.presentationScale = ZOMBIE_PRESENTATION_SCALE;
    // Preserve clip-facing yaw offset applied by the Mint factory.
    this.group.add(visual);
    this.hitTargets.length = 0;
    visual.traverse((obj) => {
      obj.userData.zombieId = this.id;
      obj.userData.zombieArchetype = this.archetype;
      if ((obj as THREE.Mesh).isMesh) {
        if (obj.userData[ZOMBIE_SILHOUETTE_ATTACHMENT]) return;
        obj.userData.hitZone = /head|face|skull/i.test(obj.name)
          ? 'head'
          : 'body';
        this.hitTargets.push(obj);
      }
    });
    if (this.hitTargets.length === 0) this.hitTargets.push(visual);
    this.attachBodyHitProxy();
    this.attachHeadHitProxy(visual);

    this.animationMixer = new THREE.AnimationMixer(visual);
    this.animationActions.clear();
    this.activeAnimation = null;
    for (const [semantic, clip] of Object.entries(clips)) {
      const action = this.animationMixer.clipAction(clip);
      action.enabled = true;
      const once = ['attack', 'stagger', 'defeat', 'spawn_climb'].includes(semantic);
      action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      action.clampWhenFinished = once;
      this.animationActions.set(semantic, action);
      if (semantic === 'defeat') {
        this.defeatAnimationDuration = Math.max(0.1, clip.duration);
      }
    }
    if (
      this.state === 'outside-spawn' ||
      this.state === 'crawling' ||
      this.state === 'entry-commit'
    ) {
      this.playAnimation('spawn_climb', true);
    } else {
      this.playAnimation(this.sprinter ? 'run_forward' : 'walk_forward', true);
    }
    this.animationMixer.update(0.016);
  }

  update(
    delta: number,
    playerPosition: THREE.Vector3,
    sampleFootY?: (x: number, z: number, preferY: number) => number,
    movementIntent?: ZombieMovementIntent,
  ): ZombieAttackEvent | null {
    if (this.state === 'defeated') {
      this.defeatElapsed += delta;
      this.animationMixer?.update(delta);
      this.syncHeadHitProxy();
      const settleAt =
        Math.max(0.1, this.defeatAnimationDuration) + CORPSE_SETTLE_DELAY;
      if (
        this.defeatElapsed >= settleAt &&
        (!this.corpseSettled ||
          this.defeatElapsed <= settleAt + CORPSE_GROUNDING_WINDOW)
      ) {
        this.settleCorpseOnFloor();
      }
      return null;
    }
    // Production Zombies mode forbids visible procedural stand-ins. Until the
    // finalized Mint visual is attached, keep the actor inert and unhittable
    // instead of advancing an invisible enemy toward the player.
    if (!this.mintVisual && !this.placeholder) return null;
    this.stateTime += delta;
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.animationMixer?.update(delta);
    this.syncHeadHitProxy();

    if (
      this.state === 'outside-spawn' ||
      this.state === 'crawling' ||
      this.state === 'entry-commit'
    ) {
      return this.updateEntry(delta, sampleFootY);
    }

    this.faceWorldTarget(playerPosition);
    if (this.state === 'stagger') {
      this.playAnimation('stagger');
      if (this.stateTime > 0.45) {
        this.state = 'pursue';
        this.stateTime = 0;
      }
      return null;
    }

    const movementTarget = movementIntent?.target ?? playerPosition;
    const stopDistance = Math.max(0.04, movementIntent?.stopDistance ?? 1.2);
    const allowAttack = movementIntent?.allowAttack ?? true;
    const toTarget = this.moveScratch
      .copy(movementTarget)
      .sub(this.group.position);
    toTarget.y = 0;
    const targetDistance = toTarget.length();
    if (targetDistance > 0.001) {
      const dir = toTarget.normalize();
      if (targetDistance > stopDistance + 0.12) {
        this.state = 'pursue';
        const step = Math.min(
          targetDistance - stopDistance,
          this.speed * delta,
        );
        this.group.position.x += dir.x * step;
        this.group.position.z += dir.z * step;
        if (!this.animationMixer) {
          this.bob += delta * (this.sprinter ? 12 : 8);
          this.group.position.y = this.baseY + Math.sin(this.bob) * 0.04;
        } else {
          this.group.position.y = this.baseY;
          this.playAnimation(this.sprinter ? 'run_forward' : 'walk_forward');
        }
      } else if (allowAttack) {
        this.state = 'attack';
        this.group.position.y = this.baseY;
        this.playAnimation('attack');
      } else {
        this.state = 'pursue';
        this.group.position.y = this.baseY;
        this.playAnimation(this.sprinter ? 'run_forward' : 'walk_forward');
      }
    }

    if (sampleFootY) {
      this.baseY = sampleFootY(
        this.group.position.x,
        this.group.position.z,
        this.baseY,
      );
      if (this.state !== 'pursue' || this.animationMixer) {
        this.group.position.y = this.baseY;
      }
    }

    const playerDistance = Math.hypot(
      playerPosition.x - this.group.position.x,
      playerPosition.z - this.group.position.z,
    );
    if (
      allowAttack &&
      this.state === 'attack' &&
      this.attackCooldown <= 0 &&
      playerDistance <= 1.7
    ) {
      this.attackCooldown = 1.05;
      this.stateTime = 0;
      this.playAnimation('attack', true);
      return { zombie: this, damage: this.attackDamage };
    }
    return null;
  }

  hit(damage: number): { defeated: boolean; staggered: boolean } {
    if (this.state === 'defeated') return { defeated: false, staggered: false };
    if (
      this.state === 'outside-spawn' ||
      this.state === 'crawling' ||
      this.state === 'entry-commit'
    ) {
      return { defeated: false, staggered: false };
    }
    this.health -= damage;
    if (this.health <= 0) {
      this.state = 'defeated';
      this.stateTime = 0;
      this.defeatElapsed = 0;
      this.corpseSettled = false;
      this.entryFrom = null;
      this.entryTo = null;
      this.playAnimation('defeat', true);
      if (!this.animationActions.has('defeat')) {
        this.group.rotation.z = -1.2;
        this.group.position.y = this.baseY - 0.15;
        this.corpseSettled = true;
      }
      return { defeated: true, staggered: false };
    }
    // Interrupt window climb so hits feel responsive.
    this.entryFrom = null;
    this.entryTo = null;
    this.state = 'stagger';
    this.stateTime = 0;
    this.playAnimation('stagger', true);
    return { defeated: false, staggered: true };
  }

  isDefeated(): boolean {
    return this.state === 'defeated';
  }

  get hasMintVisual(): boolean {
    return this.mintVisual !== null;
  }

  get sprinter(): boolean {
    return this.archetype === 'sprinter';
  }

  get hasPlaceholderVisual(): boolean {
    return this.placeholder !== null;
  }

  markMintUnavailable(): void {
    this.state = 'defeated';
    this.health = 0;
    this.group.visible = false;
    this.group.removeFromParent();
  }

  get headfrontDotActorForward(): number | null {
    this.animationMixer?.update(0);
    this.group.updateWorldMatrix(true, true);
    return measureHeadfrontDotActorForward(this.group, this.group.rotation.y);
  }

  get visualYaw(): number {
    return this.mintVisual?.rotation.y ?? 0;
  }

  get headTargetWorld(): { x: number; y: number; z: number } | null {
    if (!this.headHitProxy) return null;
    this.syncHeadHitProxy();
    this.group.updateWorldMatrix(true, true);
    const position = this.headHitProxy.getWorldPosition(new THREE.Vector3());
    return { x: position.x, y: position.y, z: position.z };
  }

  get presentationBounds(): {
    minY: number;
    maxY: number;
    height: number;
  } | null {
    const visual = this.mintVisual ?? this.placeholder;
    if (!visual) return null;
    this.group.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(visual, true);
    if (bounds.isEmpty()) return null;
    return {
      minY: bounds.min.y,
      maxY: bounds.max.y,
      height: bounds.max.y - bounds.min.y,
    };
  }

  setEvidenceAnimation(semantic: string, time = 0.35): void {
    const action = this.animationActions.get(semantic);
    if (!action || !this.animationMixer) return;
    for (const candidate of new Set(this.animationActions.values())) {
      candidate.stop();
    }
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    action.time = THREE.MathUtils.clamp(
      time,
      0,
      Math.max(0, action.getClip().duration - 0.001),
    );
    this.activeAnimation = semantic;
    this.animationMixer.update(0);
    this.group.updateWorldMatrix(true, true);
  }

  get deathAnimation(): string | null {
    return this.state === 'defeated' ? this.activeAnimation : null;
  }

  get deathAnimationSeconds(): number {
    return this.defeatAnimationDuration;
  }

  get deathElapsedSeconds(): number {
    return this.defeatElapsed;
  }

  get deathSettled(): boolean {
    return this.corpseSettled;
  }

  get readyForRecycle(): boolean {
    return (
      this.corpseSettled &&
      this.defeatElapsed >=
        Math.max(0.1, this.defeatAnimationDuration) +
          CORPSE_SETTLE_DELAY +
          CORPSE_LINGER_DURATION
    );
  }

  get deathVisualBounds(): {
    minY: number;
    maxY: number;
    height: number;
    floorError: number;
  } | null {
    if (!this.mintVisual) return null;
    const bounds = this.computeMintVisualBounds();
    if (!bounds) return null;
    if (!Number.isFinite(bounds.min.y) || !Number.isFinite(bounds.max.y)) {
      return null;
    }
    return {
      minY: bounds.min.y,
      maxY: bounds.max.y,
      height: bounds.max.y - bounds.min.y,
      floorError: bounds.min.y - this.baseY,
    };
  }

  setFootPosition(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z);
    this.baseY = y;
    this.entryFrom = null;
    this.entryTo = null;
    if (
      this.state === 'outside-spawn' ||
      this.state === 'crawling' ||
      this.state === 'entry-commit'
    ) {
      this.state = 'pursue';
      this.stateTime = 0;
    }
  }

  commitResolvedPosition(position: THREE.Vector3): void {
    this.group.position.copy(position);
    this.baseY = position.y;
  }

  finishEntryCommit(): boolean {
    if (this.state !== 'entry-commit') return false;
    this.entryFrom = null;
    this.entryTo = null;
    this.entryBarrierId = null;
    this.state = 'pursue';
    this.stateTime = 0;
    this.playAnimation(this.sprinter ? 'run_forward' : 'walk_forward', true);
    return true;
  }

  facingPlayerDot(playerPosition: THREE.Vector3): number {
    return measureHeadfrontDotWorldTarget(
      this.group,
      playerPosition,
      this.group.rotation.y,
    );
  }

  reset(
    position: THREE.Vector3,
    round: number,
    archetype: ZombieArchetype,
  ): void {
    this.round = round;
    this.archetype = archetype;
    this.health = zombieHealthForRound(round, archetype);
    this.speed = zombieSpeedForRound(round, archetype);
    this.attackDamage = zombieAttackDamage(round, archetype);
    this.group.position.copy(position);
    this.group.userData.zombieArchetype = archetype;
    this.baseY = position.y;
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.state = 'outside-spawn';
    this.stateTime = 0;
    this.defeatElapsed = 0;
    this.corpseSettled = false;
    this.attackCooldown = 0.4;
    this.entryFrom = null;
    this.entryTo = null;
    this.entryBarrierId = null;
    this.pendingEntryEvent = null;
  }

  /**
   * Keep the final authored Mint knock-down pose clamped, then remove only the
   * small vertical drift introduced by the animation so the corpse rests on
   * the same sampled floor used by locomotion.
   */
  private settleCorpseOnFloor(): void {
    if (!this.corpseSettled) {
      this.group.position.y = this.baseY;
    }
    const bounds = this.computeMintVisualBounds();
    if (bounds && Number.isFinite(bounds.min.y)) {
      const correction = this.baseY - bounds.min.y;
      if (Math.abs(correction) <= 2.5) {
        this.group.position.y += correction;
      }
    }
    this.corpseSettled = true;
    this.group.updateWorldMatrix(true, true);
  }

  private computeMintVisualBounds(): THREE.Box3 | null {
    if (!this.mintVisual) return null;
    this.group.updateWorldMatrix(true, true);
    this.mintVisual.traverse((object) => {
      const skinned = object as THREE.SkinnedMesh;
      if (!skinned.isSkinnedMesh) return;
      skinned.skeleton.update();
      skinned.computeBoundingBox();
    });
    return new THREE.Box3().setFromObject(this.mintVisual, true);
  }

  private updateEntry(
    _delta: number,
    sampleFootY?: (x: number, z: number, preferY: number) => number,
  ): null {
    if (this.state === 'entry-commit') return null;
    if (this.state === 'outside-spawn') {
      this.state = 'crawling';
      this.stateTime = 0;
    }
    this.playAnimation('spawn_climb');
    const t = Math.min(1, this.stateTime / ENTRY_DURATION);
    const eased = t * t * (3 - 2 * t);
    if (this.entryFrom && this.entryTo) {
      this.group.position.lerpVectors(this.entryFrom, this.entryTo, eased);
      this.baseY = this.group.position.y;
      // Arc over the window sill so the climb reads clearly.
      this.group.position.y = this.baseY + Math.sin(t * Math.PI) * 0.42;
      const dir = this.entryTo.clone().sub(this.entryFrom);
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        this.group.rotation.y = Math.atan2(dir.x, dir.z);
      }
    }
    if (t >= 1) {
      if (this.entryTo) {
        this.group.position.copy(this.entryTo);
        this.baseY = this.entryTo.y;
      }
      if (sampleFootY) {
        this.baseY = sampleFootY(
          this.group.position.x,
          this.group.position.z,
          this.baseY,
        );
        this.group.position.y = this.baseY;
      }
      this.pendingEntryEvent = {
        barrierId: this.entryBarrierId ?? undefined,
        landing: this.group.position.clone(),
      };
      this.state = 'entry-commit';
      this.stateTime = 0;
    }
    return null;
  }

  faceWorldTarget(playerPosition: THREE.Vector3): void {
    const direction = this.faceDirection
      .copy(playerPosition)
      .sub(this.group.position);
    direction.y = 0;
    if (direction.lengthSq() <= 1e-8) return;
    direction.normalize();
    this.group.rotation.y = Math.atan2(direction.x, direction.z);
    const visibleCorrection = headfrontYawCorrectionToWorldTarget(
      this.group,
      playerPosition,
    );
    if (visibleCorrection !== null) {
      const corrected = this.group.rotation.y + visibleCorrection;
      this.group.rotation.y = Math.atan2(Math.sin(corrected), Math.cos(corrected));
      this.group.updateWorldMatrix(true, true);
    }
  }

  private playAnimation(semantic: string, force = false): void {
    if (!this.animationMixer) return;
    const fallback =
      this.animationActions.get(semantic) ??
      this.animationActions.get('idle') ??
      this.animationActions.get('walk_forward') ??
      this.animationActions.values().next().value;
    if (!fallback) return;
    const key =
      this.animationActions.has(semantic)
        ? semantic
        : this.animationActions.has('idle')
          ? 'idle'
          : [...this.animationActions.keys()][0]!;
    if (!force && this.activeAnimation === key) return;
    const next = this.animationActions.get(key);
    if (!next) return;
    if (this.activeAnimation && this.activeAnimation !== key) {
      this.animationActions.get(this.activeAnimation)?.fadeOut(0.15);
    }
    next.reset().fadeIn(0.15).play();
    this.activeAnimation = key;
  }

  /**
   * Mint zombies commonly use one skinned body mesh, so mesh names alone
   * cannot expose a raycastable head zone. Keep a transparent-but-visible
   * world-scale proxy that follows the animated Head bone. `visible` must
   * remain true because the ballistic integration intentionally filters hidden
   * objects. The proxy stays under the zombie root so arbitrary GLB/Bone scale
   * cannot collapse its raycast radius.
   */
  private attachHeadHitProxy(visual: THREE.Object3D): void {
    const headCandidates: THREE.Object3D[] = [];
    const headfrontCandidates: THREE.Object3D[] = [];
    visual.updateWorldMatrix(true, true);
    visual.traverse((object) => {
      const normalized = object.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalized.includes('headfront')) headfrontCandidates.push(object);
      if (
        !normalized.includes('headfront') &&
        (normalized === 'head' || normalized.endsWith('head'))
      ) {
        headCandidates.push(object);
      }
    });
    const headfront = headfrontCandidates[0] ?? null;
    headCandidates.sort(
      (left, right) =>
        Number((right as THREE.Bone).isBone) - Number((left as THREE.Bone).isBone),
    );
    let head = headCandidates[0] ?? null;
    if (!head && headfront?.parent) head = headfront.parent;

    if (!this.headHitProxy) {
      this.headHitProxy = new THREE.Mesh(
        HEAD_HIT_PROXY_GEOMETRY,
        HEAD_HIT_PROXY_MATERIAL,
      );
      this.headHitProxy.name = 'zombie-head-hit-proxy';
      this.headHitProxy.frustumCulled = false;
    }
    const proxy = this.headHitProxy;
    proxy.removeFromParent();
    proxy.visible = true;
    proxy.position.set(0, 0, 0);
    proxy.scale.setScalar(ZOMBIE_PRESENTATION_SCALE);
    proxy.userData.zombieId = this.id;
    proxy.userData.zombieArchetype = this.archetype;
    proxy.userData.hitZone = 'head';

    if (head) {
      this.headProxyAnchor = headfront ?? head;
      this.group.add(proxy);
      this.syncHeadHitProxy();
      proxy.userData.headProxyAnchor = head.name || 'head';
    } else {
      // Rig-name fallback: derive a stable upper-body target from visual bounds.
      const bounds = new THREE.Box3().setFromObject(visual, true);
      const targetWorld = bounds.getCenter(new THREE.Vector3());
      targetWorld.y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, 0.88);
      this.headProxyAnchor = null;
      this.group.add(proxy);
      this.group.updateWorldMatrix(true, false);
      proxy.position.copy(this.group.worldToLocal(targetWorld));
      proxy.userData.headProxyAnchor = 'bounds-fallback';
    }
    this.hitTargets.push(proxy);
  }

  private syncHeadHitProxy(): void {
    const proxy = this.headHitProxy;
    const anchor = this.headProxyAnchor;
    if (!proxy || !anchor) return;
    anchor.getWorldPosition(hitProxyWorldPosition);
    this.group.updateWorldMatrix(true, false);
    proxy.position.copy(this.group.worldToLocal(hitProxyWorldPosition));
    proxy.scale.setScalar(ZOMBIE_PRESENTATION_SCALE);
    proxy.updateWorldMatrix(false, false);
  }

  private attachBodyHitProxy(): void {
    if (!this.bodyHitProxy) {
      this.bodyHitProxy = new THREE.Mesh(
        BODY_HIT_PROXY_GEOMETRY,
        HEAD_HIT_PROXY_MATERIAL,
      );
      this.bodyHitProxy.name = 'zombie-body-hit-proxy';
      this.bodyHitProxy.frustumCulled = false;
    }
    const proxy = this.bodyHitProxy;
    proxy.removeFromParent();
    proxy.visible = true;
    proxy.position.set(0, ZOMBIE_PRESENTATION_SCALE, 0);
    const widthScale =
      this.archetype === 'brute' ? 1.2 : this.archetype === 'sprinter' ? 0.9 : 1;
    proxy.scale.set(
      widthScale * ZOMBIE_PRESENTATION_SCALE,
      (this.archetype === 'brute' ? 1.15 : 1) * ZOMBIE_PRESENTATION_SCALE,
      widthScale * ZOMBIE_PRESENTATION_SCALE,
    );
    proxy.userData.zombieId = this.id;
    proxy.userData.zombieArchetype = this.archetype;
    proxy.userData.hitZone = 'body';
    this.group.add(proxy);
    this.hitTargets.push(proxy);
  }

  private buildPlaceholder(): void {
    const body = new THREE.Group();
    body.name = 'mint-placeholder-zombie';
    const color =
      this.archetype === 'sprinter'
        ? '#6b3a2e'
        : this.archetype === 'brute'
          ? '#3d3029'
          : '#4a2f2a';
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      metalness: 0.05,
    });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8), mat);
    torso.position.y = 1.0;
    torso.castShadow = true;
    torso.name = 'zombie-torso';
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), mat);
    head.position.y = 1.65;
    head.castShadow = true;
    head.name = 'zombie-head';
    torso.userData.hitZone = 'body';
    head.userData.hitZone = 'head';
    body.add(torso, head);
    body.scale.setScalar(ZOMBIE_PRESENTATION_SCALE);
    body.userData.presentationScale = ZOMBIE_PRESENTATION_SCALE;
    this.placeholder = body;
    this.group.add(body);
    this.hitTargets.push(torso, head);
  }
}
