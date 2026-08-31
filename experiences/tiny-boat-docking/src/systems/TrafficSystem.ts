import * as THREE from 'three';
import { primaryBoatFootprint } from '../assets/collisionProfiles';
import { cloneModel, type LoadedModel } from '../assets/loadModels';
import type { ModelAssetId } from '../assets/registry';
import type { TrafficBoatDef } from '../levels/LevelDef';
import { liftFloating } from '../levels/grounding';
import type { BoatState } from './BoatPhysics';
import { overlapOBB, type MovingOBB, type OBB } from './CollisionSystem';
import type { FloatingBodySpec } from './FloatingBodySystem';
import type { WakeEmitter } from './WaveSystem';

type TrafficActor = {
  id: string;
  def: TrafficBoatDef;
  root: THREE.Group;
  wakeMesh: THREE.Mesh;
  curve: THREE.CatmullRomCurve3;
  length: number;
  distance: number;
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  speed: number;
  impactSlow: number;
  collider: MovingOBB;
  wake: WakeEmitter;
};

export type TrafficThreat = {
  distance: number;
  closing: boolean;
};

/** Deterministic kinematic marina traffic with player-aware emergency yielding. */
export class TrafficSystem {
  readonly group = new THREE.Group();
  private readonly actors: TrafficActor[] = [];
  private readonly colliders: MovingOBB[] = [];
  private readonly wakes: WakeEmitter[] = [];
  private readonly wakeGeometry = createWakeGeometry();
  private readonly wakeMaterial = new THREE.MeshBasicMaterial({
    color: '#e8f7f4',
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    vertexColors: true,
  });

  constructor() {
    this.group.name = 'harbor-traffic';
  }

