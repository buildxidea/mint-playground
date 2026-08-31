import RAPIER from '@dimforge/rapier3d-compat';
import { FLOOR_SURFACE_Y, VehicleController, type DrivePose } from '../vehicles/VehicleController';
import { vehicleColliderHalfExtents, type VehicleProfile } from '../vehicles/profiles';

export type StaticBox = {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  tag: 'obstacle' | 'wall' | 'line';
  label?: string;
};

export class PhysicsWorld {
  private world!: RAPIER.World;
  private vehicleBody!: RAPIER.RigidBody;
  private vehicleCollider!: RAPIER.Collider;
  private readonly staticBodies: RAPIER.RigidBody[] = [];
  private readonly colliderLabels = new Map<number, string>();
  private lastContacts: string[] = [];
  private readonly driver = new VehicleController();
  private collisionCooldown = 0;
  private lineCooldown = 0;
  collisions = 0;
  lineViolations = 0;
  private collisionPulse = false;
  private floorY = FLOOR_SURFACE_Y;

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  setFloorY(y: number): void {
    this.floorY = y;
  }

  getFloorY(): number {
    return this.floorY;
  }

  resetVehicle(profile: VehicleProfile, x: number, z: number, yaw: number): void {
    if (this.vehicleBody) {
      this.world.removeRigidBody(this.vehicleBody);
    }
    this.driver.reset(x, z, yaw);

    const bodyY = this.floorY + profile.height * 0.5;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(x, bodyY, z)
      .setRotation(quatFromYaw(yaw));
    this.vehicleBody = this.world.createRigidBody(bodyDesc);

    const vehicleHalf = vehicleColliderHalfExtents(profile);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      vehicleHalf.hx,
      profile.height * 0.38,
      vehicleHalf.hz,
    )
      .setFriction(0.85)
      .setActiveCollisionTypes(
        RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED,
      );
    this.vehicleCollider = this.world.createCollider(colliderDesc, this.vehicleBody);

