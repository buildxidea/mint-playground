import * as THREE from "three";
import type {
  ExplorerRow,
  ExplorerSeatAnchor,
  SeatExplorerCatalog,
} from "../stadium/seatExplorerCatalog";
import type { OfficialSectionTier } from "../stadium/officialSectionTopology";

export type ExplorerPickedSelection = {
  anchorId?: string;
  sectionId: string;
  rowLabel?: string;
  seatNumber?: number;
  positionIndex?: number;
};

type SeatRef = {
  mesh: THREE.InstancedMesh;
  index: number;
  anchor: ExplorerSeatAnchor;
  baseColor: THREE.Color;
};

type RowRef = {
  mesh: THREE.InstancedMesh;
  index: number;
  row: ExplorerRow;
  baseColor: THREE.Color;
};

const TIERS: OfficialSectionTier[] = ["lower", "club", "upper-300", "upper-400"];
const TIER_COLORS: Record<OfficialSectionTier, number> = {
  lower: 0x8e2f42,
  club: 0x662937,
  "upper-300": 0x9a394b,
  "upper-400": 0x7e2939,
};

function seatMatrix(anchor: ExplorerSeatAnchor, target: THREE.Object3D): void {
  const forward = new THREE.Vector3(Math.sin(anchor.yawRad), 0, Math.cos(anchor.yawRad));
  target.position.fromArray(anchor.position).addScaledVector(forward, -0.18);
  target.position.y += 0.3;
  target.rotation.set(-0.07, anchor.yawRad, 0);
  target.scale.set(1, 1, 1);
  target.updateMatrix();
}

function rowMatrix(row: ExplorerRow, target: THREE.Object3D): void {
  target.position.fromArray(row.position);
  target.position.y -= 0.055;
  target.rotation.set(0, row.yawRad, 0);
  target.scale.set(row.widthM, 1, row.tier === "club" ? 0.76 : 0.7);
  target.updateMatrix();
}

export class SeatExplorerObjects {
  readonly root = new THREE.Group();
  readonly pickMesh: THREE.InstancedMesh;
  readonly rowPickMeshes: THREE.InstancedMesh[] = [];
  private readonly seatRefs = new Map<string, SeatRef>();
  private readonly rowRefs = new Map<string, RowRef>();
  private readonly seatsBySection = new Map<string, ExplorerSeatAnchor[]>();
  private readonly rowsBySection = new Map<string, ExplorerRow[]>();
  private selectedSectionId: string | null = null;
  private selectedRowLabel: string | null = null;
  private selectedAnchorId: string | null = null;
  private readonly catalog: SeatExplorerCatalog;

