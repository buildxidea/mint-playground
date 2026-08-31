/**
 * Scrolling parallax layers for THE MARS TRAIL.
 *
 * The reference frames are built from three depth bands moving at different
 * rates: a distant silhouette ridge, a midground band, and a dark foreground
 * band. The bands themselves are abstract terrain, so they are authored
 * procedurally here; Mint-generated props are scattered on top of them.
 */

import * as THREE from 'three';
import type { ScenePalette } from './palettes';

/** World-space width of one band tile. Two tiles cover any viewport. */
const TILE_WIDTH = 120;

export interface BandConfig {
  z: number;
  /** Baseline height of the band's top edge. */
  height: number;
  /** Peak-to-peak variation of the top edge. */
  jag: number;
  /** Horizontal scale of the jagged profile. Larger is smoother. */
  wavelength: number;
  /** Scroll rate relative to the travel rate. */
  speed: number;
  /** Vertical offset of the whole band. */
  y: number;
}

export const BAND_CONFIGS: Record<'far' | 'mid' | 'near', BandConfig> = {
  far: { z: -46, height: 7.5, jag: 5.5, wavelength: 26, speed: 0.07, y: -5.5 },
  mid: { z: -20, height: 5, jag: 3.6, wavelength: 15, speed: 0.24, y: -6.2 },
  near: { z: -3.5, height: 3.4, jag: 2.2, wavelength: 8, speed: 0.72, y: -6.8 },
};

/** One prop instance placed on a band and wrapped independently. */
interface PlacedProp {
  object: THREE.Object3D;
  /** Rotation applied per second, for tumbling debris and asteroids. */
  spin: THREE.Vector3;
  baseY: number;
  bobPhase: number;
  bobAmount: number;
}

class ParallaxBand {
  readonly group = new THREE.Group();

  private readonly tiles: THREE.Mesh[] = [];
  private readonly material: THREE.MeshBasicMaterial;
  private readonly props: PlacedProp[] = [];
  private readonly propHost = new THREE.Group();

  constructor(
    readonly config: BandConfig,
    rng: () => number,
  ) {
    // Unlit flat colour: these bands are silhouettes, and shading them would
    // undercut the hard value separation the posterise pass depends on.
    this.material = new THREE.MeshBasicMaterial({ color: '#1b4a6e', fog: false });

    const geometry = this.buildProfileGeometry(rng);
    for (let i = 0; i < 2; i += 1) {
      // Tiles straddle the origin at -TILE_WIDTH and 0. The world scrolls in
      // +x (see update), so the incoming tile has to be the one on the left.
      const tile = new THREE.Mesh(geometry, this.material);
      tile.position.set((i - 1) * TILE_WIDTH, config.y, config.z);
      tile.renderOrder = -50 + Math.round(config.z);
      this.tiles.push(tile);
      this.group.add(tile);
    }

    this.propHost.position.z = config.z;
    this.group.add(this.propHost);
  }

  /**
   * A jagged top edge from summed sines. Deterministic per seed so the same run
   * always produces the same horizon, which keeps screenshots stable.
   */
  private buildProfileGeometry(rng: () => number): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    const segments = 96;
    const phaseA = rng() * Math.PI * 2;
    const phaseB = rng() * Math.PI * 2;
    const phaseC = rng() * Math.PI * 2;

    shape.moveTo(0, -30);
    shape.lineTo(TILE_WIDTH, -30);

    for (let i = segments; i >= 0; i -= 1) {
      const t = i / segments;
      const x = t * TILE_WIDTH;
      const w = (x / this.config.wavelength) * Math.PI * 2;
      const noise =
        Math.sin(w + phaseA) * 0.55 +
        Math.sin(w * 2.3 + phaseB) * 0.3 +
        Math.sin(w * 4.7 + phaseC) * 0.15;
      // Force the profile to match at both tile ends so the wrap is seamless.
      const endBlend = Math.sin(t * Math.PI);
      shape.lineTo(x, this.config.height + noise * this.config.jag * endBlend);
    }

