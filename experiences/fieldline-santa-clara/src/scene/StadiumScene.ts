import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { EventConfigId } from "../app/eventConfigs";
import type { RowPreviewInstance, SeatInstance } from "../stadium/generateSeatInstances";
import {
  BOARD_CLEARANCE_VOLUMES,
  aisleTopologySummary,
  isAngleInsideTierAisle,
  isPointInsideBoardClearance,
} from "../stadium/aisleTopology";
import type { ModeledGeometryManifest } from "../stadium/schema";
import type { SeatExplorerCatalog } from "../stadium/seatExplorerCatalog";
import { sunDirectionVector } from "../stadium/shadeEngine";
import { loadMintDressing, type MintAssetReport } from "./loadMintAssets";
import { MaterialLibrary } from "./MaterialLibrary";
import {
  createActiveAdaContext,
  createRepresentativeSeatContext,
  createSeatRigDebugContext,
  type SeatedContextKind,
} from "./SeatContext";
import {
  createBowlObjects,
  createEventObjectGroups,
  createStadiumCanopies,
  createVerifiedSectionObjects,
  type RowObjectRef,
} from "./StadiumObjects";
import {
  createMintAdaPlatforms,
  createMintCrowdInstances,
  createMintSeatInstances,
  type MintSeatLod,
} from "./mint/loadMintSeats";
import { SeatExplorerObjects } from "./SeatExplorerObjects";

export type PickedSelection = {
  anchorId?: string;
  sectionId: string;
  rowLabel?: string;
  seatNumber?: number;
  positionIndex?: number;
};

export class StadiumScene {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly bowlRoot = new THREE.Group();
  readonly sectionRoot = new THREE.Group();
  readonly eventRoot = new THREE.Group();
  readonly mintObjectRoot = new THREE.Group();
  readonly structureRoot = new THREE.Group();
  readonly occluderGroup = new THREE.Group();
  readonly validationRoot = new THREE.Group();
  readonly validationRayRoot = new THREE.Group();
  readonly heatmapRoot = new THREE.Group();
  readonly seatedContextRoot = new THREE.Group();
  readonly explorerSeatRoot = new THREE.Group();
  readonly materials = new MaterialLibrary();
  readonly assetReport: MintAssetReport = {
    loaded: [],
    failed: [],
    objectCount: 0,
    worldRuntimeUsed: false,
  };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly sun = new THREE.DirectionalLight(0xffe8c7, 3.2);
  private readonly hemisphere = new THREE.HemisphereLight(0xc9d7d2, 0x17120f, 1.05);
  private readonly fill = new THREE.DirectionalLight(0x9fb6bb, 0.58);
  private readonly nightPracticals = new THREE.Group();
  private readonly sectionObjects = new Map<string, THREE.Group>();
  private readonly rowObjects = new Map<string, RowObjectRef>();
  private readonly eventGroups = new Map<EventConfigId, THREE.Group>();
  private seatInstances: MintSeatLod | null = null;
  private explorerObjects: SeatExplorerObjects | null = null;
  private crowdInstances: THREE.InstancedMesh | null = null;
  private crowdPercentile = 50;
  private mobileQuality = false;
  private eventConfigId: EventConfigId = "football";
  private assetLoading: Promise<void> = Promise.resolve();
  private suiteTowerVisible = true;
  private validationVisible = false;
  private selectedRowKey: string | null = null;
  private selectedSeatKey: { sectionId: string; rowLabel: string | null; seatNumber: number } | null = null;
  private readonly representativeSeatContext: THREE.Group;
  private readonly activeAdaContext: THREE.Group;
  private readonly seatRigDebugContext: THREE.Group;
  private seatedContextAudit: {
    active: boolean;
    kind: SeatedContextKind | null;
    sectionId: string | null;
    rowLabel: string | null;
    seatNumber: number | null;
    exactSeatObjectPresent: boolean;
    representativeSeatObjectPresent: boolean;
    adaPlatformPresent: boolean;
    truthLabel: string;
    pass: boolean;
  } = {
    active: false,
    kind: null,
    sectionId: null,
    rowLabel: null,
    seatNumber: null,
    exactSeatObjectPresent: false,
    representativeSeatObjectPresent: false,
    adaPlatformPresent: false,
    truthLabel: "No seated context active.",
    pass: true,
  };
  private readonly lastSunDirection = new THREE.Vector3(-0.4, 0.8, 0.4).normalize();
  private pmrem: THREE.PMREMGenerator | null = null;
  private environmentTarget: THREE.WebGLRenderTarget | null = null;
  private boardClearanceAudit: {
    sampleCount: number;
    blockedRays: number;
    pass: boolean;
    hits: Array<{ boardId: string; objectName: string }>;
  } = { sampleCount: 0, blockedRays: 0, pass: false, hits: [] };
  private aisleGeometryAudit: {
    seatInstancesAudited: number;
    seatCorridorIntersections: number;
    boardClearanceSeatIntrusions: number;
    steppedAisleMeshes: number;
    obsoleteOverlayPresent: boolean;
    pass: boolean;
  } = {
    seatInstancesAudited: 0,
    seatCorridorIntersections: 0,
    boardClearanceSeatIntrusions: 0,
    steppedAisleMeshes: 0,
    obsoleteOverlayPresent: false,
    pass: false,
  };
  private scoreboardSeatClearanceAudit: {
    seatInstanceObjectsAudited: number;
    intrudingSeatInstanceObjects: number;
    byBoard: Record<"north" | "south", number>;
    hits: Array<{
      boardId: "north" | "south";
      objectName: string;
      instanceId: number;
    }>;
    pass: boolean;
  } = {
    seatInstanceObjectsAudited: 0,
    intrudingSeatInstanceObjects: 0,
    byBoard: { north: 0, south: 0 },
    hits: [],
    pass: false,
  };

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.representativeSeatContext = createRepresentativeSeatContext(this.materials);
    this.activeAdaContext = createActiveAdaContext(this.materials);
    this.seatRigDebugContext = createSeatRigDebugContext();
    this.seatedContextRoot.name = "active-seated-context-objects";
    this.seatedContextRoot.add(
      this.representativeSeatContext,
      this.activeAdaContext,
      this.seatRigDebugContext,
    );
    this.scene.background = new THREE.Color(0x9eafb8);
    this.scene.fog = new THREE.FogExp2(0x9eafb8, 0.00145);
    this.root.name = "fieldline-object-scene";
    this.root.add(
      this.bowlRoot,
      this.sectionRoot,
      this.eventRoot,
      this.mintObjectRoot,
      this.structureRoot,
      this.occluderGroup,
      this.validationRoot,
      this.heatmapRoot,
      this.explorerSeatRoot,
      this.seatedContextRoot,
    );
    this.scene.add(this.root);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 340;
    this.sun.shadow.camera.left = -145;
    this.sun.shadow.camera.right = 145;
    this.sun.shadow.camera.top = 145;
    this.sun.shadow.camera.bottom = -145;
    this.sun.shadow.bias = -0.00025;
    this.sun.position.set(-110, 180, 100);
    this.fill.position.set(95, 75, -80);
    this.scene.add(this.sun, this.sun.target, this.hemisphere, this.fill);

