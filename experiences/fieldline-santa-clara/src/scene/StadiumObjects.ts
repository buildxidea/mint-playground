import * as THREE from "three";
import type { EventConfigId } from "../app/eventConfigs";
import {
  TIER_AISLE_SPECS,
  aisleHalfAngleRad,
  aisleTopologySummary,
  isAngleInsideTierAisle,
  isPointInsideBoardClearance,
  isSeatAnchorInsideBoardClearance,
  normalizeAngle,
  tierAisleCenters,
} from "../stadium/aisleTopology";
import type { ModeledGeometryManifest } from "../stadium/schema";
import tierLayout from "../stadium/tierLayout.v1.json";
import { MaterialLibrary } from "./MaterialLibrary";
import { applyCameraProximityFade } from "./materialEffects";

type TierSpec = {
  id: string;
  innerHalfWidth: number;
  innerHalfLength: number;
  outerHalfWidth: number;
  outerHalfLength: number;
  innerY: number;
  outerY: number;
  color: number;
  rows: number;
  skirtDepthM?: number;
  visibleSegment?: (x: number, z: number) => boolean;
};

const TIER_COLORS: Record<string, number> = {
  lower: 0x8b2032,
  club: 0x852033,
  "upper-300": 0x7d2433,
  "upper-400": 0x641d2a,
};

const TIERS: TierSpec[] = Object.entries(tierLayout.tiers).map(([id, layout]) => ({
  id,
  innerHalfWidth: layout.innerHalfWidthM,
  innerHalfLength: layout.innerHalfLengthM,
  outerHalfWidth: layout.outerHalfWidthM,
  outerHalfLength: layout.outerHalfLengthM,
  innerY: layout.innerElevationM,
  outerY: layout.outerElevationM,
  color: TIER_COLORS[id] ?? 0x8b2032,
  rows: layout.visualRowCount,
  ...(id === "upper-300"
    ? { visibleSegment: (x: number, z: number) => x > -47 || Math.abs(z) > 92 }
    : id === "upper-400"
      ? { visibleSegment: (x: number) => x > 8 }
      : {}),
}));

function superellipsePoint(
  angle: number,
  halfWidth: number,
  halfLength: number,
  exponent = tierLayout.superellipseExponent,
): THREE.Vector2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const denominator = Math.pow(
    Math.pow(Math.abs(c) / halfWidth, exponent) +
    Math.pow(Math.abs(s) / halfLength, exponent),
    1 / exponent,
  );
  const radius = denominator > 0 ? 1 / denominator : 0;
  return new THREE.Vector2(c * radius, s * radius);
}

function approximateSuperellipsePerimeter(
  halfWidth: number,
  halfLength: number,
  segments = 240,
): number {
  let perimeter = 0;
  let previous = superellipsePoint(0, halfWidth, halfLength);
  for (let index = 1; index <= segments; index += 1) {
    const current = superellipsePoint((index / segments) * Math.PI * 2, halfWidth, halfLength);
    perimeter += current.distanceTo(previous);
    previous = current;
  }
  return perimeter;
}

function segmentVisible(spec: TierSpec, a0: number, a1: number): boolean {
  if (!spec.visibleSegment) return true;
  const midpoint = superellipsePoint(
    (a0 + a1) / 2,
    spec.outerHalfWidth,
    spec.outerHalfLength,
  );
  return spec.visibleSegment(midpoint.x, midpoint.y);
}

function angularSpansForRow(
  spec: TierSpec,
  rowT: number,
  baseSegments: number,
): Array<[number, number]> {
  const halfWidth = THREE.MathUtils.lerp(spec.innerHalfWidth, spec.outerHalfWidth, rowT);
  const halfLength = THREE.MathUtils.lerp(spec.innerHalfLength, spec.outerHalfLength, rowT);
  const points = Array.from({ length: baseSegments + 1 }, (_, index) =>
    (index / baseSegments) * Math.PI * 2,
  );
  for (const center of tierAisleCenters(spec.id)) {
    const radialPoint = superellipsePoint(center, halfWidth, halfLength);
    const halfAngle = aisleHalfAngleRad(spec.id, radialPoint.length());
    points.push(normalizeAngle(center - halfAngle), normalizeAngle(center + halfAngle));
  }
  points.push(0, Math.PI * 2);
  points.sort((a, b) => a - b);
  const unique = points.filter((value, index) =>
    index === 0 || Math.abs(value - points[index - 1]!) > 1e-7,
  );
  const spans: Array<[number, number]> = [];
  for (let index = 0; index < unique.length - 1; index += 1) {
    const a0 = unique[index]!;
    const a1 = unique[index + 1]!;
    const mid = (a0 + a1) / 2;
    const point = superellipsePoint(mid, halfWidth, halfLength);
    if (isAngleInsideTierAisle(spec.id, mid, point.length())) continue;
    if (!segmentVisible(spec, a0, a1)) continue;
    spans.push([a0, a1]);
  }
  return spans;
}

