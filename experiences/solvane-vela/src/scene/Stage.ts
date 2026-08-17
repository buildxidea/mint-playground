import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { createGradePass } from "./GradePass";
import { Studio } from "./Studio";
import { sampleGrade } from "./EraGrades";

export type StageUpdate = (dt: number, elapsed: number) => void;

/** reused in the frame loop so it allocates nothing per frame */
const SCRATCH_SIZE = new THREE.Vector2();
const SCRATCH_TARGET = new THREE.Vector3();

/**
 * Single owner of renderer, scene, camera, composer, resize, and the frame
 * loop. Everything else registers an update callback.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly studio: Studio;

  /** continuous era position 0..5 driven by scroll */
  eraFloat = 0;
  /** 0..1 within the current handoff zone */
  handoffT = 0;
  /**
   * 0..1 aerial ring reveal — lifts ambient so the whole plate reads. Driven
   * by both the hero intro and the closing lineage shot.
   */
  revealT = 0;

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private clock = new THREE.Clock();
  private updates = new Set<StageUpdate>();
  private raf = 0;

  /**
   * Camera rig: base framing + small drift; interactions add offsets.
   * camBase sits 20% further down its own sightline than the original
   * framing, so the whole car reads with air around it rather than filling
   * the frame.
   */
  readonly camBase = new THREE.Vector3(4.26, 1.61, 5.82);
  readonly camTarget = new THREE.Vector3(0, 0.65, 0);
  camOffset = new THREE.Vector3();
  targetOffset = new THREE.Vector3();

  /**
   * Scroll input is stepped — a wheel notch is a jump, not a slide — so the
   * timeline writes these targets and the frame loop eases the live values
   * toward them. Everything downstream (plate rotation, grade, weather,
   * camera) then moves continuously instead of snapping per notch.
   */
  eraTarget = 0;
  revealTarget = 0;
  readonly camOffsetTarget = new THREE.Vector3();
  readonly targetOffsetTarget = new THREE.Vector3();
  /**
   * Easing rate; higher is snappier. The scroll timeline now smooths its own
   * read head, so this stage is deliberately quick — it exists only to take
   * the last edge off. Stacking two slow filters would just read as lag.
   * Motion-sensitive users get no easing at all.
   */
  private smoothing = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? Infinity
    : 9;
  private fog: THREE.FogExp2;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // the studio is lit for deep, saturated color — not a white showroom
    this.renderer.toneMappingExposure = 0.62;

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0x181510, 0.05);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camTarget);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.studio = new Studio();
    this.scene.add(this.studio.group);

    // The `antialias: true` above only ever applied to the default
    // framebuffer, which EffectComposer bypasses entirely — so the page had no
    // anti-aliasing at all and every edge crawled.
    //
    // MSAA on the composer target is the obvious fix but a terrible trade
    // here: measured on Intel integrated graphics, 4x samples on a half-float
    // target cost 22ms/frame on its own — more than the rest of the renderer
    // combined. SMAA is a single post pass costing ~3ms for comparable edges,
    // so the chain stays un-multisampled and resolves aliasing at the end.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // high threshold: only genuine light sources bloom, never lit surfaces
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.35, 0.96);
    this.composer.addPass(this.bloom);
    this.grade = createGradePass();
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    // last, so it anti-aliases the tone-mapped image rather than raw HDR
    this.composer.addPass(new SMAAPass());

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  onUpdate(fn: StageUpdate) {
    this.updates.add(fn);
    return () => this.updates.delete(fn);
  }

  /**
   * Jump the rig to its targets with no easing. Boot calls this after the
   * first measure so the page opens already in the aerial shot — otherwise
   * the easing would swoop up into it from the default framing on load.
   */
  snap() {
    this.eraFloat = this.eraTarget;
    this.revealT = this.revealTarget;
    this.camOffset.copy(this.camOffsetTarget);
    this.targetOffset.copy(this.targetOffsetTarget);
  }

  start() {
    this.clock.start();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      // self-heal if the window was 0-sized or resized without an event
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w > 0 && h > 0) {
        // scratch vector: this runs every frame, so don't allocate here
        const size = this.renderer.getSize(SCRATCH_SIZE);
        if (size.x !== w || size.y !== h) this.resize();
      }
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const elapsed = this.clock.elapsedTime;

      // Ease scroll-driven state toward its target before anything reads it,
      // so the grade, the plate and the camera all move together this frame.
      // damp() is frame-rate independent; Infinity smoothing snaps.
      const k = this.smoothing;
      if (k === Infinity) {
        this.eraFloat = this.eraTarget;
        this.revealT = this.revealTarget;
        this.camOffset.copy(this.camOffsetTarget);
        this.targetOffset.copy(this.targetOffsetTarget);
      } else {
        this.eraFloat = THREE.MathUtils.damp(this.eraFloat, this.eraTarget, k, dt);
        this.revealT = THREE.MathUtils.damp(this.revealT, this.revealTarget, k, dt);
        this.camOffset.x = THREE.MathUtils.damp(this.camOffset.x, this.camOffsetTarget.x, k, dt);
        this.camOffset.y = THREE.MathUtils.damp(this.camOffset.y, this.camOffsetTarget.y, k, dt);
        this.camOffset.z = THREE.MathUtils.damp(this.camOffset.z, this.camOffsetTarget.z, k, dt);
        this.targetOffset.x = THREE.MathUtils.damp(this.targetOffset.x, this.targetOffsetTarget.x, k, dt);
        this.targetOffset.y = THREE.MathUtils.damp(this.targetOffset.y, this.targetOffsetTarget.y, k, dt);
        this.targetOffset.z = THREE.MathUtils.damp(this.targetOffset.z, this.targetOffsetTarget.z, k, dt);
      }

      const g = sampleGrade(this.eraFloat);
      g.ambient += this.revealT * 0.22;
      g.fogDensity *= 1 - this.revealT * 0.8;
      this.studio.applyGrade(g);
      this.fog.color.copy(g.fog);
      this.fog.density = g.fogDensity;
      this.scene.environmentIntensity = g.envIntensity + this.revealT * 0.25;
      this.bloom.strength = g.bloom;
      const u = this.grade.uniforms as Record<string, THREE.IUniform>;
      (u.tint.value as THREE.Color).copy(g.tint);
      u.tintAmount.value = g.tintAmount;
      u.mono.value = g.mono;
      u.saturation.value = g.saturation;
      u.grain.value = g.grain;
      u.vignette.value = g.vignette;
      u.time.value = elapsed;

      this.updates.forEach((fn) => fn(dt, elapsed));

      // camera rig: base + per-era micro drift + interaction offsets
      const drift = 0.06;
      this.camera.position.set(
        this.camBase.x + Math.sin(this.eraFloat * 1.7) * drift + this.camOffset.x,
        this.camBase.y + Math.cos(this.eraFloat * 1.3) * drift * 0.6 + this.camOffset.y,
        this.camBase.z + this.camOffset.z,
      );
      this.camera.lookAt(SCRATCH_TARGET.copy(this.camTarget).add(this.targetOffset));

      this.composer.render();
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const mobile = w < 900;
    const ratio = Math.min(window.devicePixelRatio, mobile ? 1.5 : 1.75);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    // EffectComposer latches the pixel ratio in its constructor, so without
    // this the post chain kept rendering at the desktop 1.75 while the canvas
    // dropped to 1.5 on phones — more shaded pixels than the canvas can show,
    // on exactly the devices least able to afford them.
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    // Bloom ran its 12 blur passes at full resolution and cost ~half the
    // frame. It is a blur — resolving it at half res is invisible in the
    // output but quarters the pixels those passes touch. Must follow
    // composer.setSize(), which would otherwise reset it to full size.
    this.bloom.setSize((w * ratio) / 2, (h * ratio) / 2);
    this.camera.aspect = w / h;
    // keep the car framed on narrow screens
    this.camera.fov = w / h < 0.8 ? 46 : 34;
    this.camera.updateProjectionMatrix();
  }
}
