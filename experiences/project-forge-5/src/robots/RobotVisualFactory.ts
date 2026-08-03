import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { RobotDefinition, RobotId } from '../config/catalog';
import type { InputIntent } from '../core/InputController';
import type { AxiomRigBinding } from './AxiomRigContract';
import type { AxiomJumpPresentation } from './AxiomJumpMotion';
import type { KestrelFlightPresentation } from './KestrelFlightController';
import type { RobotCarryVisualState } from './RobotCarryRigContract';
import type { RobotTaskVerb } from '../tasks/RobotTaskController';

export type RobotVisualSource = 'fallback' | 'production';

export type RobotVisualAnimation = Readonly<{
  fixedDt: number;
  animationTime: number;
  speedRatio: number;
  taskActionActive: boolean;
  taskActionPhase: number;
  taskActionVerb: RobotTaskVerb;
  mobilityPosture: 'standing' | 'crouched' | 'crawling';
  command: InputIntent;
  flight: KestrelFlightPresentation | null;
  jump: AxiomJumpPresentation;
  taskTargetWorld: THREE.Vector3 | null;
  carry: RobotCarryVisualState | null;
}>;

export type RobotVisual = {
  root: THREE.Group;
  body: THREE.Group;
  sensor: THREE.Group;
  locomotionParts: THREE.Object3D[];
  manipulatorParts: THREE.Object3D[];
  carrySocket: THREE.Group;
  statusMaterials: THREE.MeshStandardMaterial[];
  articulation?: AxiomRigBinding;
  source: RobotVisualSource;
  animate?: (state: RobotVisualAnimation) => void;
  dispose: () => void;
};

type MaterialKit = {
  shell: THREE.MeshStandardMaterial;
  shellDark: THREE.MeshStandardMaterial;
  structure: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshStandardMaterial;
  status: THREE.MeshStandardMaterial;
};

type ProceduralVisual = Omit<RobotVisual, 'statusMaterials' | 'source' | 'dispose'>;

