import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fitMintModel, loadMintModel } from '../assets/MintAssetLibrary';
import type { CollisionCircle, PlanarPose } from '../systems/CollisionSystem';

export type VehicleIntent = {
  throttle: number;
  steer: number;
  brake: boolean;
};

export type VehicleTuning = {
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  forwardAcceleration: number;
  reverseAcceleration: number;
  brakeDeceleration: number;
  directionChangeDeceleration: number;
  rollingDrag: number;
  wheelBase: number;
  maxSteeringAngle: number;
  steeringResponse: number;
};

export const VEHICLE_TUNING: VehicleTuning = {
  maxForwardSpeed: 6.9,
  maxReverseSpeed: 3.25,
  forwardAcceleration: 4.4,
  reverseAcceleration: 3.7,
  brakeDeceleration: 10.8,
  directionChangeDeceleration: 7.4,
  rollingDrag: 1.35,
  wheelBase: 1.87,
  maxSteeringAngle: THREE.MathUtils.degToRad(31),
  steeringResponse: 7.2,
};

const WHEEL_RADIUS = 0.31;
const COLLISION_CONTACT_GRACE = 0.12;
const HEAD_ON_CONTACT_ALIGNMENT = 0.82;

export class IceResurfacer {
  readonly group = new THREE.Group();
  readonly collisionFootprint: readonly CollisionCircle[] = [
    { localX: 0, localZ: -1.02, radius: 0.82 },
    { localX: 0, localZ: 0, radius: 0.92 },
    { localX: 0, localZ: 0.98, radius: 0.88 },
    { localX: -0.67, localZ: 1.57, radius: 0.45 },
    { localX: 0.67, localZ: 1.57, radius: 0.45 },
  ];