    this.collisions = 0;
    this.lineViolations = 0;
    this.collisionCooldown = 0;
    this.lineCooldown = 0;
  }

  clearStatics(): void {
    for (const body of this.staticBodies) {
      this.world.removeRigidBody(body);
    }
    this.staticBodies.length = 0;
    this.colliderLabels.clear();
    this.lastContacts = [];
  }

  addStaticBox(box: StaticBox): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(box.x, box.y, box.z)
        .setRotation(quatFromYaw(box.yaw)),
    );
    const desc = RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz);
    if (box.tag === 'line') {
      desc.setSensor(true);
    }
    const collider = this.world.createCollider(desc, body);
    this.colliderLabels.set(collider.handle, box.label ?? box.tag);
    this.staticBodies.push(body);
  }

  addLotBounds(halfW = 13, halfD = 10): void {
    const t = 0.45;
    const h = 0.7;
    const y = this.floorY + h;
    const walls: StaticBox[] = [
      { x: 0, y, z: -halfD, hx: halfW + t, hy: h, hz: t, yaw: 0, tag: 'wall', label: 'south-wall' },
      { x: 0, y, z: halfD, hx: halfW + t, hy: h, hz: t, yaw: 0, tag: 'wall', label: 'north-wall' },
      { x: -halfW, y, z: 0, hx: t, hy: h, hz: halfD + t, yaw: 0, tag: 'wall', label: 'west-wall' },
      { x: halfW, y, z: 0, hx: t, hy: h, hz: halfD + t, yaw: 0, tag: 'wall', label: 'east-wall' },
    ];
    for (const w of walls) this.addStaticBox(w);
  }

  diagnostics(): {
    engine: 'rapier';
    timestep: number;
    bodies: number;
    colliders: number;
    sensors: number;
    ccdBodies: number;
    contacts: string[];
  } {
    let bodies = 0;
    let colliders = 0;
    let sensors = 0;
    this.world.forEachRigidBody(() => {
      bodies += 1;
    });
    this.world.forEachCollider((collider) => {
      colliders += 1;
      if (collider.isSensor()) sensors += 1;
    });
    return {
      engine: 'rapier',
      // The custom vehicle controller is frame-clamped/substepped; Rapier
      // resolves its kinematic contacts once per render update.
      timestep: this.world.timestep,
      bodies,
      colliders,
      sensors,
      ccdBodies: 0,
      contacts: [...this.lastContacts],
    };
  }

  step(
    dt: number,
    profile: VehicleProfile,
    throttle: number,
    steer: number,
    brake: number,
  ): DrivePose & { collided: boolean } {
    const prevX = this.driver.x;
    const prevZ = this.driver.z;
    const pose = this.driver.step(dt, profile, throttle, steer, brake);

    const bodyY = this.floorY + profile.height * 0.5;
    this.vehicleBody.setNextKinematicTranslation({ x: pose.x, y: bodyY, z: pose.z });
    this.vehicleBody.setNextKinematicRotation(quatFromYaw(pose.yaw));
    this.world.step();

    const collided = this.resolveContacts(prevX, prevZ, dt);
    return { ...this.driver.pose(), collided };
  }

  getPose(): DrivePose {
    return this.driver.pose();
  }

  /** Teleport vehicle for coverage / bot probes. Clears velocity. */
  setPose(x: number, z: number, yaw: number, profileHeight = 1.45): void {
    this.driver.reset(x, z, yaw);
    if (!this.vehicleBody) return;
    const bodyY = this.floorY + profileHeight * 0.5;
    this.vehicleBody.setTranslation({ x, y: bodyY, z }, true);
    this.vehicleBody.setRotation(quatFromYaw(yaw), true);
    this.collisionCooldown = 0;
    this.lineCooldown = 0;
  }

  private resolveContacts(prevX: number, prevZ: number, dt: number): boolean {
    let hitObstacle = false;
    let hitLine = false;
    const contacts = new Set<string>();

    // Sensors are intersections, not contact manifolds.
    this.world.intersectionPairsWith(this.vehicleCollider, (other) => {
      hitLine = true;
      contacts.add(this.colliderLabels.get(other.handle) ?? `collider-${other.handle}`);
    });

    // Rapier documents contactPairsWith as "potentially in contact". Rotated
    // neighboring boxes can share a broad-phase pair while their actual OBBs
    // remain well separated, so require a real near-zero/penetrating contact.
    this.world.contactPairsWith(this.vehicleCollider, (other) => {
      if (other.isSensor()) return;
      let touching = false;
      this.world.contactPair(this.vehicleCollider, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i += 1) {
          if (manifold.contactDist(i) <= 0.005) touching = true;
        }
      });
      if (!touching) return;
      hitObstacle = true;
      contacts.add(this.colliderLabels.get(other.handle) ?? `collider-${other.handle}`);
    });
    if (contacts.size > 0) this.lastContacts = [...contacts];

    const speedAbs = Math.hypot(this.driver.vx, this.driver.vz);
    if (hitLine && this.lineCooldown <= 0 && speedAbs > 0.45) {
      this.lineViolations += 1;
      this.lineCooldown = 0.65;
    }

    if (hitObstacle) {
      const dx = this.driver.x - prevX;
      const dz = this.driver.z - prevZ;
      const len = Math.hypot(dx, dz);
      if (len > 1e-5) {
        this.driver.x = prevX - (dx / len) * 0.08;
        this.driver.z = prevZ - (dz / len) * 0.08;
      } else {
        this.driver.x = prevX;
        this.driver.z = prevZ;
      }
      this.driver.resolveCollision();

      const bodyY = this.vehicleBody.translation().y;
      this.vehicleBody.setTranslation(
        { x: this.driver.x, y: bodyY, z: this.driver.z },
        true,
      );
      this.vehicleBody.setRotation(quatFromYaw(this.driver.yaw), true);

      if (this.collisionCooldown <= 0) {
        this.collisions += 1;
        this.collisionCooldown = 0.4;
        this.collisionPulse = true;
      }
    }

    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    this.lineCooldown = Math.max(0, this.lineCooldown - dt);
    const pulsed = this.collisionPulse;
    this.collisionPulse = false;
    return pulsed;
  }
}

function quatFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  const half = yaw * 0.5;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}
