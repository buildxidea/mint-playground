import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { GRAVITY } from "../core/basis";
import { REFERENCE_ARM_LENGTH, VEHICLE } from "./config";
import type { PlacedProp } from "../world/props";
import type { DroneState } from "./state";

/**
 * The physics world.
 *
 * Division of labour (the "hybrid" in the design): this project's own
 * integrator owns the *aircraft* while it is flying, and Rapier owns the
 * *world* — collision detection against scenery, knockable props, ray queries,
 * and the tumble after a crash.
 *
 * The drone therefore lives here as a kinematic-position body that is pushed
 * to wherever the canonical state says it is. That has one consequence worth
 * stating plainly, because it drives the crash design: a kinematic body is
 * unstoppable, so Rapier will neither hold it out of the scenery nor report a
 * contact *force* against static geometry (neither body can move, so there is
 * no force to report). Impacts are therefore detected from collision events
 * plus the aircraft's own speed, in `crash.ts`.
 */

/**
 * Half-extents of the aircraft's collision box, metres — roughly the
 * airframe. Derived from `VEHICLE.armLength` rather than a fixed literal, so
 * a resize (`sim/config.ts`) carries through to the collider automatically
 * instead of leaving it sized for whatever airframe the sandbox last shipped.
 */
const DRONE_SIZE_SCALE = VEHICLE.armLength / REFERENCE_ARM_LENGTH;
export const QUAD_HALF_EXTENTS: [number, number, number] = [
  0.155 * DRONE_SIZE_SCALE,
  0.06 * DRONE_SIZE_SCALE,
  0.15 * DRONE_SIZE_SCALE,
];

export interface PropBody {
  prop: PlacedProp;
  body: RAPIER.RigidBody;
  dynamic: boolean;
}

/**
 * What the aircraft touched during the last step. The two are distinguished
 * because they mean different things: meeting the ground is how every flight
 * ends, while meeting a shipping container never is.
 */
export interface DroneContacts {
  ground: boolean;
  prop: boolean;
}

export interface PhysicsWorld {
  world: RAPIER.World;
  droneBody: RAPIER.RigidBody;
  droneColliderHandle: number;
  props: PropBody[];
  /** Contacts involving the drone since the last step; clears on read. */
  drainDroneContacts(): DroneContacts;
  step(dt: number): void;
  /** Push the canonical state into the kinematic body. */
  pushKinematic(state: DroneState): void;
  /** Read the tumbling body back into the canonical state. */
  pullDynamic(state: DroneState): void;
  /** Switch the aircraft between our control and Rapier's. */
  setDroneDynamic(dynamic: boolean, state: DroneState): void;
  /** Distance to the first surface below a point, or null within `maxDistance`. */
  castDown(origin: Vector3, maxDistance: number): number | null;
  /**
   * Distance to the first surface along `direction`, or null if nothing is hit
   * within `maxDistance`. The aircraft's own collider is excluded, so a sensor
   * mounted on the airframe cannot see itself.
   */
  castRay(origin: Vector3, direction: Vector3, maxDistance: number): number | null;
  /** Sync knockable props back onto their meshes. */
  syncPropMeshes(): void;
  /**
   * Swap the aircraft's collision box and tumble mass — the vehicle switch
   * uses this so one shared world serves both the quad and the plane instead
   * of maintaining a second world per aircraft (concurrently-built worlds are
   * how the handle cross-wiring bug happened).
   */
  setAircraftShape(halfExtents: [number, number, number], mass: number): void;
  dispose(): void;
}

let initPromise: Promise<void> | null = null;

/**
 * Initialize the Rapier WASM module. Safe to call more than once *and*
 * concurrently: the promise itself is cached, not a completion flag. The
 * distinction is not pedantry — a boolean guard let two `createPhysics`
 * calls issued via `Promise.all` both pass the `!initialized` check and run
 * `RAPIER.init()` twice, overlapping. The second init re-instantiated the
 * WASM module underneath the first call's half-built world, cross-wiring
 * rigid-body handles across worlds (one world's "aircraft" resolved to the
 * other's shipping container) and poisoning every subsequent call with
 * Rapier's "recursive use of an object" aliasing guard. That presented as a
 * black screen: the frame loop threw on its first physics touch, every
 * frame, before anything rendered.
 */
export function initPhysics(): Promise<void> {
  initPromise ??= RAPIER.init().then(() => undefined);
  return initPromise;
}

export interface PhysicsOptions {
  /** Aircraft collision box half-extents, metres. Defaults to the quad's. */
  aircraftHalfExtents?: [number, number, number];
  /** Aircraft mass for the crash tumble, kg. Defaults to the quad's. */
  aircraftMass?: number;
  /** Half-extent of the flat ground slab, metres. Default suits the yard. */
  groundHalfExtent?: number;
}

