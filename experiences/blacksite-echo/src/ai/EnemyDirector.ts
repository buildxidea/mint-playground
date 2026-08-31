import * as THREE from 'three';
import type { MintAssetRuntime } from '../assets/MintAssetRuntime';
import { clipHipsYawOffsetToActorForward } from '../assets/mintCharacterFacing';
import { getWeapon, type WeaponId } from '../data/weapons';
import type { Difficulty } from '../game/types';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import type { FacilityWorld } from '../world/FacilityWorld';
import { prepareMintWeaponModel } from '../weapons/WeaponPresentation';
import { Enemy, type EnemyFireEvent, type EnemySpawn } from './Enemy';

const roleWeapon: Record<EnemySpawn['role'], WeaponId> = {
  rifleman: 'arx-7',
  breacher: 'talon-m4',
  suppressor: 'brimstone-lmg6',
};

const roleWeaponGrip: Record<
  EnemySpawn['role'],
  { grip: [number, number, number]; support: [number, number, number] }
> = {
  rifleman: { grip: [-0.15, -0.045, 0], support: [0.22, 0, 0] },
  breacher: { grip: [-0.12, -0.045, 0], support: [0.2, 0, 0] },
  suppressor: { grip: [-0.17, -0.065, 0], support: [0.24, 0, 0] },
};

export const ENEMY_SPAWNS: EnemySpawn[] = [
  {
    id: 'sentry-a',
    role: 'rifleman',
    segment: 0,
    position: new THREE.Vector3(-3.2, 0, -55),
    patrol: [new THREE.Vector3(-3.2, 0, -55), new THREE.Vector3(2.8, 0, -58)],
  },
  {
    id: 'sentry-b',
    role: 'breacher',
    segment: 0,
    position: new THREE.Vector3(4.2, 0, -59),
    patrol: [new THREE.Vector3(4.2, 0, -59), new THREE.Vector3(-2.5, 0, -61)],
  },
  {
    id: 'relay-a',
    role: 'rifleman',
    segment: 1,
    position: new THREE.Vector3(-6, 0, -64),
    patrol: [new THREE.Vector3(-6, 0, -64), new THREE.Vector3(-4, 0, -69)],
  },
  {
    id: 'relay-b',
    role: 'suppressor',
    segment: 1,
    position: new THREE.Vector3(7, 0, -67),
    patrol: [new THREE.Vector3(7, 0, -67), new THREE.Vector3(5, 0, -71)],
  },
  {
    id: 'arena-a',
    role: 'rifleman',
    segment: 2,
    position: new THREE.Vector3(-8, 0, -75),
    patrol: [new THREE.Vector3(-8, 0, -75), new THREE.Vector3(-5, 0, -81)],
  },
  {
    id: 'arena-b',
    role: 'breacher',
    segment: 2,
    position: new THREE.Vector3(4, 0, -79),
    patrol: [new THREE.Vector3(4, 0, -79), new THREE.Vector3(-2, 0, -84)],
  },
  {
    id: 'arena-c',
    role: 'suppressor',
    segment: 2,
    position: new THREE.Vector3(9.5, 1.3, -83),
    patrol: [new THREE.Vector3(9.5, 1.3, -83), new THREE.Vector3(9.5, 1.3, -77)],
  },
  {
    id: 'arena-d',
    role: 'rifleman',
    segment: 2,
    position: new THREE.Vector3(-7, 0, -88),
    patrol: [new THREE.Vector3(-7, 0, -88), new THREE.Vector3(3, 0, -88)],
  },
];

