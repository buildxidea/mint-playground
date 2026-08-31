import * as THREE from 'three';
import { AssetLibrary } from '../assets/AssetLibrary';
import { VEHICLE_MODEL, type VehicleId } from '../assets/manifest';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { CHALLENGES } from '../levels/challenges';
import { parkedVehicleSpec } from '../levels/GenericParkedCars';
import {
  LOT_HALF_D,
  LOT_HALF_W,
  LevelBuilder,
  OBSTACLE_COLLIDER,
} from '../levels/LevelBuilder';
import { ChaseCamera } from '../systems/ChaseCamera';
import { DriveInput } from '../systems/DriveInput';
import { Hud } from '../systems/Hud';
import { ParkingAudio } from '../systems/ParkingAudio';
import { PhysicsWorld } from '../systems/PhysicsWorld';
import {
  computeAlign,
  computeScore,
  vehicleBayClearance,
  vehicleInsideBay,
} from '../systems/Scoring';
import { createSeededRandom } from '../utils/random';
import {
  groundVehicleMesh,
  measureAsphaltClearance,
  measureGroundClearance,
} from '../vehicles/groundVehicle';
import {
  PARKING_FIT_MARGIN,
  VEHICLE_PROFILES,
  vehicleColliderHalfExtents,
} from '../vehicles/profiles';

type Phase = 'loading' | 'title' | 'select' | 'countdown' | 'play' | 'success' | 'results';

