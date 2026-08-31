import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ArenaScene } from '../assets/ArenaScene';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { IceResurfacer } from '../entities/IceResurfacer';
import { getLevel, LEVELS } from './levels';
import { calculateScore } from './scoring';
import type { GamePhase, RunStats, ScoreBreakdown } from './types';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { CollisionSystem } from '../systems/CollisionSystem';
import { CoverageSystem } from '../systems/CoverageSystem';
import { Hud } from '../systems/Hud';
import { VfxSystem } from '../systems/VfxSystem';

const FIXED_TIMESTEP = 1 / 60;
const MAX_FIXED_STEPS = 5;
const STORAGE_KEY = 'perfect-ice-progress-v1';

type ProgressRecord = {
  stars: number[];
  unlocked: number;
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 90);
  private readonly input: InputController;
  private readonly vehicle = new IceResurfacer();
  private readonly collision = new CollisionSystem();
  private readonly audio = new AudioSystem();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly vfx = new VfxSystem();
  private readonly hud: Hud;
  private readonly loop: Loop;
  private readonly environmentTexture: THREE.Texture;

  private coverage: CoverageSystem | null = null;
  private arena: ArenaScene | null = null;
  private phase: GamePhase = 'intro';
  private selectedLevel = 0;
  private progress: ProgressRecord = { stars: new Array(LEVELS.length).fill(0), unlocked: 1 };
  private resurfacing = false;
  private elapsed = 0;
  private frame = 0;
  private accumulator = 0;
  private water = 0;
  private fuel = 0;
  private drivenDistance = 0;
  private wastedWater = 0;
  private collisions = 0;
  private collisionCooldown = 0;
  private pausedForScreenshot = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private lastMilestone = 0;
  private resultScore: ScoreBreakdown | null = null;
  private failureReason = '';
  private inspectionCamera: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
    pmrem.dispose();
    this.scene.environment = this.environmentTexture;
    this.createLighting();
    this.scene.add(this.vehicle.group);
    this.scene.add(this.vfx.group);

    this.input = new InputController(
      this.getElement('#touch-stick'),
      this.getElement('#touch-knob'),
      this.getElement('#drive-button'),
      this.getElement('#reverse-button'),
      this.getElement('#brake-button'),
      this.getElement('#resurface-button'),
    );
    this.hud = new Hud({
      onStart: () => this.startLevel(),
      onResume: () => this.resume(),
      onRetry: () => this.retry(),
      onNext: () => this.nextLevel(),
      onSelectLevel: (index) => this.selectLevel(index),
      onPause: () => this.togglePause(),
      onMute: () => this.toggleMute(),
    });
    this.loop = new Loop((delta, elapsed) => this.update(delta, elapsed), () => this.render());

    this.progress = this.loadProgress();
    this.hud.setProgress(this.progress.stars, this.progress.unlocked);
    const params = new URLSearchParams(window.location.search);
    const queryLevel = Number(params.get('level') ?? 0);
    this.selectedLevel = Number.isFinite(queryLevel) ? Math.min(this.progress.unlocked - 1, Math.max(0, Math.floor(queryLevel))) : 0;
    this.loadLevel(this.selectedLevel, true);
    resizeRenderer(this.renderer, this.camera, this.maxDpr());
    this.installTestHooks();
    this.publishDiagnostics();
    if (params.get('autostart') === '1') this.startLevel();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.hud.dispose();
    this.coverage?.dispose();
    this.arena?.dispose();
    this.vehicle.dispose();
    this.vfx.dispose();
    this.environmentTexture.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number, realElapsed: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, this.maxDpr());
    const intent = this.input.readIntent();

    if (this.input.consumePause()) this.togglePause();
    if (this.input.consumeConfirm()) {
      if (this.phase === 'intro') this.startLevel();
      else if (this.phase === 'paused') this.resume();
      else if (this.phase === 'complete') this.nextLevel();
      else if (this.phase === 'failed') this.retry();
    }
    if (this.input.consumeRestart()) this.retry();
    if (this.input.consumeToggleResurface() && this.phase === 'playing' && this.water > 0) {
      this.resurfacing = !this.resurfacing;
      this.vehicle.setResurfacing(this.resurfacing);
      this.audio.toggle(this.resurfacing);
    }

    if (!this.pausedForScreenshot && this.phase === 'playing') {
      this.accumulator = Math.min(this.accumulator + delta, FIXED_TIMESTEP * MAX_FIXED_STEPS);
      let steps = 0;
      while (this.accumulator >= FIXED_TIMESTEP && steps < MAX_FIXED_STEPS) {
        this.fixedUpdate(FIXED_TIMESTEP, intent);
        this.accumulator -= FIXED_TIMESTEP;
        steps += 1;
      }
    }

    const animationElapsed = this.reducedMotion ? 0 : realElapsed;
    this.vehicle.updateVisual(delta, animationElapsed, this.reducedMotion);
    this.arena?.update(animationElapsed, this.reducedMotion);
    this.vfx.update(delta, animationElapsed, this.vehicle.getToolPose(), this.vehicle.speed, this.resurfacing, this.reducedMotion);
    const forward = this.vehicle.getForward();
    if (this.inspectionCamera) {
      this.camera.position.copy(this.inspectionCamera.position);
      this.camera.lookAt(this.inspectionCamera.target);
    } else {
      this.cameraRig.update(delta, this.vehicle.group.position, forward, this.vehicle.speed);
    }
    this.audio.update(this.vehicle.speed, intent.steer, this.resurfacing, this.phase);
    this.updateHud();
    this.publishDiagnostics();
  }

  private fixedUpdate(delta: number, intent: { throttle: number; steer: number; brake: boolean }): void {
    const level = getLevel(this.selectedLevel);
    const coverage = this.coverage;
    if (!coverage) return;

    this.elapsed += delta;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - delta);
    const previousTool = this.vehicle.getToolPose();
    const proposed = this.vehicle.propose(delta, intent);
    const resolved = this.collision.resolveCompound(proposed, this.vehicle.collisionFootprint, level);
    const movedDistance = this.vehicle.commitPose(resolved.pose);
    const currentTool = this.vehicle.getToolPose();
    this.drivenDistance += movedDistance;
    this.fuel = Math.max(0, this.fuel - movedDistance * level.fuelPerMetre - Math.abs(intent.throttle) * delta * 0.035);

    if (resolved.collided) {
      // Contact response is applied every fixed step. The cooldown gates only
      // scoring and feedback, never the physical correction itself.
      this.vehicle.collide(resolved.normalX, resolved.normalZ);
      if (this.collisionCooldown <= 0) {
        this.collisionCooldown = 0.42;
        this.collisions += 1;
        this.cameraRig.addTrauma(0.36);
        this.input.rumble(170, 0.68, 0.35);
        this.audio.collision();
        this.hud.pulseCollision();
        this.vfx.collision(this.vehicle.group.position);
      }
    }

    if (this.resurfacing && this.water > 0) {
      const toolDistance = Math.hypot(currentTool.x - previousTool.x, currentTool.z - previousTool.z);
      const stamp = coverage.stampSwept(previousTool, currentTool, toolDistance);
      const waterCost = delta * level.waterPerSecond + movedDistance * level.waterPerMetre;
      const touched = stamp.newCells + stamp.repeatedCells + stamp.wastedCells;
      const wasteRatio = (stamp.repeatedCells + stamp.wastedCells) / Math.max(1, touched);
      this.wastedWater += waterCost * wasteRatio;
      this.water = Math.max(0, this.water - waterCost);
    }

    const coverageStats = coverage.getStats();
    const milestone = Math.floor((coverageStats.coverage * 100) / 25);
    if (milestone > this.lastMilestone && milestone < 4) {
      this.lastMilestone = milestone;
      this.hud.pulseMilestone();
    }

    if (coverageStats.coverage >= level.coverageTarget) {
      this.completeLevel();
      return;
    }
    if (this.elapsed >= level.maxTime) this.failLevel('Shift clock expired');
    else if (this.fuel <= 0) this.failLevel('Fuel reserve exhausted');
    else if (this.water <= 0) this.failLevel('Water tank exhausted');

  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private loadLevel(index: number, showIntro: boolean): void {
    const clampedIndex = Math.max(0, Math.min(index, LEVELS.length - 1));
    this.selectedLevel = clampedIndex;
    const level = getLevel(clampedIndex);
    if (this.arena) this.scene.remove(this.arena.group);
    this.arena?.dispose();
    this.coverage?.dispose();

    this.coverage = new CoverageSystem(level);
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const visuals = this.coverage.createVisuals(maxAnisotropy);
    this.arena = new ArenaScene(level, visuals, maxAnisotropy);
    this.scene.add(this.arena.group);
    this.vehicle.reset(level.start.x, level.start.z, level.start.heading);
    this.vehicle.setResurfacing(false);
    this.resurfacing = false;
    this.elapsed = 0;
    this.accumulator = 0;
    this.water = level.waterCapacity;
    this.fuel = level.fuelCapacity;
    this.drivenDistance = 0;
    this.wastedWater = 0;
    this.collisions = 0;
    this.collisionCooldown = 0;
    this.lastMilestone = 0;
    this.resultScore = null;
    this.failureReason = '';
    this.inspectionCamera = null;
    this.phase = 'intro';
    const forward = this.vehicle.getForward();
    this.cameraRig.snapTo(this.vehicle.group.position, forward);
    this.hud.setProgress(this.progress.stars, this.progress.unlocked);
    if (showIntro) this.hud.showIntro(level, clampedIndex);
    else this.hud.hideModal();
    this.updateHud();
  }

  private startLevel(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'playing';
    this.hud.hideModal();
    void this.audio.unlock();
    this.canvas.focus({ preventScroll: true });
  }

  private togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.resurfacing = false;
      this.vehicle.setResurfacing(false);
      this.hud.showPause(getLevel(this.selectedLevel));
    } else if (this.phase === 'paused') {
      this.resume();
    }
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.accumulator = 0;
    this.hud.hideModal();
    this.canvas.focus({ preventScroll: true });
  }

  private retry(): void {
    this.loadLevel(this.selectedLevel, false);
    this.startLevel();
  }

  private nextLevel(): void {
    const next = Math.min(this.selectedLevel + 1, this.progress.unlocked - 1, LEVELS.length - 1);
    this.loadLevel(next, true);
  }

  private selectLevel(index: number): void {
    if (index >= this.progress.unlocked) return;
    this.loadLevel(index, true);
  }

  private completeLevel(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'complete';
    this.resurfacing = false;
    this.vehicle.setResurfacing(false);
    const level = getLevel(this.selectedLevel);
    const stats = this.getRunStats();
    this.resultScore = calculateScore(level, stats, true);
    this.progress.stars[this.selectedLevel] = Math.max(this.progress.stars[this.selectedLevel] ?? 0, this.resultScore.stars);
    this.progress.unlocked = Math.max(this.progress.unlocked, Math.min(LEVELS.length, this.selectedLevel + 2));
    this.saveProgress();
    this.hud.setProgress(this.progress.stars, this.progress.unlocked);
    this.hud.showComplete(level, stats, this.resultScore, this.selectedLevel < LEVELS.length - 1);
    this.hud.flashComplete();
    this.audio.complete(this.resultScore.stars);
    this.input.rumble(420, 0.5, 0.7);
  }

  private failLevel(reason: string): void {
    if (this.phase !== 'playing') return;
    this.phase = 'failed';
    this.failureReason = reason;
    this.resurfacing = false;
    this.vehicle.setResurfacing(false);
    const level = getLevel(this.selectedLevel);
    this.resultScore = calculateScore(level, this.getRunStats(), false);
    this.hud.showFailure(level, reason, this.getRunStats());
    this.hud.flashFailure();
    this.audio.fail();
    this.cameraRig.addTrauma(0.48);
  }

  private updateHud(): void {
    const level = getLevel(this.selectedLevel);
    const coverage = this.coverage?.getStats();
    this.hud.update({
      phase: this.phase,
      level,
      coverage: coverage?.coverage ?? 0,
      elapsed: this.elapsed,
      water: this.water,
      fuel: this.fuel,
      overlapRatio: coverage?.overlapRatio ?? 0,
      collisions: this.collisions,
      resurfacing: this.resurfacing,
    });
  }

  private getRunStats(): RunStats {
    const coverage = this.coverage?.getStats() ?? {
      coverage: 0,
      cleanedCells: 0,
      requiredCells: 0,
      productiveCells: 0,
      repeatedCells: 0,
      wastedCells: 0,
      overlapRatio: 0,
    };
    return {
      ...coverage,
      elapsed: this.elapsed,
      drivenDistance: this.drivenDistance,
      water: this.water,
      fuel: this.fuel,
      wastedWater: this.wastedWater,
      collisions: this.collisions,
    };
  }

  private createLighting(): void {
    this.scene.background = new THREE.Color('#0a2437');
    this.scene.fog = new THREE.Fog('#0a2437', 31, 58);
    const hemisphere = new THREE.HemisphereLight('#dffbff', '#123247', 1.72);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight('#e6fbff', 3.25);
    key.position.set(-8, 15, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(this.maxDpr() <= 1.4 ? 1024 : 2048, this.maxDpr() <= 1.4 ? 1024 : 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 44;
    key.shadow.camera.left = -19;
    key.shadow.camera.right = 19;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.bias = -0.0008;
    this.scene.add(key);
    const rim = new THREE.PointLight('#ff9d72', 19, 36, 2);
    rim.position.set(0, 8, -12);
    this.scene.add(rim);
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: () => {
        // Runtime randomness is already fixed; the hook remains explicit for the visual harness contract.
      },
      setState: (name: string) => {
        const levelMatch = name.match(/^active-play-level-(\d)$/);
        const testLevelIndex = levelMatch ? Math.max(0, Math.min(LEVELS.length - 1, Number(levelMatch[1]) - 1)) : 0;
        this.loadLevel(testLevelIndex, false);
        const level = getLevel(testLevelIndex);
        if (name === 'active-play' || levelMatch || name === 'coverage-mask') {
          this.phase = 'playing';
          this.coverage?.setCoverageForTest(0.38);
          this.vehicle.reset(-2.4, levelMatch ? 5.6 : 2.1, Math.PI / 2);
          this.resurfacing = true;
          this.vehicle.setResurfacing(true);
          this.elapsed = 46;
          this.water = 68;
          this.fuel = 78;
          this.arena?.setCoverageDebugView(name === 'coverage-mask');
        } else if (name === 'complete') {
          this.phase = 'complete';
          this.coverage?.setCoverageForTest(level.coverageTarget + 0.025);
          this.elapsed = 103;
          this.water = 31;
          this.fuel = 46;
          const stats = this.getRunStats();
          this.resultScore = calculateScore(level, stats, true);
          this.hud.showComplete(level, stats, this.resultScore, true);
        } else if (name === 'failed') {
          this.phase = 'failed';
          this.coverage?.setCoverageForTest(0.67);
          this.water = 0;
          this.elapsed = 148;
          this.failureReason = 'Water tank exhausted';
          this.hud.showFailure(level, this.failureReason, this.getRunStats());
        } else if (name === 'paused') {
          this.phase = 'paused';
          this.coverage?.setCoverageForTest(0.25);
          this.hud.showPause(level);
        } else {
          this.phase = 'intro';
          this.hud.showIntro(level, 0);
        }
        const forward = this.vehicle.getForward();
        this.cameraRig.snapTo(this.vehicle.group.position, forward);
        this.updateHud();
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        this.cameraRig.setReducedMotion(enabled);
      },
      hideDebugUi: () => {
        // No player-visible debug UI ships in the default build.
      },
      setCoverage: (value: number) => {
        this.coverage?.setCoverageForTest(value);
        if (value > 0.9) {
          const level = getLevel(this.selectedLevel);
          this.vehicle.reset(level.start.x, level.start.z, level.start.heading);
          const forward = this.vehicle.getForward();
          this.cameraRig.snapTo(this.vehicle.group.position, forward);
        }
        this.updateHud();
      },
      setResurfacing: (active: boolean) => {
        this.resurfacing = active;
        this.vehicle.setResurfacing(active);
      },
      setVehiclePose: (x: number, z: number, heading: number) => {
        const level = getLevel(this.selectedLevel);
        const resolved = this.collision.resolveCompound(
          { x, z, heading },
          this.vehicle.collisionFootprint,
          level,
        );
        this.vehicle.reset(resolved.pose.x, resolved.pose.z, resolved.pose.heading);
        if (!this.inspectionCamera) {
          const forward = this.vehicle.getForward();
          this.cameraRig.snapTo(this.vehicle.group.position, forward);
        }
      },
      setInspectionView: (view: 'overview' | 'north-east' | 'north-west' | 'south-east' | 'south-west' | 'chase') => {
        if (view === 'chase') {
          this.inspectionCamera = null;
          const forward = this.vehicle.getForward();
          this.cameraRig.snapTo(this.vehicle.group.position, forward);
          return;
        }
        const views = {
          overview: { position: new THREE.Vector3(0, 24, 0.01), target: new THREE.Vector3(0, 0, 0) },
          'north-east': { position: new THREE.Vector3(5.2, 10.5, -0.8), target: new THREE.Vector3(11.1, 0.4, -4.7) },
          'north-west': { position: new THREE.Vector3(-5.2, 10.5, -0.8), target: new THREE.Vector3(-11.1, 0.4, -4.7) },
          'south-east': { position: new THREE.Vector3(5.2, 10.5, 0.8), target: new THREE.Vector3(11.1, 0.4, 4.7) },
          'south-west': { position: new THREE.Vector3(-5.2, 10.5, 0.8), target: new THREE.Vector3(-11.1, 0.4, 4.7) },
        } as const;
        const selected = views[view];
        this.inspectionCamera = {
          position: selected.position.clone(),
          target: selected.target.clone(),
        };
      },
    };
  }

  private publishDiagnostics(): void {
    const rendererInfo = this.renderer.info;
    const canvas = this.renderer.domElement;
    const level = getLevel(this.selectedLevel);
    const coverage = this.coverage?.getStats();
    const toolPose = this.vehicle.getToolPose();
    const toolCell = this.coverage?.getCellStateAtWorld(toolPose.x, toolPose.z) ?? null;
    const mintModules = this.scene.getObjectByName('mintRinkModuleDisplay');
    const mintDisplayBounds = mintModules ? new THREE.Box3().setFromObject(mintModules) : null;
    const proceduralBoards = this.scene.getObjectByName('roundedRinkBoards');
    const proceduralGlass = this.scene.getObjectByName('roundedRinkGlass');
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      objectMaterials.forEach((material) => materials.add(material));
    });
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      phase: this.phase,
      level: level.id,
      score: this.resultScore?.total ?? Math.round((coverage?.coverage ?? 0) * 1000),
      complete: this.phase === 'complete',
      failed: this.phase === 'failed',
      objective: {
        coverage: coverage?.coverage ?? 0,
        target: level.coverageTarget,
      },
      resources: { water: this.water, fuel: this.fuel },
      penalties: { collisions: this.collisions, overlapRatio: coverage?.overlapRatio ?? 0, wastedWater: this.wastedWater },
      player: {
        position: { x: this.vehicle.group.position.x, y: this.vehicle.group.position.y, z: this.vehicle.group.position.z },
        speed: this.vehicle.speed,
        heading: this.vehicle.getPose().heading,
        renderHeading: this.vehicle.group.rotation.y,
        steeringAngle: this.vehicle.steeringAngle,
        resurfacing: this.resurfacing,
      },
      ice: {
        visualRevision: this.coverage?.getVisualRevision() ?? 0,
        tool: toolPose,
        toolCell,
      },
      renderer: {
        calls: rendererInfo.render.calls,
        triangles: rendererInfo.render.triangles,
        geometries: rendererInfo.memory.geometries,
        textures: rendererInfo.memory.textures,
        materials: materials.size,
      },
      simulation: {
        engine: 'custom-kinematic-2d',
        timestep: FIXED_TIMESTEP,
        bodies: 1,
        colliders: this.vehicle.collisionFootprint.length + level.obstacles.length + 4,
        ccdBodies: 0,
        sensors: 0,
      },
      rink: {
        halfWidth: level.halfWidth,
        halfDepth: level.halfDepth,
        cornerRadius: level.cornerRadius,
        continuousBoards: Boolean(proceduralBoards?.visible),
        continuousGlass: Boolean(proceduralGlass?.visible),
        mintModulesReady: Boolean(mintModules),
        mintDisplayOutsideIce: Boolean(mintDisplayBounds && mintDisplayBounds.max.x < -level.halfWidth - 0.05),
        mintArchiveInactive: mintModules?.visible === false,
        mintVehicleReady: Boolean(this.scene.getObjectByName('mintResurfacerBody')),
      },
      audio: this.audio.getDebugState(),
      canvas: {
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        width: canvas.width,
        height: canvas.height,
        dpr: window.devicePixelRatio || 1,
      },
    };
  }

  private toggleMute(): void {
    this.audio.setMuted(!this.audio.isMuted());
    this.hud.setMuted(this.audio.isMuted());
  }

  private loadProgress(): ProgressRecord {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as ProgressRecord | null;
      if (!parsed || !Array.isArray(parsed.stars)) return { stars: new Array(LEVELS.length).fill(0), unlocked: 1 };
      return {
        stars: LEVELS.map((_, index) => Math.max(0, Math.min(3, Number(parsed.stars[index] ?? 0)))),
        unlocked: Math.max(1, Math.min(LEVELS.length, Number(parsed.unlocked ?? 1))),
      };
    } catch {
      return { stars: new Array(LEVELS.length).fill(0), unlocked: 1 };
    }
  }

  private saveProgress(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.progress));
    } catch {
      // Private browsing can deny storage; play remains fully functional.
    }
  }

  private maxDpr(): number {
    return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820 ? 1.4 : 1.75;
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