    shape.closePath();
    return new THREE.ShapeGeometry(shape, 1);
  }

  setColor(color: string): void {
    this.material.color.set(color);
  }

  /**
   * Populate the band with prop instances. Called once the Mint packs resolve;
   * clearing first makes it safe to repopulate on a leg change.
   */
  setProps(
    sources: THREE.Object3D[],
    count: number,
    rng: () => number,
    options: { scale: [number, number]; tumble: boolean; yJitter: number },
  ): void {
    this.clearProps();
    if (sources.length === 0 || count <= 0) return;

    const span = TILE_WIDTH * 2;
    for (let i = 0; i < count; i += 1) {
      const source = sources[Math.floor(rng() * sources.length)];
      const object = source.clone(true);

      const scale = options.scale[0] + rng() * (options.scale[1] - options.scale[0]);
      object.scale.multiplyScalar(scale);
      // Spread props across a span centred on the camera, so a fresh leg has
      // props already on screen instead of a bare frame until the first wrap.
      object.position.set(
        (rng() - 0.5) * span,
        this.config.y + this.config.height * 0.6 + (rng() - 0.5) * options.yJitter,
        (rng() - 0.5) * 4,
      );
      object.rotation.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);

      this.propHost.add(object);
      this.props.push({
        object,
        spin: options.tumble
          ? new THREE.Vector3((rng() - 0.5) * 0.22, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.18)
          : new THREE.Vector3(),
        baseY: object.position.y,
        bobPhase: rng() * Math.PI * 2,
        bobAmount: options.tumble ? 0 : 0.12 + rng() * 0.2,
      });
    }
  }

  /** First tile's world x, for direction assertions in QA. */
  get scrollX(): number {
    return this.tiles[0]?.position.x ?? 0;
  }

  clearProps(): void {
    for (const prop of this.props) {
      this.propHost.remove(prop.object);
      disposeTree(prop.object);
    }
    this.props.length = 0;
  }

  update(delta: number, travelRate: number, elapsed: number): void {
    // The world scrolls toward +x so the ship reads as travelling left — the
    // direction its drive cores lead and its exhaust plumes trail. Scrolling
    // the other way made the ship fly backwards through its own thrust.
    const shift = delta * travelRate * this.config.speed;

    for (const tile of this.tiles) {
      tile.position.x += shift;
      if (tile.position.x >= TILE_WIDTH) tile.position.x -= TILE_WIDTH * 2;
    }

    const span = TILE_WIDTH * 2;
    for (const prop of this.props) {
      prop.object.position.x += shift;
      if (prop.object.position.x > span / 2) prop.object.position.x -= span;

      if (prop.spin.lengthSq() > 0) {
        prop.object.rotation.x += prop.spin.x * delta;
        prop.object.rotation.y += prop.spin.y * delta;
        prop.object.rotation.z += prop.spin.z * delta;
      }
      if (prop.bobAmount > 0) {
        prop.object.position.y =
          prop.baseY + Math.sin(elapsed * 0.6 + prop.bobPhase) * prop.bobAmount;
      }
    }
  }

  dispose(): void {
    this.clearProps();
    this.material.dispose();
    this.tiles[0]?.geometry.dispose();
  }
}

export class ParallaxLayers {
  readonly group = new THREE.Group();

  readonly far: ParallaxBand;
  readonly mid: ParallaxBand;
  readonly near: ParallaxBand;

  constructor(rng: () => number) {
    this.far = new ParallaxBand(BAND_CONFIGS.far, rng);
    this.mid = new ParallaxBand(BAND_CONFIGS.mid, rng);
    this.near = new ParallaxBand(BAND_CONFIGS.near, rng);
    this.group.add(this.far.group, this.mid.group, this.near.group);
  }

  applyPalette(palette: ScenePalette): void {
    this.far.setColor(palette.farLayer);
    this.mid.setColor(palette.midLayer);
    this.near.setColor(palette.nearLayer);
  }

  update(delta: number, travelRate: number, elapsed: number): void {
    this.far.update(delta, travelRate, elapsed);
    this.mid.update(delta, travelRate, elapsed);
    this.near.update(delta, travelRate, elapsed);
  }

  clearAllProps(): void {
    this.far.clearProps();
    this.mid.clearProps();
    this.near.clearProps();
  }

  dispose(): void {
    this.far.dispose();
    this.mid.dispose();
    this.near.dispose();
  }
}

/**
 * Detach a cloned prop subtree.
 *
 * `Object3D.clone` shares geometry and materials with its source, so disposing
 * them here would break every other clone and the loaded original. The loaded
 * source assets own disposal; clones only need to be removed from the graph,
 * which the caller has already done.
 */
export function disposeTree(root: THREE.Object3D): void {
  root.clear();
}