/** Softer than green pad: in-square + stopped should succeed. */
const SUCCESS_ALIGN = 0.62;
const STOP_SPEED = 0.75;
const SUCCESS_HOLD = 0.45;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  private readonly loop: Loop;
  private readonly assets = new AssetLibrary();
  private readonly physics = new PhysicsWorld();
  private readonly hud = new Hud();
  private readonly chase = new ChaseCamera(this.camera);
  private input!: DriveInput;
  private audio!: ParkingAudio;
  private levels!: LevelBuilder;

  private phase: Phase = 'loading';
  private vehicleId: VehicleId = 'compact';
  private challengeIndex = 0;
  private countdown = 3;
  private countdownAcc = 0;
  private elapsed = 0;
  private align = 0;
  private insideBay = false;
  private fitClearance = -Infinity;
  private successHold = 0;
  private frame = 0;
  private lastStars = 0;
  private starHistory: number[] = [];
  private vehicleMesh: THREE.Object3D | null = null;
  private muted = false;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private rng = createSeededRandom(1);
  private ready = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMappingExposure = 0.92;

    this.loop = new Loop(
      (dt, elapsed) => this.update(dt, elapsed),
      () => this.render(),
    );

    this.hud.onAction((action) => void this.handleAction(action));
    document.querySelector('#mute-button')?.addEventListener('click', () => {
      this.muted = this.audio.toggleMute();
      const btn = document.querySelector('#mute-button');
      if (btn) btn.textContent = this.muted ? 'Unmute' : 'Mute';
    });
    document.querySelector('#reset-cam-button')?.addEventListener('click', () => {
      this.chase.resetBehind();
    });

    void this.bootstrap();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.chase.dispose();
    this.input?.dispose();
    this.audio?.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private async bootstrap(): Promise<void> {
    this.hud.setLoading(true, 'Warming up the lot…');
    await this.physics.init();
    await this.assets.loadAll((label) => this.hud.setLoading(true, label));

    this.audio = new ParkingAudio(this.assets);
    this.levels = new LevelBuilder(this.scene, this.assets, this.physics);
    this.setupLighting();
    this.levels.buildSharedLot();

    this.input = new DriveInput(
      this.must('#steer-stick'),
      this.must('#steer-knob'),
      this.must('#accel-button'),
      this.must('#brake-button'),
      this.must('#reverse-button'),
      this.must('#restart-button'),
    );
    this.chase.bind(this.canvas);

    this.installTestHooks();
    this.ready = true;
    this.hud.setLoading(false);
    this.showTitle();
    resizeRenderer(this.renderer, this.camera, 2);
  }

  private setupLighting(): void {
    this.scene.background = new THREE.Color('#9fd0e6');
    this.scene.fog = new THREE.Fog('#b7dce8', 28, 70);

    const hemi = new THREE.HemisphereLight('#fff6df', '#5f8a6a', 1.05);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff2c9', 1.7);
    sun.position.set(-8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    this.scene.add(sun);
  }

  private showTitle(): void {
    this.phase = 'title';
    this.hud.showOverlay(
      'Perfect Parking 3D',
      `<p>Park carefully. Earn up to three stars. Avoid cones, barriers, and painted lines.</p>
       <p><strong>WASD / Arrows</strong> drive · <strong>Space</strong> brake · <strong>R</strong> restart</p>
       <p><strong>Drag</strong> look 360° · <strong>Scroll</strong> zoom · <strong>C</strong> / double-click reset cam</p>`,
      [{ id: 'to-select', label: 'Choose Vehicle', primary: true }],
    );
  }

  private showSelect(): void {
    this.phase = 'select';
    this.hud.showOverlay(
      'Pick your ride',
      `<div class="vehicle-grid">
        <p><strong>Compact</strong> — balanced and forgiving</p>
        <p><strong>Sports</strong> — quick, sharp, easy to overshoot</p>
        <p><strong>Delivery Van</strong> — wide, slow, careful corners</p>
      </div>`,
      [
        { id: 'pick-compact', label: 'Compact', primary: true },
        { id: 'pick-sports', label: 'Sports' },
        { id: 'pick-van', label: 'Van' },
      ],
    );
  }

  private async handleAction(action: string): Promise<void> {
    await this.audio.unlock();
    if (action === 'to-select' || action === 'replay') {
      this.challengeIndex = 0;
      this.starHistory = [];
      this.showSelect();
      return;
    }
    if (action.startsWith('pick-')) {
      this.vehicleId = action.replace('pick-', '') as VehicleId;
      this.beginChallenge();
      return;
    }
    if (action === 'next') {
      this.challengeIndex += 1;
      if (this.challengeIndex >= CHALLENGES.length) this.showResults();
      else this.beginChallenge();
      return;
    }
    if (action === 'retry') {
      this.beginChallenge();
    }
  }

  private beginChallenge(): void {
    const challenge = CHALLENGES[this.challengeIndex];
    this.levels.loadChallenge(challenge);
    this.spawnVehicle();
    this.physics.resetVehicle(
      VEHICLE_PROFILES[this.vehicleId],
      challenge.spawn.x,
      challenge.spawn.z,
      challenge.spawn.yaw,
    );
    this.chase.snap(challenge.spawn.x, challenge.spawn.z, challenge.spawn.yaw);
    this.elapsed = 0;
    this.align = 0;
    this.insideBay = false;
    this.fitClearance = -Infinity;
    this.successHold = 0;
    this.countdown = 3;
    this.countdownAcc = 0;
    this.phase = 'countdown';
    this.hud.hideOverlay();
    // Keep seeded RNG warm for deterministic QA hooks.
    void this.rng();
    this.audio.play('countdown', 0.45);
    this.pushHud('Get ready…', '3');
  }

  private spawnVehicle(): void {
    if (this.vehicleMesh) {
      this.scene.remove(this.vehicleMesh);
      this.vehicleMesh = null;
    }
    const key = VEHICLE_MODEL[this.vehicleId];
    this.vehicleMesh = this.assets.cloneModel(key);
    this.scene.add(this.vehicleMesh);
    const challenge = CHALLENGES[this.challengeIndex];
    groundVehicleMesh(
      this.vehicleMesh,
      challenge.spawn.x,
      challenge.spawn.z,
      challenge.spawn.yaw,
      this.physics.getFloorY(),
    );
  }

  private update(dt: number, _elapsed: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, 2);
    if (!this.ready || this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    const axes = this.input.sample();
    if (axes.restartPressed && (this.phase === 'play' || this.phase === 'countdown')) {
      this.beginChallenge();
      return;
    }

    if (this.phase === 'countdown') {
      this.countdownAcc += dt;
      if (this.countdown > 0 && this.countdownAcc >= 1) {
        this.countdownAcc -= 1;
        this.countdown -= 1;
        if (this.countdown > 0) this.audio.play('countdown', 0.45);
      }
      this.syncVehicleVisual();
      this.chase.update(dt, ...this.poseXZYaw(), 0.1);
      if (this.countdown === 0 && this.countdownAcc >= 0.55) {
        this.phase = 'play';
        this.pushHud('Park fully inside the green space');
        this.publishDiagnostics(false);
        return;
      }
      this.pushHud('Get ready…', this.countdown > 0 ? String(this.countdown) : 'GO!');
      this.publishDiagnostics(false);
      return;
    }

    if (this.phase === 'play') {
      const profile = VEHICLE_PROFILES[this.vehicleId];
      const pose = this.physics.step(dt, profile, axes.throttle, axes.steer, axes.brake);
      if (pose.collided) {
        const impact = Math.min(1, pose.speedAbs / 6);
        this.audio.playCollision(0.22 + impact * 0.38);
      }
      // Tire: hard steer + speed, gated inside ParkingAudio cooldown.
      if (Math.abs(axes.steer) > 0.85 && Math.abs(pose.speed) > 4.2) {
        this.audio.playTire(0.14 + Math.min(0.1, Math.abs(pose.speed) * 0.02));
      }
      this.audio.updateEngine(pose.speed, profile.maxSpeed);
      this.elapsed += dt;

      const challenge = CHALLENGES[this.challengeIndex];
      this.align = computeAlign(
        pose.x,
        pose.z,
        pose.yaw,
        challenge.bay.x,
        challenge.bay.z,
        challenge.bay.yaw,
        2.4,
        Math.PI / 2.4,
      );
      this.fitClearance = vehicleBayClearance(
        pose.x,
        pose.z,
        pose.yaw,
        profile.length / 2,
        profile.width / 2,
        challenge.bay,
      );
      this.insideBay = vehicleInsideBay(
        pose.x,
        pose.z,
        pose.yaw,
        profile.length / 2,
        profile.width / 2,
        challenge.bay,
        PARKING_FIT_MARGIN,
      );
      this.levels.pulseBay(
        this.align,
        this.insideBay,
        this.reducedMotion ? 0 : dt,
      );

      const stopped = pose.speedAbs < STOP_SPEED;
      if (this.insideBay && stopped && this.align >= SUCCESS_ALIGN) {
        this.successHold += dt;
        this.pushHud('Hold steady — fully inside');
        if (this.successHold >= SUCCESS_HOLD) this.completePark();
      } else {
        this.successHold = Math.max(0, this.successHold - dt * 2);
        if (!this.insideBay && this.fitClearance > -0.35) {
          this.pushHud('Bring every corner inside');
        } else if (!this.insideBay) this.pushHud('Aim for the green space');
        else if (!stopped) this.pushHud('Stop fully in the bay');
        else this.pushHud('Straighten up a bit');
      }

      this.syncVehicleVisual();
      this.chase.update(dt, pose.x, pose.z, pose.yaw);
      this.publishDiagnostics(this.insideBay);
      return;
    }

    if (this.phase === 'success') {
      this.countdownAcc += dt;
      this.syncVehicleVisual();
      if (this.countdownAcc > 1.6) {
        this.challengeIndex += 1;
        if (this.challengeIndex >= CHALLENGES.length) this.showResults();
        else this.beginChallenge();
      }
      this.publishDiagnostics();
    }
  }

  private completePark(): void {
    const challenge = CHALLENGES[this.challengeIndex];
    const result = computeScore({
      align: this.align,
      elapsed: this.elapsed,
      parTime: challenge.parTime,
      collisions: this.physics.collisions,
      lineViolations: this.physics.lineViolations,
    });
    this.lastStars = result.stars;
    this.starHistory[this.challengeIndex] = result.stars;
    this.audio.play('success', 0.7);
    this.phase = 'success';
    this.countdownAcc = 0;
    this.hud.showOverlay(
      `${result.stars} Star${result.stars === 1 ? '' : 's'}!`,
      `<p>${challenge.name} complete.</p>
       <p>Score <strong>${Math.round(result.score)}</strong> · Time ${this.elapsed.toFixed(1)}s · Hits ${this.physics.collisions + this.physics.lineViolations}</p>
       <p>Next challenge loading…</p>`,
      [{ id: 'next', label: 'Next now', primary: true }],
    );
  }

  private showResults(): void {
    this.phase = 'results';
    const total = this.starHistory.reduce((a, b) => a + (b ?? 0), 0);
    const rows = CHALLENGES.map(
      (c, i) => `<p>${c.name}: ${'★'.repeat(this.starHistory[i] ?? 0)}${'☆'.repeat(3 - (this.starHistory[i] ?? 0))}</p>`,
    ).join('');
    this.hud.showOverlay(
      'Lot cleared!',
      `<p>You earned <strong>${total}</strong> / ${CHALLENGES.length * 3} stars.</p>${rows}`,
      [{ id: 'replay', label: 'Play again', primary: true }],
    );
  }

  private syncVehicleVisual(): void {
    if (!this.vehicleMesh) return;
    const pose = this.physics.getPose();
    groundVehicleMesh(
      this.vehicleMesh,
      pose.x,
      pose.z,
      pose.yaw,
      this.physics.getFloorY(),
      pose.bodyPitch,
      pose.bodyRoll,
    );
  }

  private poseXZYaw(): [number, number, number] {
    const p = this.physics.getPose();
    return [p.x, p.z, p.yaw];
  }

  private pushHud(status: string, countdown: string | null = null): void {
    const challenge = CHALLENGES[this.challengeIndex] ?? CHALLENGES[0];
    const preview = computeScore({
      align: Math.max(this.align, 0.5),
      elapsed: this.elapsed,
      parTime: challenge.parTime,
      collisions: this.physics.collisions,
      lineViolations: this.physics.lineViolations,
    }).stars;
    this.hud.updatePlay({
      challengeName: challenge.name,
      challengeIndex: this.challengeIndex + 1,
      challengeCount: CHALLENGES.length,
      timer: this.elapsed,
      align: this.align,
      insideBay: this.insideBay,
      collisions: this.physics.collisions,
      lineViolations: this.physics.lineViolations,
      starsPreview: this.phase === 'play' ? preview : this.lastStars,
      status,
      countdown,
    });
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
        if (name === 'active-play') {
          this.vehicleId = 'compact';
          this.challengeIndex = 0;
          this.beginChallenge();
          // Skip countdown for deterministic bot/visual tests.
          this.phase = 'play';
          this.countdown = 0;
          this.countdownAcc = 0;
          this.hud.hideOverlay();
          this.pushHud('Park fully inside the green space');
        } else if (name === 'complete' || name === 'success') {
          if (this.phase !== 'play' && this.phase !== 'countdown') {
            this.vehicleId = 'compact';
            this.challengeIndex = 0;
            this.beginChallenge();
            this.phase = 'play';
            this.hud.hideOverlay();
          }
          this.align = 1;
          this.completePark();
        } else if (name === 'title') {
          this.showTitle();
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
        /* no lil-gui in production HUD */
      },
      setChallenge: (index: number) => {
        this.challengeIndex = Math.max(0, Math.min(CHALLENGES.length - 1, index));
        this.beginChallenge();
        this.phase = 'play';
        this.countdown = 0;
        this.countdownAcc = 0;
        this.hud.hideOverlay();
      },
      forceParkSuccess: () => {
        this.align = 1;
        this.completePark();
      },
      setPose: (x: number, z: number, yaw?: number) => {
        const profile = VEHICLE_PROFILES[this.vehicleId];
        const poseYaw = yaw ?? this.physics.getPose().yaw;
        this.physics.setPose(x, z, poseYaw, profile.height);
        this.syncVehicleVisual();
        this.chase.snap(x, z, poseYaw);
        // Refresh align/inside for HUD when teleporting in play.
        if (this.phase === 'play') {
          const challenge = CHALLENGES[this.challengeIndex];
          this.align = computeAlign(
            x,
            z,
            poseYaw,
            challenge.bay.x,
            challenge.bay.z,
            challenge.bay.yaw,
            2.4,
            Math.PI / 2.4,
          );
          this.fitClearance = vehicleBayClearance(
            x,
            z,
            poseYaw,
            profile.length / 2,
            profile.width / 2,
            challenge.bay,
          );
          this.insideBay = vehicleInsideBay(
            x,
            z,
            poseYaw,
            profile.length / 2,
            profile.width / 2,
            challenge.bay,
            PARKING_FIT_MARGIN,
          );
          this.levels.pulseBay(this.align, this.insideBay, 1);
          this.pushHud(
            this.insideBay ? 'Hold steady — fully inside' : 'Aim for the green space',
          );
          this.publishDiagnostics(this.insideBay);
        } else {
          this.publishDiagnostics();
        }
      },
      setVehicle: (id: VehicleId) => {
        this.vehicleId = id;
        this.beginChallenge();
        this.phase = 'play';
        this.countdown = 0;
        this.countdownAcc = 0;
        this.hud.hideOverlay();
      },
      getDriveMap: () => {
        const challenge = CHALLENGES[this.challengeIndex];
        const parkedCars = challenge.parkingSpaces.flatMap((space) => {
          if (!space.occupied) return [];
          const spec = parkedVehicleSpec(space.occupied.vehicle);
          const half = vehicleColliderHalfExtents(spec);
          return [
            {
              kind: 'parked-car',
              x: space.x,
              z: space.z,
              yaw: space.yaw,
              hx: half.hx,
              hz: half.hz,
            },
          ];
        });
        return {
          halfW: LOT_HALF_W,
          halfD: LOT_HALF_D,
          asphalt: this.levels.getAsphaltBounds(),
          obstacles: [
            ...challenge.obstacles.map((obs) => {
              const col = OBSTACLE_COLLIDER[obs.kind];
              return {
                kind: obs.kind,
                x: obs.x,
                z: obs.z,
                yaw: obs.yaw ?? 0,
                hx: col.hx,
                hz: col.hz,
              };
            }),
            ...parkedCars,
          ],
          bay: { ...challenge.bay },
          spawn: { ...challenge.spawn },
          driveRoute: challenge.driveRoute.map((point) => ({ ...point })),
          challengeIndex: this.challengeIndex,
          vehicleId: this.vehicleId,
        };
      },
      injectAxes: (axes) => {
        this.input.injectAxes(axes);
      },
      setCameraOrbit: (yaw: number, pitch?: number, distance?: number) => {
        const pose = this.physics.getPose();
        this.chase.snapOrbit(pose.x, pose.z, yaw, pitch, distance);
        this.render();
        this.publishDiagnostics();
      },
    };
  }

  private publishDiagnostics(insideBay?: boolean): void {
    const pose = this.ready
      ? this.physics.getPose()
      : {
          x: 0,
          z: 0,
          yaw: 0,
          speed: 0,
          speedAbs: 0,
          steerAngle: 0,
          bodyRoll: 0,
          bodyPitch: 0,
          yawRate: 0,
        };
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.lastStars,
      targetScore: 3,
      complete: this.phase === 'results' || this.phase === 'success',
      player: {
        position: { x: pose.x, y: 0, z: pose.z },
        speed: pose.speed,
        yaw: pose.yaw,
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
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      },
      align: this.align,
      fitClearance: Number.isFinite(this.fitClearance) ? this.fitClearance : -99,
      challengeIndex: this.challengeIndex,
      phase: this.phase,
      collisions: this.physics.collisions,
      lineViolations: this.physics.lineViolations,
      groundClearance: this.vehicleMesh
        ? measureGroundClearance(this.vehicleMesh, this.physics.getFloorY())
        : 0,
      asphaltClearance:
        this.vehicleMesh && this.levels.getAsphaltBounds()
          ? measureAsphaltClearance(this.vehicleMesh, this.levels.getAsphaltBounds()!)
          : 0,
      steerAngle: pose.steerAngle ?? 0,
      heading: this.headingDiagnostics(pose.yaw),
      insideBay: insideBay ?? this.insideBay,
      successHold: this.successHold,
      vehicleId: this.vehicleId,
      scene: this.ready
        ? this.levels.getSceneCounts()
        : {
            parkedCars: 0,
            genericCars: 0,
            parkingSpaces: 0,
            environmentAssets: 0,
            minParkedGroundClearance: 0,
            maxParkedGroundClearance: 0,
            minParkedAsphaltClearance: 0,
            parkedGroundClearances: [],
            minPlacementClearance: 0,
            placementConflictCount: 0,
          },
      physics: this.ready ? this.physics.diagnostics() : undefined,
    };
  }

  /**
   * Footprint check in pivot-local space: after forward bake, car length must
   * dominate local Z (gameplay forward), not X (sideways).
   */
  private headingDiagnostics(yaw: number): {
    physicsX: number;
    physicsZ: number;
    sizeX: number;
    sizeZ: number;
    lengthAlongHeading: boolean;
  } {
    const physicsX = Math.sin(yaw);
    const physicsZ = Math.cos(yaw);
    if (!this.vehicleMesh) {
      return {
        physicsX,
        physicsZ,
        sizeX: 0,
        sizeZ: 0,
        lengthAlongHeading: false,
      };
    }
    const visual = this.vehicleMesh.children[0] ?? this.vehicleMesh;
    // Prefer sizes baked at load (stable under body lean / turns).
    const sizeX = Number(visual.userData.footprintX ?? 0);
    const sizeZ = Number(visual.userData.footprintZ ?? 0);
    return {
      physicsX: Number(physicsX.toFixed(3)),
      physicsZ: Number(physicsZ.toFixed(3)),
      sizeX: Number(sizeX.toFixed(3)),
      sizeZ: Number(sizeZ.toFixed(3)),
      lengthAlongHeading: sizeZ > sizeX * 1.15,
    };
  }

  private must(selector: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Missing ${selector}`);
    return el;
  }
}
