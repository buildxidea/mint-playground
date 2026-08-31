import * as THREE from 'three';
import { PropLibrary } from '../assets/PropLibrary';
import { MowerInput } from '../core/MowerInput';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { DEFAULT_MOWER, Mower } from '../entities/Mower';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { Clippings } from '../systems/Clippings';
import { AXIS_EW, AXIS_NS, CoverageGrid } from '../systems/CoverageGrid';
import { DEFAULT_GRASS, GrassRenderer } from '../systems/GrassRenderer';
import { Hud } from '../systems/Hud';
import { LawnMask } from '../systems/LawnMask';
import { PostFx } from '../systems/PostFx';
import {
  isUnlocked,
  loadProgress,
  saveProgress,
  scoreLevel,
  type LevelResult,
  type Progress,
} from '../systems/Scoring';
import { YardGeometry } from '../systems/YardGeometry';
import { YardScene } from '../systems/YardScene';
import { createSeededRandom } from '../utils/random';
import { LEVELS, type Level } from './levels';

const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

/** Litres per second. Overlap is punished implicitly: re-mowing costs fuel and buys no coverage. */
const BURN = {
  idle: 0.15,
  drive: 0.55,
  tallGrass: 0.5,
  boostMultiplier: 2.2,
  stall: 1.4,
};

/** The lawn is called done at this coverage so the last few blades are not a chore. */
const AUTO_FINISH_COVERAGE = 0.995;

/** Fixed so the stripe contrast never changes. Has X and Z components so both
 *  north-south and east-west lanes catch the light. */
const SUN_DIRECTION = new THREE.Vector3(0.5, 0.7, 0.5).normalize();

const LEVEL_IDS = LEVELS.map((level) => level.id);

/** Where the mower parks for the landing page shot, inside yard 1. It faces
 *  south so the hero camera, which sits south-east of it, sees its front. */
const HERO_POSE = { x: 1.5, z: 1.6, heading: 'south' } as const;

type GameState = 'title' | 'intro' | 'playing' | 'paused' | 'results';

/**
 * `?lowspec=1` thins the grass and drops post-processing. Headless CI renders
 * WebGL in software, where the full blade field cannot hold a frame rate.
 */
function isLowSpec(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('lowspec');
  } catch {
    return false;
  }
}

