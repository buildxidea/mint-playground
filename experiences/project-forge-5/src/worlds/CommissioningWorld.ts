import * as THREE from 'three';
import type { RobotId, RoomId } from '../config/catalog';
import { getScenarioRoute } from '../config/scenarioRoutes';
import { COMMISSIONING_COLLIDERS, createWedgeRampMeshData } from './commissioningCourse';

type LayerState = {
  splat: boolean;
  colliders: boolean;
  navigation: boolean;
  semantics: boolean;
  triggers: boolean;
};

type BoxInstance = {
  position: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
};

export class CommissioningWorld {
  readonly root = new THREE.Group();
  readonly visualLayer = new THREE.Group();
  readonly colliderLayer = new THREE.Group();
  readonly navigationLayer = new THREE.Group();
  readonly semanticLayer = new THREE.Group();
  readonly triggerLayer = new THREE.Group();
  readonly dynamicLayer = new THREE.Group();

  private readonly materials = new Set<THREE.Material>();
  private readonly goalBeacons: THREE.Group[] = [];
  private activeRoute: readonly THREE.Vector3[] = getScenarioRoute('kinetic-hall', 'axiom-h1');
  private roomId: RoomId = 'kinetic-hall';
  private movingGate: THREE.Group | null = null;
  private movingGateCollider: THREE.Mesh | null = null;
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.root.name = 'commissioning-world:non-production';
    this.root.userData.productionAsset = false;
    this.root.add(
      this.visualLayer,
      this.colliderLayer,
      this.navigationLayer,
      this.semanticLayer,
      this.triggerLayer,
      this.dynamicLayer,
    );
    scene.add(this.root);
    this.setLayerState({
      splat: true,
      colliders: false,
      navigation: false,
      semantics: false,
      triggers: false,
    });
  }

  build(roomId: RoomId, robotId: RobotId): void {
    this.clear();
    this.roomId = roomId;
    this.activeRoute = getScenarioRoute(roomId, robotId);
    this.createArchitecture(roomId);
    this.createRoute(robotId);
    this.createDebugLayers();
  }

  update(delta: number): void {
    this.elapsed += delta;
    for (let index = 0; index < this.goalBeacons.length; index += 1) {
      const beacon = this.goalBeacons[index];
      beacon.rotation.y += delta * 0.45;
      const core = beacon.children[0];
      core.position.y = 0.22 + Math.sin(this.elapsed * 2.4 + index * 0.7) * 0.05;
    }
  }

  setDynamicGatePosition(position: THREE.Vector3): void {
    if (this.movingGate) this.movingGate.position.copy(position);
    if (this.movingGateCollider) this.movingGateCollider.position.copy(position);
  }

  getDynamicGatePosition(target: THREE.Vector3): THREE.Vector3 | null {
    if (!this.movingGate) return null;
    return target.copy(this.movingGate.position);
  }

  getRoute(_robotId: RobotId): readonly THREE.Vector3[] {
    return this.activeRoute;
  }

  setObjectiveIndex(index: number): void {
    for (let i = 0; i < this.goalBeacons.length; i += 1) {
      const material = (this.goalBeacons[i].children[0] as THREE.Mesh)
        .material as THREE.MeshStandardMaterial;
      material.opacity = i === index ? 0.9 : i < index ? 0.08 : 0.28;
      material.emissiveIntensity = i === index ? 4 : 1.1;
    }
  }

  setLayerState(state: LayerState): void {
    this.visualLayer.visible = state.splat;
    this.colliderLayer.visible = state.colliders;
    this.navigationLayer.visible = state.navigation;
    this.semanticLayer.visible = state.semantics;
    this.triggerLayer.visible = state.triggers;
  }

  dispose(scene: THREE.Scene): void {
    this.clear();
    scene.remove(this.root);
  }

  private createArchitecture(roomId: RoomId): void {
    const concrete = this.material('#293237', 0.88, 0.08);
    const concreteLight = this.material('#586267', 0.75, 0.15);
    const steel = this.material('#8d999e', 0.3, 0.78);
    const darkSteel = this.material('#151d21', 0.4, 0.68);
    const safety = this.material('#e5b53c', 0.52, 0.2);
    const rubber = this.material('#101617', 0.92, 0.02);
    const blue = this.emissiveMaterial('#43a6cf', 1.8);
    const amber = this.emissiveMaterial('#ff9d32', 1.9);
    const red = this.emissiveMaterial('#ff4038', 2.4);

    this.mesh(
      new THREE.PlaneGeometry(36, 24),
      concrete,
      [0, 0, 0],
      [-Math.PI / 2, 0, 0],
      this.visualLayer,
      false,
      true,
    );
    this.mesh(new THREE.BoxGeometry(36, 0.35, 0.4), darkSteel, [0, 0.17, -12], [0, 0, 0]);
    this.mesh(new THREE.BoxGeometry(36, 0.35, 0.4), darkSteel, [0, 0.17, 12], [0, 0, 0]);
    this.mesh(new THREE.BoxGeometry(0.4, 0.35, 24), darkSteel, [-18, 0.17, 0], [0, 0, 0]);
    this.mesh(new THREE.BoxGeometry(0.4, 0.35, 24), darkSteel, [18, 0.17, 0], [0, 0, 0]);

    const wallColumns: BoxInstance[] = [];
    for (let x = -16; x <= 16; x += 4) {
      wallColumns.push(
        { position: [x, 2.4, -11.7], size: [0.2, 4.8, 0.3] },
        { position: [x, 2.4, 11.7], size: [0.2, 4.8, 0.3] },
      );
    }
    for (let z = -10; z <= 10; z += 4) {
      wallColumns.push(
        { position: [-17.7, 2.4, z], size: [0.3, 4.8, 0.2] },
        { position: [17.7, 2.4, z], size: [0.3, 4.8, 0.2] },
      );
    }
    this.instanceBoxes(wallColumns, steel);

    const safetyGrid: BoxInstance[] = [];
    const concreteGrid: BoxInstance[] = [];
    for (let x = -15; x <= 15; x += 3) {
      const target = x % 6 === 0 ? safetyGrid : concreteGrid;
      target.push({ position: [x, 0.012, 0], size: [0.055, 0.012, 22] });
    }
    for (let z = -10; z <= 10; z += 2) {
      concreteGrid.push({ position: [0, 0.013, z], size: [34, 0.012, 0.035] });
    }
    this.instanceBoxes(safetyGrid, safety, this.visualLayer, false, true);
    this.instanceBoxes(concreteGrid, concreteLight, this.visualLayer, false, true);

    this.createCeilingTrusses(steel, darkSteel, blue);
    this.createObservationBooth(concreteLight, darkSteel, blue);
    this.createDock(new THREE.Vector3(13.2, 0, 7.2), darkSteel, blue, safety);
    this.createStartBay(new THREE.Vector3(-13.5, 0, 7.5), darkSteel, blue, safety);

    if (roomId === 'kinetic-hall') {
      this.createKineticHall(steel, darkSteel, safety, rubber, blue, amber);
    } else if (roomId === 'precision-cell') {
      this.createPrecisionCell(steel, darkSteel, safety, rubber, blue, amber);
    } else {
      this.createCrisisBay(steel, darkSteel, safety, rubber, amber, red);
    }
  }

  private createKineticHall(
    steel: THREE.Material,
    darkSteel: THREE.Material,
    safety: THREE.Material,
    rubber: THREE.Material,
    blue: THREE.Material,
    amber: THREE.Material,
  ): void {
    const ramp = this.mesh(
      this.createWedgeRampGeometry([2.6, 1.05, 4.6]),
      rubber,
      [-8.2, 0, -4.7],
      [0, 0, 0],
    );
    ramp.userData.semanticId = 'ramp-primary';
    for (let index = 0; index < 5; index += 1) {
      const height = (5 - index) * 0.16;
      const step = this.mesh(
        new THREE.BoxGeometry(1.7, height, 0.55),
        darkSteel,
        [-1.4, height * 0.5, -7.1 + index * 0.55],
        [0, 0, 0],
      );
      step.userData.semanticId = index === 2 ? 'stairs-short' : undefined;
    }
    this.mesh(new THREE.BoxGeometry(4.2, 0.18, 3.3), steel, [2.2, 0.78, -6], [0, 0, 0]);
    for (const x of [0.3, 4.1]) {
      this.mesh(new THREE.BoxGeometry(0.1, 1.1, 3.3), safety, [x, 1.25, -6], [0, 0, 0]);
    }
    for (let index = 0; index < 6; index += 1) {
      const z = 4.8 - index * 1.8;
      const x = 2.7 + (index % 2 === 0 ? -1.4 : 1.4);
      this.createCone(new THREE.Vector3(x, 0, z), safety, rubber);
    }
    this.movingGate = new THREE.Group();
    this.movingGate.position.set(9.7, 1.1, -2.5);
    this.dynamicLayer.add(this.movingGate);
    this.mesh(
      new THREE.BoxGeometry(0.18, 2.2, 4.5),
      darkSteel,
      [0, 0, 0],
      [0, 0, 0],
      this.movingGate,
    );
    this.mesh(
      new THREE.BoxGeometry(0.23, 0.36, 4.8),
      amber,
      [0, 1.05, 0],
      [0, 0, 0],
      this.movingGate,
    );
    this.createControlPanel(new THREE.Vector3(13.6, 0, -5.6), darkSteel, blue, safety);
  }

  private createPrecisionCell(
    steel: THREE.Material,
    darkSteel: THREE.Material,
    safety: THREE.Material,
    rubber: THREE.Material,
    blue: THREE.Material,
    amber: THREE.Material,
  ): void {
    for (const z of [-6.5, -1.5, 4]) {
      this.createWorkbench(new THREE.Vector3(-7.5, 0, z), steel, darkSteel, blue);
    }
    this.createConveyor(new THREE.Vector3(4, 0, -6), steel, rubber, safety, blue);
    for (let x = -1; x <= 7; x += 2) {
      this.createCrate(new THREE.Vector3(x, 0, 2.4 + (x % 4) * 0.35), darkSteel, amber);
    }
    this.createShelf(new THREE.Vector3(11.8, 0, -1.5), steel, darkSteel, blue);
    this.createControlPanel(new THREE.Vector3(13.6, 0, 5.4), darkSteel, blue, safety);
  }

  private createCrisisBay(
    steel: THREE.Material,
    darkSteel: THREE.Material,
    safety: THREE.Material,
    rubber: THREE.Material,
    amber: THREE.Material,
    red: THREE.Material,
  ): void {
    this.createPipeRun(new THREE.Vector3(-9, 0, -6), steel, red);
    this.createTank(new THREE.Vector3(7.5, 0, -6.5), steel, amber);
    for (let index = 0; index < 11; index += 1) {
      const x = -3 + (index % 4) * 1.25;
      const z = -3.5 + Math.floor(index / 4) * 1.1;
      const debris = this.mesh(
        new THREE.BoxGeometry(0.7 + (index % 3) * 0.2, 0.25, 0.45),
        index % 2 ? darkSteel : rubber,
        [x, 0.15 + (index % 2) * 0.1, z],
        [index * 0.11, index * 0.27, index * 0.08],
      );
      debris.castShadow = true;
    }
    this.mesh(new THREE.BoxGeometry(6.5, 0.18, 2.4), steel, [4.8, 2.4, 4.6], [0, 0, 0]);
    for (const x of [1.8, 7.9]) {
      this.mesh(new THREE.BoxGeometry(0.11, 1.15, 2.4), safety, [x, 2.85, 4.6], [0, 0, 0]);
    }
    this.createMannequin(new THREE.Vector3(10.5, 0.3, 1.2), safety, rubber);
    this.createControlPanel(new THREE.Vector3(13.6, 0, 6), darkSteel, red, safety);
  }

  private createRoute(_robotId: RobotId): void {
    const routeMaterial = this.emissiveMaterial('#2ea9d0', 1.5, true);
    const goalMaterial = this.emissiveMaterial('#55d994', 3, true);
    const points = this.activeRoute;
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((point) => point.clone().setY(0.035)),
    );
    const lineMaterial = new THREE.LineDashedMaterial({
      color: '#2ea9d0',
      transparent: true,
      opacity: 0.56,
      dashSize: 0.35,
      gapSize: 0.22,
    });
    this.materials.add(lineMaterial);
    const line = new THREE.Line(geometry, lineMaterial);
    line.computeLineDistances();
    this.navigationLayer.add(line);

    for (let index = 0; index < points.length; index += 1) {
      const beacon = new THREE.Group();
      beacon.position.copy(points[index]);
      const coreMaterial = index === points.length - 1 ? goalMaterial : routeMaterial.clone();
      this.materials.add(coreMaterial);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.08, 28), coreMaterial);
      core.material.transparent = true;
      core.material.opacity = index === 0 ? 0.9 : 0.28;
      core.castShadow = true;
      beacon.add(core);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.018, 6, 36), routeMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      beacon.add(ring);
      this.triggerLayer.add(beacon);
      this.goalBeacons.push(beacon);
    }
  }

  private createDebugLayers(): void {
    const colliderMaterial = new THREE.MeshBasicMaterial({
      color: '#ff5f45',
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
    });
    this.materials.add(colliderMaterial);
    for (const collider of COMMISSIONING_COLLIDERS[this.roomId]) {
      const debugCollider = this.mesh(
        collider.shape === 'wedge-ramp'
          ? this.createWedgeRampGeometry(collider.size)
          : new THREE.BoxGeometry(...collider.size),
        colliderMaterial,
        collider.position,
        collider.rotation ?? [0, 0, 0],
        this.colliderLayer,
      );
      debugCollider.name = `collider:${collider.id}`;
      if (collider.dynamic === 'vertical-gate') this.movingGateCollider = debugCollider;
    }

    const semanticMaterial = new THREE.MeshBasicMaterial({
      color: '#d86fff',
      wireframe: true,
      transparent: true,
      opacity: 0.58,
      depthTest: false,
    });
    this.materials.add(semanticMaterial);
    const semantics =
      this.roomId === 'kinetic-hall'
        ? [
            ['manual:ramp-primary', [-8.2, 0.5, -4.7], [4.8, 1.2, 3]],
            ['manual:stairs-short', [-1.4, 0.5, -6], [2, 1.2, 3.5]],
            ['manual:control-panel-east', [13.6, 1.1, -5.6], [0.6, 2.2, 1.2]],
          ]
        : this.roomId === 'precision-cell'
          ? [
              ['manual:workbench', [-7.5, 0.75, -1.5], [3.2, 1.5, 2]],
              ['manual:conveyor', [4, 0.6, -6], [7, 1.2, 2]],
            ]
          : [
              ['manual:pipe-system', [-9, 1.6, -6], [5, 3.2, 2]],
              ['manual:debris-field', [-1.5, 0.5, -2.5], [6, 1.2, 4]],
            ];
    for (const [id, position, size] of semantics) {
      const values = position as number[];
      const dimensions = size as number[];
      const box = this.mesh(
        new THREE.BoxGeometry(...(dimensions as [number, number, number])),
        semanticMaterial,
        values as [number, number, number],
        [0, 0, 0],
        this.semanticLayer,
      );
      box.name = String(id);
    }
  }

  private createCeilingTrusses(
    steel: THREE.Material,
    darkSteel: THREE.Material,
    blue: THREE.Material,
  ): void {
    const trusses: BoxInstance[] = [];
    const braces: BoxInstance[] = [];
    const lights: BoxInstance[] = [];
    for (let z = -9; z <= 9; z += 6) {
      trusses.push({ position: [0, 5.2, z], size: [34, 0.16, 0.18] });
      for (let x = -15; x <= 15; x += 3) {
        braces.push({ position: [x, 5.02, z], size: [0.06, 0.06, 1.35] });
        lights.push({ position: [x, 4.75, z], size: [1.35, 0.05, 0.14] });
      }
    }
    this.instanceBoxes(trusses, steel);
    this.instanceBoxes(braces, darkSteel);
    this.instanceBoxes(lights, blue, this.visualLayer, false, false);
  }

  private createObservationBooth(
    concrete: THREE.Material,
    darkSteel: THREE.Material,
    blue: THREE.Material,
  ): void {
    this.mesh(new THREE.BoxGeometry(8, 2.9, 0.45), concrete, [0, 2.6, 11.4], [0, 0, 0]);
    for (const x of [-2.7, -0.9, 0.9, 2.7]) {
      this.mesh(new THREE.BoxGeometry(1.45, 1.15, 0.08), blue, [x, 2.75, 11.12], [0, 0, 0]);
      this.mesh(
        new THREE.BoxGeometry(0.12, 1.5, 0.16),
        darkSteel,
        [x + 0.81, 2.75, 11.06],
        [0, 0, 0],
      );
    }
  }

  private createDock(
    position: THREE.Vector3,
    darkSteel: THREE.Material,
    blue: THREE.Material,
    safety: THREE.Material,
  ): void {
    this.mesh(
      new THREE.BoxGeometry(2.2, 0.12, 2.3),
      darkSteel,
      [position.x, 0.06, position.z],
      [0, 0, 0],
    );
    this.mesh(
      new THREE.TorusGeometry(0.82, 0.055, 8, 40),
      blue,
      [position.x, 0.13, position.z],
      [-Math.PI / 2, 0, 0],
    );
    this.mesh(
      new THREE.BoxGeometry(0.25, 1.8, 1.8),
      safety,
      [position.x + 1.2, 0.9, position.z],
      [0, 0, 0],
    );
  }

  private createStartBay(
    position: THREE.Vector3,
    darkSteel: THREE.Material,
    blue: THREE.Material,
    safety: THREE.Material,
  ): void {
    this.mesh(
      new THREE.BoxGeometry(3.2, 0.08, 3.2),
      darkSteel,
      [position.x, 0.045, position.z],
      [0, 0, 0],
    );
    this.mesh(
      new THREE.RingGeometry(1.1, 1.16, 48),
      blue,
      [position.x, 0.095, position.z],
      [-Math.PI / 2, 0, 0],
    );
    for (const x of [-1.45, 1.45]) {
      this.mesh(
        new THREE.BoxGeometry(0.12, 1.4, 0.12),
        safety,
        [position.x + x, 0.7, position.z + 1.45],
        [0, 0, 0],
      );
    }
  }

  private createCone(
    position: THREE.Vector3,
    safety: THREE.Material,
    rubber: THREE.Material,
  ): void {
    this.mesh(
      new THREE.CylinderGeometry(0.32, 0.42, 0.08, 20),
      rubber,
      [position.x, 0.04, position.z],
      [0, 0, 0],
    );
    this.mesh(
      new THREE.ConeGeometry(0.22, 0.72, 20),
      safety,
      [position.x, 0.44, position.z],
      [0, 0, 0],
    );
  }

  private createControlPanel(
    position: THREE.Vector3,
    darkSteel: THREE.Material,
    screen: THREE.Material,
    safety: THREE.Material,
  ): void {
    const panel = this.mesh(
      new THREE.BoxGeometry(0.35, 1.8, 1.2),
      darkSteel,
      [position.x, 0.9, position.z],
      [0, 0, 0],
    );
    panel.userData.semanticId = 'control-panel';
    this.mesh(
      new THREE.BoxGeometry(0.05, 0.56, 0.72),
      screen,
      [position.x - 0.2, 1.13, position.z],
      [0, 0, 0],
    );
    this.mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.08, 20),
      safety,
      [position.x - 0.24, 0.58, position.z],
      [0, 0, Math.PI / 2],
    );
  }

  private createWorkbench(
    position: THREE.Vector3,
    steel: THREE.Material,
    darkSteel: THREE.Material,
    blue: THREE.Material,
  ): void {
    this.mesh(
      new THREE.BoxGeometry(3, 0.18, 1.45),
      steel,
      [position.x, 0.85, position.z],
      [0, 0, 0],
    );
    for (const x of [-1.3, 1.3]) {
      for (const z of [-0.58, 0.58]) {
        this.mesh(
          new THREE.BoxGeometry(0.12, 0.82, 0.12),
          darkSteel,
          [position.x + x, 0.41, position.z + z],
          [0, 0, 0],
        );
      }
    }
    this.mesh(
      new THREE.BoxGeometry(2.6, 0.04, 0.06),
      blue,
      [position.x, 0.98, position.z - 0.74],
      [0, 0, 0],
    );
  }

  private createConveyor(
    position: THREE.Vector3,
    steel: THREE.Material,
    rubber: THREE.Material,
    safety: THREE.Material,
    blue: THREE.Material,
  ): void {
    this.mesh(
      new THREE.BoxGeometry(7, 0.42, 1.8),
      steel,
      [position.x, 0.62, position.z],
      [0, 0, 0],
    );
    this.mesh(
      new THREE.BoxGeometry(6.6, 0.08, 1.45),
      rubber,
      [position.x, 0.87, position.z],
      [0, 0, 0],
    );
    for (const x of [-3.35, 3.35]) {
      this.mesh(
        new THREE.BoxGeometry(0.16, 1, 2),
        safety,
        [position.x + x, 0.55, position.z],
        [0, 0, 0],
      );
    }
    this.mesh(
      new THREE.BoxGeometry(6.6, 0.03, 0.05),
      blue,
      [position.x, 0.96, position.z - 0.79],
      [0, 0, 0],
    );
  }

  private createCrate(
    position: THREE.Vector3,
    darkSteel: THREE.Material,
    amber: THREE.Material,
  ): void {
    this.mesh(
      new THREE.BoxGeometry(1.1, 0.75, 0.9),
      darkSteel,
      [position.x, 0.39, position.z],
      [0, 0, 0],
    );
    this.mesh(
      new THREE.BoxGeometry(0.7, 0.04, 0.05),
      amber,
      [position.x, 0.55, position.z - 0.48],
      [0, 0, 0],
    );
  }

  private createShelf(
    position: THREE.Vector3,
    steel: THREE.Material,
    darkSteel: THREE.Material,
    blue: THREE.Material,
  ): void {
    for (const x of [-1.8, 1.8]) {
      this.mesh(
        new THREE.BoxGeometry(0.12, 3.4, 1.2),
        steel,
        [position.x + x, 1.7, position.z],
        [0, 0, 0],
      );
    }
    for (const y of [0.3, 1.25, 2.2, 3.15]) {
      this.mesh(
        new THREE.BoxGeometry(3.75, 0.11, 1.2),
        darkSteel,
        [position.x, y, position.z],
        [0, 0, 0],
      );
      this.mesh(
        new THREE.BoxGeometry(3.3, 0.035, 0.05),
        blue,
        [position.x, y + 0.08, position.z - 0.63],
        [0, 0, 0],
      );
    }
  }

  private createPipeRun(position: THREE.Vector3, steel: THREE.Material, red: THREE.Material): void {
    for (let index = 0; index < 3; index += 1) {
      this.mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 5.4, 20),
        steel,
        [position.x + index * 1.2, 2.1, position.z],
        [0, 0, Math.PI / 2],
      );
      this.mesh(
        new THREE.TorusGeometry(0.55, 0.08, 8, 28),
        red,
        [position.x + index * 1.2, 1.35, position.z - 0.3],
        [0, Math.PI / 2, 0],
      );
    }
  }

  private createTank(position: THREE.Vector3, steel: THREE.Material, amber: THREE.Material): void {
    this.mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 3.5, 28),
      steel,
      [position.x, 1.75, position.z],
      [0, 0, 0],
    );
    this.mesh(
      new THREE.TorusGeometry(1.43, 0.08, 8, 32),
      amber,
      [position.x, 1.8, position.z],
      [Math.PI / 2, 0, 0],
    );
  }

  private createMannequin(
    position: THREE.Vector3,
    safety: THREE.Material,
    rubber: THREE.Material,
  ): void {
    this.mesh(
      new THREE.CapsuleGeometry(0.22, 0.8, 6, 12),
      safety,
      [position.x, position.y + 0.5, position.z],
      [0, 0, Math.PI / 2],
    );
    this.mesh(
      new THREE.SphereGeometry(0.2, 16, 12),
      rubber,
      [position.x - 0.65, position.y + 0.52, position.z],
      [0, 0, 0],
    );
  }

  private mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
    rotation: [number, number, number],
    parent: THREE.Object3D = this.visualLayer,
    castShadow = true,
    receiveShadow = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    parent.add(mesh);
    return mesh;
  }

  private createWedgeRampGeometry(size: [number, number, number]): THREE.BufferGeometry {
    const data = createWedgeRampMeshData(size);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    return geometry;
  }

  private instanceBoxes(
    instances: readonly BoxInstance[],
    material: THREE.Material,
    parent: THREE.Object3D = this.visualLayer,
    castShadow = true,
    receiveShadow = true,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      material,
      instances.length,
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Euler();
    instances.forEach((instance, index) => {
      position.set(...instance.position);
      rotation.set(...(instance.rotation ?? [0, 0, 0]));
      quaternion.setFromEuler(rotation);
      scale.set(...instance.size);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    parent.add(mesh);
    return mesh;
  }

  private material(
    color: string,
    roughness: number,
    metalness: number,
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.add(material);
    return material;
  }

  private emissiveMaterial(
    color: string,
    emissiveIntensity: number,
    transparent = false,
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity,
      roughness: 0.3,
      metalness: 0.35,
      transparent,
      opacity: transparent ? 0.7 : 1,
    });
    this.materials.add(material);
    return material;
  }

  private clear(): void {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        const rendered = object as THREE.Mesh | THREE.Line;
        rendered.geometry.dispose();
      }
    });
    for (const layer of [
      this.visualLayer,
      this.colliderLayer,
      this.navigationLayer,
      this.semanticLayer,
      this.triggerLayer,
      this.dynamicLayer,
    ]) {
      layer.clear();
    }
    for (const material of this.materials) material.dispose();
    this.materials.clear();
    this.goalBeacons.length = 0;
    this.movingGate = null;
    this.movingGateCollider = null;
    this.elapsed = 0;
  }
}
