import * as THREE from 'three';
import kineticCalibration from '../../data/splat-analysis/kinetic-hall/calibration/candidate-transform.json';
import kineticDockAnchorMeasurement from '../../data/splat-analysis/kinetic-hall/calibration/dock-contact-anchor-measurement.json';
import kineticAnchorMeasurement from '../../data/splat-analysis/kinetic-hall/calibration/physical-anchor-measurement.json';
import kineticRampPlacementMeasurement from '../../data/splat-analysis/kinetic-hall/calibration/ramp-placement-measurement-v4.json';
import kineticStairAnchorMeasurement from '../../data/splat-analysis/kinetic-hall/calibration/stair-support-anchor-measurement-v2.json';
import kineticSemantics from '../../data/splat-analysis/kinetic-hall/normalized/raw-semantics.json';
import type { RoomId } from '../config/catalog';
import type { LoadedMintWorld } from '../worlds/MintWorldLoader';

type RawSemanticObject = Readonly<{
  id: string;
  label: string;
  rawPosition: Readonly<{ x: number; y: number; z: number }>;
  rawSize: Readonly<{ x: number; y: number; z: number }>;
  verified: boolean;
}>;

type KineticSemanticDocument = Readonly<{
  status: string;
  objects: readonly RawSemanticObject[];
  candidates: readonly RawSemanticObject[];
}>;

type CalibrationCandidate = Readonly<{
  status: string;
  reviewed: boolean;
  analyzerToWorld: readonly number[];
}>;

type AnchorMeasurement = Readonly<{
  status: string;
  gameplayAnchorsAccepted: boolean;
  anchors: readonly Readonly<{
    id: string;
    label: string;
    semanticWorldPoint: Readonly<{ x: number; y: number; z: number }>;
    colliderRefinedPoint: Readonly<{ x: number; y: number; z: number }>;
    thresholdPassed: boolean;
  }>[];
}>;

type StairAnchorMeasurement = Readonly<{
  status: string;
  stairAnchorsAccepted: boolean;
  anchors: readonly Readonly<{
    id: string;
    label: string;
    semanticWorldPoint: Readonly<{ x: number; y: number; z: number }>;
    colliderConstrainedAnchor: Readonly<{ x: number; y: number; z: number }>;
    thresholdPassed: boolean;
  }>[];
}>;

type DockAnchorMeasurement = Readonly<{
  status: string;
  gameplayContactAnchorAccepted: boolean;
  anchor: Readonly<{
    worldContactPoint: Readonly<{ x: number; y: number; z: number }>;
    closestProductionColliderPoint: Readonly<{ x: number; y: number; z: number }>;
    worldApproachDirection: Readonly<{ x: number; y: number; z: number }>;
    thresholdPassed: boolean;
  }>;
}>;

type RampPlacementMeasurement = Readonly<{
  status: string;
  placementAccepted: boolean;
  transformedBounds: Readonly<{
    minimum: readonly [number, number, number];
    maximum: readonly [number, number, number];
    size: readonly [number, number, number];
  }>;
  traversalAnchors: Readonly<{
    lowDeckPoint: readonly [number, number, number];
    highDeckPoint: readonly [number, number, number];
    rampTrimeshResidualsPending: boolean;
  }>;
}>;

export type CalibrationDebugLayerState = Readonly<{
  colliders: boolean;
  navigation: boolean;
  semantics: boolean;
}>;

export type CalibrationDebugDiagnostics = Readonly<{
  roomId: RoomId | null;
  candidateOnly: boolean;
  rawBoxes: number;
  mappedBoxes: number;
  labels: number;
  anchorPoints: number;
  anchorLinks: number;
  routePoints: number;
  colliderMeshes: number;
}>;

const semanticDocument = kineticSemantics as KineticSemanticDocument;
const calibrationCandidate = kineticCalibration as CalibrationCandidate;
const anchorMeasurement = kineticAnchorMeasurement as AnchorMeasurement;
const stairAnchorMeasurement = kineticStairAnchorMeasurement as StairAnchorMeasurement;
const dockAnchorMeasurement = kineticDockAnchorMeasurement as DockAnchorMeasurement;
const rampPlacementMeasurement =
  kineticRampPlacementMeasurement as unknown as RampPlacementMeasurement;

