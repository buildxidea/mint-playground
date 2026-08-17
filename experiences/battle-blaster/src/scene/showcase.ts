import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createMintGltfLoader } from "../assets/gltf-runtime";
import { audio } from "../audio/audio-manager";
import { applyFinish } from "./material-finish";
import { FINISHES, finishById, type FinishDef } from "../data/finishes";
import { SLOT_LABELS, SLOT_ORDER } from "../data/arsenal";
import type { AnchorSpec, AttachmentDef, SlotType, WeaponDef } from "../data/arsenal";

export type ShowcaseStatus =
  | { kind: "loading"; message: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/** A slot anchor projected to canvas pixel space, for the DOM hotspot chips. */
export interface HotspotProjection {
  slot: SlotType;
  index: number;
  label: string;
  x: number;
  y: number;
  visible: boolean;
}

/** Acid accent, matching --acid in the stylesheet. */
const ACID = 0xc7ff1a;
const VOID_COLOR = 0x0a0b0a;

interface Tween {
  elapsed: number;
  duration: number;
  update: (t: number) => void;
  onDone?: () => void;
}

const IDLE_RESUME_SECONDS = 3.5;
const IDLE_SPIN_SPEED = 0.3;
const WEAPON_HOVER = 0.55;

/** Which way an attachment body extends away from its anchor point. */
const SLOT_DIRECTION: Record<SlotType, THREE.Vector3> = {
  scope: new THREE.Vector3(0, 1, 0),
  barrel: new THREE.Vector3(-1, 0, 0),
  magazine: new THREE.Vector3(0, -1, 0),
  grip: new THREE.Vector3(0, -1, 0),
  stock: new THREE.Vector3(1, 0, 0),
};

/**
 * How a slot finds its seat. Face slots sit on a surface somewhere along the
 * frame and need the surface probed; end slots sit on the extreme face of the
 * frame, which is the bounding box itself and needs no ray.
 */
const SLOT_SEAT_MODE: Record<SlotType, "surface" | "tip"> = {
  scope: "surface",
  magazine: "surface",
  grip: "surface",
  barrel: "tip",
  stock: "tip",
};

/**
 * Extra rotation applied to a module before it is measured and seated. Every
 * module in the current pack is authored rail-along-X, which is already correct
 * for all five slots, so these are identity. This exists so a future module
 * that is not can be corrected without touching the seating maths.
 */
const SLOT_ORIENTATION: Record<SlotType, THREE.Euler> = {
  scope: new THREE.Euler(),
  barrel: new THREE.Euler(),
  magazine: new THREE.Euler(),
  grip: new THREE.Euler(),
  stock: new THREE.Euler(),
};

/** Distance from an object's origin to its AABB face along a unit axis. */
function supportDistance(box: THREE.Box3, axis: THREE.Vector3): number {
  return (
    Math.max(box.min.x * axis.x, box.max.x * axis.x) +
    Math.max(box.min.y * axis.y, box.max.y * axis.y) +
    Math.max(box.min.z * axis.z, box.max.z * axis.z)
  );
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function makeFlashTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  // White-hot core falling off through acid green — an energy release rather
  // than the warm orange of a powder flash.
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.22, "rgba(214,255,140,0.95)");
  gradient.addColorStop(0.58, "rgba(140,255,60,0.4)");
  gradient.addColorStop(1, "rgba(90,200,30,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** A plasma bolt in flight, from the emitter toward whatever it is aimed at. */
interface Bolt {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  /** Fires when the bolt reaches its target, so impact lands on arrival. */
  onArrive?: () => void;
}

interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

/** Ionised vent wisp left behind by a discharge — replaces grey gunsmoke. */
function makeVentTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, "rgba(196,255,150,0.5)");
  gradient.addColorStop(0.6, "rgba(126,206,74,0.2)");
  gradient.addColorStop(1, "rgba(96,166,54,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function makeBullseyeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext("2d")!;
  // Ink plate with acid hairline rings, so the downrange target sits inside the
  // archive palette instead of reading as cream paper.
  ctx.fillStyle = "#111411";
  ctx.fillRect(0, 0, 256, 384);
  ctx.strokeStyle = "#343a35";
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 244, 372);
  const rings = [88, 66, 44, 22];
  for (let i = 0; i < rings.length; i++) {
    ctx.beginPath();
    ctx.arc(128, 176, rings[i], 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? "#161a16" : "#0d100d";
    ctx.fill();
    ctx.strokeStyle = i === rings.length - 1 ? "#c7ff1a" : "#3f4a3a";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

export class Showcase {
  onStatus: (status: ShowcaseStatus) => void = () => {};
  /** Called when a click on the weapon lands and the weapon actually fires. */
  onFire: () => void = () => {};
  /** Called when a weapon swap starts, for UI-side cinematic feedback. */
  onSwap: () => void = () => {};
  /** Slot anchors projected to canvas pixels, for the DOM hotspot overlay. */
  onHotspots: (spots: HotspotProjection[]) => void = () => {};

  /**
   * Anchor markers pinned over the stage. Off by default — they read as
   * clutter on a finished page. Flipping this on turns the overlay back into
   * the instrument for measuring attachment anchors against new geometry.
   */
  showHotspots = false;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private loader = createMintGltfLoader();
  private gltfCache = new Map<string, Promise<GLTF>>();

  private displayGroup = new THREE.Group();
  private pedestalGroup = new THREE.Group();
  private weaponRoot = new THREE.Group();
  private weaponGroup: THREE.Group | null = null;
  /** The frame model itself, excluding mounted modules. Probe target. */
  private weaponBody: THREE.Object3D | null = null;
  private weaponBounds = new THREE.Box3();
  private mounted = new Map<SlotType, THREE.Group>();
  private currentWeapon: WeaponDef | null = null;

  /**
   * Measured seat per slot, in weapon-local space — the single source of truth
   * for placement. Populated once per weapon load.
   */
  private seats = new Map<SlotType, THREE.Vector3>();
  /** Which weapon `seats` describes, so a mid-swap mount can't use stale data. */
  private seatsWeaponId: string | null = null;
  /** Emitter mouth centre, weapon-local, measured off the frame at load. */
  private muzzleSeat: THREE.Vector3 | null = null;
  /** Local front face of each mounted module, for the muzzle when extended. */
  private moduleFrontX = new Map<SlotType, number>();
  /** Placement-only, so picking and target tests can't leak state into it. */
  private probeRay = new THREE.Raycaster();

  private static readonly SEAT_PATCH_U = 0.03;
  private static readonly SEAT_PATCH_V = 0.08;
  private static readonly SEAT_PATCH_W = 0.1;
  private static readonly TIP_SLAB = 0.02;
  private static readonly SEAT_INSET = 0.05;

  private tweens: Tween[] = [];
  private idleTimer = 0;
  private interacting = false;
  private swapToken = 0;
  private fatalLoadError = false;

  private raycaster = new THREE.Raycaster();
  private pointerDown: { x: number; y: number; time: number } | null = null;
  private lastShotAt = 0;
  private muzzleFlash: THREE.Sprite;
  private muzzleLight: THREE.PointLight;

  /** Home framing, kept in sync with the pedestal height so Reset lands right. */
  private homePosition = new THREE.Vector3(2.7, 2.1, 3.4);
  private homeTarget = new THREE.Vector3(0, 1.35, 0);

  private composer: EffectComposer | null = null;
  private bloomEnabled = true;
  private envTexture: THREE.Texture | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private hotspotFrame = 0;
  private lifted = false;
  private exploded = false;
  /** Resting y of weaponRoot, tracked so Lift has something to return to. */
  private weaponBaseY = 1.35;
  /** Un-exploded local position of each mounted attachment. */
  private attachmentRest = new Map<SlotType, THREE.Vector3>();
  private weaponFinish: FinishDef = FINISHES[0];
  private attachmentFinish: FinishDef = FINISHES[0];

  private inspecting = false;
  private bolts: Bolt[] = [];
  private boltGeometry = new THREE.CapsuleGeometry(0.032, 0.2, 4, 8);
  private boltMaterial = new THREE.MeshBasicMaterial({
    color: ACID,
    // Un-tonemapped so the bolt stays above the bloom threshold and glows.
    toneMapped: false,
  });
  private puffs: Puff[] = [];
  private ventTexture = makeVentTexture();
  private targetGroup = new THREE.Group();
  private targetBoard: THREE.Mesh | null = null;
  private targetHoles: THREE.Mesh[] = [];
  private holeGeometry = new THREE.CircleGeometry(0.018, 10);
  private holeMaterial = new THREE.MeshBasicMaterial({ color: 0x14120e });

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 120);
    this.camera.position.copy(this.homePosition);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.enablePan = false;
    this.controls.target.copy(this.homeTarget);
    this.controls.addEventListener("start", () => {
      this.interacting = true;
      this.idleTimer = 0;
    });
    this.controls.addEventListener("end", () => {
      this.interacting = false;
      this.idleTimer = 0;
    });
    canvas.addEventListener("dblclick", () => this.resetView());
    canvas.addEventListener("pointerdown", (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, time: performance.now() };
    });
    canvas.addEventListener("pointerup", (e) => this.handleClickFire(e));

    this.buildStudio();
    this.buildFloorAccents();

    this.displayGroup.add(this.pedestalGroup);
    this.weaponRoot.position.y = 1.35;
    this.displayGroup.add(this.weaponRoot);
    this.scene.add(this.displayGroup);

    this.muzzleFlash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeFlashTexture(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      }),
    );
    this.muzzleFlash.scale.setScalar(0.001);
    this.muzzleLight = new THREE.PointLight(0xb6ff4d, 0, 6, 2);
    this.weaponRoot.add(this.muzzleFlash, this.muzzleLight);

    this.buildTarget();

    this.setupComposer();

    // The canvas is a grid cell, so it can resize without a window resize.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Dark studio void: one warm key, an acid rim, a cool bounce, and IBL. */
  private buildStudio(): void {
    this.scene.background = new THREE.Color(VOID_COLOR);
    // Fades the far target and hides where the void has no floor.
    this.scene.fog = new THREE.Fog(VOID_COLOR, 9, 26);

    // Image-based lighting so painted steel and copper actually read. This is
    // independent of scene.background, so the backdrop stays black.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.envTexture = environment.texture;
    this.scene.environment = environment.texture;
    // High enough that the polished metal finishes have something to reflect;
    // below this Chrome and Gunmetal read as flat dark paint.
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0x20261e, 0x050605, 0.35));

    const key = new THREE.SpotLight(0xfff4dc, 60, 18, Math.PI / 6, 0.5, 1.6);
    key.position.set(1.6, 5.4, 2.2);
    key.target.position.set(0, 1.4, 0);
    this.scene.add(key, key.target);

    const rim = new THREE.DirectionalLight(ACID, 1.1);
    rim.position.set(-3.4, 2.2, -3);
    this.scene.add(rim);

    const fill = new THREE.PointLight(0x9fb8ff, 6, 10, 2);
    fill.position.set(3.2, 1.2, -2.4);
    this.scene.add(fill);

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 256;
    const ctx = shadowCanvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    gradient.addColorStop(0, "rgba(0,0,0,0.8)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shadowCanvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    this.scene.add(shadow);
  }

  /**
   * Crossed hairlines and a ring on the floor. Added to the scene rather than
   * displayGroup so they stay put while the display idle-spins.
   */
  private buildFloorAccents(): void {
    const material = new THREE.MeshBasicMaterial({
      color: ACID,
      transparent: true,
      opacity: 0.72,
      // Keeps the accent exactly on-brand and above the bloom threshold.
      toneMapped: false,
    });

    const along = new THREE.Mesh(new THREE.PlaneGeometry(14, 0.012), material);
    const across = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 14), material);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.62, 1.636, 96), material);
    for (const accent of [along, across, ring]) {
      accent.rotation.x = -Math.PI / 2;
      accent.position.y = 0.004;
      this.scene.add(accent);
    }
  }

  private setupComposer(): void {
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Threshold bloom: only the emissive plasma cells, the additive muzzle
    // flash, and the un-tonemapped floor accents cross 0.82.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.45, 0.82));
    // Applies renderer.toneMapping + sRGB at the end of the chain.
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setBloom(on: boolean): void {
    this.bloomEnabled = on;
  }

  /**
   * Narrow layouts give up wheel zoom so the stage does not trap page scroll.
   */
  setCompact(compact: boolean): void {
    this.controls.enableZoom = !compact;
  }

  /**
   * Mounted attachments are children of the weapon group, so the frame finish
   * is applied first and the module finish re-applied over the top.
   */
  setFinishes(weaponFinishId: string, attachmentFinishId: string): void {
    this.weaponFinish = finishById(weaponFinishId);
    this.attachmentFinish = finishById(attachmentFinishId);
    if (this.weaponGroup) applyFinish(this.weaponGroup, this.weaponFinish);
    for (const group of this.mounted.values()) {
      applyFinish(group, this.attachmentFinish);
    }
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  resetView(): void {
    // Lerp between fixed endpoints — lerping from the live value each frame is
    // frame-rate dependent and never actually arrives.
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    this.addTween(0.7, (t) => {
      const e = easeInOutCubic(t);
      this.camera.position.lerpVectors(fromPosition, this.homePosition, e);
      this.controls.target.lerpVectors(fromTarget, this.homeTarget, e);
    });
  }

  private addTween(duration: number, update: (t: number) => void, onDone?: () => void): void {
    this.tweens.push({ elapsed: 0, duration, update, onDone });
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (!this.interacting) {
      this.idleTimer += dt;
      if (this.idleTimer > IDLE_RESUME_SECONDS) {
        // Lifted inspection reads better at a slower turn.
        const speed = this.lifted ? IDLE_SPIN_SPEED * 0.35 : IDLE_SPIN_SPEED;
        this.displayGroup.rotation.y += dt * speed;
      }
    }

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tween = this.tweens[i];
      tween.elapsed += dt;
      const t = Math.min(tween.elapsed / tween.duration, 1);
      tween.update(t);
      if (t >= 1) {
        this.tweens.splice(i, 1);
        tween.onDone?.();
      }
    }

    this.updateEffects(dt);
    this.emitHotspots();
    this.controls.update();
    if (this.bloomEnabled && this.composer) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Projects each supported slot anchor to canvas pixels. Doubles as the
   * measuring instrument when re-tuning anchors against new geometry.
   */
  private emitHotspots(): void {
    if (!this.showHotspots) return;
    // 30 Hz is plenty for DOM chips and halves the projection work.
    if (++this.hotspotFrame % 2 !== 0) return;
    const weapon = this.weaponGroup;
    const def = this.currentWeapon;
    if (!weapon || !def) return;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const spots: HotspotProjection[] = [];
    let index = 0;
    for (const slot of SLOT_ORDER) {
      const spec = def.slots[slot];
      if (!spec) continue;
      index += 1;
      // clone() is load-bearing: localToWorld mutates in place, and the seat
      // vectors are cached, so handing one over would corrupt the cache every
      // frame and walk the modules across the screen.
      const projected = weapon
        .localToWorld(this.seatFor(slot, spec, def.id).clone())
        .project(this.camera);
      spots.push({
        slot,
        index,
        label: SLOT_LABELS[slot],
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
        visible: projected.z < 1,
      });
    }
    this.onHotspots(spots);
  }

  /** Raises the weapon off the pedestal for a closer read. */
  setLift(on: boolean): void {
    if (this.lifted === on) return;
    this.lifted = on;
    const from = this.weaponRoot.position.y;
    const to = this.weaponBaseY + (on ? 0.35 : 0);
    this.addTween(0.45, (t) => {
      this.weaponRoot.position.y = from + (to - from) * easeInOutCubic(t);
    });
  }

  /** Slides mounted attachments away from the body along their slot axis. */
  setExploded(on: boolean): void {
    if (this.exploded === on) return;
    this.exploded = on;
    for (const [slot, group] of this.mounted) {
      const rest = this.attachmentRest.get(slot);
      if (!rest) continue;
      const from = group.position.clone();
      const to = on ? rest.clone().addScaledVector(SLOT_DIRECTION[slot], 0.25) : rest.clone();
      this.addTween(0.4, (t) => {
        group.position.lerpVectors(from, to, easeInOutCubic(t));
      });
    }
  }

  private loadGltf(url: string): Promise<GLTF> {
    let cached = this.gltfCache.get(url);
    if (!cached) {
      cached = this.loader.loadAsync(url);
      cached.catch(() => this.gltfCache.delete(url));
      this.gltfCache.set(url, cached);
    }
    return cached;
  }

  /** Rotate the object so its longest horizontal axis lies along X, then scale/center it. */
  private normalizeLongAxis(source: THREE.Object3D, targetLength: number): THREE.Group {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(source);
    group.add(inner);

    let box = new THREE.Box3().setFromObject(inner);
    let size = box.getSize(new THREE.Vector3());
    if (size.z > size.x) {
      inner.rotation.y = -Math.PI / 2;
      box = new THREE.Box3().setFromObject(inner);
      size = box.getSize(new THREE.Vector3());
    }
    const scale = targetLength / Math.max(size.x, 1e-6);
    inner.scale.setScalar(scale);
    box = new THREE.Box3().setFromObject(inner);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.sub(center);
    return group;
  }

  async loadPedestal(url: string): Promise<void> {
    try {
      const gltf = await this.loadGltf(url);
      const pedestal = this.normalizeLongAxis(gltf.scene.clone(true), 2.5);
      const box = new THREE.Box3().setFromObject(pedestal);
      pedestal.position.y = -box.min.y;
      const top = box.max.y - box.min.y;
      this.pedestalGroup.clear();
      this.pedestalGroup.add(pedestal);
      const hover = top + WEAPON_HOVER;
      this.weaponBaseY = hover;
      this.weaponRoot.position.y = hover + (this.lifted ? 0.35 : 0);
      // Reset must return to the pedestal-adjusted framing, not the initial guess.
      this.homeTarget.set(0, hover, 0);
      this.homePosition.set(2.7, hover + 0.75, 3.4);
      this.controls.target.copy(this.homeTarget);
    } catch {
      // Non-fatal: the weapon showcase still works floating over the floor.
      this.onStatus({
        kind: "error",
        message: "Display platform failed to load — showing weapons without it.",
      });
    }
  }

  async showWeapon(def: WeaponDef, equipped: AttachmentDef[]): Promise<void> {
    const token = ++this.swapToken;
    this.fatalLoadError = false;
    this.currentWeapon = def;
    this.inspecting = false;
    this.controls.enabled = true;
    this.onStatus({ kind: "loading", message: `Deploying ${def.name}…` });

    const previous = this.weaponGroup;
    if (previous) {
      this.onSwap();
      this.swapCinematic();
      this.mounted.clear();
      this.attachmentRest.clear();
      this.addTween(
        0.28,
        (t) => previous.scale.setScalar(Math.max(1 - easeInOutCubic(t), 0.001)),
        () => this.weaponRoot.remove(previous),
      );
    }

    let gltf: GLTF;
    try {
      gltf = await this.loadGltf(def.modelUrl);
    } catch {
      if (token !== this.swapToken || this.fatalLoadError) return;
      this.fatalLoadError = true;
      this.onStatus({ kind: "error", message: `Failed to load ${def.name}.` });
      return;
    }
    if (token !== this.swapToken) return;

    const clone = gltf.scene.clone(true);
    const group = this.normalizeLongAxis(clone, def.displayLength);
    this.weaponBounds = new THREE.Box3().setFromObject(group);
    // Must happen here: the group is still parentless and identity, so probe
    // hits land in the same space modules are positioned in.
    this.computeSeats(def, group, this.weaponBounds);
    this.weaponGroup = group;
    this.moduleFrontX.clear();
    applyFinish(group, this.weaponFinish);
    this.weaponRoot.add(group);

    if (def.soundUrl) audio.preload(def.id, def.soundUrl);

    group.scale.setScalar(0.001);
    this.addTween(0.45, (t) => group.scale.setScalar(Math.max(easeOutBack(t), 0.001)));

    for (const attachment of equipped) {
      await this.mountAttachment(def, attachment, false);
      if (token !== this.swapToken) return;
    }
    this.onStatus({ kind: "ready" });
  }

  /**
   * The old bounding-box fraction. Demoted to a fallback for when a probe finds
   * nothing, so a failed probe is never worse than the previous behaviour.
   */
  private boxAnchor(spec: AnchorSpec, bounds: THREE.Box3, size: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(
      bounds.min.x + (spec.u ?? 0.5) * size.x,
      bounds.min.y + (spec.v ?? 0.5) * size.y,
      bounds.min.z + (spec.w ?? 0.5) * size.z,
    );
  }

  /**
   * Seat for a slot: measured when the probe succeeded for THIS weapon, and the
   * authored box fraction otherwise. The id check keeps a mount that races a
   * weapon swap from seating against the previous frame's measurements.
   */
  private seatFor(slot: SlotType, spec: AnchorSpec, weaponId: string): THREE.Vector3 {
    const measured = this.seatsWeaponId === weaponId ? this.seats.get(slot) : undefined;
    if (measured) return measured;
    return this.boxAnchor(spec, this.weaponBounds, this.weaponBounds.getSize(new THREE.Vector3()));
  }

  /**
   * Measures where every supported module actually lands on this frame.
   *
   * MUST run while `group` is parentless and identity: world space then equals
   * weapon-local space, so hit points are directly usable as local positions.
   * Later is wrong twice over — the scale-in animation shrinks the body to
   * 0.001, and once parented the idle spin rotates every world-space hit.
   */
  private computeSeats(def: WeaponDef, group: THREE.Group, bounds: THREE.Box3): void {
    this.seats.clear();
    this.seatsWeaponId = null;
    this.muzzleSeat = null;

    // Captured once, here, while the group holds only the frame. Modules are
    // added to this same group later, so a positional lookup done any later
    // would start hitting them instead of the frame.
    this.weaponBody = group.children[0] ?? null;
    const body = this.weaponBody;
    if (!body) return;
    // Raycaster reads matrixWorld and never refreshes it itself.
    group.updateMatrixWorld(true);

    const size = bounds.getSize(new THREE.Vector3());
    for (const slot of SLOT_ORDER) {
      const spec = def.slots[slot];
      if (!spec) continue;
      const direction = SLOT_DIRECTION[slot];
      const probed =
        SLOT_SEAT_MODE[slot] === "tip"
          ? this.tipSeat(body, bounds, size, direction, spec)
          : this.surfaceSeat(body, bounds, size, direction, spec);
      this.seats.set(slot, probed ?? this.boxAnchor(spec, bounds, size));
    }

    // fire() wants the emitter mouth whether or not this frame takes a module,
    // and it should use the same bore hint the emitter bay does.
    this.muzzleSeat = this.tipSeat(
      body,
      bounds,
      size,
      new THREE.Vector3(-1, 0, 0),
      def.slots.barrel,
    );
    this.seatsWeaponId = def.id;
  }

  /**
   * Outward-most surface within a small patch around (u, w). Deliberately
   * narrow: sampling a module's whole footprint drags the seat onto whatever
   * else sits under it, like a pistol grip or a trigger guard.
   */
  private surfaceSeat(
    body: THREE.Object3D,
    bounds: THREE.Box3,
    size: THREE.Vector3,
    direction: THREE.Vector3,
    spec: AnchorSpec,
  ): THREE.Vector3 | null {
    const up = direction.y > 0;
    const x = bounds.min.x + (spec.u ?? 0.5) * size.x;
    const z = bounds.min.z + (spec.w ?? 0.5) * size.z;
    const dx = Showcase.SEAT_PATCH_U * size.x;
    const dz = Showcase.SEAT_PATCH_W * size.z;
    const startY = up ? bounds.max.y + size.x : bounds.min.y - size.x;
    const inward = direction.clone().negate();

    let best: number | null = null;
    let hits = 0;
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        this.probeRay.set(new THREE.Vector3(x + i * dx, startY, z + j * dz), inward);
        const found = this.probeRay.intersectObject(body, true);
        if (found.length === 0) continue;
        hits += 1;
        const y = found[0].point.y;
        if (best === null || (up ? y > best : y < best)) best = y;
      }
    }
    // A single hit through a gap in the shell is not a surface.
    if (hits < 2 || best === null) return null;
    return new THREE.Vector3(x, best, z);
  }

  /**
   * The end of the frame along X — the emitter mouth at the front, the back of
   * the receiver at the rear.
   *
   * With an authored height, this rays along the axis at that height to find
   * the real end surface *there*. That matters whenever the extreme face and
   * the mount are different features: the Ionbreaker's rearmost geometry is the
   * heel of its grip, and the Slagthrower's muzzle face carries both a bore and
   * a canister ring with a hollow gap between them, so a whole-face centre
   * lands on neither.
   *
   * Without one, it falls back to the centre of the extreme face, read from
   * vertices — that face is the bounding box by definition, and a ray fan can
   * miss a small round mouth between samples.
   */
  private tipSeat(
    body: THREE.Object3D,
    bounds: THREE.Box3,
    size: THREE.Vector3,
    direction: THREE.Vector3,
    spec?: AnchorSpec,
  ): THREE.Vector3 | null {
    if (spec?.v !== undefined) {
      const aimed = this.tipSeatAtHeight(body, bounds, size, direction, spec);
      if (aimed) return aimed;
    }
    const forward = direction.x < 0;
    const faceX = forward ? bounds.min.x : bounds.max.x;
    const slab = Showcase.TIP_SLAB * size.x;
    const face = new THREE.Box3();
    const vertex = new THREE.Vector3();

    body.updateMatrixWorld(true);
    body.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const position = child.geometry.getAttribute("position");
      if (!position) return;
      for (let i = 0; i < position.count; i += 1) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
        if (forward ? vertex.x <= faceX + slab : vertex.x >= faceX - slab) {
          face.expandByPoint(vertex);
        }
      }
    });
    if (face.isEmpty()) return null;
    const centre = face.getCenter(new THREE.Vector3());
    return new THREE.Vector3(faceX, centre.y, centre.z);
  }

  /**
   * Rays back along the frame axis around an authored height, to find the end
   * surface there rather than the extreme end of the whole model.
   *
   * Samples a 3x3 patch and keeps the outward-most hit. The spread matters: an
   * emitter mouth is a hole, so a ray aimed at the middle of it travels down
   * the bore and reports a surface a long way inside. Neighbours that land on
   * the surrounding rim win, which is the plane the module should butt against.
   * The returned seat keeps the authored height — only the depth is measured.
   */
  private tipSeatAtHeight(
    body: THREE.Object3D,
    bounds: THREE.Box3,
    size: THREE.Vector3,
    direction: THREE.Vector3,
    spec: AnchorSpec,
  ): THREE.Vector3 | null {
    const forward = direction.x < 0;
    const y = bounds.min.y + (spec.v ?? 0.5) * size.y;
    const z = bounds.min.z + (spec.w ?? 0.5) * size.z;
    const dy = Showcase.SEAT_PATCH_V * size.y;
    const dz = Showcase.SEAT_PATCH_W * size.z;
    const startX = forward ? bounds.min.x - size.x : bounds.max.x + size.x;
    const inward = direction.clone().negate();

    let best: number | null = null;
    let hits = 0;
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        this.probeRay.set(new THREE.Vector3(startX, y + i * dy, z + j * dz), inward);
        const found = this.probeRay.intersectObject(body, true);
        if (found.length === 0) continue;
        hits += 1;
        const x = found[0].point.x;
        if (best === null || (forward ? x < best : x > best)) best = x;
      }
    }
    if (hits < 2 || best === null) return null;

    // A wide aperture can swallow the whole patch — every ray travels down the
    // bore and reports a surface deep inside. When the result is far behind the
    // frame's end face, the rim is what the module should meet, so use the face
    // plane at the authored height instead.
    const faceX = forward ? bounds.min.x : bounds.max.x;
    if (Math.abs(best - faceX) > 0.1 * size.x) best = faceX;
    return new THREE.Vector3(best, y, z);
  }

  async mountAttachment(
    weapon: WeaponDef,
    attachment: AttachmentDef,
    animate = true,
  ): Promise<void> {
    const spec = weapon.slots[attachment.slot];
    if (!spec || !this.weaponGroup) return;
    // loadoutChanged fires independently of showWeapon, so without this a mount
    // can land against the previous frame's bounds and seats.
    if (!this.currentWeapon || this.currentWeapon.id !== weapon.id) return;
    const token = this.swapToken;

    this.unmountAttachment(attachment.slot, false);

    let gltf: GLTF;
    try {
      gltf = await this.loadGltf(attachment.modelUrl);
    } catch {
      this.onStatus({ kind: "error", message: `Failed to load ${attachment.name}.` });
      return;
    }
    if (token !== this.swapToken || !this.weaponGroup) return;

    const length = weapon.displayLength * attachment.relativeSize * (spec.sizeScale ?? 1);
    const group = this.normalizeLongAxis(gltf.scene.clone(true), length);

    // Orientation first: the bounds below must describe the module as it will be
    // seen, or the extent used to seat it belongs to the wrong axis.
    group.rotation.copy(SLOT_ORIENTATION[attachment.slot]);
    group.updateMatrixWorld(true);
    // Measured before position is set — setFromObject returns parent-space
    // bounds, so it would otherwise fold the position back in.
    const bounds = new THREE.Box3().setFromObject(group);

    const direction = SLOT_DIRECTION[attachment.slot];
    const seat = this.seatFor(attachment.slot, spec, weapon.id);
    // Support point rather than size/2, so this stays correct if an orientation
    // ever leaves the content off-centre about its origin.
    const back = supportDistance(bounds, direction.clone().negate());
    const span = back + supportDistance(bounds, direction);
    const inset = Math.min(Showcase.SEAT_INSET * span, 0.02 * weapon.displayLength);
    group.position.copy(seat).addScaledVector(direction, back - inset);

    applyFinish(group, this.attachmentFinish);
    this.weaponGroup.add(group);
    this.mounted.set(attachment.slot, group);
    this.attachmentRest.set(attachment.slot, group.position.clone());
    // Local front face, so fire() can find the muzzle without world-space bounds.
    this.moduleFrontX.set(attachment.slot, group.position.x + bounds.min.x);
    // Mounting while exploded should land in the exploded position.
    if (this.exploded) group.position.addScaledVector(direction, 0.25);

    if (animate) {
      const rest = group.position.clone();
      const start = rest.clone().add(direction.clone().multiplyScalar(0.4));
      group.position.copy(start);
      this.addTween(0.35, (t) => {
        group.position.lerpVectors(start, rest, easeOutBack(t));
      });
      this.pulseEmissive(group);
    }
  }

  unmountAttachment(slot: SlotType, animate = true): void {
    const group = this.mounted.get(slot);
    if (!group) return;
    this.mounted.delete(slot);
    this.attachmentRest.delete(slot);
    this.moduleFrontX.delete(slot);
    // `seats` is deliberately NOT cleared — it belongs to the weapon, not the
    // mount, and clearing it would make every re-equip fall back to boxAnchor.
    const parent = group.parent;
    if (!parent) return;
    if (!animate) {
      parent.remove(group);
      return;
    }
    const rest = group.position.clone();
    const out = rest.clone().add(SLOT_DIRECTION[slot].clone().multiplyScalar(0.35));
    this.addTween(
      0.25,
      (t) => {
        group.position.lerpVectors(rest, out, easeInOutCubic(t));
        group.scale.setScalar(Math.max(1 - t, 0.001));
      },
      () => parent.remove(group),
    );
  }

  /** Temporary, fully reversible emissive boost — restores authored values. */
  private pulseEmissive(root: THREE.Object3D): void {
    const targets: { material: THREE.MeshStandardMaterial; base: number }[] = [];
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            targets.push({ material, base: material.emissiveIntensity });
          }
        }
      }
    });
    this.addTween(
      0.6,
      (t) => {
        const boost = Math.sin(Math.min(t, 1) * Math.PI) * 1.2;
        for (const { material, base } of targets) {
          material.emissiveIntensity = base + boost;
        }
      },
      () => {
        for (const { material, base } of targets) {
          material.emissiveIntensity = base;
        }
      },
    );
  }

  // --- Range target ---------------------------------------------------------

  /** A downrange paper target that takes visible hits when shots land on it. */
  private buildTarget(): void {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.5, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x1c211a, roughness: 0.8 }),
    );
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 1.42),
      new THREE.MeshStandardMaterial({ map: makeBullseyeTexture(), roughness: 0.9 }),
    );
    board.position.z = 0.032;
    this.targetBoard = board;

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8),
      new THREE.MeshStandardMaterial({ color: 0x22261f, roughness: 0.7 }),
    );
    post.position.y = -1.25;

    this.targetGroup.add(frame, board, post);
    this.targetGroup.position.set(0, 1.85, -6.2);
    this.scene.add(this.targetGroup);
  }

  /** Where the shot would land on the board, if it lands at all. */
  private findTargetHit(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
  ): THREE.Vector3 | null {
    if (!this.targetBoard) return null;
    const previousFar = this.raycaster.far;
    try {
      this.raycaster.set(origin, direction);
      this.raycaster.far = 40;
      const hits = this.raycaster.intersectObject(this.targetBoard, false);
      return hits.length > 0 ? hits[0].point.clone() : null;
    } finally {
      // Restore rather than assume the default, so a throw can't leave every
      // later pick silently capped at 40.
      this.raycaster.far = previousFar;
    }
  }

  /** Scorch, flash and sway — deferred until the bolt actually arrives. */
  private applyTargetHit(point: THREE.Vector3): void {
    const board = this.targetBoard;
    if (!board) return;

    const hole = new THREE.Mesh(this.holeGeometry, this.holeMaterial);
    const local = board.worldToLocal(point.clone());
    hole.position.set(local.x, local.y, 0.004);
    board.add(hole);
    this.targetHoles.push(hole);
    if (this.targetHoles.length > 40) {
      const oldest = this.targetHoles.shift()!;
      board.remove(oldest);
    }

    // Impact flash + sway.
    const spark = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.muzzleFlash.material.map,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    spark.position.copy(point);
    spark.scale.setScalar(0.18);
    this.scene.add(spark);
    this.addTween(
      0.18,
      (t) => {
        (spark.material as THREE.SpriteMaterial).opacity = 1 - t;
        spark.scale.setScalar(0.18 + t * 0.1);
      },
      () => {
        this.scene.remove(spark);
        spark.material.dispose();
      },
    );

    const kick = 0.09;
    this.addTween(0.7, (t) => {
      this.targetGroup.rotation.x = kick * Math.sin(t * Math.PI * 3) * (1 - t);
    });
  }

  // --- Bolts and vent wisps --------------------------------------------------

  private static readonly BOLT_SPEED = 34;

  private spawnBolt(
    originWorld: THREE.Vector3,
    directionWorld: THREE.Vector3,
    travel: number | null,
    onArrive?: () => void,
  ): void {
    const mesh = new THREE.Mesh(this.boltGeometry, this.boltMaterial);
    mesh.position.copy(originWorld);
    // The capsule runs along +Y, so aim it down the travel direction.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), directionWorld);
    this.scene.add(mesh);
    this.bolts.push({
      mesh,
      velocity: directionWorld.clone().multiplyScalar(Showcase.BOLT_SPEED),
      // A bolt that hits something lives exactly long enough to get there.
      life: travel === null ? 0.8 : travel / Showcase.BOLT_SPEED,
      onArrive,
    });
  }

  private spawnVent(originWorld: THREE.Vector3, directionWorld: THREE.Vector3): void {
    for (let i = 0; i < 3; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.ventTexture,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.28,
        }),
      );
      sprite.position
        .copy(originWorld)
        .add(directionWorld.clone().multiplyScalar(0.08 + i * 0.1));
      sprite.scale.setScalar(0.12 + i * 0.05);
      this.scene.add(sprite);
      const maxLife = 0.7 + Math.random() * 0.5;
      this.puffs.push({
        sprite,
        velocity: directionWorld
          .clone()
          .multiplyScalar(0.5 + Math.random() * 0.4)
          .add(new THREE.Vector3(0, 0.5 + Math.random() * 0.3, 0)),
        life: maxLife,
        maxLife,
      });
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.life -= dt;
      bolt.mesh.position.addScaledVector(bolt.velocity, dt);
      if (bolt.life <= 0) {
        this.scene.remove(bolt.mesh);
        this.bolts.splice(i, 1);
        bolt.onArrive?.();
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i];
      puff.life -= dt;
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      puff.sprite.scale.multiplyScalar(1 + dt * 1.6);
      (puff.sprite.material as THREE.SpriteMaterial).opacity =
        0.28 * Math.max(puff.life / puff.maxLife, 0);
      if (puff.life <= 0) {
        this.scene.remove(puff.sprite);
        puff.sprite.material.dispose();
        this.puffs.splice(i, 1);
      }
    }
  }

  // --- Inspect and swap cinematics -------------------------------------------

  /** CS-style inspect: pull the weapon toward the camera, spin it, return it. */
  inspect(): void {
    const weapon = this.weaponGroup;
    if (this.inspecting || !weapon) return;
    this.inspecting = true;
    this.controls.enabled = false;
    this.interacting = true;

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const worldPoint = this.camera.position
      .clone()
      .add(camDir.multiplyScalar(1.7))
      .add(new THREE.Vector3(0, -0.08, 0));
    const localPoint = this.weaponRoot.worldToLocal(worldPoint);
    const startPosition = weapon.position.clone();

    this.addTween(
      2.3,
      (t) => {
        if (this.weaponGroup !== weapon) return;
        // Ease in for the first 15%, hold close-up, ease home for the last 20%.
        const inT = Math.min(t / 0.15, 1);
        const outT = Math.max((t - 0.8) / 0.2, 0);
        const travel = easeInOutCubic(inT) * (1 - easeInOutCubic(outT));
        weapon.position.lerpVectors(startPosition, localPoint, travel);
        weapon.scale.setScalar(1 + 0.12 * travel);
        weapon.rotation.y = easeInOutCubic(Math.min(Math.max((t - 0.1) / 0.75, 0), 1)) * Math.PI * 2;
        weapon.rotation.z = Math.sin(t * Math.PI * 2) * 0.12 * travel;
      },
      () => {
        if (this.weaponGroup === weapon) {
          weapon.position.copy(startPosition);
          weapon.rotation.set(0, 0, 0);
          weapon.scale.setScalar(1);
        }
        this.inspecting = false;
        this.controls.enabled = true;
        this.interacting = false;
        this.idleTimer = 0;
      },
    );
  }

  /** Quick orbital swing + zoom punch that starts and ends at the same framing. */
  private swapCinematic(): void {
    const pivot = this.controls.target.clone();
    const startOffset = this.camera.position.clone().sub(pivot);
    this.addTween(0.9, (t) => {
      const wave = Math.sin(t * Math.PI);
      const angle = 0.55 * wave;
      const offset = startOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      offset.multiplyScalar(1 - 0.18 * wave);
      this.camera.position.copy(pivot).add(offset);
      this.camera.fov = 45 + 6 * wave;
      this.camera.updateProjectionMatrix();
    });
  }

  // --- Firing -------------------------------------------------------------

  /** Fires only when the pointer went down and up on the weapon without dragging. */
  private handleClickFire(e: PointerEvent): void {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || !this.weaponGroup || !this.currentWeapon) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > 6 || performance.now() - down.time > 350) return;

    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.raycaster.intersectObject(this.weaponGroup, true).length === 0) return;

    this.fire();
  }

  private cooldownMs(def: WeaponDef): number {
    // Faster weapons re-fire sooner: 80 fire rate ≈ 310 ms, 12 ≈ 850 ms.
    return 150 + (100 - def.stats.fireRate) * 8;
  }

  fire(): void {
    const def = this.currentWeapon;
    const weapon = this.weaponGroup;
    if (!def || !weapon || this.inspecting) return;
    const now = performance.now();
    if (now - this.lastShotAt < this.cooldownMs(def)) return;
    this.lastShotAt = now;

    // The emitter mouth, measured off the frame at load. A mounted extension
    // pushes it forward to the module's own front face — recorded in local
    // space at mount time, because setFromObject would return world bounds and
    // the stage idle-spins.
    const size = this.weaponBounds.getSize(new THREE.Vector3());
    const mouth =
      this.muzzleSeat ??
      new THREE.Vector3(
        this.weaponBounds.min.x,
        this.weaponBounds.min.y + (def.slots.barrel?.v ?? 0.6) * size.y,
        this.weaponBounds.min.z + 0.5 * size.z,
      );
    const extensionFront = this.moduleFrontX.get("barrel");
    const muzzleX = extensionFront !== undefined ? Math.min(mouth.x, extensionFront) : mouth.x;
    const muzzleWorld = weapon.localToWorld(
      new THREE.Vector3(muzzleX - 0.05, mouth.y, mouth.z),
    );
    const muzzle = this.weaponRoot.worldToLocal(muzzleWorld.clone());
    this.muzzleFlash.position.copy(muzzle);
    this.muzzleLight.position.copy(muzzle);

    // World-space shot direction and side vector for effects.
    const worldQuat = weapon.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(-1, 0, 0).applyQuaternion(worldQuat);
    const spread = (1 - def.stats.stability / 100) * 0.05;
    forward
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
        ),
      )
      .normalize();

    // The bolt carries the impact with it, so the scorch lands when it arrives
    // rather than the instant the trigger is pulled.
    const hit = this.findTargetHit(muzzleWorld, forward);
    this.spawnBolt(
      muzzleWorld,
      forward,
      hit ? muzzleWorld.distanceTo(hit) : null,
      hit ? () => this.applyTargetHit(hit) : undefined,
    );
    this.spawnVent(muzzleWorld, forward);

    const heft = def.stats.damage / 100;
    // Kept well below the old orange values: an un-tonemapped green flash is
    // far brighter through the bloom pass and washes out the whole stage.
    const flashSize = 0.18 + heft * 0.24;

    this.addTween(0.14 + heft * 0.08, (t) => {
      const fade = 1 - easeInOutCubic(t);
      this.muzzleFlash.scale.setScalar(Math.max(flashSize * fade, 0.001));
      (this.muzzleFlash.material as THREE.SpriteMaterial).opacity = fade * 0.85;
      this.muzzleFlash.material.rotation = t * 0.9;
      this.muzzleLight.intensity = 14 * fade;
    });

    // Recoil: kick rearward (+X) with a slight upward pitch, then settle back.
    const kick = 0.05 + heft * 0.09;
    const pitch = 0.03 + heft * 0.05;
    this.addTween(0.09, (t) => {
      weapon.position.x = kick * easeInOutCubic(t);
      weapon.rotation.z = pitch * easeInOutCubic(t);
    }, () => {
      this.addTween(0.28, (t) => {
        const back = 1 - easeInOutCubic(t);
        weapon.position.x = kick * back;
        weapon.rotation.z = pitch * back;
      });
    });

    audio.play(def.id);

    this.onFire();
  }

  /**
   * Releases GPU resources. Without this, every hot reload leaves a second
   * renderer and animation loop running on the same canvas.
   */
  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        (object as THREE.Mesh).geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material?.dispose();
      }
    });
    this.envTexture?.dispose();
    this.envTexture = null;
    this.ventTexture.dispose();
    this.boltGeometry.dispose();
    this.boltMaterial.dispose();
    this.holeGeometry.dispose();
    this.holeMaterial.dispose();
    this.gltfCache.clear();
    this.mounted.clear();
    this.attachmentRest.clear();
    this.seats.clear();
    this.moduleFrontX.clear();
    this.bolts.length = 0;
    this.puffs.length = 0;
    this.tweens.length = 0;
    this.renderer.dispose();
  }
}
