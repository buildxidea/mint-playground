import * as THREE from "three";
import { createMintGltfLoader } from "./gltf-runtime";
import { disposeObject3D } from "./dispose";
import { FLEET_MANIFEST, type PartName } from "./fleet-manifest";
import { ASSEMBLIES, DEFAULT_ASSEMBLY, vec, type EraAssembly } from "./assembly";
import { ERAS } from "../brand/brand";
import { Turntable } from "./Turntable";

const PART_TARGET_SIZE: Record<PartName, number> = {
  body: 1, // × assembly.length
  hood: 0.34,
  doorL: 0.3,
  doorR: 0.3,
  wheel: 0.145, // wheel diameter as fraction of length
};

/** how far the manual exploded view pushes parts along their tuned vectors */
const EXPLODE_AMPLITUDE = 1.2;

const TAU = Math.PI * 2;

/** reused by the per-frame hinge update so it allocates nothing */
const SCRATCH_AXIS = new THREE.Vector3();

/** radians per second the plate turns during the opening aerial shot */
const INTRO_SPIN_RATE = 0.16;

/**
 * Above this intro amount the page counts as "parked at the top" and the
 * wheel just turns. Below it the descent has begun and the plate is carried
 * forward onto its landing orientation.
 */
const INTRO_PARKED = 0.995;

/**
 * If the plate is already within this of its landing orientation when the
 * descent starts, it eases back onto it instead of carrying forward a whole
 * revolution. ~20° — small enough to read as settling, not rewinding.
 */
const INTRO_SETTLE_BACK = 0.35;

/** slower drift for the closing aerial shot */
const FINALE_SPIN_RATE = 0.05;

/**
 * Idle float for the wheel-less hover car. Amplitude is in metres either side
 * of its rest height; at 0.45 rest it never comes near the ground.
 */
const HOVER_BOB_AMPLITUDE = 0.105;
const HOVER_BOB_SPEED = 1.05;

interface CarAssembly {
  key: string;
  index: number;
  root: THREE.Group; // station placement on the plate
  partsRoot: THREE.Group;
  parts: Partial<Record<PartName, THREE.Group>>;
  wheelClones: THREE.Group[];
  hinges: { hood?: THREE.Group; doorL?: THREE.Group; doorR?: THREE.Group };
  paintMaterials: THREE.MeshStandardMaterial[];
  wheelMaterials: THREE.MeshStandardMaterial[];
  explodeVectors: Map<THREE.Group, THREE.Vector3>;
  placeholder: boolean;
  config: EraAssembly;
  doorsOpen: number; // animated 0..1
  doorsTarget: number;
  /** manual exploded-view toggle (only meaningful when centered) */
  manualExplode: number;
  manualTarget: number;
}

export type FleetProgress = (loaded: number, total: number, label: string) => void;

/**
 * Loads and owns the six generation assemblies on the turntable. Single
 * owner of station placement, the arrival assembly scrub, hinge state, the
 * finale arrangement, and the 2026 customizer.
 */
export class CarFleet {
  private assemblies = new Map<string, CarAssembly>();
  private loader = createMintGltfLoader();
  private turntable: Turntable;
  private finaleLights: THREE.SpotLight[] = [];
  // "reveal" is the aerial ring framing, used by both the hero intro and the
  // closing lineage shot: no car is centered, so none takes doors.
  private mode: "scroll" | "reveal" = "scroll";
  private revealT = 0;
  private introT = 0;
  private introSpinAngle = 0;
  /** latched landing orientation for the descent; null while parked at top */
  private introSpinTarget: number | null = null;
  private finaleSpinAngle = 0;
  private elapsed = 0;
  private reduced: boolean;

  constructor(turntable: Turntable, reduced = false) {
    this.turntable = turntable;
    this.reduced = reduced;
  }

  async load(onProgress: FleetProgress) {
    const eras = ERAS.map((e) => e.key);
    let done = 0;
    const total = eras.length;
    for (const key of eras) {
      onProgress(done, total, key);
      const assembly = await this.buildAssembly(key, eras.indexOf(key));
      this.assemblies.set(key, assembly);
      this.turntable.group.add(assembly.root);
      done += 1;
      onProgress(done, total, key);
    }
    this.buildFinaleLights();
  }

