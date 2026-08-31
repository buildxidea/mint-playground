import * as THREE from 'three';
import type { VehicleId } from '../assets/manifest';
import { VEHICLE_PROFILES } from '../vehicles/profiles';

export type GenericParkedCarId =
  | 'generic-sedan'
  | 'generic-hatchback'
  | 'generic-suv'
  | 'generic-pickup';

export type ParkedVehicleId = VehicleId | GenericParkedCarId;

export type ParkedVehicleSpec = {
  width: number;
  length: number;
  height: number;
  source: 'mint-import' | 'local-procedural';
};

export const GENERIC_PARKED_CAR_SPECS: Record<GenericParkedCarId, ParkedVehicleSpec> = {
  'generic-sedan': {
    width: 1.82,
    length: 4.45,
    height: 1.46,
    source: 'local-procedural',
  },
  'generic-hatchback': {
    width: 1.74,
    length: 3.95,
    height: 1.52,
    source: 'local-procedural',
  },
  'generic-suv': {
    width: 1.9,
    length: 4.55,
    height: 1.73,
    source: 'local-procedural',
  },
  'generic-pickup': {
    width: 1.92,
    length: 4.75,
    height: 1.7,
    source: 'local-procedural',
  },
};

export function isGenericParkedCar(id: ParkedVehicleId): id is GenericParkedCarId {
  return id.startsWith('generic-');
}

export function parkedVehicleSpec(id: ParkedVehicleId): ParkedVehicleSpec {
  if (isGenericParkedCar(id)) return GENERIC_PARKED_CAR_SPECS[id];
  const profile = VEHICLE_PROFILES[id];
  return {
    width: profile.width,
    length: profile.length,
    height: profile.height,
    source: 'mint-import',
  };
}

/**
 * Authored low-poly traffic cars for background parking spaces. Geometry and
 * material roles are shared so a full row remains inexpensive to render.
 */
export class GenericParkedCarFactory {
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly wheelGeometry = new THREE.CylinderGeometry(1, 1, 1, 14);
  private readonly hubGeometry = new THREE.CylinderGeometry(1, 1, 1.02, 12);
  private readonly bodyGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly cabinGeometries = new Map<GenericParkedCarId, THREE.BufferGeometry>();
  private readonly paints = new Map<string, THREE.MeshStandardMaterial>();
  private readonly lowerMaterial = new THREE.MeshStandardMaterial({
    color: '#232a2e',
    roughness: 0.72,
    metalness: 0.08,
  });
  private readonly tireMaterial = new THREE.MeshStandardMaterial({
    color: '#121619',
    roughness: 0.88,
  });
  private readonly hubMaterial = new THREE.MeshStandardMaterial({
    color: '#aeb5b7',
    roughness: 0.38,
    metalness: 0.7,
  });
  private readonly glassMaterial = new THREE.MeshStandardMaterial({
    color: '#28414d',
    roughness: 0.18,
    metalness: 0.18,
  });
  private readonly headlightMaterial = new THREE.MeshStandardMaterial({
    color: '#f8f2cf',
    emissive: '#ffe7a0',
    emissiveIntensity: 0.35,
    roughness: 0.25,
  });
  private readonly tailLightMaterial = new THREE.MeshStandardMaterial({
    color: '#a82f2f',
    emissive: '#6d0909',
    emissiveIntensity: 0.28,
    roughness: 0.32,
  });
  private readonly plateMaterial = new THREE.MeshStandardMaterial({
    color: '#dce6df',
    roughness: 0.65,
  });
  private readonly bedMaterial = new THREE.MeshStandardMaterial({
    color: '#30373b',
    roughness: 0.9,
  });

