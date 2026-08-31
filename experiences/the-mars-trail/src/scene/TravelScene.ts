/**
 * The travel scene for THE MARS TRAIL.
 *
 * Assembles the reference frame's layer stack: sky dome, three parallax bands,
 * the ship and its drive-core team, and drifting particulate — all lit per leg
 * and rendered through the low-resolution pixel pipeline.
 */

import * as THREE from 'three';
import { Backdrop } from './Backdrop';
import { ParallaxLayers } from './ParallaxLayers';
import { Particulate } from './Particulate';
import { ShipRig } from './ShipRig';
import { lerpPalette, paletteFor, type ScenePalette } from './palettes';

export interface SceneFrameState {
  /** Scene palette key from the current leg. */
  sceneKey: string;
  /** 0-1 normalised travel rate; drives parallax and particulate speed. */
  travelRate: number;
  /** 0-1 burn intensity from the chosen burn rate. */
  burnFactor: number;
  /** Working drive cores, drawn as the team ahead of the hull. */
  coreCount: number;
  /** Freeze ambient motion for deterministic screenshots. */
  reducedMotion: boolean;
}

/** How long a leg change takes to cross-fade, in seconds. */
const PALETTE_FADE_SECONDS = 2.2;

export class TravelScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 400);

  readonly backdrop: Backdrop;
  readonly layers: ParallaxLayers;
  readonly ship = new ShipRig();
  readonly particulate: Particulate;

  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly rim: THREE.DirectionalLight;

  private fromPalette: ScenePalette;
  private toPalette: ScenePalette;
  private fadeElapsed = PALETTE_FADE_SECONDS;
  private currentKey: string;

  constructor(
    private readonly rng: () => number,
    initialSceneKey = 'earth-orbit',
  ) {
    this.currentKey = initialSceneKey;
    this.fromPalette = paletteFor(initialSceneKey);
    this.toPalette = this.fromPalette;

    this.backdrop = new Backdrop(rng);
    this.layers = new ParallaxLayers(rng);
    this.particulate = new Particulate(rng);

    this.scene.add(this.backdrop.group);
    this.scene.add(this.layers.group);
    this.scene.add(this.ship.group);
    this.scene.add(this.particulate.points);

    this.hemi = new THREE.HemisphereLight('#8fc7e8', '#123048', 1.5);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff4d6', 3.1);
    this.sun.position.set(8, 6, 5);
    this.scene.add(this.sun);

    // A cool counter-light keeps the shadowed side of the hull from going to
    // pure black once the palette clamp quantises it.
    this.rim = new THREE.DirectionalLight('#7fb6e0', 0.85);
    this.rim.position.set(-6, 2, -4);
    this.scene.add(this.rim);

    // Framing matches the reference: subject right of centre, horizon low.
    this.camera.position.set(0, -1.1, 15.5);
    this.camera.lookAt(2.4, -2.6, 0);

    this.applyPalette(this.fromPalette);
  }

  /** Cross-fade into a different leg's palette. */
  setSceneKey(sceneKey: string): void {
    if (sceneKey === this.currentKey) return;
    this.currentKey = sceneKey;
    this.fromPalette = this.activePalette();
    this.toPalette = paletteFor(sceneKey);
    this.fadeElapsed = 0;
  }

  private activePalette(): ScenePalette {
    if (this.fadeElapsed >= PALETTE_FADE_SECONDS) return this.toPalette;
    return lerpPalette(this.fromPalette, this.toPalette, this.fadeElapsed / PALETTE_FADE_SECONDS);
  }

  private applyPalette(palette: ScenePalette): void {
    this.scene.fog = new THREE.Fog(palette.fog, palette.fogNear, palette.fogFar);
    this.backdrop.applyPalette(palette);
    this.layers.applyPalette(palette);
    this.particulate.setPalette(palette.particleColor, palette.particleDensity);

    this.sun.color.set(palette.sunColor);
    this.sun.intensity = palette.sunIntensity;
    this.sun.position.set(...palette.sunPosition);
    this.hemi.color.set(palette.hemiSky);
    this.hemi.groundColor.set(palette.hemiGround);
    this.hemi.intensity = palette.hemiIntensity;
  }

  /**
   * Scatter generated props across the parallax bands for the current leg.
   * Called after the Mint packs resolve, and again on each leg change.
   */
  populateProps(options: {
    debris: THREE.Object3D[];
    asteroids: THREE.Object3D[];
    stations: THREE.Object3D[];
    sceneKey: string;
  }): void {
    const { debris, asteroids, stations, sceneKey } = options;
    this.layers.clearAllProps();

    switch (sceneKey) {
      case 'earth-orbit':
        this.layers.mid.setProps(stations, 2, this.rng, { scale: [0.5, 0.8], tumble: false, yJitter: 3 });
        this.layers.near.setProps(debris, 5, this.rng, { scale: [0.3, 0.6], tumble: true, yJitter: 4 });
        break;
      case 'debris-belt':
        this.layers.far.setProps(debris, 7, this.rng, { scale: [0.5, 0.9], tumble: true, yJitter: 6 });
        this.layers.mid.setProps(debris, 9, this.rng, { scale: [0.6, 1.1], tumble: true, yJitter: 5 });
        this.layers.near.setProps(debris, 5, this.rng, { scale: [0.8, 1.5], tumble: true, yJitter: 4 });
        break;
      case 'deep-quiet':
        // Deliberately almost empty. The absence is the point of this leg.
        this.layers.far.setProps(asteroids, 2, this.rng, { scale: [0.3, 0.5], tumble: true, yJitter: 7 });
        break;
      case 'asteroid-fringe':
        this.layers.far.setProps(asteroids, 8, this.rng, { scale: [0.7, 1.4], tumble: true, yJitter: 7 });
        this.layers.mid.setProps(asteroids, 10, this.rng, { scale: [0.5, 1.1], tumble: true, yJitter: 6 });
        this.layers.near.setProps(asteroids, 6, this.rng, { scale: [0.4, 0.9], tumble: true, yJitter: 4 });
        break;
      case 'mars-approach':
        this.layers.far.setProps(stations, 1, this.rng, { scale: [0.6, 0.9], tumble: false, yJitter: 2 });
        this.layers.mid.setProps(asteroids, 4, this.rng, { scale: [0.4, 0.8], tumble: true, yJitter: 5 });
        break;
      default:
        break;
    }
  }

  update(delta: number, elapsed: number, state: SceneFrameState): void {
    if (this.fadeElapsed < PALETTE_FADE_SECONDS) {
      this.fadeElapsed = Math.min(PALETTE_FADE_SECONDS, this.fadeElapsed + delta);
      this.applyPalette(this.activePalette());
    }

    const animDelta = state.reducedMotion ? 0 : delta;
    const animElapsed = state.reducedMotion ? 0 : elapsed;

    this.layers.update(animDelta, state.travelRate, animElapsed);
    this.backdrop.update(animDelta, state.travelRate);
    this.particulate.update(animDelta, state.travelRate);
    this.ship.setCoreCount(state.coreCount);
    this.ship.update(animDelta, animElapsed, state.burnFactor);
  }

  /** Near-band scroll offset. QA asserts this rises, proving leftward travel. */
  get scrollX(): number {
    return this.layers.near.scrollX;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.backdrop.dispose();
    this.layers.dispose();
    this.particulate.dispose();
    this.ship.dispose();
  }
}
