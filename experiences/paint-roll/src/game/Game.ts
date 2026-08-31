import {
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  PlaneGeometry,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AssetError, loadWallMaterial } from '../assets/PropLibrary';
import { InputSource, type InputSnapshot } from '../core/Input';
import { Loop } from '../core/Loop';
import { RendererHost } from '../core/Renderer';
import {
  CONTACT_DEPTH,
  Roller,
  SLEEVE_WIDTH,
} from '../entities/Roller';
import { Surface } from '../entities/Surface';
import { CameraRig, createPose, type Pose } from '../systems/CameraRig';
import { Confetti } from '../systems/Confetti';
import { Hud } from '../systems/Hud';
import { Results } from '../systems/Results';
import { StrokeRecorder } from '../systems/StrokeRecorder';
import {
  CEILING_Y,
  ROOM,
  SURFACES,
  TOTAL_AREA,
  WALL_COUNT,
} from './room';
import { DEFAULT_PALETTE, linearSwatchColor } from './palette';

type GameState = 'loading' | 'playing' | 'reveal' | 'results' | 'replay';

const ROLL_SPEED = 2.2;
const ROLL_SPEED_PRECISE = 0.85;
/** Alpha laid by a dry roller: visible streaks, never enough to count as covered. */
const DRY_ALPHA = 0.13;
const REVEAL_SECONDS = 2.6;
const REPLAY_SPEED = 9;
/** Well outside the room, so nothing is masked during normal play. */
const NO_WIPE = -1e6;

export class Game {
  private readonly host: RendererHost;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly input = new InputSource();
  private readonly loop: Loop;
  private readonly confetti = new Confetti();
  private readonly recorder = new StrokeRecorder();

  private readonly hud: Hud;
  private readonly results: Results;

  private state: GameState = 'loading';
  private surfaces: Surface[] = [];
  private roomRoot: Group | null = null;
  private roller: Roller | null = null;

  /** Which surface the roller is on, and where on it, in metres. */
  private surfaceIndex = 0;
  private u = 0;
  private v = 0;
  private previousU: number | null = null;
  private previousV: number | null = null;

  private paintLoad: number = ROOM.capacity;
  private refills = 0;
  private refilling = false;
  private wasRefilling = false;
  private elapsedMs = 0;
  private swatchIndex = 0;
  private readonly coloursUsed = new Set<number>();

  private revealTimer = 0;
  private replayTime = 0;
  private replayCursor = 0;
  private replayHold = 0;

  private readonly desiredPose: Pose = createPose();
  private readonly scratchContact = new Vector3();
  private readonly scratchNormal = new Vector3();
  private readonly scratchSleeve = new Vector3();
  private readonly paletteColours: Color[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
    private readonly statusElement: HTMLElement,
  ) {
    this.host = new RendererHost(canvas);
    this.rig = new CameraRig(this.host.aspect);

    this.buildEnvironment();

    DEFAULT_PALETTE.forEach((swatch) => {
      this.paletteColours.push(linearSwatchColor(swatch.hex));
    });

    this.hud = new Hud(this.uiRoot, DEFAULT_PALETTE, (index) => this.selectSwatch(index));
    this.results = new Results(this.uiRoot, {
      onReplay: () => this.startReplay(),
      onRestart: () => this.resetRun(),
      onWipe: (fraction) => this.applyWipe(fraction),
    });

    this.scene.add(this.confetti.points);
    this.loop = new Loop((dt) => this.step(dt), () => this.render());
    window.addEventListener('resize', this.onResize);
  }

