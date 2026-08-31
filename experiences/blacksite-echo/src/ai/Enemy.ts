import * as THREE from 'three';
import { measureHeadfrontDotActorForward } from '../assets/mintCharacterFacing';
import type { Difficulty } from '../game/types';

export type EnemyRole = 'rifleman' | 'breacher' | 'suppressor';
export type EnemyState =
  | 'patrol'
  | 'suspicious'
  | 'investigate'
  | 'search'
  | 'cover'
  | 'flank'
  | 'firing'
  | 'suppressing'
  | 'stagger'
  | 'defeated';

export type EnemySpawn = {
  id: string;
  role: EnemyRole;
  segment: 0 | 1 | 2;
  position: THREE.Vector3;
  patrol: THREE.Vector3[];
};

export type EnemyFireEvent = {
  enemy: Enemy;
  suppressing: boolean;
};

type EnemyContext = {
  delta: number;
  elapsed: number;
  playerPosition: THREE.Vector3;
  canSeePlayer: boolean;
  heardPlayer: boolean;
  difficulty: Difficulty;
  coverNodes: THREE.Vector3[];
  rng: () => number;
  sampleFootY?: (x: number, z: number, preferY: number) => number;
};

const roleColors: Record<EnemyRole, string> = {
  rifleman: '#81312c',
  breacher: '#a34b24',
  suppressor: '#5e3030',
};
const weaponBasis = new THREE.Matrix4();
const weaponForward = new THREE.Vector3();
const weaponUp = new THREE.Vector3();
const weaponSide = new THREE.Vector3();
const actorForwardLocal = new THREE.Vector3(0, 0, 1);
const worldUpLocal = new THREE.Vector3(0, 1, 0);
const weaponSupportTarget = new THREE.Vector3();

/** Presentation-only scale; movement and navigation continue to use the root position. */
export const ENEMY_PRESENTATION_SCALE = 1.08;
const ENEMY_BALLISTIC_ORIGIN_HEIGHT = 1.25 * ENEMY_PRESENTATION_SCALE;

function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.name = name;
  return mesh;
}

export class Enemy {
  readonly group = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  state: EnemyState = 'patrol';
  health: number;
  alert = 0;
  lastKnownPlayer = new THREE.Vector3();
  readonly spawn: EnemySpawn;

  private readonly speed: number;
  private baseY: number;
  private surfaceSampler: ((x: number, z: number, preferY: number) => number) | null =
    null;
  private patrolIndex = 0;
  private stateTime = 0;
  private decisionTime = 0;
  private fireCooldown = 0;
  private burstRemaining = 0;
  private targetPosition = new THREE.Vector3();
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly visorMaterial = new THREE.MeshStandardMaterial({
    color: '#ff7469',
    emissive: '#a81711',
    emissiveIntensity: 1.2,
    roughness: 0.24,
    metalness: 0.34,
  });
  private readonly presentationRoot = new THREE.Group();
  private generatedVisual: THREE.Group | null = null;
  private animationMixer: THREE.AnimationMixer | null = null;
  private readonly animationActions = new Map<string, THREE.AnimationAction>();
  private activeAnimation = '';
  private proceduralVisualAllowed = true;
  private generatedWeapon: THREE.Group | null = null;
  private generatedWeaponId = '';
  private primaryHand: THREE.Object3D | null = null;
  private supportHand: THREE.Object3D | null = null;
  private readonly weaponGripPoint = new THREE.Vector3();
  private readonly weaponSupportPoint = new THREE.Vector3();

