import * as THREE from 'three';
import type { WeaponDefinition } from '../data/weapons';
import type { AttachmentSelection } from '../game/types';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import { createWeaponModel } from '../weapons/WeaponViewModel';

type MaterialRole =
  | 'concrete'
  | 'steel'
  | 'gunmetal'
  | 'warning'
  | 'friendly'
  | 'hostile'
  | 'glass'
  | 'wet';

const materials: Record<MaterialRole, THREE.MeshStandardMaterial> = {
  concrete: new THREE.MeshStandardMaterial({
    color: '#3d4742',
    roughness: 0.88,
    metalness: 0.02,
  }),
  steel: new THREE.MeshStandardMaterial({
    color: '#52605a',
    roughness: 0.48,
    metalness: 0.62,
  }),
  gunmetal: new THREE.MeshStandardMaterial({
    color: '#242e2a',
    roughness: 0.3,
    metalness: 0.78,
  }),
  warning: new THREE.MeshStandardMaterial({
    color: '#b46a1c',
    emissive: '#6a2a06',
    emissiveIntensity: 0.45,
    roughness: 0.62,
    metalness: 0.18,
  }),
  friendly: new THREE.MeshStandardMaterial({
    color: '#b8ff3d',
    emissive: '#4b9514',
    emissiveIntensity: 1.7,
    roughness: 0.28,
    metalness: 0.22,
  }),
  hostile: new THREE.MeshStandardMaterial({
    color: '#bd312b',
    emissive: '#8e130f',
    emissiveIntensity: 1.35,
    roughness: 0.38,
    metalness: 0.24,
  }),
  glass: new THREE.MeshStandardMaterial({
    color: '#789188',
    roughness: 0.12,
    metalness: 0.18,
    transparent: true,
    opacity: 0.42,
  }),
  wet: new THREE.MeshStandardMaterial({
    color: '#34413b',
    roughness: 0.24,
    metalness: 0.12,
  }),
};