  private buildEnvironment(): void {
    this.scene.background = new Color(0x07070b);

    const pmrem = new PMREMGenerator(this.host.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.2;
    pmrem.dispose();

    this.scene.add(new HemisphereLight(0x8fa8d8, 0x241f18, 0.3));

    // A bare bulb near the ceiling is what actually lights the room; the
    // directional is only there to keep the roller reading as a solid object.
    const bulb = new PointLight(0xffe7c2, 9, 12, 2);
    bulb.position.set(0, ROOM.height - 0.28, 0);
    bulb.castShadow = true;
    bulb.shadow.mapSize.set(1024, 1024);
    bulb.shadow.bias = -0.004;
    this.scene.add(bulb);

    const key = new DirectionalLight(0xffe9c4, 0.55);
    key.position.set(2.5, 4.5, 3.5);
    this.scene.add(key);

    const floor = new Mesh(
      new PlaneGeometry(40, 40),
      new MeshStandardMaterial({ color: 0x14141a, roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Deliberately plain rather than grimy: it closes the room in without
    // looking like a surface the player was supposed to be able to paint.
    const ceiling = new Mesh(
      new PlaneGeometry(ROOM.width, ROOM.depth),
      new MeshStandardMaterial({ color: 0x23232b, roughness: 0.9, metalness: 0 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = CEILING_Y;
    ceiling.receiveShadow = true;
    this.scene.add(ceiling);

    // The reveal pulls back outside the room, so there has to be something out
    // there. An inverted shell gives a horizon instead of a black void.
    const shell = new Mesh(
      new BoxGeometry(56, 26, 56),
      new MeshStandardMaterial({
        color: 0x121219,
        roughness: 1,
        metalness: 0,
        side: BackSide,
      }),
    );
    shell.position.y = 13 - 0.02;
    this.scene.add(shell);
  }

  async start(): Promise<void> {
    try {
      this.setStatus('Loading the room…');
      this.roller = await Roller.create();
      this.scene.add(this.roller.group);

      const root = new Group();
      this.surfaces = await Promise.all(
        SURFACES.map(async (placement) => {
          const material = await loadWallMaterial(placement.grimeKey, {
            wallWidth: placement.width,
            wallHeight: placement.height,
            textureMetres: placement.textureMetres,
          });
          return new Surface(placement, material, ROOM.paintResolution);
        }),
      );
      this.surfaces.forEach((surface) => root.add(surface.mesh));
      this.scene.add(root);
      this.roomRoot = root;

      this.setStatus(null);
      this.resetRun();
      this.loop.start();
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    // The first fatal load error is terminal for that attempt and must stay
    // visible rather than being replaced by a later progress message.
    this.loop.stop();
    this.state = 'loading';
    const detail =
      error instanceof AssetError || error instanceof Error
        ? error.message
        : String(error);
    this.statusElement.className = 'visible error';
    this.statusElement.textContent = `Could not load the game assets. ${detail}`;
    console.error(error);
  }

  private setStatus(text: string | null): void {
    if (this.statusElement.classList.contains('error')) return;
    this.statusElement.textContent = text ?? '';
    this.statusElement.className = text ? 'visible' : '';
  }

  private get current(): Surface {
    return this.surfaces[this.surfaceIndex];
  }

  private get activeColour(): Color {
    return this.paletteColours[this.swatchIndex] ?? this.paletteColours[0];
  }

  /** Area-weighted coverage across every surface in the room. */
  private get roomCoverage(): number {
    let painted = 0;
    for (const surface of this.surfaces) painted += surface.coverage * surface.area;
    return TOTAL_AREA === 0 ? 0 : painted / TOTAL_AREA;
  }

  private resetRun(): void {
    if (this.surfaces.length === 0) return;

    this.surfaces.forEach((surface) => {
      surface.clearPaint(this.host.renderer, true);
      surface.composite.setWipeWorldX(NO_WIPE);
    });
    this.recorder.reset();
    this.confetti.reset();
    this.results.setVisible(false);

    this.surfaceIndex = 0;
    this.u = SURFACES[0].width / 2;
    this.v = SURFACES[0].height * 0.45;
    this.previousU = null;
    this.previousV = null;

    this.paintLoad = ROOM.capacity;
    this.refills = 0;
    this.refilling = false;
    this.elapsedMs = 0;
    this.swatchIndex = 0;
    this.coloursUsed.clear();
    this.replayCursor = 0;
    this.replayTime = 0;

    this.hud.setVisible(true);
    this.hud.setActiveSwatch(0);
    this.hud.setCoverage(0);
    this.hud.setPrompt(null);
    if (this.roller) this.roller.group.visible = true;

    this.rig.endReveal();
    this.rig.snapTo(this.rig.wallPose(SURFACES[0], this.desiredPose));
    this.syncRoller();
    this.roller?.settle();
    this.state = 'playing';
  }

  private selectSwatch(index: number): void {
    if (index < 0 || index >= DEFAULT_PALETTE.length) return;
    this.swatchIndex = index;
    this.hud.setActiveSwatch(index);
  }

  private applyWipe(fraction: number): void {
    const worldX = -ROOM.width / 2 + fraction * ROOM.width;
    this.surfaces.forEach((surface) => surface.composite.setWipeWorldX(worldX));
  }

  private step(deltaSeconds: number): void {
    const input = this.input.sample();

    switch (this.state) {
      case 'playing':
        this.stepPlaying(deltaSeconds, input);
        break;
      case 'reveal':
        this.stepReveal(deltaSeconds);
        break;
      case 'replay':
        this.stepReplay(deltaSeconds);
        break;
      case 'results':
        if (input.restart) this.resetRun();
        this.rig.update(deltaSeconds, null);
        break;
      default:
        this.rig.update(deltaSeconds, null);
        break;
    }

    this.confetti.update(deltaSeconds);
    this.roller?.update(deltaSeconds);
  }

  private stepPlaying(deltaSeconds: number, input: InputSnapshot): void {
    if (input.restart) {
      this.resetRun();
      return;
    }
    if (input.swatch !== null) this.selectSwatch(input.swatch);

    this.elapsedMs += deltaSeconds * 1000;

    // Holding Space lifts the roller whether or not there is room for more
    // paint. Gating this on capacity made a held key alternate between
    // refilling and painting every frame, which inflated both counters wildly.
    this.refilling = input.refillKey;
    if (this.refilling) {
      const full = this.paintLoad >= ROOM.capacity - 1e-3;
      if (!this.wasRefilling && !full) this.refills += 1;
      this.paintLoad = Math.min(
        ROOM.capacity,
        this.paintLoad + (ROOM.capacity / ROOM.refillSeconds) * deltaSeconds,
      );
      // Refilling lifts the roller off the surface, so the next contact starts
      // a fresh stroke rather than drawing a line from wherever it was.
      this.previousU = null;
      this.previousV = null;
      this.recorder.liftPen();
      this.hud.setPrompt(full ? 'FULL' : 'REFILLING…');
    } else {
      this.move(deltaSeconds, input);
      this.hud.setPrompt(
        this.paintLoad <= 0.001
          ? 'OUT OF PAINT — HOLD SPACE TO REFILL'
          : this.paintLoad / ROOM.capacity < 0.25
            ? 'HOLD SPACE TO REFILL'
            : null,
      );
    }
    this.wasRefilling = this.refilling;

    this.syncRoller();
    this.updateCamera(deltaSeconds);
    this.updateHud();

    if (this.surfaces.every((surface) => surface.grid.isComplete)) {
      this.beginReveal();
    }
  }

  /** Move the roller, crossing onto the neighbouring surface when it runs off. */
  private move(deltaSeconds: number, input: InputSnapshot): void {
    if (input.moveX === 0 && input.moveY === 0) {
      // Standing still still counts as contact, so the first frame lays a stamp
      // and subsequent ones add nothing.
      this.paintTo(this.u, this.v);
      return;
    }

    const speed = input.precise ? ROLL_SPEED_PRECISE : ROLL_SPEED;
    const length = Math.hypot(input.moveX, input.moveY);
    const dx = (input.moveX / length) * speed * deltaSeconds;
    const dy = (input.moveY / length) * speed * deltaSeconds;

    const surface = this.current;
    const targetU = this.u + dx;
    const targetV = this.v + dy;

    if (surface.contains(targetU, targetV)) {
      this.paintTo(targetU, targetV);
      return;
    }

    // Paint right up to the boundary before handing over, so the corner does
    // not get a gap.
    const edgeU = Math.max(0, Math.min(surface.width, targetU));
    const edgeV = Math.max(0, Math.min(surface.height, targetV));
    this.paintTo(edgeU, edgeV);

    const crossed = this.crossEdge(targetU, targetV);
    if (!crossed) {
      this.u = edgeU;
      this.v = edgeV;
      return;
    }

    // A corner is a real discontinuity: start a new stroke on the far side.
    this.previousU = null;
    this.previousV = null;
    this.recorder.liftPen();
    this.paintTo(this.u, this.v);
    this.rig.turnTo(this.nextPose());
  }

  private nextPose(): Pose {
    return this.rig.wallPose(SURFACES[this.surfaceIndex], this.desiredPose);
  }

  /**
   * Hand the roller to the neighbouring wall. Returns false when the edge is the
   * floor or the ceiling line, which are hard stops rather than crossings.
   *
   * Vertical position carries across clamped, so running diagonally into a
   * corner still turns it instead of sticking.
   */
  private crossEdge(targetU: number, targetV: number): boolean {
    const from = this.surfaceIndex;
    const wall = SURFACES[from];
    const carriedV = Math.max(0, Math.min(wall.height, targetV));

    if (targetU > wall.width) {
      const next = (from + 1) % WALL_COUNT;
      this.surfaceIndex = next;
      this.u = Math.min(targetU - wall.width, SURFACES[next].width);
      this.v = carriedV;
      return true;
    }
    if (targetU < 0) {
      const next = (from + WALL_COUNT - 1) % WALL_COUNT;
      this.surfaceIndex = next;
      this.u = Math.max(0, SURFACES[next].width + targetU);
      this.v = carriedV;
      return true;
    }
    return false;
  }

  private paintTo(u: number, v: number): void {
    const surface = this.current;
    const dry = this.paintLoad <= 0;
    const result = surface.roll(this.previousU, this.previousV, u, v, {
      color: this.activeColour,
      alpha: dry ? DRY_ALPHA : 1,
      sleeveWidth: SLEEVE_WIDTH,
      contactDepth: CONTACT_DEPTH,
      timeMs: this.elapsedMs,
      recorder: this.recorder,
    });

    if (!dry && result.areaRolled > 0) {
      this.paintLoad = Math.max(
        0,
        this.paintLoad - result.areaRolled * ROOM.drainPerSquareMetre,
      );
      this.coloursUsed.add(this.swatchIndex);
    }

    this.u = u;
    this.v = v;
    this.previousU = u;
    this.previousV = v;
  }

  private syncRoller(): void {
    const roller = this.roller;
    if (!roller || this.surfaces.length === 0) return;

    const surface = this.current;
    const placement = surface.placement;
    surface.toWorld(this.u, this.v, this.scratchContact);
    this.scratchNormal.copy(placement.normal);

    // The sleeve lies in the surface plane, perpendicular to travel.
    const angle = surface.strokeRotation;
    this.scratchSleeve
      .copy(placement.right)
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(placement.up, Math.sin(angle))
      .normalize();

    roller.place(this.scratchContact, this.scratchNormal, this.scratchSleeve);
    roller.setPaint(this.activeColour, this.paintLoad / ROOM.capacity);
  }

  /**
   * While a quarter turn is in flight the rig owns the camera; once settled it
   * tracks the pose for whichever surface the roller is on.
   */
  private updateCamera(deltaSeconds: number): void {
    if (this.rig.isTurning) {
      this.rig.update(deltaSeconds, null);
      return;
    }
    this.rig.update(deltaSeconds, this.nextPose());
  }

  private updateHud(): void {
    this.hud.setCoverage(this.roomCoverage);
    this.hud.setPaint(this.paintLoad / ROOM.capacity, this.activeColour);
    this.surfaces.forEach((surface, index) => {
      this.hud.setSurfaceProgress(index, surface.coverage, index === this.surfaceIndex);
    });
  }

  private beginReveal(): void {
    this.state = 'reveal';
    this.revealTimer = 0;
    this.hud.setVisible(false);
    if (this.roller) this.roller.group.visible = false;

    this.rig.beginReveal();
    this.confetti.burst(
      new Vector3(0, ROOM.height * 0.5, 0),
      ROOM.width * 0.9,
      ROOM.height * 0.6,
      this.paletteColours,
    );
  }

  private stepReveal(deltaSeconds: number): void {
    this.revealTimer += deltaSeconds;
    this.rig.update(deltaSeconds, null);
    if (this.revealTimer < REVEAL_SECONDS) return;

    this.state = 'results';
    this.rig.endReveal();
    this.results.setVisible(true);
    this.refreshWipeBounds();
    this.results.showCard({
      coverage: this.roomCoverage,
      timeMs: this.elapsedMs,
      refills: this.refills,
      strokes: this.recorder.strokes,
      coloursUsed: this.coloursUsed.size,
    });
  }

  private refreshWipeBounds(): void {
    // The camera has to be settled before projecting, or the handle maps onto a
    // pose the player never sees.
    this.rig.camera.updateMatrixWorld(true);
    const { left, right } = this.rig.roomScreenBoundsX(this.host.size.width);
    this.results.setWipeBounds(left, right);
  }

  private startReplay(): void {
    this.state = 'replay';
    this.replayTime = 0;
    this.replayCursor = 0;
    this.replayHold = 0;
    this.surfaces.forEach((surface) => surface.clearPaint(this.host.renderer, false));
    this.results.setReplaying(true);
  }

  private stepReplay(deltaSeconds: number): void {
    this.rig.update(deltaSeconds, null);

    if (this.replayCursor < this.recorder.count) {
      this.replayTime += deltaSeconds * 1000 * REPLAY_SPEED;
      this.replayCursor = this.recorder.replayUntil(
        this.replayTime,
        this.replayCursor,
        this.surfaces[0].scratch,
        (surfaceIndex, stamp) => {
          const surface = this.surfaces[surfaceIndex];
          return surface ? surface.replayStamp(stamp) : true;
        },
      );
      return;
    }

    this.replayHold += deltaSeconds;
    if (this.replayHold > 0.7) {
      this.state = 'results';
      this.results.setReplaying(false);
    }
  }

  private render(): void {
    if (this.host.resize()) {
      this.rig.setAspect(this.host.aspect);
      if (this.state === 'results') this.refreshWipeBounds();
    }
    // Stamps queued during the simulation steps are drawn into the paint targets
    // before the scene that samples them.
    this.surfaces.forEach((surface) => surface.flush(this.host.renderer));
    this.host.renderer.render(this.scene, this.rig.camera);
  }

  private onResize = (): void => {
    this.host.resize();
    this.rig.setAspect(this.host.aspect);
    if (this.state === 'results') this.refreshWipeBounds();
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.loop.stop();
    this.input.dispose();
    this.results.dispose();
    this.confetti.dispose();
    this.roller?.dispose();
    this.surfaces.forEach((surface) => surface.dispose());
    if (this.roomRoot) this.scene.remove(this.roomRoot);
    this.host.dispose();
  }
}