export class EnemyDirector {
  readonly enemies: Enemy[] = [];
  private heardPosition = new THREE.Vector3();
  private heardTimer = 0;
  private activeSegment: 0 | 1 | 2 = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: FacilityWorld,
    private readonly physics?: PhysicsWorld,
  ) {
    for (const spawn of ENEMY_SPAWNS) {
      const enemy = new Enemy(spawn);
      if (this.physics) {
        enemy.setSurfaceSampler((x, z, preferY) => {
          const sample = this.physics!.sampleSurface(x, z, preferY, 0.6, 3);
          return sample?.walkable ? sample.point.y : Number.NaN;
        });
      }
      this.enemies.push(enemy);
      this.world.mission.add(enemy.group);
    }
    this.setCheckpointSegment(0);
  }

  configurePlayableArea(spawn: THREE.Vector3, bounds: THREE.Box3): void {
    const clampX = (value: number): number =>
      THREE.MathUtils.clamp(value, bounds.min.x + 2, bounds.max.x - 2);
    const clampZ = (value: number): number =>
      THREE.MathUtils.clamp(value, bounds.min.z + 2, bounds.max.z - 2);
    const layouts: Record<
      string,
      { position: [number, number, number]; patrol: Array<[number, number, number]> }
    > = {
      'sentry-a': {
        position: [-3.2, 0, -5],
        patrol: [[-3.2, 0, -5], [2.8, 0, -7]],
      },
      'sentry-b': {
        position: [4.2, 0, -7],
        patrol: [[4.2, 0, -7], [-2.5, 0, -8]],
      },
      'relay-a': {
        position: [-6, 0, -10],
        patrol: [[-6, 0, -10], [-4, 0, -13]],
      },
      'relay-b': {
        position: [7, 0, -11],
        patrol: [[7, 0, -11], [5, 0, -14]],
      },
      'arena-a': {
        position: [-8, 0, -14],
        patrol: [[-8, 0, -14], [-5, 0, -17]],
      },
      'arena-b': {
        position: [4, 0, -15],
        patrol: [[4, 0, -15], [-2, 0, -18]],
      },
      'arena-c': {
        position: [9, 1.3, -16],
        patrol: [[9, 1.3, -16], [7.5, 1.3, -13]],
      },
      'arena-d': {
        position: [-7, 0, -19],
        patrol: [[-7, 0, -19], [3, 0, -19]],
      },
    };
    for (const enemy of this.enemies) {
      const layout = layouts[enemy.spawn.id];
      if (!layout) continue;
      const x = clampX(spawn.x + layout.position[0]);
      const z = clampZ(spawn.z + layout.position[2]);
      const preferY = spawn.y + layout.position[1] - 1;
      const footY =
        this.physics?.findGroundedFootY(x, z, preferY + 2, 12) ?? preferY;
      enemy.spawn.position.set(x, footY, z);
      enemy.spawn.patrol = layout.patrol.map(([px, py, pz]) => {
        const patrolX = clampX(spawn.x + px);
        const patrolZ = clampZ(spawn.z + pz);
        const patrolPrefer = spawn.y + py - 1;
        const patrolY =
          this.physics?.findGroundedFootY(patrolX, patrolZ, patrolPrefer + 2, 12) ??
          patrolPrefer;
        return new THREE.Vector3(patrolX, patrolY, patrolZ);
      });
      enemy.reset();
    }
    this.setCheckpointSegment(this.activeSegment);
  }

  update(
    delta: number,
    elapsed: number,
    playerPosition: THREE.Vector3,
    difficulty: Difficulty,
    playerTargetable: boolean,
    canSee: (enemy: Enemy) => boolean,
    rng: () => number,
  ): EnemyFireEvent[] {
    const events: EnemyFireEvent[] = [];
    this.heardTimer = Math.max(0, this.heardTimer - delta);
    for (const enemy of this.enemies) {
      if (!enemy.group.visible || enemy.isDefeated()) {
        enemy.update({
          delta,
          elapsed,
          playerPosition,
          canSeePlayer: false,
          heardPlayer: false,
          difficulty,
          coverNodes: this.world.coverNodes,
          rng,
          sampleFootY: this.physics
            ? (x, z, preferY) => this.physics!.findGroundedFootY(x, z, preferY)
            : undefined,
        });
        continue;
      }
      const visible = playerTargetable && canSee(enemy);
      const heard =
        playerTargetable &&
        this.heardTimer > 0 &&
        enemy.group.position.distanceTo(this.heardPosition) < 30;
      const event = enemy.update({
        delta,
        elapsed,
        playerPosition,
        canSeePlayer: visible,
        heardPlayer: heard,
        difficulty,
        coverNodes: this.world.coverNodes,
        rng,
        sampleFootY: this.physics
          ? (x, z, preferY) => this.physics!.findGroundedFootY(x, z, preferY)
          : undefined,
      });
      if (event) events.push(event);
    }
    return events;
  }

  emitSound(position: THREE.Vector3, radius: number): void {
    this.heardPosition.copy(position);
    this.heardTimer = Math.max(0.25, radius / 38);
    for (const enemy of this.enemies) {
      if (enemy.group.position.distanceTo(position) <= radius) enemy.alert = Math.max(enemy.alert, 0.5);
    }
  }

  getHitTargets(): THREE.Object3D[] {
    return this.enemies.flatMap((enemy) => enemy.hitTargets);
  }

  getEnemyById(id: string): Enemy | undefined {
    return this.enemies.find((enemy) => enemy.spawn.id === id);
  }

  teleportEnemy(id: string, x: number, y: number, z: number): void {
    const enemy = this.getEnemyById(id);
    if (!enemy) return;
    if (this.physics) {
      enemy.setSurfaceSampler((px, pz, preferY) => {
        const sample = this.physics!.sampleSurface(px, pz, preferY, 0.6, 3);
        return sample?.walkable ? sample.point.y : Number.NaN;
      });
      const footY = this.physics.findGroundedFootY(x, z, y + 2, 12, y);
      enemy.setFootPosition(x, footY, z);
      return;
    }
    enemy.setFootPosition(x, y, z);
  }

  setCheckpointSegment(segment: 0 | 1 | 2): void {
    this.activeSegment = segment;
    for (const enemy of this.enemies) {
      enemy.reset();
      enemy.group.visible = enemy.spawn.segment >= segment;
    }
  }

  defeatBeforeSegment(segment: 0 | 1 | 2): void {
    for (const enemy of this.enemies) {
      if (enemy.spawn.segment < segment) enemy.group.visible = false;
    }
  }

  getAliveCount(): number {
    return this.enemies.filter((enemy) => enemy.group.visible && !enemy.isDefeated()).length;
  }

  disruptNear(position: THREE.Vector3, radius: number): number {
    let count = 0;
    for (const enemy of this.enemies) {
      if (
        enemy.group.visible &&
        !enemy.isDefeated() &&
        enemy.group.position.distanceTo(position) <= radius
      ) {
        enemy.disrupt();
        count += 1;
      }
    }
    return count;
  }

  async initializeMintVisuals(assets: MintAssetRuntime): Promise<number> {
    let integrated = 0;
    const clipsByRole = new Map<
      EnemySpawn['role'],
      Record<string, THREE.AnimationClip>
    >();
    for (const enemy of this.enemies) {
      const assetId = `enemy-${enemy.spawn.role}`;
      if (!assets.visibleFallbacksAllowed) enemy.hideProceduralVisual();
      if (!assets.getArtifact(assetId, 'model')) continue;
      try {
        let clips = clipsByRole.get(enemy.spawn.role);
        if (!clips) {
          clips = await assets.loadRoleAnimationSet(
            'animation-enemy-rifle-combat',
            enemy.spawn.role,
          );
          clipsByRole.set(enemy.spawn.role, clips);
        }
        const model = await assets.instantiateModel(assetId);
        if (!model) continue;
        const facingClip =
          clips.patrol_walk ?? clips.idle ?? clips.flank_run ?? undefined;
        model.rotation.y = clipHipsYawOffsetToActorForward(facingClip);
        const weaponId = roleWeapon[enemy.spawn.role];
        const weaponSource = await assets.instantiateModel(`weapon-${weaponId}`);
        if (!weaponSource) throw new Error(`Missing required attacker weapon: ${weaponId}`);
        const rightHand = model.getObjectByName('RightHand');
        const leftHand = model.getObjectByName('LeftHand');
        if (!rightHand || !leftHand) {
          throw new Error(`Attacker rig ${assetId} is missing hand bones.`);
        }
        const definition = getWeapon(weaponId);
        const weapon = prepareMintWeaponModel(
          weaponSource,
          definition,
          enemy.spawn.role === 'suppressor' ? 0.95 : 0.76,
        );
        weapon.name = `mint-${enemy.spawn.role}-weapon`;
        const grip = roleWeaponGrip[enemy.spawn.role];
        enemy.setGeneratedWeapon(
          weapon,
          weaponId,
          rightHand,
          leftHand,
          new THREE.Vector3(...grip.grip),
          new THREE.Vector3(...grip.support),
        );
        enemy.setGeneratedVisual(model, clips);
        integrated += 1;
      } catch (error) {
        console.warn(`Mint enemy asset failed to load: ${assetId}`, error);
      }
    }
    return integrated;
  }

  diagnostics(): {
    generatedVisuals: number;
    armedEnemies: number;
    weaponIds: string[];
    minimumWeaponForwardAlignment: number;
    maximumSupportHandDistance: number;
    maximumPrimaryGripDistance: number;
    maximumFootSurfaceError: number;
    groundedSampleCount: number;
    weaponPoses: Array<NonNullable<ReturnType<Enemy['weaponPoseDiagnostics']>>>;
    animationActions: number;
    activeAnimations: string[];
  } {
    const armed = this.enemies.filter((enemy) => enemy.hasGeneratedWeapon);
    const visible = this.enemies.filter((enemy) => enemy.group.visible);
    let maximumFootSurfaceError = 0;
    let groundedSampleCount = 0;
    if (this.physics) {
      for (const enemy of visible) {
        const sample = this.physics.sampleSurface(
          enemy.group.position.x,
          enemy.group.position.z,
          enemy.groundedBaseY + 0.75,
          0.6,
          3,
        );
        if (!sample?.walkable) continue;
        groundedSampleCount += 1;
        maximumFootSurfaceError = Math.max(
          maximumFootSurfaceError,
          Math.abs(enemy.groundedBaseY - sample.point.y),
        );
      }
    }
    return {
      generatedVisuals: this.enemies.filter((enemy) => enemy.hasGeneratedVisual).length,
      armedEnemies: armed.length,
      weaponIds: armed.map((enemy) => enemy.generatedWeaponName),
      minimumWeaponForwardAlignment:
        armed.length > 0
          ? Math.min(...armed.map((enemy) => enemy.weaponForwardAlignment))
          : -1,
      maximumSupportHandDistance:
        armed.length > 0
          ? Math.max(...armed.map((enemy) => enemy.supportHandDistance))
          : Infinity,
      maximumPrimaryGripDistance:
        armed.length > 0
          ? Math.max(...armed.map((enemy) => enemy.primaryGripDistance))
          : Infinity,
      maximumFootSurfaceError,
      groundedSampleCount,
      weaponPoses: armed
        .map((enemy) => enemy.weaponPoseDiagnostics())
        .filter(
          (
            pose,
          ): pose is NonNullable<ReturnType<Enemy['weaponPoseDiagnostics']>> =>
            pose !== null,
        ),
      animationActions: this.enemies.reduce(
        (total, enemy) => total + enemy.animationActionCount,
        0,
      ),
      activeAnimations: [...new Set(
        this.enemies
          .map((enemy) => enemy.activeAnimationName)
          .filter((name) => name.length > 0),
      )],
    };
  }

  dispose(): void {
    for (const enemy of this.enemies) this.world.mission.remove(enemy.group);
    this.enemies.length = 0;
    void this.scene;
    void this.activeSegment;
  }
}