export async function createPhysics(
  props: PlacedProp[],
  groundY = 0,
  options: PhysicsOptions = {},
): Promise<PhysicsWorld> {
  await initPhysics();

  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });

  // Ground: a thick slab so nothing tunnels through it at speed.
  const groundHalf = options.groundHalfExtent ?? 200;
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, groundY - 2, 0),
  );
  const groundCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(groundHalf, 2, groundHalf).setFriction(0.9),
    groundBody,
  );

  const propBodies: PropBody[] = [];
  const rotation = new Quaternion();
  for (const prop of props) {
    const dynamic = prop.mass !== null;
    rotation.setFromAxisAngle(UP, prop.rotation);

    const desc = (dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed())
      .setTranslation(prop.centre.x, prop.centre.y, prop.centre.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });

    const body = world.createRigidBody(desc);

    const collider = RAPIER.ColliderDesc.cuboid(...prop.halfExtents)
      .setFriction(0.8)
      .setRestitution(0.05);
    if (dynamic) collider.setMass(prop.mass as number);
    world.createCollider(collider, body);

    propBodies.push({ prop, body, dynamic });
  }

  // The aircraft. Kinematic while we fly it; switched to dynamic on impact.
  const halfExtents = options.aircraftHalfExtents ?? QUAD_HALF_EXTENTS;
  const aircraftMass = options.aircraftMass ?? VEHICLE.mass;
  const droneBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, groundY, 0),
  );

  const aircraftColliderDesc = (half: [number, number, number], mass: number) =>
    RAPIER.ColliderDesc.cuboid(...half)
      .setFriction(0.7)
      .setRestitution(0.15)
      .setMass(mass)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      // `DEFAULT` covers dynamic-vs-fixed but *not* kinematic-vs-fixed, so
      // without this the aircraft would sail through every static prop in the
      // city without generating a single event.
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);

  let droneCollider = world.createCollider(
    aircraftColliderDesc(halfExtents, aircraftMass),
    droneBody,
  );

  const events = new RAPIER.EventQueue(true);
  const contacts: DroneContacts = { ground: false, prop: false };

  // Ray queries read from the query pipeline, which is only populated by a
  // step — before one runs, every cast silently returns null. Prime it here so
  // a sensor works on the first frame instead of reporting an empty world.
  world.timestep = 1 / 200;
  world.step(events);
  events.drainCollisionEvents(() => {});

  const scratchVec = new Vector3();
  const scratchQuat = new Quaternion();

  // One reused ray: the lidar casts dozens of these per step.
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  const castRay = (
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
  ): number | null => {
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = direction.x;
    ray.dir.y = direction.y;
    ray.dir.z = direction.z;
    const hit = world.castRay(
      ray,
      maxDistance,
      true,
      undefined,
      undefined,
      undefined,
      droneBody,
    );
    return hit ? hit.timeOfImpact : null;
  };

  return {
    world,
    droneBody,
    get droneColliderHandle() {
      return droneCollider.handle;
    },
    props: propBodies,

    setAircraftShape(half, mass) {
      world.removeCollider(droneCollider, true);
      droneCollider = world.createCollider(
        aircraftColliderDesc(half, mass),
        droneBody,
      );
    },

    step(dt: number) {
      world.timestep = dt;
      world.step(events);

      events.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const involvesDrone =
          h1 === droneCollider.handle || h2 === droneCollider.handle;
        if (!involvesDrone) return;

        const other = h1 === droneCollider.handle ? h2 : h1;
        if (other === groundCollider.handle) {
          contacts.ground = true;
        } else {
          contacts.prop = true;
        }
      });
    },

    drainDroneContacts() {
      const snapshot = { ground: contacts.ground, prop: contacts.prop };
      contacts.ground = false;
      contacts.prop = false;
      return snapshot;
    },

    pushKinematic(state) {
      droneBody.setNextKinematicTranslation({
        x: state.position.x,
        y: state.position.y,
        z: state.position.z,
      });
      droneBody.setNextKinematicRotation({
        x: state.orientation.x,
        y: state.orientation.y,
        z: state.orientation.z,
        w: state.orientation.w,
      });
    },

    pullDynamic(state) {
      const t = droneBody.translation();
      const r = droneBody.rotation();
      const v = droneBody.linvel();
      const w = droneBody.angvel();

      state.position.set(t.x, t.y, t.z);
      state.orientation.set(r.x, r.y, r.z, r.w);
      state.velocity.set(v.x, v.y, v.z);

      // Rapier reports angular velocity in world space; the flight model keeps
      // it in the body frame, so rotate it back before committing.
      scratchVec.set(w.x, w.y, w.z);
      scratchQuat.copy(state.orientation).conjugate();
      scratchVec.applyQuaternion(scratchQuat);
      state.angularVelocity.copy(scratchVec);
    },

    setDroneDynamic(dynamic, state) {
      if (dynamic) {
        droneBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        // Hand over the momentum the aircraft actually had, so the tumble
        // continues the flight rather than starting from rest.
        droneBody.setTranslation(
          { x: state.position.x, y: state.position.y, z: state.position.z },
          true,
        );
        droneBody.setRotation(
          {
            x: state.orientation.x,
            y: state.orientation.y,
            z: state.orientation.z,
            w: state.orientation.w,
          },
          true,
        );
        droneBody.setLinvel(
          { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z },
          true,
        );
        scratchVec.copy(state.angularVelocity).applyQuaternion(state.orientation);
        droneBody.setAngvel(
          { x: scratchVec.x, y: scratchVec.y, z: scratchVec.z },
          true,
        );
      } else {
        droneBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        droneBody.setTranslation(
          { x: state.position.x, y: state.position.y, z: state.position.z },
          true,
        );
      }
    },

    castDown(origin, maxDistance) {
      return castRay(origin, DOWN, maxDistance);
    },

    castRay,

    syncPropMeshes() {
      for (const entry of propBodies) {
        if (!entry.dynamic) continue;
        const t = entry.body.translation();
        const r = entry.body.rotation();
        // The mesh origin sits on the ground plane, the collider at its centre.
        entry.prop.object.position.set(
          t.x,
          t.y - entry.prop.halfExtents[1],
          t.z,
        );
        entry.prop.object.quaternion.set(r.x, r.y, r.z, r.w);
      }
    },

    dispose() {
      events.free();
      world.free();
    },
  };
}

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
