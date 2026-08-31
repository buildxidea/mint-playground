import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  createRoundedRinkBandGeometry,
  createRoundedRinkSurfaceGeometry,
  sampleRoundedRinkPerimeter,
} from '../game/RinkShape';
import type { LevelDefinition, ObstacleDefinition } from '../game/types';
import type { CoverageVisuals } from '../systems/CoverageSystem';
import { MaterialLibrary } from './MaterialLibrary';
import { fitMintModel, loadMintModel } from './MintAssetLibrary';

export class ArenaScene {
  readonly group = new THREE.Group();
  readonly materials = new MaterialLibrary();

  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly specialMaterials = new Set<THREE.Material>();
  private readonly animatedSignals: THREE.Mesh[] = [];
  private readonly coverageRoughnessTexture: THREE.Texture;
  private iceMaterial: THREE.MeshPhysicalMaterial | null = null;
  private iceColorTexture: THREE.Texture | null = null;
  private scuffLayer: THREE.Mesh | null = null;
  private finishLayer: THREE.Mesh | null = null;
  private readonly obstaclePresentations: Array<{ obstacle: ObstacleDefinition; root: THREE.Group }> = [];
  private disposed = false;

  constructor(
    private readonly level: LevelDefinition,
    visuals: CoverageVisuals,
    maxAnisotropy: number,
  ) {
    this.coverageRoughnessTexture = visuals.roughnessTexture;
    this.group.name = `arena-${level.id}`;
    this.buildIce(visuals, maxAnisotropy);
    this.buildBoards();
    this.buildRinkMarkings();
    this.buildArenaShell();
    this.buildDock();
    for (const obstacle of level.obstacles) {
      const root = this.createObstacle(obstacle);
      this.obstaclePresentations.push({ obstacle, root });
      this.group.add(root);
    }
    void this.loadMintPresentation().catch((error: unknown) => {
      console.warn('Mint arena presentation could not be loaded.', error);
    });
  }

  update(elapsed: number, reducedMotion: boolean): void {
    const time = reducedMotion ? 0 : elapsed;
    for (const [index, signal] of this.animatedSignals.entries()) {
      signal.scale.setScalar(0.92 + Math.sin(time * 2.4 + index) * 0.08);
    }
  }

  setCoverageDebugView(enabled: boolean): void {
    if (!this.iceMaterial) return;
    this.iceMaterial.map = enabled ? this.coverageRoughnessTexture : this.iceColorTexture;
    this.iceMaterial.color.set(enabled ? '#ffffff' : '#d9f5f9');
    this.iceMaterial.roughness = enabled ? 0.08 : 0.94;
    this.iceMaterial.needsUpdate = true;
    if (this.scuffLayer) this.scuffLayer.visible = !enabled;
    if (this.finishLayer) this.finishLayer.visible = !enabled;
  }