type LevelRuntime = {
  level: Level;
  yard: YardGeometry;
  grid: CoverageGrid;
  mask: LawnMask;
  grass: GrassRenderer;
  scenery: YardScene;
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 220);
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly postFx: PostFx;
  private readonly input = new MowerInput();
  private readonly hud = new Hud();
  private readonly mower = new Mower();
  private readonly props = new PropLibrary();
  private readonly audio = new AudioSystem();
  private readonly sun = new THREE.DirectionalLight('#fff3d4', 2.5);
  private readonly loop = new Loop(
    (delta) => this.update(delta),
    () => this.render(),
  );

  private rng = createSeededRandom(7);
  private readonly clippings = new Clippings(() => this.rng());
  private readonly dischargePoint = new THREE.Vector3();

  private runtime: LevelRuntime | null = null;
  private levelIndex = 0;
  private state: GameState = 'title';
  private fuel = 0;
  private levelTime = 0;
  private accumulator = 0;
  private frame = 0;
  private elapsed = 0;
  private result: LevelResult | null = null;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private progress: Progress = loadProgress();
  private lastStampX = 0;
  private lastStampZ = 0;
  private propsReady = false;
  private readonly lowSpec = isLowSpec();
  /** Low-spec renders at quarter resolution: this scene is fill-bound, and a
   *  software rasterizer cannot afford the pixels. */
  private readonly maxDpr = isLowSpec() ? 0.5 : 2;
  /** Low-spec caps the whole tick at 60Hz and drawing at 30fps. An uncapped
   *  loop pins the CPU, which starves everything else on the machine. */
  private readonly minTickInterval = isLowSpec() ? 1 / 60 : 0;
  private readonly minRenderInterval = isLowSpec() ? 1 / 30 : 0;
  private pendingDelta = 0;
  private lastRenderAt = -1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    if (this.lowSpec) document.documentElement.classList.add('is-lowspec');
    this.renderer = createRenderer(canvas);
    this.scene.background = new THREE.Color('#c3d0b2');

    const hemisphere = new THREE.HemisphereLight('#f3f7e6', '#5a6146', 1.15);
    this.scene.add(hemisphere);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.bias = -0.0012;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(this.mower.group);
    this.scene.add(this.clippings.points);

    this.postFx = new PostFx(this.renderer, this.scene, this.camera);
    this.postFx.enabled = !this.lowSpec;
    this.renderer.shadowMap.enabled = !this.lowSpec;

    this.showTitleScreen();

    const settingsButton = document.querySelector<HTMLButtonElement>('#settings-button');
    settingsButton?.addEventListener('click', () => this.openSettings());

    this.hud.setMuted(this.audio.isMuted);
    this.hud.onMuteClick(() => this.toggleMute());
    void this.props.loadAll().then(() => {
      this.propsReady = true;
      this.applyPropModels();
    });
    this.installTestHooks();
    this.handleResize();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.postFx.dispose();
    this.audio.dispose();
    this.clippings.dispose();
    this.mower.dispose();
    this.disposeRuntime();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  // ---------------------------------------------------------------- lifecycle

  private loadLevel(index: number): void {
    this.disposeRuntime();

    this.levelIndex = index;
    const level = LEVELS[index];
    const yard = new YardGeometry(level);
    const grid = new CoverageGrid(yard);
    const mask = new LawnMask(yard.maskBounds);
    mask.clear(this.renderer);

    this.rng = createSeededRandom(index + 1);
    const grass = new GrassRenderer(
      level,
      yard,
      mask.texture,
      SUN_DIRECTION,
      () => this.rng(),
      this.lowSpec
        ? { ...DEFAULT_GRASS, bladesPerSquareMeter: 30 }
        : DEFAULT_GRASS,
    );
    const scenery = new YardScene(level, yard);

    this.scene.add(grass.group);
    this.scene.add(scenery.group);

    this.runtime = { level, yard, grid, mask, grass, scenery };

    grid.reset();
    this.fuel = level.fuel;
    this.levelTime = 0;
    this.accumulator = 0;
    this.result = null;
    this.clippings.reset();

    this.mower.reset(level.spawn.x, level.spawn.z, level.spawn.heading);
    this.lastStampX = this.mower.position.x;
    this.lastStampZ = this.mower.position.y;

    this.aimSun(yard);
    this.cameraRig.frame(yard.bounds);
    this.cameraRig.stopPan();

    this.hud.setLevel(level, index, LEVELS.length);
    this.hud.update(1, 0);
    this.hud.showIntro(level, index, LEVELS.length);
    this.state = 'intro';
    this.input.clearHeld();
    this.applyPropModels();
  }

  /** Swap gray-box placeholders for the generated models once they have loaded. */
  private applyPropModels(): void {
    if (!this.propsReady) return;

    const mowerModel = this.props.get('mower');
    if (mowerModel) this.mower.setModel(mowerModel.clone(true), 2);

    if (!this.runtime) return;
    const scenery = this.runtime.scenery;
    const tree = this.props.get('tree');
    if (tree) scenery.setPropModel('tree', tree);
    const flowerbed = this.props.get('flowerbed');
    if (flowerbed) scenery.setPropModel('bush', flowerbed);
    const fence = this.props.get('fence');
    if (fence) scenery.setPropModel('fence', fence);
    const gnome = this.props.get('gnome');
    if (gnome) scenery.setPropModel('gnome', gnome);
  }

  /** Settings pauses the yard. Reachable from the gear button or Esc. */
  private openSettings(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.clearHeld();
    this.renderSettings();
  }

  private renderSettings(): void {
    this.hud.showSettings({
      onResume: () => this.beginPlay(),
      onRestart: () => this.restartLevel(),
      onMenu: () => this.showTitleScreen(),
      onToggleMute: () => {
        this.toggleMute();
        // Redraw so the dialog's own label follows the new state.
        this.renderSettings();
      },
      muted: this.audio.isMuted,
    });
  }

  private restartLevel(): void {
    this.loadLevel(this.levelIndex);
  }

  private toggleMute(): void {
    const muted = this.audio.toggleMuted();
    this.hud.setMuted(muted);
    if (!muted) this.audio.start();
  }

  private beginPlay(): void {
    this.state = 'playing';
    // Browsers only allow an AudioContext to start from a user gesture, and
    // every route into play is one.
    this.audio.start();
    this.hud.hideTitle();
    this.hud.hideOverlay();
    this.cameraRig.stopPan();
  }

  /** The landing page. Level 1 stays loaded behind it so there is a live lawn
   *  under the panels rather than an empty screen. */
  private showTitleScreen(): void {
    // Always rebuild yard 1 so the landing shot is identical every time and no
    // half-mown state from a previous run leaks into it.
    this.loadLevel(0);

    this.state = 'title';
    this.progress = loadProgress();
    this.hud.hideOverlay();
    this.input.clearHeld();

    this.mower.reset(HERO_POSE.x, HERO_POSE.z, HERO_POSE.heading);
    this.lastStampX = HERO_POSE.x;
    this.lastStampZ = HERO_POSE.z;
    this.paintShowcaseStripes();
    this.cameraRig.frameHero(HERO_POSE.x, HERO_POSE.z);
    this.hud.showTitle(
      LEVELS.map((level, index) => ({
        level,
        index,
        unlocked: isUnlocked(index, LEVEL_IDS, this.progress),
        progress: this.progress[level.id],
      })),
      {
        onStart: () => this.startFromTitle(),
        onSelect: (index) => this.selectLevel(index),
      },
    );
  }

  /**
   * Paint alternating lanes straight into the mask for the landing page. Only
   * the mask, never the coverage grid: this is set dressing, not progress, and
   * starting a yard rebuilds both anyway.
   */
  private paintShowcaseStripes(): void {
    const runtime = this.runtime;
    if (!runtime) return;

    const bounds = runtime.yard.bounds;
    const deck = this.mower.deckRadius;
    let northbound = true;

    for (let x = bounds.minX + deck; x <= bounds.maxX - deck; x += deck * 2) {
      const fromZ = northbound ? bounds.maxZ - deck : bounds.minZ + deck;
      const toZ = northbound ? bounds.minZ + deck : bounds.maxZ - deck;
      runtime.mask.stamp(this.renderer, x, fromZ, x, toZ, 0, northbound ? -1 : 1, deck);
      northbound = !northbound;
    }
  }

  /** Continue at the first unlocked yard that has not been passed yet. */
  private startFromTitle(): void {
    if (this.state !== 'title') return;
    const next = LEVELS.findIndex(
      (level, index) =>
        isUnlocked(index, LEVEL_IDS, this.progress) && !this.progress[level.id]?.passed,
    );
    this.selectLevel(next >= 0 ? next : 0);
  }

  private selectLevel(index: number): void {
    if (!isUnlocked(index, LEVEL_IDS, this.progress)) return;
    this.hud.hideTitle();
    this.loadLevel(index);
  }

  private finishLevel(ranOutOfFuel: boolean): void {
    if (!this.runtime || this.state === 'results') return;


    const metrics = this.runtime.grid.metrics();
    const fuelRemaining = Math.max(0, this.fuel) / this.runtime.level.fuel;
    const result = scoreLevel(metrics, this.runtime.level, fuelRemaining);
    this.result = result;
    this.state = 'results';

    saveProgress(this.runtime.level.id, result);
    this.progress = loadProgress();

    this.audio.blip(result.passed ? 660 : 220, result.passed ? 0.22 : 0.34);
    this.cameraRig.startPan();
    this.hud.showResults(
      this.runtime.level,
      result,
      this.levelIndex === LEVELS.length - 1,
      ranOutOfFuel,
    );
  }

  private advance(): void {
    if (!this.result) return;
    const isLast = this.levelIndex === LEVELS.length - 1;
    if (this.result.passed && !isLast) {
      this.loadLevel(this.levelIndex + 1);
    } else {
      this.restartLevel();
    }
  }

  // ------------------------------------------------------------------- update

  private update(rawDelta: number): void {
    // Bank time rather than dropping it, so a skipped tick still advances the
    // simulation on the next one.
    this.pendingDelta += rawDelta;
    if (this.pendingDelta < this.minTickInterval) return;
    const delta = this.pendingDelta;
    this.pendingDelta = 0;

    this.frame += 1;
    this.elapsed += delta;

    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    if (resizeRenderer(this.renderer, this.camera, this.maxDpr)) this.handleResize();

    this.handleActions();

    if (this.state === 'playing') {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
        this.accumulator -= FIXED_STEP;
        steps += 1;
        this.simulate(FIXED_STEP);
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    } else {
      this.audio.update({
        running: false,
        moving: false,
        boosting: false,
        stalled: false,
        cutting: 0,
      });
    }

    this.cameraRig.update(delta);
    this.clippings.update(this.reducedMotion ? 0 : delta);

    if (this.runtime) {
      this.runtime.grass.update(
        this.reducedMotion ? 0 : this.elapsed,
        this.mower.position.x,
        this.mower.position.y,
        this.mower.forward.x,
        this.mower.forward.y,
        this.mower.deckRadius,
      );
      this.hud.update(
        Math.max(0, this.fuel) / this.runtime.level.fuel,
        this.runtime.grid.coverage,
      );
    }

    this.publishDiagnostics();
  }

  private simulate(delta: number): void {
    const runtime = this.runtime;
    if (!runtime) return;

    this.levelTime += delta;

    const requested = this.input.direction;
    const boosting = this.input.isBoosting;
    this.mower.step(delta, requested, boosting, runtime.yard);

    const x = this.mower.position.x;
    const z = this.mower.position.y;
    const axis =
      Math.abs(this.mower.forward.y) >= Math.abs(this.mower.forward.x) ? AXIS_NS : AXIS_EW;

    runtime.mask.stamp(
      this.renderer,
      this.lastStampX,
      this.lastStampZ,
      x,
      z,
      this.mower.forward.x,
      this.mower.forward.y,
      this.mower.deckRadius,
    );
    runtime.grid.stamp(
      this.lastStampX,
      this.lastStampZ,
      x,
      z,
      this.mower.deckRadius,
      axis,
      this.levelTime,
    );
    this.lastStampX = x;
    this.lastStampZ = z;

    // Sample ahead of the deck: the mower has already cut whatever is under it.
    const aheadX = x + this.mower.forward.x * (this.mower.deckRadius + 0.35);
    const aheadZ = z + this.mower.forward.y * (this.mower.deckRadius + 0.35);
    const intoTallGrass =
      runtime.yard.isMowable(aheadX, aheadZ) && runtime.grid.cutAt(aheadX, aheadZ) === 0;

    let burn = BURN.idle;
    if (this.mower.stalled) {
      burn = BURN.stall;
    } else if (this.mower.moving) {
      burn = BURN.drive * (boosting ? BURN.boostMultiplier : 1);
      if (intoTallGrass) burn += BURN.tallGrass;
    }
    this.fuel -= burn * delta;

    this.audio.update({
      running: true,
      moving: this.mower.moving,
      boosting,
      stalled: this.mower.stalled,
      cutting: this.mower.moving && intoTallGrass ? 1 : 0,
    });

    if (this.mower.moving && intoTallGrass && !this.reducedMotion) {
      this.mower.dischargePoint(this.dischargePoint);
      this.clippings.emit(delta, this.dischargePoint, this.mower.forward, 150);
    }

    if (this.fuel <= 0) {
      this.fuel = 0;
      this.finishLevel(true);
      return;
    }
    if (runtime.grid.coverage >= AUTO_FINISH_COVERAGE) {
      this.finishLevel(false);
    }
  }

  private handleActions(): void {
    for (const action of this.input.takeActions()) {
      switch (action) {
        case 'restart':
          if (this.state !== 'title') this.restartLevel();
          break;
        case 'menu':
          if (this.state !== 'title') this.showTitleScreen();
          break;
        case 'pause':
          if (this.state === 'playing') this.openSettings();
          else if (this.state === 'paused') this.beginPlay();
          break;
        case 'confirm':
          if (this.state === 'title') this.startFromTitle();
          else if (this.state === 'intro') this.beginPlay();
          else if (this.state === 'results') this.advance();
          else if (this.state === 'paused') this.beginPlay();
          break;
        case 'finish':
          if (this.state === 'playing') this.finishLevel(false);
          break;
      }
    }

    // Reaching for a direction key is also a request to start mowing.
    if (this.state === 'intro' && this.input.direction) this.beginPlay();
  }

  private render(): void {
    if (this.minRenderInterval > 0) {
      if (this.elapsed - this.lastRenderAt < this.minRenderInterval) return;
      this.lastRenderAt = this.elapsed;
    }
    this.postFx.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------- setup

  private aimSun(yard: YardGeometry): void {
    const bounds = yard.bounds;
    const radius = Math.hypot(bounds.width, bounds.depth) * 0.6;
    this.sun.position.set(
      bounds.centerX + SUN_DIRECTION.x * radius * 2,
      SUN_DIRECTION.y * radius * 2,
      bounds.centerZ + SUN_DIRECTION.z * radius * 2,
    );
    this.sun.target.position.set(bounds.centerX, 0, bounds.centerZ);
    this.sun.target.updateMatrixWorld();

    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -radius;
    shadowCamera.right = radius;
    shadowCamera.top = radius;
    shadowCamera.bottom = -radius;
    shadowCamera.far = radius * 6;
    shadowCamera.updateProjectionMatrix();
  }

  private handleResize(): void {
    this.cameraRig.refit();
    this.postFx.setSize(this.canvas.width, this.canvas.height);
  }

  private disposeRuntime(): void {
    if (!this.runtime) return;
    this.scene.remove(this.runtime.grass.group);
    this.scene.remove(this.runtime.scenery.group);
    this.runtime.grass.dispose();
    this.runtime.scenery.dispose();
    this.runtime.mask.dispose();
    this.runtime = null;
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        if (name === 'active-play') this.beginPlay();
        else if (name === 'complete') this.finishLevel(false);
        else if (name === 'intro') this.restartLevel();
        else if (name === 'title') this.showTitleScreen();
        else console.warn(`Unknown test state: ${name}`);
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => {
        // No debug UI ships in this build.
      },
      loadLevel: (index: number) => {
        if (index < 0 || index >= LEVELS.length) return;
        // Bypasses the unlock rule on purpose: tests need every yard.
        this.hud.hideTitle();
        this.loadLevel(index);
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const level = this.runtime?.level;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      state: this.state,
      levelId: level?.id ?? '',
      levelIndex: this.levelIndex,
      coverage: this.runtime?.grid.coverage ?? 0,
      fuel: level ? Math.max(0, this.fuel) / level.fuel : 0,
      grade: this.result?.grade ?? null,
      passed: this.result?.passed ?? false,
      bestScore: level ? (this.progress[level.id]?.score ?? 0) : 0,
      muted: this.audio.isMuted,
      blades: this.runtime?.grass.bladeCount ?? 0,
      player: {
        position: { x: this.mower.position.x, y: 0, z: this.mower.position.y },
        speed: this.mower.moving ? DEFAULT_MOWER.speed : 0,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.maxDpr),
      },
    };
  }
}