  constructor(spawn: EnemySpawn) {
    this.spawn = spawn;
    this.group.position.copy(spawn.position);
    this.baseY = spawn.position.y;
    this.group.name = `enemy-${spawn.id}`;
    this.group.userData.enemyId = spawn.id;
    this.presentationRoot.name = 'enemy-presentation-root';
    this.presentationRoot.scale.setScalar(ENEMY_PRESENTATION_SCALE);
    this.presentationRoot.userData.presentationScale =
      ENEMY_PRESENTATION_SCALE;
    this.group.add(this.presentationRoot);
    this.health = spawn.role === 'suppressor' ? 135 : spawn.role === 'breacher' ? 105 : 95;
    this.speed = spawn.role === 'breacher' ? 3.1 : spawn.role === 'suppressor' ? 2 : 2.5;
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: roleColors[spawn.role],
      roughness: 0.74,
      metalness: 0.06,
    });
    this.buildModel();
    this.targetPosition.copy(spawn.patrol[0] ?? spawn.position);
  }

  update(context: EnemyContext): EnemyFireEvent | null {
    this.surfaceSampler = context.sampleFootY ?? this.surfaceSampler;
    this.animationMixer?.update(context.delta);
    this.syncGeneratedWeaponPose();
    this.syncAnimationState();
    if (this.state === 'defeated') {
      if (!this.generatedVisual) {
        this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, -1.42, 5, context.delta);
        this.group.position.y = THREE.MathUtils.damp(
          this.group.position.y,
          this.baseY - 0.22,
          4,
          context.delta,
        );
      }
      return null;
    }

    this.stateTime += context.delta;
    this.decisionTime -= context.delta;
    this.fireCooldown -= context.delta;
    if (context.canSeePlayer) {
      this.lastKnownPlayer.copy(context.playerPosition);
      const reaction =
        context.difficulty === 'recruit' ? 0.64 : context.difficulty === 'operative' ? 0.9 : 1.25;
      this.alert = Math.min(1, this.alert + context.delta * reaction);
    } else if (context.heardPlayer) {
      this.lastKnownPlayer.copy(context.playerPosition);
      this.alert = Math.min(0.88, this.alert + context.delta * 0.8);
    } else {
      this.alert = Math.max(0, this.alert - context.delta * 0.07);
    }

    if (this.state === 'stagger') {
      if (this.stateTime >= 0.34) this.enterState(this.alert > 0.65 ? 'cover' : 'search');
      this.animate(context.elapsed);
      return null;
    }

    if (this.alert < 0.28) {
      this.enterIfChanged('patrol');
      this.updatePatrol(context.delta);
    } else if (this.alert < 0.72) {
      this.enterIfChanged(context.heardPlayer ? 'investigate' : 'suspicious');
      this.moveToward(this.lastKnownPlayer, context.delta, this.speed * 0.62);
    } else if (!context.canSeePlayer) {
      this.enterIfChanged('search');
      this.moveToward(this.lastKnownPlayer, context.delta, this.speed * 0.78);
    } else {
      const distance = this.group.position.distanceTo(context.playerPosition);
      if (this.decisionTime <= 0) {
        this.decisionTime = 1.1 + context.rng() * 1.25;
        const roll = context.rng();
        if (this.spawn.role === 'suppressor' && distance > 10 && roll < 0.62) {
          this.enterState('suppressing');
        } else if (this.spawn.role === 'breacher' && distance > 6 && roll < 0.66) {
          this.enterState('flank');
          this.chooseFlank(context);
        } else if (roll < 0.42) {
          this.enterState('cover');
          this.chooseCover(context);
        } else {
          this.enterState('firing');
        }
      }

      if (this.state === 'cover' || this.state === 'flank') {
        const reached = this.moveToward(this.targetPosition, context.delta, this.speed);
        if (reached) this.enterState('firing');
      } else if (this.state === 'suppressing' || this.state === 'firing') {
        this.face(context.playerPosition, context.delta);
        if (this.fireCooldown <= 0) {
          if (this.burstRemaining <= 0) {
            this.burstRemaining =
              this.spawn.role === 'suppressor' ? 7 : this.spawn.role === 'breacher' ? 2 : 4;
          }
          this.burstRemaining -= 1;
          this.fireCooldown =
            this.spawn.role === 'suppressor'
              ? 0.105
              : this.spawn.role === 'breacher'
                ? 0.34
                : 0.17;
          if (this.burstRemaining <= 0) this.fireCooldown += 0.65 + context.rng() * 0.5;
          this.animate(context.elapsed);
          return { enemy: this, suppressing: this.state === 'suppressing' };
        }
      }
    }
    this.animate(context.elapsed);
    return null;
  }

  hit(damage: number): { defeated: boolean; staggered: boolean } {
    if (this.state === 'defeated') return { defeated: false, staggered: false };
    this.health -= damage;
    this.alert = 1;
    if (this.health <= 0) {
      this.health = 0;
      this.enterState('defeated');
      this.visorMaterial.emissiveIntensity = 0;
      return { defeated: true, staggered: false };
    }
    this.enterState('stagger');
    this.bodyMaterial.emissive.set('#8f1712');
    this.bodyMaterial.emissiveIntensity = 1.2;
    return { defeated: false, staggered: true };
  }

  disrupt(seconds = 1.8): void {
    if (this.state === 'defeated') return;
    this.enterState('stagger');
    this.stateTime = -seconds;
    this.alert = 1;
  }

  isDefeated(): boolean {
    return this.state === 'defeated';
  }

  get hasGeneratedVisual(): boolean {
    return this.generatedVisual !== null;
  }

  get animationActionCount(): number {
    return this.animationActions.size;
  }

  get activeAnimationName(): string {
    return this.activeAnimation;
  }

  getFireOrigin(target = new THREE.Vector3()): THREE.Vector3 {
    // Ballistics use a stable actor-space origin. Bone-parented weapons can place
    // the authored muzzle inside nearby collider geo during locomotion poses.
    return target
      .copy(this.group.position)
      .add(new THREE.Vector3(0, ENEMY_BALLISTIC_ORIGIN_HEIGHT, 0));
  }

  getMuzzleWorldPosition(target = new THREE.Vector3()): THREE.Vector3 | null {
    const muzzle =
      this.generatedWeapon?.userData.muzzlePosition instanceof THREE.Vector3
        ? (this.generatedWeapon.userData.muzzlePosition as THREE.Vector3)
        : null;
    if (!this.generatedWeapon || !muzzle) return null;
    this.generatedWeapon.updateWorldMatrix(true, false);
    return target.copy(muzzle).applyMatrix4(this.generatedWeapon.matrixWorld);
  }

  setGeneratedWeapon(
    weapon: THREE.Group,
    weaponId: string,
    primaryHand: THREE.Object3D,
    supportHand: THREE.Object3D,
    gripPoint: THREE.Vector3,
    supportPoint: THREE.Vector3,
  ): void {
    this.generatedWeapon = weapon;
    this.generatedWeaponId = weaponId;
    this.primaryHand = primaryHand;
    this.supportHand = supportHand;
    this.weaponGripPoint.copy(gripPoint);
    this.weaponSupportPoint.copy(supportPoint);
    primaryHand.add(weapon);
    weapon.position.copy(gripPoint).multiplyScalar(-1);
    weapon.quaternion.identity();
    this.syncGeneratedWeaponPose();
  }

  get hasGeneratedWeapon(): boolean {
    return this.generatedWeapon !== null && this.generatedWeapon.visible;
  }

  get generatedWeaponName(): string {
    return this.generatedWeaponId;
  }

  get weaponForwardAlignment(): number {
    if (!this.generatedWeapon) return -1;
    this.generatedWeapon.updateWorldMatrix(true, false);
    const weaponForward = new THREE.Vector3(1, 0, 0)
      .transformDirection(this.generatedWeapon.matrixWorld)
      .setY(0)
      .normalize();
    const actorForward = new THREE.Vector3(
      Math.sin(this.group.rotation.y),
      0,
      Math.cos(this.group.rotation.y),
    ).normalize();
    return weaponForward.dot(actorForward);
  }

  get supportHandDistance(): number {
    if (!this.generatedWeapon || !this.supportHand) return Infinity;
    this.generatedWeapon.updateWorldMatrix(true, false);
    this.supportHand.updateWorldMatrix(true, false);
    const support = this.weaponSupportPoint
      .clone()
      .applyMatrix4(this.generatedWeapon.matrixWorld);
    const hand = this.supportHand.getWorldPosition(new THREE.Vector3());
    return support.distanceTo(hand);
  }

  get primaryGripDistance(): number {
    if (!this.generatedWeapon || !this.primaryHand) return Infinity;
    this.generatedWeapon.updateWorldMatrix(true, false);
    this.primaryHand.updateWorldMatrix(true, false);
    const grip = this.weaponGripPoint
      .clone()
      .applyMatrix4(this.generatedWeapon.matrixWorld);
    const hand = this.primaryHand.getWorldPosition(new THREE.Vector3());
    return grip.distanceTo(hand);
  }

  get footY(): number {
    return this.group.position.y;
  }

  get groundedBaseY(): number {
    return this.baseY;
  }

  get headfrontDotActorForward(): number | null {
    this.animationMixer?.update(0);
    this.group.updateWorldMatrix(true, true);
    return measureHeadfrontDotActorForward(this.group, this.group.rotation.y);
  }

  weaponPoseDiagnostics(): {
    id: string;
    role: EnemyRole;
    weaponId: string;
    weapon: { x: number; y: number; z: number };
    primaryHand: { x: number; y: number; z: number };
    supportHand: { x: number; y: number; z: number };
    boundsSize: { x: number; y: number; z: number };
    forwardAlignment: number;
    supportDistance: number;
  } | null {
    if (!this.generatedWeapon || !this.primaryHand || !this.supportHand) return null;
    const weapon = this.generatedWeapon.getWorldPosition(new THREE.Vector3());
    const primaryHand = this.primaryHand.getWorldPosition(new THREE.Vector3());
    const supportHand = this.supportHand.getWorldPosition(new THREE.Vector3());
    const boundsSize = new THREE.Box3()
      .setFromObject(this.generatedWeapon)
      .getSize(new THREE.Vector3());
    return {
      id: this.spawn.id,
      role: this.spawn.role,
      weaponId: this.generatedWeaponId,
      weapon: { x: weapon.x, y: weapon.y, z: weapon.z },
      primaryHand: {
        x: primaryHand.x,
        y: primaryHand.y,
        z: primaryHand.z,
      },
      supportHand: {
        x: supportHand.x,
        y: supportHand.y,
        z: supportHand.z,
      },
      boundsSize: { x: boundsSize.x, y: boundsSize.y, z: boundsSize.z },
      forwardAlignment: this.weaponForwardAlignment,
      supportDistance: this.supportHandDistance,
    };
  }

  setEvidencePose(semantic: string, time = 0.35): void {
    this.playAnimation(semantic, true);
    this.animationMixer?.update(Math.max(0, time));
    this.syncGeneratedWeaponPose();
  }

  setEvidenceState(state: EnemyState, time = 0.35): void {
    this.enterState(state);
    this.animationMixer?.update(Math.max(0, time));
    this.syncGeneratedWeaponPose();
  }

  reset(): void {
    this.applyGroundedPosition(this.spawn.position.x, this.spawn.position.z, this.spawn.position.y);
    this.group.rotation.set(0, 0, 0);
    this.state = 'patrol';
    this.health =
      this.spawn.role === 'suppressor' ? 135 : this.spawn.role === 'breacher' ? 105 : 95;
    this.alert = 0;
    this.stateTime = 0;
    this.decisionTime = 0;
    this.fireCooldown = 0;
    this.burstRemaining = 0;
    this.patrolIndex = 0;
    this.visorMaterial.emissiveIntensity = 1.2;
    this.bodyMaterial.emissiveIntensity = 0;
    this.group.visible = true;
  }

  setSurfaceSampler(
    sampler: (x: number, z: number, preferY: number) => number,
  ): void {
    this.surfaceSampler = sampler;
  }

  applyGroundedPosition(x: number, z: number, preferY = this.spawn.position.y): void {
    const sampled = this.surfaceSampler?.(x, z, preferY);
    const footY =
      sampled !== undefined && Number.isFinite(sampled) ? sampled : preferY;
    this.setFootPosition(x, footY, z);
  }

  setFootPosition(x: number, y: number, z: number): void {
    this.baseY = y;
    this.spawn.position.set(x, y, z);
    this.group.position.set(x, y, z);
  }

  setGeneratedVisual(
    model: THREE.Group,
    clips: Record<string, THREE.AnimationClip> = {},
  ): void {
    this.generatedVisual?.removeFromParent();
    this.generatedVisual = model;
    this.proceduralVisualAllowed = false;
    this.generatedVisual.name = `mint-enemy-${this.spawn.role}`;
    this.generatedVisual.position.set(0, 0, 0);
    // Preserve authored facing correction from EnemyDirector (clip hips yaw).
    this.generatedVisual.scale.setScalar(1);
    this.generatedVisual.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    for (const target of this.hitTargets) {
      if (!(target instanceof THREE.Mesh)) continue;
      const targetMaterials = Array.isArray(target.material)
        ? target.material
        : [target.material];
      targetMaterials.forEach((material) => {
        material.colorWrite = false;
        material.depthWrite = false;
      });
      target.castShadow = false;
      target.receiveShadow = false;
    }
    this.presentationRoot.add(this.generatedVisual);
    this.animationMixer = new THREE.AnimationMixer(this.generatedVisual);
    this.animationActions.clear();
    for (const [semantic, clip] of Object.entries(clips)) {
      const action = this.animationMixer.clipAction(clip);
      action.enabled = true;
      const once = ['alert', 'stagger', 'defeat'].includes(semantic);
      action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      action.clampWhenFinished = once;
      this.animationActions.set(semantic, action);
    }
    this.playAnimation('idle', true);
  }

  hideProceduralVisual(): void {
    this.proceduralVisualAllowed = false;
    for (const target of this.hitTargets) {
      if (!(target instanceof THREE.Mesh)) continue;
      const targetMaterials = Array.isArray(target.material)
        ? target.material
        : [target.material];
      targetMaterials.forEach((material) => {
        material.colorWrite = false;
        material.depthWrite = false;
      });
      target.castShadow = false;
      target.receiveShadow = false;
    }
  }

  private buildModel(): void {
    const armor = new THREE.MeshStandardMaterial({
      color: '#46534e',
      roughness: 0.45,
      metalness: 0.42,
    });
    const fabric = this.bodyMaterial;
    const helmet = part(
      new THREE.SphereGeometry(0.21, 12, 8),
      armor,
      [0, 1.72, 0],
      'helmet',
    );
    helmet.scale.set(1.05, 0.9, 1.1);
    const visor = part(
      new THREE.BoxGeometry(0.28, 0.07, 0.06),
      this.visorMaterial,
      [0, 1.73, -0.19],
      'visor',
    );
    const torso = part(
      new THREE.CapsuleGeometry(0.3, 0.55, 4, 8),
      fabric,
      [0, 1.12, 0],
      'torso',
    );
    torso.scale.set(1.08, 1, 0.72);
    const plate = part(
      new THREE.BoxGeometry(0.52, 0.46, 0.12),
      armor,
      [0, 1.25, -0.22],
      'chest-plate',
    );
    const backpack = part(
      new THREE.BoxGeometry(
        this.spawn.role === 'suppressor' ? 0.62 : 0.46,
        this.spawn.role === 'suppressor' ? 0.66 : 0.48,
        0.2,
      ),
      armor,
      [0, 1.22, 0.28],
      'backpack',
    );
    const weapon = part(
      new THREE.BoxGeometry(
        this.spawn.role === 'suppressor' ? 0.95 : this.spawn.role === 'breacher' ? 0.62 : 0.78,
        0.1,
        0.1,
      ),
      armor,
      [0.18, 1.18, -0.35],
      'enemy-weapon',
    );
    weapon.rotation.y = -0.12;
    this.presentationRoot.add(helmet, visor, torso, plate, backpack, weapon);

    for (const side of [-1, 1]) {
      const arm = part(
        new THREE.CapsuleGeometry(0.085, 0.48, 4, 6),
        fabric,
        [side * 0.34, 1.16, -0.04],
        'arm',
      );
      arm.rotation.z = side * -0.2;
      const leg = part(
        new THREE.CapsuleGeometry(0.105, 0.64, 4, 6),
        fabric,
        [side * 0.17, 0.43, 0],
        'leg',
      );
      this.presentationRoot.add(arm, leg);
    }
    this.presentationRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.userData.enemyId = this.spawn.id;
      object.userData.hitZone = object.name === 'helmet' || object.name === 'visor' ? 'head' : 'body';
      this.hitTargets.push(object);
    });
  }

  private syncGeneratedWeaponPose(): void {
    if (!this.generatedWeapon || !this.primaryHand || !this.supportHand) return;
    if (this.generatedWeapon.parent !== this.primaryHand) {
      this.primaryHand.add(this.generatedWeapon);
    }

    const aiming = this.state === 'firing' || this.state === 'suppressing';
    this.generatedWeapon.position.copy(this.weaponGripPoint).multiplyScalar(-1);

    if (aiming) {
      this.group.updateWorldMatrix(true, false);
      this.primaryHand.updateWorldMatrix(true, false);
      actorForwardLocal.set(
        Math.sin(this.group.rotation.y),
        0,
        Math.cos(this.group.rotation.y),
      );
      const handWorld = this.primaryHand.matrixWorld;
      const handInverse = weaponBasis.copy(handWorld).invert();
      weaponForward.copy(actorForwardLocal).transformDirection(handInverse).normalize();
      if (weaponForward.lengthSq() < 1e-5) weaponForward.set(1, 0, 0);
      weaponUp.copy(worldUpLocal).transformDirection(handInverse);
      weaponUp.addScaledVector(weaponForward, -weaponForward.dot(weaponUp));
      if (weaponUp.lengthSq() < 1e-5) weaponUp.set(0, 1, 0);
      weaponUp.normalize();
      weaponSide.crossVectors(weaponForward, weaponUp).normalize();
      weaponUp.crossVectors(weaponSide, weaponForward).normalize();
      weaponBasis.makeBasis(weaponForward, weaponUp, weaponSide);
      this.generatedWeapon.quaternion.setFromRotationMatrix(weaponBasis);

      const supportParent = this.supportHand.parent;
      if (supportParent) {
        this.generatedWeapon.updateWorldMatrix(true, false);
        weaponSupportTarget
          .copy(this.weaponSupportPoint)
          .applyMatrix4(this.generatedWeapon.matrixWorld);
        supportParent.worldToLocal(weaponSupportTarget);
        this.supportHand.position.lerp(weaponSupportTarget, 0.92);
        this.supportHand.updateMatrixWorld(true);
      }
      return;
    }

    // Locomotion / idle: inherit hand bone motion; keep a stable local carry pose.
    this.generatedWeapon.quaternion.identity();
  }

  private updatePatrol(delta: number): void {
    const patrol = this.spawn.patrol;
    if (patrol.length === 0) return;
    if (this.moveToward(patrol[this.patrolIndex], delta, this.speed * 0.55)) {
      this.patrolIndex = (this.patrolIndex + 1) % patrol.length;
    }
  }

  private moveToward(target: THREE.Vector3, delta: number, speed: number): boolean {
    const difference = target.clone().sub(this.group.position);
    difference.y = 0;
    const distance = difference.length();
    if (distance < 0.22) return true;
    difference.normalize();
    this.group.position.addScaledVector(difference, Math.min(distance, speed * delta));
    this.snapToSurface(this.group.position.y + 0.75);
    this.face(target, delta);
    return false;
  }

  private face(target: THREE.Vector3, delta: number): void {
    const desired = Math.atan2(
      target.x - this.group.position.x,
      target.z - this.group.position.z,
    );
    let difference = desired - this.group.rotation.y;
    difference = Math.atan2(Math.sin(difference), Math.cos(difference));
    this.group.rotation.y += difference * Math.min(1, delta * 7);
  }

  private chooseCover(context: EnemyContext): void {
    const candidates = context.coverNodes
      .map((node) => ({
        node,
        distance: node.distanceTo(this.group.position),
        playerDistance: node.distanceTo(context.playerPosition),
      }))
      .filter((entry) => entry.distance < 20 && entry.playerDistance > 5)
      .sort((a, b) => a.distance - b.distance);
    this.targetPosition.copy(candidates[Math.min(candidates.length - 1, 1)]?.node ?? this.group.position);
  }

  private chooseFlank(context: EnemyContext): void {
    const side = context.rng() < 0.5 ? -1 : 1;
    this.targetPosition
      .copy(context.playerPosition)
      .add(new THREE.Vector3(side * (7 + context.rng() * 3), 0, -2 + context.rng() * 4));
    this.targetPosition.x = THREE.MathUtils.clamp(this.targetPosition.x, -11.5, 11.5);
    this.targetPosition.z = THREE.MathUtils.clamp(this.targetPosition.z, -78, -36);
  }

  private animate(elapsed: number): void {
    const moving = ['patrol', 'investigate', 'search', 'cover', 'flank'].includes(this.state);
    const bob =
      this.proceduralVisualAllowed && moving
        ? Math.abs(Math.sin(elapsed * 7 + this.spawn.id.length)) * 0.035
        : 0;
    this.snapToSurface(this.baseY + 0.75);
    this.group.position.y = this.baseY + bob;
    if (this.state !== 'stagger') {
      this.bodyMaterial.emissiveIntensity = THREE.MathUtils.damp(
        this.bodyMaterial.emissiveIntensity,
        0,
        8,
        1 / 60,
      );
    }
  }

  private snapToSurface(preferY: number): void {
    if (!this.surfaceSampler) return;
    const footY = this.surfaceSampler(
      this.group.position.x,
      this.group.position.z,
      preferY,
    );
    if (!Number.isFinite(footY)) return;
    if (Math.abs(footY - this.baseY) <= 1.25) {
      this.baseY = footY;
    }
  }

  private enterIfChanged(state: EnemyState): void {
    if (this.state !== state) this.enterState(state);
  }

  private enterState(state: EnemyState): void {
    this.state = state;
    this.stateTime = 0;
    this.syncAnimationState(true);
  }

  private syncAnimationState(restart = false): void {
    const semantic: Record<EnemyState, string> = {
      patrol: 'patrol_walk',
      suspicious: 'alert',
      investigate: 'investigate',
      search: 'search',
      cover: 'cover_movement',
      flank: 'flank_run',
      firing: 'fire_burst',
      suppressing: 'suppression_fire',
      stagger: 'stagger',
      defeated: 'defeat',
    };
    this.playAnimation(semantic[this.state], restart);
  }

  private playAnimation(semantic: string, restart = false): void {
    const next =
      this.animationActions.get(semantic) ??
      this.animationActions.get(semantic === 'patrol_walk' ? 'idle' : 'fire_burst') ??
      this.animationActions.get('idle');
    if (!next || (!restart && this.activeAnimation === semantic)) return;
    const previous = this.animationActions.get(this.activeAnimation);
    if (restart) next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(1);
    next.play();
    if (previous && previous !== next) previous.crossFadeTo(next, 0.16, false);
    this.activeAnimation = semantic;
  }
}