  dispose(): void {
    this.disposed = true;
    for (const geometry of this.geometries) geometry.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const material of this.specialMaterials) material.dispose();
    this.materials.dispose();
  }

  private buildIce(visuals: CoverageVisuals, maxAnisotropy: number): void {
    const iceTexture = this.createIceTexture(maxAnisotropy);
    const iceMaterial = this.specialMaterial(new THREE.MeshPhysicalMaterial({
      color: '#d9f5f9',
      map: iceTexture,
      roughnessMap: visuals.roughnessTexture,
      roughness: 0.94,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.09,
      envMapIntensity: 1.15,
    }));
    this.iceMaterial = iceMaterial;
    this.iceColorTexture = iceTexture;
    const ice = this.mesh(createRoundedRinkSurfaceGeometry(this.level), iceMaterial);
    ice.name = 'coverageIce';
    ice.rotation.x = -Math.PI / 2;
    ice.receiveShadow = true;
    this.group.add(ice);

    const finishMaterial = this.specialMaterial(new THREE.MeshBasicMaterial({
      map: visuals.finishTexture,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }));
    const finish = this.mesh(createRoundedRinkSurfaceGeometry(this.level, 0.02), finishMaterial);
    finish.name = 'resurfacedFinish';
    finish.rotation.x = -Math.PI / 2;
    finish.position.y = 0.042;
    finish.renderOrder = 3;
    this.finishLayer = finish;
    this.group.add(finish);

    const scuffMaterial = this.specialMaterial(new THREE.MeshBasicMaterial({
      map: visuals.scuffTexture,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }));
    const scuffs = this.mesh(createRoundedRinkSurfaceGeometry(this.level, 0.03), scuffMaterial);
    scuffs.name = 'skateMarks';
    scuffs.rotation.x = -Math.PI / 2;
    scuffs.position.y = 0.046;
    scuffs.renderOrder = 4;
    this.scuffLayer = scuffs;
    this.group.add(scuffs);

    const surround = this.mesh(
      new THREE.BoxGeometry(this.level.halfWidth * 2 + 9, 0.44, this.level.halfDepth * 2 + 9),
      this.materials.deepNavy,
    );
    surround.position.y = -0.28;
    surround.receiveShadow = true;
    this.group.add(surround);
  }

  private buildRinkMarkings(): void {
    const markRed = this.specialMaterial(new THREE.MeshBasicMaterial({ color: '#dc5e62', transparent: true, opacity: 0.72 }));
    const markBlue = this.specialMaterial(new THREE.MeshBasicMaterial({ color: '#458bb8', transparent: true, opacity: 0.68 }));
    const markWhite = this.specialMaterial(new THREE.MeshBasicMaterial({ color: '#f4fdff', transparent: true, opacity: 0.5 }));
    const y = 0.056;

    const centerLine = this.mesh(new THREE.PlaneGeometry(0.1, this.level.halfDepth * 2 - 0.25), markRed);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = y;
    this.group.add(centerLine);
    for (const x of [-4.7, 4.7]) {
      const line = this.mesh(new THREE.PlaneGeometry(0.18, this.level.halfDepth * 2 - 0.25), markBlue);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, y, 0);
      this.group.add(line);
    }

    const ringGeometry = this.geometry(new THREE.RingGeometry(1.05, 1.11, 48));
    for (const [x, z, material] of [
      [0, 0, markRed], [-8.2, -3.45, markRed], [-8.2, 3.45, markRed], [8.2, -3.45, markRed], [8.2, 3.45, markRed],
    ] as Array<[number, number, THREE.Material]>) {
      const ring = this.mesh(ringGeometry, material, false);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y + 0.002, z);
      this.group.add(ring);
    }
    const centerDot = this.mesh(new THREE.CircleGeometry(0.12, 24), markRed);
    centerDot.rotation.x = -Math.PI / 2;
    centerDot.position.y = y + 0.004;
    this.group.add(centerDot);

    const crestMaterial = this.specialMaterial(new THREE.MeshBasicMaterial({ color: '#32a8ba', transparent: true, opacity: 0.13 }));
    const crestRing = this.mesh(new THREE.RingGeometry(1.82, 2.02, 6), crestMaterial);
    crestRing.rotation.x = -Math.PI / 2;
    crestRing.position.y = y - 0.006;
    this.group.add(crestRing);
    const crestSpokeGeometry = this.geometry(new THREE.PlaneGeometry(0.12, 3.1));
    for (let index = 0; index < 6; index += 1) {
      const spoke = this.mesh(crestSpokeGeometry, crestMaterial, false);
      spoke.rotation.x = -Math.PI / 2;
      spoke.rotation.z = (index / 6) * Math.PI;
      spoke.position.y = y - 0.005;
      this.group.add(spoke);
    }

    const goalCreaseGeometry = this.geometry(new THREE.RingGeometry(0.82, 0.88, 32, 1, 0, Math.PI));
    for (const x of [-12.55, 12.55]) {
      const crease = this.mesh(goalCreaseGeometry, markWhite, false);
      crease.rotation.x = -Math.PI / 2;
      crease.rotation.z = x < 0 ? -Math.PI / 2 : Math.PI / 2;
      crease.position.set(x, y + 0.002, 0);
      this.group.add(crease);
    }
  }

  private buildBoards(): void {
    const boardHeight = 0.88;
    const boardThickness = 0.34;
    const boardGeometry = this.geometry(createRoundedRinkBandGeometry(this.level, 0, boardThickness, boardHeight));
    const board = this.mesh(boardGeometry, this.materials.cream, false);
    board.name = 'roundedRinkBoards';
    board.rotation.x = -Math.PI / 2;
    board.castShadow = true;
    board.receiveShadow = true;
    this.group.add(board);

    const kickGeometry = this.geometry(createRoundedRinkBandGeometry(this.level, -0.006, boardThickness + 0.012, 0.13));
    const kick = this.mesh(kickGeometry, this.materials.yellow, false);
    kick.name = 'roundedKickplate';
    kick.rotation.x = -Math.PI / 2;
    kick.position.y = 0.002;
    this.group.add(kick);

    const capGeometry = this.geometry(createRoundedRinkBandGeometry(this.level, -0.016, boardThickness + 0.032, 0.1));
    const cap = this.mesh(capGeometry, this.materials.navy, false);
    cap.name = 'roundedBoardCap';
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = boardHeight;
    this.group.add(cap);

    const glassHeight = 1.16;
    const glassGeometry = this.geometry(createRoundedRinkBandGeometry(this.level, 0.14, 0.052, glassHeight));
    const glass = this.mesh(glassGeometry, this.materials.glass, false);
    glass.name = 'roundedRinkGlass';
    glass.rotation.x = -Math.PI / 2;
    glass.position.y = boardHeight + 0.1;
    glass.renderOrder = 2;
    this.group.add(glass);

    const postGeometry = this.geometry(new THREE.CylinderGeometry(0.035, 0.035, glassHeight + 0.16, 8));
    for (const point of sampleRoundedRinkPerimeter(this.level, 3.25, 0.21)) {
      const post = this.mesh(postGeometry, this.materials.metal, false);
      post.position.set(point.x, boardHeight + 0.1 + glassHeight * 0.5, point.z);
      this.group.add(post);
    }

  }

  private buildArenaShell(): void {
    const platformGeometry = this.geometry(new RoundedBoxGeometry(this.level.halfWidth * 2 + 6.8, 0.45, 2.6, 4, 0.12));
    for (const side of [-1, 1]) {
      const platform = this.mesh(platformGeometry, this.materials.navy, false);
      platform.position.set(0, 0.15, side * (this.level.halfDepth + 2.25));
      platform.receiveShadow = true;
      this.group.add(platform);
    }

    const seatGeometry = this.geometry(new RoundedBoxGeometry(0.46, 0.34, 0.5, 3, 0.08));
    const seatMaterials = [this.materials.paint, this.materials.coral, this.materials.yellow, this.materials.cream];
    const seatTransforms: THREE.Matrix4[][] = seatMaterials.map(() => []);
    const dummy = new THREE.Object3D();
    for (let row = 0; row < 3; row += 1) {
      for (const side of [-1, 1]) {
        for (let index = -18; index <= 18; index += 1) {
          const materialIndex = (index + row * 2 + 40) % seatMaterials.length;
          dummy.position.set(index * 0.72, 0.65 + row * 0.42, side * (this.level.halfDepth + 1.55 + row * 0.52));
          dummy.rotation.set(side > 0 ? -0.12 : 0.12, 0, 0);
          dummy.updateMatrix();
          seatTransforms[materialIndex].push(dummy.matrix.clone());
        }
      }
    }
    seatTransforms.forEach((transforms, materialIndex) => {
      const seats = new THREE.InstancedMesh(seatGeometry, seatMaterials[materialIndex], transforms.length);
      transforms.forEach((matrix, index) => seats.setMatrixAt(index, matrix));
      seats.instanceMatrix.needsUpdate = true;
      seats.castShadow = false;
      seats.receiveShadow = true;
      seats.computeBoundingSphere();
      this.group.add(seats);
    });

    const trussGeometry = this.geometry(new THREE.BoxGeometry(this.level.halfWidth * 2 + 7, 0.12, 0.12));
    const lightGeometry = this.geometry(new RoundedBoxGeometry(2.5, 0.11, 0.28, 3, 0.05));
    for (const z of [-6.4, -2.1, 2.1, 6.4]) {
      const truss = this.mesh(trussGeometry, this.materials.metal, false);
      truss.position.set(0, 12.6, z);
      this.group.add(truss);
      for (const x of [-10.5, -5.3, 0, 5.3, 10.5]) {
        const light = this.mesh(lightGeometry, this.materials.emissiveCool, false);
        light.position.set(x, 12.42, z);
        this.group.add(light);
      }
    }

    const scoreboard = this.mesh(new RoundedBoxGeometry(3.4, 1.25, 0.42, 5, 0.13), this.materials.deepNavy);
    scoreboard.position.set(0, 4.6, -this.level.halfDepth - 2.55);
    this.group.add(scoreboard);
    const scoreFace = this.mesh(new THREE.PlaneGeometry(2.86, 0.75), this.materials.emissiveCool);
    scoreFace.position.set(0, 4.6, -this.level.halfDepth - 2.78);
    this.group.add(scoreFace);

    const bannerGeometry = this.geometry(new THREE.PlaneGeometry(1.35, 1.85));
    const bannerMaterials = ['#ff6f4d', '#0d8fa4', '#ffc857'].map((color) =>
      this.specialMaterial(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })),
    );
    for (let index = 0; index < 5; index += 1) {
      const banner = this.mesh(bannerGeometry, bannerMaterials[index % bannerMaterials.length], false);
      banner.position.set(-9 + index * 4.5, 3.25 + (index % 2) * 0.2, -this.level.halfDepth - 1.05);
      this.group.add(banner);
      const bannerMark = this.mesh(new THREE.RingGeometry(0.28, 0.38, 6), this.materials.cream);
      bannerMark.position.copy(banner.position);
      bannerMark.position.z += 0.012;
      this.group.add(bannerMark);
    }

    const adGeometry = this.geometry(new THREE.PlaneGeometry(2.5, 0.38));
    const adMaterials = [this.materials.paint, this.materials.coral, this.materials.navy];
    for (const side of [-1, 1]) {
      for (let index = -3; index <= 3; index += 1) {
        const ad = this.mesh(adGeometry, adMaterials[(index + 5) % adMaterials.length], false);
        ad.position.set(index * 2.9, 0.5, side * (this.level.halfDepth + (side > 0 ? -0.011 : 0.011)));
        ad.rotation.y = side > 0 ? Math.PI : 0;
        this.group.add(ad);
      }
    }

    this.addExteriorBench(-6.2, this.level.halfDepth + 0.95, Math.PI);
    this.addExteriorBench(6.2, this.level.halfDepth + 0.95, Math.PI);
  }

  private buildDock(): void {
    const padMaterial = this.specialMaterial(new THREE.MeshBasicMaterial({
      color: '#6be0e8', transparent: true, opacity: 0.28, depthWrite: false,
    }));
    const pad = this.mesh(new THREE.RingGeometry(1.15, 1.38, 40), padMaterial);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(this.level.start.x, 0.064, this.level.start.z);
    this.group.add(pad);
    this.animatedSignals.push(pad);
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, -0.62);
    arrowShape.lineTo(0.52, 0.08);
    arrowShape.lineTo(0.18, 0.08);
    arrowShape.lineTo(0.18, 0.62);
    arrowShape.lineTo(-0.18, 0.62);
    arrowShape.lineTo(-0.18, 0.08);
    arrowShape.lineTo(-0.52, 0.08);
    arrowShape.closePath();
    const arrow = this.mesh(new THREE.ShapeGeometry(arrowShape), padMaterial, true);
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = this.level.start.heading;
    arrow.position.set(this.level.start.x, 0.066, this.level.start.z);
    this.group.add(arrow);
  }

  private createObstacle(obstacle: ObstacleDefinition): THREE.Group {
    const root = new THREE.Group();
    root.name = `obstacle-${obstacle.id}`;
    root.position.set(obstacle.x, 0.06, obstacle.z);
    root.rotation.y = obstacle.rotation ?? 0;

    if (obstacle.kind === 'cone') {
      const base = this.mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.12, 18), this.materials.rubber);
      base.position.y = 0.07;
      const body = this.mesh(new THREE.ConeGeometry(0.29, 0.88, 20), this.materials.coral);
      body.position.y = 0.52;
      const stripe = this.mesh(new THREE.CylinderGeometry(0.19, 0.235, 0.16, 20, 1, true), this.materials.cream);
      stripe.position.y = 0.49;
      root.add(base, body, stripe);
    } else if (obstacle.kind === 'puck') {
      const puck = this.mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.11, 24), this.materials.puck);
      puck.position.y = 0.08;
      const ring = this.mesh(new THREE.TorusGeometry(0.19, 0.018, 6, 20), this.materials.coral);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.145;
      root.add(puck, ring);
    } else if (obstacle.kind === 'goal') {
      this.addGoal(root);
    } else if (obstacle.kind === 'bench') {
      this.addBenchModel(root, obstacle.shape.type === 'box' ? obstacle.shape.halfWidth : 1.6);
    } else if (obstacle.kind === 'barrier') {
      const halfWidth = obstacle.shape.type === 'box' ? obstacle.shape.halfWidth : 2;
      const rail = this.mesh(new RoundedBoxGeometry(halfWidth * 2, 0.5, 0.28, 4, 0.08), this.materials.yellow);
      rail.position.y = 0.58;
      const stripe = this.mesh(new THREE.BoxGeometry(halfWidth * 1.8, 0.12, 0.295), this.materials.navy);
      stripe.position.y = 0.58;
      root.add(rail, stripe);
      for (const x of [-halfWidth + 0.25, halfWidth - 0.25]) {
        const foot = this.mesh(new THREE.BoxGeometry(0.42, 0.15, 0.7), this.materials.rubber);
        foot.position.set(x, 0.08, 0);
        root.add(foot);
      }
    } else {
      this.addEquipmentStack(root);
    }

    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = child.material !== this.materials.glass;
        child.receiveShadow = true;
      }
    });
    return root;
  }

  private async loadMintPresentation(): Promise<void> {
    const [boardStraight, boardCorner, glassStraight, glassCorner, arenaProps] = await Promise.all([
      loadMintModel('rink-board-straight'),
      loadMintModel('rink-board-corner-90'),
      loadMintModel('rink-glass-straight'),
      loadMintModel('rink-glass-corner-90'),
      loadMintModel('arena-props'),
    ]);
    if (this.disposed) return;

    const modules = new THREE.Group();
    modules.name = 'mintArenaPresentation';
    const display = new THREE.Group();
    display.name = 'mintRinkModuleDisplay';
    display.visible = false;
    // Keep the archive in the arena scene for provenance/runtime integration,
    // but behind the west concourse so it cannot read as a second rink wall.
    const bayX = -this.level.halfWidth - 8;
    const platform = this.mesh(new RoundedBoxGeometry(3.7, 0.28, 6.5, 5, 0.12), this.materials.deepNavy);
    platform.position.set(bayX, 0.02, 0);
    platform.receiveShadow = true;
    display.add(platform);

    fitMintModel(boardStraight, new THREE.Vector3(0.24, 0.72, 3.1), {
      centerX: bayX + 0.55,
      centerZ: 0,
      groundY: 0.18,
    });
    boardStraight.name = 'mintDisplayBoardStraight';
    display.add(boardStraight);
    fitMintModel(glassStraight, new THREE.Vector3(0.09, 0.84, 3.1), {
      rotationY: Math.PI / 2,
      centerX: bayX + 0.36,
      centerZ: 0,
      groundY: 0.9,
    });
    glassStraight.name = 'mintDisplayGlassStraight';
    display.add(glassStraight);
    fitMintModel(boardCorner, new THREE.Vector3(1.55, 0.7, 1.55), {
      rotationY: Math.PI / 2,
      centerX: bayX - 0.35,
      centerZ: -2.15,
      groundY: 0.18,
    });
    boardCorner.name = 'mintDisplayBoardCorner';
    display.add(boardCorner);
    fitMintModel(glassCorner, new THREE.Vector3(1.55, 0.76, 1.55), {
      rotationY: -Math.PI / 2,
      centerX: bayX - 0.35,
      centerZ: 2.15,
      groundY: 0.18,
    });
    glassCorner.name = 'mintDisplayGlassCorner';
    display.add(glassCorner);
    modules.add(display);

    fitMintModel(arenaProps, new THREE.Vector3(5.2, 2.8, 2.4), {
      centerZ: -this.level.halfDepth - 2.35,
      groundY: 0.3,
    });
    arenaProps.name = 'mintArenaProps';
    modules.add(arenaProps);
    this.group.add(modules);

    // The one-piece rounded shell is the only rink perimeter. Mint's four
    // board/glass GLBs remain loaded and named in this inactive service-bay
    // archive, preserving the generated asset integration without exposing
    // their incompatible modular proportions in gameplay composition.

    await Promise.all(
      this.obstaclePresentations.map(async ({ obstacle, root }) => {
        const key = this.mintObstacleKey(obstacle);
        const imported = await loadMintModel(key);
        if (this.disposed) return;
        const target = this.obstacleTargetSize(obstacle);
        fitMintModel(imported, target, { groundY: 0 });
        imported.name = `mintObstacle-${obstacle.id}`;
        const fallbackChildren = [...root.children];
        root.add(imported);
        for (const child of fallbackChildren) child.visible = false;
      }),
    );
  }

  private mintObstacleKey(obstacle: ObstacleDefinition): string {
    if (obstacle.kind === 'cone') return 'rink-cone';
    if (obstacle.kind === 'puck') return 'rink-puck';
    if (obstacle.kind === 'goal') return 'rink-goal';
    if (obstacle.kind === 'bench') return 'rink-bench';
    return 'rink-practice-equipment';
  }

  private obstacleTargetSize(obstacle: ObstacleDefinition): THREE.Vector3 {
    const width = obstacle.shape.type === 'box' ? obstacle.shape.halfWidth * 2 : obstacle.shape.radius * 2;
    const depth = obstacle.shape.type === 'box' ? obstacle.shape.halfDepth * 2 : obstacle.shape.radius * 2;
    const height =
      obstacle.kind === 'puck'
        ? 0.12
        : obstacle.kind === 'cone'
          ? 1
          : obstacle.kind === 'goal'
            ? 1.35
            : obstacle.kind === 'bench'
              ? 0.82
              : 1.08;
    return new THREE.Vector3(width, height, depth);
  }

  private addGoal(root: THREE.Group): void {
    const frame = this.materials.coral;
    const postGeometry = this.geometry(new THREE.CylinderGeometry(0.055, 0.055, 1.15, 10));
    for (const x of [-1.2, 1.2]) {
      const post = this.mesh(postGeometry, frame, false);
      post.position.set(x, 0.58, -0.4);
      root.add(post);
    }
    const cross = this.mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.42, 10), frame);
    cross.rotation.z = Math.PI / 2;
    cross.position.set(0, 1.13, -0.4);
    root.add(cross);
    const baseGeometry = this.geometry(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 9));
    for (const x of [-1.2, 1.2]) {
      const base = this.mesh(baseGeometry, frame, false);
      base.rotation.x = Math.PI / 2;
      base.position.set(x, 0.08, 0.2);
      root.add(base);
    }
    const netMaterial = this.specialMaterial(new THREE.MeshBasicMaterial({ color: '#dff8fb', wireframe: true, transparent: true, opacity: 0.34 }));
    const net = this.mesh(new THREE.BoxGeometry(2.35, 1.05, 1.15, 8, 5, 5), netMaterial);
    net.position.set(0, 0.58, 0.17);
    root.add(net);
  }

  private addBenchModel(root: THREE.Group, halfWidth: number): void {
    const seat = this.mesh(new RoundedBoxGeometry(halfWidth * 2, 0.18, 0.62, 4, 0.08), this.materials.paint);
    seat.position.y = 0.54;
    const back = this.mesh(new RoundedBoxGeometry(halfWidth * 2, 0.64, 0.16, 4, 0.06), this.materials.navy);
    back.position.set(0, 0.82, 0.24);
    root.add(seat, back);
    for (const x of [-halfWidth + 0.2, halfWidth - 0.2]) {
      const leg = this.mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14), this.materials.metal);
      leg.position.set(x, 0.26, 0);
      root.add(leg);
    }
  }

  private addExteriorBench(x: number, z: number, rotation: number): void {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = rotation;
    this.addBenchModel(root, 2.15);
    this.group.add(root);
  }

  private addEquipmentStack(root: THREE.Group): void {
    const crate = this.mesh(new RoundedBoxGeometry(1.45, 0.48, 0.72, 4, 0.1), this.materials.paint);
    crate.position.y = 0.28;
    root.add(crate);
    const stickGeometry = this.geometry(new THREE.CylinderGeometry(0.025, 0.025, 1.75, 8));
    for (let index = -2; index <= 2; index += 1) {
      const stick = this.mesh(stickGeometry, index % 2 ? this.materials.yellow : this.materials.coral, false);
      stick.position.set(index * 0.23, 0.9, 0);
      stick.rotation.z = -0.18 + index * 0.045;
      root.add(stick);
    }
    for (const x of [-0.48, 0.48]) {
      const puck = this.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 18), this.materials.puck);
      puck.position.set(x, 0.1, -0.48);
      root.add(puck);
    }
  }

  private createIceTexture(maxAnisotropy: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 420;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create ice texture.');
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#cdebf1');
    gradient.addColorStop(0.48, '#e7f8fa');
    gradient.addColorStop(1, '#bcdfe8');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    let seed = 0x1ce1ce;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 1200; index += 1) {
      const alpha = 0.015 + random() * 0.035;
      context.fillStyle = `rgba(255,255,255,${alpha})`;
      const radius = 1 + random() * 6;
      context.beginPath();
      context.arc(random() * canvas.width, random() * canvas.height, radius, 0, Math.PI * 2);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, maxAnisotropy);
    this.textures.add(texture);
    return texture;
  }

  private mesh<T extends THREE.BufferGeometry>(geometry: T, material: THREE.Material, ownGeometry = true): THREE.Mesh<T> {
    if (ownGeometry) this.geometries.add(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private specialMaterial<T extends THREE.Material>(material: T): T {
    this.specialMaterials.add(material);
    return material;
  }
}