  speed = 0;
  steerVisual = 0;
  steeringAngle = 0;
  private pose: PlanarPose = { x: 0, z: 0, heading: 0 };
  private wheelTravel = 0;
  private impactLean = 0;
  private collisionContactGrace = 0;
  private cleanerLift = 0.2;
  private resurfacing = false;
  private readonly wheelSpinPivots: THREE.Group[] = [];
  private readonly frontWheelPivots: THREE.Group[] = [];
  private readonly proceduralWheels: THREE.Group[] = [];
  private readonly brushes: THREE.Group[] = [];
  private readonly proceduralBody = new THREE.Group();
  private readonly proceduralCleaner = new THREE.Group();
  private readonly cleanerAssembly = new THREE.Group();
  private readonly beaconMaterial = new THREE.MeshStandardMaterial({
    color: '#ff734d',
    emissive: '#ff3d25',
    emissiveIntensity: 0.8,
    roughness: 0.28,
  });
  private readonly waterMaterial = new THREE.MeshBasicMaterial({
    color: '#8feaff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];
  private disposed = false;
  readonly mintPresentationReady: Promise<void>;

  constructor() {
    this.group.name = 'iceResurfacer';
    this.proceduralBody.name = 'proceduralResurfacerBodyFallback';
    this.proceduralCleaner.name = 'proceduralCleanerFallback';
    this.group.add(this.proceduralBody);
    this.buildModel();
    this.commitPose(this.pose);
    this.mintPresentationReady =
      typeof window === 'undefined'
        ? Promise.resolve()
        : this.loadMintPresentation().catch((error: unknown) => {
            console.warn('Mint resurfacer presentation could not be loaded.', error);
          });
  }

  reset(x: number, z: number, heading: number): void {
    this.speed = 0;
    this.steerVisual = 0;
    this.steeringAngle = 0;
    this.wheelTravel = 0;
    this.impactLean = 0;
    this.collisionContactGrace = 0;
    this.cleanerLift = this.resurfacing ? 0 : 0.2;
    this.pose = { x, z, heading };
    this.commitPose(this.pose);
  }

  propose(delta: number, intent: VehicleIntent, tuning = VEHICLE_TUNING): PlanarPose {
    this.collisionContactGrace = Math.max(0, this.collisionContactGrace - delta);
    const throttle = THREE.MathUtils.clamp(intent.throttle, -1, 1);
    const steer = THREE.MathUtils.clamp(intent.steer, -1, 1);
    const steeringTarget = steer * tuning.maxSteeringAngle;
    const steeringFactor = 1 - Math.exp(-tuning.steeringResponse * delta);
    this.steeringAngle = THREE.MathUtils.lerp(this.steeringAngle, steeringTarget, steeringFactor);

    if (intent.brake) {
      this.speed = this.moveToward(this.speed, 0, tuning.brakeDeceleration * delta);
    } else if (Math.abs(throttle) > 0.001) {
      const changingDirection = Math.abs(this.speed) > 0.06 && Math.sign(throttle) !== Math.sign(this.speed);
      if (changingDirection) {
        this.speed = this.moveToward(this.speed, 0, tuning.directionChangeDeceleration * Math.abs(throttle) * delta);
      } else {
        const acceleration = throttle > 0 ? tuning.forwardAcceleration : tuning.reverseAcceleration;
        this.speed += throttle * acceleration * delta;
      }
    } else {
      this.speed = this.moveToward(this.speed, 0, tuning.rollingDrag * delta);
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -tuning.maxReverseSpeed, tuning.maxForwardSpeed);
    if (Math.abs(this.speed) < 0.002) this.speed = 0;

    const yawRate = this.speed === 0 ? 0 : (this.speed / tuning.wheelBase) * Math.tan(this.steeringAngle);
    const heading = this.wrapAngle(this.pose.heading + yawRate * delta);
    const forwardX = Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    this.steerVisual = this.steeringAngle / tuning.maxSteeringAngle;
    return {
      x: this.pose.x + forwardX * this.speed * delta,
      z: this.pose.z + forwardZ * this.speed * delta,
      heading,
    };
  }

  commitPose(pose: PlanarPose): number {
    const distance = Math.hypot(pose.x - this.pose.x, pose.z - this.pose.z);
    this.wheelTravel += distance * Math.sign(this.speed || 1);
    this.pose = { ...pose };
    this.group.position.set(pose.x, 0.08, pose.z);
    // Three.js positive Y rotation turns local -Z toward -X, while the
    // simulation's positive heading turns forward toward +X.
    this.group.rotation.y = -pose.heading;
    return distance;
  }

  collide(normalX = 0, normalZ = 0): void {
    const newContact = this.collisionContactGrace <= 0;
    this.collisionContactGrace = COLLISION_CONTACT_GRACE;
    const normalLength = Math.hypot(normalX, normalZ);
    if (normalLength > 0.0001 && Math.abs(this.speed) > 0.001) {
      const velocityX = Math.sin(this.pose.heading) * this.speed;
      const velocityZ = -Math.cos(this.pose.heading) * this.speed;
      const approachSpeed = velocityX * (normalX / normalLength) + velocityZ * (normalZ / normalLength);
      if (approachSpeed < 0) {
        const alignment = Math.min(1, Math.abs(approachSpeed) / Math.abs(this.speed));
        if (alignment >= HEAD_ON_CONTACT_ALIGNMENT) {
          // Keep square impacts decisive, including while the throttle remains
          // pressed into the boards. Once the driver steers, preserve enough
          // crawl speed for the bicycle model to rotate away from the contact.
          const activelySteering = Math.abs(this.steeringAngle) > THREE.MathUtils.degToRad(4);
          this.speed *= newContact
            ? Math.max(0.04, 1 - alignment * 1.08)
            : activelySteering ? 0.94 : 0.08;
        } else if (newContact) {
          // A corner brush is one impact, not sixty impacts per second. Retain
          // tangential speed on sustained contact so steering can carry the
          // long chassis and rear blade around the rounded boards.
          this.speed *= Math.max(0.74, 1 - alignment * alignment * 0.72);
        }
      }
    } else {
      this.speed *= 0.08;
    }
    if (newContact) this.impactLean = 0.18;
  }

  setResurfacing(active: boolean): void {
    this.resurfacing = active;
  }

  updateVisual(delta: number, elapsed: number, reducedMotion: boolean): void {
    this.impactLean = THREE.MathUtils.lerp(this.impactLean, 0, 1 - Math.exp(-delta * 10));
    this.group.rotation.z = this.impactLean;
    for (const pivot of this.wheelSpinPivots) pivot.rotation.x = this.wheelTravel / WHEEL_RADIUS;
    for (const pivot of this.frontWheelPivots) pivot.rotation.y = -this.steeringAngle;
    this.cleanerLift = THREE.MathUtils.lerp(this.cleanerLift, this.resurfacing ? 0 : 0.2, 1 - Math.exp(-delta * 12));
    this.cleanerAssembly.position.y = this.cleanerLift;
    const animationTime = reducedMotion ? 0 : elapsed;
    for (const brush of this.brushes) brush.rotation.y = this.resurfacing ? animationTime * 10 : 0;
    this.beaconMaterial.emissiveIntensity = this.resurfacing
      ? 1.8 + Math.sin(animationTime * 12) * 0.55
      : 0.55 + Math.sin(animationTime * 3) * 0.12;
    this.waterMaterial.opacity = this.resurfacing ? 0.36 + Math.sin(animationTime * 9) * 0.07 : 0;
  }

  getPose(): PlanarPose {
    return { ...this.pose };
  }

  getToolPose(): PlanarPose {
    const forwardX = Math.sin(this.pose.heading);
    const forwardZ = -Math.cos(this.pose.heading);
    return {
      x: this.pose.x - forwardX * 1.58,
      z: this.pose.z - forwardZ * 1.58,
      heading: this.pose.heading,
    };
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(Math.sin(this.pose.heading), 0, -Math.cos(this.pose.heading));
  }

  dispose(): void {
    this.disposed = true;
    for (const geometry of this.disposableGeometries) geometry.dispose();
    for (const material of this.disposableMaterials) material.dispose();
    this.beaconMaterial.dispose();
    this.waterMaterial.dispose();
  }

  private buildModel(): void {
    const paint = this.material(new THREE.MeshPhysicalMaterial({
      color: '#0d8fa4', roughness: 0.25, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.12,
    }));
    const cream = this.material(new THREE.MeshPhysicalMaterial({
      color: '#f4f0df', roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.22,
    }));
    const navy = this.material(new THREE.MeshStandardMaterial({ color: '#102c43', roughness: 0.42, metalness: 0.12 }));
    const metal = this.material(new THREE.MeshStandardMaterial({ color: '#94adba', roughness: 0.35, metalness: 0.82 }));
    const rubber = this.material(new THREE.MeshStandardMaterial({ color: '#071319', roughness: 0.92 }));
    const glass = this.material(new THREE.MeshPhysicalMaterial({
      color: '#9cecff', roughness: 0.08, transparent: true, opacity: 0.43, clearcoat: 1, depthWrite: false,
    }));
    const coral = this.material(new THREE.MeshStandardMaterial({ color: '#ff6f4d', roughness: 0.38, emissive: '#5e160c', emissiveIntensity: 0.18 }));

    const chassis = this.mesh(new RoundedBoxGeometry(1.86, 0.38, 3.18, 5, 0.18), navy);
    chassis.position.y = 0.48;
    chassis.name = 'chassis';
    this.proceduralBody.add(chassis);

    const body = this.mesh(new RoundedBoxGeometry(1.78, 0.95, 2.15, 6, 0.22), paint);
    body.position.set(0, 0.94, 0.32);
    body.name = 'mainTank';
    this.proceduralBody.add(body);

    const tankTop = this.mesh(new RoundedBoxGeometry(1.48, 0.27, 1.35, 4, 0.12), cream);
    tankTop.position.set(0, 1.48, 0.55);
    this.proceduralBody.add(tankTop);

    const cabBase = this.mesh(new RoundedBoxGeometry(1.58, 0.76, 1.2, 5, 0.18), cream);
    cabBase.position.set(0, 1.12, -0.92);
    this.proceduralBody.add(cabBase);
    const windscreen = this.mesh(new RoundedBoxGeometry(1.34, 0.6, 0.09, 4, 0.08), glass);
    windscreen.position.set(0, 1.32, -1.535);
    windscreen.rotation.x = -0.12;
    windscreen.name = 'cabGlass';
    this.proceduralBody.add(windscreen);

    const roof = this.mesh(new RoundedBoxGeometry(1.58, 0.16, 1.1, 4, 0.08), coral);
    roof.position.set(0, 1.7, -0.93);
    this.proceduralBody.add(roof);

    const seat = this.mesh(new RoundedBoxGeometry(0.56, 0.55, 0.45, 4, 0.1), navy);
    seat.position.set(0.4, 1.18, -0.75);
    this.proceduralBody.add(seat);
    const steering = this.mesh(new THREE.TorusGeometry(0.19, 0.035, 8, 20), navy);
    steering.position.set(-0.38, 1.42, -1.23);
    steering.rotation.x = Math.PI / 2.6;
    this.proceduralBody.add(steering);

    const bumper = this.mesh(new RoundedBoxGeometry(1.92, 0.25, 0.32, 4, 0.09), coral);
    bumper.position.set(0, 0.51, -1.63);
    this.proceduralBody.add(bumper);

    const ventGeometry = this.geometry(new RoundedBoxGeometry(0.2, 0.08, 0.72, 3, 0.04));
    for (let index = -2; index <= 2; index += 1) {
      const vent = this.mesh(ventGeometry, navy, false);
      vent.position.set(index * 0.27, 1.65, 0.52);
      this.proceduralBody.add(vent);
    }

    const wheelGeometry = this.geometry(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.24, 18));
    const hubGeometry = this.geometry(new THREE.CylinderGeometry(0.13, 0.13, 0.255, 14));
    const wheelPositions: Array<[string, number, number, boolean]> = [
      ['frontLeft', -0.96, -0.92, true],
      ['frontRight', 0.96, -0.92, true],
      ['rearLeft', -0.96, 0.95, false],
      ['rearRight', 0.96, 0.95, false],
    ];
    for (const [name, x, z, steeringWheel] of wheelPositions) {
      const steeringPivot = new THREE.Group();
      steeringPivot.name = `${name}WheelSteeringMount`;
      steeringPivot.position.set(x, 0.43, z);
      const spinPivot = new THREE.Group();
      spinPivot.name = `${name}WheelSpinPivot`;
      const wheel = this.mesh(wheelGeometry, rubber, false);
      wheel.name = `${name}WheelTire`;
      wheel.rotation.z = Math.PI / 2;
      const hub = this.mesh(hubGeometry, coral, false);
      hub.name = `${name}WheelHub`;
      hub.rotation.z = Math.PI / 2;
      const proceduralWheel = new THREE.Group();
      proceduralWheel.name = `${name}ProceduralWheelFallback`;
      proceduralWheel.add(wheel, hub);
      spinPivot.add(proceduralWheel);
      steeringPivot.add(spinPivot);
      this.group.add(steeringPivot);
      this.wheelSpinPivots.push(spinPivot);
      this.proceduralWheels.push(proceduralWheel);
      if (steeringWheel) this.frontWheelPivots.push(steeringPivot);
    }

    const brushGeometry = this.geometry(new THREE.CylinderGeometry(0.38, 0.42, 0.14, 18));
    for (const x of [-0.68, 0.68]) {
      const brush = new THREE.Group();
      brush.position.set(x, 0.26, 1.34);
      const disc = this.mesh(brushGeometry, coral, false);
      for (let index = 0; index < 8; index += 1) {
        const bristle = this.mesh(new THREE.BoxGeometry(0.05, 0.06, 0.45), navy);
        bristle.position.z = 0.22;
        bristle.rotation.y = (index / 8) * Math.PI * 2;
        brush.add(bristle);
      }
      brush.add(disc);
      this.brushes.push(brush);
      brush.name = 'proceduralResurfacerBrush';
      this.proceduralCleaner.add(brush);
    }

    const blade = this.mesh(new RoundedBoxGeometry(2.24, 0.18, 0.28, 3, 0.06), metal);
    blade.position.set(0, 0.22, 1.72);
    blade.name = 'resurfacingBlade';
    this.proceduralCleaner.add(blade);
    const waterBar = this.mesh(new THREE.BoxGeometry(2.16, 0.035, 0.62), this.waterMaterial, false);
    waterBar.position.set(0, 0.075, 1.56);
    this.proceduralCleaner.add(waterBar);
    this.cleanerAssembly.add(this.proceduralCleaner);
    this.cleanerAssembly.name = 'rearCleanerAssembly';
    this.cleanerAssembly.position.y = this.cleanerLift;
    this.group.add(this.cleanerAssembly);

    const beaconBase = this.mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.08, 18), navy);
    beaconBase.position.set(0, 1.86, -0.92);
    const beacon = this.mesh(new THREE.SphereGeometry(0.13, 18, 10), this.beaconMaterial, false);
    beacon.scale.y = 1.35;
    beacon.position.set(0, 2.0, -0.92);
    this.proceduralBody.add(beaconBase, beacon);

