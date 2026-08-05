import * as THREE from "three";
import type { ModeledGeometryManifest, VerifiedMvpData } from "./schema";

export type SeatInstance = {
  sectionId: string;
  rowLabel: string;
  seatNumber: number;
  position: THREE.Vector3;
  yawRad: number;
  selectable: boolean;
  isAdaPlatform: boolean;
};

export type RowPreviewInstance = {
  sectionId: string;
  rowLabel: string;
  position: THREE.Vector3;
  yawRad: number;
  isAda: boolean;
  selectable: boolean;
};

export function buildSeatInstances(
  data: VerifiedMvpData,
  geometry: ModeledGeometryManifest,
  options: { includeDevDensitySamples?: boolean } = {},
): {
  seats: SeatInstance[];
  rowPreviews: RowPreviewInstance[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const seats: SeatInstance[] = [];
  const rowPreviews: RowPreviewInstance[] = [];

  for (const section of data.sections) {
    const geom = geometry.sections.find((s) => s.sectionId === section.sectionId);
    if (!geom) {
      warnings.push(`Missing modeled geometry for section ${section.sectionId}`);
      continue;
    }

    for (const row of section.rows) {
      const centerline = geom.rowCenterlines.find((r) => r.rowLabel === row.rowLabel);
      if (!centerline) {
        warnings.push(`Missing row centerline ${section.sectionId} ${row.rowLabel}`);
        continue;
      }

      rowPreviews.push({
        sectionId: section.sectionId,
        rowLabel: row.rowLabel,
        position: new THREE.Vector3(...centerline.origin),
        yawRad: centerline.yawRad,
        isAda: row.isAda,
        selectable: true,
      });
    }

    if (section.seatCountVerified) {
      for (const seat of geom.seats) {
        seats.push({
          sectionId: section.sectionId,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          position: new THREE.Vector3(...seat.position),
          yawRad: seat.yawRad,
          selectable: true,
          isAdaPlatform: false,
        });
      }
    } else {
      warnings.push(
        `Section ${section.sectionId}: individual seat count not yet verified — row-center previews only.`,
      );
      if (options.includeDevDensitySamples && import.meta.env.DEV) {
        // Anonymous development-only samples — never selectable / never production IDs.
        for (const centerline of geom.rowCenterlines) {
          for (let i = 0; i < 8; i++) {
            const offset = (i - 3.5) * 0.55;
            const rightX = -Math.cos(centerline.yawRad);
            const rightZ = Math.sin(centerline.yawRad);
            seats.push({
              sectionId: section.sectionId,
              rowLabel: centerline.rowLabel,
              seatNumber: -1 - i,
              position: new THREE.Vector3(
                centerline.origin[0] + rightX * offset,
                centerline.origin[1],
                centerline.origin[2] + rightZ * offset,
              ),
              yawRad: centerline.yawRad,
              selectable: false,
              isAdaPlatform: false,
            });
          }
        }
      }
    }
  }

  return { seats, rowPreviews, warnings };
}

export function createSeatInstancedMesh(
  seats: SeatInstance[],
  material: THREE.Material,
): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(0.45, 0.42, 0.48);
  geo.translate(0, 0.21, 0);
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(seats.length, 1));
  const dummy = new THREE.Object3D();
  let count = 0;
  for (const seat of seats) {
    if (!seat.selectable && seat.seatNumber < 0) continue; // skip anon samples in production mesh path
    dummy.position.copy(seat.position);
    dummy.rotation.set(0, seat.yawRad, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(count, dummy.matrix);
    count++;
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createAdaPlatformMeshes(
  rowPreviews: RowPreviewInstance[],
  material: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(1.6, 0.12, 1.2);
  for (const row of rowPreviews) {
    if (!row.isAda) continue;
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(row.position);
    mesh.position.y += 0.06;
    mesh.rotation.y = row.yawRad;
    mesh.userData = {
      kind: "ada-platform",
      sectionId: row.sectionId,
      rowLabel: row.rowLabel,
    };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function assertP234SeatInvariants(seats: SeatInstance[]): void {
  const p234 = seats.filter((s) => s.sectionId === "P234" && s.selectable);
  if (p234.length !== 260) {
    throw new Error(`P234 must produce 260 selectable seats, got ${p234.length}`);
  }
  const rows = new Set(p234.map((s) => s.rowLabel));
  if (rows.size !== 13) {
    throw new Error(`P234 must have 13 rows, got ${rows.size}`);
  }
  for (const row of rows) {
    const nums = p234
      .filter((s) => s.rowLabel === row)
      .map((s) => s.seatNumber)
      .sort((a, b) => a - b);
    if (nums.length !== 20 || nums[0] !== 1 || nums[19] !== 20) {
      throw new Error(`P234 row ${row} must contain seats 1–20`);
    }
  }
}
