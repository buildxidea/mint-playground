import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { VEHICLE_MODEL } from '../assets/manifest';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import {
  groundVehicleMesh,
  measureAsphaltClearance,
  measureGroundClearance,
} from '../vehicles/groundVehicle';
import { vehicleColliderHalfExtents } from '../vehicles/profiles';
import type { ChallengeDef, ParkingSpaceDef, RoadMarkDef } from './challenges';
import {
  GenericParkedCarFactory,
  isGenericParkedCar,
  parkedVehicleSpec,
} from './GenericParkedCars';
import { ParkingLotPropFactory } from './ParkingLotProps';
import {
  VISIBLE_ASPHALT_BOUNDS,
  VISIBLE_ASPHALT_DEPTH,
  VISIBLE_ASPHALT_WIDTH,
} from './asphalt';
import { shouldPlaceWheelStop } from './placement';

const LINE_W = 0.1;

/** Reusable procedural support kit for the imported Mint parking assets. */
export class ParkingLotArt {
  private readonly genericCars = new GenericParkedCarFactory();
  private readonly props = new ParkingLotPropFactory();
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly poleGeometry = new THREE.CylinderGeometry(0.09, 0.13, 5.4, 10);
  private readonly lampGeometry = new THREE.BoxGeometry(0.55, 0.16, 0.32);
  private readonly contactGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly whiteMark = new THREE.MeshBasicMaterial({ color: '#f4f0dc' });
  private readonly yellowMark = new THREE.MeshBasicMaterial({ color: '#f6c344' });
  private readonly curbMaterial = new THREE.MeshStandardMaterial({
    color: '#c7c4b9',
    roughness: 0.92,
  });
  private readonly grassMaterial = new THREE.MeshStandardMaterial({
    color: '#66865d',
    roughness: 1,
  });
  private readonly concreteMaterial = new THREE.MeshStandardMaterial({
    color: '#969790',
    roughness: 0.96,
  });
  private readonly asphaltMaterial = createAsphaltMaterial();
  private readonly poleMaterial = new THREE.MeshStandardMaterial({
    color: '#24323a',
    roughness: 0.55,
    metalness: 0.35,
  });
  private readonly lampMaterial = new THREE.MeshStandardMaterial({
    color: '#fff2bd',
    emissive: '#ffd46a',
    emissiveIntensity: 0.85,
    roughness: 0.35,
  });
  private readonly wheelStopMaterial = new THREE.MeshStandardMaterial({
    color: '#d9d4c5',
    roughness: 0.9,
  });
  private readonly contactMaterial = new THREE.MeshBasicMaterial({
    color: '#182027',
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });

  buildShared(root: THREE.Group, floorY: number): void {
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(74, 56), this.grassMaterial);
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = floorY - 0.31;
    surround.receiveShadow = true;
    this.markShared(surround);
    root.add(surround);

    const apron = new THREE.Mesh(new THREE.BoxGeometry(29, 0.22, 23), this.concreteMaterial);
    apron.position.y = floorY - 0.25;
    apron.receiveShadow = true;
    this.markShared(apron);
    root.add(apron);

    // A flat, matte wearing course keeps the drive surface evenly readable.
    // The imported lot remains underneath for authored bounds/shape, while
    // this deterministic fine aggregate avoids its baked lighting gradient.
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(VISIBLE_ASPHALT_WIDTH, VISIBLE_ASPHALT_DEPTH),
      this.asphaltMaterial,
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.y = floorY + 0.006;
    asphalt.receiveShadow = true;
    this.markShared(asphalt);
    root.add(asphalt);

    // Visual curbs align with the four physics bounds so the lot never ends at
    // an invisible wall. Parked rows still retain at least 0.7m rear clearance.
    const curbs = [
      this.box(0, floorY + 0.11, -9.78, 25.8, 0.22, 0.32, this.curbMaterial),
      this.box(0, floorY + 0.11, 9.78, 25.8, 0.22, 0.32, this.curbMaterial),
      this.box(-12.78, floorY + 0.11, 0, 0.32, 0.22, 19.3, this.curbMaterial),
      this.box(12.78, floorY + 0.11, 0, 0.32, 0.22, 19.3, this.curbMaterial),
    ];
    for (const curb of curbs) {
      curb.castShadow = true;
      curb.receiveShadow = true;
      this.markShared(curb);
      root.add(curb);
    }

    for (const [x, z] of [
      [-14.2, -11.1],
      [14.2, -11.1],
      [-14.2, 11.1],
      [14.2, 11.1],
    ] as const) {
      const light = this.createLotLight(x, z, floorY);
      this.markShared(light);
      root.add(light);
    }

    // A few landscaped scale cues live outside the driveable wall.
    for (const [x, z] of [
      [-14.7, -5.6],
      [14.7, 5.7],
      [-8.8, 11.5],
      [8.6, -11.5],
    ] as const) {
      const island = this.createPlanter(x, z, floorY);
      this.markShared(island);
      root.add(island);
    }