function createRakedRingGeometry(spec: TierSpec, segments = 160): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const baseColor = new THREE.Color(spec.color);
  const frontColor = baseColor.clone().multiplyScalar(0.58);
  const outerColor = baseColor.clone().multiplyScalar(0.38);
  const skirtDepthM = spec.skirtDepthM ?? 1.15;

  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    if (!segmentVisible(spec, a0, a1)) continue;
    const inner0 = superellipsePoint(a0, spec.innerHalfWidth, spec.innerHalfLength);
    const inner1 = superellipsePoint(a1, spec.innerHalfWidth, spec.innerHalfLength);
    const outer0 = superellipsePoint(a0, spec.outerHalfWidth, spec.outerHalfLength);
    const outer1 = superellipsePoint(a1, spec.outerHalfWidth, spec.outerHalfLength);
    const innerSkirtY = Math.max(0, spec.innerY - skirtDepthM);
    const outerSkirtY = Math.max(0, spec.outerY - skirtDepthM);
    const n = positions.length / 3;
    positions.push(
      inner0.x, spec.innerY, inner0.y,
      outer0.x, spec.outerY, outer0.y,
      inner0.x, innerSkirtY, inner0.y,
      outer0.x, outerSkirtY, outer0.y,
      inner1.x, spec.innerY, inner1.y,
      outer1.x, spec.outerY, outer1.y,
      inner1.x, innerSkirtY, inner1.y,
      outer1.x, outerSkirtY, outer1.y,
    );
    for (let vertex = 0; vertex < 2; vertex += 1) {
      colors.push(baseColor.r, baseColor.g, baseColor.b);
      colors.push(baseColor.r * 0.9, baseColor.g * 0.9, baseColor.b * 0.9);
      colors.push(frontColor.r, frontColor.g, frontColor.b);
      colors.push(outerColor.r, outerColor.g, outerColor.b);
    }
    indices.push(
      n, n + 4, n + 1, n + 1, n + 4, n + 5,
      n + 2, n + 6, n, n, n + 6, n + 4,
      n + 1, n + 5, n + 3, n + 3, n + 5, n + 7,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSteppedTierGeometry(spec: TierSpec, segments = 80): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const seatColor = new THREE.Color(spec.color);
  const riserColor = seatColor.clone().multiplyScalar(0.52);

  const pushVertex = (point: THREE.Vector2, y: number, color: THREE.Color) => {
    positions.push(point.x, y, point.y);
    colors.push(color.r, color.g, color.b);
  };

  for (let row = 0; row < spec.rows; row += 1) {
    const t0 = row / spec.rows;
    const t1 = (row + 1) / spec.rows;
    const rowY = THREE.MathUtils.lerp(spec.innerY, spec.outerY, t0);
    const nextY = THREE.MathUtils.lerp(spec.innerY, spec.outerY, t1);
    const innerHalfWidth = THREE.MathUtils.lerp(spec.innerHalfWidth, spec.outerHalfWidth, t0);
    const innerHalfLength = THREE.MathUtils.lerp(spec.innerHalfLength, spec.outerHalfLength, t0);
    const outerHalfWidth = THREE.MathUtils.lerp(spec.innerHalfWidth, spec.outerHalfWidth, t1);
    const outerHalfLength = THREE.MathUtils.lerp(spec.innerHalfLength, spec.outerHalfLength, t1);

    for (const [a0, a1] of angularSpansForRow(spec, (t0 + t1) / 2, segments)) {
      const inner0 = superellipsePoint(a0, innerHalfWidth, innerHalfLength);
      const inner1 = superellipsePoint(a1, innerHalfWidth, innerHalfLength);
      const outer0 = superellipsePoint(a0, outerHalfWidth, outerHalfLength);
      const outer1 = superellipsePoint(a1, outerHalfWidth, outerHalfLength);
      const midAngle = (a0 + a1) / 2;
      const midPoint = superellipsePoint(
        midAngle,
        (innerHalfWidth + outerHalfWidth) / 2,
        (innerHalfLength + outerHalfLength) / 2,
      );
      const clearanceSamples: Array<[THREE.Vector2, number]> = [
        [inner0, rowY],
        [inner1, rowY],
        [outer0, rowY],
        [outer1, rowY],
        [outer0, nextY],
        [outer1, nextY],
        [midPoint, (rowY + nextY) / 2],
      ];
      if (clearanceSamples.some(([point, y]) =>
        isPointInsideBoardClearance(point.x, y, point.y)
      )) continue;
      const first = positions.length / 3;

      // One horizontal tread followed by a riser at its outer edge. Keeping the
      // first tread at innerY aligns procedural seating with modeled row eyes.
      pushVertex(inner0, rowY, seatColor);
      pushVertex(outer0, rowY, seatColor);
      pushVertex(inner1, rowY, seatColor);
      pushVertex(outer1, rowY, seatColor);
      pushVertex(outer0, nextY, riserColor);
      pushVertex(outer1, nextY, riserColor);
      indices.push(
        first, first + 2, first + 1,
        first + 1, first + 2, first + 3,
        first + 1, first + 3, first + 4,
        first + 4, first + 3, first + 5,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSteppedAisleGeometry(spec: TierSpec): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const treadColor = new THREE.Color(0xb4b2a9);
  const riserColor = new THREE.Color(0x77776f);
  const widthM = TIER_AISLE_SPECS[spec.id]?.widthM ?? 1.1;

  const pushVertex = (point: THREE.Vector3, color: THREE.Color) => {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
  };

  const edgePoints = (
    angle: number,
    halfWidth: number,
    halfLength: number,
    y: number,
  ): [THREE.Vector3, THREE.Vector3] => {
    const center = superellipsePoint(angle, halfWidth, halfLength);
    const before = superellipsePoint(angle - 0.0005, halfWidth, halfLength);
    const after = superellipsePoint(angle + 0.0005, halfWidth, halfLength);
    const tangent = after.sub(before).normalize();
    return [
      new THREE.Vector3(
        center.x + tangent.x * widthM / 2,
        y,
        center.y + tangent.y * widthM / 2,
      ),
      new THREE.Vector3(
        center.x - tangent.x * widthM / 2,
        y,
        center.y - tangent.y * widthM / 2,
      ),
    ];
  };

  for (const angle of tierAisleCenters(spec.id)) {
    if (!segmentVisible(spec, angle - 0.001, angle + 0.001)) continue;
    for (let row = 0; row < spec.rows; row += 1) {
      const t0 = row / spec.rows;
      const t1 = (row + 1) / spec.rows;
      const rowY = THREE.MathUtils.lerp(spec.innerY, spec.outerY, t0) + 0.035;
      const nextY = THREE.MathUtils.lerp(spec.innerY, spec.outerY, t1) + 0.035;
      const innerHalfWidth = THREE.MathUtils.lerp(spec.innerHalfWidth, spec.outerHalfWidth, t0);
      const innerHalfLength = THREE.MathUtils.lerp(spec.innerHalfLength, spec.outerHalfLength, t0);
      const outerHalfWidth = THREE.MathUtils.lerp(spec.innerHalfWidth, spec.outerHalfWidth, t1);
      const outerHalfLength = THREE.MathUtils.lerp(spec.innerHalfLength, spec.outerHalfLength, t1);
      const [innerLeft, innerRight] = edgePoints(
        angle,
        innerHalfWidth,
        innerHalfLength,
        rowY,
      );
      const [outerLeft, outerRight] = edgePoints(
        angle,
        outerHalfWidth,
        outerHalfLength,
        rowY,
      );
      const midpoint = innerLeft.clone().add(outerRight).multiplyScalar(0.5);
      const clearanceSamples = [
        innerLeft,
        innerRight,
        outerLeft,
        outerRight,
        outerLeft.clone().setY(nextY),
        outerRight.clone().setY(nextY),
        midpoint.clone().setY((rowY + nextY) / 2),
      ];
      if (clearanceSamples.some((point) =>
        isPointInsideBoardClearance(point.x, point.y, point.z)
      )) {
        continue;
      }
      const first = positions.length / 3;
      pushVertex(innerLeft, treadColor);
      pushVertex(innerRight, treadColor);
      pushVertex(outerLeft, treadColor);
      pushVertex(outerRight, treadColor);
      pushVertex(outerLeft.clone().setY(nextY), riserColor);
      pushVertex(outerRight.clone().setY(nextY), riserColor);
      indices.push(
        first, first + 1, first + 2,
        first + 2, first + 1, first + 3,
        first + 2, first + 3, first + 4,
        first + 4, first + 3, first + 5,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSeatBackSilhouette(spec: TierSpec): THREE.BufferGeometry {
  const premium = spec.id === "club";
  const width = premium ? 0.56 : spec.id.startsWith("upper") ? 0.44 : 0.48;
  const height = premium ? 0.66 : spec.id.startsWith("upper") ? 0.54 : 0.58;
  const topHalfWidth = width * 0.34;
  const halfDepth = premium ? 0.06 : 0.045;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -width / 2, -height / 2, halfDepth,
    width / 2, -height / 2, halfDepth,
    -topHalfWidth, height / 2, halfDepth,
    topHalfWidth, height / 2, halfDepth,
    -width / 2, -height / 2, -halfDepth,
    width / 2, -height / 2, -halfDepth,
    -topHalfWidth, height / 2, -halfDepth,
    topHalfWidth, height / 2, -halfDepth,
  ], 3));
  geometry.setIndex([
    0, 1, 2, 2, 1, 3,
    5, 4, 7, 7, 4, 6,
    4, 0, 6, 6, 0, 2,
    1, 5, 3, 3, 5, 7,
    2, 3, 6, 6, 3, 7,
    4, 5, 0, 0, 5, 1,
  ]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createBowlObjects(
  materials: MaterialLibrary,
  options: { tierSegments?: number; seatPitchScale?: number } = {},
): THREE.Group {
  const root = new THREE.Group();
  root.name = "parametric-bowl-objects";
  root.userData = {
    coordinateBasis: "meters-y-up-east+x-south+z",
    status: "modeled-calibration-pending",
    sourceIds: ["official-2026-pricing-map"],
  };

  for (const spec of TIERS) {
    const tier = new THREE.Group();
    tier.name = `tier-${spec.id}`;
    tier.userData = { kind: "tier", tier: spec.id, status: "modeled" };
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.04,
    });
    const shellGeometry = createSteppedTierGeometry(spec, options.tierSegments ?? 80);
    shellGeometry.computeBoundsTree();
    const shell = new THREE.Mesh(shellGeometry, material);
    shell.name = `${spec.id}-raked-shell`;
    shell.castShadow = true;
    shell.receiveShadow = true;
    tier.add(shell);

    const tierAisles = new THREE.Mesh(
      createSteppedAisleGeometry(spec),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.94,
        metalness: 0,
      }),
    );
    tierAisles.name = `${spec.id}-modeled-section-aisle-objects`;
    tierAisles.userData = {
      kind: "aisles",
      tier: spec.id,
      status: "modeled-calibration-pending",
      topology: "stepped-clearance-corridors-v1",
      widthM: TIER_AISLE_SPECS[spec.id]?.widthM,
      aisleCount: TIER_AISLE_SPECS[spec.id]?.aisleCount,
      sourceIds: TIER_AISLE_SPECS[spec.id]?.sourceIds ?? ["official-2026-pricing-map"],
    };
    tierAisles.castShadow = true;
    tierAisles.receiveShadow = true;
    tier.add(tierAisles);

    const seatRecords: Array<{ point: THREE.Vector2; y: number; angle: number }> = [];
    for (let row = 0; row < spec.rows; row += 1) {
      const t = spec.rows <= 1 ? 0 : row / (spec.rows - 1);
      const halfWidth = THREE.MathUtils.lerp(spec.innerHalfWidth, spec.outerHalfWidth, t);
      const halfLength = THREE.MathUtils.lerp(spec.innerHalfLength, spec.outerHalfLength, t);
      const seatsOnRow = Math.max(
        1,
        Math.round(
          approximateSuperellipsePerimeter(halfWidth, halfLength) /
            ((spec.id.startsWith("upper") ? 0.9 : 0.82) * (options.seatPitchScale ?? 1)),
        ),
      );
      const y = THREE.MathUtils.lerp(spec.innerY, spec.outerY, t) + 0.31;
      for (let seat = 0; seat < seatsOnRow; seat += 1) {
        const angle = (seat / seatsOnRow) * Math.PI * 2;
        const span = Math.PI / seatsOnRow;
        if (!segmentVisible(spec, angle - span, angle + span)) continue;
        const point = superellipsePoint(angle, halfWidth, halfLength);
        if (isAngleInsideTierAisle(spec.id, angle, point.length(), 0.18)) continue;
        if (isSeatAnchorInsideBoardClearance(point.x, y, point.y)) continue;
        seatRecords.push({
          point,
          y,
          angle,
        });
      }
    }
    const proceduralSeatMaterial = materials.burgundy.clone();
    proceduralSeatMaterial.color.set(spec.id === "club" ? 0x651c29 : spec.color);
    proceduralSeatMaterial.roughness = spec.id === "club" ? 0.72 : 0.84;
    proceduralSeatMaterial.side = THREE.DoubleSide;
    // The panoramic seat layer is a density study, not canonical section
    // geometry. Suppress the viewer's own chair surface without removing the
    // neighboring seat context needed for a believable seated view.
    applyCameraProximityFade(proceduralSeatMaterial, 4.2);
    const proceduralSeats = new THREE.InstancedMesh(
      createSeatBackSilhouette(spec),
      proceduralSeatMaterial,
      seatRecords.length,
    );
    const seatDummy = new THREE.Object3D();
    seatRecords.forEach((record, index) => {
      seatDummy.position.set(record.point.x, record.y, record.point.y);
      seatDummy.rotation.set(0, Math.PI / 2 - record.angle, -0.08);
      seatDummy.scale.set(1, 1, 1);
      seatDummy.updateMatrix();
      proceduralSeats.setMatrixAt(index, seatDummy.matrix);
    });
    proceduralSeats.instanceMatrix.needsUpdate = true;
    proceduralSeats.name = `${spec.id}-procedural-seat-back-objects`;
    proceduralSeats.userData = {
      kind: "seat-backs",
      tier: spec.id,
      status: "modeled-calibration-pending",
      instanceCount: seatRecords.length,
      sourceIds: ["official-2026-pricing-map", "official-stadium-facts"],
    };
    tier.add(proceduralSeats);
    root.add(tier);
  }

  const perimeterColumnGeometry = new THREE.CylinderGeometry(0.62, 0.9, 25, 8);
  const perimeterColumns = new THREE.InstancedMesh(
    perimeterColumnGeometry,
    materials.concreteDark,
    28,
  );
  const dummy = new THREE.Object3D();
  for (let index = 0; index < 28; index += 1) {
    const angle = (index / 28) * Math.PI * 2;
    const point = superellipsePoint(angle, 121, 139);
    dummy.position.set(point.x, 12.5, point.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    perimeterColumns.setMatrixAt(index, dummy.matrix);
  }
  perimeterColumns.instanceMatrix.needsUpdate = true;
  perimeterColumns.name = "modeled-open-perimeter-column-objects";
  perimeterColumns.userData = {
    status: "modeled-calibration-pending",
    kind: "perimeter-structure",
    sourceIds: ["hntb-project"],
  };
  perimeterColumns.castShadow = true;
  root.add(perimeterColumns);

  const exteriorSpec: TierSpec = {
    id: "exterior",
    innerHalfWidth: 128,
    innerHalfLength: 146,
    outerHalfWidth: 133,
    outerHalfLength: 151,
    innerY: 3.4,
    outerY: 6.8,
    color: 0x242726,
    rows: 1,
    skirtDepthM: 3.2,
  };
  const concourseGeometry = createRakedRingGeometry(exteriorSpec, 160);
  const concourse = new THREE.Mesh(concourseGeometry, materials.concrete);
  concourse.name = "exterior-concourse-superellipse-object";
  concourse.castShadow = true;
  concourse.receiveShadow = true;
  root.add(concourse);

  root.userData.aisleTopology = aisleTopologySummary();

  return root;
}

export type SectionObjectResult = {
  root: THREE.Group;
  sectionObjects: Map<string, THREE.Group>;
  rowObjects: Map<string, RowObjectRef>;
};

export type RowObjectRef = {
  mesh: THREE.InstancedMesh;
  index: number;
  baseColor: THREE.Color;
};

export function createVerifiedSectionObjects(
  geometry: ModeledGeometryManifest,
  materials: MaterialLibrary,
): SectionObjectResult {
  const root = new THREE.Group();
  root.name = "verified-section-objects";
  const sectionObjects = new Map<string, THREE.Group>();
  const rowObjects = new Map<string, RowObjectRef>();

  for (const section of geometry.sections) {
    const sectionRoot = new THREE.Group();
    sectionRoot.name = `section-${section.sectionId}`;
    sectionRoot.userData = {
      kind: "section",
      sectionId: section.sectionId,
      tier: section.tier,
      status: "modeled",
    };
    const sourceMaterial = section.sectionId === "P234"
      ? materials.premium.clone()
      : materials.burgundy.clone();
    const baseColor = sourceMaterial.color.clone();
    sourceMaterial.color.set(0xffffff);
    const rowGeometry = new THREE.BoxGeometry(1, 0.16, 1);
    const rows = new THREE.InstancedMesh(
      rowGeometry,
      sourceMaterial,
      section.rowCenterlines.length,
    );
    rows.name = `section-${section.sectionId}-row-objects`;
    rows.userData = {
      kind: "row-instances",
      sectionId: section.sectionId,
      tier: section.tier,
      status: "modeled",
      rowLookup: section.rowCenterlines.map((row) => ({
        sectionId: section.sectionId,
        rowLabel: row.rowLabel,
      })),
      baseColor: baseColor.getHex(),
    };
    rows.receiveShadow = true;
    const dummy = new THREE.Object3D();
    section.rowCenterlines.forEach((row, index) => {
      dummy.position.set(row.origin[0], row.origin[1] - 0.08, row.origin[2]);
      dummy.rotation.set(0, row.yawRad, 0);
      dummy.scale.set(row.widthM, 1, section.rowTreadM * 0.9);
      dummy.updateMatrix();
      rows.setMatrixAt(index, dummy.matrix);
      rows.setColorAt(index, baseColor);
      rowObjects.set(`${section.sectionId}:${row.rowLabel}`, {
        mesh: rows,
        index,
        baseColor,
      });
    });
    rows.instanceMatrix.needsUpdate = true;
    if (rows.instanceColor) rows.instanceColor.needsUpdate = true;
    sectionRoot.add(rows);
    root.add(sectionRoot);
    sectionObjects.set(section.sectionId, sectionRoot);
  }

  return { root, sectionObjects, rowObjects };
}

function createBaseField(material: THREE.Material): THREE.Group {
  const root = new THREE.Group();
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(62, 0.24, 123),
    new THREE.MeshStandardMaterial({ color: 0x111716, roughness: 0.9 }),
  );
  // Leave a real depth separation from the playing surface to prevent long-range z-fighting.
  apron.position.y = -0.2;
  apron.receiveShadow = true;
  root.add(apron);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(48.768, 109.728), material);
  field.rotation.x = -Math.PI / 2;
  field.position.y = 0.015;
  field.name = "playing-surface";
  field.userData = { kind: "playing-surface", status: "modeled" };
  field.receiveShadow = true;
  root.add(field);
  return root;
}

function createSoccerGoals(materials: MaterialLibrary): THREE.Group {
  const root = new THREE.Group();
  const barMaterial = materials.fieldLine;
  for (const z of [-52.5, 52.5]) {
    const goal = new THREE.Group();
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), barMaterial);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.y = 2.44;
    goal.add(crossbar);
    for (const x of [-3.66, 3.66]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), barMaterial);
      post.position.set(x, 1.22, 0);
      goal.add(post);
    }
    goal.position.z = z;
    root.add(goal);
  }
  return root;
}

