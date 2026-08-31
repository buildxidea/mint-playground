import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BoatInput } from '../core/BoatInput';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { loadAllModels, cloneModel, type LoadedModel } from '../assets/loadModels';
import type { ModelAssetId } from '../assets/registry';
import { LEVELS } from '../levels/levels';
import { buildMarina, type BuiltMarina } from '../levels/MarinaBuilder';
import { SHOWCASE_LEVEL_INDICES, type LevelDef } from '../levels/LevelDef';
import { updateSlipMarker } from '../levels/SlipMarker';
import { liftFloating } from '../levels/grounding';
import { AudioBus } from '../systems/AudioBus';
import { BoatPhysics } from '../systems/BoatPhysics';
import {
  loadSelectedBoatId,
  saveSelectedBoatId,
  tuningForBoat,
  type PlayerBoatId,
  isPlayerBoatId,
} from '../boats/playerBoats';
import { ChaseCamera } from '../systems/ChaseCamera';
import { CollisionSystem } from '../systems/CollisionSystem';
import { DockingZoneSystem } from '../systems/DockingZoneSystem';
import { Hud } from '../systems/Hud';
import { ScoringSystem, type ScoreBreakdown } from '../systems/ScoringSystem';
import {
  createWater,
  setWaterDebugMode,
  updateWater,
  type WaterDebugMode,
} from '../systems/Water';
import { WindSystem, type WindSample } from '../systems/WindSystem';
import { WaveSystem, type WaveSample } from '../systems/WaveSystem';
import { TrafficSystem } from '../systems/TrafficSystem';
import { Autopilot } from '../systems/Autopilot';
import { createSeededRandom } from '../utils/random';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { CollisionDebugView } from '../systems/CollisionDebugView';
import { FloatingBodySystem, type FloatingBodySpec } from '../systems/FloatingBodySystem';
import { SinkingSystem } from '../systems/SinkingSystem';
import { PlayerWakeSystem } from '../systems/PlayerWakeSystem';

type Phase = 'loading' | 'menu' | 'play' | 'sinking' | 'failed' | 'result';