    // Background-only local prop kit. Every piece stays beyond the Rapier lot
    // walls, adding parking context without narrowing any authored route.
    const propSet = this.props.createSet(floorY);
    this.markShared(propSet);
    root.add(propSet);
  }

  buildChallenge(
    root: THREE.Group,
    challenge: ChallengeDef,
    assets: AssetLibrary,
    physics: PhysicsWorld,
  ): {
    parkedCars: number;
    genericCars: number;
    parkingSpaces: number;
    minParkedGroundClearance: number;
    maxParkedGroundClearance: number;
    minParkedAsphaltClearance: number;
    parkedGroundClearances: Array<{ label: string; clearance: number }>;
  } {
    const floorY = physics.getFloorY();
    const stallMarks = this.createStallMarkings(challenge.parkingSpaces, floorY);
    stallMarks.userData.challengeProp = true;
    this.markShared(stallMarks);
    root.add(stallMarks);

    for (const mark of challenge.roadMarks) {
      const object = this.createRoadMark(mark, floorY);
      object.userData.challengeProp = true;
      this.markShared(object);
      root.add(object);
    }

    let parkedCars = 0;
    let genericCars = 0;
    const groundClearances: number[] = [];
    const parkedGroundClearances: Array<{ label: string; clearance: number }> = [];
    const asphaltClearances: number[] = [];
    for (const stall of challenge.parkingSpaces) {
      if (!stall.occupied) continue;
      parkedCars += 1;
      const spec = parkedVehicleSpec(stall.occupied.vehicle);
      const car = isGenericParkedCar(stall.occupied.vehicle)
        ? this.genericCars.create(stall.occupied.vehicle, stall.occupied.tint)
        : assets.cloneModel(VEHICLE_MODEL[stall.occupied.vehicle], {
            tint: stall.occupied.tint,
            castShadow: false,
          });
      if (isGenericParkedCar(stall.occupied.vehicle)) genericCars += 1;
      car.userData.challengeProp = true;
      car.userData.parkedCar = true;
      groundVehicleMesh(car, stall.x, stall.z, stall.yaw, floorY);
      const parkedLabel =
        `parked-${stall.occupied.vehicle}@${stall.x.toFixed(2)},${stall.z.toFixed(2)}`;
      const groundClearance = measureGroundClearance(car, floorY);
      groundClearances.push(groundClearance);
      parkedGroundClearances.push({ label: parkedLabel, clearance: groundClearance });
      asphaltClearances.push(measureAsphaltClearance(car, VISIBLE_ASPHALT_BOUNDS));
      root.add(car);

      const shadow = new THREE.Mesh(this.contactGeometry, this.contactMaterial);
      shadow.position.set(stall.x, floorY + 0.035, stall.z);
      shadow.rotation.order = 'YXZ';
      shadow.rotation.y = stall.yaw;
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.set(spec.width * 1.08, spec.length * 0.92, 1);
      shadow.userData.challengeProp = true;
      this.markShared(shadow);
      root.add(shadow);

      const half = vehicleColliderHalfExtents(spec);
      physics.addStaticBox({
        x: stall.x,
        y: floorY + spec.height * 0.38,
        z: stall.z,
        hx: half.hx,
        hy: spec.height * 0.38,
        hz: half.hz,
        yaw: stall.yaw,
        tag: 'obstacle',
        label: parkedLabel,
      });
    }

    return {
      parkedCars,
      genericCars,
      parkingSpaces: challenge.parkingSpaces.length,
      minParkedGroundClearance: groundClearances.length
        ? Math.min(...groundClearances)
        : 0,
      maxParkedGroundClearance: groundClearances.length
        ? Math.max(...groundClearances)
        : 0,
      minParkedAsphaltClearance: asphaltClearances.length
        ? Math.min(...asphaltClearances)
        : 0,
      parkedGroundClearances,
    };
  }

  private createStallMarkings(spaces: ParkingSpaceDef[], floorY: number): THREE.Group {
    const group = new THREE.Group();
    const lineCount = spaces.length * 3;
    const lines = new THREE.InstancedMesh(this.unitBox, this.whiteMark, lineCount);
    lines.name = 'parking-stall-lines';
    lines.receiveShadow = true;
    const wheelStops = new THREE.InstancedMesh(
      this.unitBox,
      this.wheelStopMaterial,
      spaces.filter(shouldPlaceWheelStop).length,
    );
    wheelStops.name = 'parking-wheel-stops';
    wheelStops.castShadow = true;
    wheelStops.receiveShadow = true;

    const transform = new THREE.Object3D();
    let lineIndex = 0;
    let stopIndex = 0;
    for (const space of spaces) {
      const fx = Math.sin(space.yaw);
      const fz = Math.cos(space.yaw);
      const rx = Math.cos(space.yaw);
      const rz = -Math.sin(space.yaw);
      for (const side of [-1, 1]) {
        transform.position.set(
          space.x + rx * (space.width / 2) * side,
          floorY + 0.028,
          space.z + rz * (space.width / 2) * side,
        );
        transform.rotation.set(0, space.yaw, 0);
        transform.scale.set(LINE_W, 0.035, space.length);
        transform.updateMatrix();
        lines.setMatrixAt(lineIndex, transform.matrix);
        lineIndex += 1;
      }

      transform.position.set(
        space.x - fx * (space.length / 2),
        floorY + 0.028,
        space.z - fz * (space.length / 2),
      );
      transform.rotation.set(0, space.yaw, 0);
      transform.scale.set(space.width + LINE_W, 0.035, LINE_W);
      transform.updateMatrix();
      lines.setMatrixAt(lineIndex, transform.matrix);
      lineIndex += 1;

      // Perpendicular/angled stalls get a concrete wheel stop at the closed end.
      if (shouldPlaceWheelStop(space)) {
        transform.position.set(
          space.x - fx * (space.length / 2 - 0.42),
          floorY + 0.105,
          space.z - fz * (space.length / 2 - 0.42),
        );
        transform.rotation.set(0, space.yaw, 0);
        transform.scale.set(Math.min(1.85, space.width * 0.7), 0.2, 0.22);
        transform.updateMatrix();
        wheelStops.setMatrixAt(stopIndex, transform.matrix);
        stopIndex += 1;
      }
    }
    lines.instanceMatrix.needsUpdate = true;
    wheelStops.instanceMatrix.needsUpdate = true;
    group.add(lines, wheelStops);
    return group;
  }

  private createRoadMark(mark: RoadMarkDef, floorY: number): THREE.Object3D {
    if (mark.kind === 'arrow') {
      const shape = new THREE.Shape();
      shape.moveTo(-0.24, -1.15);
      shape.lineTo(0.24, -1.15);
      shape.lineTo(0.24, 0.25);
      shape.lineTo(0.62, 0.25);
      shape.lineTo(0, 1.2);
      shape.lineTo(-0.62, 0.25);
      shape.lineTo(-0.24, 0.25);
      shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.yellowMark);
      mesh.userData.disposeGeometry = true;
      mesh.position.set(mark.x, floorY + 0.04, mark.z);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = mark.yaw;
      mesh.rotation.x = -Math.PI / 2;
      return mesh;
    }

    if (mark.kind === 'stop-line') {
      const mesh = new THREE.Mesh(this.unitBox, this.whiteMark);
      mesh.position.set(mark.x, floorY + 0.03, mark.z);
      mesh.rotation.y = mark.yaw;
      mesh.scale.set(3.1, 0.035, 0.16);
      return mesh;
    }

    const group = new THREE.Group();
    for (let i = -3; i <= 3; i += 1) {
      const strip = new THREE.Mesh(this.unitBox, this.whiteMark);
      strip.position.set(i * 0.55, 0, 0);
      strip.scale.set(0.32, 0.035, 3.4);
      group.add(strip);
    }
    group.position.set(mark.x, floorY + 0.03, mark.z);
    group.rotation.y = mark.yaw;
    return group;
  }

  private createLotLight(x: number, z: number, floorY: number): THREE.Group {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(this.poleGeometry, this.poleMaterial);
    pole.position.y = 2.7;
    pole.castShadow = true;
    const arm = new THREE.Mesh(this.unitBox, this.poleMaterial);
    arm.position.set(0.34, 5.28, 0);
    arm.scale.set(0.72, 0.1, 0.1);
    const lamp = new THREE.Mesh(this.lampGeometry, this.lampMaterial);
    lamp.position.set(0.7, 5.22, 0);
    group.add(pole, arm, lamp);
    group.position.set(x, floorY, z);
    const aim = Math.atan2(-x, -z);
    group.rotation.y = aim;
    return group;
  }

  private createPlanter(x: number, z: number, floorY: number): THREE.Group {
    const group = new THREE.Group();
    const base = this.box(0, 0.13, 0, 2.4, 0.26, 1.1, this.curbMaterial);
    const soil = this.box(0, 0.26, 0, 2.08, 0.09, 0.8, this.grassMaterial);
    const shrubMat = new THREE.MeshStandardMaterial({ color: '#3e6e48', roughness: 1 });
    for (const sx of [-0.65, 0, 0.65]) {
      const shrub = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), shrubMat);
      shrub.position.set(sx, 0.58, 0);
      shrub.scale.y = 0.75;
      group.add(shrub);
    }
    group.add(base, soil);
    group.position.set(x, floorY, z);
    return group;
  }

  private box(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.unitBox, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  }

  private markShared(object: THREE.Object3D): void {
    object.userData.sharedParkingArt = true;
    object.traverse((child) => {
      child.userData.sharedParkingArt = true;
    });
  }
}

function createAsphaltMaterial(): THREE.MeshStandardMaterial {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  let state = 0x9e3779b9;
  const random = (): number => {
    state = (Math.imul(state ^ (state >>> 15), 2246822519) + 3266489917) >>> 0;
    return state / 0xffffffff;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const broad = Math.sin(x * 0.31) * 2 + Math.cos(y * 0.27) * 2;
      const aggregate = random() > 0.965 ? 13 : 0;
      const value = Math.round(68 + broad + (random() - 0.5) * 10 + aggregate);
      pixels[i] = value;
      pixels[i + 1] = value - 2;
      pixels[i + 2] = value - 5;
      pixels[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 9);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.98, metalness: 0 });
}
