import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BIRDS,
  DEFAULT_BIRD_ID,
  findBird,
  loadBirdModel,
  loadCoreModels,
  prefetchBirds,
  type BirdId,
  type LoadedModel,
} from '../assets/assets';
import { FlapInput } from '../core/FlapInput';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Bird } from '../entities/Bird';
import { PipeField } from '../entities/PipeField';
import { AudioSystem } from '../systems/AudioSystem';
import { Hud } from '../systems/Hud';
import { createSeededRandom } from '../utils/random';
import { Environment } from '../world/Environment';
import { TUNING } from './tuning';

type GameState = 'loading' | 'failed' | 'ready' | 'playing' | 'dying' | 'over';

// Ignore taps briefly after death so the crash tap doesn't instantly restart.
const RESTART_COOLDOWN = 0.45;

const BIRD_STORAGE_KEY = 'flappybird3d.bird';

// localStorage throws outright in some privacy modes, so never let the choice
// of bird be a reason the game fails to start.
function readStoredBird(): BirdId {
  try {
    return findBird(window.localStorage.getItem(BIRD_STORAGE_KEY)).id;
  } catch {
    return DEFAULT_BIRD_ID;
  }
}

function storeBird(id: BirdId): void {
  try {
    window.localStorage.setItem(BIRD_STORAGE_KEY, id);
  } catch {
    // Selection still applies for this session.
  }
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(TUNING.cameraFov, 1, 0.1, 160);
  private readonly input = new FlapInput();
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private state: GameState = 'loading';
  private bird: Bird | null = null;
  private pipes: PipeField | null = null;
  private environment: Environment | null = null;
  private birdModel: LoadedModel | null = null;
  private birdId: BirdId = readStoredBird();

  private frame = 0;
  private score = 0;
  private elapsed = 0;
  private stateTime = 0;
  private cameraY = TUNING.birdStartY + TUNING.cameraHeight;
  private shakeTime = 0;
  private dieSoundPlayed = false;
  private rng = createSeededRandom(Math.floor(performance.now()) || 1);
  private pausedForScreenshot = false;
  private reducedMotion = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.createSky();
    this.updateCamera(0, true);
    resizeRenderer(this.renderer, this.camera);

    this.input.onFlap(() => this.handleFlap());
    this.hud.onMuteToggle(() => {
      this.audio.setMuted(!this.audio.isMuted());
      this.hud.setMuted(this.audio.isMuted());
    });
    this.hud.onRestart(() => {
      if (this.state === 'over') this.restart();
    });
    this.hud.buildBirdOptions(BIRDS, this.birdId, (id) => void this.selectBird(id));
    this.hud.setMuted(false);
    this.hud.setScore(0);
    this.hud.setLoading('Loading…');

    void this.loadAssets();
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private async loadAssets(): Promise<void> {
    try {
      const models = await loadCoreModels(this.birdId);
      this.birdModel = models.bird;
      this.pipes = new PipeField(models.pipe, this.rng);
      this.environment = new Environment(models.cloud, this.rng);
      this.scene.add(this.environment.group, this.pipes.group);
      this.spawnBird();
      this.hud.setLoading(null);
      this.hud.showStart();
      this.state = 'ready';
      prefetchBirds();
    } catch (error) {
      // First failure is terminal for this attempt; keep it visible.
      if (this.state !== 'failed') {
        this.state = 'failed';
        console.error('Asset loading failed:', error);
        this.hud.setLoading('Failed to load game assets. Refresh to retry.', true);
      }
    }
  }

  /** Replace the visible bird, keeping it idling on the start screen. */
  private spawnBird(): void {
    if (!this.birdModel) return;
    if (this.bird) this.scene.remove(this.bird.group);
    // Bird clones the shared model, so geometry and materials stay owned by
    // the loaded asset and there is nothing to dispose here.
    this.bird = new Bird(this.birdModel, findBird(this.birdId));
    this.scene.add(this.bird.group);
    this.updateCamera(0, true);
  }

  private async selectBird(id: BirdId): Promise<void> {
    if (id === this.birdId) return;
    this.birdId = id;
    storeBird(id);
    try {
      const model = await loadBirdModel(id);
      // A quick second pick supersedes this one; do not let a slow load
      // overwrite the newer choice.
      if (this.birdId !== id) return;
      this.birdModel = model;
      // Only reachable from the start and game-over screens, so swapping the
      // model mid-flight is not a case that needs handling.
      this.spawnBird();
    } catch (error) {
      console.error(`Failed to load bird "${id}":`, error);
      this.hud.setLoading('That bird failed to load.', true);
    }
  }

  private handleFlap(): void {
    // The picker sits over the start and game-over screens; a tap or Space
    // there is meant for the panel, not the bird.
    if (this.hud.isPickerOpen()) return;

    switch (this.state) {
      case 'ready':
        this.beginPlay();
        break;
      case 'playing':
        this.bird?.flap();
        this.audio.play('flap');
        break;
      case 'over':
        if (this.stateTime > RESTART_COOLDOWN) this.restart();
        break;
      default:
        break;
    }
  }

  private beginPlay(): void {
    if (!this.bird) return;
    this.setState('playing');
    this.score = 0;
    this.hud.setScore(0);
    this.hud.showPlaying();
    this.bird.flap();
    this.audio.play('flap');
  }

  private restart(): void {
    if (!this.bird || !this.pipes) return;
    this.bird.reset();
    this.pipes.reset();
    this.beginPlay();
  }

  private die(): void {
    if (!this.bird || this.state !== 'playing') return;
    this.setState('dying');
    this.bird.kill();
    this.audio.play('hit');
    this.dieSoundPlayed = false;
    this.shakeTime = 0.35;
  }

  private setState(state: GameState): void {
    this.state = state;
    this.stateTime = 0;
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    resizeRenderer(this.renderer, this.camera);
    this.elapsed += delta;
    this.stateTime += delta;
    const animElapsed = this.reducedMotion ? 0 : elapsed;
    const animDelta = this.reducedMotion ? 0 : delta;

    switch (this.state) {
      case 'ready':
        this.bird?.updateIdle(animElapsed);
        this.environment?.update(animDelta);
        break;

      case 'playing': {
        if (!this.bird || !this.pipes) break;
        this.bird.updatePhysics(delta, elapsed);
        this.environment?.update(delta);

        const result = this.pipes.update(delta, this.bird.y, this.bird.colliderRadius);
        if (result.passed > 0) {
          this.score += result.passed;
          this.hud.setScore(this.score);
          this.audio.play('point');
        }
        if (result.hit || this.bird.isOnGround()) {
          this.die();
        }
        break;
      }

      case 'dying':
        // World freezes on impact, classic style; the bird tumbles down alone.
        this.bird?.updatePhysics(delta, elapsed);
        // The original plays "hit" on impact and "die" as the fall begins.
        if (!this.dieSoundPlayed && this.stateTime > 0.25) {
          this.dieSoundPlayed = true;
          this.audio.play('die');
        }
        if ((this.bird?.isOnGround() ?? true) || this.stateTime > 1.1) {
          this.setState('over');
          this.hud.showGameOver(this.score);
        }
        break;

      default:
        break;
    }

    this.updateCamera(delta);
    this.publishDiagnostics();
  }

  private updateCamera(delta: number, snap = false): void {
    const targetY = (this.bird?.y ?? TUNING.birdStartY) + TUNING.cameraHeight;
    this.cameraY = snap
      ? targetY
      : THREE.MathUtils.lerp(this.cameraY, targetY, 1 - Math.exp(-TUNING.cameraLag * delta));

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= delta;
      const strength = this.shakeTime * 0.5;
      shakeX = (this.rng() - 0.5) * strength;
      shakeY = (this.rng() - 0.5) * strength;
    }

    this.camera.position.set(shakeX, this.cameraY + shakeY, TUNING.cameraDistance);
    this.camera.lookAt(0, this.cameraY - 1.3, -12);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private createSky(): void {
    this.scene.background = this.createSkyGradient();
    // Metallic surfaces show only what they reflect, so the chrome bird renders
    // black under lights alone. A prefiltered room environment gives every
    // material something to reflect; non-metals are barely affected.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // Metals need a strong environment to read as metal; the sea and grass are
    // fully rough non-metals, so they barely pick it up.
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();
    // Fog tinted to the pale horizon so the causeway and sea melt into it.
    this.scene.fog = new THREE.Fog('#a9e9f2', 60, 190);

    this.renderer.toneMappingExposure = 1.2;
    const hemisphere = new THREE.HemisphereLight('#eafcff', '#3fc6dd', 1.3);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight('#fffbe8', 2.1);
    sun.position.set(8, 16, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 26;
    sun.shadow.camera.bottom = -26;
    this.scene.add(sun);
  }

  /** Deep blue overhead fading to a pale horizon, as in the reference art. */
  private createSkyGradient(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create sky texture context.');

    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#1273d4');
    gradient.addColorStop(0.45, '#43b4e8');
    gradient.addColorStop(0.78, '#8fdcf2');
    gradient.addColorStop(1, '#c6f2f8');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 2, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private installTestHooks(): void {
    // Deterministic hooks for visual baselines and bot playtests. All gameplay
    // randomness flows through this.rng so seed() keeps runs reproducible.
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
        this.pipes?.setRng(this.rng);
      },
      setState: (name: string) => {
        if (name === 'active-play') {
          if (this.bird && this.pipes) this.restart();
        } else if (name === 'complete') {
          if (this.state === 'playing') this.die();
          else if (this.state === 'ready') {
            this.beginPlay();
            this.die();
          }
        } else {
          console.warn(`Unknown test state: ${name}`);
        }
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => {
        // No debug UI ships in this game; nothing to hide.
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.score,
      targetScore: 0,
      complete: this.state === 'over',
      player: {
        position: {
          x: 0,
          y: this.bird?.y ?? TUNING.birdStartY,
          z: 0,
        },
        speed: Math.abs(this.bird?.velocityY ?? 0),
      },
      nextPipe: this.pipes?.nextGapAhead() ?? null,
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
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      },
    };
  }
}