const RAW_COLOR = '#ff3ca6';
const CANONICAL_COLOR = '#38d8ff';
const CANDIDATE_COLOR = '#ffbd45';
const COLLIDER_COLOR = '#ffe066';
const ROUTE_COLOR = '#52ff9a';
const ANCHOR_SOURCE_COLOR = '#ff3ca6';
const ANCHOR_PASS_COLOR = '#52ff9a';
const ANCHOR_FAIL_COLOR = '#ff5349';
const ANCHOR_REFINED_COLOR = '#38d8ff';
const ANCHOR_APPROACH_COLOR = '#ffbd45';

/**
 * Visual-only review layer for production Mint Worlds. Raw analyzer boxes and
 * candidate-transformed boxes remain separate, and this class never mutates
 * semantic verification state or the authoritative collider.
 */
export class SplatCalibrationDebugOverlay {
  private readonly root = new THREE.Group();
  private readonly colliderLayer = new THREE.Group();
  private readonly rawSemanticLayer = new THREE.Group();
  private readonly mappedSemanticLayer = new THREE.Group();
  private readonly anchorLayer = new THREE.Group();
  private readonly navigationLayer = new THREE.Group();
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly ownedTextures = new Set<THREE.Texture>();
  private currentDiagnostics: CalibrationDebugDiagnostics = {
    roomId: null,
    candidateOnly: true,
    rawBoxes: 0,
    mappedBoxes: 0,
    labels: 0,
    anchorPoints: 0,
    anchorLinks: 0,
    routePoints: 0,
    colliderMeshes: 0,
  };

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'splat-calibration-debug:non-authoritative';
    this.root.userData.reviewOnly = true;
    this.colliderLayer.name = 'splat-calibration-debug:collider';
    this.rawSemanticLayer.name = 'splat-calibration-debug:raw-boxes';
    this.mappedSemanticLayer.name = 'splat-calibration-debug:mapped-boxes';
    this.anchorLayer.name = 'splat-calibration-debug:physical-anchors';
    this.navigationLayer.name = 'splat-calibration-debug:navigation';
    this.root.add(
      this.colliderLayer,
      this.rawSemanticLayer,
      this.mappedSemanticLayer,
      this.anchorLayer,
      this.navigationLayer,
    );
    this.scene.add(this.root);
    this.setLayerState({ colliders: false, navigation: false, semantics: false });
  }

  get diagnostics(): CalibrationDebugDiagnostics {
    return this.currentDiagnostics;
  }

  load(
    roomId: RoomId,
    world: LoadedMintWorld,
    route: readonly THREE.Vector3[],
  ): CalibrationDebugDiagnostics {
    this.clear();
    const colliderMeshes = this.addColliderWireframe(world);
    this.addNavigationRoute(route);

    let rawBoxes = 0;
    let mappedBoxes = 0;
    let labels = 0;
    let anchorPoints = 0;
    let anchorLinks = 0;
    if (roomId === 'kinetic-hall') {
      if (
        semanticDocument.status !== 'pending-calibration-and-review' ||
        calibrationCandidate.status !== 'candidate-only' ||
        calibrationCandidate.reviewed ||
        calibrationCandidate.analyzerToWorld.length !== 16
      ) {
        throw new Error('Kinetic calibration debug inputs do not retain candidate-only status');
      }
      const mapper = new THREE.Matrix4().fromArray([...calibrationCandidate.analyzerToWorld]);
      const canonical = semanticDocument.objects;
      const candidates = semanticDocument.candidates.filter(
        (candidate) => !canonical.some((object) => object.id === candidate.id),
      );
      for (const object of canonical) {
        this.addSemanticBox(object, this.rawSemanticLayer, null, RAW_COLOR, 'RAW');
        this.addSemanticBox(object, this.mappedSemanticLayer, mapper, CANONICAL_COLOR, 'MAPPED');
        rawBoxes += 1;
        mappedBoxes += 1;
        labels += 2;
      }
      for (const object of candidates) {
        this.addSemanticBox(object, this.mappedSemanticLayer, mapper, CANDIDATE_COLOR, 'CANDIDATE');
        mappedBoxes += 1;
        labels += 1;
      }
      if (
        anchorMeasurement.status !== 'measurement-incomplete-or-threshold-failed' ||
        anchorMeasurement.gameplayAnchorsAccepted
      ) {
        throw new Error('Kinetic anchor debug input does not retain fail-closed status');
      }
      for (const anchor of anchorMeasurement.anchors) {
        this.addAnchorMeasurement(anchor);
        anchorPoints += 2;
        anchorLinks += 1;
        labels += 1;
      }
      if (
        stairAnchorMeasurement.status !== 'pending-independent-stair-anchor-review' ||
        stairAnchorMeasurement.stairAnchorsAccepted
      ) {
        throw new Error('Kinetic stair refinement does not retain pending-review status');
      }
      for (const anchor of stairAnchorMeasurement.anchors) {
        this.addAnchorMeasurement({
          id: anchor.id,
          label: `${anchor.label} support v2`,
          semanticWorldPoint: anchor.semanticWorldPoint,
          colliderRefinedPoint: anchor.colliderConstrainedAnchor,
          thresholdPassed: anchor.thresholdPassed,
        });
        anchorPoints += 2;
        anchorLinks += 1;
        labels += 1;
      }
      if (
        dockAnchorMeasurement.status !== 'pending-independent-dock-anchor-review' ||
        dockAnchorMeasurement.gameplayContactAnchorAccepted
      ) {
        throw new Error('Kinetic dock refinement does not retain pending-review status');
      }
      this.addAnchorMeasurement({
        id: 'kinetic-hall:manual:dock-south:contact-v1',
        label: 'charging dock contact',
        semanticWorldPoint: dockAnchorMeasurement.anchor.worldContactPoint,
        colliderRefinedPoint: dockAnchorMeasurement.anchor.closestProductionColliderPoint,
        thresholdPassed: dockAnchorMeasurement.anchor.thresholdPassed,
      });
      this.addApproachDirection(
        dockAnchorMeasurement.anchor.worldContactPoint,
        dockAnchorMeasurement.anchor.worldApproachDirection,
      );
      anchorPoints += 2;
      anchorLinks += 2;
      labels += 1;
      if (
        rampPlacementMeasurement.status !==
          'placement-measured-pending-runtime-traversal-overlay-and-independent-review' ||
        rampPlacementMeasurement.placementAccepted ||
        !rampPlacementMeasurement.traversalAnchors.rampTrimeshResidualsPending
      ) {
        throw new Error('Kinetic ramp placement does not retain pending-review status');
      }
      this.addRampCandidate(rampPlacementMeasurement);
      mappedBoxes += 1;
      anchorPoints += 2;
      anchorLinks += 1;
      labels += 2;
    }

    this.currentDiagnostics = {
      roomId,
      candidateOnly: true,
      rawBoxes,
      mappedBoxes,
      labels,
      anchorPoints,
      anchorLinks,
      routePoints: route.length,
      colliderMeshes,
    };
    return this.currentDiagnostics;
  }

  setLayerState(state: CalibrationDebugLayerState): void {
    this.colliderLayer.visible = state.colliders;
    this.navigationLayer.visible = state.navigation;
    this.rawSemanticLayer.visible = state.semantics;
    this.mappedSemanticLayer.visible = state.semantics;
    this.anchorLayer.visible = state.semantics;
  }

  clear(): void {
    this.colliderLayer.clear();
    this.rawSemanticLayer.clear();
    this.mappedSemanticLayer.clear();
    this.anchorLayer.clear();
    this.navigationLayer.clear();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.ownedGeometries.clear();
    this.ownedMaterials.clear();
    this.ownedTextures.clear();
    this.currentDiagnostics = {
      roomId: null,
      candidateOnly: true,
      rawBoxes: 0,
      mappedBoxes: 0,
      labels: 0,
      anchorPoints: 0,
      anchorLinks: 0,
      routePoints: 0,
      colliderMeshes: 0,
    };
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }

  private addColliderWireframe(world: LoadedMintWorld): number {
    const material = new THREE.MeshBasicMaterial({
      color: COLLIDER_COLOR,
      wireframe: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.ownedMaterials.add(material);
    const debugRoot = new THREE.Group();
    debugRoot.position.copy(world.root.position);
    debugRoot.quaternion.copy(world.root.quaternion);
    debugRoot.scale.copy(world.root.scale);
    const debugCollider = world.collider.clone(true);
    let meshes = 0;
    debugCollider.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) return;
      mesh.name = `debug:${mesh.name || `collider-${meshes}`}`;
      mesh.material = material;
      mesh.visible = true;
      mesh.renderOrder = 20;
      meshes += 1;
    });
    debugRoot.add(debugCollider);
    this.colliderLayer.add(debugRoot);

    const boundsHelper = new THREE.Box3Helper(world.bounds.clone(), COLLIDER_COLOR);
    boundsHelper.name = 'debug:reviewed-collider-bounds';
    boundsHelper.renderOrder = 21;
    this.colliderLayer.add(boundsHelper);
    this.ownedGeometries.add(boundsHelper.geometry);
    if (Array.isArray(boundsHelper.material)) {
      for (const boundsMaterial of boundsHelper.material) this.ownedMaterials.add(boundsMaterial);
    } else {
      this.ownedMaterials.add(boundsHelper.material);
    }
    const axes = new THREE.AxesHelper(2);
    axes.name = 'debug:shared-world-root-axes';
    axes.renderOrder = 22;
    debugRoot.add(axes);
    this.ownedGeometries.add(axes.geometry);
    if (Array.isArray(axes.material)) {
      for (const axesMaterial of axes.material) this.ownedMaterials.add(axesMaterial);
    } else {
      this.ownedMaterials.add(axes.material);
    }
    const splatBounds = world.alignment.splatWorldBounds;
    if (splatBounds) {
      const visualBounds = new THREE.Box3(
        new THREE.Vector3(splatBounds.min.x, splatBounds.min.y, splatBounds.min.z),
        new THREE.Vector3(splatBounds.max.x, splatBounds.max.y, splatBounds.max.z),
      );
      const visualBoundsHelper = new THREE.Box3Helper(visualBounds, CANONICAL_COLOR);
      visualBoundsHelper.name = 'debug:mint-rad-bounds';
      visualBoundsHelper.renderOrder = 23;
      this.colliderLayer.add(visualBoundsHelper);
      this.ownedGeometries.add(visualBoundsHelper.geometry);
      if (Array.isArray(visualBoundsHelper.material)) {
        for (const boundsMaterial of visualBoundsHelper.material)
          this.ownedMaterials.add(boundsMaterial);
      } else {
        this.ownedMaterials.add(visualBoundsHelper.material);
      }
    }
    return meshes;
  }

  private addNavigationRoute(route: readonly THREE.Vector3[]): void {
    const points = route.map((point) => point.clone().add(new THREE.Vector3(0, 0.08, 0)));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: ROUTE_COLOR,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const line = new THREE.Line(geometry, material);
    line.name = 'debug:navigation-route';
    line.renderOrder = 40;
    this.navigationLayer.add(line);
    this.ownedGeometries.add(geometry);
    this.ownedMaterials.add(material);

    const markerGeometry = new THREE.SphereGeometry(0.07, 10, 8);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: ROUTE_COLOR,
      depthTest: false,
    });
    this.ownedGeometries.add(markerGeometry);
    this.ownedMaterials.add(markerMaterial);
    for (const [index, point] of points.entries()) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.name = `debug:route-point:${index}`;
      marker.position.copy(point);
      marker.renderOrder = 41;
      this.navigationLayer.add(marker);
    }
  }

  private addSemanticBox(
    object: RawSemanticObject,
    layer: THREE.Group,
    mapper: THREE.Matrix4 | null,
    color: string,
    prefix: string,
  ): void {
    if (object.verified) {
      throw new Error(`Debug input unexpectedly marks ${object.id} as verified`);
    }
    const position = new THREE.Vector3(
      object.rawPosition.x,
      object.rawPosition.y,
      object.rawPosition.z,
    );
    if (mapper) position.applyMatrix4(mapper);
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const geometry = new THREE.EdgesGeometry(boxGeometry);
    boxGeometry.dispose();
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: prefix === 'CANDIDATE' ? 0.72 : 0.95,
      depthTest: false,
    });
    const box = new THREE.LineSegments(geometry, material);
    box.name = `debug:${prefix.toLowerCase()}:${object.id}`;
    box.position.copy(position);
    box.scale.set(object.rawSize.x, object.rawSize.y, object.rawSize.z);
    box.renderOrder = 50;
    layer.add(box);
    this.ownedGeometries.add(geometry);
    this.ownedMaterials.add(material);

    const label = this.createLabel(`${prefix} · ${object.label}`, color);
    label.position.copy(position);
    label.position.y += object.rawSize.y * 0.5 + 0.08;
    layer.add(label);
  }

  private addAnchorMeasurement(anchor: AnchorMeasurement['anchors'][number]): void {
    const semanticPoint = new THREE.Vector3(
      anchor.semanticWorldPoint.x,
      anchor.semanticWorldPoint.y,
      anchor.semanticWorldPoint.z,
    );
    const colliderPoint = new THREE.Vector3(
      anchor.colliderRefinedPoint.x,
      anchor.colliderRefinedPoint.y,
      anchor.colliderRefinedPoint.z,
    );
    const outcomeColor = anchor.thresholdPassed ? ANCHOR_PASS_COLOR : ANCHOR_FAIL_COLOR;
    const markerGeometry = new THREE.SphereGeometry(0.055, 14, 10);
    const sourceMaterial = new THREE.MeshBasicMaterial({
      color: ANCHOR_SOURCE_COLOR,
      depthTest: false,
    });
    const colliderMaterial = new THREE.MeshBasicMaterial({
      color: outcomeColor,
      depthTest: false,
    });
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([semanticPoint, colliderPoint]);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: outcomeColor,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    this.ownedGeometries.add(markerGeometry);
    this.ownedGeometries.add(lineGeometry);
    this.ownedMaterials.add(sourceMaterial);
    this.ownedMaterials.add(colliderMaterial);
    this.ownedMaterials.add(lineMaterial);

    const sourceMarker = new THREE.Mesh(markerGeometry, sourceMaterial);
    sourceMarker.name = `debug:anchor-source:${anchor.id}`;
    sourceMarker.position.copy(semanticPoint);
    sourceMarker.renderOrder = 70;
    this.anchorLayer.add(sourceMarker);

    const colliderMarker = new THREE.Mesh(markerGeometry, colliderMaterial);
    colliderMarker.name = `debug:anchor-collider:${anchor.id}`;
    colliderMarker.position.copy(colliderPoint);
    colliderMarker.renderOrder = 71;
    this.anchorLayer.add(colliderMarker);

    const residual = new THREE.Line(lineGeometry, lineMaterial);
    residual.name = `debug:anchor-residual:${anchor.id}`;
    residual.renderOrder = 69;
    this.anchorLayer.add(residual);

    const label = this.createLabel(
      `ANCHOR ${anchor.thresholdPassed ? 'PASS' : 'FAIL'} · ${anchor.label}`,
      outcomeColor,
    );
    label.position.copy(semanticPoint).add(new THREE.Vector3(0, 0.12, 0));
    label.renderOrder = 72;
    this.anchorLayer.add(label);
  }

  private addApproachDirection(
    source: Readonly<{ x: number; y: number; z: number }>,
    direction: Readonly<{ x: number; y: number; z: number }>,
  ): void {
    const origin = new THREE.Vector3(source.x, source.y, source.z);
    const vector = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const arrow = new THREE.ArrowHelper(vector, origin, 0.85, ANCHOR_APPROACH_COLOR, 0.16, 0.08);
    arrow.name = 'debug:anchor-approach:kinetic-hall:manual:dock-south';
    arrow.renderOrder = 73;
    arrow.traverse((object) => {
      const mesh = object as THREE.Line | THREE.Mesh;
      const geometry = mesh.geometry;
      const material = mesh.material;
      if (geometry instanceof THREE.BufferGeometry) this.ownedGeometries.add(geometry);
      if (Array.isArray(material)) {
        for (const item of material) this.ownedMaterials.add(item);
      } else if (material instanceof THREE.Material) {
        this.ownedMaterials.add(material);
      }
    });
    this.anchorLayer.add(arrow);

    const label = this.createLabel('DOCK APPROACH +Z', ANCHOR_REFINED_COLOR);
    label.position.copy(origin).addScaledVector(vector, 0.92);
    label.position.y += 0.08;
    label.renderOrder = 74;
    this.anchorLayer.add(label);
  }

  private addRampCandidate(measurement: RampPlacementMeasurement): void {
    const minimum = new THREE.Vector3(...measurement.transformedBounds.minimum);
    const maximum = new THREE.Vector3(...measurement.transformedBounds.maximum);
    const center = minimum.clone().add(maximum).multiplyScalar(0.5);
    const size = new THREE.Vector3(...measurement.transformedBounds.size);
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(boxGeometry);
    boxGeometry.dispose();
    const boxMaterial = new THREE.LineBasicMaterial({
      color: ANCHOR_APPROACH_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const box = new THREE.LineSegments(edges, boxMaterial);
    box.name = 'debug:candidate:kinetic-hall:manual:ramp-primary';
    box.position.copy(center);
    box.scale.copy(size);
    box.renderOrder = 68;
    this.mappedSemanticLayer.add(box);
    this.ownedGeometries.add(edges);
    this.ownedMaterials.add(boxMaterial);

    const boxLabel = this.createLabel('PENDING MINT RAMP PLACEMENT', ANCHOR_APPROACH_COLOR);
    boxLabel.position.copy(center);
    boxLabel.position.y = maximum.y + 0.1;
    boxLabel.renderOrder = 74;
    this.mappedSemanticLayer.add(boxLabel);

    const low = new THREE.Vector3(...measurement.traversalAnchors.lowDeckPoint);
    const high = new THREE.Vector3(...measurement.traversalAnchors.highDeckPoint);
    const markerGeometry = new THREE.SphereGeometry(0.07, 14, 10);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: ANCHOR_REFINED_COLOR,
      depthTest: false,
    });
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([low, high]);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: ANCHOR_REFINED_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    this.ownedGeometries.add(markerGeometry);
    this.ownedGeometries.add(lineGeometry);
    this.ownedMaterials.add(markerMaterial);
    this.ownedMaterials.add(lineMaterial);

    for (const [role, point] of [
      ['low', low],
      ['high', high],
    ] as const) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.name = `debug:ramp-anchor:${role}`;
      marker.position.copy(point);
      marker.renderOrder = 75;
      this.anchorLayer.add(marker);
    }
    const ascent = new THREE.Line(lineGeometry, lineMaterial);
    ascent.name = 'debug:ramp-anchor:ascent';
    ascent.renderOrder = 74;
    this.anchorLayer.add(ascent);

    const anchorLabel = this.createLabel(
      'RAMP LOW → HIGH · TRIMESH REVIEW PENDING',
      ANCHOR_REFINED_COLOR,
    );
    anchorLabel.position.copy(high).add(new THREE.Vector3(0, 0.12, 0));
    anchorLabel.renderOrder = 76;
    this.anchorLayer.add(anchorLabel);
  }

  private createLabel(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Calibration label canvas context is unavailable');
    context.fillStyle = 'rgba(2, 8, 12, 0.86)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.font = '600 24px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillStyle = color;
    context.textBaseline = 'middle';
    context.fillText(text.toUpperCase(), 16, canvas.height / 2, canvas.width - 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = `debug:label:${text}`;
    sprite.scale.set(1.05, 0.13125, 1);
    sprite.renderOrder = 60;
    this.ownedTextures.add(texture);
    this.ownedMaterials.add(material);
    return sprite;
  }
}
