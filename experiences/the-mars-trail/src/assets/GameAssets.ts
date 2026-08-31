/**
 * Runtime asset loading for THE MARS TRAIL.
 *
 * Every GLB path goes through the shared Draco-capable loader from
 * `gltf-runtime.ts`, per the Mint glTF runtime contract — a bare GLTFLoader
 * cannot decode a Mint-optimized GLB even when the current batch happens to be
 * uncompressed. The first fatal error is latched so a later progress callback
 * cannot mask a real failure.
 */

import * as THREE from 'three';
import { createMintGltfLoader } from './gltf-runtime';
import { artifactUrl, assetKeysWithPrefix, hasAsset } from './mintRegistry';

export interface LoadReport {
  loaded: string[];
  missing: string[];
  failed: Array<{ key: string; message: string }>;
}

/** Target longest-axis size, in world units, for each asset family. */
const FIT_SIZES = {
  hull: 3.4,
  core: 0.95,
  debris: 1.5,
  asteroid: 1.9,
  station: 4.2,
  desert: 6,
  rocket: 4.2,
} as const;

/** Prop families, loaded on demand per leg rather than all at once. */
export type PropFamily = 'debris' | 'asteroid' | 'station' | 'desert';

const FAMILY_FIT: Record<PropFamily, number> = {
  debris: FIT_SIZES.debris,
  asteroid: FIT_SIZES.asteroid,
  station: FIT_SIZES.station,
  desert: FIT_SIZES.desert,
};

export class GameAssets {
  private readonly loader = createMintGltfLoader();
  private readonly cache = new Map<string, THREE.Object3D>();

  hull: THREE.Object3D | null = null;
  core: THREE.Object3D | null = null;
  debris: THREE.Object3D[] = [];
  asteroids: THREE.Object3D[] = [];
  stations: THREE.Object3D[] = [];
  /** The desert launch complex: pad, gantry, ground, mesas, tanks, berm. */
  desert: THREE.Object3D[] = [];
  /** The launch vehicle, distinct from the transit hull. */
  rocket: THREE.Object3D | null = null;

  portraitUrls = new Map<string, string>();
  audioUrls = new Map<string, string>();

  private fatalError: string | null = null;
  /** In-flight or completed family loads, so a leg revisit does not refetch. */
  private familyLoads = new Map<PropFamily, Promise<void>>();

  get error(): string | null {
    return this.fatalError;
  }

  /**
   * Load only what the first frame needs: the hull, the drive core, and the
   * static image/audio URLs. That is about 2 MB against 17 MB for every prop in
   * the game, and the remaining families stream in per leg through
   * `ensureFamilies`. Loading everything up front gated the title screen behind
   * the entire asset set.
   */
  async loadEssential(): Promise<LoadReport> {
    const report: LoadReport = { loaded: [], missing: [], failed: [] };
    this.collectStaticUrls(report);

    await Promise.all([
      this.loadInto('ship-hull', FIT_SIZES.hull, report, (object) => {
        this.hull = object;
      }),
      this.loadInto('drive-core', FIT_SIZES.core, report, (object) => {
        this.core = object;
      }),
      // The ascent is the first thing a new run sees, so the vehicle it flies
      // is essential rather than streamed with a family.
      this.loadInto('launch-rocket', FIT_SIZES.rocket, report, (object) => {
        this.rocket = object;
      }),
    ]);

    return report;
  }

  /** Which prop families a leg's scene actually draws from. */
  familiesForScene(sceneKey: string): PropFamily[] {
    switch (sceneKey) {
      case 'earth-orbit':
        return ['station', 'debris'];
      case 'debris-belt':
        return ['debris'];
      case 'deep-quiet':
        return ['asteroid'];
      case 'asteroid-fringe':
        return ['asteroid'];
      case 'mars-approach':
        return ['station', 'asteroid'];
      default:
        return [];
    }
  }

  /** Load the given families if they are not already loaded or loading. */
  async ensureFamilies(families: PropFamily[]): Promise<void> {
    await Promise.all(families.map((family) => this.ensureFamily(family)));
  }

  private ensureFamily(family: PropFamily): Promise<void> {
    const existing = this.familyLoads.get(family);
    if (existing) return existing;

    const report: LoadReport = { loaded: [], missing: [], failed: [] };
    const target =
      family === 'debris'
        ? this.debris
        : family === 'asteroid'
          ? this.asteroids
          : family === 'desert'
            ? this.desert
            : this.stations;

    // Write each model into the slot matching its key, not the order it
    // happens to finish downloading in. Pushing on completion made the array
    // order a race, and the launch pad lays its complex out by index — so the
    // ground tile could end up in the gantry's slot and hang in the sky.
    const keys = assetKeysWithPrefix(`${family}-`);
    const slots: Array<THREE.Object3D | null> = keys.map(() => null);

    const job = Promise.all(
      keys.map((key, index) =>
        this.loadInto(key, FAMILY_FIT[family], report, (object) => {
          slots[index] = object;
        }),
      ),
    ).then(() => {
      target.length = 0;
      for (const slot of slots) if (slot) target.push(slot);
    });

    this.familyLoads.set(family, job);
    return job;
  }

  private collectStaticUrls(report: LoadReport): void {
    for (const key of assetKeysWithPrefix('crew-portrait-')) {
      const url = artifactUrl(key, 'image');
      if (url) {
        this.portraitUrls.set(key, url);
        report.loaded.push(key);
      } else {
        report.missing.push(key);
      }
    }

    // Every audio asset in the registry, not a hard-coded pair: a new sound
    // added to the registry would otherwise sync to disk and then silently
    // never load.
    for (const key of assetKeysWithPrefix('audio-')) {
      const url = artifactUrl(key, 'audio');
      if (url) {
        this.audioUrls.set(key, url);
        report.loaded.push(key);
      } else {
        report.missing.push(key);
      }
    }
  }

  private async loadInto(
    key: string,
    fitSize: number,
    report: LoadReport,
    assign: (object: THREE.Object3D) => void,
  ): Promise<void> {
    if (!hasAsset(key)) {
      report.missing.push(key);
      return;
    }
    const url = artifactUrl(key, 'canonical_model');
    if (!url) {
      report.missing.push(key);
      return;
    }

    try {
      const cached = this.cache.get(key);
      if (cached) {
        assign(cached);
        return;
      }

      const gltf = await this.loader.loadAsync(url);
      const root = gltf.scene;

      // Bounds-based fitting is presentation treatment: it recentres and scales
      // the wrapper, and never touches the generated geometry or materials.
      const wrapper = new THREE.Group();
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z) || 1;

      root.position.sub(center);
      wrapper.add(root);
      wrapper.scale.setScalar(fitSize / longest);

      this.cache.set(key, wrapper);
      assign(wrapper);
      report.loaded.push(key);
    } catch (error) {
      // Latch the first fatal loading error; later successes must not hide it.
      const message = error instanceof Error ? error.message : String(error);
      if (!this.fatalError) this.fatalError = `${key}: ${message}`;
      report.failed.push({ key, message });
    }
  }

  portraitFor(index: number): string | null {
    return this.portraitUrls.get(`crew-portrait-${index + 1}`) ?? null;
  }

  dispose(): void {
    for (const object of this.cache.values()) {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
    }
    this.cache.clear();
    this.debris = [];
    this.asteroids = [];
    this.stations = [];
    this.hull = null;
    this.core = null;
  }
}