  create(id: GenericParkedCarId, tint: string): THREE.Group {
    const spec = GENERIC_PARKED_CAR_SPECS[id];
    const dims = this.variantDimensions(id, spec);
    const group = new THREE.Group();
    group.name = id;
    group.userData.localProceduralAsset = true;
    group.userData.parkedVehicleId = id;

    const lower = new THREE.Mesh(
      this.getBodyGeometry(id, spec.width * 0.97, spec.length * 0.97, dims.lowerHeight),
      this.lowerMaterial,
    );
    lower.name = 'lower-body-and-rockers';
    lower.position.y = dims.wheelRadius * 0.55;

    const body = new THREE.Mesh(
      this.getBodyGeometry(id, spec.width, spec.length, dims.bodyHeight),
      this.paint(tint),
    );
    body.name = 'painted-body-shell';
    body.position.y = dims.wheelRadius * 0.72;

    const cabinLength = id === 'generic-pickup' ? spec.length * 0.38 : spec.length * dims.cabinRatio;
    const cabin = new THREE.Mesh(
      this.getCabinGeometry(id, spec.width * dims.cabinWidth, cabinLength, dims.cabinHeight),
      this.glassMaterial,
    );
    cabin.name = 'continuous-window-cabin';
    cabin.position.set(0, dims.wheelRadius * 0.72 + dims.bodyHeight * 0.72, dims.cabinZ);

    const roof = new THREE.Mesh(this.unitBox, this.paint(tint));
    roof.name = 'painted-roof-panel';
    roof.scale.set(
      spec.width * dims.cabinWidth * 0.84,
      0.08,
      Math.max(0.85, cabinLength * dims.roofRatio),
    );
    roof.position.set(
      0,
      cabin.position.y + dims.cabinHeight - 0.015,
      dims.cabinZ + (id === 'generic-hatchback' ? -0.06 : 0),
    );

    group.add(lower, body, cabin, roof);
    this.addRunningGear(group, spec, dims.wheelRadius, dims.wheelbase);
    this.addSignals(group, spec, dims);
    this.addVariantDetails(group, id, spec, dims, tint);

    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      // All geometries and materials belong to this persistent factory.
      mesh.userData.sharedParkingArt = true;
    });
    return group;
  }

  private variantDimensions(id: GenericParkedCarId, spec: ParkedVehicleSpec): {
    lowerHeight: number;
    bodyHeight: number;
    cabinHeight: number;
    cabinRatio: number;
    cabinWidth: number;
    cabinZ: number;
    roofRatio: number;
    wheelRadius: number;
    wheelbase: number;
  } {
    if (id === 'generic-hatchback') {
      return {
        lowerHeight: 0.42,
        bodyHeight: 0.67,
        cabinHeight: 0.72,
        cabinRatio: 0.54,
        cabinWidth: 0.88,
        cabinZ: -0.12,
        roofRatio: 0.7,
        wheelRadius: 0.3,
        wheelbase: 2.44,
      };
    }
    if (id === 'generic-suv') {
      return {
        lowerHeight: 0.52,
        bodyHeight: 0.78,
        cabinHeight: 0.79,
        cabinRatio: 0.57,
        cabinWidth: 0.9,
        cabinZ: -0.02,
        roofRatio: 0.76,
        wheelRadius: 0.35,
        wheelbase: 2.72,
      };
    }
    if (id === 'generic-pickup') {
      return {
        lowerHeight: 0.5,
        bodyHeight: 0.74,
        cabinHeight: 0.73,
        cabinRatio: 0.38,
        cabinWidth: 0.9,
        cabinZ: 0.72,
        roofRatio: 0.72,
        wheelRadius: 0.36,
        wheelbase: 2.86,
      };
    }
    return {
      lowerHeight: 0.43,
      bodyHeight: 0.66,
      cabinHeight: 0.68,
      cabinRatio: 0.5,
      cabinWidth: 0.88,
      cabinZ: 0.02,
      roofRatio: 0.66,
      wheelRadius: 0.31,
      wheelbase: Math.min(2.68, spec.length * 0.61),
    };
  }

  private addRunningGear(
    group: THREE.Group,
    spec: ParkedVehicleSpec,
    radius: number,
    wheelbase: number,
  ): void {
    const wheels = new THREE.InstancedMesh(this.wheelGeometry, this.tireMaterial, 4);
    wheels.name = 'four-tires';
    const hubs = new THREE.InstancedMesh(this.hubGeometry, this.hubMaterial, 4);
    hubs.name = 'four-wheel-hubs';
    const transform = new THREE.Object3D();
    let index = 0;
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        transform.position.set(
          xSign * (spec.width / 2 + 0.015),
          radius,
          zSign * (wheelbase / 2),
        );
        transform.rotation.set(0, 0, Math.PI / 2);
        transform.scale.set(radius, 0.19, radius);
        transform.updateMatrix();
        wheels.setMatrixAt(index, transform.matrix);

        transform.position.x = xSign * (spec.width / 2 + 0.12);
        transform.scale.set(radius * 0.56, 0.04, radius * 0.56);
        transform.updateMatrix();
        hubs.setMatrixAt(index, transform.matrix);
        index += 1;
      }
    }
    wheels.instanceMatrix.needsUpdate = true;
    hubs.instanceMatrix.needsUpdate = true;
    group.add(wheels, hubs);
  }

  private addSignals(
    group: THREE.Group,
    spec: ParkedVehicleSpec,
    dims: ReturnType<GenericParkedCarFactory['variantDimensions']>,
  ): void {
    const signalY = dims.wheelRadius * 0.72 + dims.bodyHeight * 0.55;
    const headlights = this.pairedBoxes(
      'paired-headlights',
      this.headlightMaterial,
      spec.width * 0.29,
      signalY,
      spec.length / 2 + 0.012,
      0.34,
      0.15,
      0.055,
    );
    const tailLights = this.pairedBoxes(
      'paired-tail-lights',
      this.tailLightMaterial,
      spec.width * 0.31,
      signalY,
      -spec.length / 2 - 0.012,
      0.3,
      0.16,
      0.055,
    );
    const frontPlate = new THREE.Mesh(this.unitBox, this.plateMaterial);
    frontPlate.name = 'front-license-plate';
    frontPlate.scale.set(0.36, 0.13, 0.025);
    frontPlate.position.set(0, signalY - 0.17, spec.length / 2 + 0.04);
    const rearPlate = frontPlate.clone();
    rearPlate.name = 'rear-license-plate';
    rearPlate.position.z = -spec.length / 2 - 0.04;
    group.add(headlights, tailLights, frontPlate, rearPlate);
  }

  private addVariantDetails(
    group: THREE.Group,
    id: GenericParkedCarId,
    spec: ParkedVehicleSpec,
    dims: ReturnType<GenericParkedCarFactory['variantDimensions']>,
    tint: string,
  ): void {
    const trimY = dims.wheelRadius * 0.72 + dims.bodyHeight * 0.92;
    if (id === 'generic-pickup') {
      const bed = new THREE.Mesh(this.unitBox, this.bedMaterial);
      bed.name = 'pickup-bed-liner';
      bed.scale.set(spec.width * 0.79, 0.06, spec.length * 0.35);
      bed.position.set(0, trimY + 0.02, -spec.length * 0.28);
      const rails = new THREE.InstancedMesh(this.unitBox, this.paint(tint), 3);
      rails.name = 'pickup-bed-rails';
      const transform = new THREE.Object3D();
      for (let i = 0; i < 3; i += 1) {
        transform.position.set(
          i < 2 ? (i === 0 ? -1 : 1) * spec.width * 0.43 : 0,
          trimY + 0.13,
          i < 2 ? -spec.length * 0.28 : -spec.length * 0.45,
        );
        transform.scale.set(
          i < 2 ? 0.07 : spec.width * 0.88,
          0.2,
          i < 2 ? spec.length * 0.38 : 0.08,
        );
        transform.updateMatrix();
        rails.setMatrixAt(i, transform.matrix);
      }
      rails.instanceMatrix.needsUpdate = true;
      group.add(bed, rails);
      return;
    }

    const hood = new THREE.Mesh(this.unitBox, this.paint(tint));
    hood.name = 'hood-surface';
    hood.scale.set(spec.width * 0.82, 0.06, spec.length * (id === 'generic-hatchback' ? 0.2 : 0.24));
    hood.position.set(0, trimY, spec.length * 0.34);
    group.add(hood);

    if (id === 'generic-suv') {
      const rails = this.pairedBoxes(
        'roof-rails',
        this.lowerMaterial,
        spec.width * 0.34,
        dims.wheelRadius * 0.72 + dims.bodyHeight * 0.72 + dims.cabinHeight + 0.07,
        dims.cabinZ,
        0.055,
        0.065,
        spec.length * 0.49,
      );
      group.add(rails);
    } else {
      const trunk = new THREE.Mesh(this.unitBox, this.paint(tint));
      trunk.name = id === 'generic-hatchback' ? 'hatch-spoiler' : 'trunk-surface';
      trunk.scale.set(
        spec.width * (id === 'generic-hatchback' ? 0.74 : 0.82),
        id === 'generic-hatchback' ? 0.08 : 0.055,
        spec.length * (id === 'generic-hatchback' ? 0.05 : 0.16),
      );
      trunk.position.set(
        0,
        id === 'generic-hatchback'
          ? trimY + dims.cabinHeight * 0.56
          : trimY,
        -spec.length * (id === 'generic-hatchback' ? 0.44 : 0.39),
      );
      group.add(trunk);
    }
  }

  private pairedBoxes(
    name: string,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): THREE.InstancedMesh {
    const pair = new THREE.InstancedMesh(this.unitBox, material, 2);
    pair.name = name;
    const transform = new THREE.Object3D();
    for (let i = 0; i < 2; i += 1) {
      transform.position.set(i === 0 ? -x : x, y, z);
      transform.scale.set(sx, sy, sz);
      transform.updateMatrix();
      pair.setMatrixAt(i, transform.matrix);
    }
    pair.instanceMatrix.needsUpdate = true;
    return pair;
  }

  private paint(tint: string): THREE.MeshStandardMaterial {
    let material = this.paints.get(tint);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: tint,
        roughness: 0.36,
        metalness: 0.22,
      });
      this.paints.set(tint, material);
    }
    return material;
  }

  private getBodyGeometry(
    id: GenericParkedCarId,
    width: number,
    length: number,
    height: number,
  ): THREE.BufferGeometry {
    // Lower and upper requests use the same silhouette; the cache key remains
    // variant-specific by rounding dimensions into a stable suffix.
    const key = `${id}:${width.toFixed(2)}:${height.toFixed(2)}`;
    let geometry = this.bodyGeometries.get(key);
    if (!geometry) {
      geometry = createTaperedHull(width, length, height, 0.9, 0.96, 0.08);
      this.bodyGeometries.set(key, geometry);
    }
    return geometry;
  }

  private getCabinGeometry(
    id: GenericParkedCarId,
    width: number,
    length: number,
    height: number,
  ): THREE.BufferGeometry {
    let geometry = this.cabinGeometries.get(id);
    if (!geometry) {
      const frontSlope = id === 'generic-suv' ? 0.3 : id === 'generic-pickup' ? 0.28 : 0.42;
      const rearSlope = id === 'generic-hatchback' || id === 'generic-suv' ? 0.2 : 0.36;
      geometry = createCabinWedge(width, length, height, frontSlope, rearSlope);
      this.cabinGeometries.set(id, geometry);
    }
    return geometry;
  }
}

