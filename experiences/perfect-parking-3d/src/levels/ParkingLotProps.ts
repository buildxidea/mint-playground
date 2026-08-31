import * as THREE from 'three';

/** Reusable local prop kit used outside the driveable parking-lot bounds. */
export class ParkingLotPropFactory {
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  private readonly railLoop = new THREE.TorusGeometry(0.55, 0.045, 6, 18);
  private readonly cableLoop = new THREE.TorusGeometry(0.34, 0.035, 6, 18, Math.PI * 1.45);
  private readonly wall = new THREE.MeshStandardMaterial({
    color: '#d9d2bd',
    roughness: 0.9,
  });
  private readonly concrete = new THREE.MeshStandardMaterial({
    color: '#969892',
    roughness: 0.95,
  });
  private readonly darkMetal = new THREE.MeshStandardMaterial({
    color: '#29343a',
    roughness: 0.48,
    metalness: 0.55,
  });
  private readonly galvanized = new THREE.MeshStandardMaterial({
    color: '#a8b2b3',
    roughness: 0.38,
    metalness: 0.72,
  });
  private readonly glass = new THREE.MeshStandardMaterial({
    color: '#315a68',
    roughness: 0.18,
    metalness: 0.12,
  });
  private readonly blue = new THREE.MeshStandardMaterial({
    color: '#3986a4',
    roughness: 0.42,
  });
  private readonly green = new THREE.MeshStandardMaterial({
    color: '#4d9d70',
    roughness: 0.45,
  });
  private readonly amber = new THREE.MeshStandardMaterial({
    color: '#f0b94d',
    emissive: '#9c5d12',
    emissiveIntensity: 0.22,
    roughness: 0.42,
  });
  private readonly red = new THREE.MeshStandardMaterial({
    color: '#b84c45',
    roughness: 0.46,
  });
  private readonly rubber = new THREE.MeshStandardMaterial({
    color: '#1c2225',
    roughness: 0.86,
  });
  private readonly foliage = new THREE.MeshStandardMaterial({
    color: '#47744d',
    roughness: 1,
  });

  createSet(floorY: number): THREE.Group {
    const set = new THREE.Group();
    set.name = 'local-parking-prop-kit';
    set.userData.localProceduralAsset = true;
    set.add(
      this.createServiceBuilding(0, floorY - 0.31, 17.2),
      this.createDirectorySign(0, floorY - 0.14, 11.3),
      this.createCartCorral(-15.7, floorY - 0.14, -1.7),
      this.createEvChargerBank(14.2, floorY - 0.14, -4.2),
      this.createBikeRack(-14.2, floorY - 0.14, 3.7),
      this.createPayStation(14.0, floorY - 0.14, 1.3),
      this.createWasteStation(14.0, floorY - 0.14, 6.2),
      this.createHydrant(-14.1, floorY - 0.14, 7.0),
    );
    this.markShared(set);
    return set;
  }

