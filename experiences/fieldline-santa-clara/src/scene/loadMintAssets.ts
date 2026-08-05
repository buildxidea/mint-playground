import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ModeledGeometryManifest } from "../stadium/schema";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group | null>>();

export type MintAssetReport = {
  loaded: string[];
  failed: string[];
  objectCount: number;
  worldRuntimeUsed: false;
};

async function loadGlb(path: string): Promise<THREE.Group | null> {
  const pending = cache.get(path);
  if (pending) return pending;
  const request = loader
    .loadAsync(path)
    .then((gltf) => {
      const root = gltf.scene;
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((material) => material.clone());
        } else {
          mesh.material = mesh.material.clone();
        }
      });
      return root;
    })
    .catch((error: unknown) => {
      console.warn("[fieldline] discrete Mint object failed to load", path, error);
      return null;
    });
  cache.set(path, request);
  return request;
}

function normalizeObject(object: THREE.Object3D, maxDimension: number): void {
  object.updateMatrixWorld(true);
  const initial = new THREE.Box3().setFromObject(object);
  const size = initial.getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z) || 1;
  object.scale.multiplyScalar(maxDimension / max);
  object.updateMatrixWorld(true);
  const normalized = new THREE.Box3().setFromObject(object);
  const center = normalized.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= normalized.min.y;
  object.updateMatrixWorld(true);
}

function clonePrepared(source: THREE.Group, name: string): THREE.Group {
  // Keep normalization on a child so placement never overwrites the centering transform.
  const content = source.clone(true);
  content.name = `${name}-content`;
  const clone = new THREE.Group();
  clone.name = name;
  clone.userData = {
    kind: "mint-object",
    source: "mint-cdn-artifact",
    status: "modeled",
  };
  clone.add(content);
  return clone;
}

function harmonizeMaterials(
  object: THREE.Object3D,
  tint: number,
  strength = 0.62,
  roughness = 0.72,
): void {
  const target = new THREE.Color(tint);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.color) standard.color.lerp(target, strength);
      if ("roughness" in standard) standard.roughness = Math.max(standard.roughness, roughness);
      if ("metalness" in standard) standard.metalness = Math.min(standard.metalness, 0.55);
      standard.needsUpdate = true;
    });
  });
}

/**
 * The goalpost GLB is Y-up with its crossbar on local Z and its uprights offset
 * from the support toward local +X. Rotate that +X axis toward midfield at each
 * end zone so the crossbar spans the field's world-X width.
 */
export function goalpostYawForEndZone(zM: number): number {
  if (zM === 0) throw new Error("A goalpost must be placed in an end zone");
  return Math.sign(zM) * Math.PI / 2;
}

export async function loadMintDressing(
  parent: THREE.Group,
  geometry: ModeledGeometryManifest,
): Promise<MintAssetReport> {
  const root = new THREE.Group();
  root.name = "discrete-mint-object-pack";
  parent.add(root);

  const paths = {
    guardrail:
      "https://cdn.mint.gg/glb/guardrail-segment-normalized-ae77718308f39330.glb",
    stairs:
      "https://cdn.mint.gg/glb/aisle-stairs-hero-normalized-1710f0d0260ddfe6.glb",
    goals:
      "https://cdn.mint.gg/glb/goal-uprights-normalized-9767f78f780d7fe8.glb",
  } as const;
  const entries = Object.entries(paths);
  const objects = await Promise.all(entries.map(([, path]) => loadGlb(path)));
  const resolved = Object.fromEntries(entries.map(([key], index) => [key, objects[index]])) as
    Record<keyof typeof paths, THREE.Group | null>;

  const report: MintAssetReport = {
    loaded: entries.filter(([,], index) => objects[index]).map(([, path]) => path),
    failed: entries.filter(([,], index) => !objects[index]).map(([, path]) => path),
    objectCount: 0,
    worldRuntimeUsed: false,
  };

  if (resolved.guardrail) {
    normalizeObject(resolved.guardrail, 7.5);
    const rail = clonePrepared(resolved.guardrail, "mint-p234-front-guardrail-object");
    harmonizeMaterials(rail, 0x333a38, 0.62, 0.5);
    // Preserve the generated segment's width but constrain its guard height to the modeled row scale.
    rail.scale.y = 0.2;
    const row = geometry.sections
      .find((section) => section.sectionId === "P234")
      ?.rowCenterlines[0];
    if (row) {
      const forward = new THREE.Vector3(Math.sin(row.yawRad), 0, Math.cos(row.yawRad));
      rail.position.set(row.origin[0], row.origin[1] + 0.05, row.origin[2]);
      rail.position.addScaledVector(forward, 1.45);
      rail.rotation.y = row.yawRad + Math.PI;
    }
    rail.userData.category = "rail";
    root.add(rail);
    report.objectCount += 1;
  }

  if (resolved.stairs) {
    normalizeObject(resolved.stairs, 3.2);
    const row = geometry.sections
      .find((section) => section.sectionId === "P234")
      ?.rowCenterlines[0];
    for (const [index, offset] of [-3.8, 3.8].entries()) {
      const stairs = clonePrepared(resolved.stairs, `mint-p234-aisle-stairs-object-${index + 1}`);
      harmonizeMaterials(stairs, 0x60615d, 0.58, 0.88);
      stairs.scale.set(0.62, 0.42, 1);
      if (row) {
        const right = new THREE.Vector3(-Math.cos(row.yawRad), 0, Math.sin(row.yawRad));
        stairs.position.set(row.origin[0], row.origin[1], row.origin[2]);
        stairs.position.addScaledVector(right, offset);
        stairs.rotation.y = row.yawRad + Math.PI;
      }
      stairs.userData.category = "aisle";
      root.add(stairs);
      report.objectCount += 1;
    }
  }

  if (resolved.goals) {
    normalizeObject(resolved.goals, 11);
    for (const [index, z] of [54.5, -54.5].entries()) {
      const goal = clonePrepared(resolved.goals, `mint-goal-upright-object-${index + 1}`);
      harmonizeMaterials(goal, 0xd4b632, 0.42, 0.45);
      goal.position.set(0, 0, z);
      goal.rotation.y = goalpostYawForEndZone(z);
      goal.userData.category = "goalpost";
      goal.userData.eventConfig = "football";
      root.add(goal);
      report.objectCount += 1;
    }
  }

  return report;
}