  constructor(
    catalog: SeatExplorerCatalog,
    options: { mobileQuality?: boolean } = {},
  ) {
    this.catalog = catalog;
    this.root.name = "complete-seat-explorer-objects";
    // A double-sided authored seat-back card keeps all 62k+ chair positions
    // individually legible while reserving detailed geometry for the active
    // row/seated context. This is the far/overview LOD, not the hero chair.
    const seatGeometry = options.mobileQuality
      ? new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.22, -0.29, 0),
        new THREE.Vector3(0.22, -0.29, 0),
        new THREE.Vector3(0, 0.29, 0),
      ])
      : new THREE.PlaneGeometry(0.44, 0.58);
    seatGeometry.computeVertexNormals();
    const rowGeometry = new THREE.BoxGeometry(1, 0.11, 1);
    const dummy = new THREE.Object3D();

    for (const tier of TIERS) {
      const tierRows = catalog.sections
        .filter((section) => section.tier === tier)
        .flatMap((section) => section.rows);
      const tierSeats = tierRows.flatMap((row) => row.seats);
      const rowMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.94,
        metalness: 0,
      });
      // Keep row surfaces raycastable on mobile, but let the lower-cost bowl
      // shell carry the visible tread geometry.
      rowMaterial.visible = !options.mobileQuality;
      const rows = new THREE.InstancedMesh(rowGeometry, rowMaterial, Math.max(tierRows.length, 1));
      rows.name = `${tier}-complete-row-surfaces`;
      rows.userData = {
        kind: "explorer-row-instances",
        tier,
        status: "modeled-calibration-pending",
        rowLookup: tierRows.map((row) => ({
          anchorId: row.id,
          sectionId: row.sectionId,
          rowLabel: row.rowLabel,
        } satisfies ExplorerPickedSelection)),
      };
      tierRows.forEach((row, index) => {
        rowMatrix(row, dummy);
        rows.setMatrixAt(index, dummy.matrix);
        const baseColor = new THREE.Color(TIER_COLORS[tier]).multiplyScalar(0.62);
        rows.setColorAt(index, baseColor);
        this.rowRefs.set(row.id, { mesh: rows, index, row, baseColor });
      });
      rows.count = tierRows.length;
      rows.instanceMatrix.needsUpdate = true;
      if (rows.instanceColor) rows.instanceColor.needsUpdate = true;
      rows.receiveShadow = true;
      rows.frustumCulled = false;
      this.root.add(rows);
      this.rowPickMeshes.push(rows);

      const seatMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const seats = new THREE.InstancedMesh(seatGeometry, seatMaterial, Math.max(tierSeats.length, 1));
      seats.name = `${tier}-complete-seat-objects`;
      seats.userData = {
        kind: "explorer-seat-instances",
        tier,
        status: "modeled-calibration-pending",
        seatLookup: tierSeats.map((seat) => ({
          anchorId: seat.id,
          sectionId: seat.sectionId,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber ?? undefined,
          positionIndex: seat.positionIndex,
        } satisfies ExplorerPickedSelection)),
      };
      tierSeats.forEach((seat, index) => {
        seatMatrix(seat, dummy);
        seats.setMatrixAt(index, dummy.matrix);
        const baseColor = new THREE.Color(
          seat.identifierStatus === "provided-source" ? 0x542832 : TIER_COLORS[tier],
        );
        seats.setColorAt(index, baseColor);
        this.seatRefs.set(seat.id, { mesh: seats, index, anchor: seat, baseColor });
      });
      seats.count = tierSeats.length;
      seats.instanceMatrix.needsUpdate = true;
      if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
      seats.castShadow = false;
      seats.receiveShadow = false;
      seats.frustumCulled = false;
      this.root.add(seats);
    }

    for (const section of catalog.sections) {
      this.rowsBySection.set(section.sectionId, section.rows);
      this.seatsBySection.set(section.sectionId, section.rows.flatMap((row) => row.seats));
    }

    const maxSectionSeats = Math.max(
      1,
      ...[...this.seatsBySection.values()].map((seats) => seats.length),
    );
    const pickMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      colorWrite: false,
    });
    this.pickMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.62, 0.82, 0.5),
      pickMaterial,
      maxSectionSeats,
    );
    this.pickMesh.name = "active-section-seat-pick-objects";
    this.pickMesh.count = 0;
    this.pickMesh.frustumCulled = false;
    this.pickMesh.userData = {
      kind: "explorer-seat-pick",
      seatLookup: [],
    };
    this.root.add(this.pickMesh);
  }

  setSelection(
    sectionId: string,
    rowLabel: string | null,
    positionIndex: number | null,
  ): void {
    const dirtySections = new Set(
      [this.selectedSectionId, sectionId].filter((id): id is string => Boolean(id)),
    );
    this.selectedSectionId = sectionId;
    this.selectedRowLabel = rowLabel;
    this.selectedAnchorId = rowLabel && positionIndex != null
      ? this.catalog.sections
        .find((section) => section.sectionId === sectionId)
        ?.rows.find((row) => row.rowLabel === rowLabel)
        ?.seats.find((seat) => seat.positionIndex === positionIndex)?.id ?? null
      : null;

    for (const dirtySectionId of dirtySections) this.refreshSectionColors(dirtySectionId);
    this.refreshPickMesh();
  }

  private refreshSectionColors(sectionId: string): void {
    for (const row of this.rowsBySection.get(sectionId) ?? []) {
      const ref = this.rowRefs.get(row.id);
      if (!ref) continue;
      const color = ref.baseColor.clone();
      if (sectionId === this.selectedSectionId) color.lerp(new THREE.Color(0xb5485c), 0.58);
      if (sectionId === this.selectedSectionId && row.rowLabel === this.selectedRowLabel) {
        color.set(0xd96b7d);
      }
      ref.mesh.setColorAt(ref.index, color);
      if (ref.mesh.instanceColor) ref.mesh.instanceColor.needsUpdate = true;
    }
    for (const seat of this.seatsBySection.get(sectionId) ?? []) {
      const ref = this.seatRefs.get(seat.id);
      if (!ref) continue;
      const color = ref.baseColor.clone();
      if (sectionId === this.selectedSectionId) color.lerp(new THREE.Color(0xc05064), 0.46);
      if (sectionId === this.selectedSectionId && seat.rowLabel === this.selectedRowLabel) {
        color.set(0xea7b8d);
      }
      if (seat.id === this.selectedAnchorId) color.set(0xb7e63b);
      ref.mesh.setColorAt(ref.index, color);
      if (ref.mesh.instanceColor) ref.mesh.instanceColor.needsUpdate = true;
    }
  }

  private refreshPickMesh(): void {
    if (!this.selectedSectionId) {
      this.pickMesh.count = 0;
      this.pickMesh.userData.seatLookup = [];
      return;
    }
    const anchors = this.seatsBySection.get(this.selectedSectionId) ?? [];
    const dummy = new THREE.Object3D();
    anchors.forEach((anchor, index) => {
      seatMatrix(anchor, dummy);
      this.pickMesh.setMatrixAt(index, dummy.matrix);
    });
    this.pickMesh.count = anchors.length;
    this.pickMesh.instanceMatrix.needsUpdate = true;
    this.pickMesh.userData.seatLookup = anchors.map((seat) => ({
      anchorId: seat.id,
      sectionId: seat.sectionId,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber ?? undefined,
      positionIndex: seat.positionIndex,
    } satisfies ExplorerPickedSelection));
  }

  diagnostics(): Record<string, unknown> {
    return {
      officialSections: this.catalog.coverage.officialSections,
      totalRows: this.catalog.coverage.totalRows,
      selectableChairPositions: this.catalog.coverage.selectableChairPositions,
      exactSeatIdentifiers: this.catalog.coverage.exactSeatIdentifiers,
      modeledSeatPositions: this.catalog.coverage.modeledSeatPositions,
      activeSectionPickTargets: this.pickMesh.count,
      selectedSectionId: this.selectedSectionId,
      selectedRowLabel: this.selectedRowLabel,
      selectedAnchorId: this.selectedAnchorId,
      objectOnly: true,
    };
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
}
