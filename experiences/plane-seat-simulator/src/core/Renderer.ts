import * as THREE from "three";

/** Sole owner of the WebGLRenderer, canvas sizing, and DPR. */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private onResize: () => void;

  constructor(private container: HTMLElement, private camera: THREE.PerspectiveCamera) {
    this.gl = new THREE.WebGLRenderer({ antialias: true });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.canvas = this.gl.domElement;
    this.canvas.id = "scene-canvas";
    container.appendChild(this.canvas);
    this.onResize = () => this.resize();
    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(scene: THREE.Scene) {
    this.gl.render(scene, this.camera);
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.gl.dispose();
    this.canvas.remove();
  }
}
