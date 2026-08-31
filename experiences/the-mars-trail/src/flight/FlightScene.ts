/**
 * The scene for playable flight sequences.
 *
 * Deliberately separate from `TravelScene`. Every layout assumption there is
 * inverted here: the camera moves, the ship steers, and the world flows toward
 * the viewer in +z rather than scrolling sideways in +x.
 *
 * What it does reuse: the loaded Mint prop families, the per-leg palettes, and
 * the same render pipeline via `setSceneAndCamera`.
 */

import * as THREE from 'three';
import { ChaseCamera } from './ChaseCamera';
import { CloudLayer } from './CloudLayer';
import { ObstacleField } from './ObstacleField';
import { paletteFor, type ScenePalette } from '../scene/palettes';
import { createGlowTexture } from '../scene/glow';
import type { FlightConfig, FlightRunView } from './model/types';

/** Ground plane span. Wider than the camera far plane so its edge never shows. */
const GROUND_SIZE = 2600;

/** Star count. Fewer than the travel backdrop; the eye is busy here. */
const STAR_COUNT = 600;

/** Altitude band over which the camera swings from pad shot to flying shot. */
const HANDOVER_START = 120;
const HANDOVER_END = 900;

/** World units the ground sinks per unit of altitude. The ship never moves. */
const GROUND_DROP = 0.5;

/** Altitude past which ground and complex are hidden. Beyond the handover. */
const GROUND_HIDE_ALTITUDE = 1100;

/** Resting height of the ground plane, level with the base of the pad. */
const GROUND_Y = -6;

/** Climb fraction by which the ground haze has thinned to nothing. */
const HAZE_FADES_BY = 0.34;

/** Reused rather than allocated per frame when tinting the cloud deck. */
const WHITE = new THREE.Color('#ffffff');

/**
 * Ascent sky, as flat opaque bands rather than a gradient.
 *
 * Each band is a single solid colour held until the next altitude threshold,
 * so climbing reads as passing through distinct layers of atmosphere. A smooth
 * gradient would blend them into mush and lose that.
 */
// Dawn: amber at the pan, cooling to violet, deep blue, then vacuum.
const ASCENT_SKY: Array<{ upTo: number; color: string; ground: string }> = [
  { upTo: 0.1, color: '#d8955f', ground: '#9c6a41' },
  { upTo: 0.22, color: '#b57f6b', ground: '#845738' },
  { upTo: 0.36, color: '#7d6b8c', ground: '#6f4f33' },
  { upTo: 0.52, color: '#4c5688', ground: '#573e29' },
  { upTo: 0.68, color: '#2b3a6b', ground: '#402e1f' },
  { upTo: 0.84, color: '#111d40', ground: '#2a1e15' },
  { upTo: 1.01, color: '#05070f', ground: '#14110c' },
];

function ascentBand(progress: number) {
  for (const band of ASCENT_SKY) if (progress < band.upTo) return band;
  return ASCENT_SKY[ASCENT_SKY.length - 1];
}

export class FlightScene {
  readonly scene = new THREE.Scene();
  readonly chase = new ChaseCamera();
  readonly obstacles = new ObstacleField();
  readonly clouds: CloudLayer;

  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly rim: THREE.DirectionalLight;

  private readonly shipHost = new THREE.Group();
  private shipModel: THREE.Object3D | null = null;

  /** Ascent exhaust: hot core plus wider wash, dark until ignition. */
  private readonly plumeHost = new THREE.Group();
  private readonly plumeCore: THREE.Sprite;
  private readonly plumeWash: THREE.Sprite;
  private readonly plumeCoreMaterial: THREE.SpriteMaterial;
  private readonly plumeWashMaterial: THREE.SpriteMaterial;

  /** The exhaust as a light source, so ignition underlights the whole site. */
  private readonly plumeLight = new THREE.PointLight('#ffa044', 0, 44, 2);

  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;

  private readonly ground: THREE.Mesh;
  private readonly groundMaterial: THREE.MeshStandardMaterial;

  private palette: ScenePalette = paletteFor('debris-belt');
  private config: FlightConfig | null = null;

  /** Ground haze for the ascent. Built lazily; only the launch uses it. */
  private haze: THREE.Fog | null = null;

