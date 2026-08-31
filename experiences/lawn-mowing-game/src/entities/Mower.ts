import * as THREE from 'three';
import type { YardGeometry } from '../systems/YardGeometry';

export type Heading = 'north' | 'south' | 'east' | 'west';

/** Forward is +Z at heading 0, so the angle maps straight onto rotation.y. */
export const HEADING_ANGLE: Record<Heading, number> = {
  south: 0,
  east: Math.PI / 2,
  north: Math.PI,
  west: -Math.PI / 2,
};

export type MowerConfig = {
  speed: number;
  boostMultiplier: number;
  turnSpeed: number;
  /** Full cutting width of the deck. */
  deckWidth: number;
  /** Collision radius of the chassis. */
  bodyRadius: number;
  /** Below this heading error the mower drives; above it, it turns in place. */
  driveThreshold: number;
};

export const DEFAULT_MOWER: MowerConfig = {
  speed: 4.2,
  boostMultiplier: 1.6,
  turnSpeed: 11,
  deckWidth: 1.25,
  bodyRadius: 0.52,
  driveThreshold: 0.3,
};

/** Quarter turn counter-clockwise, aligning the generated model's nose with the
 *  direction the mower actually drives. */
const MODEL_YAW_OFFSET = Math.PI / 2;

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export class Mower {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector2();
  readonly forward = new THREE.Vector2(0, 1);

  /** Where the mower actually points, in radians. */
  angle = 0;
  /** Where the player has asked it to point. */
  targetAngle = 0;
  moving = false;
  stalled = false;
  stallTimer = 0;

  private placeholder: THREE.Group | null = null;
  private model: THREE.Object3D | null = null;
  private readonly config: MowerConfig;
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(config: MowerConfig = DEFAULT_MOWER) {
    this.config = config;
    this.placeholder = this.buildPlaceholder();
    this.group.add(this.placeholder);
  }

  get deckRadius(): number {
    return this.config.deckWidth / 2;
  }

  /** Where clippings are thrown from, in world space. */
  dischargePoint(target: THREE.Vector3): THREE.Vector3 {
    const right = new THREE.Vector2(this.forward.y, -this.forward.x);
    return target.set(
      this.position.x + right.x * this.deckRadius + this.forward.x * 0.15,
      0.18,
      this.position.y + right.y * this.deckRadius + this.forward.y * 0.15,
    );
  }

  reset(x: number, z: number, heading: Heading): void {
    this.position.set(x, z);
    this.angle = HEADING_ANGLE[heading];
    this.targetAngle = this.angle;
    this.moving = false;
    this.stalled = false;
    this.stallTimer = 0;
    this.syncTransform();
  }

  /**
   * One fixed simulation step. Returns the distance actually travelled so the
   * caller can decide whether to paint.
   */
  step(delta: number, requested: Heading | null, boosting: boolean, yard: YardGeometry): number {
    this.stalled = false;
    if (requested) this.targetAngle = HEADING_ANGLE[requested];

    const turnDelta = shortestAngleDelta(this.angle, this.targetAngle);
    const maxTurn = this.config.turnSpeed * delta;
    if (Math.abs(turnDelta) <= maxTurn) {
      this.angle = this.targetAngle;
    } else {
      this.angle += Math.sign(turnDelta) * maxTurn;
    }

    this.forward.set(Math.sin(this.angle), Math.cos(this.angle));

    const aligned = Math.abs(shortestAngleDelta(this.angle, this.targetAngle)) < this.config.driveThreshold;
    this.moving = Boolean(requested) && aligned;

    let travelled = 0;
    if (this.moving) {
      const speed = this.config.speed * (boosting ? this.config.boostMultiplier : 1);
      const step = speed * delta;
      const nextX = this.position.x + this.forward.x * step;
      const nextZ = this.position.y + this.forward.y * step;

      if (yard.canOccupy(nextX, nextZ, this.config.bodyRadius)) {
        this.position.set(nextX, nextZ);
        travelled = step;
        this.stallTimer = 0;
      } else {
        this.stalled = true;
        this.moving = false;
        this.stallTimer += delta;
      }
    } else {
      this.stallTimer = 0;
    }

    this.syncTransform();
    return travelled;
  }

  setModel(model: THREE.Object3D, targetLength: number): void {
    if (this.placeholder) {
      this.group.remove(this.placeholder);
      this.placeholder = null;
    }
    if (this.model) this.group.remove(this.model);

    // The generated mower is authored facing a different axis than the
    // gameplay forward (+Z at heading 0), so correct it once here rather than
    // bending the movement code around the art.
    model.rotation.y = MODEL_YAW_OFFSET;

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = targetLength / Math.max(1e-3, Math.max(size.x, size.z));
    model.scale.setScalar(scale);

    // Recomputed after the yaw and scale, so the wheels sit on the turf.
    const scaledBox = new THREE.Box3().setFromObject(model);
    model.position.y -= scaledBox.min.y;

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = false;
      }
    });

    this.model = model;
    this.group.add(model);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  private syncTransform(): void {
    this.group.position.set(this.position.x, 0, this.position.y);
    this.group.rotation.y = this.angle;
  }

  private buildPlaceholder(): THREE.Group {
    const group = new THREE.Group();
    const body = this.track(new THREE.BoxGeometry(0.9, 0.42, 1.5));
    const bodyMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#d64533', roughness: 0.55 }),
    );
    const bodyMesh = new THREE.Mesh(body, bodyMaterial);
    bodyMesh.position.y = 0.46;
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    const deck = this.track(new THREE.BoxGeometry(this.config.deckWidth, 0.22, 0.9));
    const deckMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#3b3f42', roughness: 0.8 }),
    );
    const deckMesh = new THREE.Mesh(deck, deckMaterial);
    deckMesh.position.set(0, 0.2, 0.42);
    deckMesh.castShadow = true;
    group.add(deckMesh);

    const seat = this.track(new THREE.BoxGeometry(0.5, 0.36, 0.34));
    const seatMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#232629', roughness: 0.7 }),
    );
    const seatMesh = new THREE.Mesh(seat, seatMaterial);
    seatMesh.position.set(0, 0.82, -0.42);
    group.add(seatMesh);

    const wheelGeometry = this.track(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 16));
    const wheelMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#1b1d1f', roughness: 0.9 }),
    );
    const wheelPositions: [number, number, number][] = [
      [-0.5, 0.26, -0.5],
      [0.5, 0.26, -0.5],
      [-0.44, 0.2, 0.62],
      [0.44, 0.2, 0.62],
    ];
    for (const [x, y, z] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, y, z);
      wheel.castShadow = true;
      group.add(wheel);
    }

    return group;
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(item: T): T {
    this.disposables.push(item);
    return item;
  }
}
