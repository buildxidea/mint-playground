import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Fish } from '../entities/Fish';
import { AssetLibrary } from '../assets/AssetLibrary';
import { AudioSystem } from '../systems/AudioSystem';
import { BubbleParticles } from '../systems/BubbleParticles';
import { CameraRig } from '../systems/CameraRig';
import { CollisionSystem } from '../systems/CollisionSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Environment } from '../systems/Environment';
import { Hud } from '../systems/Hud';
import { Spawner } from '../systems/Spawner';
import { SCORING } from '../config';
import { createSeededRandom } from '../utils/random';

const BEST_SCORE_KEY = 'jellyfish-race-best';
const ASSET_KEYS = [
  'clownfish-hero',
  'jellyfish',
  'bubble-ring',
  'prop-branching-coral',
  'prop-boulder-coral',
  'prop-sea-anemone',
  'prop-kelp-strand',
];

type GameState = 'title' | 'playing' | 'menu';

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 260);
  private readonly input: InputController;
  private readonly assets = new AssetLibrary();
  private readonly fish = new Fish();
  private readonly collision = new CollisionSystem();
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly environment: Environment;
  private readonly spawner: Spawner;
  private readonly bubbles: BubbleParticles;
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private readonly tuning: DebugTuning = { exposure: 1.05, maxDpr: 2 };
  private readonly debugTools: DebugTools;
  private readonly tailPosition = new THREE.Vector3();

  private state: GameState = 'title';
  private frame = 0;
  private score = 0;
  private combo = 1;
  private best = 0;
  private elapsed = 0;
  private trailAccumulator = 0;
  private rng = createSeededRandom(1);
  private pausedForScreenshot = false;
  private reducedMotion = false;

  private readonly onStateKey = (event: KeyboardEvent) => {
    if (event.code === 'Enter' && this.state === 'title') this.startRun();
    else if (event.code === 'Escape' && this.state !== 'title') this.toggleMenu();
    else if (event.code === 'KeyF') this.fish.cycleFacing();
  };

  private readonly onTitleClick = () => {
    if (this.state === 'title') this.startRun();
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMappingExposure = this.tuning.exposure;

    const stick = this.getElement('#touch-stick');
    const knob = this.getElement('#touch-knob');
    const dashButton = this.getElement('#dash-button');
    this.input = new InputController(stick, knob, dashButton);

    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });

    this.environment = new Environment(this.scene, createSeededRandom(7));
    this.spawner = new Spawner(this.assets, this.rng);
    this.bubbles = new BubbleParticles(createSeededRandom(3));
    this.scene.add(this.environment.group, this.spawner.group, this.fish.group, this.bubbles.points);

    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0) || 0;
    this.hud.showTitle(this.best);

    window.addEventListener('keydown', this.onStateKey);
    this.getElement('#title-overlay').addEventListener('pointerdown', this.onTitleClick);
    this.hud.bindMenu({
      onSettings: () => this.toggleMenu(),
      onResume: () => this.toggleMenu(),
      onRestart: () => this.startRun(),
      onEnd: () => this.endRun(),
    });

    this.cameraRig.snapTo(this.fish.position);
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.installTestHooks();
    this.publishDiagnostics();

    // Arriving from the landing page's PLAY button: skip the title screen so
    // the player is not gated twice. Ending a run still returns to the title.
    if (new URLSearchParams(location.search).has('start')) this.startRun();

    void this.loadAssets();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    window.removeEventListener('keydown', this.onStateKey);
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    this.fish.dispose();
    this.bubbles.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private async loadAssets(): Promise<void> {
    try {
      await this.assets.loadAll(ASSET_KEYS);
    } catch (error) {
      console.error('Mint asset loading failed; continuing with blockout visuals.', error);
      return;
    }
    const fishAsset = this.assets.instance('clownfish-hero');
    if (fishAsset) this.fish.setModel(fishAsset);

    // The spawner fills several chunks ahead on the very first frame. If the
    // run began before the GLBs resolved -- which is what ?start=1 does, and
    // what an impatient Enter on the title screen does -- those chunks hold
    // blockout jellyfish and rings for the next ~350 units. Rebuild them now
    // that the real models are in the library. Guarded so a genuinely slow
    // load can never yank the world out from under a run already underway.
    if (this.state !== 'playing' || this.elapsed < 5) {
      this.spawner.reset(this.rng);
    }
  }

  private startRun(): void {
    this.state = 'playing';
    this.score = 0;
    this.combo = 1;
    this.elapsed = 0;
    this.fish.reset();
    this.spawner.reset(this.rng);
    this.cameraRig.snapTo(this.fish.position);
    this.hud.hideTitle();
    this.hud.setMenu(false);
  }

  private toggleMenu(): void {
    if (this.state === 'playing') {
      this.state = 'menu';
      this.hud.setMenu(true);
    } else if (this.state === 'menu') {
      this.state = 'playing';
      this.hud.setMenu(false);
    }
  }

  /** End the run from the menu: back to the title screen. */
  private endRun(): void {
    this.state = 'title';
    this.hud.setMenu(false);
    this.hud.showTitle(this.best);
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);

    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    const animDelta = this.reducedMotion ? 0 : delta;
    const animElapsed = this.reducedMotion ? 0 : elapsed;

    if (this.state !== 'playing') {
      // Ambient motion keeps the title/pause backdrop alive.
      this.spawner.update(0, animElapsed, this.fish.position.z);
      this.bubbles.update(animDelta, animElapsed);
      this.environment.update(animElapsed, this.fish.position.z, this.fish.position.x);
      this.publishDiagnostics();
      return;
    }

    this.elapsed += delta;
    const previousZ = this.fish.position.z;

    const move = this.input.readMovement(new THREE.Vector2());
    this.fish.update(
      delta,
      { lateral: move.x, vertical: -move.y, boost: this.input.isDashHeld() },
      false,
    );

    this.spawner.update(delta, animElapsed, this.fish.position.z);
    const events = this.collision.check(
      this.fish,
      previousZ,
      this.spawner.activeRings,
      this.spawner.activeJellies,
    );

    for (const ring of events.ringsPassed) {
      this.score += SCORING.ringPoints * this.combo;
      this.combo = Math.min(SCORING.comboMax, this.combo + 1);
      this.fish.speed += SCORING.ringSpeedBump;
      this.audio.ring(this.combo);
      this.hud.popScore();
      this.bubbles.emit(ring.group.position, 26, { spread: 1.8, speed: 1.6, size: 1.1, life: 1.4 });
    }
    if (events.ringsMissed > 0) this.combo = 1;

    if (events.bouncedOn) {
      events.bouncedOn.onBounced();
      this.fish.bounce();
      this.audio.bounce();
      this.bubbles.emit(events.bouncedOn.group.position, 18, {
        spread: 1.4,
        speed: 1.8,
        size: 0.9,
        life: 1.2,
        upward: 1.6,
      });
    }

    if (events.stung) {
      this.fish.update(0, { lateral: 0, vertical: 0, boost: false }, true);
      this.score = Math.max(0, this.score - SCORING.stingPenalty);
      this.combo = 1;
      this.audio.sting();
      this.hud.flashSting();
    }

    // Bubble trail from the tail, denser with speed.
    this.trailAccumulator += delta * (8 + this.fish.speed * 1.4);
    if (this.trailAccumulator >= 1) {
      const count = Math.floor(this.trailAccumulator);
      this.trailAccumulator -= count;
      this.fish.tailPosition(this.tailPosition);
      this.bubbles.emit(this.tailPosition, count, {
        spread: 0.28,
        speed: 0.5,
        size: 0.95,
        life: 2.4,
        upward: 0.7,
      });
    }

    this.bubbles.update(animDelta, animElapsed);
    this.environment.update(animElapsed, this.fish.position.z, this.fish.position.x);
    this.cameraRig.update(delta, this.fish.position, this.fish.speed);

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
    }
    this.hud.update(
      this.score,
      this.combo,
      -this.fish.position.z,
      this.best,
      this.fish.speed,
      this.fish.boostReserve,
    );
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        if (name === 'active-play') this.startRun();
        else if (name === 'title') {
          this.state = 'title';
          this.hud.showTitle(this.best);
        } else console.warn(`Unknown test state: ${name}`);
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugTools.setHidden(hidden);
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.score,
      targetScore: this.best,
      complete: false,
      player: {
        position: {
          x: this.fish.position.x,
          y: this.fish.position.y,
          z: this.fish.position.z,
        },
        speed: this.fish.speed,
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
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