function createEndStage(materials: MaterialLibrary): THREE.Group {
  const root = new THREE.Group();
  root.name = "concert-end-stage-objects";
  const deck = new THREE.Mesh(new THREE.BoxGeometry(30, 2.2, 18), materials.blackenedSteel);
  deck.position.set(0, 1.1, -39);
  deck.castShadow = true;
  root.add(deck);
  const backdrop = new THREE.Mesh(new THREE.BoxGeometry(32, 18, 1.4), materials.concreteDark);
  backdrop.position.set(0, 11, -47.5);
  backdrop.castShadow = true;
  root.add(backdrop);
  for (const x of [-14, 14]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 23, 1.2), materials.blackenedSteel);
    tower.position.set(x, 11.5, -46);
    tower.castShadow = true;
    root.add(tower);
  }
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(26, 11), materials.createBoardMaterial("end stage"));
  screen.position.set(0, 12, -46.72);
  root.add(screen);
  return root;
}

function createRoundStage(materials: MaterialLibrary): THREE.Group {
  const root = new THREE.Group();
  root.name = "concert-round-stage-objects";
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(13, 14, 2, 48), materials.blackenedSteel);
  deck.position.y = 1;
  deck.castShadow = true;
  root.add(deck);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(12, 0.35, 10, 64), materials.amber);
  ring.position.y = 2.2;
  ring.rotation.x = Math.PI / 2;
  root.add(ring);
  const rig = new THREE.Mesh(new THREE.TorusGeometry(15, 0.45, 10, 64), materials.blackenedSteel);
  rig.position.y = 17;
  rig.rotation.x = Math.PI / 2;
  root.add(rig);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 15, 10), materials.blackenedSteel);
    column.position.set(Math.cos(angle) * 14, 9.5, Math.sin(angle) * 14);
    root.add(column);
  }
  return root;
}

