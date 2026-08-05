import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SeatInstance, RowPreviewInstance } from "../../stadium/generateSeatInstances";

const loader = new GLTFLoader();

async function extractMesh(path: string): Promise<THREE.Mesh | null> {
  try {
    const gltf = await loader.loadAsync(path);
    let found: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!found && m.isMesh) found = m;
    });
    return found;
  } catch (err) {
    console.warn("[fieldline] seat mesh load failed", path, err);
    return null;
  }
}

function normalizeGeometry(source: THREE.Mesh, target: {
  width: number;
  height: number;
  depth: number;
}): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
} {
  const geometry = source.geometry.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(
    size.x > 0.001 ? target.width / size.x : 1,
    size.y > 0.001 ? target.height / size.y : 1,
    size.z > 0.001 ? target.depth / size.z : 1,
  );
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  const box2 = geometry.boundingBox ?? new THREE.Box3();
  const center = box2.getCenter(new THREE.Vector3());
  // Put contact patch near y=0, centered in XZ.
  geometry.translate(-center.x, -box2.min.y, -center.z);
  const material = Array.isArray(source.material)
    ? source.material.map((m) => m.clone())
    : source.material.clone();
  return { geometry, material };
}

export function createMintSeatInstances(
  seats: SeatInstance[],
  parent: THREE.Group,
  options: { highDetail?: boolean } = {},
): MintSeatLod {
  const selectable = seats.filter((s) => s.selectable);
  const detail: THREE.InstancedMesh<
    THREE.BufferGeometry,
    THREE.Material | THREE.Material[]
  > = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.46, 0.56, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74 }),
    20,
  );
  const overview = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.42, 0.56, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74 }),
    Math.max(selectable.length, 1),
  );
  const dummy = new THREE.Object3D();
  let detailIsProxy = true;
  let detailSectionId = "P234";
  let detailRowLabel: string | null = "7";
  let detailSeatNumber: number | null = 8;
  selectable.forEach((seat, index) => {
    dummy.position.copy(seat.position);
    dummy.position.y += 0.28;
    dummy.rotation.set(0, seat.yawRad, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    overview.setMatrixAt(index, dummy.matrix);
    overview.setColorAt(index, new THREE.Color(0x6d2532));
  });
  overview.count = selectable.length;
  overview.instanceMatrix.needsUpdate = true;
  if (overview.instanceColor) overview.instanceColor.needsUpdate = true;
  overview.castShadow = true;
  overview.receiveShadow = true;
  overview.name = "mint-seat-overview-instances";
  overview.userData = {
    kind: "seat-instances",
    lod: "overview",
    status: "modeled",
    source: "discrete-local-artifact",
    seatLookup: selectable.map((seat) => ({
      sectionId: seat.sectionId,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
    })),
  };

  detail.count = 0;
  detail.castShadow = true;
  detail.receiveShadow = true;
  detail.name = "mint-seat-detail-instances";
  detail.userData = {
    kind: "seat-instances",
    lod: "detail",
    status: "modeled",
    source: "discrete-local-artifact",
    seatLookup: [],
  };

  const setDetailedRow = (
    sectionId: string,
    rowLabel: string | null,
    seatNumber: number | null = null,
  ) => {
    detailSectionId = sectionId;
    detailRowLabel = rowLabel;
    detailSeatNumber = seatNumber;
    const allRowSeats = selectable.filter(
      (seat) => seat.sectionId === sectionId && seat.rowLabel === rowLabel,
    );
    const selectedIndex = seatNumber == null
      ? Math.floor((allRowSeats.length - 1) / 2)
      : allRowSeats.findIndex((seat) => seat.seatNumber === seatNumber);
    const start = Math.min(
      Math.max(0, selectedIndex - 1),
      Math.max(0, allRowSeats.length - 3),
    );
    const rowSeats = selectedIndex < 0 ? [] : allRowSeats.slice(start, start + 3);
    rowSeats.forEach((seat, index) => {
      dummy.position.copy(seat.position);
      if (detailIsProxy) dummy.position.y += 0.28;
      dummy.rotation.set(0, seat.yawRad, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      detail.setMatrixAt(index, dummy.matrix);
      detail.setColorAt(index, new THREE.Color(0x6d2532));
    });
    detail.count = rowSeats.length;
    detail.instanceMatrix.needsUpdate = true;
    if (detail.instanceColor) detail.instanceColor.needsUpdate = true;
    detail.userData.seatLookup = rowSeats.map((seat) => ({
      sectionId: seat.sectionId,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
    }));
  };
  setDetailedRow("P234", "7", 8);

  const high = new THREE.Group();
  high.add(detail);
  const low = new THREE.Group();
  low.add(overview);
  const lod = new THREE.LOD();
  lod.name = "mint-seat-progressive-lod";
  lod.addLevel(high, 0);
  lod.addLevel(low, 145);
  parent.add(lod);
  const ready = options.highDetail === false ? Promise.resolve() : (async () => {
    const source =
      (await extractMesh(
        "https://cdn.mint.gg/glb/premium-seat-hero-normalized-29c309b7eace5ac7.glb",
      )) ??
      (await extractMesh(
        "https://cdn.mint.gg/glb/premium-padded-seat-normalized-aebe482000b18c83.glb",
      )) ??
      (await extractMesh(
        "https://cdn.mint.gg/glb/standard-seat-hero-normalized-36ed4ffdd0bd7b7c.glb",
      )) ??
      (await extractMesh(
        "https://cdn.mint.gg/glb/standard-seat-normalized-4094e07297ae8c18.glb",
      ));
    if (!source) return;
    const prepared = normalizeGeometry(source, {
      width: 0.48,
      height: 0.88,
      depth: 0.52,
    });
    detail.geometry.dispose();
    detail.geometry = prepared.geometry;
    detail.material = prepared.material;
    const seatMaterials = Array.isArray(detail.material) ? detail.material : [detail.material];
    for (const material of seatMaterials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.color) standard.color.lerp(new THREE.Color(0x741f2d), 0.78);
      if ("roughness" in standard) standard.roughness = Math.max(standard.roughness, 0.72);
      if ("metalness" in standard) standard.metalness = Math.min(standard.metalness, 0.18);
    }
    // The exact selected chair remains visible from its seated camera. Its
    // canonical eye point is outside the normalized chair bounds, so blanket
    // proximity fading would erase the cushion/armrest context users need.
    detailIsProxy = false;
    detail.userData.source = "mint-cdn-artifact";
    setDetailedRow(detailSectionId, detailRowLabel, detailSeatNumber);
  })();
  return { lod, detail, overview, setDetailedRow, ready };
}

