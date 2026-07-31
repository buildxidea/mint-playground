import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ElementData, Settings } from './types';
import {
  SCENE_CENTER_X,
  SCENE_HALF_W,
  TableScene,
  tilePosition,
  type DetailTile,
} from './table';
import { AtomScene, buildSections } from './atom';
import { SettingsStore } from './settings';
import { AudioManager } from './audio';
import { Tweens, easeInCubic, easeInOutCubic, easeOutCubic } from './tween';

type Mode = 'table' | 'entering' | 'inside' | 'exiting';

/** Centred on the table plus the legend board standing beside it. */
const TABLE_CAM_TARGET = new THREE.Vector3(SCENE_CENTER_X, -0.3, 0);
const TAN_HALF_FOV = Math.tan((45 / 2) * (Math.PI / 180));
const BOARD_HALF_H = 8.9;

/** Rest position that fits the table and legend for the current aspect ratio. */
function tableRestPos(aspect: number): THREE.Vector3 {
  const fitWidth = SCENE_HALF_W / (TAN_HALF_FOV * aspect);
  const fitHeight = BOARD_HALF_H / TAN_HALF_FOV;
  const dist = Math.max(22.5, fitWidth, fitHeight);
  return new THREE.Vector3(SCENE_CENTER_X, -1.0, dist);
}

export class App {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private table: TableScene;
  private atom: AtomScene | null = null;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private tweens = new Tweens();
  private audio = new AudioManager();
  private settings = new SettingsStore();
  private clock = new THREE.Clock();

  private mode: Mode = 'table';
  private lowQuality: boolean;
  private hoverIndex = -1;
  private lastHoverTick = -1;
  private activeIndex = -1;
  private detail: DetailTile | null = null;
  private savedCamPos = new THREE.Vector3();
  private savedCamTarget = new THREE.Vector3();
  private pointerDown = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private tooltip = document.getElementById('tooltip')!;
  private exitBtn = document.getElementById('exit-btn')!;
  private dataSheet = document.getElementById('data-sheet')!;

  onFirstFrame: (() => void) | null = null;
  private firstFrameDone = false;

  constructor(container: HTMLElement, elements: ElementData[]) {
    this.lowQuality =
      window.matchMedia('(pointer: coarse)').matches ||
      Math.min(window.innerWidth, window.innerHeight) < 640;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowQuality ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.05,
      200
    );
    this.camera.position.set(0, -10, 34);

    const maxAtlas = this.renderer.capabilities.maxTextureSize;
    const cellPx = !this.lowQuality && maxAtlas >= 4096 ? 256 : 128;
    this.table = new TableScene(elements, cellPx);

    // studio environment for glossy/metallic finishes
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.table.scene.environment = envTex;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.applyTableControlLimits();

    this.settings.bindUI();
    this.applyAllSettings();
    this.settings.onChange((s, key) => this.applySetting(s, key));