export function createEventObjectGroups(materials: MaterialLibrary): Map<EventConfigId, THREE.Group> {
  const map = new Map<EventConfigId, THREE.Group>();
  const football = createBaseField(materials.createFieldMaterial("football"));
  football.name = "event-football-objects";
  map.set("football", football);

  const soccer = createBaseField(materials.createFieldMaterial("soccer"));
  soccer.name = "event-soccer-objects";
  soccer.add(createSoccerGoals(materials));
  map.set("soccer", soccer);

  const end = createBaseField(materials.createFieldMaterial("football"));
  end.add(createEndStage(materials));
  end.name = "event-concert-end-objects";
  map.set("concert-end", end);

  const round = createBaseField(materials.createFieldMaterial("football"));
  round.add(createRoundStage(materials));
  round.name = "event-concert-round-objects";
  map.set("concert-round", round);
  return map;
}

export function createStadiumCanopies(materials: MaterialLibrary): THREE.Group {
  const root = new THREE.Group();
  root.name = "asymmetric-stadium-structure-objects";

  const tower = new THREE.Group();
  tower.name = "modeled-west-suite-tower-object";
  tower.userData = {
    kind: "suite-tower",
    category: "suite-tower",
    status: "modeled-calibration-pending",
    sourceIds: ["official-2026-pricing-map", "hntb-project"],
  };
  tower.position.x = -103;

  const core = new THREE.Mesh(new THREE.BoxGeometry(18, 61, 110), materials.concreteDark);
  core.position.set(-10, 30.5, 0);
  core.castShadow = true;
  core.receiveShadow = true;
  tower.add(core);

  const structureDummy = new THREE.Object3D();
  // The real west tower reads as a long stack of open premium levels bounded
  // by pale end cores, not a single dark glass slab.
  const endCores = new THREE.InstancedMesh(
    new THREE.BoxGeometry(38, 61, 7.5),
    materials.concreteLight,
    2,
  );
  for (const [index, z] of [-61.5, 61.5].entries()) {
    structureDummy.position.set(-0.5, 30.5, z);
    structureDummy.rotation.set(0, 0, 0);
    structureDummy.scale.set(1, 1, 1);
    structureDummy.updateMatrix();
    endCores.setMatrixAt(index, structureDummy.matrix);
  }
  endCores.instanceMatrix.needsUpdate = true;
  endCores.name = "west-suite-pale-end-core-objects";
  endCores.castShadow = true;
  endCores.receiveShadow = true;
  tower.add(endCores);

  const slabHeights = [9, 18, 27, 36, 45, 54, 63];
  const slabs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(31, 0.85, 125),
    materials.concreteLight,
    slabHeights.length,
  );
  slabHeights.forEach((y, index) => {
    structureDummy.position.set(1.5, y, 0);
    structureDummy.updateMatrix();
    slabs.setMatrixAt(index, structureDummy.matrix);
  });
  slabs.instanceMatrix.needsUpdate = true;
  slabs.name = "west-suite-floor-slab-objects";
  slabs.castShadow = true;
  slabs.receiveShadow = true;
  tower.add(slabs);

  const glassLevels = [13.5, 22.5, 31.5, 40.5, 49.5, 58.5];
  const glazing = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.4, 6.7, 6.7),
    materials.glass,
    16 * glassLevels.length,
  );
  const mullions = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.7, 53, 0.5),
    materials.blackenedSteel,
    16,
  );
  let glazingIndex = 0;
  for (let bay = 0; bay < 16; bay += 1) {
    const z = -56.25 + bay * 7.5;
    for (const y of glassLevels) {
      structureDummy.position.set(17.1, y, z);
      structureDummy.updateMatrix();
      glazing.setMatrixAt(glazingIndex, structureDummy.matrix);
      glazingIndex += 1;
    }
    structureDummy.position.set(17.35, 36, z - 3.75);
    structureDummy.updateMatrix();
    mullions.setMatrixAt(bay, structureDummy.matrix);
  }
  glazing.instanceMatrix.needsUpdate = true;
  glazing.name = "west-suite-glass-bay-objects";
  mullions.instanceMatrix.needsUpdate = true;
  mullions.name = "west-suite-mullion-objects";
  tower.add(glazing, mullions);

  const suiteRecesses = new THREE.InstancedMesh(
    new THREE.BoxGeometry(3.8, 6.15, 6.35),
    materials.blackenedSteel,
    16 * glassLevels.length,
  );
  let recessIndex = 0;
  for (let bay = 0; bay < 16; bay += 1) {
    const z = -56.25 + bay * 7.5;
    for (const y of glassLevels) {
      structureDummy.position.set(14.7, y, z);
      structureDummy.rotation.set(0, 0, 0);
      structureDummy.scale.set(1, 1, 1);
      structureDummy.updateMatrix();
      suiteRecesses.setMatrixAt(recessIndex, structureDummy.matrix);
      recessIndex += 1;
    }
  }
  suiteRecesses.instanceMatrix.needsUpdate = true;
  suiteRecesses.name = "west-suite-recessed-bay-objects";
  suiteRecesses.castShadow = true;
  tower.add(suiteRecesses);

  const balconyRails = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.45, 1.05, 125),
    materials.paintedWhiteSteel,
    glassLevels.length,
  );
  glassLevels.forEach((y, index) => {
    structureDummy.position.set(18.2, y - 2.15, 0);
    structureDummy.updateMatrix();
    balconyRails.setMatrixAt(index, structureDummy.matrix);
  });
  balconyRails.instanceMatrix.needsUpdate = true;
  balconyRails.name = "west-suite-balcony-edge-objects";
  tower.add(balconyRails);

  const redEndAccents = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.75, 56, 4.8),
    materials.stadiumRed,
    2,
  );
  for (const [index, z] of [-56.8, 56.8].entries()) {
    structureDummy.position.set(18.55, 34, z);
    structureDummy.updateMatrix();
    redEndAccents.setMatrixAt(index, structureDummy.matrix);
  }
  redEndAccents.instanceMatrix.needsUpdate = true;
  redEndAccents.name = "west-suite-red-vertical-accent-objects";
  tower.add(redEndAccents);

  const towerColumnPositions = [-57, -34, -11.5, 11.5, 34, 57];
  const towerColumns = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.65, 1.05, 57, 10),
    materials.blackenedSteel,
    towerColumnPositions.length,
  );
  towerColumnPositions.forEach((z, index) => {
    structureDummy.position.set(12.5, 28.5, z);
    structureDummy.updateMatrix();
    towerColumns.setMatrixAt(index, structureDummy.matrix);
  });
  towerColumns.instanceMatrix.needsUpdate = true;
  towerColumns.name = "west-suite-column-objects";
  towerColumns.castShadow = true;
  tower.add(towerColumns);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(39, 1.2, 136), materials.blackenedSteel);
  roof.position.set(1.5, 65.5, 0);
  roof.castShadow = true;
  tower.add(roof);
  const greenRoof = new THREE.Mesh(new THREE.BoxGeometry(28, 0.32, 112), materials.greenRoof);
  greenRoof.position.set(2, 66.15, 0);
  greenRoof.name = "west-suite-green-roof-object";
  greenRoof.receiveShadow = true;
  tower.add(greenRoof);
  const roofRibs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.34, 132),
    materials.paintedWhiteSteel,
    9,
  );
  for (let index = 0; index < 9; index += 1) {
    structureDummy.position.set((index - 4) * 4, 66.25, 0);
    structureDummy.updateMatrix();
    roofRibs.setMatrixAt(index, structureDummy.matrix);
  }
  roofRibs.instanceMatrix.needsUpdate = true;
  roofRibs.name = "west-suite-roof-rib-objects";
  tower.add(roofRibs);
  root.add(tower);

  const eastStructure = new THREE.Group();
  eastStructure.name = "east-upper-deck-support-objects";
  eastStructure.userData = {
    kind: "upper-deck-support",
    status: "modeled-calibration-pending",
    sourceIds: ["official-2026-pricing-map"],
  };
  const eastColumnPositions = [-102, -76, -50, -24, 2, 28, 54, 80, 106];
  const eastColumns = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.58, 0.9, 43, 10),
    materials.blackenedSteel,
    eastColumnPositions.length,
  );
  eastColumnPositions.forEach((z, index) => {
    structureDummy.position.set(130, 21.5, z);
    structureDummy.updateMatrix();
    eastColumns.setMatrixAt(index, structureDummy.matrix);
  });
  eastColumns.instanceMatrix.needsUpdate = true;
  eastColumns.name = "east-upper-deck-column-objects";
  eastColumns.castShadow = true;
  eastStructure.add(eastColumns);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.1, 219), materials.blackenedSteel);
  spine.position.set(130, 43, 2);
  eastStructure.add(spine);

  const framePositions = [-117, -91, -65, -39, -13, 13, 39, 65, 91, 117];
  const framePosts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.1, 56, 1.1),
    materials.paintedWhiteSteel,
    framePositions.length,
  );
  const frameTops = new THREE.InstancedMesh(
    new THREE.BoxGeometry(31, 1.1, 1.1),
    materials.paintedWhiteSteel,
    framePositions.length,
  );
  const frameBraces = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    materials.paintedWhiteSteel,
    framePositions.length,
  );
  framePositions.forEach((z, index) => {
    structureDummy.position.set(134, 28, z);
    structureDummy.rotation.set(0, 0, 0);
    structureDummy.scale.set(1, 1, 1);
    structureDummy.updateMatrix();
    framePosts.setMatrixAt(index, structureDummy.matrix);

    structureDummy.position.set(119, 56.5, z);
    structureDummy.updateMatrix();
    frameTops.setMatrixAt(index, structureDummy.matrix);

    structureDummy.position.set(119.5, 32, z);
    structureDummy.rotation.z = 0.512;
    structureDummy.scale.set(0.9, 55, 0.9);
    structureDummy.updateMatrix();
    frameBraces.setMatrixAt(index, structureDummy.matrix);
  });
  for (const [object, name] of [
    [framePosts, "east-upper-deck-white-frame-post-objects"],
    [frameTops, "east-upper-deck-white-frame-top-objects"],
    [frameBraces, "east-upper-deck-white-frame-brace-objects"],
  ] as const) {
    object.instanceMatrix.needsUpdate = true;
    object.name = name;
    object.castShadow = true;
    eastStructure.add(object);
  }
  root.add(eastStructure);
  for (const end of ["north", "south"] as const) {
    root.add(createEndBoardSupportObjects(materials, end));
  }
  root.add(createExteriorIdentitySign(materials));
  return root;
}