  configure(
    definitions: readonly TrafficBoatDef[],
    models: Map<ModelAssetId, LoadedModel>,
    staticObstacles: readonly OBB[] = [],
  ): void {
    this.group.clear();
    this.actors.length = 0;
    this.colliders.length = 0;
    this.wakes.length = 0;

    definitions.forEach((definition, index) => {
      const points = definition.route.map((routePoint) => new THREE.Vector3(routePoint.x, 0, routePoint.z));
      if (points.length < 4) {
        throw new Error(`Traffic route ${index + 1} needs at least four points.`);
      }
      const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);
      const length = Math.max(1, curve.getLength());
      const distance = wrap01(definition.phase) * length;
      const position = curve.getPointAt(distance / length);
      const tangent = curve.getTangentAt(distance / length).normalize();
      const id = `traffic-${index}`;

      const root = new THREE.Group();
      root.name = id;
      const boat = cloneModel(models, definition.model);
      liftFloating(boat, 0.025);
      root.add(boat);

      const wakeMesh = new THREE.Mesh(this.wakeGeometry, this.wakeMaterial);
      wakeMesh.name = `${id}-wake-foam`;
      wakeMesh.position.y = 0.035;
      wakeMesh.scale.x = 0.8 + definition.wakeStrength * 0.35;
      wakeMesh.scale.z = 0.85 + definition.wakeStrength * 0.25;
      wakeMesh.renderOrder = 1;
      // The shared water shader now owns visible wake foam. Keep this legacy
      // mesh allocated for compatibility, but never render the flat V strips.
      wakeMesh.visible = false;
      root.add(wakeMesh);

      const yaw = Math.atan2(tangent.x, tangent.z);
      const footprint = primaryBoatFootprint(definition.model);
      const collider: MovingOBB = {
        x: position.x,
        z: position.z,
        yaw,
        hx: footprint.hx,
        hz: footprint.hz,
        minY: -0.4,
        maxY: 1.9,
        kind: 'boat',
        vx: tangent.x * definition.speed,
        vz: tangent.z * definition.speed,
        sourceId: id,
        model: definition.model,
        partIndex: 0,
        previousX: position.x,
        previousZ: position.z,
        previousYaw: yaw,
      };
      const wake: WakeEmitter = {
        id,
        x: position.x - tangent.x * footprint.hz * 0.88,
        z: position.z - tangent.z * footprint.hz * 0.88,
        dirX: tangent.x,
        dirZ: tangent.z,
        speed: definition.speed,
        strength: definition.wakeStrength,
        phase: index * 1.73 + definition.phase * Math.PI * 2,
      };
      const actor: TrafficActor = {
        id,
        def: definition,
        root,
        wakeMesh,
        curve,
        length,
        distance,
        x: position.x,
        z: position.z,
        yaw,
        vx: collider.vx,
        vz: collider.vz,
        speed: definition.speed,
        impactSlow: 0,
        collider,
        wake,
      };
      this.actors.push(actor);
      this.colliders.push(collider);
      this.wakes.push(wake);
      this.group.add(root);
    });
    this.separateInitialActors(staticObstacles);
  }

  private separateInitialActors(staticObstacles: readonly OBB[]): void {
    const accepted: OBB[] = [];
    for (const actor of this.actors) {
      const stride = Math.max(0.65, actor.length / 96);
      const attempts = Math.max(16, Math.ceil(actor.length / stride));
      const isBlocked = (): boolean =>
        staticObstacles.some((obstacle) => overlapOBB(actor.collider, obstacle)) ||
        accepted.some((obstacle) => overlapOBB(actor.collider, obstacle));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (!isBlocked()) break;
        actor.distance = (actor.distance + stride) % actor.length;
        const normalizedDistance = actor.distance / actor.length;
        const position = actor.curve.getPointAt(normalizedDistance);
        const tangent = actor.curve.getTangentAt(normalizedDistance).normalize();
        actor.x = position.x;
        actor.z = position.z;
        actor.yaw = Math.atan2(tangent.x, tangent.z);
        actor.vx = tangent.x * actor.speed;
        actor.vz = tangent.z * actor.speed;
        actor.collider.x = actor.x;
        actor.collider.z = actor.z;
        actor.collider.yaw = actor.yaw;
        actor.collider.vx = actor.vx;
        actor.collider.vz = actor.vz;
        actor.collider.previousX = actor.x;
        actor.collider.previousZ = actor.z;
        actor.collider.previousYaw = actor.yaw;
        actor.wake.x = actor.x - tangent.x * actor.collider.hz * 0.88;
        actor.wake.z = actor.z - tangent.z * actor.collider.hz * 0.88;
        actor.wake.dirX = tangent.x;
        actor.wake.dirZ = tangent.z;
      }
      if (isBlocked()) {
        throw new Error(`${actor.id} has no collision-free starting position on its route.`);
      }
      accepted.push(actor.collider);
    }
  }

  step(dt: number, player: BoatState, staticObstacles: readonly OBB[] = []): void {
    const snapshots = this.actors.map((actor) => ({
      distance: actor.distance,
      yaw: actor.yaw,
      speed: actor.speed,
      x: actor.x,
      z: actor.z,
      vx: actor.vx,
      vz: actor.vz,
    }));

    const proposals = this.actors.map((actor, index) => {
      const snapshot = snapshots[index]!;
      let targetSpeed = actor.def.speed;
      const closest = predictedSeparation(snapshot, player, 3);
      const currentDistance = Math.hypot(snapshot.x - player.x, snapshot.z - player.z);

      if (actor.def.behavior === 'yielding' && closest < 3.8) {
        targetSpeed *= 0.28;
      } else if (currentDistance < 3.1 || closest < 2.4) {
        targetSpeed *= 0.12;
      }

      for (let otherIndex = 0; otherIndex < snapshots.length; otherIndex += 1) {
        if (otherIndex === index) continue;
        const other = snapshots[otherIndex]!;
        if (Math.hypot(snapshot.x - other.x, snapshot.z - other.z) < 4.4) {
          targetSpeed *= 0.35;
          break;
        }
      }

      if (actor.impactSlow > 0) {
        actor.impactSlow = Math.max(0, actor.impactSlow - dt);
        targetSpeed *= 0.2;
      }

      const speed = actor.speed + (targetSpeed - actor.speed) * (1 - Math.exp(-2.4 * dt));
      const distance = (actor.distance + speed * dt) % actor.length;
      const normalizedDistance = distance / actor.length;
      const position = actor.curve.getPointAt(normalizedDistance);
      const tangent = actor.curve.getTangentAt(normalizedDistance).normalize();
      const nextYaw = Math.atan2(tangent.x, tangent.z);
      const yaw = actor.yaw + normalizeAngle(nextYaw - actor.yaw) * (1 - Math.exp(-6 * dt));
      return {
        distance,
        speed,
        x: position.x,
        z: position.z,
        yaw,
        vx: (position.x - actor.x) / Math.max(dt, 1e-5),
        vz: (position.z - actor.z) / Math.max(dt, 1e-5),
      };
    });

    const rollback = (index: number): void => {
      const snapshot = snapshots[index]!;
      proposals[index] = {
        distance: snapshot.distance,
        speed: Math.min(snapshot.speed, 0.08),
        x: snapshot.x,
        z: snapshot.z,
        yaw: snapshot.yaw,
        vx: 0,
        vz: 0,
      };
    };

    const candidate = (index: number): OBB => {
      const actor = this.actors[index]!;
      const proposal = proposals[index]!;
      return {
        ...actor.collider,
        x: proposal.x,
        z: proposal.z,
        yaw: proposal.yaw,
      };
    };

    for (let index = 0; index < proposals.length; index += 1) {
      const proposedCollider = candidate(index);
      if (staticObstacles.some((obstacle) => overlapOBB(proposedCollider, obstacle))) {
        rollback(index);
      }
    }

    // Frame-start semantics: if two proposals intersect, neither commits.
    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;
      for (let i = 0; i < proposals.length; i += 1) {
        for (let j = i + 1; j < proposals.length; j += 1) {
          if (!overlapOBB(candidate(i), candidate(j))) continue;
          rollback(i);
          rollback(j);
          changed = true;
        }
      }
      if (!changed) break;
    }

    for (let index = 0; index < this.actors.length; index += 1) {
      const actor = this.actors[index]!;
      const snapshot = snapshots[index]!;
      const proposal = proposals[index]!;
      actor.distance = proposal.distance;
      actor.speed = proposal.speed;
      actor.x = proposal.x;
      actor.z = proposal.z;
      actor.yaw = proposal.yaw;
      actor.vx = proposal.vx;
      actor.vz = proposal.vz;

      actor.collider.previousX = snapshot.x;
      actor.collider.previousZ = snapshot.z;
      actor.collider.previousYaw = snapshot.yaw;
      actor.collider.x = actor.x;
      actor.collider.z = actor.z;
      actor.collider.yaw = actor.yaw;
      actor.collider.vx = actor.vx;
      actor.collider.vz = actor.vz;

      actor.wake.dirX = Math.sin(actor.yaw);
      actor.wake.dirZ = Math.cos(actor.yaw);
      actor.wake.x = actor.x - actor.wake.dirX * actor.collider.hz * 0.88;
      actor.wake.z = actor.z - actor.wake.dirZ * actor.collider.hz * 0.88;
      actor.wake.speed = actor.speed;
    }
  }

  syncVisuals(): void {
    for (const actor of this.actors) {
      actor.wakeMesh.visible = false;
    }
  }

  getFloatingBodies(): FloatingBodySpec[] {
    return this.actors.map((actor) => ({
      id: actor.id,
      kind: 'traffic',
      root: actor.root,
      halfLength: actor.collider.hz,
      halfWidth: actor.collider.hx,
      restY: 0.045,
      getPose: () => ({ x: actor.x, z: actor.z, yaw: actor.yaw }),
    }));
  }

  getColliders(): readonly MovingOBB[] {
    return this.colliders;
  }

  getWakeEmitters(): readonly WakeEmitter[] {
    return this.wakes;
  }

  getCount(): number {
    return this.actors.length;
  }

  nearestThreat(player: BoatState): TrafficThreat | null {
    let nearest: TrafficThreat | null = null;
    for (const actor of this.actors) {
      const dx = actor.x - player.x;
      const dz = actor.z - player.z;
      const distance = Math.hypot(dx, dz);
      if (nearest && distance >= nearest.distance) continue;
      const relativeX = actor.vx - player.vx;
      const relativeZ = actor.vz - player.vz;
      nearest = { distance, closing: dx * relativeX + dz * relativeZ < 0 };
    }
    return nearest;
  }

  notifyCollision(sourceId: string | undefined): void {
    if (!sourceId) return;
    const actor = this.actors.find((candidate) => candidate.id === sourceId);
    if (actor) actor.impactSlow = Math.max(actor.impactSlow, 0.85);
  }

  dispose(): void {
    this.group.clear();
    this.actors.length = 0;
    this.colliders.length = 0;
    this.wakes.length = 0;
    this.wakeGeometry.dispose();
    this.wakeMaterial.dispose();
  }
}

function predictedSeparation(
  actor: { x: number; z: number; vx: number; vz: number },
  player: BoatState,
  horizon: number,
): number {
  const dx = actor.x - player.x;
  const dz = actor.z - player.z;
  const dvx = actor.vx - player.vx;
  const dvz = actor.vz - player.vz;
  const speedSq = dvx * dvx + dvz * dvz;
  if (speedSq < 1e-5) return Math.hypot(dx, dz);
  const time = THREE.MathUtils.clamp(-(dx * dvx + dz * dvz) / speedSq, 0, horizon);
  return Math.hypot(dx + dvx * time, dz + dvz * time);
}

function createWakeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const near = new THREE.Color('#effffc');
  const far = new THREE.Color('#55a6bb');
  const segments = 12;

  for (const side of [-1, 1]) {
    const vertexOffset = positions.length / 3;
    for (let step = 0; step <= segments; step += 1) {
      const behind = 0.7 + step * 0.9;
      const centerX = side * behind * 0.38;
      const centerZ = -behind;
      const width = 0.13 + step * 0.012;
      positions.push(centerX - width, 0, centerZ, centerX + width, 0, centerZ);
      const color = near.clone().lerp(far, step / segments);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (step < segments) {
        const base = vertexOffset + step * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}