  // The ship never moves, so the complex is lifted to meet its tail. Both
  // measured off the real models rather than tuned.
  private shipBaseY = -2.1;
  private padDeckY: number | null = null;
  private padRestY = 0;

  /** The launch complex: pad, gantry, tanks, berm, and the mesa horizon. */
  private readonly padHost = new THREE.Group();
  private readonly cloudTint = new THREE.Color('#ffffff');

  constructor(private readonly rng: () => number) {
    this.clouds = new CloudLayer(rng);
    this.scene.add(this.clouds.group);

    this.hemi = new THREE.HemisphereLight('#8fc7e8', '#123048', 2);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff4d6', 3.4);
    this.sun.position.set(8, 10, 6);
    this.scene.add(this.sun);

    // Keeps the shadowed side of the hull off pure black as it banks.
    this.rim = new THREE.DirectionalLight('#7fb6e0', 0.9);
    this.rim.position.set(-7, 2, 5);
    this.scene.add(this.rim);

    this.scene.add(this.shipHost);
    this.scene.add(this.obstacles.group);
    this.scene.add(this.padHost);

    this.plumeCoreMaterial = new THREE.SpriteMaterial({
      map: createGlowTexture('rgba(255,255,255,0.95)', '255,214,140'),
      color: '#fff0c8',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.plumeWashMaterial = new THREE.SpriteMaterial({
      map: createGlowTexture('rgba(255,190,120,0.8)', '255,132,52'),
      color: '#ff9a4a',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.plumeCore = new THREE.Sprite(this.plumeCoreMaterial);
    this.plumeWash = new THREE.Sprite(this.plumeWashMaterial);
    this.plumeHost.add(this.plumeWash);
    this.plumeHost.add(this.plumeCore);
    this.plumeHost.add(this.plumeLight);
    this.plumeHost.visible = false;
    this.shipHost.add(this.plumeHost);

    // --- starfield -------------------------------------------------------
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      positions[i * 3] = (rng() - 0.5) * 500;
      positions[i * 3 + 1] = (rng() - 0.5) * 320;
      positions[i * 3 + 2] = -rng() * 700;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 1.1,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.scene.add(this.stars);

    // --- ground ----------------------------------------------------------
    // Used by the launch (falls away beneath you) and the descent (rises to
    // meet you). Hidden entirely in deep space.
    this.groundMaterial = new THREE.MeshStandardMaterial({
      color: '#6d6350',
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 24, 24),
      this.groundMaterial,
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.visible = false;
    this.scene.add(this.ground);
  }

  /**
   * Install the vehicle, the one object that steers. Modelled upright for the
   * pad, so the launch pitches it over during the handover.
   */
  setShipModel(model: THREE.Object3D): void {
    if (this.shipModel) this.shipHost.remove(this.shipModel);
    this.shipModel = model;
    // The tail in its upright pose: what the pad is seated against.
    model.rotation.set(0, 0, 0);
    model.updateMatrixWorld(true);
    this.shipBaseY = new THREE.Box3().setFromObject(model).min.y;
    this.seatComplex();
    // Nose along the corridor. The launch overrides this each frame.
    model.rotation.set(-Math.PI / 2, 0, 0);
    this.shipHost.add(model);
  }

  /**
   * Prepare for a sequence. Called once, before the first step.
   *
   * @param props loaded GLBs for this sequence's family; may be empty if the
   *   family is still streaming, in which case placeholders stand in.
   */
  begin(config: FlightConfig, props: THREE.Object3D[], padProps: THREE.Object3D[] = []): void {
    this.config = config;
    this.palette = paletteFor(config.sceneKey);
    this.applyPalette(this.palette);
    this.obstacles.populate(props, config.capacity, this.rng);
    this.clouds.reset(this.rng, config.spawnDepth);
    this.chase.reset();

    const grounded = config.id === 'launch' || config.id === 'mars-descent';
    this.ground.visible = grounded;
    if (grounded) {
      this.groundMaterial.color.set(config.id === 'launch' ? '#6d7f55' : '#a2542a');
    }

    this.plumeHost.visible = false;
    this.clearPad();
    if (config.id === 'launch') this.buildPad(padProps);
  }

  /** Replace the obstacle models once their family has streamed in. */
  rebuildObstacles(props: THREE.Object3D[]): void {
    if (!this.config || props.length === 0) return;
    this.obstacles.populate(props, this.config.capacity, this.rng);
  }

  /** Replace the launch complex once its assets have streamed in. */
  rebuildPad(props: THREE.Object3D[]): void {
    if (this.config?.id !== 'launch') return;
    this.clearPad();
    this.buildPad(props);
  }

  /**
   * Lay out the launch complex. Six generated pieces reused at many scales and
   * rotations: the apron is also a hardstand, the gantry also a floodlight
   * mast. Placement is by index, so a missing prop just leaves a gap.
   */
  private buildPad(props: THREE.Object3D[]): void {
    if (props.length === 0) return;

    // desert-01..06 in key order.
    const APRON = 0;
    const TOWER = 1;
    const SLAB = 2;
    const MESA = 3;
    const HANGAR = 4;
    const RIDGE = 5;

    interface Placement {
      index: number;
      pos: [number, number, number];
      scale: number;
      rotY?: number;
      /** The one piece the vehicle stands on. Its deck seats the whole site. */
      seat?: boolean;
    }

    const layout: Placement[] = [
      // --- the pad itself ------------------------------------------------
      { index: APRON, pos: [0, -5.6, 0], scale: 4.5, seat: true },
      { index: TOWER, pos: [-6.5, -3.4, -1], scale: 5.5 },
      // Flame trench shoulders.
      { index: SLAB, pos: [0, -6.4, 7], scale: 5, rotY: 0.15 },
      { index: SLAB, pos: [-1, -6.4, -8], scale: 5.5, rotY: -0.2 },

      // --- immediate site ------------------------------------------------
      // Floodlight masts. All kept behind the pad in z, or they upstage it.
      { index: TOWER, pos: [11, -5.2, -6], scale: 2.1, rotY: 1.1 },
      { index: TOWER, pos: [-13, -5.2, -3], scale: 1.9, rotY: -0.7 },
      { index: TOWER, pos: [14, -5.2, -20], scale: 2.3, rotY: 2.4 },
      // Fuel farm and support buildings.
      { index: HANGAR, pos: [24, -5.2, -22], scale: 3.4, rotY: 0.5 },
      { index: HANGAR, pos: [-26, -5.2, -18], scale: 3, rotY: -1.2 },
      { index: APRON, pos: [19, -5.9, -30], scale: 3.2, rotY: 0.8 },

      // --- middle distance: the working spaceport ------------------------
      { index: HANGAR, pos: [34, -5, -38], scale: 8 },
      { index: HANGAR, pos: [-42, -5, -52], scale: 9.5, rotY: 0.9 },
      { index: HANGAR, pos: [62, -5, -74], scale: 11, rotY: -0.5 },
      { index: HANGAR, pos: [-78, -5, -96], scale: 12, rotY: 1.7 },
      // Secondary pads out on the pan, with their own towers beside them.
      { index: APRON, pos: [-30, -5.8, -30], scale: 7, rotY: 0.35 },
      { index: TOWER, pos: [-36, -3.6, -31], scale: 5 },
      { index: APRON, pos: [48, -5.8, -56], scale: 8, rotY: -0.6 },
      { index: TOWER, pos: [55, -3.4, -58], scale: 5.5, rotY: 1.4 },
      // Access road. The slab is a ground tile, so only where it reads as
      // poured concrete — on open pan it looks like terrain patches.
      { index: SLAB, pos: [12, -6.2, -24], scale: 9, rotY: 0.2 },

      // --- berms: the lakebed shelf the site sits on ----------------------
      { index: RIDGE, pos: [-70, -6.2, -70], scale: 26, rotY: 0.1 },
      { index: RIDGE, pos: [96, -6.2, -110], scale: 30, rotY: -0.8 },

      // --- horizon: layered mesas -----------------------------------------
      // The piece is a wide low ridge, so it only reads as a mesa this large.
      // Ranks overlap, giving the haze something to separate.
      { index: MESA, pos: [-90, -8, -180], scale: 95, rotY: 0.4 },
      { index: MESA, pos: [130, -8, -215], scale: 110, rotY: -0.9 },
      { index: MESA, pos: [-40, -10, -290], scale: 150, rotY: 1.3 },
      { index: MESA, pos: [280, -10, -330], scale: 165, rotY: 2.1 },
      { index: MESA, pos: [-330, -12, -400], scale: 200, rotY: -0.3 },
      { index: MESA, pos: [90, -12, -470], scale: 230, rotY: 1.8 },
    ];

    for (const entry of layout) {
      const source = props[entry.index];
      if (!source) continue;
      const object = source.clone(true);
      object.position.set(...entry.pos);
      object.scale.setScalar(entry.scale);
      if (entry.rotY) object.rotation.y = entry.rotY;
      // Measured before parenting, so it is the piece's own extent.
      if (entry.seat) {
        object.updateMatrixWorld(true);
        this.padDeckY = new THREE.Box3().setFromObject(object).max.y;
      }
      this.padHost.add(object);
    }

    this.seatComplex();
  }

  private clearPad(): void {
    for (const child of [...this.padHost.children]) {
      this.padHost.remove(child);
      child.clear();
    }
    this.padDeckY = null;
    this.seatComplex();
  }

  /** Lift the complex so the deck meets the tail. Pad and hull arrive in
   * either order, so this is called from both. */
  private seatComplex(): void {
    this.padRestY = this.padDeckY === null ? 0 : this.shipBaseY - this.padDeckY;
  }

  private applyPalette(palette: ScenePalette): void {
    this.scene.background = new THREE.Color(palette.skyBottom);
    this.scene.fog = new THREE.Fog(palette.fog, palette.fogNear, palette.fogFar);

    this.sun.color.set(palette.sunColor);
    this.sun.intensity = palette.sunIntensity;
    this.sun.position.set(...palette.sunPosition);
    this.hemi.color.set(palette.hemiSky);
    this.hemi.groundColor.set(palette.hemiGround);
    this.hemi.intensity = palette.hemiIntensity;

    this.starMaterial.opacity = 0.15 + palette.starDensity * 0.8;
    this.stars.visible = palette.starDensity > 0.02;
  }

  update(delta: number, view: FlightRunView, boosting: boolean, reducedMotion: boolean): void {
    const config = this.config;
    if (!config) return;

    // The launch climbs out of the atmosphere: cross-fade the daylight palette
    // toward space as altitude builds. This is the whole point of the sequence,
    // so it is driven by progress rather than being a fixed backdrop.
    if (config.id === 'launch') {
      // Everything here keys off altitude, never elapsed time, or the pad
      // starts sinking while the vehicle is still clamped down.
      const climbed = view.climb;
      const rise = Math.max(
        0,
        Math.min(1, (view.altitude - HANDOVER_START) / (HANDOVER_END - HANDOVER_START)),
      );
      const swing = rise * rise * (3 - 2 * rise);
      const padWeight = 1 - swing;

      // Flat opaque bands rather than a gradient: the climb reads as passing
      // through distinct layers.
      const band = ascentBand(climbed);
      this.scene.background = new THREE.Color(band.color);
      this.groundMaterial.color.set(band.ground);

      // Haze separates the mesa ranks. Thins with the air.
      if (climbed < HAZE_FADES_BY) {
        const thinning = 1 - climbed / HAZE_FADES_BY;
        if (!this.haze) this.haze = new THREE.Fog(band.color, 0, 1);
        this.haze.color.set(band.color);
        this.haze.near = 95 + (1 - thinning) * 400;
        this.haze.far = 520 + (1 - thinning) * 1600;
        this.scene.fog = this.haze;
      } else {
        this.scene.fog = null;
      }

      // Daylight, not a floodlight. The palette's pad values were bright enough
      // that the pale complex clipped to white and bloomed; these keep the
      // ground read while leaving the hull and the plume the brightest things
      // on screen.
      this.sun.intensity = 2.5 - climbed * 1.4;
      this.hemi.intensity = 1.4 - climbed * 1;
      this.starMaterial.opacity = Math.max(0, (climbed - 0.55) * 2);
      this.stars.visible = climbed > 0.55;

      // Nothing below once the vehicle is clear: no horizon, no cue that you
      // are flying sideways.
      const drop = view.altitude * GROUND_DROP;
      const grounded = view.altitude < GROUND_HIDE_ALTITUDE;
      this.ground.position.y = GROUND_Y + this.padRestY - drop;
      this.ground.visible = grounded;
      this.padHost.position.y = this.padRestY - drop;
      this.padHost.visible = grounded;

      // The gravity turn: upright on the pad, nose along the corridor in flight.
      if (this.shipModel) {
        this.shipModel.rotation.x = -Math.PI / 2 + padWeight * (Math.PI / 2);
      }

      // Exhaust, lit the moment the engines catch. Under the vehicle on the
      // pad, behind it once pitched over.
      const lit =
        view.stage === 'ignition' || view.stage === 'boost' || view.stage === 'staged'
          ? view.throttle
          : view.stage === 'flying'
            ? 0.45
            : 0;
      this.plumeHost.visible = lit > 0.01;
      if (this.plumeHost.visible) {
        const flicker = 0.88 + Math.sin(view.seconds * 34) * 0.12;
        this.plumeHost.position.set(0, padWeight * -2.6, (1 - padWeight) * 2.6);
        // Drawn out downward when vertical, round once seen from behind.
        const stretch = 1 + padWeight * 0.7;
        // Eased down as the camera moves onto the nose, or it swamps the frame.
        const size = (1 + lit * 1.5) * flicker * (0.55 + padWeight * 0.45);
        this.plumeCore.scale.set(size * 0.5, size * 0.5 * stretch, 1);
        this.plumeWash.scale.set(size * 1.15, size * 1.15 * stretch, 1);
        this.plumeCoreMaterial.opacity = Math.min(1, 0.3 + lit * 0.6);
        this.plumeWashMaterial.opacity = Math.min(0.6, 0.15 + lit * 0.4);
        // Pointless once there is nothing below to light.
        const nearGround = Math.max(0, 1 - view.altitude / GROUND_HIDE_ALTITUDE);
        this.plumeLight.intensity = lit * flicker * 620 * nearGround;
      } else {
        this.plumeLight.intensity = 0;
      }

      // Rattles hardest while the clamps still take the load.
      this.chase.setRumble(lit * (0.55 + 0.45 * (1 - Math.min(1, view.altitude / 400))));

      // Cloud deck: nothing at ground level so the complex reads cleanly,
      // building as you climb and thinning above the weather. Scenery only.
      const deck =
        climbed < 0.09 ? 0 : Math.max(0, Math.min(1, 1 - Math.abs(climbed - 0.26) / 0.19));
      this.cloudTint.set(band.color).lerp(WHITE, 0.72);
      this.clouds.update(delta, view.speed * 1.25, deck, this.cloudTint);

      this.chase.setPrelaunch(view.prelaunch);
      this.chase.setLaunchFraming(padWeight);
    } else if (config.id === 'mars-descent') {
      this.plumeHost.visible = false;
      this.plumeLight.intensity = 0;
      this.chase.clearLaunchFraming();
      this.clouds.update(delta, view.speed, 0, this.cloudTint);
      // The surface rises to meet you.
      this.ground.position.y = -150 + view.progress * 142;
    }

    this.shipHost.position.set(view.shipX, view.shipY, 0);
    // Bank into the turn and pitch with vertical input.
    const bank = Math.max(-1, Math.min(1, view.shipVX * 0.055));
    this.shipHost.rotation.z = -bank * 0.55;
    this.shipHost.rotation.x = Math.max(-0.3, Math.min(0.3, -view.shipVY * 0.03));

    // A hit makes the hull flash and kicks the camera.
    if (this.shipModel) {
      this.shipModel.visible = !view.invulnerable || Math.floor(view.seconds * 18) % 2 === 0;
    }


    this.obstacles.syncFrom(view.bodies);

    // Stars drift very slowly so deep space still reads as motion.
    if (!reducedMotion) {
      this.stars.position.z = (view.seconds * view.speed * 0.05) % 200;
    }

    this.chase.update(delta, view, boosting, reducedMotion);
  }

  resize(aspect: number): void {
    this.chase.resize(aspect);
  }

  dispose(): void {
    this.obstacles.dispose();
    this.clouds.dispose();
    this.plumeCoreMaterial.map?.dispose();
    this.plumeWashMaterial.map?.dispose();
    this.plumeCoreMaterial.dispose();
    this.plumeWashMaterial.dispose();
    this.starMaterial.dispose();
    this.stars.geometry.dispose();
    this.groundMaterial.dispose();
    this.ground.geometry.dispose();
  }
}