    this.buildNightPracticals();
    this.scene.add(this.nightPracticals);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  async build(
    geometry: ModeledGeometryManifest,
    seats: SeatInstance[],
    rowPreviews: RowPreviewInstance[],
    options: {
      crowdStride?: number;
      mobileQuality?: boolean;
      explorerCatalog?: SeatExplorerCatalog;
    } = {},
  ): Promise<void> {
    this.mobileQuality = options.mobileQuality ?? false;
    this.bowlRoot.clear();
    this.sectionRoot.clear();
    this.eventRoot.clear();
    this.mintObjectRoot.clear();
    this.structureRoot.clear();
    this.occluderGroup.clear();
    this.validationRoot.clear();
    this.heatmapRoot.clear();
    this.explorerObjects?.dispose();
    this.explorerObjects = null;
    this.explorerSeatRoot.clear();
    this.clearSeatedContext();

    this.sun.shadow.mapSize.set(options.mobileQuality ? 1024 : 2048, options.mobileQuality ? 1024 : 2048);
    this.sun.castShadow = !this.mobileQuality;
    this.renderer.shadowMap.enabled = !this.mobileQuality;
    this.bowlRoot.add(createBowlObjects(this.materials, options.mobileQuality
      ? { tierSegments: 18, seatPitchScale: 3 }
      : { tierSegments: 80, seatPitchScale: 1 }));
    this.aisleGeometryAudit = this.auditAisleGeometry();
    this.structureRoot.add(createStadiumCanopies(this.materials));
    const verified = createVerifiedSectionObjects(geometry, this.materials);
    this.sectionRoot.add(verified.root);
    verified.sectionObjects.forEach((value, key) => this.sectionObjects.set(key, value));
    verified.rowObjects.forEach((value, key) => this.rowObjects.set(key, value));

    if (options.explorerCatalog) {
      this.explorerObjects = new SeatExplorerObjects(options.explorerCatalog, {
        mobileQuality: this.mobileQuality,
      });
      this.explorerSeatRoot.add(this.explorerObjects.root);
      // The complete catalog owns visible seating density. Earlier procedural
      // seats remain loaded solely for the established geometry audit.
      this.bowlRoot.traverse((object) => {
        if (object.userData.kind === "seat-backs") object.visible = false;
      });
      this.sectionRoot.visible = false;
    } else {
      this.sectionRoot.visible = true;
    }

    const groups = createEventObjectGroups(this.materials);
    groups.forEach((group, key) => {
      this.eventGroups.set(key, group);
      this.eventRoot.add(group);
    });
    this.setEventConfig("football");

    this.addOriginalBoardScreens(geometry);
    this.addOccluderObjects(geometry);
    this.boardClearanceAudit = this.auditBoardClearanceRays(geometry);

    this.seatInstances = createMintSeatInstances(seats, this.mintObjectRoot, {
      highDetail: !options.mobileQuality,
    });
    this.scoreboardSeatClearanceAudit = this.auditScoreboardSeatClearance();
    // The full structure, ADA, and crowd packs are progressive enhancement. Search,
    // row cameras, analysis, and the low-detail bowl become interactive first.
    this.assetLoading = new Promise<void>((resolve) => {
      window.setTimeout(() => {
        void Promise.all([
          this.seatInstances?.ready,
          loadMintDressing(this.mintObjectRoot, geometry).then((loaded) => {
            Object.assign(this.assetReport, loaded);
          }),
          createMintAdaPlatforms(rowPreviews, this.mintObjectRoot),
          createMintCrowdInstances(
            seats,
            this.mintObjectRoot,
            options.crowdStride ?? 2,
          ).then((crowd) => {
            this.crowdInstances = crowd;
          }),
        ]).then(() => {
          if (!this.mobileQuality) {
            this.pmrem = new THREE.PMREMGenerator(this.renderer);
            this.environmentTarget = this.pmrem.fromScene(new RoomEnvironment(), 0.035);
            this.scene.environment = this.environmentTarget.texture;
          } else {
            this.scene.environment = null;
          }
          this.setEventConfig(this.eventConfigId);
          this.setSuiteTowerVisible(this.suiteTowerVisible);
          this.setCrowdPercentile(this.crowdPercentile);
          this.boardClearanceAudit = this.auditBoardClearanceRays(geometry);
          this.scoreboardSeatClearanceAudit = this.auditScoreboardSeatClearance();
          resolve();
        });
      }, 250);
    });
  }

