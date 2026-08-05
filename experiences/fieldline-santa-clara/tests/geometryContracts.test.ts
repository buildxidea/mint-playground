import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MaterialLibrary } from "../src/scene/MaterialLibrary";
import { createBowlObjects } from "../src/scene/StadiumObjects";
import { configureBvhRaycasting } from "../src/scene/configureBvh";
import { goalpostYawForEndZone } from "../src/scene/loadMintAssets";
import {
  BOARD_CLEARANCE_VOLUMES,
  TIER_AISLE_SPECS,
  aisleTopologySummary,
  isAngleInsideTierAisle,
  isPointInsideBoardClearance,
} from "../src/stadium/aisleTopology";
import { generateModeledGeometry } from "../src/stadium/generateSectionGeometry";
import { validateVerifiedData } from "../src/stadium/loadVenueData";
import { buildViewInventory } from "../src/stadium/viewInventory";

const root = resolve(import.meta.dirname, "..");
configureBvhRaycasting();
const data = validateVerifiedData(JSON.parse(readFileSync(
  resolve(root, "public/data/levis_stadium_verified_mvp_data.json"),
  "utf8",
)));
const geometry = generateModeledGeometry(data);

describe("goalpost orientation contract", () => {
  it.each([54.5, -54.5])(
    "faces the goal at z=%s toward midfield while its crossbar spans world X",
    (zM) => {
      const yaw = goalpostYawForEndZone(zM);
      const towardUprights = new THREE.Vector3(1, 0, 0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const crossbar = new THREE.Vector3(0, 0, 1)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

      expect(towardUprights.z).toBeCloseTo(-Math.sign(zM));
      expect(towardUprights.x).toBeCloseTo(0);
      expect(Math.abs(crossbar.x)).toBeCloseTo(1);
      expect(crossbar.z).toBeCloseTo(0);
    },
  );
});

describe("aisle and board-clearance object contracts", () => {
  const bowl = createBowlObjects(new MaterialLibrary(), {
    tierSegments: 80,
    seatPitchScale: 1,
  });

  it("uses one stepped aisle system and removes the obsolete floating radial overlay", () => {
    expect(bowl.getObjectByName("modeled-aisle-radials")).toBeUndefined();
    const summary = aisleTopologySummary();
    expect(summary.corridorCount).toBe(98);
    for (const [tierId, spec] of Object.entries(TIER_AISLE_SPECS)) {
      const aisle = bowl.getObjectByName(`${tierId}-modeled-section-aisle-objects`) as THREE.Mesh;
      expect(aisle).toBeDefined();
      expect(aisle.userData.topology).toBe("stepped-clearance-corridors-v1");
      expect(aisle.userData.aisleCount).toBe(spec.aisleCount);
      expect(aisle.userData.widthM).toBe(spec.widthM);
      expect(aisle.geometry.getAttribute("position").count).toBeGreaterThan(spec.aisleCount * 8);
    }
  });

  it("carves every procedural seat center out of aisle corridors", () => {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    let auditedSeatCount = 0;
    const aisleIntrusions: Array<{
      tierId: string;
      instanceIndex: number;
      position: number[];
    }> = [];
    const boardIntrusions: Array<{
      tierId: string;
      instanceIndex: number;
      position: number[];
      volumeId: string;
    }> = [];
    for (const tierId of Object.keys(TIER_AISLE_SPECS)) {
      const seats = bowl.getObjectByName(`${tierId}-procedural-seat-back-objects`) as THREE.InstancedMesh;
      expect(seats).toBeDefined();
      for (let index = 0; index < seats.count; index += 1) {
        seats.getMatrixAt(index, matrix);
        position.setFromMatrixPosition(matrix);
        const angle = Math.atan2(position.z, position.x);
        const radius = Math.hypot(position.x, position.z);
        auditedSeatCount += 1;
        if (
          aisleIntrusions.length === 0 &&
          isAngleInsideTierAisle(tierId, angle, radius, 0.12)
        ) {
          aisleIntrusions.push({
            tierId,
            instanceIndex: index,
            position: position.toArray(),
          });
        }
        const boardIntrusion = isPointInsideBoardClearance(
          position.x,
          position.y,
          position.z,
          0.08,
        );
        if (boardIntrusions.length === 0 && boardIntrusion) {
          boardIntrusions.push({
            tierId,
            instanceIndex: index,
            position: position.toArray(),
            volumeId: boardIntrusion.id,
          });
        }
      }
    }
    expect(auditedSeatCount).toBeGreaterThan(0);
    expect({ aisleIntrusions, boardIntrusions }).toEqual({
      aisleIntrusions: [],
      boardIntrusions: [],
    });
  });

  it("leaves no bowl vertex inside the strict board-clearance interior", () => {
    let auditedVertexCount = 0;
    const boardIntrusions: Array<{
      objectName: string;
      vertexIndex: number;
      position: number[];
      volumeId: string;
    }> = [];
    bowl.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      if (!object.name.endsWith("raked-shell") &&
          !object.name.endsWith("modeled-section-aisle-objects")) return;
      const mesh = object as THREE.Mesh;
      const positions = mesh.geometry.getAttribute("position");
      for (let index = 0; index < positions.count; index += 1) {
        auditedVertexCount += 1;
        const x = positions.getX(index);
        const y = positions.getY(index);
        const z = positions.getZ(index);
        const boardIntrusion = isPointInsideBoardClearance(
          x,
          y,
          z,
          0.14,
        );
        if (boardIntrusions.length === 0 && boardIntrusion) {
          boardIntrusions.push({
            objectName: object.name,
            vertexIndex: index,
            position: [x, y, z],
            volumeId: boardIntrusion.id,
          });
        }
      }
    });
    expect(auditedVertexCount).toBeGreaterThan(0);
    expect(boardIntrusions).toEqual([]);
  });

  it("keeps every transformed procedural chair completely outside both scoreboard prisms", () => {
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const worldBounds = new THREE.Box3();
    const clearanceBoxes = BOARD_CLEARANCE_VOLUMES.map((volume) =>
      new THREE.Box3(
        new THREE.Vector3(...volume.min),
        new THREE.Vector3(...volume.max),
      ),
    );
    let auditedChairCount = 0;
    const missingLocalBounds: string[] = [];
    const boardIntersections: Array<{
      objectName: string;
      instanceIndex: number;
      volumeId: string;
      min: number[];
      max: number[];
    }> = [];
    bowl.updateMatrixWorld(true);
    bowl.traverse((object) => {
      const seats = object as THREE.InstancedMesh;
      if (!seats.isInstancedMesh || object.userData.kind !== "seat-backs") return;
      seats.geometry.computeBoundingBox();
      const localBounds = seats.geometry.boundingBox;
      if (!localBounds) {
        missingLocalBounds.push(object.name);
        return;
      }
      for (let index = 0; index < seats.count; index += 1) {
        seats.getMatrixAt(index, instanceMatrix);
        worldMatrix.multiplyMatrices(seats.matrixWorld, instanceMatrix);
        worldBounds.copy(localBounds).applyMatrix4(worldMatrix);
        auditedChairCount += 1;
        const clearanceIndex = clearanceBoxes.findIndex((clearance) =>
          clearance.intersectsBox(worldBounds));
        if (boardIntersections.length === 0 && clearanceIndex !== -1) {
          boardIntersections.push({
            objectName: object.name,
            instanceIndex: index,
            volumeId: BOARD_CLEARANCE_VOLUMES[clearanceIndex].id,
            min: worldBounds.min.toArray(),
            max: worldBounds.max.toArray(),
          });
        }
      }
    });
    expect(auditedChairCount).toBeGreaterThan(0);
    expect({ missingLocalBounds, boardIntersections }).toEqual({
      missingLocalBounds: [],
      boardIntersections: [],
    });
  });
});

describe("complete supported-view inventory", () => {
  const inventory = buildViewInventory(data, geometry);

  it("enumerates every supported row center and exact supplied seat", () => {
    expect(inventory.coverage).toMatchObject({
      exactSeatViews: 260,
      rowCenterViews: 318,
      uniqueSupportedViews: 578,
      perspectivesPerAnchor: 8,
      derivedSeatPerspectives: 4624,
      eventVariants: 2312,
      eventPerspectiveVariants: 18496,
    });
    expect(new Set(inventory.views.map((view) => view.id)).size).toBe(578);
  });

  it("keeps unsupported classes explicit instead of inventing views", () => {
    expect(inventory.unsupported.length).toBeGreaterThanOrEqual(4);
    expect(inventory.unsupported.every((entry) => entry.status === "unknown-do-not-infer"))
      .toBe(true);
    expect(inventory.views.every((view) => view.placementStatus === "modeled-calibration-pending"))
      .toBe(true);
  });
});