    // input
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', (e) => this.onPointerMove(e));
    dom.addEventListener('pointerdown', (e) => this.pointerDown.set(e.clientX, e.clientY));
    dom.addEventListener('pointerup', (e) => this.onPointerUp(e));
    dom.addEventListener('pointerleave', () => this.setHover(-1));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.mode === 'inside') this.exitElement();
      // hold shift to pan with the left button; right-drag pans regardless
      if (e.key === 'Shift') this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    });
    window.addEventListener('blur', () => {
      this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    });
    this.exitBtn.addEventListener('click', () => {
      if (this.mode === 'inside') this.exitElement();
    });
    window.addEventListener('resize', () => this.onResize());

    // intro sweep to rest position
    const from = this.camera.position.clone();
    const rest = tableRestPos(this.camera.aspect);
    this.tweens.run({
      duration: 1.8,
      ease: easeInOutCubic,
      onUpdate: (v) => {
        this.camera.position.lerpVectors(from, rest, v);
      },
    });
    this.controls.target.copy(TABLE_CAM_TARGET);

    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ---- settings ----------------------------------------------------------

  private applyAllSettings(): void {
    const s = this.settings.state;
    this.applySetting(s, 'finish');
    this.applySetting(s, 'board');
    this.applySetting(s, 'background');
    this.applySetting(s, 'colorMode');
    this.applySetting(s, 'sound');
  }

  private applySetting(s: Settings, key: keyof Settings): void {
    switch (key) {
      case 'finish':
        this.table.setFinish(s.finish);
        break;
      case 'board':
        this.table.setBoard(s.board);
        break;
      case 'background':
        this.table.setBackground(s.background);
        document.documentElement.classList.toggle('light-bg', s.background === 'white');
        break;
      case 'colorMode':
        this.table.setColors(s.colorMode);
        this.table.setLegendVisible(s.colorMode === 'category');
        break;
      case 'sound':
        this.audio.setMuted(s.sound === 'off');
        break;
    }
  }

  // ---- input -------------------------------------------------------------

  private updateRaycaster(e: PointerEvent): void {
    this.pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.mode !== 'table') return;
    if (e.pointerType !== 'mouse') return;
    this.updateRaycaster(e);
    const hit = this.table.pick(this.raycaster);
    this.setHover(hit);
    if (hit >= 0) {
      const el = this.table.elements[hit];
      this.tooltip.innerHTML = `<span class="sym">${el.symbol}</span>${el.name}`;
      this.tooltip.style.left = `${e.clientX}px`;
      this.tooltip.style.top = `${e.clientY}px`;
    }
  }

  private setHover(index: number): void {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this.table.setHover(index);
    this.tooltip.classList.toggle('visible', index >= 0);
    this.renderer.domElement.style.cursor = index >= 0 ? 'pointer' : 'default';
    if (index >= 0) this.playHoverTick(index);
  }

  /**
   * Hover feedback. Sweeping the pointer crosses many tiles, so the tick is
   * rate-limited and pitched by atomic number to stay musical rather than
   * machine-gun.
   */
  private playHoverTick(index: number): void {
    const now = performance.now();
    if (now - this.lastHoverTick < 50) return;
    this.lastHoverTick = now;
    const z = this.table.elements[index].z;
    const rate = 0.94 + ((z - 1) / 117) * 0.3;
    // low-passed and cut short so it lands as a soft ploop, not a ringing note
    this.audio.play('hoverTick', 0.72, rate, 1500, 0.22);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.mode !== 'table') return;
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    if (dx * dx + dy * dy > 64) return; // drag, not a click
    this.updateRaycaster(e);
    const hit = this.table.pick(this.raycaster);
    if (hit >= 0) this.enterElement(hit);
  }

  // ---- enter / exit choreography ----------------------------------------

  private applyTableControlLimits(): void {
    this.controls.target.copy(TABLE_CAM_TARGET);
    this.controls.minDistance = 7;
    this.controls.maxDistance = Math.max(42, tableRestPos(this.camera.aspect).z + 14);
    // the table is a fixed frontal view: zoom only, aimed at the cursor
    this.controls.enableRotate = false;
    this.controls.enablePan = false;
    this.controls.zoomToCursor = true;
  }

  private applyAtomControlLimits(camDist: number): void {
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 3;
    this.controls.maxDistance = camDist + 6;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = Math.PI - 0.25;
    this.controls.enableRotate = true;
    // pan with right-drag (or two-finger drag) to inspect panels up close
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = false;
  }

  /** Keep panning inside an element on a leash so the atom is never lost. */
  private clampAtomPan(): void {
    if (!this.atom) return;
    const target = this.controls.target;
    const limit = this.atom.maxShellRadius + 4.5;
    const dist = target.length();
    if (dist <= limit) return;
    const scale = limit / dist;
    const dx = target.x * scale - target.x;
    const dy = target.y * scale - target.y;
    const dz = target.z * scale - target.z;
    target.set(target.x + dx, target.y + dy, target.z + dz);
    this.camera.position.x += dx;
    this.camera.position.y += dy;
    this.camera.position.z += dz;
  }

  private async enterElement(index: number): Promise<void> {
    if (this.mode !== 'table') return;
    this.mode = 'entering';
    this.activeIndex = index;
    this.setHover(-1);
    this.controls.enabled = false;
    this.savedCamPos.copy(this.camera.position);
    this.savedCamTarget.copy(this.controls.target);

    const el = this.table.elements[index];
    const c = tilePosition(el);
    this.audio.play('whoosh', 0.45);

    // swap the instanced tile for the openable detail tile
    this.table.hideTile(index);
    this.detail = this.table.makeDetailTile(index);

    // approach the tile
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const approachPos = new THREE.Vector3(c.x, c.y + 0.05, 2.45);
    await this.tweens.runAsync({
      duration: 1.0,
      ease: easeInOutCubic,
      onUpdate: (v) => {
        this.camera.position.lerpVectors(fromPos, approachPos, v);
        this.controls.target.lerpVectors(fromTarget, c, v);
        this.camera.lookAt(this.controls.target);
      },
    });

    // open the flap, then glide through it
    this.audio.play('flapOpen', 0.6);
    this.tweens.run({
      duration: 0.75,
      ease: easeOutCubic,
      onUpdate: (v) => this.detail?.setOpen(v),
    });

    const throughPos = new THREE.Vector3(c.x, c.y - 0.02, 0.12);
    const lookInside = new THREE.Vector3(c.x, c.y, -1.5);
    await this.tweens.runAsync({
      duration: 0.85,
      delay: 0.35,
      ease: easeInCubic,
      onUpdate: (v) => {
        this.camera.position.lerpVectors(approachPos, throughPos, v);
        const look = new THREE.Vector3().lerpVectors(c, lookInside, v);
        this.camera.lookAt(look);
      },
    });

    // we are through the opening: swap to the atom scene
    const narrow = this.camera.aspect < 0.9;
    this.atom = new AtomScene(el, this.lowQuality, this.camera.aspect, narrow);
    if (narrow) this.showDataSheet(el);
    this.setupComposer();
    const rest = new THREE.Vector3(0, 0.6, this.atom.camDistance);
    const entry = new THREE.Vector3(0, 0.9, this.atom.camDistance + 3.5);
    this.camera.position.copy(entry);
    this.camera.lookAt(0, 0, 0);
    this.audio.startAmbience(0.22);

    await this.tweens.runAsync({
      duration: 1.1,
      ease: easeOutCubic,
      onUpdate: (v) => {
        this.camera.position.lerpVectors(entry, rest, v);
        this.camera.lookAt(0, 0, 0);
      },
    });

    this.applyAtomControlLimits(this.atom.camDistance);
    this.controls.enabled = true;
    this.exitBtn.classList.add('visible');
    this.mode = 'inside';
  }

  private async exitElement(): Promise<void> {
    if (this.mode !== 'inside' || !this.atom || !this.detail) return;
    this.mode = 'exiting';
    this.controls.enabled = false;
    this.exitBtn.classList.remove('visible');
    this.dataSheet.classList.remove('visible');
    this.audio.stopAmbience();
    this.audio.play('whoosh', 0.3);

    const el = this.table.elements[this.activeIndex];
    const c = tilePosition(el);

    // back away from the atom
    const fromPos = this.camera.position.clone();
    const dir = fromPos.clone().sub(new THREE.Vector3(0, 0, 0)).normalize();
    const outPos = fromPos.clone().add(dir.multiplyScalar(3.5));
    await this.tweens.runAsync({
      duration: 0.8,
      ease: easeInCubic,
      onUpdate: (v) => {
        this.camera.position.lerpVectors(fromPos, outPos, v);
        this.camera.lookAt(0, 0, 0);
      },
    });

    // swap back to the table just inside the open flap
    this.disposeAtom();
    const insidePos = new THREE.Vector3(c.x, c.y - 0.02, 0.14);
    const pullbackPos = new THREE.Vector3(c.x, c.y + 0.05, 2.45);
    this.camera.position.copy(insidePos);
    this.camera.lookAt(c.x, c.y, 1);

    this.audio.play('flapClose', 0.6);
    this.tweens.run({
      duration: 0.7,
      delay: 0.15,
      ease: easeInOutCubic,
      onUpdate: (v) => this.detail?.setOpen(1 - v),
    });

    await this.tweens.runAsync({
      duration: 0.85,
      ease: easeOutCubic,
      onUpdate: (v) => {
        this.camera.position.lerpVectors(insidePos, pullbackPos, v);
        this.camera.lookAt(c.x, c.y, 0);
      },
    });

    // return to where the user left the table
    const fromPos2 = this.camera.position.clone();
    await this.tweens.runAsync({
      duration: 0.95,
      ease: easeInOutCubic,
      onUpdate: (v) => {
        this.camera.position.lerpVectors(fromPos2, this.savedCamPos, v);
        this.controls.target.lerpVectors(c, this.savedCamTarget, v);
        this.camera.lookAt(this.controls.target);
      },
    });

    this.detail.dispose();
    this.detail = null;
    this.table.showTile(this.activeIndex);
    this.activeIndex = -1;
    this.applyTableControlLimits();
    this.controls.target.copy(this.savedCamTarget);
    this.controls.enabled = true;
    this.mode = 'table';
  }

  /** Narrow screens: element data as a scrollable bottom sheet instead of 3D panels. */
  private showDataSheet(el: ElementData): void {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sections = buildSections(el)
      .map(
        (s) =>
          `<h4>${esc(s.title)}</h4>` +
          s.rows
            .map(
              (r) =>
                `<div class="row"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`
            )
            .join('')
      )
      .join('');
    const summary = el.summary
      ? `<p class="summary">${esc(
          el.summary.length > 300 ? el.summary.slice(0, 297).trimEnd() + '…' : el.summary
        )}</p>`
      : '';
    this.dataSheet.innerHTML = `<div class="grab"></div>${sections}${summary}`;
    this.dataSheet.scrollTop = 0;
    this.dataSheet.classList.add('visible');
  }

  // ---- rendering ---------------------------------------------------------

  private setupComposer(): void {
    if (!this.atom || this.lowQuality) return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.atom.scene, this.camera));
    // threshold sits above the text fill so bloom lifts the nucleus, not the labels
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.62,
      0.6,
      0.82
    );
    this.composer.addPass(this.bloomPass);
  }

  private disposeAtom(): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
    }
    if (this.atom) {
      this.atom.dispose();
      this.atom = null;
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Zoom-to-cursor lets the view wander laterally; ease it back toward the
   * table center as the camera zooms out so the table never strands off-screen.
   */
  private recenterTable(dt: number): void {
    const target = this.controls.target;
    const dist = this.camera.position.distanceTo(target);
    const restZ = tableRestPos(this.camera.aspect).z;
    const t = THREE.MathUtils.clamp((dist - 12) / Math.max(restZ - 12, 1), 0, 1);
    const maxOffX = (1 - t) * 10;
    const maxOffY = (1 - t) * 6.5;
    const wantX = THREE.MathUtils.clamp(
      target.x,
      TABLE_CAM_TARGET.x - maxOffX,
      TABLE_CAM_TARGET.x + maxOffX
    );
    const wantY = THREE.MathUtils.clamp(target.y - TABLE_CAM_TARGET.y, -maxOffY, maxOffY) + TABLE_CAM_TARGET.y;
    const dx = (wantX - target.x) * Math.min(dt * 6, 1);
    const dy = (wantY - target.y) * Math.min(dt * 6, 1);
    if (Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5) return;
    target.x += dx;
    target.y += dy;
    this.camera.position.x += dx;
    this.camera.position.y += dy;
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.tweens.update(dt);
    if (this.controls.enabled) this.controls.update();
    if (this.mode === 'table' && this.controls.enabled) this.recenterTable(dt);
    if (this.mode === 'inside' && this.controls.enabled) this.clampAtomPan();

    // whichever scene owns the camera right now: atom exists = atom renders
    if (this.atom) {
      this.atom.update(dt);
      if (this.composer) this.composer.render();
      else this.renderer.render(this.atom.scene, this.camera);
    } else {
      this.table.update(dt);
      this.renderer.render(this.table.scene, this.camera);
    }

    if (!this.firstFrameDone) {
      this.firstFrameDone = true;
      this.onFirstFrame?.();
    }
  }
}