  private async buildAssembly(key: string, index: number): Promise<CarAssembly> {
    const config = ASSEMBLIES[key] ?? DEFAULT_ASSEMBLY;
    const manifest = FLEET_MANIFEST[key];
    const station = Turntable.stationTransform(index);

    const root = new THREE.Group();
    root.position.copy(station.position);
    root.rotation.y = station.yaw;
    const partsRoot = new THREE.Group();
    root.add(partsRoot);

    const assembly: CarAssembly = {
      key, index, root, partsRoot,
      parts: {}, wheelClones: [], hinges: {},
      paintMaterials: [], wheelMaterials: [],
      explodeVectors: new Map(),
      placeholder: !manifest?.parts,
      config,
      doorsOpen: 0, doorsTarget: 0,
      manualExplode: 0, manualTarget: 0,
    };

    if (!manifest?.parts) {
      this.buildPlaceholder(assembly);
    } else {
      await this.buildFromParts(assembly, manifest.parts);
    }

    this.collectMaterials(assembly);
    this.computeExplodeVectors(assembly);
    return assembly;
  }

  private async buildFromParts(assembly: CarAssembly, parts: Partial<Record<PartName, string>>) {
    const { config } = assembly;
    const load = async (url: string) => {
      const gltf = await this.loader.loadAsync(url);
      const scene = gltf.scene;
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = false;
          // clone materials so per-assembly customization never leaks
          o.material = Array.isArray(o.material)
            ? o.material.map((m: THREE.Material) => m.clone())
            : o.material.clone();
          // cap hot generated emissives (neon streaks) so they glow without
          // detonating the bloom pass
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m: THREE.Material) => {
            if (m instanceof THREE.MeshStandardMaterial && m.emissive.getHex() !== 0) {
              m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.45);
            }
          });
        }
      });
      return scene;
    };

    const normalize = (obj: THREE.Object3D, targetSize: number) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const largest = Math.max(size.x, size.y, size.z);
      const s = largest > 0 ? targetSize / largest : 1;
      obj.scale.setScalar(s);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
      obj.position.sub(center);
      return obj;
    };

    const wrap = (scene: THREE.Object3D, name: PartName) => {
      const fitted = new THREE.Group();
      fitted.name = `part:${name}`;
      normalize(scene, config.length * PART_TARGET_SIZE[name] * config.parts[name].scale);
      fitted.add(scene);
      return fitted;
    };

    const names = (["body", "hood", "doorL", "doorR", "wheel"] as PartName[])
      .filter((n) => typeof parts[n] === "string");
    const scenes = await Promise.all(names.map((n) => load(parts[n]!)));

    names.forEach((name, i) => {
      const part = wrap(scenes[i], name);
      if (name === "wheel") {
        config.wheels.forEach((w) => {
          const clone = part.clone(true);
          clone.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.material = Array.isArray(o.material)
                ? o.material.map((m: THREE.Material) => m.clone())
                : (o.material as THREE.Material).clone();
            }
          });
          clone.position.copy(vec(w.position));
          clone.rotation.set(...w.rotation);
          assembly.partsRoot.add(clone);
          assembly.wheelClones.push(clone);
        });
        return;
      }

      const fit = config.parts[name];
      const hingeFit =
        name === "hood" ? config.hinges.hood :
        name === "doorL" ? config.hinges.doorL :
        name === "doorR" ? config.hinges.doorR : null;

      if (hingeFit) {
        const pivot = new THREE.Group();
        pivot.name = `hinge:${name}`;
        pivot.position.copy(vec(hingeFit.pivot));
        part.position.copy(vec(fit.position)).sub(pivot.position);
        part.rotation.set(...fit.rotation);
        pivot.add(part);
        assembly.partsRoot.add(pivot);
        assembly.hinges[name as "hood" | "doorL" | "doorR"] = pivot;
        assembly.parts[name] = part;
      } else {
        part.position.copy(vec(fit.position));
        part.rotation.set(...fit.rotation);
        assembly.partsRoot.add(part);
        assembly.parts[name] = part;
      }
    });

    const box = new THREE.Box3().setFromObject(assembly.partsRoot);
    assembly.partsRoot.position.y -= box.min.y;
    // hover cars rest above the ground with an idle bob applied in update()
    assembly.partsRoot.position.y += config.hover ?? 0;
    assembly.partsRoot.userData.restY = assembly.partsRoot.position.y;
  }

  /**
   * Clearly-labeled temporary proxy shown only while an era's Mint pack has
   * not been delivered.
   */
  private buildPlaceholder(assembly: CarAssembly) {
    const era = ERAS.find((e) => e.key === assembly.key);
    const paint = new THREE.MeshStandardMaterial({
      color: new THREE.Color(era?.paint ?? "#888"),
      roughness: 0.4, metalness: 0.35,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.8 });

    const L = assembly.config.length;
    const bodyGroup = new THREE.Group();
    bodyGroup.name = "part:body";
    const lower = new THREE.Mesh(new THREE.BoxGeometry(L * 0.4, 0.42, L), paint);
    lower.position.y = 0.42;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(L * 0.36, 0.34, L * 0.52), paint);
    upper.position.set(0, 0.8, -L * 0.06);
    bodyGroup.add(lower, upper);
    [lower, upper].forEach((mesh) => (mesh.castShadow = true));
    assembly.partsRoot.add(bodyGroup);
    assembly.parts.body = bodyGroup;

    for (const sx of [1, -1]) {
      const wf = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.2, 24), dark);
      wf.rotation.z = Math.PI / 2;
      wf.position.set(sx * L * 0.2, 0.31, L * 0.31);
      const wr = wf.clone();
      wr.position.z = -L * 0.31;
      assembly.partsRoot.add(wf, wr);
    }

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = "#ffffff";
    ctx.font = "500 30px monospace";
    ctx.textAlign = "center";
    ctx.fillText("PLACEHOLDER", 256, 40);
    ctx.font = "20px monospace";
    ctx.fillText("awaiting generated model", 256, 72);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.set(1.9, 0.36, 1);
    sprite.position.y = 1.7;
    assembly.partsRoot.add(sprite);
  }

  private collectMaterials(assembly: CarAssembly) {
    const eraPaint = new THREE.Color(
      ERAS.find((e) => e.key === assembly.key)?.paint ?? "#888888",
    );
    assembly.partsRoot.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m: THREE.Material) => {
        if (!(m instanceof THREE.MeshStandardMaterial)) return;
        const inWheel = assembly.wheelClones.some((w) => this.isDescendantOf(o, w));
        if (inWheel) {
          assembly.wheelMaterials.push(m);
          return;
        }
        const d =
          Math.abs(m.color.r - eraPaint.r) +
          Math.abs(m.color.g - eraPaint.g) +
          Math.abs(m.color.b - eraPaint.b);
        if (m.opacity >= 0.99 && !m.transparent && d < 0.55) {
          assembly.paintMaterials.push(m);
        }
      });
    });
  }

  private isDescendantOf(obj: THREE.Object3D, root?: THREE.Object3D | THREE.Group) {
    if (!root) return false;
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur === root) return true;
      cur = cur.parent;
    }
    return false;
  }

  private computeExplodeVectors(assembly: CarAssembly) {
    const center = new THREE.Vector3(0, 0.7, 0);
    const record = (g: THREE.Group, boost = 1, lift = 0) => {
      const box = new THREE.Box3().setFromObject(g);
      if (box.isEmpty()) return;
      const c = box.getCenter(new THREE.Vector3());
      const dir = c.sub(center);
      dir.y = Math.max(dir.y, 0.1) + lift;
      dir.normalize().multiplyScalar(boost);
      assembly.explodeVectors.set(g, dir);
      g.userData.basePos = g.position.clone();
    };
    if (assembly.hinges.hood) record(assembly.hinges.hood, 1.1, 0.8);
    if (assembly.hinges.doorL) record(assembly.hinges.doorL, 1.25);
    if (assembly.hinges.doorR) record(assembly.hinges.doorR, 1.25);
    assembly.wheelClones.forEach((w) => record(w, 1.0));
    const body = assembly.parts.body;
    if (body) body.userData.baseY = body.position.y;
  }

  private buildFinaleLights() {
    ERAS.forEach((era, i) => {
      const light = new THREE.SpotLight(
        new THREE.Color(era.accent), 0, 0, Math.PI / 5.5, 0.5, 1.7,
      );
      const station = Turntable.stationTransform(i);
      light.position.set(station.position.x, 6.2, station.position.z);
      light.target.position.copy(station.position);
      // Start hidden. three.js includes any VISIBLE light in every material's
      // shader regardless of intensity, so leaving these at intensity 0 still
      // cost nine spot-light evaluations per fragment across the whole scene.
      light.visible = false;
      this.turntable.group.add(light, light.target);
      this.finaleLights.push(light);
    });
  }

  // ---------- public state API ----------

  get keys() {
    return [...this.assemblies.keys()];
  }

  isPlaceholder(key: string) {
    return this.assemblies.get(key)?.placeholder ?? true;
  }

  partWorldPosition(key: string, part: "hood" | "doorL" | "doorR", out: THREE.Vector3) {
    const a = this.assemblies.get(key);
    const node = a?.hinges[part] ?? a?.parts[part];
    if (!node) return null;
    return node.getWorldPosition(out);
  }

  setDoors(key: string, open: boolean) {
    const a = this.assemblies.get(key);
    if (a) a.doorsTarget = open ? 1 : 0;
  }

  toggleDoors(key: string) {
    const a = this.assemblies.get(key);
    if (a) a.doorsTarget = a.doorsTarget > 0.5 ? 0 : 1;
    return (a?.doorsTarget ?? 0) > 0.5;
  }

  setExplode(key: string, on: boolean) {
    const a = this.assemblies.get(key);
    if (a) a.manualTarget = on ? 1 : 0;
  }

  /** aerial ring framing amount, shared by the hero intro and the finale */
  setReveal(t: number) {
    this.revealT = t;
    this.mode = t > 0 ? "reveal" : "scroll";
  }

  /** hero-only: how much of the opening plate spin is still applied */
  setIntro(t: number) {
    this.introT = t;
  }

  setPaint(hex: string) {
    const a = this.assemblies.get("car-2026");
    a?.paintMaterials.forEach((m) => m.color.set(hex));
  }

  setWheelFinish(hex: string) {
    const a = this.assemblies.get("car-2026");
    a?.wheelMaterials.forEach((m) => m.color.set(hex));
  }

  /**
   * Staggered assembly: e is the car's explode amount (1 = hovering apart,
   * 0 = assembled). Wheels seat first; doors and hood land last.
   */
  private partFactor(e: number, kind: "wheel" | "panel") {
    const t = kind === "wheel"
      ? THREE.MathUtils.clamp((e - 0.35) / 0.65, 0, 1)
      : THREE.MathUtils.clamp(e / 0.9, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** drive per-frame animation. eraFloat comes from the scroll timeline. */
  update(dt: number, eraFloat: number) {
    this.elapsed += dt;
    if (this.introT > 0) {
      if (this.introT >= INTRO_PARKED) {
        // Parked at the top: the wheel simply turns, accumulating freely.
        // Negative, i.e. the same clockwise direction the chapters turn
        // (the plate runs to -eraFloat·60°), so the opening spin and the
        // scroll-through never reverse against each other.
        this.introSpinAngle -= dt * INTRO_SPIN_RATE;
        this.introSpinTarget = null;
        this.turntable.introSpin = this.introSpinAngle;
      } else {
        // Scrolling away. Carry on clockwise to the next aligned orientation,
        // latched once so it can't drift mid-descent. This used to scale the
        // accumulated angle to zero, which rewound the whole thing backwards
        // — a minute on the landing page meant one and a half reverse
        // revolutions before chapter 1 arrived.
        if (this.introSpinTarget === null) {
          // How far the plate sits above the next alignment clockwise.
          const ahead = ((this.introSpinAngle % TAU) + TAU) % TAU;
          const toNext = Math.min(ahead, TAU - ahead);
          this.introSpinTarget =
            toNext <= INTRO_SETTLE_BACK
              // Already within a hair of an alignment (a fresh page scrolled
              // straight away): settle onto the nearest one rather than take
              // a whole pointless lap to reach the next.
              ? this.introSpinAngle - (ahead <= INTRO_SETTLE_BACK ? ahead : ahead - TAU)
              // Otherwise keep going clockwise to the alignment below.
              : this.introSpinAngle - ahead;
        }
        const t = 1 - this.introT / INTRO_PARKED;
        this.turntable.introSpin =
          this.introSpinAngle + (this.introSpinTarget - this.introSpinAngle) * t;
      }
    } else if (this.introSpinAngle !== 0 || this.introSpinTarget !== null) {
      // Landed: the target was a whole number of turns, so zero is the same
      // orientation the descent just arrived at.
      this.introSpinAngle = 0;
      this.introSpinTarget = null;
      this.turntable.introSpin = 0;
    }
    this.turntable.setEra(eraFloat);
    if (this.mode === "reveal" && this.introT <= 0) {
      // Same unwinding contract as the intro spin. This used to add straight
      // into turntable.finaleSpin and never come back, so lingering in the
      // finale and scrolling up left every car permanently off its station.
      this.finaleSpinAngle += dt * FINALE_SPIN_RATE;
      this.turntable.finaleSpin = this.finaleSpinAngle * this.revealT;
    } else if (this.finaleSpinAngle !== 0) {
      this.finaleSpinAngle = 0;
      this.turntable.finaleSpin = 0;
    }

    this.assemblies.forEach((a) => {
      const centered = this.mode === "scroll" && Math.abs(a.index - eraFloat) < 0.35;

      // Cars always ride the plate fully assembled. Only the deliberate
      // "Explode" control takes the centered car apart.
      a.manualExplode = THREE.MathUtils.damp(a.manualExplode, a.manualTarget, 5, dt);
      const e = centered ? a.manualExplode : 0;

      a.explodeVectors.forEach((dir, g) => {
        const base = g.userData.basePos as THREE.Vector3;
        const kind = a.wheelClones.includes(g) ? "wheel" : "panel";
        const f = this.partFactor(e, kind);
        g.position.copy(base).addScaledVector(
          dir,
          f * a.config.explode * EXPLODE_AMPLITUDE,
        );
      });
      const body = a.parts.body;
      if (body && body.userData.baseY !== undefined) {
        body.position.y =
          (body.userData.baseY as number) + this.partFactor(e, "panel") * 0.32;
      }

      // --- doors/hood; cars quietly close when not centered ---
      if (!centered && this.mode === "scroll") a.doorsTarget = 0;
      if (!centered) a.manualTarget = 0;
      a.doorsOpen = THREE.MathUtils.damp(a.doorsOpen, a.doorsTarget, 6, dt);
      const applyHinge = (
        h: THREE.Group | undefined,
        hinge: { axis: [number, number, number]; angle: number },
      ) => {
        if (!h) return;
        // scratch vector, normalised in place: this ran 18 times a frame and
        // allocated a Vector3 each time, for axes that never change
        SCRATCH_AXIS.set(...hinge.axis).normalize();
        h.quaternion.setFromAxisAngle(SCRATCH_AXIS, hinge.angle * a.doorsOpen);
      };
      applyHinge(a.hinges.hood, a.config.hinges.hood);
      applyHinge(a.hinges.doorL, a.config.hinges.doorL);
      applyHinge(a.hinges.doorR, a.config.hinges.doorR);

      // --- hover idle bob ---
      if ((a.config.hover ?? 0) > 0 && a.partsRoot.userData.restY !== undefined) {
        const rest = a.partsRoot.userData.restY as number;
        a.partsRoot.position.y = this.reduced
          ? rest
          : rest + Math.sin(this.elapsed * HOVER_BOB_SPEED) * HOVER_BOB_AMPLITUDE;
      }

    });

    // Toggle visibility, not just intensity — an invisible light is dropped
    // from the shader entirely, a zero-intensity one is not.
    const ringLit = this.mode === "reveal" && this.revealT > 0.001;
    this.finaleLights.forEach((l) => {
      l.visible = ringLit;
      if (ringLit) l.intensity = this.revealT * 300;
    });
  }

  dispose() {
    this.assemblies.forEach((a) => disposeObject3D(a.root));
    this.assemblies.clear();
  }
}