export class RobotVisualFactory {
  create(definition: RobotDefinition): RobotVisual {
    const kit = this.createMaterialKit(definition.accent);
    const visual = this.createById(definition.id, kit);
    visual.root.name = `commissioning-proxy:${definition.id}`;
    visual.root.userData.productionAsset = false;
    visual.root.userData.robotId = definition.id;
    visual.root.userData.warning = 'Commissioning proxy; replace with validated Mint artifact.';
    return {
      ...visual,
      statusMaterials: [kit.status],
      source: 'fallback',
      dispose: () => {
        visual.root.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const mesh = object as THREE.Mesh;
            mesh.geometry.dispose();
          }
        });
        for (const material of Object.values(kit) as THREE.Material[]) {
          material.dispose();
        }
      },
    };
  }

  private createById(id: RobotId, kit: MaterialKit): ProceduralVisual {
    switch (id) {
      case 'axiom-h1':
        return this.createAxiom(kit);
      case 'quadrant-q4':
        return this.createQuadrant(kit);
      case 'forge-t7':
        return this.createForge(kit);
      case 'swift-w2':
        return this.createSwift(kit);
      case 'kestrel-d5':
        return this.createKestrel(kit);
    }
  }

  private createAxiom(kit: MaterialKit): ProceduralVisual {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    this.box(body, [0.48, 0.58, 0.25], [0, 1.2, 0], kit.shell, 0.07);
    this.box(body, [0.39, 0.17, 0.22], [0, 0.89, 0], kit.structure, 0.05);
    this.box(body, [0.34, 0.27, 0.25], [0, 1.59, -0.01], kit.shell, 0.09);
    this.box(body, [0.23, 0.05, 0.02], [0, 1.61, -0.14], kit.glass, 0.02);
    this.box(body, [0.19, 0.05, 0.02], [0, 1.32, -0.135], kit.status, 0.01);
    this.box(body, [0.32, 0.32, 0.12], [0, 1.08, 0.17], kit.shellDark, 0.04);

    const locomotionParts: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.17, 0.83, 0);
      body.add(hip);
      this.capsule(hip, 0.075, 0.38, [0, -0.22, 0], kit.structure);
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      hip.add(knee);
      this.capsule(knee, 0.07, 0.34, [0, -0.2, 0], kit.shellDark);
      this.box(knee, [0.19, 0.09, 0.31], [0, -0.42, -0.055], kit.rubber, 0.035);
      locomotionParts.push(hip, knee);
    }

    const manipulatorParts: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.34, 1.36, 0);
      body.add(shoulder);
      this.sphere(shoulder, 0.1, [0, 0, 0], kit.accent);
      this.capsule(shoulder, 0.06, 0.28, [side * 0.05, -0.2, 0], kit.shell);
      const elbow = new THREE.Group();
      elbow.position.set(side * 0.09, -0.43, 0);
      shoulder.add(elbow);
      this.capsule(elbow, 0.055, 0.26, [0, -0.18, 0], kit.structure);
      this.box(elbow, [0.14, 0.1, 0.16], [0, -0.37, -0.02], kit.rubber, 0.035);
      manipulatorParts.push(shoulder, elbow);
    }

    const sensor = body.children[2] as THREE.Group;
    const carrySocket = this.socket(body, 'axiom-h1:carry:chest-bimanual-center', [0, 1, -0.82]);
    return { root, body, sensor, locomotionParts, manipulatorParts, carrySocket };
  }

  private createQuadrant(kit: MaterialKit): ProceduralVisual {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.box(body, [0.9, 0.25, 0.42], [0, 0.72, 0], kit.shell, 0.11);
    this.box(body, [0.58, 0.1, 0.3], [0, 0.87, 0.02], kit.shellDark, 0.04);
    const sensor = new THREE.Group();
    sensor.position.set(0.27, 0.96, -0.05);
    body.add(sensor);
    this.cylinder(sensor, 0.075, 0.12, [0, 0.07, 0], kit.structure);
    this.box(sensor, [0.28, 0.14, 0.16], [0, 0.18, -0.02], kit.glass, 0.05);
    this.box(body, [0.42, 0.045, 0.04], [-0.22, 0.74, -0.225], kit.status, 0.01);

    const locomotionParts: THREE.Object3D[] = [];
    for (const x of [-0.32, 0.32]) {
      for (const z of [-0.18, 0.18]) {
        const upper = new THREE.Group();
        upper.position.set(x, 0.66, z);
        upper.rotation.z = x < 0 ? -0.42 : 0.42;
        body.add(upper);
        this.capsule(upper, 0.055, 0.27, [0, -0.18, 0], kit.structure);
        const lower = new THREE.Group();
        lower.position.set(0, -0.38, 0);
        lower.rotation.z = x < 0 ? 0.58 : -0.58;
        upper.add(lower);
        this.capsule(lower, 0.05, 0.27, [0, -0.18, 0], kit.shellDark);
        this.sphere(lower, 0.075, [x < 0 ? 0.08 : -0.08, -0.39, 0], kit.rubber);
        locomotionParts.push(upper, lower);
      }
    }
    const carrySocket = this.socket(body, 'quadrant-q4:carry:dorsal-payload-rack', [0, 1.02, 0]);
    return { root, body, sensor, locomotionParts, manipulatorParts: [sensor], carrySocket };
  }

  private createForge(kit: MaterialKit): ProceduralVisual {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.box(body, [1.38, 0.4, 0.9], [0, 0.45, 0], kit.shellDark, 0.09);
    const locomotionParts: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const track = new THREE.Group();
      track.position.set(side * 0.67, 0.38, 0);
      body.add(track);
      this.box(track, [0.31, 0.43, 1.16], [0, 0, 0], kit.rubber, 0.09);
      for (const z of [-0.38, 0, 0.38]) {
        const wheel = this.cylinder(track, 0.15, 0.34, [0, -0.01, z], kit.structure);
        wheel.rotation.z = Math.PI / 2;
        locomotionParts.push(wheel);
      }
    }
    this.box(body, [0.86, 0.35, 0.62], [0, 0.78, 0.08], kit.shell, 0.1);
    this.box(body, [0.58, 0.07, 0.05], [0, 0.78, -0.33], kit.status, 0.015);

    const mast = new THREE.Group();
    mast.position.set(0.42, 1, 0.16);
    body.add(mast);
    this.cylinder(mast, 0.07, 0.44, [0, 0.2, 0], kit.structure);
    this.box(mast, [0.25, 0.14, 0.17], [0, 0.45, -0.02], kit.glass, 0.04);

    const armBase = new THREE.Group();
    armBase.position.set(-0.28, 1.02, 0.22);
    body.add(armBase);
    this.cylinder(armBase, 0.2, 0.16, [0, 0.08, 0], kit.structure);
    const boom = new THREE.Group();
    boom.position.set(0, 0.18, 0);
    boom.rotation.x = -0.48;
    armBase.add(boom);
    this.box(boom, [0.25, 0.75, 0.28], [0, 0.36, 0], kit.shell, 0.07);
    const forearm = new THREE.Group();
    forearm.position.set(0, 0.78, 0);
    forearm.rotation.x = 0.96;
    boom.add(forearm);
    this.box(forearm, [0.2, 0.64, 0.22], [0, 0.3, 0], kit.structure, 0.055);
    this.box(forearm, [0.45, 0.15, 0.25], [0, 0.67, 0], kit.rubber, 0.04);
    const carrySocket = this.socket(forearm, 'forge-t7:carry:quick-change-gripper', [0, 0.72, 0]);
    return {
      root,
      body,
      sensor: mast,
      locomotionParts,
      manipulatorParts: [armBase, boom, forearm],
      carrySocket,
    };
  }

  private createSwift(kit: MaterialKit): ProceduralVisual {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.cylinder(body, 0.45, 0.24, [0, 0.3, 0], kit.shellDark, 32);
    this.cylinder(body, 0.36, 0.18, [0, 0.51, 0], kit.shell, 32);
    const locomotionParts: THREE.Object3D[] = [];
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const wheel = this.cylinder(
        body,
        0.12,
        0.18,
        [Math.sin(angle) * 0.39, 0.25, Math.cos(angle) * 0.39],
        kit.rubber,
        18,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.rotation.y = angle;
      locomotionParts.push(wheel);
    }
    this.cylinder(body, 0.12, 0.65, [0, 0.84, 0], kit.structure, 24);
    this.box(body, [0.5, 0.3, 0.34], [0, 1.23, 0], kit.shell, 0.12);
    this.box(body, [0.32, 0.055, 0.035], [0, 1.27, -0.19], kit.status, 0.01);
    const sensor = new THREE.Group();
    sensor.position.set(0, 1.43, -0.02);
    body.add(sensor);
    this.box(sensor, [0.33, 0.11, 0.24], [0, 0, 0], kit.glass, 0.05);

    const manipulatorParts: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.32, 1.32, 0);
      arm.rotation.z = side * 0.3;
      body.add(arm);
      this.capsule(arm, 0.045, 0.25, [0, -0.17, 0], kit.shell);
      const forearm = new THREE.Group();
      forearm.position.y = -0.36;
      forearm.rotation.z = -side * 0.45;
      arm.add(forearm);
      this.capsule(forearm, 0.042, 0.23, [0, -0.16, 0], kit.structure);
      this.box(forearm, [0.12, 0.08, 0.14], [0, -0.34, 0], kit.rubber, 0.035);
      manipulatorParts.push(arm, forearm);
    }
    const carrySocket = this.socket(body, 'swift-w2:carry:dual-arm-cradle-center', [0, 1.02, 0.5]);
    return { root, body, sensor, locomotionParts, manipulatorParts, carrySocket };
  }

  private createKestrel(kit: MaterialKit): ProceduralVisual {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.sphere(body, 0.28, [0, 0.9, 0], kit.shell);
    this.box(body, [0.42, 0.19, 0.37], [0, 0.9, 0], kit.shellDark, 0.12);
    this.box(body, [0.22, 0.04, 0.03], [0, 0.95, -0.22], kit.status, 0.01);
    const locomotionParts: THREE.Object3D[] = [];
    for (const x of [-0.42, 0.42]) {
      for (const z of [-0.36, 0.36]) {
        const duct = new THREE.Group();
        duct.position.set(x, 0.91, z);
        body.add(duct);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 10, 28), kit.structure);
        ring.rotation.x = Math.PI / 2;
        duct.add(ring);
        const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.018, 0.035), kit.rubber);
        duct.add(rotor);
        locomotionParts.push(rotor);
      }
    }
    const sensor = new THREE.Group();
    sensor.position.set(0, 0.69, -0.12);
    body.add(sensor);
    this.sphere(sensor, 0.11, [0, 0, 0], kit.glass);
    this.cylinder(body, 0.03, 0.25, [-0.18, 0.56, 0.12], kit.structure);
    this.cylinder(body, 0.03, 0.25, [0.18, 0.56, 0.12], kit.structure);
    const carrySocket = this.socket(body, 'kestrel-d5:carry:underslung-payload-hook', [0, 0.18, 0]);
    return { root, body, sensor, locomotionParts, manipulatorParts: [sensor], carrySocket };
  }

  private createMaterialKit(accent: string): MaterialKit {
    return {
      shell: new THREE.MeshStandardMaterial({
        color: '#dbe2e4',
        roughness: 0.36,
        metalness: 0.28,
      }),
      shellDark: new THREE.MeshStandardMaterial({
        color: '#293338',
        roughness: 0.42,
        metalness: 0.46,
      }),
      structure: new THREE.MeshStandardMaterial({
        color: '#737f84',
        roughness: 0.28,
        metalness: 0.8,
      }),
      rubber: new THREE.MeshStandardMaterial({
        color: '#111719',
        roughness: 0.92,
        metalness: 0.02,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: '#8fcbd5',
        roughness: 0.12,
        metalness: 0.05,
        transmission: 0.12,
        clearcoat: 0.8,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: accent,
        roughness: 0.3,
        metalness: 0.4,
      }),
      status: new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 2.2,
        roughness: 0.26,
      }),
    };
  }

  private box(
    parent: THREE.Object3D,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    radius = 0,
  ): THREE.Mesh {
    const geometry =
      radius > 0
        ? new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius)
        : new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private sphere(
    parent: THREE.Object3D,
    radius: number,
    position: [number, number, number],
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private capsule(
    parent: THREE.Object3D,
    radius: number,
    length: number,
    position: [number, number, number],
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 10), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private cylinder(
    parent: THREE.Object3D,
    radius: number,
    height: number,
    position: [number, number, number],
    material: THREE.Material,
    segments = 20,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, segments),
      material,
    );
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private socket(
    parent: THREE.Object3D,
    name: string,
    position: [number, number, number],
  ): THREE.Group {
    const socket = new THREE.Group();
    socket.name = name;
    socket.position.set(...position);
    socket.userData.carrySocket = true;
    parent.add(socket);
    return socket;
  }
}