function createExteriorIdentitySign(materials: MaterialLibrary): THREE.Group {
  const group = new THREE.Group();
  group.name = "north-gate-a-levis-stadium-sign-object";
  group.position.set(-47.5, 44.5, -143.8);
  group.userData = {
    kind: "exterior-identity-sign",
    status: "modeled-calibration-pending",
    placement: "north-entry-gate-a",
    sourceIds: ["official-2024-upgrade-announcement", "official-stadium-facts"],
    assetPolicy: "original-procedural-word-sign; no third-party image redistributed",
  };

  const pylon = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 19, 2.2),
    materials.paintedWhiteSteel,
  );
  pylon.position.y = -8.5;
  pylon.castShadow = true;
  group.add(pylon);

  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(17.2, 9.2, 0.72),
    materials.concreteLight,
  );
  backing.castShadow = true;
  group.add(backing);

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 560;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#f4f0e7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.beginPath();
      context.moveTo(120, 72);
      context.lineTo(904, 72);
      context.lineTo(862, 310);
      context.quadraticCurveTo(820, 356, 754, 356);
      context.lineTo(270, 356);
      context.quadraticCurveTo(204, 356, 162, 310);
      context.closePath();
      context.fillStyle = "#c91f36";
      context.fill();
      context.fillStyle = "#ffffff";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "800 164px Arial, Helvetica, sans-serif";
      context.fillText("Levi's®", 512, 215);
      context.fillStyle = "#202522";
      context.font = "700 92px Arial, Helvetica, sans-serif";
      context.letterSpacing = "18px";
      context.fillText("STADIUM", 522, 455);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(16.6, 8.65),
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.72,
          metalness: 0.02,
          emissive: new THREE.Color(0x2a080d),
          emissiveIntensity: 0.08,
        }),
      );
      face.position.z = -0.37;
      face.rotation.y = Math.PI;
      face.name = "procedural-levis-stadium-word-sign-face";
      face.userData = {
        kind: "logo-sign-face",
        source: "original-procedural-canvas",
      };
      group.add(face);
    }
  }

  return group;
}

