import * as THREE from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import {
  FURNITURE_KEYS,
  modelUrlFor,
  syncedKeys,
  type FurnitureKey,
} from "./asset-manifest";
import { NORMALIZATION } from "./normalization";

/**
 * Drops triangles that reach outside the axis-aligned box holding `keep` of
 * the mesh's vertices, so a handful of stray vertices can neither stretch a
 * triangle into a sheet nor inflate the bounds. The surviving vertices are
 * compacted into fresh attributes: an orphaned vertex is invisible but still
 * counts toward computeBoundingBox, which is what the bounds fit measures.
 */
function trimStrayTriangles(mesh: THREE.Mesh, keep: number) {
  const geom = mesh.geometry;
  const pos = geom.getAttribute("position");
  if (!pos || pos.count < 3) return;
  // Rewriting the index would invalidate multi-material draw ranges.
  if (geom.groups.length > 1) return;

  // Per-axis quantile bounds, padded so the body's own extremes survive.
  const tail = (1 - keep) / 2;
  const min: number[] = [];
  const max: number[] = [];
  const values = new Float64Array(pos.count);
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < pos.count; i++) values[i] = pos.getComponent(i, axis);
    values.sort();
    const lo = values[Math.floor(tail * (pos.count - 1))];
    const hi = values[Math.ceil((1 - tail) * (pos.count - 1))];
    const pad = (hi - lo) * 0.08 + 1e-4;
    min.push(lo - pad);
    max.push(hi + pad);
  }

  const inside = (v: number) =>
    pos.getX(v) >= min[0] &&
    pos.getX(v) <= max[0] &&
    pos.getY(v) >= min[1] &&
    pos.getY(v) <= max[1] &&
    pos.getZ(v) >= min[2] &&
    pos.getZ(v) <= max[2];

  const index = geom.getIndex();
  const corners = index ? index.count : pos.count;
  const remap = new Map<number, number>();
  const order: number[] = [];
  const kept: number[] = [];
  const reindex = (v: number) => {
    let next = remap.get(v);
    if (next === undefined) {
      next = order.length;
      remap.set(v, next);
      order.push(v);
    }
    return next;
  };
  for (let t = 0; t + 2 < corners; t += 3) {
    const a = index ? index.getX(t) : t;
    const b = index ? index.getX(t + 1) : t + 1;
    const c = index ? index.getX(t + 2) : t + 2;
    if (!inside(a) || !inside(b) || !inside(c)) continue;
    kept.push(reindex(a), reindex(b), reindex(c));
  }
  if (kept.length === 0 || order.length === pos.count) return;

  for (const [name, attr] of Object.entries(geom.attributes)) {
    const src = attr as THREE.BufferAttribute;
    const items = src.itemSize;
    const values = new Float32Array(order.length * items);
    for (let i = 0; i < order.length; i++) {
      for (let c = 0; c < items; c++) {
        values[i * items + c] = src.getComponent(order[i], c);
      }
    }
    geom.setAttribute(name, new THREE.BufferAttribute(values, items, src.normalized));
  }
  geom.setIndex(kept);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
}

/**
 * Drops every triangle sitting entirely below `y`, measured in the space the
 * mesh has been placed into. Triangles that straddle the line are kept, so the
 * cut follows the geometry rather than slicing through a face.
 */
function trimBelow(mesh: THREE.Mesh, toLocal: THREE.Matrix4, y: number) {
  const geom = mesh.geometry;
  const pos = geom.getAttribute("position");
  if (!pos || geom.groups.length > 1) return;

  const v = new THREE.Vector3();
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    heights[i] = v.fromBufferAttribute(pos, i).applyMatrix4(toLocal).y;
  }

  const index = geom.getIndex();
  const corners = index ? index.count : pos.count;
  const kept: number[] = [];
  for (let t = 0; t + 2 < corners; t += 3) {
    const a = index ? index.getX(t) : t;
    const b = index ? index.getX(t + 1) : t + 1;
    const c = index ? index.getX(t + 2) : t + 2;
    if (Math.max(heights[a], heights[b], heights[c]) < y) continue;
    kept.push(a, b, c);
  }
  if (kept.length === corners) return;

  geom.setIndex(kept);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
}

export interface LoadReport {
  loaded: FurnitureKey[];
  missing: FurnitureKey[];
  /** First fatal load error, latched (later progress cannot replace it). */
  fatalError: string | null;
}

/**
 * Loads every synced Mint GLB through the shared Draco-capable loader and
 * wraps each in a normalized group: bounds-fit, floor-anchored, front = +Z.
 */
export class AssetLibrary {
  private templates = new Map<FurnitureKey, THREE.Group>();
  private fatalError: string | null = null;

  async loadAll(onOne?: (key: FurnitureKey) => void): Promise<LoadReport> {
    const loader = createMintGltfLoader();
    const keys = syncedKeys();
    await Promise.all(
      keys.map(async (key) => {
        const url = modelUrlFor(key);
        if (!url) return;
        try {
          const gltf = await loader.loadAsync(url);
          this.templates.set(key, this.normalize(key, gltf.scene));
          onOne?.(key);
        } catch (err) {
          if (this.fatalError === null) {
            this.fatalError = `Failed to load ${key}: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      }),
    );
    const allKeys: FurnitureKey[] = [...FURNITURE_KEYS];
    return {
      loaded: allKeys.filter((k) => this.templates.has(k)),
      missing: allKeys.filter((k) => !this.templates.has(k)),
      fatalError: this.fatalError,
    };
  }

  private normalize(key: FurnitureKey, scene: THREE.Group): THREE.Group {
    const spec = NORMALIZATION[key];
    if (spec.trimStray !== undefined) {
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          trimStrayTriangles(o as THREE.Mesh, spec.trimStray!);
        }
      });
    }
    const inner = new THREE.Group();
    inner.add(scene);
    inner.rotation.set(spec.pitchX ?? 0, spec.yawOffset, spec.rollZ ?? 0);
    inner.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const scale = Math.min(
      spec.fit[0] / Math.max(size.x, 1e-4),
      spec.fit[1] / Math.max(size.y, 1e-4),
      spec.fit[2] / Math.max(size.z, 1e-4),
    );
    // Local Z is the model's depth axis; with pitchX it becomes world Y.
    inner.scale.set(scale, scale, scale * (spec.flattenDepth ?? 1));
    inner.updateMatrixWorld(true);

    const scaled = new THREE.Box3().setFromObject(inner);
    const center = scaled.getCenter(new THREE.Vector3());
    const yOffset =
      spec.centerY !== undefined ? spec.centerY - center.y : -scaled.min.y;
    inner.position.set(-center.x, yOffset, -center.z);

    const wrapper = new THREE.Group();
    wrapper.name = `mint:${key}`;
    wrapper.add(inner);

    // Runs last so the cut height is read in the space the model is finally
    // placed in, and after anchoring so removing the plate cannot drag the
    // rest of the door out of position.
    if (spec.trimBelowY !== undefined) {
      wrapper.updateMatrixWorld(true);
      wrapper.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) trimBelow(mesh, mesh.matrixWorld, spec.trimBelowY!);
      });
    }
    return wrapper;
  }

  /** Fresh instance for placement; shares geometry/materials with template. */
  instance(key: FurnitureKey): THREE.Group | null {
    const template = this.templates.get(key);
    return template ? (template.clone(true) as THREE.Group) : null;
  }

  has(key: FurnitureKey) {
    return this.templates.has(key);
  }
}