function createTaperedHull(
  width: number,
  length: number,
  height: number,
  frontWidth: number,
  rearWidth: number,
  topInset: number,
): THREE.BufferGeometry {
  const front = length / 2;
  const rear = -length / 2;
  const bottomFront = (width * frontWidth) / 2;
  const bottomRear = (width * rearWidth) / 2;
  const topFront = bottomFront * (1 - topInset);
  const topRear = bottomRear * (1 - topInset);
  return indexedHull([
    [-bottomRear, 0, rear],
    [bottomRear, 0, rear],
    [bottomFront, 0, front],
    [-bottomFront, 0, front],
    [-topRear, height, rear + 0.08],
    [topRear, height, rear + 0.08],
    [topFront, height, front - 0.12],
    [-topFront, height, front - 0.12],
  ]);
}

function createCabinWedge(
  width: number,
  length: number,
  height: number,
  frontSlope: number,
  rearSlope: number,
): THREE.BufferGeometry {
  const front = length / 2;
  const rear = -length / 2;
  const halfW = width / 2;
  const roofW = halfW * 0.82;
  return indexedHull([
    [-halfW, 0, rear],
    [halfW, 0, rear],
    [halfW, 0, front],
    [-halfW, 0, front],
    [-roofW, height, rear + rearSlope],
    [roofW, height, rear + rearSlope],
    [roofW, height, front - frontSlope],
    [-roofW, height, front - frontSlope],
  ]);
}

function indexedHull(vertices: number[][]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
  geometry.setIndex([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
