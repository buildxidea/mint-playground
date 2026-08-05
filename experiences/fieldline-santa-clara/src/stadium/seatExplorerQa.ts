import * as THREE from "three";
import {
  SEAT_PERSPECTIVES,
  createSeatOccupantEye,
  seatedBasis,
  type SeatPerspectiveId,
} from "../camera/seatOccupantRig";
import { focusTargetPosition, type FocusTarget } from "./sightlineEngine";
import { isAngleInsideTierAisle, isPointInsideBoardClearance } from "./aisleTopology";
import type { ModeledGeometryManifest } from "./schema";
import type { ExplorerRow, ExplorerSeatAnchor, SeatExplorerCatalog } from "./seatExplorerCatalog";

type ExplorerViewAnchor = ExplorerRow | ExplorerSeatAnchor;

const FOCUS_BY_PERSPECTIVE: Partial<Record<SeatPerspectiveId, FocusTarget>> = {
  midfield: "midfield",
  "near-goal": "near-goal",
  "far-goal": "far-goal",
  "north-board": "north-board",
  "south-board": "south-board",
};

function anchorTarget(
  anchor: ExplorerViewAnchor,
  eye: THREE.Vector3,
  perspective: SeatPerspectiveId,
  geometry: ModeledGeometryManifest,
): THREE.Vector3 {
  const focus = FOCUS_BY_PERSPECTIVE[perspective];
  if (focus) {
    const target = focusTargetPosition(focus, geometry);
    target.y = Math.max(target.y, 1.5);
    return target;
  }

  const basis = seatedBasis(anchor.yawRad);
  const direction = basis.forward.clone();
  if (perspective === "left-context") {
    direction.applyAxisAngle(basis.up, Math.PI / 2);
  } else if (perspective === "right-context") {
    direction.applyAxisAngle(basis.up, -Math.PI / 2);
  }
  const target = eye.clone().addScaledVector(direction, 40);
  target.y = eye.y - 2.2;
  return target;
}

export type SeatExplorerViewMatrixAudit = {
  anchorCount: number;
  perspectiveCount: number;
  testedViewStates: number;
  invalidAnchorCount: number;
  invalidViewStateCount: number;
  invalidAnchorIds: string[];
  invalidViewStateIds: string[];
  chairObjectsAudited: number;
  seatCorridorIntersections: number;
  boardClearanceSeatIntrusions: number;
  perspectiveIdsUnique: boolean;
  expectedViewStates: number;
  pass: boolean;
};

/**
 * Exhaustively validates the camera inputs for every row/chair anchor and all
 * eight supported perspectives. It intentionally avoids rendering half a
 * million frames; visual sampling is handled separately by browser QA.
 */
export function auditSeatExplorerViewMatrix(
  catalog: SeatExplorerCatalog,
  geometry: ModeledGeometryManifest,
): SeatExplorerViewMatrixAudit {
  const anchors = catalog.sections.flatMap((section) => section.rows.flatMap((row) => [
    row,
    ...row.seats,
  ]));
  const perspectiveIds = SEAT_PERSPECTIVES.map((perspective) => perspective.id);
  const chairObjects = catalog.sections.flatMap((section) =>
    section.rows.flatMap((row) => row.seats)
  );
  const perspectiveIdsUnique = new Set(perspectiveIds).size === perspectiveIds.length;
  const invalidAnchorIds: string[] = [];
  const invalidViewStateIds: string[] = [];
  let invalidAnchorCount = 0;
  let invalidViewStateCount = 0;
  let testedViewStates = 0;

  for (const anchor of anchors) {
    const surface = new THREE.Vector3(...anchor.position);
    const anchorValid = surface.toArray().every(Number.isFinite) &&
      Number.isFinite(anchor.yawRad) &&
      surface.y >= 0;
    if (!anchorValid) {
      invalidAnchorCount += 1;
      if (invalidAnchorIds.length < 25) invalidAnchorIds.push(anchor.id);
    }
    const eye = createSeatOccupantEye(surface, anchor.yawRad, geometry.eyeHeightM.value);
    for (const perspective of perspectiveIds) {
      testedViewStates += 1;
      const target = anchorTarget(anchor, eye, perspective, geometry);
      const direction = target.clone().sub(eye);
      const valid = anchorValid &&
        eye.toArray().every(Number.isFinite) &&
        target.toArray().every(Number.isFinite) &&
        direction.lengthSq() > 1e-6;
      if (!valid) {
        invalidViewStateCount += 1;
        if (invalidViewStateIds.length < 25) {
          invalidViewStateIds.push(`${anchor.id}@${perspective}`);
        }
      }
    }
  }

  const expectedViewStates = anchors.length * perspectiveIds.length;
  let seatCorridorIntersections = 0;
  let boardClearanceSeatIntrusions = 0;
  for (const chair of chairObjects) {
    const [x, y, z] = chair.position;
    if (isAngleInsideTierAisle(
      chair.tier,
      Math.atan2(z, x),
      Math.hypot(x, z),
      0.1,
    )) seatCorridorIntersections += 1;
    if (isPointInsideBoardClearance(x, y, z, 0.16)) {
      boardClearanceSeatIntrusions += 1;
    }
  }
  return {
    anchorCount: anchors.length,
    perspectiveCount: perspectiveIds.length,
    testedViewStates,
    invalidAnchorCount,
    invalidViewStateCount,
    invalidAnchorIds,
    invalidViewStateIds,
    chairObjectsAudited: chairObjects.length,
    seatCorridorIntersections,
    boardClearanceSeatIntrusions,
    perspectiveIdsUnique,
    expectedViewStates,
    pass:
      anchors.length === catalog.coverage.totalSelectableAnchors &&
      perspectiveIds.length === catalog.coverage.perspectivesPerAnchor &&
      testedViewStates === expectedViewStates &&
      expectedViewStates === catalog.coverage.derivedPerspectives &&
      perspectiveIdsUnique &&
      invalidAnchorCount === 0 &&
      invalidViewStateCount === 0 &&
      chairObjects.length === catalog.coverage.selectableChairPositions &&
      seatCorridorIntersections === 0 &&
      boardClearanceSeatIntrusions === 0,
  };
}