export type MintSeatLod = {
  lod: THREE.LOD;
  detail: THREE.InstancedMesh;
  overview: THREE.InstancedMesh;
  setDetailedRow(
    sectionId: string,
    rowLabel: string | null,
    seatNumber?: number | null,
  ): void;
  ready: Promise<void>;
};

export async function createMintAdaPlatforms(
  rows: RowPreviewInstance[],
  parent: THREE.Group,
): Promise<void> {
  const source =
    (await extractMesh(
      "https://cdn.mint.gg/glb/ada-platform-hero-normalized-d76b8c58c843a978.glb",
    )) ??
    (await extractMesh(
      "https://cdn.mint.gg/glb/wheelchair-platform-normalized-7a634cfd8f5d3a9a.glb",
    ));
  if (!source) return;
  const { geometry, material } = normalizeGeometry(source, {
    width: 2.4,
    height: 0.22,
    depth: 1.4,
  });
  for (const row of rows) {
    if (!row.isAda) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(row.position);
    mesh.rotation.y = row.yawRad;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      kind: "ada-platform",
      sectionId: row.sectionId,
      rowLabel: row.rowLabel,
    };
    parent.add(mesh);
  }
}

export async function createMintCrowdInstances(
  seats: SeatInstance[],
  parent: THREE.Group,
  stride = 2,
): Promise<THREE.InstancedMesh | null> {
  const source = await extractMesh(
    "https://cdn.mint.gg/glb/crowd-avatar-seated-normalized-4ffe910c7d48aac2.glb",
  );
  if (!source) return null;
  const { geometry, material } = normalizeGeometry(source, {
    width: 0.52,
    height: 1.32,
    depth: 0.58,
  });
  const sampled = seats.filter((seat, index) => seat.selectable && index % stride === 0);
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(sampled.length, 1));
  const dummy = new THREE.Object3D();
  sampled.forEach((seat, index) => {
    dummy.position.copy(seat.position);
    const forward = new THREE.Vector3(Math.sin(seat.yawRad), 0, Math.cos(seat.yawRad));
    dummy.position.addScaledVector(forward, 0.07);
    dummy.rotation.set(0, seat.yawRad, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.count = sampled.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.visible = false;
  mesh.name = "mint-modeled-crowd-instances";
  mesh.userData = {
    kind: "crowd-instances",
    status: "modeled",
    source: "mint-cdn-artifact",
    sampleCount: sampled.length,
  };
  parent.add(mesh);
  return mesh;
}