function setBeamMatrix(
  object: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
  thicknessM: number,
): void {
  const direction = end.clone().sub(start);
  const length = direction.length();
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  object.scale.set(thicknessM, length, thicknessM);
  object.updateMatrix();
}

function createEndBoardSupportObjects(
  materials: MaterialLibrary,
  end: "north" | "south",
): THREE.Group {
  const group = new THREE.Group();
  const sign = end === "north" ? -1 : 1;
  const z = sign * 114.5;
  group.name = `${end}-open-end-architectural-support-objects`;
  group.userData = {
    kind: "board-support-and-open-end",
    boardClearanceExemption: "edge-and-below-screen-supports-only",
    status: "modeled-calibration-pending",
    sourceIds: ["hntb-project", "official-2025-whats-new"],
    note: "Support rhythm is architect-reference-derived; current 2025 board dimensions are official while center elevation and housing remain modeled.",
  };

  const beamPairs: Array<[THREE.Vector3, THREE.Vector3, number]> = [];
  // Keep structural members outside the screen aperture. Earlier diagonal
  // members crossed behind the visible board face and made the open ends read
  // as filled-in seating/structure.
  for (const x of [-41.8, 41.8]) {
    beamPairs.push([
      new THREE.Vector3(x, 0, z + sign * 2),
      new THREE.Vector3(x, 56, z),
      1.15,
    ]);
  }
  beamPairs.push(
    [new THREE.Vector3(-45, 55.7, z), new THREE.Vector3(45, 55.7, z), 1.25],
    [new THREE.Vector3(-43, 31.6, z), new THREE.Vector3(43, 31.6, z), 1.2],
    [new THREE.Vector3(-49, 5, z), new THREE.Vector3(-42.2, 31, z), 0.85],
    [new THREE.Vector3(49, 5, z), new THREE.Vector3(42.2, 31, z), 0.85],
  );
  const beams = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    materials.paintedWhiteSteel,
    beamPairs.length,
  );
  const dummy = new THREE.Object3D();
  beamPairs.forEach(([start, finish, thickness], index) => {
    setBeamMatrix(dummy, start, finish, thickness);
    beams.setMatrixAt(index, dummy.matrix);
  });
  beams.instanceMatrix.needsUpdate = true;
  beams.name = `${end}-board-white-frame-objects`;
  beams.castShadow = true;
  group.add(beams);

  const redDeck = new THREE.Mesh(
    new THREE.BoxGeometry(76, 3.2, 7.5),
    materials.stadiumRed,
  );
  redDeck.position.set(0, 22.5, z + sign * 0.7);
  redDeck.name = `${end}-board-red-deck-object`;
  redDeck.castShadow = true;
  group.add(redDeck);

  const concourse = new THREE.Mesh(
    new THREE.BoxGeometry(104, 1.2, 19),
    materials.concreteLight,
  );
  concourse.position.set(0, 5.2, z + sign * 19);
  concourse.name = `${end}-entry-concourse-object`;
  concourse.receiveShadow = true;
  group.add(concourse);

  const stairs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    materials.concreteLight,
    2,
  );
  for (const [index, x] of [-39, 39].entries()) {
    setBeamMatrix(
      dummy,
      new THREE.Vector3(x * 1.22, 1.2, z + sign * 25),
      new THREE.Vector3(x, 20.4, z + sign * 4),
      5.2,
    );
    stairs.setMatrixAt(index, dummy.matrix);
  }
  stairs.instanceMatrix.needsUpdate = true;
  stairs.name = `${end}-open-end-stair-ramp-objects`;
  stairs.castShadow = true;
  stairs.receiveShadow = true;
  group.add(stairs);

  return group;
}
