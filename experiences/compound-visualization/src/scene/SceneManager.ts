import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";

/**
 * Single owner of the renderer, scene, camera, controls, label renderer,
 * animation loop, resize handling, and disposal.
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly controls: OrbitControls;
  /** Everything belonging to the current molecule hangs off this group. */
  readonly molecule = new THREE.Group();

  private raf = 0;
  private readonly container: HTMLElement;
  private readonly onFrame: (() => void)[] = [];
  private readonly resizeObserver: ResizeObserver;
  private keyLight!: THREE.DirectionalLight;
  private ground!: THREE.Mesh;
  private lights: THREE.Light[] = [];
  private baseIntensities: number[] = [];
  private baseEnvIntensity = 1;

  constructor(canvas: HTMLCanvasElement, labelHost: HTMLElement) {
    this.container = canvas.parentElement ?? document.body;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0); // transparent; grid shows through
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Scene background stays null so the CSS grid backdrop is visible.
    this.scene.background = null;

    // Soft studio environment so glossy/metallic atom finishes get real
    // reflections; kept low-intensity so matte finishes stay matte.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(0, 0, 12);

    this.labelRenderer = new CSS2DRenderer({ element: labelHost });
    this.labelRenderer.domElement.style.position = "absolute";
    this.labelRenderer.domElement.style.top = "0";
    this.labelRenderer.domElement.style.left = "0";
    this.labelRenderer.domElement.style.pointerEvents = "none";

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.9;

    this.scene.add(this.molecule);
    this.addLights();
    this.addGround();

    window.addEventListener("resize", this.resize);
    // The container may gain its size after construction (e.g. when a hidden
    // pane becomes visible); observe it so the canvas always fits.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  private addLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.62);
    this.scene.add(ambient);
    // Soft sky/ground fill lifts the shaded side of atoms without flattening.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd2d9e4, 0.45);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.55);
    key.position.set(5, 10, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    this.keyLight = key;
    const fill = new THREE.DirectionalLight(0xdbe4f0, 0.6);
    fill.position.set(-8, -4, -6);
    this.scene.add(fill);

    // Remember the authored intensities so brightness scales relative to them.
    this.lights = [ambient, hemi, key, fill];
    this.baseIntensities = this.lights.map((l) => l.intensity);
    this.baseEnvIntensity = this.scene.environmentIntensity;
  }

  /** Scale every light (and the environment) relative to its authored value. */
  setBrightness(multiplier: number): void {
    this.lights.forEach((l, i) => {
      l.intensity = this.baseIntensities[i] * multiplier;
    });
    this.scene.environmentIntensity = this.baseEnvIntensity * multiplier;
  }

  private addGround(): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShadowMaterial({ opacity: 0.22 });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  /** Position the shadow plane under the molecule and fit the shadow camera. */
  updateGround(radius: number): void {
    const r = Math.max(radius, 1);
    this.ground.position.y = -r * 1.02;
    this.ground.scale.set(r * 8, r * 8, 1);

    const cam = this.keyLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -r * 1.6;
    cam.right = r * 1.6;
    cam.top = r * 1.6;
    cam.bottom = -r * 1.6;
    cam.near = 0.1;
    cam.far = r * 40;
    cam.updateProjectionMatrix();
    // Aim the light at the molecule centre so the shadow lands under it.
    this.keyLight.position.set(r * 0.6, r * 3, r * 1.2);
    this.keyLight.target.position.set(0, 0, 0);
    this.keyLight.target.updateMatrixWorld();
    this.scene.add(this.keyLight.target);
  }

  onBeforeRender(cb: () => void): void {
    this.onFrame.push(cb);
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    for (const cb of this.onFrame) cb();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };

  private resize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
  };

  /** Remove and dispose every child of the molecule group. */
  clearMolecule(): void {
    disposeGroup(this.molecule);
  }

  /** Frame the camera and controls to fit a bounding sphere. */
  frameSphere(center: THREE.Vector3, radius: number): void {
    const r = Math.max(radius, 1);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (r * 1.6) / Math.sin(fov / 2);
    const dir = new THREE.Vector3(0.2, 0.15, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.1, dist - r * 4);
    this.camera.far = dist + r * 6;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 1.6;
  }

  /** Toggle the ground contact shadow. */
  setShadow(on: boolean): void {
    this.keyLight.castShadow = on;
    this.ground.visible = on;
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.container.requestFullscreen();
    }
  }

  /** Render one opaque frame on the given background and download it as PNG. */
  savePng(filename: string, bg = 0xffffff): void {
    this.renderer.setClearColor(bg, 1);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setClearColor(0x000000, 0); // restore transparency

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  makeLabel(text: string, className: string): CSS2DObject {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    return new CSS2DObject(el);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.resize);
    this.clearMolecule();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

/** Recursively remove children and free their GPU resources. */
export function disposeGroup(group: THREE.Object3D): void {
  for (const child of [...group.children]) {
    disposeGroup(child);
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mat = child.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
    if (child instanceof CSS2DObject) {
      child.element.remove();
    }
  }
}