function makeBox(
  size: THREE.Vector3,
  position: THREE.Vector3,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.copy(position);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createLabel(
  title: string,
  subtitle: string,
  accent = '#b8ff3d',
  width = 512,
  height = 180,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create facility label.');
  context.fillStyle = '#0a0f0d';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = accent;
  context.lineWidth = 6;
  context.strokeRect(10, 10, width - 20, height - 20);
  context.fillStyle = accent;
  context.fillRect(28, 28, 12, height - 56);
  context.font = '700 54px sans-serif';
  context.fillStyle = '#e7eee8';
  context.fillText(title, 64, 80);
  context.font = '500 23px monospace';
  context.fillStyle = '#95a49b';
  context.fillText(subtitle.toUpperCase(), 64, 126);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addSign(
  parent: THREE.Group,
  text: string,
  sub: string,
  position: THREE.Vector3,
  rotationY = 0,
  accent = '#b8ff3d',
): void {
  const material = new THREE.MeshBasicMaterial({
    map: createLabel(text, sub, accent),
    transparent: true,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.88), material);
  sign.position.copy(position);
  sign.rotation.y = rotationY;
  parent.add(sign);
}

export class FacilityWorld {
  readonly operations = new THREE.Group();
  readonly mission = new THREE.Group();
  readonly shotTargets: THREE.Object3D[] = [];
  readonly securityCheckpointPosition = new THREE.Vector3(0, 1, -56);
  readonly commsTerminalPosition = new THREE.Vector3(0, 1.1, -63);
  readonly intelPosition = new THREE.Vector3(8.2, 1.05, -72);
  readonly extractionPosition = new THREE.Vector3(0, 1, -91);
  readonly blastDoorPosition = new THREE.Vector3(0, 1.8, -77);
  readonly coverNodes = [
    new THREE.Vector3(-5.5, 0, -57),
    new THREE.Vector3(5.8, 0, -58),
    new THREE.Vector3(-8.5, 0, -65),
    new THREE.Vector3(7.5, 0, -66),
    new THREE.Vector3(-9, 0, -75),
    new THREE.Vector3(9, 1.2, -78),
    new THREE.Vector3(-3, 0, -86),
    new THREE.Vector3(4.5, 0, -88),
  ];
  private readonly flickerLights: THREE.PointLight[] = [];
  private readonly operationsArt = new THREE.Group();
  private readonly missionArt = new THREE.Group();
  private readonly mintOperationsModels = new THREE.Group();
  private readonly mintMissionModels = new THREE.Group();
  private readonly dust: THREE.Points;
  private opsPreview: THREE.Group | null = null;
  private generatedOperationsActive = false;
  private generatedMissionActive = false;
  private proceduralBuilt = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    options: { minimal?: boolean } = {},
  ) {
    this.operations.name = 'operations-room';
    this.operations.position.x = 100;
    this.operationsArt.name = 'operations-room-procedural-art';
    this.mintOperationsModels.name = 'mint-operations-discrete-models';
    this.operations.add(this.operationsArt, this.mintOperationsModels);
    this.mission.name = 'site-nadir-12';
    this.missionArt.name = 'site-nadir-12-procedural-art';
    this.mintMissionModels.name = 'mint-mission-discrete-models';
    this.mission.add(this.missionArt, this.mintMissionModels);
    this.dust = this.createDust();
    this.missionArt.add(this.dust);
    this.scene.add(this.operations, this.mission);
    // Zombies deep-link skips the heavy procedural facility bake; it builds
    // on demand if the player later returns to Operations/Mission.
    if (!options.minimal) {
      this.ensureProceduralFacility();
      this.showOperations();
    } else {
      this.hideFacilityRoots();
    }
  }

  ensureProceduralFacility(): void {
    if (this.proceduralBuilt) return;
    this.buildOperationsRoom();
    this.buildMission();
    this.proceduralBuilt = true;
  }

  showOperations(): void {
    this.ensureProceduralFacility();
    this.operations.visible = true;
    this.operationsArt.visible = !this.generatedOperationsActive;
    this.mission.visible = false;
  }

  showMission(): void {
    this.operations.visible = false;
    this.mission.visible = true;
    this.missionArt.visible = !this.generatedMissionActive;
  }

  /** Hide Operations and Mission roots (Zombies owns the playspace via splats). */
  hideFacilityRoots(): void {
    this.operations.visible = false;
    this.mission.visible = false;
  }

  setGeneratedMissionActive(active: boolean): void {
    this.generatedMissionActive = active;
    if (this.operations.visible) {
      this.mission.visible = false;
    } else {
      this.mission.visible = true;
      this.missionArt.visible = !active;
    }
  }

  setGeneratedOperationsActive(active: boolean): void {
    this.generatedOperationsActive = active;
    this.operationsArt.visible = this.operations.visible && !active;
  }

  configureMissionLayout(spawn: THREE.Vector3, bounds: THREE.Box3): void {
    const minZ = bounds.min.z + 3;
    const maxZ = bounds.max.z - 3;
    const clampZ = (value: number): number => THREE.MathUtils.clamp(value, minZ, maxZ);
    const clampX = (value: number): number =>
      THREE.MathUtils.clamp(value, bounds.min.x + 3, bounds.max.x - 3);
    const ground = (x: number, z: number, preferY: number, lift = 0): number => {
      const footY = this.physics.findGroundedFootY(x, z, preferY + 2, 12);
      return footY + lift;
    };

    const securityX = spawn.x;
    const securityZ = clampZ(spawn.z - 6);
    this.securityCheckpointPosition.set(
      securityX,
      ground(securityX, securityZ, spawn.y),
      securityZ,
    );

    const commsX = clampX(spawn.x - 6);
    const commsZ = clampZ(spawn.z - 10);
    this.commsTerminalPosition.set(
      commsX,
      ground(commsX, commsZ, spawn.y + 0.1),
      commsZ,
    );

    const intelX = clampX(spawn.x + 7);
    const intelZ = clampZ(spawn.z - 14);
    // Echo Ledger sits on a console / table surface above the floor.
    this.intelPosition.set(intelX, ground(intelX, intelZ, spawn.y, 0.92), intelZ);

    const extractX = clampX(spawn.x - 7);
    const extractZ = clampZ(spawn.z - 18);
    this.extractionPosition.set(
      extractX,
      ground(extractX, extractZ, spawn.y),
      extractZ,
    );

    const blastX = clampX(spawn.x + 9);
    const blastZ = clampZ(spawn.z - 17);
    this.blastDoorPosition.set(blastX, ground(blastX, blastZ, spawn.y + 0.8), blastZ);

    const coverLayout: Array<[number, number, number]> = [
      [-4.5, 0, -6],
      [4.8, 0, -7],
      [-7.5, 0, -10],
      [7, 0, -11],
      [-8, 0, -15],
      [8, 1.2, -15],
      [-3, 0, -18],
      [4.5, 0, -18],
    ];
    this.coverNodes.forEach((node, index) => {
      const [offsetX, offsetY, offsetZ] = coverLayout[index];
      const x = clampX(spawn.x + offsetX);
      const z = clampZ(spawn.z + offsetZ);
      node.set(x, ground(x, z, spawn.y + offsetY), z);
    });
    this.updateMintMissionModelPosition(
      'interactable-comms-terminal',
      this.commsTerminalPosition,
    );
    this.updateMintMissionModelPosition('interactable-echo-ledger', this.intelPosition);
    this.updateMintMissionModelPosition(
      'interactable-extraction-beacon',
      this.extractionPosition,
    );
    this.updateMintMissionModelPosition('door-security', this.securityCheckpointPosition);
    this.updateMintMissionModelPosition('door-blast', this.blastDoorPosition);
  }

  setOperationsWeapon(
    weapon: WeaponDefinition,
    attachments: AttachmentSelection,
  ): void {
    if (this.opsPreview) this.operations.remove(this.opsPreview);
    this.opsPreview = createWeaponModel(weapon, attachments);
    this.opsPreview.position.set(0.4, 1.48, -0.2);
    this.opsPreview.rotation.set(-0.08, -0.48, 0.02);
    this.opsPreview.scale.setScalar(2.4);
    this.operations.add(this.opsPreview);
  }

  clearOperationsWeapon(): void {
    if (!this.opsPreview) return;
    this.operations.remove(this.opsPreview);
    this.opsPreview = null;
  }

  setOperationsWeaponModel(model: THREE.Group): void {
    if (this.opsPreview) this.operations.remove(this.opsPreview);
    this.opsPreview = model;
    this.opsPreview.position.set(0.4, 1.48, -0.2);
    this.opsPreview.rotation.set(-0.08, -0.48, 0.02);
    this.opsPreview.scale.setScalar(2.4);
    this.operations.add(this.opsPreview);
  }

  installMintMissionModel(
    id: string,
    model: THREE.Group,
    position: THREE.Vector3,
    scale = 1,
    rotationY = 0,
    mount: 'floor' | 'center' | 'table' = 'floor',
  ): void {
    model.name = `mint-production-${id}`;
    model.rotation.set(0, rotationY, 0);
    model.scale.multiplyScalar(scale);
    this.placeMountedModel(model, position, mount);
    this.mintMissionModels.add(model);
  }

  installMintOperationsModel(
    id: string,
    model: THREE.Group,
    position: THREE.Vector3,
    scale = 1,
    rotationY = 0,
  ): void {
    model.name = `mint-production-${id}`;
    model.position.copy(position);
    model.rotation.set(0, rotationY, 0);
    model.scale.multiplyScalar(scale);
    this.mintOperationsModels.add(model);
  }

  get mintProductionModelCount(): number {
    return this.mintMissionModels.children.length + this.mintOperationsModels.children.length;
  }

  private placeMountedModel(
    model: THREE.Group,
    position: THREE.Vector3,
    mount: 'floor' | 'center' | 'table',
  ): void {
    if (mount === 'center') {
      model.position.copy(position);
      return;
    }
    // Measure bounds at the target XZ with Y=0, then lift so the bottom sits on the surface.
    model.position.set(position.x, 0, position.z);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    model.position.y = position.y - bounds.min.y;
    if (mount === 'table') {
      model.position.y += 0.01;
    }
  }

  private updateMintMissionModelPosition(id: string, position: THREE.Vector3): void {
    const model = this.mintMissionModels.getObjectByName(`mint-production-${id}`);
    if (!model || !(model instanceof THREE.Group)) return;
    const mount =
      id === 'interactable-echo-ledger'
        ? 'table'
        : id.startsWith('door-')
          ? 'floor'
          : 'floor';
    this.placeMountedModel(model, position, mount);
  }

  update(delta: number, elapsed: number, reducedMotion: boolean): void {
    if (this.opsPreview && !reducedMotion) {
      this.opsPreview.rotation.y = -0.48 + Math.sin(elapsed * 0.34) * 0.08;
      this.opsPreview.position.y = 1.48 + Math.sin(elapsed * 0.7) * 0.015;
    }
    // Procedural dust lives on missionArt; skip the attribute rewrite when the
    // art root is hidden (Mint/splat modes) or motion is reduced.
    if (!reducedMotion && this.missionArt.visible) {
      this.dust.rotation.y += delta * 0.012;
      const positions = this.dust.geometry.attributes.position;
      for (let i = 1; i < positions.count * 3; i += 3) {
        let y = positions.array[i] as number;
        y += delta * 0.05;
        if (y > 4) y = 0.15;
        positions.array[i] = y;
      }
      positions.needsUpdate = true;
    }
    this.flickerLights.forEach((light, index) => {
      const noise = Math.sin(elapsed * (5.7 + index * 0.37) + index) * 0.5 + 0.5;
      light.intensity = index % 3 === 0 && noise > 0.82 ? 8 : 42;
    });
  }

  dispose(): void {
    this.scene.remove(this.operations, this.mission);
    for (const root of [this.operations, this.mission]) {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const meshMaterials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of meshMaterials) {
          if (
            !Object.values(materials).includes(material as THREE.MeshStandardMaterial)
          ) {
            material.dispose();
          }
        }
      });
    }
  }

  private buildOperationsRoom(): void {
    const room = this.operationsArt;
    const floor = makeBox(
      new THREE.Vector3(15, 0.2, 12),
      new THREE.Vector3(0, -0.1, 0),
      materials.wet,
      'ops-floor',
    );
    room.add(floor);
    room.add(
      makeBox(
        new THREE.Vector3(15, 4.5, 0.28),
        new THREE.Vector3(0, 2.25, -5.9),
        materials.concrete,
        'ops-back-wall',
      ),
      makeBox(
        new THREE.Vector3(0.28, 4.5, 12),
        new THREE.Vector3(-7.4, 2.25, 0),
        materials.concrete,
        'ops-side-wall',
      ),
      makeBox(
        new THREE.Vector3(15, 0.22, 12),
        new THREE.Vector3(0, 4.45, 0),
        materials.gunmetal,
        'ops-ceiling',
      ),
    );

    const table = makeBox(
      new THREE.Vector3(4.2, 0.18, 1.65),
      new THREE.Vector3(0.6, 0.92, -0.25),
      materials.gunmetal,
      'inspection-table',
    );
    room.add(table);
    for (const x of [-1.15, 2.25]) {
      room.add(
        makeBox(
          new THREE.Vector3(0.18, 0.9, 1.45),
          new THREE.Vector3(x, 0.45, -0.25),
          materials.steel,
          'table-leg',
        ),
      );
    }

    for (let index = 0; index < 6; index += 1) {
      const rack = makeBox(
        new THREE.Vector3(1.65, 1.1, 0.15),
        new THREE.Vector3(-5.4 + (index % 2) * 2, 1.5 + Math.floor(index / 2) * 1.05, -5.66),
        index === 0 ? materials.friendly : materials.steel,
        `weapon-rack-${index}`,
      );
      room.add(rack);
    }
    addSign(
      room,
      'ECHO CELL',
      'Signal Recovery Office // Restricted',
      new THREE.Vector3(4.7, 2.9, -5.72),
      0,
    );
    addSign(
      room,
      'SITE NADIR-12',
      'Communications blackout active',
      new THREE.Vector3(-7.24, 2.6, 1.7),
      Math.PI / 2,
      '#ffb23d',
    );

    const key = new THREE.RectAreaLight('#d9ffb0', 18, 7, 4);
    key.position.set(0, 4.2, 1);
    key.rotation.x = -Math.PI / 2;
    room.add(key);
    const rim = new THREE.PointLight('#8dff50', 48, 13, 2);
    rim.position.set(4.6, 2.3, -3.6);
    room.add(rim);
  }

  private buildMission(): void {
    const group = this.missionArt;
    this.addZone(group, 'checkpoint', new THREE.Vector3(0, 0, -4), 8, 24);
    this.addZone(group, 'service-tunnel', new THREE.Vector3(0, 0, -26), 6, 20);
    this.addZone(group, 'communications', new THREE.Vector3(0, 0, -44), 22, 16);
    this.addZone(group, 'generator-arena', new THREE.Vector3(0, 0, -66), 28, 30);
    this.addZone(group, 'extraction', new THREE.Vector3(0, 0, -91), 10, 20);

    for (const z of [3, -5, -14, -24, -33]) {
      this.addCeilingBeam(group, z, 7.6);
    }
    for (const z of [-39, -46, -52, -58, -66, -74, -80, -87, -96]) {
      this.addCeilingBeam(group, z, z > -54 ? 21 : z > -82 ? 27 : 9.5);
    }

    this.addSecurityCheckpoint(group);
    this.addServiceTunnel(group);
    this.addCommunications(group);
    this.addArena(group);
    this.addExtraction(group);
    this.addPracticalLights(group);
  }

  private addZone(
    parent: THREE.Group,
    name: string,
    center: THREE.Vector3,
    width: number,
    depth: number,
  ): void {
    const floor = makeBox(
      new THREE.Vector3(width, 0.2, depth),
      new THREE.Vector3(center.x, -0.1, center.z),
      name === 'service-tunnel' || name === 'communications' ? materials.wet : materials.concrete,
      `${name}-floor`,
    );
    this.addShotTarget(floor);
    parent.add(floor);
    this.physics.addBox(floor.position, new THREE.Vector3(width / 2, 0.1, depth / 2));

    const wallHeight = 4.5;
    for (const side of [-1, 1]) {
      const wall = makeBox(
        new THREE.Vector3(0.28, wallHeight, depth),
        new THREE.Vector3(center.x + side * (width / 2), wallHeight / 2, center.z),
        materials.concrete,
        `${name}-wall`,
      );
      this.addShotTarget(wall);
      parent.add(wall);
      this.physics.addBox(wall.position, new THREE.Vector3(0.14, wallHeight / 2, depth / 2));
      const lowerTrim = makeBox(
        new THREE.Vector3(0.12, 0.55, depth),
        new THREE.Vector3(
          center.x + side * (width / 2 - 0.17),
          0.32,
          center.z,
        ),
        materials.gunmetal,
        `${name}-wall-trim`,
      );
      parent.add(lowerTrim);
    }
    const ceiling = makeBox(
      new THREE.Vector3(width, 0.18, depth),
      new THREE.Vector3(center.x, 4.45, center.z),
      materials.gunmetal,
      `${name}-ceiling`,
    );
    parent.add(ceiling);
  }

  private addCeilingBeam(parent: THREE.Group, z: number, width: number): void {
    const beam = makeBox(
      new THREE.Vector3(width, 0.28, 0.36),
      new THREE.Vector3(0, 4.05, z),
      materials.steel,
      'ceiling-beam',
    );
    parent.add(beam);
  }

  private addSecurityCheckpoint(parent: THREE.Group): void {
    for (const x of [-2.15, 2.15]) {
      const booth = makeBox(
        new THREE.Vector3(1.5, 2.2, 2),
        new THREE.Vector3(x, 1.1, -7),
        materials.steel,
        'security-booth',
      );
      this.addShotTarget(booth);
      parent.add(booth);
      this.physics.addBox(booth.position, new THREE.Vector3(0.75, 1.1, 1));
      const glass = makeBox(
        new THREE.Vector3(1.16, 0.7, 0.035),
        new THREE.Vector3(x, 1.5, -5.98),
        materials.glass,
        'security-glass',
      );
      parent.add(glass);
    }
    addSign(
      parent,
      'S-01',
      'Security checkpoint // report credentials',
      new THREE.Vector3(-3.83, 2.8, -10),
      Math.PI / 2,
      '#ffb23d',
    );
    this.addCover(parent, new THREE.Vector3(-2.4, 0.55, -14), new THREE.Vector3(2.3, 1.1, 0.8));
    this.addCover(parent, new THREE.Vector3(2.7, 0.38, -18), new THREE.Vector3(1.9, 0.76, 1.1));
  }

  private addServiceTunnel(parent: THREE.Group): void {
    for (const side of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        const pipe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1 + index * 0.025, 0.1 + index * 0.025, 18, 10),
          index === 1 ? materials.warning : materials.steel,
        );
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(side * (2.55 - index * 0.23), 3.2 - index * 0.3, -27);
        pipe.castShadow = true;
        parent.add(pipe);
      }
    }
    addSign(
      parent,
      'C-12',
      'Cooling exchange // pressure hazard',
      new THREE.Vector3(2.83, 2.4, -28),
      -Math.PI / 2,
      '#ffb23d',
    );
  }

  private addCommunications(parent: THREE.Group): void {
    for (const x of [-7.2, -3.6, 3.6, 7.2]) {
      const rack = makeBox(
        new THREE.Vector3(1.45, 2.8, 1.1),
        new THREE.Vector3(x, 1.4, -44),
        materials.gunmetal,
        'server-rack',
      );
      this.addShotTarget(rack);
      parent.add(rack);
      this.physics.addBox(rack.position, new THREE.Vector3(0.725, 1.4, 0.55));
      for (let row = 0; row < 5; row += 1) {
        const light = makeBox(
          new THREE.Vector3(0.82, 0.025, 0.02),
          new THREE.Vector3(x, 0.45 + row * 0.42, -43.43),
          row === 4 ? materials.hostile : materials.friendly,
          'server-status',
        );
        parent.add(light);
      }
    }
    const terminal = makeBox(
      new THREE.Vector3(2.8, 1.75, 0.9),
      this.commsTerminalPosition.clone().setY(0.875),
      materials.steel,
      'eidolon-terminal',
    );
    this.addShotTarget(terminal);
    parent.add(terminal);
    this.physics.addBox(terminal.position, new THREE.Vector3(1.4, 0.875, 0.45));
    const screen = makeBox(
      new THREE.Vector3(1.9, 0.72, 0.025),
      new THREE.Vector3(0, 1.25, -44.74),
      materials.hostile,
      'eidolon-screen',
    );
    parent.add(screen);
    const intel = makeBox(
      new THREE.Vector3(0.76, 0.18, 0.54),
      this.intelPosition,
      materials.friendly,
      'echo-ledger',
    );
    parent.add(intel);
    this.addCover(parent, new THREE.Vector3(-6, 0.55, -50), new THREE.Vector3(3, 1.1, 0.8));
    this.addCover(parent, new THREE.Vector3(6.8, 0.55, -38), new THREE.Vector3(2.4, 1.1, 0.8));
    addSign(
      parent,
      'EIDOLON ARRAY',
      'Quantum relay // unauthorized traffic recorded',
      new THREE.Vector3(-10.84, 3, -44),
      Math.PI / 2,
      '#ff5147',
    );
  }

  private addArena(parent: THREE.Group): void {
    this.addCover(parent, new THREE.Vector3(-8.5, 0.65, -60), new THREE.Vector3(3.2, 1.3, 1));
    this.addCover(parent, new THREE.Vector3(2.5, 0.42, -59), new THREE.Vector3(2.3, 0.84, 1));
    this.addCover(parent, new THREE.Vector3(-3, 0.55, -68), new THREE.Vector3(3, 1.1, 1.1));
    this.addCover(parent, new THREE.Vector3(5.5, 0.65, -74), new THREE.Vector3(3.2, 1.3, 1));
    this.addCover(parent, new THREE.Vector3(-8.4, 0.4, -76), new THREE.Vector3(2.4, 0.8, 1.1));

    const platform = makeBox(
      new THREE.Vector3(4.5, 0.24, 18),
      new THREE.Vector3(10.2, 1.25, -68),
      materials.steel,
      'upper-platform',
    );
    this.addShotTarget(platform);
    parent.add(platform);
    this.physics.addBox(platform.position, new THREE.Vector3(2.25, 0.12, 9));

    const ramp = makeBox(
      new THREE.Vector3(4.5, 0.24, 8),
      new THREE.Vector3(10.2, 0.62, -55.8),
      materials.steel,
      'platform-ramp',
    );
    ramp.rotation.x = -0.155;
    this.addShotTarget(ramp);
    parent.add(ramp);
    this.physics.addRamp(ramp.position, new THREE.Vector3(2.25, 0.12, 4), -0.155);

    for (const z of [-60, -66, -72]) {
      const machinery = makeBox(
        new THREE.Vector3(2.2, 3.2, 2.2),
        new THREE.Vector3(-11.6, 1.6, z),
        materials.gunmetal,
        'generator-core',
      );
      this.addShotTarget(machinery);
      parent.add(machinery);
      this.physics.addBox(machinery.position, new THREE.Vector3(1.1, 1.6, 1.1));
      const core = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.08, 10, 24),
        materials.warning,
      );
      core.position.set(-10.45, 1.75, z);
      core.rotation.y = Math.PI / 2;
      parent.add(core);
    }
    addSign(
      parent,
      'G-07',
      'Generator court // emergency routing',
      new THREE.Vector3(13.84, 2.8, -65),
      -Math.PI / 2,
      '#ff5147',
    );
  }

  private addExtraction(parent: THREE.Group): void {
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.6, 0.16, 32),
      materials.steel,
    );
    platform.position.set(0, 0.06, -94);
    platform.receiveShadow = true;
    parent.add(platform);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.15, 0.055, 8, 48),
      materials.friendly,
    );
    ring.position.set(0, 0.18, -94);
    ring.rotation.x = Math.PI / 2;
    parent.add(ring);
    for (const x of [-3.8, 3.8]) {
      const beacon = makeBox(
        new THREE.Vector3(0.28, 2.6, 0.28),
        new THREE.Vector3(x, 1.3, -94),
        materials.friendly,
        'extraction-beacon',
      );
      parent.add(beacon);
    }
    addSign(
      parent,
      'X-RAY',
      'Emergency extraction // maintain perimeter',
      new THREE.Vector3(-4.84, 2.4, -94),
      Math.PI / 2,
    );
  }

  private addCover(
    parent: THREE.Group,
    position: THREE.Vector3,
    size: THREE.Vector3,
  ): void {
    const cover = makeBox(size, position, materials.steel, 'cover');
    this.addShotTarget(cover);
    parent.add(cover);
    this.physics.addBox(position, size.clone().multiplyScalar(0.5));
    const stripe = makeBox(
      new THREE.Vector3(size.x * 0.64, 0.08, size.z + 0.02),
      position.clone().add(new THREE.Vector3(0, size.y * 0.32, 0)),
      materials.warning,
      'cover-warning-stripe',
    );
    parent.add(stripe);
  }

  private addPracticalLights(parent: THREE.Group): void {
    const placements: Array<[number, number, string]> = [
      [5, 0, '#d8e7dc'],
      [-4, 0, '#b8ff3d'],
      [-14, 0, '#ffb23d'],
      [-26, 0, '#d8e7dc'],
      [-40, -6, '#ff5147'],
      [-48, 6, '#ff5147'],
      [-58, -8, '#ffb23d'],
      [-68, 8, '#ff5147'],
      [-78, -4, '#ffb23d'],
      [-91, 0, '#b8ff3d'],
    ];
    placements.forEach(([z, x, color], index) => {
      const fixture = makeBox(
        new THREE.Vector3(1.25, 0.08, 0.3),
        new THREE.Vector3(x, 4.05, z),
        color === '#b8ff3d'
          ? materials.friendly
          : color === '#ff5147'
            ? materials.hostile
            : materials.warning,
        'practical-light',
      );
      parent.add(fixture);
      if (index % 2 === 0 || z < -80) {
        const light = new THREE.PointLight(color, 42, 13, 2);
        light.position.set(x, 3.6, z);
        parent.add(light);
        this.flickerLights.push(light);
      }
    });
  }

  private addShotTarget(object: THREE.Object3D): void {
    object.userData.blocksShots = true;
    this.shotTargets.push(object);
  }

  private createDust(): THREE.Points {
    const count = 360;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const n = ((index * 9301 + 49297) % 233280) / 233280;
      const n2 = ((index * 7919 + 104729) % 233280) / 233280;
      const n3 = ((index * 3571 + 34567) % 233280) / 233280;
      positions[offset] = (n - 0.5) * 26;
      positions[offset + 1] = 0.15 + n2 * 3.8;
      positions[offset + 2] = 8 - n3 * 108;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: '#c9d3ca',
        size: 0.025,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
  }
}
