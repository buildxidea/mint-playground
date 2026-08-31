import { SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import {
  MINT_PRIMARY_SPLAT_LAYER,
  MintWorldLayer,
} from './MintWorldLayer';
import type {
  SplatNavigationSurface,
  SplatWorldConnector,
  SplatWorldNavigationMesh,
  SplatWorldPortal,
  SplatWorldRoom,
} from './SplatNavigationSurface';

const WALL_HEIGHT = 3.4;
const CONNECTOR_WALL_SEGMENT = 2.4;
const PORTAL_CORRIDOR_MIN_SPAN = 0.75;
const LONG_PORTAL_CORRIDOR_SPAN = 12;
const FOLDED_PORTAL_APPROACH_SPAN = 3.2;
const PORTAL_OWNER_SIDE_GRACE = 2.4;
const DOORWAY_PRESENTATION_FACING_COSINE = Math.cos(
  THREE.MathUtils.degToRad(65),
);
// Once the eye has passed into the jamb, the guide would span most of the
// screen and read like a loading gate. Keep it as an approach landmark only;
// the physical floor and destination splat carry the actual crossing.
const DOORWAY_PRESENTATION_MIN_CAMERA_DISTANCE = 1.8;
const ENABLE_SYNTHETIC_PORTAL_PRESENTATION = false;
// Procedural doorway tunnels painted as extra Spark owners. Off for cuts-as-
// doorways: room RAD cuts own the aperture; a local connector splat reads as
// fuzzy residue around the opening instead of a clean cut.
const ENABLE_SYNTHETIC_PORTAL_SPLAT_CONNECTOR = false;
// Spark splats need overlap at gameplay resolution. Use a modest 22 cm lattice
// with broader Gaussians: this closes renderer-clear pinholes without the sort
// cost of a very dense procedural capture on software/headless WebGL.
const CONNECTOR_SPLAT_SPACING = 0.22;
const CONNECTOR_SPLAT_HEIGHT = 3.5;
const CONNECTOR_OWNER_PREFIX = 'zombies-local-splat-connector:';

type DoorwayPresentationSide = {
  portalId: string;
  roomId: string;
  group: THREE.Group;
  center: THREE.Vector3;
  outward: THREE.Vector3;
  halfWidth: number;
  halfHeight: number;
};

type PortalCorridorPresentation = {
  portalId: string;
  group: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  halfWidth: number;
  persistWhileInside: boolean;
};

type ConnectorSurface = 'wall' | 'ceiling' | 'floor';

/** Small deterministic panel maps avoid adding another network-loaded asset. */
function createConnectorSurfaceTexture(
  surface: ConnectorSurface,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.CanvasTexture(canvas);
  const palette =
    surface === 'floor'
      ? { base: '#303a37', seam: '#151c1a', lift: '#69766f' }
      : surface === 'ceiling'
        ? { base: '#242c29', seam: '#111816', lift: '#53605a' }
        : { base: '#35413d', seam: '#17201d', lift: '#74817b' };
  context.fillStyle = palette.base;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = palette.seam;
  context.lineWidth = surface === 'floor' ? 5 : 7;
  context.strokeRect(3, 3, 250, 250);
  context.lineWidth = 3;
  if (surface === 'floor') {
    context.beginPath();
    context.moveTo(128, 4);
    context.lineTo(128, 252);
    context.moveTo(4, 128);
    context.lineTo(252, 128);
    context.stroke();
    context.fillStyle = 'rgba(185, 205, 196, 0.09)';
    context.fillRect(14, 22, 100, 8);
    context.fillRect(142, 150, 96, 6);
  } else {
    context.beginPath();
    context.moveTo(128, 5);
    context.lineTo(128, 251);
    context.stroke();
    context.fillStyle = palette.lift;
    for (const x of [14, 119, 137, 242]) {
      for (const y of [15, 241]) {
        context.beginPath();
        context.arc(x, y, 3, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function sampleNavigationFloorY(
  navigation: SplatWorldNavigationMesh,
  x: number,
  z: number,
): number | null {
  let bestY: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < navigation.indices.length; offset += 3) {
    const a = navigation.indices[offset]! * 3;
    const b = navigation.indices[offset + 1]! * 3;
    const c = navigation.indices[offset + 2]! * 3;
    const ax = navigation.vertices[a]!;
    const ay = navigation.vertices[a + 1]!;
    const az = navigation.vertices[a + 2]!;
    const bx = navigation.vertices[b]!;
    const by = navigation.vertices[b + 1]!;
    const bz = navigation.vertices[b + 2]!;
    const cx = navigation.vertices[c]!;
    const cy = navigation.vertices[c + 1]!;
    const cz = navigation.vertices[c + 2]!;
    const centroidX = (ax + bx + cx) / 3;
    const centroidZ = (az + bz + cz) / 3;
    const distance = Math.hypot(centroidX - x, centroidZ - z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    bestY = (ay + by + cy) / 3;
  }
  return bestY;
}

function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const a = polygon[current]!;
    const b = polygon[previous]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) /
          (b.y - a.y + Number.EPSILON) +
        a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  point: THREE.Vector2,
  start: THREE.Vector2,
  end: THREE.Vector2,
): number {
  const edge = end.clone().sub(start);
  const lengthSquared = edge.lengthSq();
  if (lengthSquared <= Number.EPSILON) return point.distanceTo(start);
  const t = THREE.MathUtils.clamp(
    point.clone().sub(start).dot(edge) / lengthSquared,
    0,
    1,
  );
  return point.distanceTo(start.clone().addScaledVector(edge, t));
}

function signedDistance(
  point: THREE.Vector2,
  polygon: THREE.Vector2[],
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(
      distance,
      distanceToSegment(
        point,
        polygon[index]!,
        polygon[(index + 1) % polygon.length]!,
      ),
    );
  }
  return pointInPolygon(point, polygon) ? distance : -distance;
}

/** Builds navigation/collision support plus non-colliding doorway wayfinding. */
export class SplatCampus {
  readonly root = new THREE.Group();
  readonly bounds = new THREE.Box3();
  connectorCount = 0;
  roomPadCount = 0;
  perimeterWallCount = 0;
  doorwayGuideCount = 0;
  private collisionPhysics: PhysicsWorld | null = null;
  private readonly colliders: Array<ReturnType<PhysicsWorld['addBox']>> = [];
  private readonly portalVisuals = new Map<string, THREE.Object3D[]>();
  private readonly doorwayPresentationSides: DoorwayPresentationSide[] = [];
  private readonly portalCorridorPresentations: PortalCorridorPresentation[] = [];
  private readonly portalConnectorOwners = new Map<string, string>();
  private readonly portalConnectorSplats: SplatMesh[] = [];
  private readonly unregisterPortalConnectorOwners: Array<() => void> = [];
  private readonly presentationCameraPosition = new THREE.Vector3();
  private readonly presentationCameraDirection = new THREE.Vector3();
  private readonly presentationToDoor = new THREE.Vector3();
  private readonly presentationCorner = new THREE.Vector3();
  private readonly presentationRight = new THREE.Vector3();
  private readonly presentationOffset = new THREE.Vector3();
  private readonly presentationNearest = new THREE.Vector3();

  constructor() {
    this.root.name = 'splat-campus-user-cut-navigation';
    this.root.visible = false;
  }

  buildFromSurface(
    surface: SplatNavigationSurface,
    physics: PhysicsWorld,
    scene: THREE.Scene,
  ): void {
    this.clear(scene);
    this.collisionPhysics = physics;
    this.bounds.makeEmpty();
    for (const connector of surface.connectors) {
      this.addConnectorFloor(connector, physics);
      this.addConnectorPresentation(connector, surface.connectors);
      this.bounds.union(connector.bounds);
    }
    for (const room of surface.rooms) {
      if (room.navigation) {
        this.addNavigationFloor(
          room.navigation,
          physics,
          room.source.id,
          surface.portals.filter(
            (portal) =>
              portal.source.fromRoomId === room.source.id ||
              portal.source.toRoomId === room.source.id,
          ),
        );
        this.addCatchSlab(room, physics);
      } else {
        // Legacy fallback for a missing/stale bake. A release-ready campus
        // never reaches this path.
        this.addCoverageFloor(room.polygon, room.floorY, physics, room.source.id);
        this.addCoveragePerimeter(
          room,
          physics,
          surface.connectors,
        );
        this.addCatchSlab(room, physics);
      }
      this.bounds.union(room.bounds);
    }
    for (const portal of surface.portals) {
      this.addPortalFloor(portal, physics, surface);
      this.addPortalLandingRamp(portal, physics, surface);
      // Never cover a gap between Gaussian captures with an opaque Three.js
      // tunnel. Besides reading as a grey loading box, those walls can cross
      // the player's forward sightline on folded approaches. Portal floors and
      // landing ramps remain invisible collision support; visible coverage must
      // come from the source/destination RADs through authored cut volumes.
      if (ENABLE_SYNTHETIC_PORTAL_SPLAT_CONNECTOR) {
        this.addPortalSplatConnector(portal, surface);
      }
      if (ENABLE_SYNTHETIC_PORTAL_PRESENTATION) {
        this.addPortalCorridorPresentation(portal, surface);
      }
      this.addDoorwayPresentation(portal, surface);
    }
    this.connectorCount = surface.portals.length;
    scene.add(this.root);
    this.root.visible =
      surface.validation.releaseReady && surface.portals.length > 0;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible && this.connectorCount > 0;
  }

  /**
   * Portal presentation is intentionally more restrictive than data prefetch.
   * A warm neighboring RAD must never make its door frame, gap-repair floor,
   * or connector visible through an unrelated wall. Only the active owner-side
   * aperture is allowed to present; once the player is physically inside a
   * long connector, that connector remains visible regardless of look angle.
   */
  updatePortalPresentation(
    ownerRoomId: string | null,
    camera: THREE.PerspectiveCamera,
    playerPosition: THREE.Vector3,
    activePortalId: string | null,
  ): void {
    const visiblePortalIds = new Set<string>();
    camera.getWorldPosition(this.presentationCameraPosition);
    camera.getWorldDirection(this.presentationCameraDirection);

    for (const side of this.doorwayPresentationSides) {
      let visible = false;
      if (
        this.root.visible &&
        activePortalId === side.portalId &&
        ownerRoomId === side.roomId
      ) {
        this.presentationToDoor
          .copy(side.center)
          .sub(this.presentationCameraPosition);
        const distance = this.presentationToDoor.length();
        // Use ground-plane distance for the close-range fade. The previous
        // 3D distance included the eye-to-lintel height delta, which kept a
        // full doorway frame visible even while the player was standing in
        // its jamb and made an otherwise continuous crossing read as a gate.
        const planarDistance = Math.hypot(
          this.presentationToDoor.x,
          this.presentationToDoor.z,
        );
        const cameraOnInteriorSide =
          this.presentationOffset
            .copy(this.presentationCameraPosition)
            .sub(side.center)
            .dot(side.outward) <= PORTAL_OWNER_SIDE_GRACE;
        const facing =
          distance > 0.001 &&
          this.presentationCameraDirection.dot(
            this.presentationToDoor.multiplyScalar(1 / distance),
          ) >= DOORWAY_PRESENTATION_FACING_COSINE;
        this.presentationRight.set(
          side.outward.z,
          0,
          -side.outward.x,
        );
        let minimumX = Number.POSITIVE_INFINITY;
        let maximumX = Number.NEGATIVE_INFINITY;
        let minimumY = Number.POSITIVE_INFINITY;
        let maximumY = Number.NEGATIVE_INFINITY;
        let hasVisibleDepth = false;
        for (const horizontal of [-1, 1]) {
          for (const vertical of [-1, 1]) {
            this.presentationCorner
              .copy(side.center)
              .addScaledVector(
                this.presentationRight,
                horizontal * side.halfWidth,
              )
              .setY(side.center.y + vertical * side.halfHeight)
              .project(camera);
            minimumX = Math.min(minimumX, this.presentationCorner.x);
            maximumX = Math.max(maximumX, this.presentationCorner.x);
            minimumY = Math.min(minimumY, this.presentationCorner.y);
            maximumY = Math.max(maximumY, this.presentationCorner.y);
            hasVisibleDepth ||=
              this.presentationCorner.z >= -1 &&
              this.presentationCorner.z <= 1;
          }
        }
        const onScreen =
          hasVisibleDepth &&
          maximumX >= -1.08 &&
          minimumX <= 1.08 &&
          maximumY >= -1.08 &&
          minimumY <= 1.08;
        visible =
          planarDistance >= DOORWAY_PRESENTATION_MIN_CAMERA_DISTANCE &&
          cameraOnInteriorSide &&
          facing &&
          onScreen;
      }
      side.group.visible = visible;
      if (visible) visiblePortalIds.add(side.portalId);
    }

    for (const corridor of this.portalCorridorPresentations) {
      const edge = this.presentationToDoor.copy(corridor.to).sub(corridor.from);
      const lengthSquared = edge.lengthSq();
      const t =
        lengthSquared <= Number.EPSILON
          ? 0
          : THREE.MathUtils.clamp(
              this.presentationOffset
                .copy(playerPosition)
                .sub(corridor.from)
                .dot(edge) /
                lengthSquared,
              0,
              1,
            );
      const nearest = this.presentationNearest
        .copy(corridor.from)
        .addScaledVector(edge, t);
      const insideCorridor =
        t > 0.001 &&
        t < 0.999 &&
        Math.hypot(
          playerPosition.x - nearest.x,
          playerPosition.z - nearest.z,
        ) <= corridor.halfWidth + 0.65;
      if (corridor.persistWhileInside && insideCorridor) {
        visiblePortalIds.add(corridor.portalId);
      }
    }

    for (const [portalId, objects] of this.portalVisuals) {
      const visible = this.root.visible && visiblePortalIds.has(portalId);
      for (const object of objects) object.visible = visible;
    }
  }

  portalPresentationDiagnostics(): {
    visiblePortalIds: string[];
    visibleDoorwaySideIds: string[];
  } {
    return {
      visiblePortalIds: [...this.portalVisuals]
        .filter(([, objects]) => objects.some((object) => object.visible))
        .map(([portalId]) => portalId),
      visibleDoorwaySideIds: this.doorwayPresentationSides
        .filter((side) => side.group.visible)
        .map((side) => `${side.portalId}:${side.roomId}`),
    };
  }

  get visibleMeshCount(): number {
    let count = 0;
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.visible) count += 1;
    });
    return count;
  }

  dispose(scene: THREE.Scene): void {
    this.clear(scene);
  }

  private clear(scene: THREE.Scene): void {
    scene.remove(this.root);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      objectMaterials.forEach((material) => {
        materials.add(material);
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) textures.add(map);
      });
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    this.root.clear();
    if (this.collisionPhysics && this.colliders.length > 0) {
      this.collisionPhysics.removeColliders(this.colliders);
    }
    this.colliders.length = 0;
    this.collisionPhysics = null;
    this.bounds.makeEmpty();
    this.connectorCount = 0;
    this.roomPadCount = 0;
    this.perimeterWallCount = 0;
    this.doorwayGuideCount = 0;
    this.portalVisuals.clear();
    this.doorwayPresentationSides.length = 0;
    this.portalCorridorPresentations.length = 0;
    for (const unregister of this.unregisterPortalConnectorOwners) unregister();
    this.unregisterPortalConnectorOwners.length = 0;
    for (const splat of this.portalConnectorSplats) splat.dispose();
    this.portalConnectorSplats.length = 0;
    this.portalConnectorOwners.clear();
  }

  connectorSplatOwnerId(portalId: string): string | null {
    return this.portalConnectorOwners.get(portalId) ?? null;
  }

  private registerPortalVisual(
    portalId: string,
    object: THREE.Object3D,
  ): void {
    const objects = this.portalVisuals.get(portalId) ?? [];
    objects.push(object);
    this.portalVisuals.set(portalId, objects);
    object.visible = false;
  }

  private addCoverageFloor(
    polygon: THREE.Vector2[],
    floorY: number,
    physics: PhysicsWorld,
    roomId: string,
  ): void {
    if (polygon.length < 3) return;
    const vertices = new Float32Array(polygon.length * 3);
    for (let index = 0; index < polygon.length; index += 1) {
      const point = polygon[index]!;
      const offset = index * 3;
      vertices[offset] = point.x;
      vertices[offset + 1] = floorY;
      vertices[offset + 2] = point.y;
    }
    const indices = new Uint32Array((polygon.length - 2) * 3);
    for (let index = 0; index < polygon.length - 2; index += 1) {
      const offset = index * 3;
      // Winding is intentionally duplicated by Rapier's two-sided trimesh
      // queries, so player grounding is stable from above.
      indices[offset] = 0;
      indices[offset + 1] = index + 2;
      indices[offset + 2] = index + 1;
    }
    this.colliders.push(
      physics.addStaticTrimesh(
        vertices,
        indices,
        `zombies-splat-coverage-floor:${roomId}`,
      ),
    );
    this.roomPadCount += 1;
  }

  private addNavigationFloor(
    navigation: SplatWorldNavigationMesh,
    physics: PhysicsWorld,
    roomId: string,
    _portals: readonly SplatWorldPortal[],
  ): void {
    if (navigation.indices.length < 3 || navigation.vertices.length < 9) return;
    // Keep every baked triangle, including doorway spans. Portal pads used to
    // punch these out and left fall-through gaps when the pad mesh was thin.
    this.colliders.push(
      physics.addStaticTrimesh(
        new Float32Array(navigation.vertices),
        new Uint32Array(navigation.indices),
        `zombies-splat-navigation-floor:${roomId}`,
      ),
    );
    this.roomPadCount += 1;
  }

  /**
   * Last-resort physics under each room AABB. Walk authority stays on the
   * navmesh; this only catches bodies that slip through triangle holes.
   */
  private addCatchSlab(room: SplatWorldRoom, physics: PhysicsWorld): void {
    const bounds = room.bounds;
    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x)) return;
    const width = Math.max(0.5, bounds.max.x - bounds.min.x);
    const depth = Math.max(0.5, bounds.max.z - bounds.min.z);
    const halfThickness = 0.08;
    const center = new THREE.Vector3(
      (bounds.min.x + bounds.max.x) * 0.5,
      room.floorY - halfThickness - 0.04,
      (bounds.min.z + bounds.max.z) * 0.5,
    );
    this.colliders.push(
      physics.addBox(
        center,
        new THREE.Vector3(width * 0.5 + 0.35, halfThickness, depth * 0.5 + 0.35),
        0,
        false,
        `zombies-splat-catch-slab:${room.source.id}`,
      ),
    );
  }

  private addCoveragePerimeter(
    room: SplatWorldRoom,
    physics: PhysicsWorld,
    connectors: readonly SplatWorldConnector[],
  ): void {
    const polygon = room.polygon;
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]!;
      const end = polygon[(index + 1) % polygon.length]!;
      const dx = end.x - start.x;
      const dz = end.y - start.y;
      const length = Math.hypot(dx, dz);
      if (length < 0.3) continue;
      if (this.edgeCrossesDoorway(start, end, room, connectors)) continue;
      const inwardX = -dz / length;
      const inwardZ = dx / length;
      const center = new THREE.Vector3(
        (start.x + end.x) * 0.5 + inwardX * room.source.safeInset,
        room.floorY + WALL_HEIGHT * 0.5,
        (start.y + end.y) * 0.5 + inwardZ * room.source.safeInset,
      );
      const rotationY = -Math.atan2(dz, dx);
      this.colliders.push(
        physics.addBox(
          center,
          new THREE.Vector3(length * 0.5, WALL_HEIGHT * 0.5, 0.175),
          rotationY,
          false,
          `zombies-splat-coverage-boundary:${room.source.id}`,
        ),
      );
      this.perimeterWallCount += 1;
    }
  }

  private addConnectorFloor(
    connector: SplatWorldConnector,
    physics: PhysicsWorld,
  ): void {
    const triangles = THREE.ShapeUtils.triangulateShape(
      connector.polygon,
      [],
    );
    if (triangles.length === 0) return;
    const vertices = new Float32Array(connector.polygon.length * 3);
    for (let index = 0; index < connector.polygon.length; index += 1) {
      const point = connector.polygon[index]!;
      const offset = index * 3;
      vertices[offset] = point.x;
      vertices[offset + 1] = connector.floorY;
      vertices[offset + 2] = point.y;
    }
    const indices = new Uint32Array(triangles.length * 3);
    triangles.forEach((triangle, index) => {
      indices[index * 3] = triangle[0]!;
      indices[index * 3 + 1] = triangle[2]!;
      indices[index * 3 + 2] = triangle[1]!;
    });
    this.colliders.push(
      physics.addStaticTrimesh(
        vertices,
        indices,
        `zombies-concourse-floor:${connector.source.id}`,
      ),
    );
    this.roomPadCount += 1;
  }

  private addPortalFloor(
    portal: SplatWorldPortal,
    physics: PhysicsWorld,
    surface: SplatNavigationSurface,
  ): void {
    const polygon = portal.traversalPolygon;
    if (polygon.length < 3) return;
    const triangles = THREE.ShapeUtils.triangulateShape(polygon, []);
    if (triangles.length === 0) return;
    const fromRoom = surface.room(portal.source.fromRoomId);
    const toRoom = surface.room(portal.source.toRoomId);
    const fromFloorFallback = portal.from.y - 0.98;
    const toFloorFallback = portal.to.y - 0.98;
    const vertices = new Float32Array(polygon.length * 3);
    for (let index = 0; index < polygon.length; index += 1) {
      const point = polygon[index]!;
      const offset = index * 3;
      // Never raise a portal pad above either room's local nav. Nearer-room
      // sampling still left north↔far-north with a ~0.7m curb (above autostep).
      const fromSample = fromRoom?.navigation
        ? sampleNavigationFloorY(fromRoom.navigation, point.x, point.y)
        : null;
      const toSample = toRoom?.navigation
        ? sampleNavigationFloorY(toRoom.navigation, point.x, point.y)
        : null;
      const fromDistance = Math.hypot(
        point.x - portal.from.x,
        point.y - portal.from.z,
      );
      const toDistance = Math.hypot(
        point.x - portal.to.x,
        point.y - portal.to.z,
      );
      const preferFrom = fromDistance <= toDistance;
      const samples = [fromSample, toSample].filter(
        (value): value is number => typeof value === 'number',
      );
      const fallback = preferFrom ? fromFloorFallback : toFloorFallback;
      const floorY =
        (samples.length > 0 ? Math.min(...samples) : fallback) - 0.02;
      vertices[offset] = point.x;
      vertices[offset + 1] = floorY;
      vertices[offset + 2] = point.y;
    }
    const indices = new Uint32Array(triangles.length * 3);
    triangles.forEach((triangle, index) => {
      indices[index * 3] = triangle[0]!;
      indices[index * 3 + 1] = triangle[2]!;
      indices[index * 3 + 2] = triangle[1]!;
    });
    this.colliders.push(
      physics.addStaticTrimesh(
        vertices,
        indices,
        `zombies-splat-portal-floor:${portal.source.id}`,
      ),
    );
    const visualGeometry = new THREE.BufferGeometry();
    visualGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(vertices, 3),
    );
    visualGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    visualGeometry.computeVertexNormals();
    const visualFloor = new THREE.Mesh(
      visualGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x343837,
        emissive: 0x111716,
        emissiveIntensity: 0.32,
        roughness: 0.78,
        metalness: 0.14,
        side: THREE.DoubleSide,
      }),
    );
    visualFloor.name = `zombies-splat-portal-floor-visual:${portal.source.id}`;
    visualFloor.receiveShadow = true;
    this.root.add(visualFloor);
    this.registerPortalVisual(portal.source.id, visualFloor);
    // Backup AABB pad so complex traversal polygons never leave a seam hole.
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (let index = 0; index < polygon.length; index += 1) {
      const point = polygon[index]!;
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.y);
      maxZ = Math.max(maxZ, point.y);
      minY = Math.min(minY, vertices[index * 3 + 1]!);
    }
    if (
      Number.isFinite(minX) &&
      Number.isFinite(maxX) &&
      Number.isFinite(minZ) &&
      Number.isFinite(maxZ) &&
      Number.isFinite(minY)
    ) {
      const halfThickness = 0.06;
      this.colliders.push(
        physics.addBox(
          new THREE.Vector3(
            (minX + maxX) * 0.5,
            minY - halfThickness,
            (minZ + maxZ) * 0.5,
          ),
          new THREE.Vector3(
            Math.max(0.4, (maxX - minX) * 0.5 + 0.2),
            halfThickness,
            Math.max(0.4, (maxZ - minZ) * 0.5 + 0.2),
          ),
          0,
          false,
          `zombies-splat-portal-catch:${portal.source.id}`,
        ),
      );
    }
  }

  private addPortalLandingRamp(
    portal: SplatWorldPortal,
    physics: PhysicsWorld,
    surface: SplatNavigationSurface,
  ): void {
    const radius = surface.layout.largestActorCapsuleRadius;
    const from = surface.portalLandingPoint(
      portal.source.id,
      portal.source.fromRoomId,
      radius,
    )?.clone();
    const to = surface.portalLandingPoint(
      portal.source.id,
      portal.source.toRoomId,
      radius,
    )?.clone();
    const fromRoom = surface.room(portal.source.fromRoomId);
    const toRoom = surface.room(portal.source.toRoomId);
    if (!from || !to || !fromRoom?.navigation || !toRoom?.navigation) return;
    const fromY = sampleNavigationFloorY(
      fromRoom.navigation,
      from.x,
      from.z,
    );
    const toY = sampleNavigationFloorY(toRoom.navigation, to.x, to.z);
    if (fromY === null || toY === null) return;
    const halfWidth = portal.source.width * 0.5 + 0.12;
    const floorInset = 0.025;
    const addSupportSegment = (
      start: THREE.Vector3,
      end: THREE.Vector3,
      startY: number,
      endY: number,
      suffix: string,
    ) => {
      const direction = new THREE.Vector2(end.x - start.x, end.z - start.z);
      if (direction.lengthSq() <= Number.EPSILON) return;
      direction.normalize();
      const lateral = new THREE.Vector2(-direction.y, direction.x);
      const startLeft = new THREE.Vector2(start.x, start.z).addScaledVector(
        lateral,
        halfWidth,
      );
      const startRight = new THREE.Vector2(start.x, start.z).addScaledVector(
        lateral,
        -halfWidth,
      );
      const endLeft = new THREE.Vector2(end.x, end.z).addScaledVector(
        lateral,
        halfWidth,
      );
      const endRight = new THREE.Vector2(end.x, end.z).addScaledVector(
        lateral,
        -halfWidth,
      );
      const vertices = new Float32Array([
        startLeft.x,
        startY - floorInset,
        startLeft.y,
        startRight.x,
        startY - floorInset,
        startRight.y,
        endLeft.x,
        endY - floorInset,
        endLeft.y,
        endRight.x,
        endY - floorInset,
        endRight.y,
      ]);
      this.colliders.push(
        physics.addStaticTrimesh(
          vertices,
          new Uint32Array([0, 2, 1, 1, 2, 3]),
          `zombies-splat-portal-ramp:${portal.source.id}:${suffix}`,
        ),
      );
    };
    addSupportSegment(from, to, fromY, toY, 'seam');
  }

  /**
   * Fill scan-to-scan spans with Gaussian surfaces instead of opaque meshes.
   * These connectors are deterministic, local, and immediately resident. They
   * are selected through MintWorldLayer's owner-range shader only for their
   * active/facing portal, so they cannot bleed through unrelated room walls.
   * Invisible portal floors remain the movement authority.
   */
  private addPortalSplatConnector(
    portal: SplatWorldPortal,
    surface: SplatNavigationSurface,
  ): void {
    const radius = surface.layout.largestActorCapsuleRadius;
    const fromLanding = surface.portalLandingPoint(
      portal.source.id,
      portal.source.fromRoomId,
      radius,
    );
    const toLanding = surface.portalLandingPoint(
      portal.source.id,
      portal.source.toRoomId,
      radius,
    );
    const fromRoom = surface.room(portal.source.fromRoomId);
    const toRoom = surface.room(portal.source.toRoomId);
    if (
      !fromLanding ||
      !toLanding ||
      !fromRoom?.navigation ||
      !toRoom?.navigation
    ) {
      return;
    }

    const fromApproach =
      surface.portalApproachPoint(
        portal.source.id,
        portal.source.fromRoomId,
        2.2,
      ) ?? fromLanding;
    const toApproach =
      surface.portalApproachPoint(
        portal.source.id,
        portal.source.toRoomId,
        2.2,
      ) ?? toLanding;
    const points = [
      {
        position: fromApproach,
        floorY:
          sampleNavigationFloorY(
            fromRoom.navigation,
            fromApproach.x,
            fromApproach.z,
          ) ?? fromRoom.floorY,
      },
      {
        position: fromLanding,
        floorY:
          sampleNavigationFloorY(
            fromRoom.navigation,
            fromLanding.x,
            fromLanding.z,
          ) ?? fromRoom.floorY,
      },
      {
        position: toLanding,
        floorY:
          sampleNavigationFloorY(
            toRoom.navigation,
            toLanding.x,
            toLanding.z,
          ) ?? toRoom.floorY,
      },
      {
        position: toApproach,
        floorY:
          sampleNavigationFloorY(
            toRoom.navigation,
            toApproach.x,
            toApproach.z,
          ) ?? toRoom.floorY,
      },
    ].filter(
      (entry, index, entries) =>
        index === 0 ||
        entry.position.distanceTo(entries[index - 1]!.position) >= 0.2,
    );
    if (points.length < 2) return;

    const ownerId = `${CONNECTOR_OWNER_PREFIX}${portal.source.id}`;
    // Give the visual passage a little shoulder beyond the 5 m traversal
    // contract. This keeps the enlarged doorway readable at oblique angles
    // while the slightly narrower cut below remains fully covered by splats.
    const halfWidth = Math.max(2.8, portal.source.width) * 0.5 + 0.35;
    let deterministicIndex = 0;
    const color = new THREE.Color();
    const identity = new THREE.Quaternion();
    const wallQuaternion = new THREE.Quaternion();
    const pipeQuaternion = new THREE.Quaternion();
    // Spark converts these sRGB values to linear output. The former dark teal
    // palette landed numerically on the renderer clear colour after that
    // conversion, so a fully rendered tunnel still measured and read as a
    // black hole. Keep every structural tone safely above the clear band.
    const baseFloor = new THREE.Color(0x71847c);
    const baseWall = new THREE.Color(0x647c74);
    const baseCeiling = new THREE.Color(0x586a63);
    const rust = new THREE.Color(0x9b6b52);
    const hazard = new THREE.Color(0xf0b75f);
    const pipe = new THREE.Color(0xb47b5c);
    const light = new THREE.Color(0xffc06b);
    const dark = new THREE.Color(0x4d625b);
    const noise = (index: number): number => {
      const value = Math.sin(index * 12.9898 + portal.source.id.length * 78.233);
      return value - Math.floor(value);
    };
    const variedColor = (
      base: THREE.Color,
      amount = 0.08,
    ): THREE.Color => {
      const variation = (noise(deterministicIndex) - 0.5) * amount;
      return color.copy(base).offsetHSL(variation * 0.12, variation, variation);
    };

    const splat = new SplatMesh({
      raycastable: false,
      constructSplats: (packed) => {
        const add = (
          center: THREE.Vector3,
          scales: THREE.Vector3,
          quaternion: THREE.Quaternion,
          base: THREE.Color,
          opacity = 0.94,
          variation = 0.08,
        ) => {
          deterministicIndex += 1;
          const jitter = (noise(deterministicIndex + 31) - 0.5) * 0.035;
          center.y += jitter;
          packed.pushSplat(
            center,
            scales,
            quaternion,
            opacity,
            variedColor(base, variation),
          );
        };

        for (let legIndex = 0; legIndex < points.length - 1; legIndex += 1) {
          const start = points[legIndex]!;
          const end = points[legIndex + 1]!;
          const dx = end.position.x - start.position.x;
          const dz = end.position.z - start.position.z;
          const span = Math.hypot(dx, dz);
          if (span < 0.15) continue;
          const tangent = new THREE.Vector2(dx / span, dz / span);
          const lateral = new THREE.Vector2(-tangent.y, tangent.x);
          wallQuaternion.setFromEuler(
            new THREE.Euler(0, Math.atan2(lateral.x, lateral.y), 0),
          );
          pipeQuaternion.setFromEuler(
            new THREE.Euler(0, -Math.atan2(tangent.y, tangent.x), 0),
          );
          const longitudinalSteps = Math.max(
            1,
            Math.ceil(span / CONNECTOR_SPLAT_SPACING),
          );
          const floorAcross = Math.max(
            3,
            Math.ceil((halfWidth * 2) / CONNECTOR_SPLAT_SPACING),
          );
          const ceilingAcross = Math.max(3, Math.ceil(floorAcross * 0.65));
          const wallVertical = Math.max(
            4,
            Math.ceil(CONNECTOR_SPLAT_HEIGHT / CONNECTOR_SPLAT_SPACING),
          );
          for (let step = legIndex === 0 ? 0 : 1; step <= longitudinalSteps; step += 1) {
            const t = step / longitudinalSteps;
            const centerX = THREE.MathUtils.lerp(start.position.x, end.position.x, t);
            const centerZ = THREE.MathUtils.lerp(start.position.z, end.position.z, t);
            const floorY = THREE.MathUtils.lerp(start.floorY, end.floorY, t);

            for (let across = 0; across <= floorAcross; across += 1) {
              const lateralOffset = THREE.MathUtils.lerp(
                -halfWidth,
                halfWidth,
                across / floorAcross,
              );
              const edge = Math.abs(lateralOffset) > halfWidth - 0.3;
              const stripe = Math.floor(step / 2) % 2 === 0;
              add(
                new THREE.Vector3(
                  centerX + lateral.x * lateralOffset,
                  floorY + 0.035,
                  centerZ + lateral.y * lateralOffset,
                ),
                new THREE.Vector3(0.28, 0.075, 0.28),
                identity,
                edge && stripe ? hazard : edge ? dark : baseFloor,
                0.96,
                edge ? 0.035 : 0.09,
              );
            }

            if (step % 2 === 0) {
              for (let across = 0; across <= ceilingAcross; across += 1) {
                const lateralOffset = THREE.MathUtils.lerp(
                  -halfWidth,
                  halfWidth,
                  across / ceilingAcross,
                );
                add(
                  new THREE.Vector3(
                    centerX + lateral.x * lateralOffset,
                    floorY + CONNECTOR_SPLAT_HEIGHT,
                    centerZ + lateral.y * lateralOffset,
                  ),
                  new THREE.Vector3(0.3, 0.075, 0.3),
                  identity,
                  baseCeiling,
                  0.94,
                );
              }
            }

            for (const side of [-1, 1]) {
              for (let vertical = 0; vertical <= wallVertical; vertical += 1) {
                const height =
                  (vertical / wallVertical) * CONNECTOR_SPLAT_HEIGHT;
                const panel = (Math.floor(step / 8) + Math.floor(vertical / 5)) % 5;
                add(
                  new THREE.Vector3(
                    centerX + lateral.x * halfWidth * side,
                    floorY + height,
                    centerZ + lateral.y * halfWidth * side,
                  ),
                  new THREE.Vector3(0.28, 0.28, 0.075),
                  wallQuaternion,
                  panel === 0 ? rust : baseWall,
                  0.95,
                  panel === 0 ? 0.05 : 0.1,
                );
              }

              if (step % 2 === 0) {
                add(
                  new THREE.Vector3(
                    centerX + lateral.x * (halfWidth - 0.08) * side,
                    floorY + 2.72,
                    centerZ + lateral.y * (halfWidth - 0.08) * side,
                  ),
                  new THREE.Vector3(0.27, 0.07, 0.07),
                  pipeQuaternion,
                  side < 0 ? pipe : dark,
                  0.98,
                  0.04,
                );
              }
            }

            if (step % Math.max(5, Math.round(2.4 / CONNECTOR_SPLAT_SPACING)) === 0) {
              for (const lateralOffset of [-0.34, 0, 0.34]) {
                add(
                  new THREE.Vector3(
                    centerX + lateral.x * lateralOffset,
                    floorY + CONNECTOR_SPLAT_HEIGHT - 0.08,
                    centerZ + lateral.y * lateralOffset,
                  ),
                  new THREE.Vector3(0.28, 0.045, 0.13),
                  pipeQuaternion,
                  light,
                  1,
                  0.025,
                );
              }
            }
          }
        }
      },
    });
    splat.name = `${ownerId}:gaussians`;
    splat.layers.set(MINT_PRIMARY_SPLAT_LAYER);
    this.root.add(splat);
    this.portalConnectorOwners.set(portal.source.id, ownerId);
    this.portalConnectorSplats.push(splat);
    this.unregisterPortalConnectorOwners.push(
      MintWorldLayer.registerAdditionalSplatOwner(ownerId, splat),
    );
  }

  /**
   * Cut pairs can leave a narrow uncaptured span even when their rooms are
   * authored beside one another. Enclose that span so a continuous walk sees
   * a readable industrial passage instead of renderer clear color. This is
   * presentation-only; the baked landing corridor remains the sole movement
   * authority and the open ends preserve the live destination splat view.
   */
  private addPortalCorridorPresentation(
    portal: SplatWorldPortal,
    surface: SplatNavigationSurface,
  ): void {
    const radius = surface.layout.largestActorCapsuleRadius;
    const fromLanding = surface.portalLandingPoint(
      portal.source.id,
      portal.source.fromRoomId,
      radius,
    );
    const toLanding = surface.portalLandingPoint(
      portal.source.id,
      portal.source.toRoomId,
      radius,
    );
    const fromRoom = surface.room(portal.source.fromRoomId);
    const toRoom = surface.room(portal.source.toRoomId);
    if (
      !fromLanding ||
      !toLanding ||
      !fromRoom?.navigation ||
      !toRoom?.navigation
    ) {
      return;
    }
    // Follow the same reachable approach bend used by player and zombie
    // navigation. Extending the landing-to-landing chord directly could put a
    // straight tunnel wall across a curved room approach.
    const fromApproach =
      surface.portalApproachPoint(
        portal.source.id,
        portal.source.fromRoomId,
        1.2,
      ) ?? fromLanding;
    const toApproach =
      surface.portalApproachPoint(
        portal.source.id,
        portal.source.toRoomId,
        1.2,
      ) ?? toLanding;
    let corridorPoints = [
      { position: fromApproach, room: fromRoom },
      { position: fromLanding, room: fromRoom },
      { position: toLanding, room: toRoom },
      { position: toApproach, room: toRoom },
    ]
      .filter(
        (entry, index, entries) =>
          index === 0 ||
          entry.position.distanceTo(entries[index - 1]!.position) >= 0.2,
      )
      .map((entry) => ({
        position: entry.position.clone(),
        floorY:
          sampleNavigationFloorY(
            entry.room.navigation!,
            entry.position.x,
            entry.position.z,
          ) ?? entry.room.floorY,
      }));
    if (corridorPoints.length < 2) return;
    const halfWidth = portal.source.width * 0.5 + 0.24;
    const height = 3.45;
    const group = new THREE.Group();
    group.name = `zombies-splat-portal-corridor:${portal.source.id}`;
    const wallTexture = createConnectorSurfaceTexture('wall');
    const ceilingTexture = createConnectorSurfaceTexture('ceiling');
    const floorTexture = createConnectorSurfaceTexture('floor');
    // These spans bridge independently exposed scans, so their luminance
    // cannot depend on whichever room lights happen to be active. Controlled
    // unlit values keep the passage readable without turning it into a neon
    // portal or letting it collapse into the renderer's near-black clear.
    const wallMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: wallTexture,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const ceilingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: ceilingTexture,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const floorMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: floorTexture,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const trimMaterial = new THREE.MeshBasicMaterial({
      color: 0x737f79,
      toneMapped: false,
    });
    const lightMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcf83,
      toneMapped: false,
    });
    const hasSharpTurn = corridorPoints
      .slice(1, -1)
      .some((_point, innerIndex) => {
        const index = innerIndex + 1;
        const previousDirection = new THREE.Vector2(
          corridorPoints[index]!.position.x -
            corridorPoints[index - 1]!.position.x,
          corridorPoints[index]!.position.z -
            corridorPoints[index - 1]!.position.z,
        ).normalize();
        const nextDirection = new THREE.Vector2(
          corridorPoints[index + 1]!.position.x -
            corridorPoints[index]!.position.x,
          corridorPoints[index + 1]!.position.z -
            corridorPoints[index]!.position.z,
        ).normalize();
        return previousDirection.dot(nextDirection) < 0.35;
      });
    if (hasSharpTurn) {
      // A folded join can begin several metres before its landing-to-landing
      // bend. Starting the presentation at the ordinary 1.2 m threshold left
      // the player outside the shell at natural inspection distance, exposing
      // renderer background beside an otherwise valid doorway. Extend just
      // the two room-side legs along their baked, reachable approach paths.
      const extendedFrom = surface.portalApproachPoint(
        portal.source.id,
        portal.source.fromRoomId,
        FOLDED_PORTAL_APPROACH_SPAN,
      );
      const extendedTo = surface.portalApproachPoint(
        portal.source.id,
        portal.source.toRoomId,
        FOLDED_PORTAL_APPROACH_SPAN,
      );
      corridorPoints = corridorPoints.map((point, index) => {
        const extended =
          index === 0
            ? extendedFrom
            : index === corridorPoints.length - 1
              ? extendedTo
              : null;
        if (!extended || extended.distanceTo(point.position) < 0.2) {
          return point;
        }
        const room = index === 0 ? fromRoom : toRoom;
        return {
          position: extended.clone(),
          floorY:
            sampleNavigationFloorY(
              room.navigation!,
              extended.x,
              extended.z,
            ) ?? room.floorY,
        };
      });
    }
    const laterals = corridorPoints.map((_point, index) => {
      const previous = corridorPoints[Math.max(0, index - 1)]!.position;
      const next = corridorPoints[
        Math.min(corridorPoints.length - 1, index + 1)
      ]!.position;
      const tangent = new THREE.Vector2(
        next.x - previous.x,
        next.z - previous.z,
      );
      if (tangent.lengthSq() <= Number.EPSILON) tangent.set(1, 0);
      tangent.normalize();
      return new THREE.Vector2(-tangent.y, tangent.x);
    });
    const edgePoint = (index: number, side: number, y: number) => {
      const point = corridorPoints[index]!;
      const lateral = laterals[index]!;
      return new THREE.Vector3(
        point.position.x + lateral.x * halfWidth * side,
        y,
        point.position.z + lateral.y * halfWidth * side,
      );
    };
    const addQuad = (
      name: string,
      a: THREE.Vector3,
      b: THREE.Vector3,
      c: THREE.Vector3,
      d: THREE.Vector3,
      material: THREE.Material,
    ) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [a, b, c, d].flatMap((point) => [point.x, point.y, point.z]),
          3,
        ),
      );
      geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2),
      );
      geometry.setIndex([0, 1, 2, 2, 1, 3]);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${group.name}:${name}`;
      group.add(mesh);
    };
    if (hasSharpTurn) {
      // Folded scan joins are better represented as one open junction than a
      // corridor trying to execute a hairpin. The authored traversal polygon
      // is already the exact playable footprint, so use its perimeter and
      // omit the two nearest edges as wide room entrances.
      const polygon = portal.traversalPolygon;
      const junctionHeight = 4.8;
      const junctionFloorY = Math.min(
        ...corridorPoints.map((point) => point.floorY),
      );
      const ceiling = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(polygon)),
        ceilingMaterial,
      );
      ceiling.name = `${group.name}:junction-ceiling`;
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = junctionFloorY + junctionHeight;
      group.add(ceiling);
      const entrancePoints = [fromApproach, toApproach].map(
        (position) => new THREE.Vector2(position.x, position.z),
      );
      const entranceRadius = portal.source.width * 0.5 + 0.65;
      for (let index = 0; index < polygon.length; index += 1) {
        const start = polygon[index]!;
        const end = polygon[(index + 1) % polygon.length]!;
        if (
          entrancePoints.some(
            (point) => distanceToSegment(point, start, end) <= entranceRadius,
          )
        ) {
          continue;
        }
        const dx = end.x - start.x;
        const dz = end.y - start.y;
        const length = Math.hypot(dx, dz);
        if (length < 0.25) continue;
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(length + 0.08, junctionHeight, 0.14),
          wallMaterial,
        );
        wall.name = `${group.name}:junction-wall`;
        wall.position.set(
          (start.x + end.x) * 0.5,
          junctionFloorY + junctionHeight * 0.5,
          (start.y + end.y) * 0.5,
        );
        wall.rotation.y = -Math.atan2(dz, dx);
        group.add(wall);
      }
      const centroid = polygon
        .reduce((sum, point) => sum.add(point), new THREE.Vector2())
        .multiplyScalar(1 / Math.max(1, polygon.length));
      const junctionLight = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.035, 0.24),
        lightMaterial,
      );
      junctionLight.name = `${group.name}:junction-light`;
      junctionLight.position.set(
        centroid.x,
        junctionFloorY + junctionHeight - 0.12,
        centroid.y,
      );
      group.add(junctionLight);
    }
    for (let legIndex = 0; legIndex < corridorPoints.length - 1; legIndex += 1) {
      const legFrom = corridorPoints[legIndex]!;
      const legTo = corridorPoints[legIndex + 1]!;
      const span = Math.hypot(
        legTo.position.x - legFrom.position.x,
        legTo.position.z - legFrom.position.z,
      );
      if (span < PORTAL_CORRIDOR_MIN_SPAN) continue;
      let leftFrom = edgePoint(legIndex, 1, legFrom.floorY);
      let rightFrom = edgePoint(legIndex, -1, legFrom.floorY);
      let leftTo = edgePoint(legIndex + 1, 1, legTo.floorY);
      let rightTo = edgePoint(legIndex + 1, -1, legTo.floorY);
      const isRoomSideApproachLeg =
        legIndex === 0 || legIndex === corridorPoints.length - 2;
      if (hasSharpTurn && isRoomSideApproachLeg) {
        // Do not average a hairpin's incoming and outgoing tangents at the
        // landing. That rotates one end of the wall across the walking
        // centerline. Each room-side shell is a straight, wide opening whose
        // two walls remain parallel to its own reachable approach leg.
        const legDirection = new THREE.Vector2(
          legTo.position.x - legFrom.position.x,
          legTo.position.z - legFrom.position.z,
        );
        if (legDirection.lengthSq() > Number.EPSILON) {
          legDirection.normalize();
          const legLateral = new THREE.Vector2(
            -legDirection.y,
            legDirection.x,
          );
          leftFrom = new THREE.Vector3(
            legFrom.position.x + legLateral.x * halfWidth,
            legFrom.floorY,
            legFrom.position.z + legLateral.y * halfWidth,
          );
          rightFrom = new THREE.Vector3(
            legFrom.position.x - legLateral.x * halfWidth,
            legFrom.floorY,
            legFrom.position.z - legLateral.y * halfWidth,
          );
          leftTo = new THREE.Vector3(
            legTo.position.x + legLateral.x * halfWidth,
            legTo.floorY,
            legTo.position.z + legLateral.y * halfWidth,
          );
          rightTo = new THREE.Vector3(
            legTo.position.x - legLateral.x * halfWidth,
            legTo.floorY,
            legTo.position.z - legLateral.y * halfWidth,
          );
        }
      }
      if (!hasSharpTurn) {
        addQuad('floor', leftFrom, leftTo, rightFrom, rightTo, floorMaterial);
        addQuad(
          'ceiling',
          leftFrom.clone().add(new THREE.Vector3(0, height, 0)),
          leftTo.clone().add(new THREE.Vector3(0, height, 0)),
          rightFrom.clone().add(new THREE.Vector3(0, height, 0)),
          rightTo.clone().add(new THREE.Vector3(0, height, 0)),
          ceilingMaterial,
        );
      }
      if (!hasSharpTurn) {
        addQuad(
          'left-wall',
          leftFrom,
          leftTo,
          leftFrom.clone().add(new THREE.Vector3(0, height, 0)),
          leftTo.clone().add(new THREE.Vector3(0, height, 0)),
          wallMaterial,
        );
        addQuad(
          'right-wall',
          rightFrom,
          rightTo,
          rightFrom.clone().add(new THREE.Vector3(0, height, 0)),
          rightTo.clone().add(new THREE.Vector3(0, height, 0)),
          wallMaterial,
        );
      }
      this.portalCorridorPresentations.push({
        portalId: portal.source.id,
        group,
        from: legFrom.position.clone(),
        to: legTo.position.clone(),
        halfWidth,
        persistWhileInside:
          fromLanding.distanceTo(toLanding) > LONG_PORTAL_CORRIDOR_SPAN,
      });
    }
    for (let index = 1; index < corridorPoints.length - 1; index += 1) {
      if (hasSharpTurn) continue;
      const point = corridorPoints[index]!;
      const previous = corridorPoints[index - 1]!.position;
      const next = corridorPoints[index + 1]!.position;
      const tangent = new THREE.Vector2(next.x - previous.x, next.z - previous.z);
      if (tangent.lengthSq() <= Number.EPSILON) continue;
      tangent.normalize();
      const yaw = -Math.atan2(tangent.y, tangent.x);
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.14, halfWidth * 2 + 0.12),
        trimMaterial,
      );
      beam.name = `${group.name}:beam`;
      beam.position.set(
        point.position.x,
        point.floorY + height - 0.08,
        point.position.z,
      );
      beam.rotation.y = yaw;
      group.add(beam);
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.025, 0.13),
        lightMaterial,
      );
      light.name = `${group.name}:light`;
      light.position.set(
        point.position.x,
        point.floorY + height - 0.17,
        point.position.z,
      );
      light.rotation.y = yaw;
      group.add(light);
    }
    this.root.add(group);
    this.registerPortalVisual(portal.source.id, group);
  }

  /**
   * Put the same thin, non-colliding guide frame on both authored ends of a
   * doorway. The portal width remains the spatial authority; these meshes only
   * make an otherwise dark Gaussian cut legible from inside either room.
   */
  private addDoorwayPresentation(
    portal: SplatWorldPortal,
    surface: SplatNavigationSurface,
  ): void {
    const fromLanding =
      surface.portalPresentationPoint(
        portal.source.id,
        portal.source.fromRoomId,
      ) ?? portal.from;
    const toLanding =
      surface.portalPresentationPoint(
        portal.source.id,
        portal.source.toRoomId,
      ) ?? portal.to;
    const endpoints = [
      {
        point: fromLanding,
        roomId: portal.source.fromRoomId,
        socketId: portal.source.fromSocketId,
      },
      {
        point: toLanding,
        roomId: portal.source.toRoomId,
        socketId: portal.source.toSocketId,
      },
    ];
    const sharedHeight = THREE.MathUtils.clamp(
      Math.min(
        ...endpoints.map((endpoint) => {
          const room = surface.room(endpoint.roomId);
          return (
            room?.source.doorwaySockets.find(
              (candidate) => candidate.id === endpoint.socketId,
            )?.height ?? 3.2
          );
        }),
      ),
      3.2,
      3.6,
    );
    for (const endpoint of endpoints) {
      const room = surface.room(endpoint.roomId);
      if (!room) continue;
      const socket = room.source.doorwaySockets.find(
        (candidate) => candidate.id === endpoint.socketId,
      );
      const width = Math.max(5, portal.source.width);
      const height = sharedHeight;
      const interior = surface.portalApproachPoint(
        portal.source.id,
        endpoint.roomId,
        1.4,
      );
      const forward = interior
        ? endpoint.point.clone().sub(interior).setY(0)
        : new THREE.Vector3();
      if (forward.lengthSq() <= 1e-6) {
        const socketYaw =
          room.source.transform.authoredYaw + (socket?.yaw ?? 0);
        forward.set(Math.sin(socketYaw), 0, Math.cos(socketYaw));
      }
      forward.normalize();

      const guide = new THREE.Group();
      guide.name = `zombies-room-doorway:${portal.source.id}:${endpoint.roomId}`;
      guide.position.set(endpoint.point.x, room.floorY + 0.035, endpoint.point.z);
      guide.rotation.y = Math.atan2(forward.x, forward.z);
      guide.visible = false;

      const material = new THREE.MeshStandardMaterial({
        color: 0x252d2a,
        emissive: 0x18392e,
        emissiveIntensity: 0.68,
        roughness: 0.66,
        metalness: 0.28,
      });
      // The corridor shell and its warm ceiling lights are the landmark. A
      // freestanding jamb mesh made the transition read as a portal object and
      // intersected the destination scan at oblique angles, so this group is
      // intentionally metadata-only for owner/facing visibility.
      void material;
      this.root.add(guide);
      this.doorwayPresentationSides.push({
        portalId: portal.source.id,
        roomId: endpoint.roomId,
        group: guide,
        center: new THREE.Vector3(
          endpoint.point.x,
          room.floorY + height * 0.5,
          endpoint.point.z,
        ),
        outward: forward.clone(),
        halfWidth: width * 0.5,
        halfHeight: height * 0.5,
      });
      this.doorwayGuideCount += 1;
    }
  }

  private addConnectorPresentation(
    connector: SplatWorldConnector,
    connectors: readonly SplatWorldConnector[],
  ): void {
    const shape = new THREE.Shape(connector.polygon);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x34484b,
      emissive: 0x132325,
      emissiveIntensity: 0.72,
      roughness: 0.7,
      metalness: 0.22,
    });
    const floor = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      floorMaterial,
    );
    floor.name = `zombies-concourse-floor:${connector.source.id}`;
    floor.rotation.x = Math.PI / 2;
    floor.position.y = connector.floorY + 0.015;
    floor.receiveShadow = true;
    this.root.add(floor);

    const ceilingMaterial = new THREE.MeshStandardMaterial({
      color: 0x202d30,
      emissive: 0x0d1719,
      emissiveIntensity: 0.62,
      roughness: 0.88,
      metalness: 0.18,
      side: THREE.DoubleSide,
    });
    const ceiling = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      ceilingMaterial,
    );
    ceiling.name = `zombies-concourse-ceiling:${connector.source.id}`;
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = connector.floorY + 3.25;
    this.root.add(ceiling);

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x53696d,
      emissive: 0x203438,
      emissiveIntensity: 0.82,
      roughness: 0.76,
      metalness: 0.28,
    });
    for (let edgeIndex = 0; edgeIndex < connector.polygon.length; edgeIndex += 1) {
      const start = connector.polygon[edgeIndex]!;
      const end =
        connector.polygon[(edgeIndex + 1) % connector.polygon.length]!;
      const dx = end.x - start.x;
      const dz = end.y - start.y;
      const edgeLength = Math.hypot(dx, dz);
      const segments = Math.max(
        1,
        Math.ceil(edgeLength / CONNECTOR_WALL_SEGMENT),
      );
      for (let segment = 0; segment < segments; segment += 1) {
        const fromT = segment / segments;
        const toT = (segment + 1) / segments;
        const from = start.clone().lerp(end, fromT);
        const to = start.clone().lerp(end, toT);
        const midpoint = from.clone().lerp(to, 0.5);
        if (
          connectors.some(
            (other) =>
              other !== connector &&
              signedDistance(midpoint, other.polygon) > -0.28,
          )
        ) {
          continue;
        }
        const length = from.distanceTo(to);
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(length, 3.25, 0.14),
          wallMaterial,
        );
        wall.name = `zombies-concourse-wall:${connector.source.id}`;
        wall.position.set(
          midpoint.x,
          connector.floorY + 1.625,
          midpoint.y,
        );
        wall.rotation.y = -Math.atan2(to.y - from.y, to.x - from.x);
        // Campus gap-repair meshes sit under baked-lit splats; shadow casting
        // only inflated the unused Three.js shadow pass.
        wall.castShadow = false;
        wall.receiveShadow = false;
        this.root.add(wall);
      }
    }
  }

  private edgeCrossesDoorway(
    start: THREE.Vector2,
    end: THREE.Vector2,
    room: SplatWorldRoom,
    connectors: readonly SplatWorldConnector[],
  ): boolean {
    const midpoint = start.clone().lerp(end, 0.5);
    if (
      connectors.some(
        (connector) =>
          signedDistance(midpoint, connector.polygon) >= -0.18,
      )
    ) {
      return true;
    }
    const yaw = room.source.transform.authoredYaw;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    return room.source.doorwaySockets.some((socket) => {
      if (!socket.verifiedTraversable || socket.visualState !== 'open') {
        return false;
      }
      const doorway = new THREE.Vector2(
        room.source.transform.position[0] +
          socket.position[0] * cosine -
          socket.position[1] * sine,
        room.source.transform.position[2] +
          socket.position[0] * sine +
          socket.position[1] * cosine,
      );
      return (
        distanceToSegment(doorway, start, end) <= 0.85 &&
        midpoint.distanceTo(doorway) <= socket.width * 0.62 + 0.45
      );
    });
  }

}