  awaitAssets(): Promise<void> {
    return this.assetLoading;
  }

  private buildNightPracticals(): void {
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const light = new THREE.PointLight(0xf6e9ca, 0, 115, 2);
      light.position.set(Math.cos(angle) * 96, 41, Math.sin(angle) * 96);
      light.castShadow = false;
      this.nightPracticals.add(light);
    }
  }

  private addOriginalBoardScreens(geometry: ModeledGeometryManifest): void {
    for (const board of geometry.videoBoards) {
      const frame = new THREE.Group();
      frame.name = `modeled-${board.id}-video-board-object`;
      frame.userData = {
        kind: "video-board",
        boardClearanceExemption: "screen-and-housing",
        end: board.id,
        status: board.status,
        sourceIds: board.sourceIds,
      };
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(board.size[0] + 2.2, board.size[1] + 2.2, 1.25),
        this.materials.blackenedSteel,
      );
      housing.position.set(board.position[0], board.position[1], board.position[2]);
      housing.castShadow = true;
      housing.receiveShadow = true;
      frame.add(housing);

      const facing = board.id === "north" ? 1 : -1;
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(board.size[0], board.size[1]),
        this.materials.createBoardMaterial(`${board.id} board`),
      );
      screen.position.set(
        board.position[0],
        board.position[1],
        board.position[2] + facing * 0.64,
      );
      screen.rotation.y = board.id === "south" ? Math.PI : 0;
      frame.add(screen);

      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(board.size[0] + 6, 1.25, 1.5),
        this.materials.concreteLight,
      );
      beam.position.set(board.position[0], board.position[1] - board.size[1] / 2 - 1.7, board.position[2]);
      beam.castShadow = true;
      frame.add(beam);
      for (const xFactor of [-0.35, 0.35]) {
        const supportHeight = 16;
        const support = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, supportHeight, 1.2),
          this.materials.concreteLight,
        );
        support.position.set(
          board.position[0] + board.size[0] * xFactor,
          board.position[1] - board.size[1] / 2 - supportHeight / 2 - 2.2,
          board.position[2],
        );
        support.castShadow = true;
        frame.add(support);
      }
      this.structureRoot.add(frame);
    }
  }

  private addOccluderObjects(geometry: ModeledGeometryManifest): void {
    for (const record of geometry.occluders) {
      const [minX, minY, minZ] = record.bounds.min;
      const [maxX, maxY, maxZ] = record.bounds.max;
      const size = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshBasicMaterial({
          color: 0xe4a553,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          wireframe: true,
        }),
      );
      proxy.position.set(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        (minZ + maxZ) / 2,
      );
      proxy.name = `occluder-${record.id}`;
      proxy.userData = {
        kind: "occluder",
        category: record.category,
        id: record.id,
        status: record.status,
      };
      proxy.visible = false;
      this.occluderGroup.add(proxy);
    }
  }

  private auditBoardClearanceRays(geometry: ModeledGeometryManifest): {
    sampleCount: number;
    blockedRays: number;
    pass: boolean;
    hits: Array<{ boardId: string; objectName: string }>;
  } {
    this.root.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    const hits: Array<{ boardId: string; objectName: string }> = [];
    let sampleCount = 0;
    const isExempt = (target: THREE.Object3D): boolean => {
      let current: THREE.Object3D | null = target;
      while (current) {
        if (current.userData.boardClearanceExemption) return true;
        if (current.userData.kind === "video-board") return true;
        if (current === this.validationRoot || current === this.occluderGroup) return true;
        current = current.parent;
      }
      return false;
    };

    for (const board of geometry.videoBoards) {
      const directionZ = board.id === "north" ? -1 : 1;
      const startZ = board.position[2] + directionZ * 0.78;
      for (let yi = 0; yi < 5; yi += 1) {
        const y = board.position[1] + THREE.MathUtils.lerp(
          -board.size[1] * 0.42,
          board.size[1] * 0.42,
          yi / 4,
        );
        for (let xi = 0; xi < 9; xi += 1) {
          const x = board.position[0] + THREE.MathUtils.lerp(
            -board.size[0] * 0.44,
            board.size[0] * 0.44,
            xi / 8,
          );
          sampleCount += 1;
          raycaster.set(
            new THREE.Vector3(x, y, startZ),
            new THREE.Vector3(0, 0, directionZ),
          );
          raycaster.near = 0.05;
          raycaster.far = 38;
          const blocked = raycaster
            .intersectObjects([
              this.bowlRoot,
              this.sectionRoot,
              this.mintObjectRoot,
              this.structureRoot,
            ], true)
            .find((hit) => hit.object.visible && !isExempt(hit.object));
          if (blocked) {
            hits.push({
              boardId: board.id,
              objectName: blocked.object.name || blocked.object.type,
            });
          }
        }
      }
    }
    return {
      sampleCount,
      blockedRays: hits.length,
      pass: sampleCount > 0 && hits.length === 0,
      hits: hits.slice(0, 20),
    };
  }

  private auditAisleGeometry(): {
    seatInstancesAudited: number;
    seatCorridorIntersections: number;
    boardClearanceSeatIntrusions: number;
    steppedAisleMeshes: number;
    obsoleteOverlayPresent: boolean;
    pass: boolean;
  } {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    let seatInstancesAudited = 0;
    let seatCorridorIntersections = 0;
    let boardClearanceSeatIntrusions = 0;
    let steppedAisleMeshes = 0;
    this.bowlRoot.traverse((object) => {
      if (object.userData.kind === "aisles" &&
          object.userData.topology === "stepped-clearance-corridors-v1") {
        steppedAisleMeshes += 1;
      }
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || object.userData.kind !== "seat-backs") return;
      const tierId = String(object.userData.tier ?? "");
      for (let index = 0; index < mesh.count; index += 1) {
        mesh.getMatrixAt(index, matrix);
        position.setFromMatrixPosition(matrix);
        seatInstancesAudited += 1;
        if (isAngleInsideTierAisle(
          tierId,
          Math.atan2(position.z, position.x),
          Math.hypot(position.x, position.z),
          0.12,
        )) seatCorridorIntersections += 1;
        if (isPointInsideBoardClearance(position.x, position.y, position.z, 0.08)) {
          boardClearanceSeatIntrusions += 1;
        }
      }
    });
    const obsoleteOverlayPresent = Boolean(this.bowlRoot.getObjectByName("modeled-aisle-radials"));
    return {
      seatInstancesAudited,
      seatCorridorIntersections,
      boardClearanceSeatIntrusions,
      steppedAisleMeshes,
      obsoleteOverlayPresent,
      pass: seatInstancesAudited > 0 &&
        seatCorridorIntersections === 0 &&
        boardClearanceSeatIntrusions === 0 &&
        steppedAisleMeshes === 4 &&
        !obsoleteOverlayPresent,
    };
  }

  private auditScoreboardSeatClearance(): {
    seatInstanceObjectsAudited: number;
    intrudingSeatInstanceObjects: number;
    byBoard: Record<"north" | "south", number>;
    hits: Array<{
      boardId: "north" | "south";
      objectName: string;
      instanceId: number;
    }>;
    pass: boolean;
  } {
    this.root.updateMatrixWorld(true);
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const worldBounds = new THREE.Box3();
    const clearanceBoxes = BOARD_CLEARANCE_VOLUMES.map((volume) => ({
      volume,
      bounds: new THREE.Box3(
        new THREE.Vector3(...volume.min),
        new THREE.Vector3(...volume.max),
      ),
    }));
    let seatInstanceObjectsAudited = 0;
    let intrudingSeatInstanceObjects = 0;
    const byBoard: Record<"north" | "south", number> = { north: 0, south: 0 };
    const hits: Array<{
      boardId: "north" | "south";
      objectName: string;
      instanceId: number;
    }> = [];

    for (const root of [this.bowlRoot, this.mintObjectRoot, this.explorerSeatRoot]) {
      root.traverse((object) => {
        const mesh = object as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh ||
            (object.userData.kind !== "seat-backs" &&
             object.userData.kind !== "seat-instances" &&
             object.userData.kind !== "explorer-seat-instances")) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const localBounds = mesh.geometry.boundingBox;
        if (!localBounds) return;
        for (let instanceId = 0; instanceId < mesh.count; instanceId += 1) {
          mesh.getMatrixAt(instanceId, instanceMatrix);
          worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
          worldBounds.copy(localBounds).applyMatrix4(worldMatrix);
          seatInstanceObjectsAudited += 1;
          for (const { volume, bounds } of clearanceBoxes) {
            if (!worldBounds.intersectsBox(bounds)) continue;
            intrudingSeatInstanceObjects += 1;
            byBoard[volume.id] += 1;
            if (hits.length < 20) {
              hits.push({
                boardId: volume.id,
                objectName: mesh.name || "unnamed-seat-instanced-mesh",
                instanceId,
              });
            }
          }
        }
      });
    }
    return {
      seatInstanceObjectsAudited,
      intrudingSeatInstanceObjects,
      byBoard,
      hits,
      pass: seatInstanceObjectsAudited > 0 && intrudingSeatInstanceObjects === 0,
    };
  }

  setEventConfig(id: EventConfigId): void {
    this.eventConfigId = id;
    this.eventGroups.forEach((group, key) => {
      group.visible = key === id;
    });
    this.mintObjectRoot.traverse((object) => {
      if (object.userData.eventConfig === "football") object.visible = id === "football";
    });
  }

  setSelection(
    sectionId: string,
    rowLabel: string | null,
    seatNumber: number | null,
    positionIndex: number | null = seatNumber,
  ): void {
    this.explorerObjects?.setSelection(sectionId, rowLabel, positionIndex);
    if (this.selectedRowKey) {
      const previous = this.rowObjects.get(this.selectedRowKey);
      if (previous) {
        previous.mesh.setColorAt(previous.index, previous.baseColor);
        if (previous.mesh.instanceColor) previous.mesh.instanceColor.needsUpdate = true;
      }
    }

    this.sectionObjects.forEach((section, id) => {
      section.scale.setScalar(id === sectionId ? 1.004 : 1);
      section.traverse((object) => {
        const rows = object as THREE.InstancedMesh;
        if (!rows.isInstancedMesh || rows.userData.kind !== "row-instances") return;
        const base = new THREE.Color(Number(rows.userData.baseColor ?? 0x6d2532));
        const color = id === sectionId
          ? base.clone().lerp(new THREE.Color(0xbf5469), 0.58)
          : base;
        for (let index = 0; index < rows.count; index += 1) rows.setColorAt(index, color);
        if (rows.instanceColor) rows.instanceColor.needsUpdate = true;
      });
    });

    this.selectedRowKey = rowLabel ? `${sectionId}:${rowLabel}` : null;
    if (this.selectedRowKey) {
      const selected = this.rowObjects.get(this.selectedRowKey);
      if (selected) {
        selected.mesh.setColorAt(selected.index, new THREE.Color(0xb7e63b));
        if (selected.mesh.instanceColor) selected.mesh.instanceColor.needsUpdate = true;
      }
    }

    if (this.seatInstances) {
      const meshes = [this.seatInstances.detail, this.seatInstances.overview];
      if (this.selectedSeatKey) {
        for (const mesh of meshes) {
          const lookup = mesh.userData.seatLookup as Array<{
            sectionId: string;
            rowLabel: string;
            seatNumber: number;
          }>;
          const previous = lookup.findIndex(
            (seat) =>
              seat.sectionId === this.selectedSeatKey?.sectionId &&
              seat.rowLabel === this.selectedSeatKey?.rowLabel &&
              seat.seatNumber === this.selectedSeatKey?.seatNumber,
          );
          if (previous >= 0) mesh.setColorAt(previous, new THREE.Color(0x6d2532));
        }
      }
      this.seatInstances.setDetailedRow(sectionId, rowLabel, seatNumber);
      this.selectedSeatKey = null;
      if (seatNumber != null) {
        this.selectedSeatKey = { sectionId, rowLabel, seatNumber };
        for (const mesh of meshes) {
          const lookup = mesh.userData.seatLookup as Array<{
            sectionId: string;
            rowLabel: string;
            seatNumber: number;
          }>;
          const index = lookup.findIndex(
            (seat) =>
              seat.sectionId === sectionId &&
              seat.rowLabel === rowLabel &&
              seat.seatNumber === seatNumber,
          );
          if (index >= 0) mesh.setColorAt(index, new THREE.Color(0xb7e63b));
        }
      }
      for (const mesh of meshes) {
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  setSeatedContext(input: {
    kind: SeatedContextKind;
    sectionId: string;
    rowLabel: string;
    seatNumber: number | null;
    anchor: THREE.Vector3;
    yawRad: number;
  }): void {
    this.representativeSeatContext.visible = false;
    this.activeAdaContext.visible = false;
    this.seatRigDebugContext.visible = false;
    for (const object of [
      this.representativeSeatContext,
      this.activeAdaContext,
      this.seatRigDebugContext,
    ]) {
      object.position.copy(input.anchor);
      object.rotation.set(0, input.yawRad, 0);
    }

    const detailLookup = (this.seatInstances?.detail.userData.seatLookup ?? []) as Array<{
      sectionId: string;
      rowLabel: string;
      seatNumber: number;
    }>;
    const exactSeatObjectPresent = input.kind === "exact-seat" &&
      input.seatNumber != null &&
      detailLookup.some((seat) =>
        seat.sectionId === input.sectionId &&
        seat.rowLabel === input.rowLabel &&
        seat.seatNumber === input.seatNumber
      );
    if (input.kind === "representative-row-seat") {
      this.representativeSeatContext.visible = true;
    } else if (input.kind === "ada-row-center") {
      this.activeAdaContext.visible = true;
    }

    const representativeSeatObjectPresent = this.representativeSeatContext.visible;
    const adaPlatformPresent = this.activeAdaContext.visible;
    const pass = input.kind === "exact-seat"
      ? exactSeatObjectPresent
      : input.kind === "representative-row-seat"
        ? representativeSeatObjectPresent
        : adaPlatformPresent && !representativeSeatObjectPresent;
    this.seatedContextAudit = {
      active: true,
      kind: input.kind,
      sectionId: input.sectionId,
      rowLabel: input.rowLabel,
      seatNumber: input.seatNumber,
      exactSeatObjectPresent,
      representativeSeatObjectPresent,
      adaPlatformPresent,
      truthLabel: input.kind === "exact-seat"
        ? "Exact supplied identifier · modeled XYZ"
        : input.kind === "ada-row-center"
          ? "ADA row center · individual position unavailable"
          : "Source-pack row · representative modeled seat",
      pass,
    };
    this.seatRigDebugContext.visible = this.validationVisible;
  }

  clearSeatedContext(): void {
    this.representativeSeatContext.visible = false;
    this.activeAdaContext.visible = false;
    this.seatRigDebugContext.visible = false;
    this.seatedContextAudit = {
      active: false,
      kind: null,
      sectionId: null,
      rowLabel: null,
      seatNumber: null,
      exactSeatObjectPresent: false,
      representativeSeatObjectPresent: false,
      adaPlatformPresent: false,
      truthLabel: "No seated context active.",
      pass: true,
    };
  }

  setSeatRigDebugVisible(visible: boolean): void {
    this.seatRigDebugContext.visible = visible && this.seatedContextAudit.active;
  }

  setTierVisible(tier: string, visible: boolean): void {
    const apply = (object: THREE.Object3D) => {
      if (object.userData.tier === tier) object.visible = visible;
    };
    this.bowlRoot.traverse(apply);
    this.sectionRoot.traverse(apply);
    if (this.explorerObjects) {
      this.bowlRoot.traverse((object) => {
        if (object.userData.kind === "seat-backs") object.visible = false;
      });
    }
  }

  setSuiteTowerVisible(visible: boolean): void {
    this.suiteTowerVisible = visible;
    for (const root of [this.mintObjectRoot, this.structureRoot]) {
      root.traverse((object) => {
        if (object.name.includes("suite-tower")) object.visible = visible;
      });
    }
    this.occluderGroup.traverse((object) => {
      if (object.userData.category === "suite-tower") {
        object.visible = visible && this.validationVisible;
      }
    });
  }

  setCrowdPercentile(percentile: number): void {
    this.crowdPercentile = percentile;
    if (!this.crowdInstances) return;
    this.crowdInstances.visible = percentile >= 75;
    this.crowdInstances.scale.y = THREE.MathUtils.mapLinear(percentile, 50, 95, 0.9, 1.12);
  }

  setExhaustiveQaQuality(enabled: boolean): void {
    this.bowlRoot.traverse((object) => {
      if (object.userData.kind === "seat-backs") {
        object.visible = this.explorerObjects ? false : !enabled;
      }
    });
    if (this.crowdInstances) {
      this.crowdInstances.visible = enabled ? false : this.crowdPercentile >= 75;
    }
    this.sun.castShadow = !enabled && !this.mobileQuality;
    this.renderer.shadowMap.enabled = !enabled && !this.mobileQuality;
  }

  setValidationVisible(visible: boolean, geometry: ModeledGeometryManifest): void {
    this.validationVisible = visible;
    this.validationRoot.clear();
    this.validationRoot.visible = visible;
    for (const object of this.occluderGroup.children) {
      object.visible = visible &&
        (object.userData.category !== "suite-tower" || this.suiteTowerVisible);
    }
    if (!visible) return;

    this.validationRayRoot.name = "validation-sightline-rays";
    this.validationRoot.add(this.validationRayRoot);

    const clearanceMaterial = new THREE.MeshBasicMaterial({
      color: 0x2cd3c8,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      wireframe: true,
    });
    for (const volume of BOARD_CLEARANCE_VOLUMES) {
      const size = new THREE.Vector3(
        volume.max[0] - volume.min[0],
        volume.max[1] - volume.min[1],
        volume.max[2] - volume.min[2],
      );
      const box = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), clearanceMaterial);
      box.position.set(
        (volume.min[0] + volume.max[0]) / 2,
        (volume.min[1] + volume.max[1]) / 2,
        (volume.min[2] + volume.max[2]) / 2,
      );
      box.name = `validation-${volume.id}-board-clearance-volume`;
      box.userData = { kind: "board-clearance-debug", sourceIds: volume.sourceIds };
      this.validationRoot.add(box);
    }

    const polygonMaterial = new THREE.LineBasicMaterial({ color: 0xb7e63b });
    const cameraMaterial = new THREE.MeshBasicMaterial({ color: 0xe4a553 });
    const cameraGeometry = new THREE.SphereGeometry(0.17, 7, 5);
    for (const section of geometry.sections) {
      const points = section.polygon.map(([x, z]) => new THREE.Vector3(x, 0.24, z));
      points.push(points[0]!.clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), polygonMaterial);
      line.name = `validation-section-${section.sectionId}`;
      this.validationRoot.add(line);
      for (const row of section.rowCenterlines) {
        const point = new THREE.Mesh(cameraGeometry, cameraMaterial);
        point.position.set(row.origin[0], row.origin[1] + 1.2, row.origin[2]);
        point.userData = {
          kind: "camera-eye",
          sectionId: section.sectionId,
          rowLabel: row.rowLabel,
        };
        this.validationRoot.add(point);
      }
      const first = section.rowCenterlines[0];
      if (first) {
        const direction = new THREE.Vector3(Math.sin(first.yawRad), 0, Math.cos(first.yawRad));
        const arrow = new THREE.ArrowHelper(
          direction,
          new THREE.Vector3(...first.origin).add(new THREE.Vector3(0, 0.3, 0)),
          2.6,
          0xb7e63b,
          0.5,
          0.25,
        );
        arrow.name = `validation-seat-one-facing-${section.sectionId}`;
        this.validationRoot.add(arrow);
      }
    }
    const sunArrow = new THREE.ArrowHelper(
      this.lastSunDirection,
      new THREE.Vector3(0, 1, 0),
      28,
      0xe4a553,
      2.2,
      1.1,
    );
    sunArrow.name = "validation-sun-vector";
    this.validationRoot.add(sunArrow);
  }

  setSightlineRays(
    eye: THREE.Vector3,
    hits: Array<{ x: number; z: number; visible: boolean }>,
  ): void {
    this.validationRayRoot.clear();
    if (!this.validationVisible || hits.length === 0) return;
    const positions: number[] = [];
    const colors: number[] = [];
    const stride = Math.max(1, Math.floor(hits.length / 28));
    for (let index = 0; index < hits.length; index += stride) {
      const hit = hits[index]!;
      positions.push(eye.x, eye.y, eye.z, hit.x, 0.05, hit.z);
      const color = new THREE.Color(hit.visible ? 0xb7e63b : 0xe4a553);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    lineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }),
    );
    lines.name = "deterministic-field-sample-rays";
    this.validationRayRoot.add(lines);
  }

  setHeatmap(
    hits: Array<{ x: number; z: number; visible: boolean }>,
    visible: boolean,
  ): void {
    this.heatmapRoot.clear();
    if (!visible || hits.length === 0) return;
    const geometry = new THREE.CircleGeometry(0.62, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
      vertexColors: true,
    });
    const instances = new THREE.InstancedMesh(geometry, material, hits.length);
    const dummy = new THREE.Object3D();
    hits.forEach((hit, index) => {
      dummy.position.set(hit.x, 0.08, hit.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      instances.setMatrixAt(index, dummy.matrix);
      instances.setColorAt(index, new THREE.Color(hit.visible ? 0xb7e63b : 0x8f3040));
    });
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
    instances.name = "field-visibility-sample-objects";
    this.heatmapRoot.add(instances);
  }

  setSun(altitudeDeg: number, azimuthDeg: number, aboveHorizon: boolean): void {
    const night = !aboveHorizon;
    this.sun.intensity = night ? 0.06 : 3.2;
    this.fill.intensity = night ? 0.24 : 0.58;
    this.hemisphere.intensity = night ? 0.22 : 1.05;
    this.renderer.toneMappingExposure = night ? 0.82 : 1.08;
    this.scene.background = new THREE.Color(night ? 0x06090b : 0x9eafb8);
    this.scene.fog = new THREE.FogExp2(night ? 0x06090b : 0x9eafb8, night ? 0.0028 : 0.00145);
    this.nightPracticals.children.forEach((object) => {
      const light = object as THREE.PointLight;
      light.intensity = night ? 22 : 0;
    });
    const direction = sunDirectionVector(altitudeDeg, azimuthDeg);
    this.lastSunDirection.set(direction.x, direction.y, direction.z).normalize();
    const sunArrow = this.validationRoot.getObjectByName("validation-sun-vector") as
      | THREE.ArrowHelper
      | undefined;
    sunArrow?.setDirection(this.lastSunDirection);
    if (!night) {
      this.sun.position.set(
        direction.x * 220,
        Math.max(direction.y, 0.04) * 220,
        direction.z * 220,
      );
      this.sun.target.position.set(0, 0, 0);
      this.sun.target.updateMatrixWorld();
    }
  }

  pick(raycaster: THREE.Raycaster): PickedSelection | null {
    const targets: THREE.Object3D[] = [this.sectionRoot];
    if (this.explorerObjects) {
      targets.unshift(this.explorerObjects.pickMesh, ...this.explorerObjects.rowPickMeshes);
    }
    if (this.seatInstances) targets.unshift(this.seatInstances.detail, this.seatInstances.overview);
    const hits = raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      if (hit.object.userData.kind === "seat-instances" && hit.instanceId != null) {
        const lookup = hit.object.userData.seatLookup as Array<PickedSelection>;
        return lookup[hit.instanceId] ?? null;
      }
      if (hit.object.userData.kind === "explorer-seat-pick" && hit.instanceId != null) {
        const lookup = hit.object.userData.seatLookup as Array<PickedSelection>;
        return lookup[hit.instanceId] ?? null;
      }
      if (hit.object.userData.kind === "explorer-row-instances" && hit.instanceId != null) {
        const lookup = hit.object.userData.rowLookup as Array<PickedSelection>;
        return lookup[hit.instanceId] ?? null;
      }
      if (hit.object.userData.kind === "row-instances" && hit.instanceId != null) {
        const lookup = hit.object.userData.rowLookup as Array<PickedSelection>;
        return lookup[hit.instanceId] ?? null;
      }
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (object.userData.kind === "row") {
          return {
            sectionId: String(object.userData.sectionId),
            rowLabel: String(object.userData.rowLabel),
          };
        }
        object = object.parent;
      }
    }
    return null;
  }

  getDiagnostics(): Record<string, unknown> {
    let meshes = 0;
    let instancedMeshes = 0;
    let bvhGeometries = 0;
    let lodNodes = 0;
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if ((object as THREE.LOD).isLOD) lodNodes += 1;
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes += 1;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) instancedMeshes += 1;
      if (mesh.geometry.boundsTree) bvhGeometries += 1;
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      meshMaterials.forEach((material) => materials.add(material));
    });
    return {
      objectOnly: true,
      worldRuntimeUsed: false,
      meshes,
      instancedMeshes,
      bvhGeometries,
      lodNodes,
      materials: materials.size,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      dpr: this.renderer.getPixelRatio(),
      shadowMap: this.sun.shadow.mapSize.toArray(),
      aisleTopology: aisleTopologySummary(),
      aisleGeometry: this.aisleGeometryAudit,
      boardClearance: this.boardClearanceAudit,
      scoreboardSeatClearance: this.scoreboardSeatClearanceAudit,
      seatExplorer: this.explorerObjects?.diagnostics() ?? null,
      seatedContext: this.seatedContextAudit,
      assetReport: this.assetReport,
    };
  }

  dispose(): void {
    this.explorerObjects?.dispose();
    this.explorerObjects = null;
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
    this.environmentTarget?.dispose();
    this.pmrem?.dispose();
  }
}
