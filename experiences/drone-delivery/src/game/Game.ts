import * as THREE from 'three';
import { loadDroneRig, type DroneRig } from '../assets/drone';
import { PropLibrary } from '../assets/props';
import { Sfx } from '../audio/sfx';
import { FlightInput } from '../core/FlightInput';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { DRONE_RADIUS, LIVERIES, PACKAGE_COLORS, packageColor } from '../sim/config';
import { FlightState, stepFlight, type FlightCommand, type FlightEnv } from '../sim/flight';
import { Wind } from '../sim/wind';
import { CameraRig } from '../systems/CameraRig';
import { Hud } from '../systems/Hud';
import { Screens } from '../ui/screens';
import { buildCity, type CityWorld, type PadInfo } from '../world/city';
import { buildHazards, type Hazards } from '../world/hazards';
import { ROUTES, type RouteDef } from '../world/routes';
import { createSky, FlightGuide } from '../world/sky';
import { loadProgress, saveStars } from './progress';
import { computeScore, type ScoreResult } from './scoring';

type Phase = 'menu' | 'flying' | 'results';
type MissionStep = 'pickup' | 'deliver' | 'complete';

const SIM_STEP = 1 / 120;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly hud = new Hud();
  private readonly screens: Screens;
  private readonly sfx = new Sfx();
  private readonly input: FlightInput;
  private readonly flight = new FlightState();
  private readonly wind = new Wind();
  private readonly guide: FlightGuide;
  private readonly sky: { dispose(): void };
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private drone: DroneRig | null = null;
  private props: PropLibrary | null = null;
  private city: CityWorld | null = null;
  private hazards: Hazards | null = null;
  private packageMesh: THREE.Object3D | null = null;
  private packagePivot = new THREE.Group();
  /** The next parcel, sitting on the dispatch deck while a pickup is pending. */
  private waitingPackage: THREE.Object3D | null = null;
  private waitingBadge: THREE.MeshStandardMaterial | null = null;

  private phase: Phase = 'menu';
  private route: RouteDef | null = null;
  private step: MissionStep = 'pickup';
  private deliveryIndex = 0;
  private delivered = 0;
  private batteryPct = 100;
  private hullPct = 100;
  private packageCondition = 100;
  private accuracies: number[] = [];
  private wrongDeliveries = 0;
  private elapsed = 0;
  private worldTime = 0;
  private simAccumulator = 0;
  /** Seconds spent parked on the dispatch pad while a pickup is pending. */
  private padDwell = 0;
  private failTimer = -1;
  private failReason = '';
  private paused = false;
  private lastResult: ScoreResult | null = null;
  private liveryIndex = 0;

  private readonly cmd: FlightCommand = { throttle: 0, pitch: 0, roll: 0, yaw: 0 };
  private readonly env: FlightEnv = {
    wind: new THREE.Vector3(),
    carrying: false,
    batteryEmpty: false,
    supportHeight: 0,
    groundClearance: 0.1,
  };

  private frame = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  /** Test-only: multiplies game time so slow headless runs finish routes. */
  private timeScale = 1;
  private readonly prefersReducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.sky = createSky(this.scene);
    this.guide = new FlightGuide(this.scene);
    this.guide.update(new THREE.Vector3(), null);

    this.screens = new Screens({
      onSelectRoute: (id) => this.startRoute(id),
      onRetry: () => this.route && this.startRoute(this.route.id),
      onNext: () => {
        const nextId = (this.route?.id ?? 0) + 1;
        if (ROUTES.some((r) => r.id === nextId)) this.startRoute(nextId);
        else this.showMenu();
      },
      onMenu: () => this.showMenu(),
      onResume: () => this.setPaused(false),
    });

    this.input = new FlightInput(
      {
        onArmToggle: () => this.toggleArm(),
        onCameraCycle: () => {
          if (this.phase !== 'flying') return;
          const mode = this.cameraRig.cycle();
          this.hud.showMessage(`Camera: ${mode.toUpperCase()}`, 1.2);
        },
        onReset: () => {
          if (this.phase === 'flying' && this.route) this.startRoute(this.route.id);
        },
        onHelpToggle: () => this.screens.toggleHelp(),
        onPause: () => {
          if (this.phase === 'flying') this.setPaused(!this.paused);
        },
      },
      this.element('#left-stick'),
      this.element('#left-knob'),
      this.element('#right-stick'),
      this.element('#right-knob'),
    );
    this.element('#touch-arm').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.toggleArm();
    });
    this.element('#settings-button').addEventListener('click', () => {
      if (this.phase === 'flying') this.setPaused(true);
    });

    resizeRenderer(this.renderer, this.camera, 2);
    this.installTestHooks();
    void this.init();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.sfx.dispose();
    this.guide.dispose();
    this.sky.dispose();
    this.teardownRoute();
    this.drone?.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private async init(): Promise<void> {
    this.screens.setLoading('Assembling the delivery drone…');
    try {
      const [drone, props] = await Promise.all([loadDroneRig(), PropLibrary.load()]);
      this.drone = drone;
      this.props = props;
      drone.root.add(this.packagePivot);
      this.packagePivot.position.set(0, -drone.groundClearance - 0.05, 0);
      this.env.groundClearance = drone.groundClearance + 0.02;
      this.screens.setLoading(null);
      this.showMenu();
    } catch (error) {
      console.error(error);
      this.screens.setLoading(
        `Failed to load assets: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---------- Phase transitions ----------

  private showMenu(): void {
    this.phase = 'menu';
    this.setPaused(false);
    this.teardownRoute();
    this.buildAttractScene();
    this.hud.setVisible(false);
    this.hud.clearMessage();
    this.screens.hideResults();
    this.screens.showMenu(ROUTES, loadProgress());
    this.sfx.setRotor(false, 0);
  }

  /**
   * Live-scene hero backdrop for the landing page: route 1's city with the
   * drone parked on the dispatch pad, under a slow orbiting camera.
   */
  private buildAttractScene(): void {
    if (!this.drone || !this.props) return;
    const route = ROUTES[0];
    this.route = null;
    this.city = buildCity(route, this.props);
    this.hazards = buildHazards(route.hazards, this.props, this.city.collision);
    this.city.group.add(this.hazards.group);
    this.scene.add(this.city.group);
    this.scene.add(this.drone.root);
    this.drone.setLivery(LIVERIES[0].accent);
    this.wind.configure(new THREE.Vector3(), 0, 0);
    this.worldTime = 0;
    const spawn = this.city.dispatch.center.clone();
    this.flight.reset(spawn.add(new THREE.Vector3(0, this.env.groundClearance, 0)), Math.PI);
    this.syncDroneVisual(0);
  }

  private startRoute(routeId: number): void {
    const route = ROUTES.find((r) => r.id === routeId);
    if (!route || !this.drone || !this.props) return;

    this.teardownRoute();
    this.screens.hideMenu();
    this.screens.hideResults();
    this.setPaused(false);

    this.route = route;
    this.city = buildCity(route, this.props);
    this.hazards = buildHazards(route.hazards, this.props, this.city.collision);
    this.city.group.add(this.hazards.group);
    this.scene.add(this.city.group);
    this.scene.add(this.drone.root);

    this.liveryIndex = (route.id - 1) % LIVERIES.length;
    this.drone.setLivery(LIVERIES[this.liveryIndex].accent);

    this.wind.configure(
      new THREE.Vector3(route.wind.base[0], 0, route.wind.base[1]),
      route.wind.variability,
      route.wind.gust,
    );

    this.step = 'pickup';
    this.deliveryIndex = 0;
    this.delivered = 0;
    this.batteryPct = 100;
    this.hullPct = 100;
    this.packageCondition = 100;
    this.accuracies = [];
    this.wrongDeliveries = 0;
    this.elapsed = 0;
    this.worldTime = 0;
    this.simAccumulator = 0;
    this.padDwell = 0;
    this.failTimer = -1;
    this.lastResult = null;
    this.detachPackage();

    // The next parcel waits on the deck beside the kiosk so the dispatch pad
    // reads as the place packages come from.
    this.waitingPackage = this.props.spawn('package', 0.9);
    this.waitingPackage.position.copy(this.city.dispatch.center).add(new THREE.Vector3(1.7, 0, -1.2));
    const parcelBounds = new THREE.Box3().setFromObject(this.waitingPackage);
    this.waitingBadge = new THREE.MeshStandardMaterial({
      color: packageColor(route.deliveries[0].color),
      roughness: 0.6,
    });
    const waitingBadgeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.62), this.waitingBadge);
    waitingBadgeMesh.position.y = parcelBounds.max.y - parcelBounds.min.y + 0.05;
    this.waitingPackage.add(waitingBadgeMesh);
    this.city.group.add(this.waitingPackage);

    const spawn = this.city.dispatch.center.clone();
    this.flight.reset(spawn.add(new THREE.Vector3(0, this.env.groundClearance, 0)), Math.PI);
    this.syncDroneVisual(0);
    this.cameraRig.mode = 'chase';
    this.cameraRig.snapTo(this.flight.position, this.flight.yaw);

    this.phase = 'flying';
    this.hud.setVisible(true);
    this.hud.showMessage(`${route.name}\nPress Enter to arm`, 3.2);
  }

  private teardownRoute(): void {
    if (this.city) {
      this.scene.remove(this.city.group);
      this.city.dispose();
      this.city = null;
    }
    this.hazards = null;
    this.waitingPackage = null;
    this.waitingBadge = null;
    if (this.drone) this.scene.remove(this.drone.root);
    this.guide.update(new THREE.Vector3(), null);
  }

  private finishRoute(): void {
    if (!this.route) return;
    this.step = 'complete';
    const accuracy =
      this.accuracies.length > 0
        ? this.accuracies.reduce((a, b) => a + b, 0) / this.accuracies.length
        : 0;
    this.lastResult = computeScore({
      elapsed: this.elapsed,
      parTime: this.route.parTime,
      packageCondition: this.packageCondition,
      batteryPct: this.batteryPct,
      landingAccuracy: accuracy,
      wrongDeliveries: this.wrongDeliveries,
    });
    saveStars(this.route.id, this.lastResult.stars);
    this.sfx.play('score');
    this.sfx.setRotor(false, 0);
    this.setPaused(false);
    this.phase = 'results';
    this.hud.setVisible(false);
    const hasNext = ROUTES.some((r) => r.id === (this.route?.id ?? 0) + 1);
    this.screens.showResults(this.route.name, this.lastResult, hasNext);
  }

  private failRoute(reason: string): void {
    if (this.phase !== 'flying' || this.failTimer >= 0) return;
    this.failReason = reason;
    this.failTimer = 1.6;
    this.flight.armed = false;
    this.hud.showMessage(reason, 1.6);
  }

  private setPaused(paused: boolean): void {
    if (this.phase !== 'flying' && paused) return;
    this.paused = paused;
    this.screens.setPaused(paused);
    if (paused) this.sfx.setRotor(false, 0);
  }

  private toggleArm(): void {
    if (this.phase === 'menu') {
      // The landing page's affordance row invites pressing Enter.
      this.screens.clickStart();
      return;
    }
    if (this.phase !== 'flying' || this.failTimer >= 0) return;
    void this.sfx.unlock();
    this.flight.armed = !this.flight.armed;
    if (this.flight.armed) {
      if (this.batteryPct <= 0) {
        this.flight.armed = false;
        this.hud.showMessage('Battery empty!', 1.6);
        return;
      }
      this.hud.showMessage('Armed — throttle up with W', 1.6);
    } else {
      this.hud.showMessage('Disarmed', 1.2);
    }
  }

  // ---------- Main update ----------

  private update(rawDelta: number, _elapsed: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, 2);
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }
    const delta = rawDelta * this.timeScale;

    if (this.phase === 'menu' && this.city) {
      // Attract mode behind the landing page: drift the camera, keep the
      // hazards and clouds alive so the scene reads as the real game.
      const animDelta = this.reducedMotion ? 0 : delta;
      this.worldTime += animDelta;
      this.hazards?.update(this.worldTime);
      this.updateClouds(animDelta);
      this.updatePads(animDelta);
      const angle = this.prefersReducedMotion ? 0.85 : 0.85 + this.worldTime * 0.045;
      this.camera.position.set(Math.cos(angle) * 46, 25, Math.sin(angle) * 46 + 2);
      this.camera.lookAt(0, 5, -4);
    }

    if (this.phase === 'flying' && this.route && this.city && !this.paused) {
      const animDelta = this.reducedMotion ? 0 : delta;
      this.worldTime += animDelta;
      if (this.failTimer < 0) this.elapsed += delta;

      this.input.read(this.cmd);
      if (this.failTimer >= 0) {
        this.cmd.throttle = -0.4;
        this.cmd.pitch = 0;
        this.cmd.roll = 0;
        this.cmd.yaw = 0;
      }

      const gust = this.wind.update(this.worldTime);
      if (gust && this.flight.armed) this.sfx.play('wind', 0.5);
      this.env.wind.copy(this.wind.current);
      this.env.carrying = this.packageMesh !== null;
      this.env.batteryEmpty = this.batteryPct <= 0;
      this.env.supportHeight = this.city.collision.supportHeight(this.flight.position);

      // Fixed-step flight sim with the render loop's variable delta.
      this.simAccumulator = Math.min(this.simAccumulator + delta, 0.25);
      while (this.simAccumulator >= SIM_STEP) {
        this.simAccumulator -= SIM_STEP;
        const events = stepFlight(this.flight, this.cmd, this.env, SIM_STEP);
        if (events.touchdown) this.handleTouchdown(events.touchdown.kind);
      }

      if (!this.flight.landed) this.handleCollisions(delta);

      // Pickup by dwell: parked on the dispatch pad (including right at route
      // start), the parcel clips on after a short beat — no need to take off
      // and land again first.
      if (this.step === 'pickup' && this.flight.landed && this.isOnPad(this.city.dispatch)) {
        this.padDwell += delta;
        if (this.padDwell > 0.6) this.attachPackage();
      } else {
        this.padDwell = 0;
      }

      this.updateBattery(delta);
      this.hazards?.update(this.worldTime);
      this.updatePads(animDelta);
      this.updateClouds(animDelta);
      this.syncDroneVisual(animDelta);

      const rotorIntensity = this.flight.armed
        ? 0.4 + Math.abs(this.cmd.throttle) * 0.6
        : 0;
      this.sfx.setRotor(this.flight.armed, rotorIntensity);

      if (this.waitingPackage) this.waitingPackage.visible = this.step === 'pickup';
      const target = this.currentTarget();
      this.guide.update(this.flight.position, target ? target.center : null);
      this.updateTargetIndicator(target);
      this.cameraRig.update(delta, this.flight.position, this.flight.yaw, this.flight.velocity);
      this.updateHud();

      if (this.failTimer >= 0) {
        this.failTimer -= delta;
        if (this.failTimer < 0) {
          this.sfx.setRotor(false, 0);
          this.phase = 'results';
          this.hud.setVisible(false);
          this.lastResult = null;
          this.screens.showResults(`${this.route.name} — ${this.failReason}`, null, false);
        }
      }
    }

    this.hud.tickMessage(delta);
    this.publishDiagnostics();
  }

  private handleTouchdown(kind: 'soft' | 'hard' | 'crash'): void {
    if (!this.city || !this.route) return;

    if (kind === 'crash') {
      this.hullPct -= 40;
      if (this.env.carrying) {
        this.packageCondition -= 55;
        this.hud.showMessage('Package slammed!', 1.8);
      }
      this.sfx.play('collision');
      if (this.hullPct <= 0) return this.failRoute('Drone down!');
      if (this.packageCondition <= 0 && this.env.carrying) return this.failRoute('Package destroyed!');
      return;
    }

    if (kind === 'hard') {
      this.hullPct -= 10;
      if (this.env.carrying) this.packageCondition -= 18;
      this.sfx.play('collision', 0.5);
      this.hud.showMessage('Hard landing!', 1.4);
      if (this.hullPct <= 0) return this.failRoute('Drone down!');
      if (this.packageCondition <= 0 && this.env.carrying) return this.failRoute('Package destroyed!');
    }

    // Pad logic on any survivable touchdown. (Pickups also load while parked
    // on the dispatch pad — see the dwell check in update().)
    const pos = this.flight.position;

    if (this.step === 'deliver' && this.env.carrying) {
      const want = this.route.deliveries[this.deliveryIndex];
      for (const pad of this.city.pads) {
        if (!this.isOnPad(pad)) continue;
        if (pad.color === want.color) {
          const distance = Math.hypot(pos.x - pad.center.x, pos.z - pad.center.z);
          const accuracy = 1 - Math.min(1, distance / pad.radius);
          this.accuracies.push(kind === 'hard' ? accuracy * 0.6 : accuracy);
          this.completeDelivery();
        } else {
          this.wrongDeliveries += 1;
          this.hud.showMessage('Wrong rooftop! Check the package color.', 1.8);
        }
        return;
      }
    }
  }

  private handleCollisions(_delta: number): void {
    if (!this.city) return;
    const hit = this.city.collision.test(this.flight.position, DRONE_RADIUS);
    if (!hit) return;
    // Mostly-upward normals are support contacts; touchdown handles those.
    if (hit.normal.y > 0.65) return;

    this.flight.position.addScaledVector(hit.normal, hit.depth + 0.01);
    const into = this.flight.velocity.dot(hit.normal);
    if (into < 0) {
      this.flight.velocity.addScaledVector(hit.normal, -into * 1.5);
      this.flight.velocity.multiplyScalar(0.72);
    }

    // Pads are landing zones — brushing their rim just bounces. Everything
    // else ends the run: bumping a building, wire, tree, or hazard is a crash.
    if (hit.label === 'landing pad' || hit.label === 'dispatch pad') return;
    if (this.failTimer >= 0) return;
    this.hullPct = 0;
    this.sfx.play('collision');
    this.failRoute(`Crashed into ${hit.label}!`);
  }

  private updateBattery(delta: number): void {
    if (!this.route || !this.flight.armed) return;
    const drainPerSecond =
      (100 / this.route.batterySeconds) * (0.7 + 0.55 * Math.abs(this.cmd.throttle));
    const before = this.batteryPct;
    this.batteryPct = Math.max(0, this.batteryPct - drainPerSecond * delta);
    if (this.batteryPct < 25 && this.batteryPct > 0) this.sfx.play('warning', 0.6);
    if (before > 0 && this.batteryPct <= 0) {
      this.hud.showMessage('Battery empty — going down!', 2);
      if (this.flight.landed && this.step !== 'complete') {
        this.failRoute('Battery dead!');
      }
    }
    // Landing with an empty battery away from mission completion is a fail.
    if (this.batteryPct <= 0 && this.flight.landed && this.step !== 'complete' && this.failTimer < 0) {
      this.failRoute('Battery dead!');
    }
  }

  // ---------- Mission ----------

  /** True when the drone is resting at pad height within the pad's radius. */
  private isOnPad(pad: PadInfo): boolean {
    const pos = this.flight.position;
    return (
      Math.hypot(pos.x - pad.center.x, pos.z - pad.center.z) <= pad.radius &&
      Math.abs(pos.y - this.env.groundClearance - pad.center.y) < 1.6
    );
  }

  private currentTarget(): PadInfo | null {
    if (!this.city || !this.route || this.step === 'complete') return null;
    if (this.step === 'pickup') return this.city.dispatch;
    const want = this.route.deliveries[this.deliveryIndex];
    return this.city.pads.find((p) => p.color === want.color) ?? null;
  }

  private attachPackage(): void {
    if (!this.props || !this.route) return;
    const want = this.route.deliveries[this.deliveryIndex];
    const box = this.props.spawn('package', 0.9);
    // Color badge so the target rooftop is readable at a glance.
    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.1, 0.62),
      new THREE.MeshStandardMaterial({ color: packageColor(want.color), roughness: 0.6 }),
    );
    const bounds = new THREE.Box3().setFromObject(box);
    badge.position.y = bounds.max.y + 0.05;
    box.add(badge);
    box.position.y = -(bounds.max.y - bounds.min.y) - 0.06;
    this.packagePivot.add(box);
    this.packageMesh = box;

    this.step = 'deliver';
    this.sfx.play('attach');
    const label = PACKAGE_COLORS.find((c) => c.id === want.color)?.label ?? want.color;
    this.hud.showMessage(`${label} package loaded!\nDeliver it to the ${label.toLowerCase()} rooftop pad.`, 2.6);
    const pad = this.currentTarget();
    if (pad?.color) this.guide.setTarget(packageColor(pad.color));
  }

  private detachPackage(): void {
    if (this.packageMesh) {
      this.packagePivot.remove(this.packageMesh);
      this.packageMesh = null;
    }
  }

  private completeDelivery(): void {
    if (!this.route) return;
    this.detachPackage();
    this.delivered += 1;
    this.sfx.play('delivery');

    if (this.delivered >= this.route.deliveries.length) {
      this.hud.showMessage('All packages delivered!', 2);
      this.finishRoute();
      return;
    }
    this.deliveryIndex += 1;
    this.step = 'pickup';
    this.hud.showMessage('Delivered! Return to dispatch for the next package.', 2.2);
    this.guide.setTarget(new THREE.Color('#39c6ce'));
    this.waitingBadge?.color.copy(packageColor(this.route.deliveries[this.deliveryIndex].color));
  }

  // ---------- Visual sync ----------

  private syncDroneVisual(delta: number): void {
    if (!this.drone) return;
    const root = this.drone.root;
    root.position.copy(this.flight.position);
    // Negative roll: +tiltRoll accelerates right (+X in the heading frame), so
    // the right side must dip — a positive Z euler would lift it instead.
    root.rotation.set(-this.flight.tiltPitch, this.flight.yaw, -this.flight.tiltRoll, 'YXZ');

    if (this.flight.armed && delta > 0) {
      const spin = (34 + Math.abs(this.cmd.throttle) * 30) * delta;
      this.drone.propellers.forEach((prop, i) => {
        prop.rotation.y += i % 2 === 0 ? spin : -spin;
      });
    }

    // Package pendulum: lag behind horizontal velocity for a bit of swing.
    if (this.packageMesh) {
      const targetX = THREE.MathUtils.clamp(this.flight.velocity.z * 0.03, -0.35, 0.35);
      const targetZ = THREE.MathUtils.clamp(-this.flight.velocity.x * 0.03, -0.35, 0.35);
      this.packagePivot.rotation.x += (targetX - this.packagePivot.rotation.x) * 0.08;
      this.packagePivot.rotation.z += (targetZ - this.packagePivot.rotation.z) * 0.08;
    }
  }

  private updatePads(delta: number): void {
    if (!this.city || delta === 0) return;
    const pulse = 0.85 + Math.sin(this.worldTime * 3.2) * 0.15;
    const target = this.currentTarget();
    for (const pad of [this.city.dispatch, ...this.city.pads]) {
      const material = pad.ring.material as THREE.MeshBasicMaterial;
      const active = pad === target;
      material.opacity = active ? pulse : 0.5;
      pad.ring.scale.setScalar(active ? pulse * 0.15 + 0.95 : 1);
    }
  }

  private updateClouds(delta: number): void {
    if (!this.city || delta === 0) return;
    for (let i = 0; i < this.city.clouds.length; i += 1) {
      const cloud = this.city.clouds[i];
      cloud.position.x += (0.4 + (i % 3) * 0.2) * delta;
      if (cloud.position.x > 120) cloud.position.x = -120;
    }
  }

  /**
   * Screen-space waypoint: a marker pinned over the objective when it is in
   * view, otherwise a red arrow clamped to the screen edge pointing at it.
   */
  private updateTargetIndicator(target: PadInfo | null): void {
    if (!target) {
      this.hud.updateTargetIndicator(null);
      return;
    }
    const world = target.center.clone().add(new THREE.Vector3(0, 1, 0));
    const camSpace = world.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const behind = camSpace.z > 0;
    const ndc = world.project(this.camera);
    let nx = ndc.x;
    let ny = ndc.y;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const distance = Math.hypot(
      target.center.x - this.flight.position.x,
      target.center.z - this.flight.position.z,
    );

    if (!behind && Math.abs(nx) < 0.9 && Math.abs(ny) < 0.8) {
      this.hud.updateTargetIndicator({
        x: ((nx + 1) / 2) * width,
        y: ((1 - ny) / 2) * height - 46,
        angle: Math.PI / 2,
        distance,
        onScreen: true,
      });
      return;
    }

    const scale = Math.min(
      0.86 / Math.max(Math.abs(nx), 1e-4),
      0.74 / Math.max(Math.abs(ny), 1e-4),
    );
    const cx = nx * scale;
    const cy = ny * scale;
    this.hud.updateTargetIndicator({
      x: ((cx + 1) / 2) * width,
      y: ((1 - cy) / 2) * height,
      angle: Math.atan2(-ny, nx),
      distance,
      onScreen: false,
    });
  }

  private updateHud(): void {
    if (!this.route) return;
    const want = this.route.deliveries[this.deliveryIndex];
    const label = want ? (PACKAGE_COLORS.find((c) => c.id === want.color)?.label ?? '') : '';
    let objective = !this.flight.armed && this.flight.landed
      ? 'Press Enter to arm'
      : this.step === 'pickup'
        ? 'Land on the dispatch pad to load a package'
        : this.step === 'deliver'
          ? `Deliver to the ${label.toLowerCase()} rooftop pad`
          : 'Route complete!';
    const targetPad = this.currentTarget();
    if (targetPad && this.flight.armed && !this.flight.landed) {
      const distance = Math.hypot(
        targetPad.center.x - this.flight.position.x,
        targetPad.center.z - this.flight.position.z,
      );
      objective += ` · ${Math.max(1, Math.round(distance))} m`;
    }
    this.hud.update({
      routeName: `${this.route.id}. ${this.route.name}`,
      objective,
      elapsed: this.elapsed,
      delivered: this.delivered,
      totalDeliveries: this.route.deliveries.length,
      batteryPct: this.batteryPct,
      hullPct: this.hullPct,
      windAngle: Math.atan2(this.wind.current.z, this.wind.current.x),
      windSpeed: this.wind.strength,
      altitude: this.flight.position.y - this.env.groundClearance,
      packageLabel: this.env.carrying ? label : null,
      packageColor: this.env.carrying && want ? packageColor(want.color) : null,
    });
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- Harness ----------

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: () => {
        // All gameplay is deterministic; nothing to reseed.
      },
      setState: (name: string) => {
        const routeMatch = /^route-(\d+)$/.exec(name);
        if (name === 'active-play') {
          this.startRoute(1);
          this.flight.armed = true;
        } else if (routeMatch) {
          this.startRoute(Number(routeMatch[1]));
          this.flight.armed = true;
        } else if (name === 'complete') {
          if (this.phase !== 'flying') this.startRoute(1);
          this.finishRoute();
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
        // No debug UI in this build.
      },
      setTimeScale: (scale: number) => {
        this.timeScale = Math.max(0.1, Math.min(4, scale));
      },
      dumpColliders: () =>
        (this.city?.collision.boxes ?? []).map(({ box, label }) => ({
          label,
          min: [box.min.x, box.min.y, box.min.z] as [number, number, number],
          max: [box.max.x, box.max.y, box.max.z] as [number, number, number],
        })),
      dumpHazards: () => ({
        spheres: (this.city?.collision.spheres ?? []).map((s) => ({
          label: s.label,
          center: [s.center.x, s.center.y, s.center.z] as [number, number, number],
        })),
        segments: (this.city?.collision.segments ?? []).map((s) => ({
          label: s.label,
          start: [s.start.x, s.start.y, s.start.z] as [number, number, number],
          end: [s.end.x, s.end.y, s.end.z] as [number, number, number],
        })),
      }),
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.delivered,
      targetScore: this.route?.deliveries.length ?? 0,
      complete: this.step === 'complete',
      mission: {
        phase: this.phase,
        step: this.step,
        carrying: this.packageMesh !== null,
        battery: this.batteryPct,
        hull: this.hullPct,
        condition: this.packageCondition,
        landed: this.flight.landed,
        armed: this.flight.armed,
        target: (() => {
          const pad = this.currentTarget();
          return pad ? { x: pad.center.x, y: pad.center.y, z: pad.center.z, radius: pad.radius } : null;
        })(),
      },
      player: {
        position: {
          x: this.flight.position.x,
          y: this.flight.position.y,
          z: this.flight.position.z,
        },
        velocity: {
          x: this.flight.velocity.x,
          y: this.flight.velocity.y,
          z: this.flight.velocity.z,
        },
        speed: this.flight.velocity.length(),
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
    };
  }

  private element(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
