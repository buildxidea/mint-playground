import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Boat } from '../entities/Boat';
import { Hud } from '../systems/Hud';
import { AudioSystem } from '../systems/AudioSystem';
import { Water } from '../world/Water';
import { Harbor } from '../world/Harbor';
import { Course, attachGateModel } from '../world/Course';
import { Wildlife } from '../world/Wildlife';
import { SeaHazards } from '../world/SeaHazards';
import { Wake } from '../world/Wake';
import { Splashes } from '../world/Splash';
import type { CircleHazard } from '../world/hazards';
import { FLEET, type BoatSpec } from './fleet';
import { loadSettings, qualityMaxDpr, type GameSettings } from './settings';
import { createSeededRandom } from '../utils/random';
import { loadMintModel } from '../assets/ModelLibrary';

type GameState = 'menu' | 'playing' | 'mooring' | 'docked' | 'failed';

const HEADING_TOLERANCE = THREE.MathUtils.degToRad(28);
const MOORING_DURATION = 3.2;

export class Game {
  onReturnToMenu: (() => void) | null = null;
  onLevelDocked: ((index: number, stars: number, boatId: string) => void) | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
  private readonly input: InputController;
  private readonly hud = new Hud();
  readonly audio = new AudioSystem();
  private readonly water = new Water();
  private readonly harbor = new Harbor();
  private readonly course = new Course();
  private readonly wildlife = new Wildlife();
  private readonly seaHazards = new SeaHazards(this.water);
  private readonly wake = new Wake(this.water);
  private readonly splashes = new Splashes(this.water);
  private readonly sun: THREE.DirectionalLight;
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  /** The run's play order. Position 0 is always the starter boat. */
  private order: BoatSpec[] = [...FLEET];
  private settings: GameSettings = loadSettings();
  private state: GameState = 'menu';
  private levelIndex = 0;
  private boat: Boat;
  private damage = 0;
  private elapsed = 0;
  private frame = 0;
  private fleetComplete = false;
  private mooringTime = 0;
  private mooringPose = { x: 0, z: 0, heading: Math.PI / 2 };
  private readonly mooringVelocity = new THREE.Vector3();
  private mooringHeadingVel = 0;
  /** Paces the settling foam while a hull moors. */
  private rippleTimer = 0;
  /** The ocean's clock, held so an impact anywhere can stamp its splash. */
  private waveTime = 0;
  private readonly hullCorners = Array.from({ length: 6 }, () => new THREE.Vector3());
  private readonly moveInput = new THREE.Vector2();
  /** Rudder (x) and throttle (y) eased toward the raw input, so keys are not a step function. */
  private readonly controls = new THREE.Vector2();
  private readonly cameraTarget = new THREE.Vector3();
  private menuAngle = 0;
  /** Shifts every generated course layout; QA can pin it via the seed hook. */
  private layoutSeed = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private boatLoadToken = 0;
  /** Set while the hull is inside a hazard, so the HUD can name it. */
  private hazardCallout: string | null = null;
  private wasBoosting = false;
  private lastWhalePhase = '';
  private worldHalfWidth = 1100;
  /**
   * Where a retry resumes. The course runs kilometres, so losing a five-minute
   * carrier approach to one bad dock is not a fair price for a mistake.
   */
  private checkpoint: {
    x: number;
    z: number;
    heading: number;
    elapsed: number;
    damage: number;
    progress: { nextGate: number; missed: number; cleared: (boolean | null)[] };
  } | null = null;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && this.state !== 'menu') {
      this.enterMenu();
      this.onReturnToMenu?.();
      return;
    }
    if (this.state === 'docked') {
      if (event.code === 'KeyN' && !this.fleetComplete) this.startLevel(this.levelIndex + 1);
      else if (event.code === 'KeyR') this.startLevel(this.fleetComplete ? 0 : this.levelIndex);
    } else if ((this.state === 'failed' || this.state === 'playing') && event.code === 'KeyR') {
      this.retry();
    }
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);

    const stick = this.getElement('#touch-stick');
    const knob = this.getElement('#touch-knob');
    const boostButton = this.getElement('#boost-button');
    this.input = new InputController(stick, knob, boostButton);

    this.boat = new Boat(this.order[0]);
    this.createScene();
    this.loadHarborModels();
    this.loadBoatModel(this.boat);
    this.sun = this.scene.getObjectByName('sun') as THREE.DirectionalLight;
    this.applySettings(this.settings);
    this.enterMenu();
    window.addEventListener('keydown', this.onKeyDown);
    resizeRenderer(this.renderer, this.camera, qualityMaxDpr(this.settings.quality));
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    window.removeEventListener('keydown', this.onKeyDown);
    this.input.dispose();
    this.audio.dispose();
    this.boat.dispose();
    this.water.dispose();
    this.harbor.dispose();
    this.course.dispose();
    this.wildlife.dispose();
    this.seaHazards.dispose();
    this.wake.dispose();
    this.splashes.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  /** Set the run's play order. Only takes effect from the next level start. */
  setFleetOrder(order: BoatSpec[]): void {
    if (!order.length) return;
    this.order = [...order];
    this.levelIndex = THREE.MathUtils.clamp(this.levelIndex, 0, this.order.length - 1);
    if (this.state === 'menu') this.enterMenu();
  }

  /** Start a specific vessel by id, wherever it sits in the run order. */
  startBoat(id: string): boolean {
    const position = this.order.findIndex((spec) => spec.id === id);
    if (position < 0) return false;
    this.startLevel(position);
    return true;
  }

  /** The vessel currently being sailed. */
  get currentBoatId(): string {
    return this.boat.spec.id;
  }

  /** The run's play order, for the menu's fleet list. */
  get fleetOrder(): readonly BoatSpec[] {
    return this.order;
  }

  applySettings(settings: GameSettings): void {
    this.settings = settings;
    this.audio.setVolume(settings.volume);
    this.audio.setMuted(settings.muted);
    this.water.setIntensity(settings.waveIntensity);
    resizeRenderer(this.renderer, this.camera, qualityMaxDpr(settings.quality));
  }

  startLevel(index: number): void {
    this.levelIndex = THREE.MathUtils.clamp(index, 0, this.order.length - 1);
    const spec = this.order[this.levelIndex];

    this.boat.group.removeFromParent();
    this.boat.dispose();
    this.boat = new Boat(spec);
    this.scene.add(this.boat.group);
    this.loadBoatModel(this.boat);

    this.harbor.configureForBoat(spec, FLEET.indexOf(spec) + 1);
    this.harbor.setBerthHighlight(false);

    // The run starts out in open water at the head of the slalom, not on the
    // marina's doorstep. Everything on the course is seeded off the boat so a
    // retry replays the same course.
    const seed = (FLEET.indexOf(spec) + 1) * 97 + this.layoutSeed;
    this.course.configure(spec, this.harbor.berth.entranceZ, this.harbor.berth.centerX);
    this.wildlife.configure(spec, this.course, this.harbor.berth.entranceZ, createSeededRandom(seed * 31 + 7));
    this.seaHazards.configure(
      spec,
      this.course.startZ,
      this.harbor.berth.entranceZ,
      createSeededRandom(seed * 71 + 3),
      this.course.gates,
    );

    this.worldHalfWidth = Math.max(spec.length * 8, 900);
    const spawn = this.course.spawnPose();
    this.boat.group.position.set(spawn.x, 0, spawn.z);
    this.boat.heading = Math.PI; // Facing the course.
    this.boat.stop();
    this.controls.set(0, 0);
    this.resetWake();

    this.checkpoint = null;
    this.damage = 0;
    this.elapsed = 0;
    this.fleetComplete = false;
    this.state = 'playing';
    this.hud.setVisible(true);
    this.hud.hideBanner();
    this.hud.setLevel(spec.name, this.levelIndex, this.order.length);
    this.hud.setGates(0, this.course.total, 0);
    this.hud.setStatus('');
    this.snapCamera();
  }

  enterMenu(): void {
    this.state = 'menu';
    this.hud.setVisible(false);
    const spec = this.order[Math.min(this.levelIndex, this.order.length - 1)];
    this.harbor.configureForBoat(spec, FLEET.indexOf(spec) + 1);
    const pose = this.harbor.mooringPose(spec);
    this.boat.group.position.set(pose.x, 0, pose.z);
    this.boat.heading = pose.heading;
    this.boat.stop();
    this.controls.set(0, 0);
    this.resetWake();
    this.menuAngle = 0;
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    resizeRenderer(this.renderer, this.camera, qualityMaxDpr(this.settings.quality));
    const waveTime = this.reducedMotion ? 0 : elapsed;
    this.waveTime = waveTime;
    this.water.update(waveTime);
    this.water.setCenter(this.boat.group.position.x, this.boat.group.position.z);
    this.harbor.update(waveTime, this.water);
    this.course.updateFloat(waveTime, this.water);
    const lifeDelta = this.reducedMotion ? 0 : delta;
    this.wildlife.update(lifeDelta, waveTime, this.water);
    const whalePhase = this.wildlife.snapshot().whale?.phase ?? '';
    if (whalePhase === 'spout' && this.lastWhalePhase !== 'spout') this.audio.play('whale');
    this.lastWhalePhase = whalePhase;
    this.seaHazards.update(lifeDelta, waveTime, this.water);

    switch (this.state) {
      case 'menu':
        this.updateMenuScene(delta, waveTime);
        break;
      case 'playing':
        this.elapsed += delta;
        this.updatePlaying(delta, waveTime);
        break;
      case 'mooring':
        this.updateMooring(delta, waveTime);
        break;
      case 'docked':
      case 'failed':
        this.boat.updateBuoyancy(delta, waveTime, this.water, 0.6);
        break;
    }

    this.updateWake(delta, waveTime);
    this.updateSun();
    this.publishDiagnostics();
  }

  /** Swap the blockout hull for the generated model when it arrives. */
  private loadBoatModel(boat: Boat): void {
    const token = ++this.boatLoadToken;
    loadMintModel(boat.spec.mintKey)
      .then((model) => {
        if (token !== this.boatLoadToken || this.boat !== boat) return;
        boat.setModel(model);
      })
      .catch((error) => {
        console.warn(`Generated model unavailable for ${boat.spec.id}; keeping blockout.`, error);
      });
  }

  private loadHarborModels(): void {
    attachGateModel(this.course);
    loadMintModel('harbor-dock')
      .then((model) => {
        this.harbor.setDockModel(model, 64, 15);
        // The generated dock sits at its own height, so the foam ceiling has to
        // be taken again once it replaces the blockout.
        this.applyFoamCeiling();
      })
      .catch((error) => console.warn('Generated dock unavailable; keeping blockout.', error));
    loadMintModel('channel-buoy')
      .then((model) => this.harbor.setBuoyModel(model))
      .catch((error) => console.warn('Generated buoy unavailable; keeping blockout.', error));
  }

  private updateMenuScene(delta: number, waveTime: number): void {
    this.boat.updateBuoyancy(delta, waveTime, this.water, 0.8);
    if (!this.reducedMotion) this.menuAngle += delta * 0.06;
    const spec = this.boat.spec;
    const radius = spec.camDistance * 1.1;
    const cx = this.boat.group.position.x + Math.sin(this.menuAngle) * radius;
    const cz = this.boat.group.position.z + Math.cos(this.menuAngle) * radius * 0.7 + radius * 0.35;
    this.camera.position.lerp(new THREE.Vector3(cx, spec.camHeight * 1.05, cz), 1 - Math.exp(-delta * 2));
    this.camera.lookAt(this.boat.group.position.x, 2, this.boat.group.position.z);
  }

  private updatePlaying(delta: number, waveTime: number): void {
    this.input.readMovement(this.moveInput);
    // A key is either down or up, but a throttle lever and a rudder are not.
    // Ramping them gives the hull a continuous demand to answer, which is what
    // turns an on/off tap into a smooth surge or a rolled-in turn.
    this.controls.x += (this.moveInput.x - this.controls.x) * (1 - Math.exp(-delta / 0.14));
    this.controls.y += (-this.moveInput.y - this.controls.y) * (1 - Math.exp(-delta / 0.22));
    const throttle = this.controls.y;
    const rudder = this.controls.x;
    const boosting = this.input.isBoostHeld();

    this.simulateStep(delta, throttle, rudder, boosting);
    this.boat.updateBuoyancy(delta, waveTime, this.water);

    const spec = this.boat.spec;
    const inBerth = this.harbor.isInsideBerth(this.boat.group.position.x, this.boat.group.position.z);
    this.harbor.setBerthHighlight(inBerth);

    const headingError = this.headingErrorToDock();
    // Mooring needs the hull actually at rest, not just slow along the bow —
    // otherwise a broadside skid would count as a clean arrival.
    const slowEnough = this.boat.velocityMagnitude <= spec.dockSpeed;

    if (inBerth) {
      if (!slowEnough) {
        this.hud.setStatus(
          this.boat.lateralSlip > spec.dockSpeed * 0.6
            ? 'In the berth — kill the sideways drift'
            : 'In the berth — shed speed',
        );
      } else if (headingError > HEADING_TOLERANCE) {
        this.hud.setStatus('Line up parallel to the dock');
      } else {
        this.beginMooring();
      }
    } else if (this.hazardCallout) {
      this.hud.setStatus(this.hazardCallout);
    } else {
      // The compass already names the objective; this line is for callouts only.
      this.hud.setStatus('');
    }

    this.hud.update(this.boat.speed, spec.dockSpeed, this.damage, this.elapsed, boosting);
    this.audio.setEngine(
      Math.abs(throttle),
      Math.min(1, Math.abs(this.boat.speed) / spec.maxSpeed),
    );
    if (boosting && !this.wasBoosting) this.audio.play('boost');
    this.wasBoosting = boosting;
    this.updateCompass();
    this.updateChaseCamera(delta);

    if (this.damage >= 100) {
      this.state = 'failed';
      this.audio.play('fail');
      this.hud.showFailed('The hull gave out.');
    }
  }

  /**
   * One step of the world: thrust, then everything solid, then the gates.
   * The render loop and the fixed-timestep test hook both go through here so
   * stepped simulation and real play stay identical.
   */
  private simulateStep(delta: number, throttle: number, rudder: number, boost: boolean): void {
    this.boat.updatePhysics(delta, throttle, rudder, boost);
    this.resolveCollisions();
    this.resolveHazardCollisions(delta);

    const gateResult = this.course.update(this.boat.group.position.x, this.boat.group.position.z);
    if (gateResult) {
      this.hud.setGates(this.course.cleared, this.course.total, this.course.penaltySeconds);
      this.hud.flashGate(gateResult.cleared);
      this.audio.play(gateResult.cleared ? 'gate-clear' : 'gate-miss');
      this.saveCheckpoint(gateResult.gate);
    }
  }

  private beginMooring(): void {
    this.state = 'mooring';
    this.mooringTime = 0;
    this.mooringPose = this.harbor.mooringPose(this.boat.spec);
    const berth = this.harbor.berth;
    if (berth.allowReverseHeading) {
      // Alongside: settle to whichever way along the quay the bow is nearer.
      const current = this.normalizeAngle(this.boat.heading);
      const flipped = this.normalizeAngle(berth.targetHeading + Math.PI);
      this.mooringPose.heading =
        Math.abs(this.angleDelta(current, berth.targetHeading)) <
        Math.abs(this.angleDelta(current, flipped))
          ? berth.targetHeading
          : flipped;
    } else {
      this.mooringPose.heading = berth.targetHeading;
    }
    // Carry the real course into the settle, drift included.
    this.mooringVelocity.set(this.boat.velocity.x, 0, this.boat.velocity.y);
    this.mooringHeadingVel = 0;
    this.hud.setStatus('Mooring…');
  }

  /**
   * The floaty docking settle: an underdamped spring eases the hull into its
   * rest pose (slight overshoot, then settle) while buoyancy bob gradually
   * relaxes and ripple rings spread from the hull. No hard snap.
   */
  private updateMooring(delta: number, waveTime: number): void {
    this.mooringTime += delta;
    const t = this.mooringTime;
    const pos = this.boat.group.position;

    const stiffness = 3.4;
    const dampen = 2.6;
    this.mooringVelocity.x += (this.mooringPose.x - pos.x) * stiffness * delta;
    this.mooringVelocity.z += (this.mooringPose.z - pos.z) * stiffness * delta;
    this.mooringVelocity.multiplyScalar(Math.exp(-dampen * delta));
    pos.x += this.mooringVelocity.x * delta;
    pos.z += this.mooringVelocity.z * delta;

    const headingError = this.angleDelta(this.boat.heading, this.mooringPose.heading);
    this.mooringHeadingVel += -headingError * stiffness * delta;
    this.mooringHeadingVel *= Math.exp(-dampen * delta);
    this.boat.heading += this.mooringHeadingVel * delta;

    this.boat.setVelocity(this.mooringVelocity.x, this.mooringVelocity.z);
    const settle = THREE.MathUtils.lerp(1, 0.55, Math.min(1, t / MOORING_DURATION));
    this.boat.updateBuoyancy(delta, waveTime, this.water, settle);

    this.rippleTimer -= delta;
    if (this.rippleTimer <= 0) {
      this.spawnSplash(pos.x, pos.z, this.boat.spec.beam * 1.4);
      this.rippleTimer = 0.55;
    }

    this.hud.update(this.boat.speed, this.boat.spec.dockSpeed, this.damage, this.elapsed);
    this.updateCompass();
    this.updateChaseCamera(delta);

    if (t >= MOORING_DURATION) {
      this.state = 'docked';
      const stars = this.computeStars();
      this.fleetComplete = this.levelIndex === this.order.length - 1;
      this.hud.setStatus('Moored');
      this.audio.play('moored');
      this.hud.showDocked(this.boat.spec.name, stars, this.fleetComplete);
      this.onLevelDocked?.(this.levelIndex, stars, this.boat.spec.id);
    }
  }

  /**
   * Par scales with the longer course, and every gate you barged past is worth
   * a chunk of time against it — so a sloppy line costs stars even if the
   * docking itself was clean.
   */
  private computeStars(): number {
    // Par is derived from the course, not a per-hull constant: every boat now
    // has the same legs, so time is a function of distance plus the docking.
    const par = this.course.length / (this.boat.spec.maxSpeed * 0.5) + 25;
    const effectiveTime = this.elapsed + this.course.penaltySeconds;
    const cleanRun = this.course.missedCount === 0;
    if (this.damage < 15 && effectiveTime <= par && cleanRun) return 3;
    if (this.damage < 45 && effectiveTime <= par * 1.4) return 2;
    return 1;
  }

  private resolveCollisions(): void {
    const spec = this.boat.spec;
    const pos = this.boat.group.position;
    const corners = this.boat.hullCorners(this.hullCorners);

    // Dock face: gentle fender contact is fine, real speed costs hull.
    let deepest = 0;
    for (const corner of corners) {
      const penetration = this.harbor.dockFaceZ - corner.z;
      if (penetration > deepest) deepest = penetration;
    }
    if (deepest > 0) {
      pos.z += deepest + 0.05;
      // Closing speed across the dock face is what hurts, not speed along it.
      const impact = this.impactDamage(Math.abs(this.boat.velocity.y), 40);
      if (impact > 0) this.applyDamage(impact);
      this.boat.bounceOffDock(0.25);
    }

    // Buoys: test in the boat's local frame against the hull box.
    const sin = Math.sin(this.boat.heading);
    const cos = Math.cos(this.boat.heading);
    for (const buoy of this.harbor.buoys) {
      const dx = buoy.x - pos.x;
      const dz = buoy.z - pos.z;
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      if (
        Math.abs(localX) < spec.beam / 2 + buoy.radius &&
        Math.abs(localZ) < spec.length / 2 + buoy.radius
      ) {
        this.applyDamage(6);
        const push = Math.hypot(dx, dz) || 1;
        pos.x -= (dx / push) * 0.6;
        pos.z -= (dz / push) * 0.6;
        this.boat.dampen(0.6);
        this.spawnSplash(buoy.x, buoy.z, buoy.radius * 3);
      }
    }

    this.resolvePierAndNeighborCollisions(corners);

    // Soft world bounds, sized to the course rather than the old short approach.
    pos.x = THREE.MathUtils.clamp(pos.x, -this.worldHalfWidth, this.worldHalfWidth);
    pos.z = Math.min(pos.z, this.course.startZ + this.boat.spec.length * 3);
  }

  /**
   * Finger piers and moored boats are solid. Each is an axis-aligned footprint;
   * a hull corner inside one is pushed back out along the shallowest axis, and
   * only the speed *into* that face does damage — sliding along a fender is fine.
   */
  private resolvePierAndNeighborCollisions(corners: THREE.Vector3[]): void {
    const spec = this.boat.spec;
    const pos = this.boat.group.position;

    for (const obstacle of this.harbor.obstacles) {
      for (const corner of corners) {
        if (
          corner.x < obstacle.minX ||
          corner.x > obstacle.maxX ||
          corner.z < obstacle.minZ ||
          corner.z > obstacle.maxZ
        ) {
          continue;
        }

        const outLeft = corner.x - obstacle.minX;
        const outRight = obstacle.maxX - corner.x;
        const outNear = corner.z - obstacle.minZ;
        const outFar = obstacle.maxZ - corner.z;
        const escape = Math.min(outLeft, outRight, outNear, outFar);

        let nx = 0;
        let nz = 0;
        if (escape === outLeft) nx = -1;
        else if (escape === outRight) nx = 1;
        else if (escape === outNear) nz = -1;
        else nz = 1;

        const closing = -(this.boat.velocity.x * nx + this.boat.velocity.y * nz);
        pos.x += nx * (escape + 0.05);
        pos.z += nz * (escape + 0.05);
        const impact = this.impactDamage(closing, 35);
        if (impact > 0) {
          this.applyDamage(impact);
          this.spawnSplash(corner.x, corner.z, spec.beam * 0.9);
        }
        this.boat.reflect(nx, nz, 0.2);
        break;
      }
    }
  }

  /**
   * Round hazards — wildlife, shallows, debris, traffic — tested against the
   * hull's oriented box. Damage lands once on entry so resting against a whale
   * does not drain the hull, while drag applies the whole time you're in it.
   */
  private resolveHazardCollisions(delta: number): void {
    const spec = this.boat.spec;
    const pos = this.boat.group.position;
    const sin = Math.sin(this.boat.heading);
    const cos = Math.cos(this.boat.heading);
    this.hazardCallout = null;

    const test = (hazard: CircleHazard) => {
      const dx = hazard.x - pos.x;
      const dz = hazard.z - pos.z;
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      const overlapX = spec.beam / 2 + hazard.radius - Math.abs(localX);
      const overlapZ = spec.length / 2 + hazard.radius - Math.abs(localZ);

      if (overlapX <= 0 || overlapZ <= 0) {
        hazard.touching = false;
        return;
      }

      if (!hazard.touching) {
        hazard.touching = true;
        if (hazard.damage > 0) {
          this.applyDamage(hazard.damage);
          this.spawnSplash(hazard.x, hazard.z, hazard.radius * 1.4);
        }
      }
      this.hazardCallout =
        hazard.kind === 'sandbar' ? 'Aground in the shallows' : `Hit: ${hazard.label}`;

      if (hazard.drag > 0) this.boat.dampen(Math.exp(-hazard.drag * delta));

      if (hazard.solid) {
        // Push out along whichever axis is the shallower overlap.
        const alongX = overlapX < overlapZ;
        const sign = alongX ? -Math.sign(localX || 1) : -Math.sign(localZ || 1);
        const escape = (alongX ? overlapX : overlapZ) + 0.05;
        const nx = alongX ? sign * cos : sign * sin;
        const nz = alongX ? -sign * sin : sign * cos;
        pos.x += nx * escape;
        pos.z += nz * escape;
        this.boat.reflect(nx, nz, 0.25);
      }
    };

    for (const hazard of this.wildlife.hazards) test(hazard);
    for (const hazard of this.seaHazards.hazards) test(hazard);
  }

  /** Record a resume point just short of the gate that was decided. */
  private saveCheckpoint(gate: { x: number; z: number }): void {
    this.checkpoint = {
      x: gate.x,
      z: gate.z + this.boat.spec.length * 1.2,
      heading: Math.PI,
      elapsed: this.elapsed,
      damage: this.damage,
      progress: this.course.snapshotProgress(),
    };
  }

  /** Resume from the last gate reached, or restart the run if there isn't one. */
  private retry(): void {
    const checkpoint = this.checkpoint;
    if (!checkpoint) {
      this.startLevel(this.levelIndex);
      return;
    }
    this.boat.group.position.set(checkpoint.x, 0, checkpoint.z);
    this.boat.heading = checkpoint.heading;
    this.boat.stop();
    this.controls.set(0, 0);
    this.resetWake();
    this.elapsed = checkpoint.elapsed;
    this.damage = checkpoint.damage;
    this.course.restoreProgress(checkpoint.progress);
    this.state = 'playing';
    this.hud.setVisible(true);
    this.hud.hideBanner();
    this.hud.setGates(this.course.cleared, this.course.total, this.course.penaltySeconds);
    this.hud.setStatus('Resumed at the last gate');
    this.snapCamera();
  }

  /**
   * Impact damage as a share of how much of your top speed you carried in.
   * Absolute thresholds stopped working once every hull ran at 30 m/s — any
   * contact at all saturated the cap and two taps ended a run.
   */
  private impactDamage(closingSpeed: number, maxDamage: number): number {
    const spec = this.boat.spec;
    const over = closingSpeed - spec.dockSpeed;
    if (over <= 0) return 0;
    const severity = THREE.MathUtils.clamp(over / (spec.maxSpeed * 0.55), 0, 1);
    return maxDamage * severity;
  }

  private applyDamage(amount: number): void {
    this.damage = Math.min(100, this.damage + amount);
    this.hud.flashDamage();
    // Louder for a heavier blow, so a scrape and a ram sound different.
    this.audio.play('impact', THREE.MathUtils.clamp(amount / 25, 0.35, 1.2));
  }

  /** How far off the berth's required heading the bow is. */
  private headingErrorToDock(): number {
    const berth = this.harbor.berth;
    const current = this.normalizeAngle(this.boat.heading);
    const primary = Math.abs(this.angleDelta(current, berth.targetHeading));
    if (!berth.allowReverseHeading) return primary;
    // Alongside berths take the hull either way round.
    return Math.min(primary, Math.abs(this.angleDelta(current, berth.targetHeading + Math.PI)));
  }

  /** Clear the trail and bind it to whichever hull is now in the water. */
  private resetWake(): void {
    this.wake.configure(this.boat.spec.beam);
    this.wake.reset();
    this.splashes.reset();
    this.applyFoamCeiling();
  }

  /**
   * Cap every foam layer just under the dock deck. Wake crests and impact
   * splashes both stand proud of the water, and over the planking that reads as
   * a flooded pier — so the dock's own height, measured from the geometry
   * rather than assumed, is the ceiling.
   */
  private applyFoamCeiling(): void {
    // The deck itself, not the dock's bounding box — that reaches the tops of
    // the bollards standing on the planking, well above the surface foam has
    // to stay under.
    const ceiling = this.harbor.deckHeight - 0.15;
    this.wake.setCeiling(ceiling);
    this.splashes.setCeiling(ceiling);
    this.seaHazards.setFoamCeiling(ceiling);
  }

  private spawnSplash(x: number, z: number, radius: number): void {
    if (this.reducedMotion) return;
    this.splashes.spawn(x, z, radius, this.waveTime);
  }

  /**
   * Lay wake from the transom. The whole trail is one mesh that ages itself, so
   * this only has to say where the stern is and how much way the hull has on.
   */
  private updateWake(delta: number, waveTime: number): void {
    this.splashes.update(waveTime);
    if (this.reducedMotion) {
      // The wave clock is frozen, so ages would be meaningless. Clear the trail
      // rather than leave a stale one painted on the water.
      if (this.wake.mesh.visible) this.resetWake();
      return;
    }
    const spec = this.boat.spec;
    const stern = spec.length * 0.38;
    this.wake.update(
      delta,
      waveTime,
      this.boat.group.position.x - Math.sin(this.boat.heading) * stern,
      this.boat.group.position.z - Math.cos(this.boat.heading) * stern,
      this.boat.heading,
      this.boat.speed,
    );
  }

  private updateChaseCamera(delta: number): void {
    const spec = this.boat.spec;
    const high = this.settings.cameraMode === 'high';
    const distance = high ? spec.camDistance * 0.5 : spec.camDistance;
    const height = high ? spec.camHeight * 1.9 : spec.camHeight;
    this.cameraTarget.set(
      this.boat.group.position.x,
      height,
      this.boat.group.position.z + distance,
    );
    const factor = 1 - Math.exp(-delta / 0.35);
    this.camera.position.lerp(this.cameraTarget, factor);
    this.camera.lookAt(
      this.boat.group.position.x,
      2,
      this.boat.group.position.z - spec.length * 0.2,
    );
  }

  private snapCamera(): void {
    const spec = this.boat.spec;
    this.camera.position.set(
      this.boat.group.position.x,
      spec.camHeight,
      this.boat.group.position.z + spec.camDistance,
    );
    this.camera.lookAt(this.boat.group.position);
  }

  private updateSun(): void {
    // Keep the shadow frustum tight around the boat so shadows stay crisp on a
    // 2.6 km ocean.
    const pos = this.boat.group.position;
    this.sun.position.set(pos.x - 120, 180, pos.z + 90);
    this.sun.target.position.copy(pos);
    this.sun.target.updateMatrixWorld();
  }

  private createScene(): void {
    this.scene.background = new THREE.Color('#b8d3de');
    this.scene.fog = new THREE.Fog('#b8d3de', 600, 3200);

    const hemisphere = new THREE.HemisphereLight('#dfeef5', '#27506b', 0.9);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight('#fff3dd', 2.4);
    sun.name = 'sun';
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 700;
    const shadowSpan = 260;
    sun.shadow.camera.left = -shadowSpan;
    sun.shadow.camera.right = shadowSpan;
    sun.shadow.camera.top = shadowSpan;
    sun.shadow.camera.bottom = -shadowSpan;
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.scene.add(this.water.mesh);
    this.scene.add(this.wake.mesh);
    this.scene.add(this.splashes.mesh);
    this.scene.add(this.harbor.group);
    this.scene.add(this.course.group);
    this.scene.add(this.wildlife.group);
    this.scene.add(this.seaHazards.group);
    this.scene.add(this.boat.group);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.layoutSeed = value;
      },
      setState: (name: string) => {
        const hideMenu = () => {
          const menu = document.querySelector<HTMLElement>('#menu');
          if (menu) menu.hidden = true;
          document.body.classList.remove('menu-open');
        };
        if (name === 'active-play') {
          hideMenu();
          this.startLevel(this.levelIndex);
        } else if (name.startsWith('boat:')) {
          // Order is shuffled per run, so QA addresses a vessel by id.
          hideMenu();
          const id = name.slice(5);
          const position = this.order.findIndex((spec) => spec.id === id);
          if (position < 0) console.warn(`Unknown boat id: ${id}`);
          else this.startLevel(position);
        } else if (name.startsWith('level:')) {
          hideMenu();
          this.startLevel(Number.parseInt(name.slice(6), 10) || 0);
        } else if (name === 'complete') {
          hideMenu();
          this.startLevel(this.levelIndex);
          // Put the hull in its berth first, or the mooring spring fires across
          // the whole approach and reports a nonsense arrival speed.
          const pose = this.harbor.mooringPose(this.boat.spec);
          this.boat.group.position.set(pose.x, 0, pose.z);
          this.boat.heading = pose.heading;
          this.boat.stop();
          this.beginMooring();
          this.mooringTime = MOORING_DURATION;
        } else console.warn(`Unknown test state: ${name}`);
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => {
        // No debug UI in this build.
      },
      measureBoat: () => {
        const bounds = new THREE.Box3().setFromObject(this.boat.group);
        const size = bounds.getSize(new THREE.Vector3());
        return { x: size.x, y: size.y, z: size.z, heading: this.boat.heading };
      },
      stepPhysics: (options) => {
        // Advance the hull at a fixed timestep so handling can be measured
        // without the render loop's frame rate skewing the result.
        const dt = options?.dt ?? 1 / 60;
        const steps = Math.max(1, Math.round((options?.seconds ?? 1) / dt));
        for (let i = 0; i < steps; i += 1) {
          if (options?.collide === false) {
            this.boat.updatePhysics(dt, options?.throttle ?? 0, options?.rudder ?? 0, options?.boost ?? false);
          } else {
            this.simulateStep(dt, options?.throttle ?? 0, options?.rudder ?? 0, options?.boost ?? false);
          }
        }
        // Diagnostics normally refresh on animation frames; republish so a
        // caller stepping the sim in a tight loop reads current state.
        this.publishDiagnostics();
        return {
          speed: this.boat.speed,
          courseSpeed: this.boat.velocityMagnitude,
          slipAngleDeg: this.slipAngleDeg(),
          heading: this.boat.heading,
          x: this.boat.group.position.x,
          z: this.boat.group.position.z,
          damage: this.damage,
        };
      },
      placeBoat: (pose) => {
        this.boat.group.position.set(pose.x, 0, pose.z);
        if (typeof pose.heading === 'number') this.boat.heading = pose.heading;
        this.boat.stop();
        this.publishDiagnostics();
      },
      wildlife: () => this.wildlife.snapshot(),
      audioState: () => this.audio.debugState(),
      measureWaterline: () => {
        const boat = new THREE.Box3().setFromObject(this.boat.group);
        const dock = this.harbor.dockBounds();
        return {
          boatKeel: boat.min.y,
          boatTop: boat.max.y,
          // The hull's own waterline, so wave bob cancels out of draft.
          boatY: this.boat.group.position.y,
          usingModel: this.boat.hasGeneratedModel,
          dockBottom: dock.min.y,
          // The walking surface, not the bounding box — that reaches the tops
          // of the bollards, and `deckClearsCrest` is a claim about the deck.
          dockTop: this.harbor.deckHeight,
          maxWave: this.water.maxAmplitude(),
        };
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      damage: this.damage,
      obstacleCount: this.harbor.obstacles.length,
      hazards: [...this.wildlife.hazards, ...this.seaHazards.hazards].map((h) => ({
        kind: h.kind,
        x: h.x,
        z: h.z,
        radius: h.radius,
        damage: h.damage,
      })),
      course: {
        cleared: this.course.cleared,
        missed: this.course.missedCount,
        total: this.course.total,
        penaltySeconds: this.course.penaltySeconds,
        startZ: this.course.startZ,
        gates: this.course.gates.map((gate) => ({
          x: gate.x,
          z: gate.z,
          halfWidth: gate.halfWidth,
          cleared: gate.cleared,
        })),
      },
      berth: {
        centerX: this.harbor.berth.centerX,
        centerZ: this.harbor.berth.centerZ,
        halfWidth: this.harbor.berth.halfWidth,
        halfDepth: this.harbor.berth.halfDepth,
        mode: this.harbor.berth.mode,
        targetHeading: this.harbor.berth.targetHeading,
        entranceZ: this.harbor.berth.entranceZ,
      },
      score: this.levelIndex,
      targetScore: this.order.length,
      complete: this.fleetComplete,
      player: {
        position: {
          x: this.boat.group.position.x,
          y: this.boat.group.position.y,
          z: this.boat.group.position.z,
        },
        speed: Math.abs(this.boat.speed),
        slipAngleDeg: this.slipAngleDeg(),
        headingDeg: THREE.MathUtils.radToDeg(this.normalizeAngle(this.boat.heading)),
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
        dpr: Math.min(window.devicePixelRatio || 1, qualityMaxDpr(this.settings.quality)),
      },
    };
  }

  /**
   * Aim the top-of-screen compass at whatever the player owes next: the gate
   * they are running to, and once the gates are behind them, the berth.
   *
   * The arrow is drawn relative to the bow, so straight up means dead ahead.
   */
  private updateCompass(): void {
    const gate = this.course.pendingGate;
    const berth = this.harbor.berth;
    const target = gate
      ? { x: gate.x, z: gate.z }
      : { x: berth.centerX, z: berth.centerZ };
    const label = gate
      ? `Gate ${gate.index + 1} of ${this.course.total}`
      : 'Berth';

    const pos = this.boat.group.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;

    // forward = (sin h, cos h), so the world bearing to a point is atan2(dx, dz).
    const bearing = Math.atan2(dx, dz);
    const relative = this.angleDelta(bearing, this.boat.heading);
    // Screen rotation is clockwise; starboard is a decreasing heading.
    const rotation = -THREE.MathUtils.radToDeg(relative);

    this.hud.setDirection(rotation, label, Math.hypot(dx, dz), !gate);
  }

  /** Angle between where the bow points and where the hull is actually going. */
  private slipAngleDeg(): number {
    const velocity = this.boat.velocity;
    if (velocity.lengthSq() < 1e-4) return 0;
    const course = Math.atan2(velocity.x, velocity.y);
    return Math.abs(THREE.MathUtils.radToDeg(this.angleDelta(course, this.boat.heading)));
  }

  private normalizeAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  private angleDelta(from: number, to: number): number {
    return this.normalizeAngle(from - to);
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }

  getFleetSpec(index: number): BoatSpec {
    return this.order[THREE.MathUtils.clamp(index, 0, this.order.length - 1)];
  }
}