    for (const object of this.group.children) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = child.material !== glass && child.material !== this.waterMaterial;
          child.receiveShadow = true;
        }
      });
    }
  }

  private async loadMintPresentation(): Promise<void> {
    const [body, wheelTemplate, cleaner] = await Promise.all([
      loadMintModel('hero-resurfacer-body'),
      loadMintModel('hero-resurfacer-wheel'),
      loadMintModel('hero-resurfacer-cleaner'),
    ]);
    if (this.disposed) return;

    fitMintModel(body, new THREE.Vector3(1.86, 2.02, 3.18), {
      rotationY: -Math.PI / 2,
      centerZ: 0,
      groundY: 0.12,
    });
    body.name = 'mintResurfacerBody';
    this.group.add(body);
    this.proceduralBody.visible = false;

    this.wheelSpinPivots.forEach((pivot, index) => {
      const wheel = index === 0 ? wheelTemplate : wheelTemplate.clone(true);
      fitMintModel(wheel, new THREE.Vector3(0.24, WHEEL_RADIUS * 2, WHEEL_RADIUS * 2), {
        rotationY: Math.PI / 2,
        groundY: -WHEEL_RADIUS,
      });
      wheel.name = `${pivot.name}MintWheel`;
      pivot.add(wheel);
      this.proceduralWheels[index].visible = false;
    });

    fitMintModel(cleaner, new THREE.Vector3(2.24, 1.0, 1.1), {
      centerZ: 1.5,
      groundY: 0.04,
    });
    cleaner.name = 'mintRearCleaner';
    this.cleanerAssembly.add(cleaner);
    this.proceduralCleaner.visible = false;
  }

  private mesh<T extends THREE.BufferGeometry>(geometry: T, material: THREE.Material, ownGeometry = true): THREE.Mesh<T> {
    if (ownGeometry) this.disposableGeometries.push(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.disposableGeometries.push(geometry);
    return geometry;
  }

  private material<T extends THREE.Material>(material: T): T {
    this.disposableMaterials.push(material);
    return material;
  }

  private moveToward(value: number, target: number, amount: number): number {
    if (value < target) return Math.min(target, value + amount);
    return Math.max(target, value - amount);
  }

  private wrapAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }
}