  private createServiceBuilding(x: number, y: number, z: number): THREE.Group {
    const group = this.namedGroup('service-building');
    const shell = this.box(0, 2.15, 0, 22, 4.3, 6.2, this.wall);
    shell.receiveShadow = true;
    const roof = this.box(0, 4.45, 0, 23, 0.46, 6.9, this.darkMetal);
    const base = this.box(0, 0.18, -0.1, 22.5, 0.36, 6.5, this.concrete);
    const awning = this.box(0, 2.72, -3.48, 15.8, 0.18, 1.05, this.amber);
    awning.rotation.x = -0.12;

    const windows = new THREE.InstancedMesh(this.unitBox, this.glass, 7);
    windows.name = 'storefront-window-bank';
    const transform = new THREE.Object3D();
    for (let i = 0; i < 7; i += 1) {
      transform.position.set(-8.4 + i * 2.8, 1.52, -3.12);
      transform.scale.set(i === 3 ? 1.7 : 2.25, 2.25, 0.07);
      transform.updateMatrix();
      windows.setMatrixAt(i, transform.matrix);
    }
    windows.instanceMatrix.needsUpdate = true;

    const columns = new THREE.InstancedMesh(this.unitBox, this.darkMetal, 8);
    columns.name = 'storefront-mullions';
    for (let i = 0; i < 8; i += 1) {
      transform.position.set(-9.8 + i * 2.8, 1.54, -3.2);
      transform.scale.set(0.12, 2.45, 0.13);
      transform.updateMatrix();
      columns.setMatrixAt(i, transform.matrix);
    }
    columns.instanceMatrix.needsUpdate = true;

    const sign = this.box(0, 3.62, -3.25, 6.7, 0.72, 0.12, this.blue);
    const signBars = new THREE.InstancedMesh(this.unitBox, this.wall, 4);
    signBars.name = 'store-sign-glyph';
    const widths = [0.16, 0.8, 0.16, 0.8];
    for (let i = 0; i < 4; i += 1) {
      transform.position.set(-1.4 + i * 0.9, 3.62, -3.33);
      transform.scale.set(widths[i], i % 2 === 0 ? 0.42 : 0.14, 0.06);
      transform.updateMatrix();
      signBars.setMatrixAt(i, transform.matrix);
    }
    signBars.instanceMatrix.needsUpdate = true;

    const planters = new THREE.InstancedMesh(this.unitBox, this.concrete, 2);
    planters.name = 'storefront-planters';
    const shrubs = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.42, 0),
      this.foliage,
      6,
    );
    shrubs.name = 'storefront-shrubs';
    let shrubIndex = 0;
    for (let i = 0; i < 2; i += 1) {
      const px = i === 0 ? -9.4 : 9.4;
      transform.position.set(px, 0.34, -3.65);
      transform.scale.set(2.4, 0.5, 0.9);
      transform.updateMatrix();
      planters.setMatrixAt(i, transform.matrix);
      for (let s = -1; s <= 1; s += 1) {
        transform.position.set(px + s * 0.66, 0.78, -3.65);
        transform.scale.set(0.9, 0.8, 0.9);
        transform.updateMatrix();
        shrubs.setMatrixAt(shrubIndex, transform.matrix);
        shrubIndex += 1;
      }
    }
    planters.instanceMatrix.needsUpdate = true;
    shrubs.instanceMatrix.needsUpdate = true;

    group.add(shell, base, roof, windows, columns, awning, sign, signBars, planters, shrubs);
    group.position.set(x, y, z);
    return group;
  }

  private createDirectorySign(x: number, y: number, z: number): THREE.Group {
    const group = this.namedGroup('parking-directory-sign');
    const posts = new THREE.InstancedMesh(this.unitBox, this.darkMetal, 2);
    const transform = new THREE.Object3D();
    for (let i = 0; i < 2; i += 1) {
      transform.position.set(i === 0 ? -0.7 : 0.7, 1.15, 0);
      transform.scale.set(0.12, 2.3, 0.12);
      transform.updateMatrix();
      posts.setMatrixAt(i, transform.matrix);
    }
    posts.instanceMatrix.needsUpdate = true;
    const panel = this.box(0, 2.12, 0, 2.25, 1.25, 0.16, this.blue);
    const pStem = this.box(-0.32, 2.12, -0.11, 0.16, 0.68, 0.05, this.wall);
    const pCap = this.box(0, 2.31, -0.11, 0.62, 0.14, 0.05, this.wall);
    const arrow = new THREE.Mesh(createArrowGeometry(), this.amber);
    arrow.name = 'direction-arrow';
    arrow.position.set(0.62, 1.92, -0.12);
    group.add(posts, panel, pStem, pCap, arrow);
    group.position.set(x, y, z);
    return group;
  }

  private createCartCorral(x: number, y: number, z: number): THREE.Group {
    const group = this.namedGroup('shopping-cart-corral');
    const frame = new THREE.InstancedMesh(this.unitBox, this.galvanized, 8);
    frame.name = 'corral-frame';
    const transform = new THREE.Object3D();
    const pieces: Array<[number, number, number, number, number, number]> = [
      [-1.15, 0.75, -1.75, 0.08, 1.5, 0.08],
      [1.15, 0.75, -1.75, 0.08, 1.5, 0.08],
      [-1.15, 0.75, 1.75, 0.08, 1.5, 0.08],
      [1.15, 0.75, 1.75, 0.08, 1.5, 0.08],
      [-1.15, 0.55, 0, 0.08, 0.08, 3.55],
      [1.15, 0.55, 0, 0.08, 0.08, 3.55],
      [-1.15, 1.32, 0, 0.08, 0.08, 3.55],
      [1.15, 1.32, 0, 0.08, 0.08, 3.55],
    ];
    pieces.forEach(([px, py, pz, sx, sy, sz], index) => {
      transform.position.set(px, py, pz);
      transform.scale.set(sx, sy, sz);
      transform.updateMatrix();
      frame.setMatrixAt(index, transform.matrix);
    });
    frame.instanceMatrix.needsUpdate = true;
    const header = this.box(0, 1.62, 0, 2.52, 0.42, 0.1, this.blue);
    header.rotation.y = Math.PI / 2;
    group.add(frame, header, this.createShoppingCart(-0.36), this.createShoppingCart(0.46));
    group.position.set(x, y, z);
    group.rotation.y = Math.PI / 2;
    return group;
  }

  private createShoppingCart(z: number): THREE.Group {
    const cart = new THREE.Group();
    cart.name = 'nested-shopping-cart';
    const basket = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.48, 1.0),
      new THREE.MeshStandardMaterial({
        color: '#9eaaab',
        roughness: 0.45,
        metalness: 0.65,
        wireframe: true,
      }),
    );
    basket.position.y = 0.8;
    basket.rotation.x = -0.08;
    const handle = this.box(0, 1.08, -0.55, 1.02, 0.08, 0.08, this.blue);
    const chassis = this.box(0, 0.4, 0, 0.68, 0.07, 0.92, this.galvanized);
    const wheels = new THREE.InstancedMesh(this.unitCylinder, this.rubber, 4);
    const transform = new THREE.Object3D();
    let index = 0;
    for (const px of [-0.32, 0.32]) {
      for (const pz of [-0.36, 0.36]) {
        transform.position.set(px, 0.2, pz);
        transform.rotation.set(0, 0, Math.PI / 2);
        transform.scale.set(0.12, 0.08, 0.12);
        transform.updateMatrix();
        wheels.setMatrixAt(index, transform.matrix);
        index += 1;
      }
    }
    wheels.instanceMatrix.needsUpdate = true;
    cart.add(basket, handle, chassis, wheels);
    cart.position.z = z;
    return cart;
  }

  private createEvChargerBank(x: number, y: number, z: number): THREE.Group {
    const group = this.namedGroup('ev-charger-bank');
    for (let i = 0; i < 2; i += 1) {
      const charger = new THREE.Group();
      const body = this.box(0, 0.95, 0, 0.62, 1.9, 0.48, this.wall);
      const cap = this.box(0, 1.88, 0, 0.7, 0.18, 0.56, this.green);
      const screen = this.box(0, 1.27, -0.26, 0.34, 0.36, 0.04, this.glass);
      const signal = this.box(0, 0.72, -0.27, 0.12, 0.45, 0.03, this.green);
      const cable = new THREE.Mesh(this.cableLoop, this.rubber);
      cable.name = 'charging-cable';
      cable.position.set(0.38, 0.9, 0);
      cable.rotation.y = Math.PI / 2;
      charger.add(body, cap, screen, signal, cable);
      charger.position.x = i === 0 ? -0.62 : 0.62;
      group.add(charger);
    }
    const pad = this.box(0, 0.06, 0, 1.75, 0.12, 0.95, this.concrete);
    group.add(pad);
    group.position.set(x, y, z);
    group.rotation.y = -Math.PI / 2;
    return group;
  }

  private createBikeRack(x: number, y: number, z: number): THREE.Group {
    const group = this.namedGroup('bike-rack');
    const base = this.box(0, 0.05, 0, 3.1, 0.1, 0.24, this.concrete);
    const loops = new THREE.InstancedMesh(this.railLoop, this.galvanized, 5);
    loops.name = 'bike-rack-loops';
    const transform = new THREE.Object3D();
    for (let i = 0; i < 5; i += 1) {
      transform.position.set(-1.2 + i * 0.6, 0.58, 0);
      transform.scale.set(0.72, 1, 0.72);
      transform.updateMatrix();
      loops.setMatrixAt(i, transform.matrix);
    }
    loops.instanceMatrix.needsUpdate = true;
    group.add(base, loops);
    group.position.set(x, y, z);
    group.rotation.y = Math.PI / 2;
    return group;
  }

  private createPayStation(x: number, y: number, z: number): THREE.Group {
    const group = this.namedGroup('parking-pay-station');
    const base = this.box(0, 0.08, 0, 0.88, 0.16, 0.75, this.concrete);
    const body = this.box(0, 0.94, 0, 0.62, 1.72, 0.52, this.darkMetal);
    const screen = this.box(0, 1.3, -0.28, 0.4, 0.38, 0.045, this.glass);
    const reader = this.box(0.16, 0.83, -0.29, 0.16, 0.11, 0.045, this.green);
    const cap = this.box(0, 1.86, 0, 0.75, 0.22, 0.62, this.blue);
    group.add(base, body, screen, reader, cap);
    group.position.set(x, y, z);
    group.rotation.y = -Math.PI / 2;
    return group;
  }

  private createWasteStation(x: number, y: number, z: number): THREE.Group {
    const group = this.namedGroup('waste-and-recycling-station');
    for (let i = 0; i < 2; i += 1) {
      const body = this.box(i === 0 ? -0.43 : 0.43, 0.58, 0, 0.72, 1.15, 0.72, i === 0 ? this.green : this.blue);
      const lid = this.box(i === 0 ? -0.43 : 0.43, 1.2, 0, 0.8, 0.16, 0.8, this.darkMetal);
      const slot = this.box(i === 0 ? -0.43 : 0.43, 0.91, -0.38, 0.38, 0.16, 0.035, this.rubber);
      group.add(body, lid, slot);
    }
    group.position.set(x, y, z);
    group.rotation.y = -Math.PI / 2;
    return group;
  }

  private createHydrant(x: number, y: number, z: number): THREE.Group {
    const group = this.namedGroup('fire-hydrant');
    const base = new THREE.Mesh(this.unitCylinder, this.red);
    base.scale.set(0.3, 0.78, 0.3);
    base.position.y = 0.39;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.28, 12), this.red);
    cap.position.y = 0.92;
    const arms = new THREE.InstancedMesh(this.unitCylinder, this.red, 2);
    const transform = new THREE.Object3D();
    for (let i = 0; i < 2; i += 1) {
      transform.position.set(i === 0 ? -0.36 : 0.36, 0.62, 0);
      transform.rotation.set(0, 0, Math.PI / 2);
      transform.scale.set(0.16, 0.28, 0.16);
      transform.updateMatrix();
      arms.setMatrixAt(i, transform.matrix);
    }
    arms.instanceMatrix.needsUpdate = true;
    group.add(base, cap, arms);
    group.position.set(x, y, z);
    return group;
  }

  private namedGroup(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.userData.localProceduralAsset = true;
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
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = true;
      }
    });
  }
}

function createArrowGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.45, -0.14);
  shape.lineTo(0.08, -0.14);
  shape.lineTo(0.08, -0.38);
  shape.lineTo(0.55, 0);
  shape.lineTo(0.08, 0.38);
  shape.lineTo(0.08, 0.14);
  shape.lineTo(-0.45, 0.14);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}