const FIXED_DT = 1 / 60;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.2, 140);
  private readonly input: BoatInput;
  private readonly physics = new BoatPhysics();
  private readonly collision = new CollisionSystem();
  private readonly docking = new DockingZoneSystem();
  private readonly scoring = new ScoringSystem();
  private readonly audio = new AudioBus();
  private readonly hud = new Hud();
  private readonly chase = new ChaseCamera(this.camera);
  private readonly wind = new WindSystem({ x: 0, z: 0 }, 0, () => this.rng());
  private readonly waves = new WaveSystem(() => this.rng());
  private readonly traffic = new TrafficSystem();
  private readonly floatingBodies = new FloatingBodySystem();
  private readonly sinking = new SinkingSystem();
  private readonly playerWake = new PlayerWakeSystem();
  private lastWindSample: WindSample = {
    force: { x: 0, z: 0 },
    torque: 0,
    direction: { x: 0, z: 0 },
    strength: 0,
    gustFactor: 0,
  };
  private lastWaveSample: WaveSample = {
    force: { x: 0, z: 0 },
    torque: 0,
    heave: 0,
    pitch: 0,
    roll: 0,
    amplitude: 0,
    wake: 0,
  };
  private showcaseMode = false;
  private showcaseCursor = 0;
  private showcaseAdvanceAt = 0;
  private showcaseStartedAt = 0;
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private readonly tuning: DebugTuning = {
    speed: 5.8,
    dashMultiplier: 1.75,
    acceleration: 13,
    cameraLag: 0.18,
    exposure: 1.08,
    maxDpr: 2,
  };

  private readonly debugTools: DebugTools;
  private readonly collisionDebug: CollisionDebugView;
  private models: Map<ModelAssetId, LoadedModel> | null = null;
  private marina: BuiltMarina | null = null;
  private boatRoot = new THREE.Group();
  private water: THREE.Mesh | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private environmentMap: THREE.Texture | null = null;

  private phase: Phase = 'loading';
  private levelIndex = 0;
  private frame = 0;
  private averageFrameMs = 16.67;
  private accumulator = 0;
  private paused = false;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private lastScore: ScoreBreakdown | null = null;
  private collisionCooldown = 0;
  private rng = createSeededRandom(1);
  private ready = false;
  private commandOverride: { throttle: number; steer: number; brake: number } | null = null;
  private lastCommand = { throttle: 0, steer: 0, brake: 0 };
  private autopilotEnabled = false;
  private readonly autopilot = new Autopilot();
  private selectedBoatId: PlayerBoatId = loadSelectedBoatId();
  private selectedLevelIndex = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.renderer.shadowMap.enabled = true;

    this.input = new BoatInput(
      this.must('#steer-stick'),
      this.must('#steer-knob'),
      this.must('#throttle-stick'),
      this.must('#throttle-knob'),
      this.must('#brake-button'),
    );

    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });
    this.collisionDebug = new CollisionDebugView(this.scene);
    this.collision.setRng(() => this.rng());

    this.bindUi();
    this.installTestHooks();
    void this.bootstrap();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    this.collisionDebug.dispose();
    this.traffic.dispose();
    this.playerWake.dispose();
    this.floatingBodies.clear();
    this.environmentMap?.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private async bootstrap(): Promise<void> {
    this.hud.setLoading(true, 'Loading marina…');
    try {
      this.hud.setLoading(true, 'Loading boats & docks…');
      this.models = await loadAllModels();
      this.hud.setLoading(true, 'Loading sounds…');
      // Audio fetch only — never await AudioContext.resume() here (can hang pre-gesture).
      await this.audio.loadAll().catch((error) => {
        console.warn('Audio preload failed; continuing without sound.', error);
      });
      this.createLights();
      this.scene.add(this.boatRoot);
      this.scene.add(this.traffic.group);
      this.scene.add(this.playerWake.group);
      this.ready = true;
      this.hud.setLoading(false);
      this.hud.showMenu(true);
      this.phase = 'menu';
      this.loadLevel(0, false);
      this.publishDiagnostics();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load assets';
      this.hud.setLoading(true, message);
      console.error(error);
    }
  }

  private bindUi(): void {
    this.hud.configureLevelPicker(LEVELS, this.selectedLevelIndex, (index) => {
      this.selectedLevelIndex = index;
      if (this.models && this.phase === 'menu') this.loadLevel(index, false);
    });
    this.must('#start-button').addEventListener('click', () => this.beginPlay());
    this.must('#showcase-button').addEventListener('click', () => this.beginShowcase());
    this.must('#next-button').addEventListener('click', () => this.nextLevel());
    this.must('#replay-button').addEventListener('click', () => this.retryLevel());
    this.must('#retry-button').addEventListener('click', () => this.retryLevel());
    this.must('#sink-retry-button').addEventListener('click', () => this.retryLevel());
    this.must('#level-select-button').addEventListener('click', () => this.returnToMenu());
    this.must('#mute-button').addEventListener('click', () => {
      this.audio.setMuted(!this.audio.isMuted());
      this.hud.setMuted(this.audio.isMuted());
    });
    this.bindBoatPicker();
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Enter') {
        if (this.phase === 'menu') this.beginPlay();
        else if (this.phase === 'result' && !this.showcaseMode) this.nextLevel();
      }
      if (event.code === 'Escape' && this.showcaseMode) {
        this.stopShowcase();
      }
    });
  }

  private bindBoatPicker(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.boat-option');
    const sync = (): void => {
      buttons.forEach((button) => {
        const id = button.dataset.boat ?? '';
        button.setAttribute('aria-pressed', id === this.selectedBoatId ? 'true' : 'false');
      });
    };
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.boat ?? '';
        if (!isPlayerBoatId(id)) return;
        this.selectedBoatId = id;
        saveSelectedBoatId(id);
        this.physics.setTuning(tuningForBoat(id));
        sync();
        // Preview hull on the menu marina.
        if (this.phase === 'menu') this.loadLevel(this.levelIndex, false);
      });
    });
    this.physics.setTuning(tuningForBoat(this.selectedBoatId));
    sync();
  }

  private beginPlay(): void {
    if (!this.ready) return;
    void this.audio.unlock();
    this.showcaseMode = false;
    this.autopilotEnabled = false;
    this.hud.showMenu(false);
    this.phase = 'play';
    this.loadLevel(this.selectedLevelIndex, true);
  }

  private beginShowcase(): void {
    if (!this.ready) return;
    void this.audio.unlock();
    this.showcaseMode = true;
    this.showcaseCursor = 0;
    this.showcaseAdvanceAt = 0;
    this.hud.showMenu(false);
    this.loadShowcaseStep();
  }

  private stopShowcase(): void {
    this.showcaseMode = false;
    this.autopilotEnabled = false;
    this.showcaseAdvanceAt = 0;
    this.hud.showMenu(true);
    this.phase = 'menu';
    this.loadLevel(this.selectedLevelIndex, false);
  }

  private loadShowcaseStep(): void {
    const index = SHOWCASE_LEVEL_INDICES[this.showcaseCursor % SHOWCASE_LEVEL_INDICES.length]!;
    this.loadLevel(index, true);
    this.phase = 'play';
    this.autopilot.reset();
    this.autopilotEnabled = true;
    this.commandOverride = null;
    this.showcaseAdvanceAt = 0;
    this.showcaseStartedAt = 0;
  }

  private nextLevel(): void {
    if (this.showcaseMode) {
      this.showcaseCursor = (this.showcaseCursor + 1) % SHOWCASE_LEVEL_INDICES.length;
      this.loadShowcaseStep();
      return;
    }
    if (this.levelIndex < LEVELS.length - 1) {
      this.selectedLevelIndex = this.levelIndex + 1;
      this.hud.setSelectedLevel(this.selectedLevelIndex);
      this.loadLevel(this.selectedLevelIndex, true);
      this.phase = 'play';
    } else {
      this.selectedLevelIndex = 0;
      this.hud.setSelectedLevel(this.selectedLevelIndex);
      this.loadLevel(this.selectedLevelIndex, true);
      this.phase = 'play';
    }
  }

  private retryLevel(): void {
    this.loadLevel(this.levelIndex, true);
    this.phase = 'play';
  }

  private returnToMenu(): void {
    this.showcaseMode = false;
    this.autopilotEnabled = false;
    this.commandOverride = null;
    this.selectedLevelIndex = this.levelIndex;
    this.hud.setSelectedLevel(this.selectedLevelIndex);
    this.phase = 'menu';
    this.loadLevel(this.selectedLevelIndex, false);
    this.hud.showMenu(true);
  }

  private loadLevel(index: number, playing: boolean): void {
    if (!this.models) return;
    this.levelIndex = index;
    const level = LEVELS[index]!;

    if (this.marina) {
      // Clones share Mint geometry/materials — dispose only procedural slip marker meshes.
      this.scene.remove(this.marina.group);
      this.marina.group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.userData.procedural) return;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
    }
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      (this.water.material as THREE.Material).dispose();
    }

    this.marina = buildMarina(level, this.models);
    this.scene.add(this.marina.group);
    this.collision.setObstacles(this.marina.obstacles);
    this.collisionDebug.setStatic(this.marina.obstacles);

    this.wind.set(level.wind, level.wind.gust ?? 0);
    this.waves.set(level.waves, level.wind);
    this.traffic.configure(level.traffic, this.models, this.marina.obstacles);
    this.playerWake.reset();
    this.bindWakeEmitters();

    this.water = createWater(level.basin.halfWidth, level.basin.halfDepth, this.waves);
    this.scene.add(this.water);

    while (this.boatRoot.children.length) {
      this.boatRoot.remove(this.boatRoot.children[0]!);
    }
    this.physics.setTuning(tuningForBoat(this.selectedBoatId));
    const boat = cloneModel(this.models, this.selectedBoatId);
    // Keep normalizeModel() baked Y; only nudge for a light floating draft.
    this.boatRoot.add(boat);
    this.boatRoot.position.set(level.spawn.x, 0, level.spawn.z);
    this.boatRoot.rotation.set(0, level.spawn.yaw, 0);
    // Sit proud of the water — tiny draft only.
    liftFloating(boat, 0.02);

    this.physics.reset(level.spawn.x, level.spawn.z, level.spawn.yaw);
    this.playerWake.reset(this.physics.state, this.physics.getTuning());
    this.syncBoatMesh();
    this.docking.reset();
    this.scoring.reset();
    this.sinking.reset();
    this.hud.hideFailure();
    this.autopilot.reset();
    this.lastWindSample = this.wind.sample(0, level.spawn.yaw);
    this.lastWaveSample = {
      force: { x: 0, z: 0 },
      torque: 0,
      heave: 0,
      pitch: 0,
      roll: 0,
      amplitude: this.waves.getAmplitude(),
      wake: 0,
    };
    this.configureFloatingBodies();
    this.traffic.syncVisuals();
    this.floatingBodies.update(0, 0, this.waves, this.reducedMotion);
    this.chase.snap(this.physics.state);
    this.lastScore = null;
    this.paused = false;
    this.accumulator = 0;
    this.collisionCooldown = 0;
    this.lastCommand = { throttle: 0, steer: 0, brake: 0 };

    this.hud.setLevel(level.name, level.subtitle, index + 1, LEVELS.length);
    this.hud.showMenu(!playing && this.phase === 'menu');
    if (this.sun) {
      this.sun.position.set(-12, 18, 10);
      this.sun.target.position.set(0, 0, 0);
    }
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    if (delta > 0 && delta < 0.25) {
      this.averageFrameMs += (delta * 1000 - this.averageFrameMs) * 0.08;
    }
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);

    if (!this.ready || !this.marina) {
      this.publishDiagnostics();
      return;
    }

    // Keep slip billboards facing the camera even while frozen for screenshots.
    if (this.pausedForScreenshot) {
      updateSlipMarker(this.marina.slipMarker, elapsed, 0, this.camera);
      this.publishDiagnostics();
      return;
    }

    const inputCommand = this.input.read();
    if (inputCommand.mute) {
      this.audio.setMuted(!this.audio.isMuted());
      this.hud.setMuted(this.audio.isMuted());
    }
    if (inputCommand.retry && this.phase !== 'loading' && this.phase !== 'menu') {
      this.retryLevel();
    }
    if (inputCommand.pause && this.phase === 'play') {
      this.paused = !this.paused;
    }

    const level = LEVELS[this.levelIndex]!;
    const animDelta = this.reducedMotion ? 0 : delta;
    let lastThrottle = 0;

    if (this.phase === 'play' && !this.paused) {
      this.accumulator += Math.min(delta, 0.05);
      while (this.accumulator >= FIXED_DT) {
        let command = inputCommand;
        if (this.autopilotEnabled) {
          command = this.autopilot.step(this.physics.state, level, this.docking.getStatus());
        } else if (this.commandOverride) {
          command = {
            ...inputCommand,
            throttle: this.commandOverride.throttle,
            steer: this.commandOverride.steer,
            brake: this.commandOverride.brake,
          };
        }
        lastThrottle = command.throttle;
        this.lastCommand = {
          throttle: command.throttle,
          steer: command.steer,
          brake: command.brake,
        };
        this.stepSimulation(FIXED_DT, command, level);
        this.accumulator -= FIXED_DT;
        if (this.phase !== 'play') {
          this.accumulator = 0;
          break;
        }
      }
      if (this.sinking.isActive()) {
        this.updateSinking(delta, elapsed, level);
      } else {
        const simulationElapsed = this.scoring.getElapsed();
        if (this.water) {
          updateWater(this.water, simulationElapsed, this.reducedMotion, this.waves);
        }
        this.traffic.syncVisuals();
        this.floatingBodies.update(delta, simulationElapsed, this.waves, this.reducedMotion);

        const docking = this.docking.getStatus();
        if (docking.complete && !this.lastScore) {
          this.lastScore = this.scoring.finalize(level, docking);
          this.audio.play('rope_attach', 0.8);
          this.audio.play('success_chime', 0.85);
          if (this.showcaseMode) {
            // Brief pause on the docked berth, then auto-advance the showcase loop.
            this.showcaseAdvanceAt = elapsed + 2.2;
            this.hud.showResult(this.lastScore, level.name, true);
            this.hud.setShowcaseHint(true);
          } else {
            this.phase = 'result';
            this.autopilotEnabled = false;
            this.hud.showResult(this.lastScore, level.name, this.levelIndex < LEVELS.length - 1);
            this.hud.setShowcaseHint(false);
          }
        }

        if (this.showcaseMode) {
          if (this.showcaseStartedAt <= 0) this.showcaseStartedAt = elapsed;
          const timedOut = elapsed - this.showcaseStartedAt > 75;
          const readyToAdvance =
            (this.showcaseAdvanceAt > 0 && elapsed >= this.showcaseAdvanceAt) || timedOut;
          if (readyToAdvance) {
            this.showcaseAdvanceAt = 0;
            this.nextLevel();
          }
        }

        const nearSlip =
          Math.hypot(this.physics.state.x - level.slip.x, this.physics.state.z - level.slip.z) < 10;
        this.chase.update(delta, this.physics.state, level.slip, this.tuning.cameraLag, nearSlip);
        this.audio.updateLoops(lastThrottle, this.physics.state.speed);
        if (this.marina) {
          updateSlipMarker(this.marina.slipMarker, elapsed, docking.holdProgress, this.camera);
        }
      }
    } else if (this.phase === 'sinking') {
      this.updateSinking(delta, elapsed, level);
    } else if (this.phase === 'menu' || this.phase === 'result' || this.phase === 'failed') {
      this.playerWake.update(
        delta,
        elapsed,
        this.physics.state,
        this.physics.getTuning(),
        this.waves,
        this.reducedMotion,
        false,
      );
      if (this.water) updateWater(this.water, elapsed, this.reducedMotion, this.waves);
      this.chase.update(delta, this.physics.state, level.slip, 0.35, true);
      this.traffic.syncVisuals();
      this.floatingBodies.update(delta, elapsed, this.waves, this.reducedMotion);
      if (this.marina) updateSlipMarker(this.marina.slipMarker, elapsed, 0, this.camera);
    }

    this.hud.update(
      this.scoring.getElapsed(),
      this.scoring.damage,
      level.damageBudget,
      this.docking.getStatus(),
      {
        wind: this.lastWindSample,
        swell: this.waves.getAmplitude(),
        wake: this.lastWaveSample.wake,
        trafficCount: this.traffic.getCount(),
        trafficThreat: this.traffic.nearestThreat(this.physics.state),
      },
      this.paused,
    );

    if (this.phase === 'sinking') this.hud.setStatus('Taking on water…');
    else if (this.phase === 'failed') this.hud.setStatus('Hull lost — retry or choose a level');

    void animDelta;
    this.publishDiagnostics();
  }

  private stepSimulation(
    dt: number,
    command: ReturnType<BoatInput['read']>,
    level: LevelDef,
  ): void {
    this.scoring.tick(dt);
    const t = this.scoring.getElapsed();
    this.traffic.step(dt, this.physics.state, this.marina?.obstacles ?? []);
    const windSample = this.wind.sample(t, this.physics.state.yaw);
    this.lastWindSample = windSample;
    const boatTuning = this.physics.getTuning();
    const waveSample = this.waves.sample(
      t,
      this.physics.state.x,
      this.physics.state.z,
      this.physics.state.yaw,
      boatTuning.hullHalfLength,
      boatTuning.hullHalfWidth,
    );
    this.lastWaveSample = waveSample;
    const previousPose = {
      x: this.physics.state.x,
      z: this.physics.state.z,
      yaw: this.physics.state.yaw,
    };
    this.physics.step(
      dt,
      command,
      {
        x: windSample.force.x + waveSample.force.x,
        z: windSample.force.z + waveSample.force.z,
      },
      windSample.torque + waveSample.torque,
    );

    // Soft basin clamp before collision.
    const { halfWidth, halfDepth } = level.basin;
    this.physics.state.x = THREE.MathUtils.clamp(this.physics.state.x, -halfWidth, halfWidth);
    this.physics.state.z = THREE.MathUtils.clamp(this.physics.state.z, -halfDepth, halfDepth);

    const hits = this.collision.resolve(
      this.physics.state,
      boatTuning,
      this.traffic.getColliders(),
      previousPose,
    );
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    for (const hit of hits) {
      if (hit.damage > 0 && this.collisionCooldown <= 0) {
        this.scoring.addDamage(hit.damage);
        this.audio.play(hit.kind === 'buoy' ? 'buoy_bell' : 'dock_hit', 0.7);
        if (hit.kind === 'boat') this.traffic.notifyCollision(hit.sourceId);
        this.collisionCooldown = 0.28;
      }
    }

    // Wake presentation follows the authoritative pose after bounds and
    // collision resolution, never an uncommitted input transform.
    this.playerWake.update(
      dt,
      t,
      this.physics.state,
      boatTuning,
      this.waves,
      this.reducedMotion,
      true,
    );

    if (!this.autopilotEnabled && this.scoring.damage >= level.damageBudget) {
      this.beginSinking();
      return;
    }

    const docking = this.docking.update(dt, this.physics.state, level.slip, boatTuning);
    if (docking.missedApproach) this.scoring.registerMiss();
  }

  private beginSinking(): void {
    if (this.phase !== 'play') return;
    this.phase = 'sinking';
    this.autopilotEnabled = false;
    this.commandOverride = null;
    this.paused = false;
    this.lastCommand = { throttle: 0, steer: 0, brake: 1 };
    this.sinking.start(this.lastWaveSample.roll < 0 ? -1 : 1);
    this.audio.play('dock_hit', 0.8);
    this.audio.play('water_move', 0.65);
  }

  private updateSinking(delta: number, elapsed: number, level: LevelDef): void {
    this.sinking.update(delta);
    const damping = Math.exp(-3.2 * Math.min(delta, 0.1));
    this.physics.state.vx *= damping;
    this.physics.state.vz *= damping;
    this.physics.state.yawRate *= damping;
    this.physics.state.speed = Math.hypot(this.physics.state.vx, this.physics.state.vz);
    this.playerWake.update(
      delta,
      elapsed,
      this.physics.state,
      this.physics.getTuning(),
      this.waves,
      this.reducedMotion,
      false,
    );
    if (this.water) updateWater(this.water, elapsed, this.reducedMotion, this.waves);
    this.traffic.syncVisuals();
    this.floatingBodies.update(delta, elapsed, this.waves, this.reducedMotion);
    this.chase.update(delta, this.physics.state, level.slip, 0.28, true);
    this.audio.updateLoops(0, this.physics.state.speed);
    if (this.marina) updateSlipMarker(this.marina.slipMarker, elapsed, 0, this.camera);

    const sinking = this.sinking.getPresentation(this.reducedMotion);
    if (sinking.complete && this.phase === 'sinking') {
      this.phase = 'failed';
      this.hud.showFailure(level.name, this.scoring.damage, level.damageBudget);
    }
  }

  private syncBoatMesh(): void {
    const s = this.physics.state;
    // Hull clearance comes from liftFloating on the child mesh; root stays at waterline.
    this.boatRoot.position.set(s.x, 0, s.z);
    this.boatRoot.rotation.y = s.yaw;
  }

  private configureFloatingBodies(): void {
    if (!this.marina) return;
    const tuning = this.physics.getTuning();
    const player: FloatingBodySpec = {
      id: 'player',
      kind: 'player',
      root: this.boatRoot,
      halfLength: tuning.hullHalfLength,
      halfWidth: tuning.hullHalfWidth,
      restY: 0.04,
      getPose: () => ({
        x: this.physics.state.x,
        z: this.physics.state.z,
        yaw: this.physics.state.yaw,
      }),
      getPresentationOffset: () => {
        const scale = this.reducedMotion ? 0.22 : 1;
        const sinking = this.sinking.getPresentation(this.reducedMotion);
        return {
          y: sinking.y,
          pitch: this.physics.state.speed * 0.006 * scale + sinking.pitch,
          roll: -this.physics.state.steerAngle * 0.075 * scale + sinking.roll,
        };
      },
    };
    this.floatingBodies.configure([
      ...this.marina.floatables,
      ...this.traffic.getFloatingBodies(),
      player,
    ]);
  }

  private bindWakeEmitters(): void {
    this.waves.setWakeEmitters([
      this.playerWake.getEmitter(),
      ...this.traffic.getWakeEmitters(),
    ]);
  }

  private createLights(): void {
    this.scene.background = new THREE.Color('#7ec8e3');
    this.scene.fog = new THREE.Fog('#9ad0e4', 35, 85);

    const hemi = new THREE.HemisphereLight('#fff4d8', '#2f6f7e', 1.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#ffe2a8', 2.4);
    sun.position.set(-12, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    const fill = new THREE.DirectionalLight('#a6d8ff', 0.45);
    fill.position.set(10, 8, -8);
    this.scene.add(fill);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment();
    this.environmentMap = pmrem.fromScene(environment, 0.04).texture;
    this.scene.environment = this.environmentMap;
    this.scene.environmentIntensity = 0.28;
    pmrem.dispose();
  }

  private render(): void {
    this.collisionDebug.update(
      this.physics.state,
      this.physics.getTuning(),
      this.traffic.getColliders(),
    );
    this.renderer.render(this.scene, this.camera);
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        if (name === 'active-play') {
          this.hud.showMenu(false);
          this.loadLevel(0, true);
          this.phase = 'play';
        } else if (name === 'complete') {
          this.hud.showMenu(false);
          this.loadLevel(0, true);
          this.phase = 'play';
          // Place boat in slip and force completion.
          const level = LEVELS[0]!;
          this.physics.reset(level.slip.x, level.slip.z, level.slip.yaw);
          this.syncBoatMesh();
          for (let i = 0; i < 180; i += 1) {
            this.docking.update(
              1 / 60,
              this.physics.state,
              level.slip,
              this.physics.getTuning(),
            );
          }
          const docking = this.docking.getStatus();
          this.lastScore = this.scoring.finalize(level, docking);
          this.phase = 'result';
          this.hud.showResult(this.lastScore, level.name, true);
        } else if (name === 'level-4') {
          this.hud.showMenu(false);
          this.loadLevel(3, true);
          this.phase = 'play';
        } else if (name === 'level-5') {
          this.hud.showMenu(false);
          this.loadLevel(4, true);
          this.phase = 'play';
        } else {
          console.warn(`Unknown test state: ${name}`);
        }
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setWakeInspectionView: (view: 'chase' | 'elevated' | 'side') => {
        const boat = this.physics.state;
        if (view === 'chase') {
          this.chase.snap(boat);
          return;
        }

        const forward = new THREE.Vector3(Math.sin(boat.yaw), 0, Math.cos(boat.yaw));
        const right = new THREE.Vector3(forward.z, 0, -forward.x);
        const target = new THREE.Vector3(boat.x, 0.18, boat.z).addScaledVector(forward, -3.2);
        if (view === 'elevated') {
          this.camera.position
            .set(boat.x, 9.2, boat.z)
            .addScaledVector(forward, -11.5)
            .addScaledVector(right, 4.5);
          this.camera.fov = 49;
        } else {
          this.camera.position
            .set(boat.x, 4.8, boat.z)
            .addScaledVector(forward, -2.5)
            .addScaledVector(right, 12.5);
          this.camera.fov = 46;
        }
        this.camera.lookAt(target);
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld();
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      setWaterDebugMode: (mode: WaterDebugMode) => {
        if (this.water) setWaterDebugMode(this.water, mode);
        this.playerWake.setDebugMode(mode);
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugTools.setHidden(hidden);
      },
      setCommand: (command) => {
        this.autopilotEnabled = false;
        this.commandOverride = command;
      },
      runCommandFor: (simSeconds, command) => {
        if (!this.ready || !this.marina) return;
        this.showcaseMode = false;
        this.autopilotEnabled = false;
        this.commandOverride = null;
        this.hud.showMenu(false);
        this.phase = 'play';
        this.paused = false;
        const level = LEVELS[this.levelIndex]!;
        const fixedCommand: ReturnType<BoatInput['read']> = {
          ...command,
          retry: false,
          pause: false,
          mute: false,
        };
        this.lastCommand = { ...command };
        const steps = Math.max(1, Math.floor(Math.max(0, simSeconds) / FIXED_DT));
        for (let index = 0; index < steps; index += 1) {
          this.stepSimulation(FIXED_DT, fixedCommand, level);
          if (this.phase !== 'play') break;
        }
        this.syncBoatMesh();
        this.traffic.syncVisuals();
        this.floatingBodies.update(0, this.scoring.getElapsed(), this.waves, this.reducedMotion);
        if (this.water) {
          updateWater(this.water, this.scoring.getElapsed(), this.reducedMotion, this.waves);
        }
        this.chase.snap(this.physics.state);
        this.publishDiagnostics();
      },
      setLevel: (index: number) => {
        const clamped = Math.max(0, Math.min(LEVELS.length - 1, Math.floor(index)));
        this.showcaseMode = false;
        this.hud.showMenu(false);
        this.commandOverride = null;
        this.autopilotEnabled = false;
        this.loadLevel(clamped, true);
        this.phase = 'play';
      },
      setBoat: (boatId: string) => {
        if (!isPlayerBoatId(boatId)) return false;
        this.selectedBoatId = boatId;
        saveSelectedBoatId(boatId);
        this.physics.setTuning(tuningForBoat(boatId));
        // Rebuild the current level so the hull mesh updates.
        this.loadLevel(this.levelIndex, this.phase === 'play');
        return true;
      },
      sinkBoat: () => {
        if (!this.ready || this.phase === 'loading') return;
        this.showcaseMode = false;
        this.autopilotEnabled = false;
        this.hud.showMenu(false);
        this.phase = 'play';
        const level = LEVELS[this.levelIndex]!;
        this.scoring.addDamage(Math.max(0, level.damageBudget - this.scoring.damage));
        this.beginSinking();
      },
      startAutopilot: () => {
        this.autopilot.reset();
        this.commandOverride = null;
        this.autopilotEnabled = true;
        if (this.phase !== 'play') {
          this.hud.showMenu(false);
          this.phase = 'play';
        }
      },
      stopAutopilot: () => {
        this.autopilotEnabled = false;
        this.commandOverride = null;
        if (this.showcaseMode) this.stopShowcase();
      },
      runAutopilotFor: (maxSimSeconds: number) => {
        if (!this.ready) return false;
        this.showcaseMode = false;
        this.hud.showMenu(false);
        this.commandOverride = null;
        this.autopilot.reset();
        this.autopilotEnabled = true;
        this.phase = 'play';
        this.paused = false;
        this.lastScore = null;
        this.docking.reset();
        this.scoring.reset();
        // Always restart from spawn so chained QA runs don't inherit prior pose.
        const level = LEVELS[this.levelIndex]!;
        this.physics.reset(level.spawn.x, level.spawn.z, level.spawn.yaw);
        this.syncBoatMesh();
        this.wind.set(level.wind, level.wind.gust ?? 0);
        this.waves.set(level.waves, level.wind);
        this.traffic.configure(level.traffic, this.models!, this.marina?.obstacles ?? []);
        this.playerWake.reset(this.physics.state, this.physics.getTuning());
        this.bindWakeEmitters();
        this.configureFloatingBodies();

        const steps = Math.max(1, Math.floor(maxSimSeconds / FIXED_DT));
        let completed = false;
        for (let i = 0; i < steps; i += 1) {
          const command = this.autopilot.step(
            this.physics.state,
            level,
            this.docking.getStatus(),
          );
          this.stepSimulation(FIXED_DT, command, level);
          const docking = this.docking.getStatus();
          if (docking.complete) {
            this.syncBoatMesh();
            this.lastScore = this.scoring.finalize(level, docking);
            this.phase = 'result';
            this.autopilotEnabled = false;
            this.hud.showResult(this.lastScore, level.name, this.levelIndex < LEVELS.length - 1);
            this.publishDiagnostics();
            completed = true;
            break;
          }
        }
        if (!completed) {
          this.syncBoatMesh();
          this.autopilotEnabled = false;
        }
        this.traffic.syncVisuals();
        this.floatingBodies.update(0, this.scoring.getElapsed(), this.waves, this.reducedMotion);
        this.publishDiagnostics();
        return completed;
      },
      /** QA helper: sample autopilot pose every `everySec` while simulating. */
      sampleAutopilot: (maxSimSeconds: number, everySec = 2) => {
        if (!this.ready) return [];
        const level = LEVELS[this.levelIndex]!;
        this.commandOverride = null;
        this.autopilot.reset();
        this.autopilotEnabled = true;
        this.phase = 'play';
        this.paused = false;
        this.docking.reset();
        this.scoring.reset();
        this.physics.reset(level.spawn.x, level.spawn.z, level.spawn.yaw);
        this.syncBoatMesh();
        this.wind.set(level.wind, level.wind.gust ?? 0);
        this.waves.set(level.waves, level.wind);
        this.traffic.configure(level.traffic, this.models!, this.marina?.obstacles ?? []);
        this.playerWake.reset(this.physics.state, this.physics.getTuning());
        this.bindWakeEmitters();
        this.configureFloatingBodies();

        const steps = Math.max(1, Math.floor(maxSimSeconds / FIXED_DT));
        const every = Math.max(1, Math.floor(everySec / FIXED_DT));
        const samples: Array<{ t: number; x: number; z: number; yaw: number; speed: number; dmg: number }> =
          [];
        for (let i = 0; i < steps; i += 1) {
          const command = this.autopilot.step(
            this.physics.state,
            level,
            this.docking.getStatus(),
          );
          this.stepSimulation(FIXED_DT, command, level);
          if (i % every === 0 || this.docking.getStatus().complete) {
            const s = this.physics.state;
            samples.push({
              t: i * FIXED_DT,
              x: Number(s.x.toFixed(2)),
              z: Number(s.z.toFixed(2)),
              yaw: Number(s.yaw.toFixed(2)),
              speed: Number(s.speed.toFixed(2)),
              dmg: Number(this.scoring.damage.toFixed(2)),
            });
          }
          if (this.docking.getStatus().complete) break;
        }
        this.autopilotEnabled = false;
        this.syncBoatMesh();
        this.traffic.syncVisuals();
        this.floatingBodies.update(0, this.scoring.getElapsed(), this.waves, this.reducedMotion);
        this.publishDiagnostics();
        return samples;
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const s = this.physics.state;
    const playerWake = this.playerWake.getDiagnostics();
    const trafficThreat = this.traffic.nearestThreat(s);
    const floating = this.floatingBodies.getDiagnostics();
    let marinaMinY: number | null = null;
    let boatMinY: number | null = null;
    if (this.marina) {
      this.marina.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.marina.group);
      if (Number.isFinite(box.min.y)) marinaMinY = box.min.y;
    }
    this.boatRoot.updateMatrixWorld(true);
    {
      const box = new THREE.Box3().setFromObject(this.boatRoot);
      if (Number.isFinite(box.min.y)) boatMinY = box.min.y;
    }
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.scoring.getElapsed(),
      score: this.lastScore?.stars ?? 0,
      targetScore: 3,
      complete: this.phase === 'result',
      marinaMinY,
      boatMinY,
      player: {
        position: { x: s.x, y: this.boatRoot.position.y, z: s.z },
        speed: s.speed,
        yaw: s.yaw,
        velocity: { x: s.vx, z: s.vz },
        presentation: {
          pitch: this.boatRoot.rotation.x,
          roll: this.boatRoot.rotation.z,
        },
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        frameTimeMs: this.averageFrameMs,
        fps: 1000 / Math.max(this.averageFrameMs, 0.01),
        waterVertices:
          (this.water?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined)
            ?.count ?? 0,
        postPasses: 0,
        shadowMapSize: this.sun?.shadow.mapSize.width ?? 0,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
      level: this.levelIndex + 1,
      damage: this.scoring.damage,
      holdProgress: this.docking.getStatus().holdProgress,
      phase: this.phase,
      dockingInside: this.docking.getStatus().inside,
      dockingAligned: this.docking.getStatus().aligned,
      autopilot: this.autopilotEnabled,
      input: { ...this.lastCommand },
      obstacleCount:
        (this.marina?.obstacles.length ?? this.collision.getObstacleCount()) +
        this.traffic.getColliders().length,
      selectedBoat: this.selectedBoatId,
      sinkingProgress: this.sinking.getPresentation(this.reducedMotion).progress,
      playerWake: {
        ...playerWake,
        emitterCount: this.waves.getWakeEmitterCount(),
      },
      traffic: {
        boats: this.traffic.getCount(),
        wakeEmitters: this.traffic.getWakeEmitters().length,
        nearestDistance: trafficThreat?.distance ?? null,
      },
      environment: {
        windStrength: this.lastWindSample.strength,
        gustFactor: this.lastWindSample.gustFactor,
        swellEnergy: this.waves.getAmplitude(),
        waveComponents: this.waves.getComponentCount(),
        wakeAtPlayer: this.lastWaveSample.wake,
        heave: this.lastWaveSample.heave,
        pitch: this.lastWaveSample.pitch,
        roll: this.lastWaveSample.roll,
        force: {
          x: this.lastWindSample.force.x + this.lastWaveSample.force.x,
          z: this.lastWindSample.force.z + this.lastWaveSample.force.z,
        },
        torque: this.lastWindSample.torque + this.lastWaveSample.torque,
      },
      floating: {
        total: floating.total,
        byKind: floating.byKind,
        maxHeave: floating.maxHeave,
        maxPitch: floating.maxPitch,
        maxRoll: floating.maxRoll,
      },
      physics: {
        engine: 'custom-arcade',
        timestep: FIXED_DT,
        staticColliders: this.marina?.obstacles.length ?? this.collision.getObstacleCount(),
        movingColliders: this.traffic.getColliders().length,
        ccdBodies: 1 + this.traffic.getColliders().length,
        sweptHits: this.collision.getDiagnostics().sweptHits,
        maxPenetration: this.collision.getDiagnostics().maxPenetration,
        unresolvedContacts: this.collision.getDiagnostics().unresolvedContacts,
        debugVisible: this.collisionDebug.isEnabled(),
        debugMeshes: this.collisionDebug.getMeshCount(),
      },
    };
  }

  private must(selector: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Missing element ${selector}`);
    return el;
  }
}
