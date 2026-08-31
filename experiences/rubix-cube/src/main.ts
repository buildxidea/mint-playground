import * as THREE from "three";
import "./style.css";

import {
  BACKGROUNDS,
  BackgroundName,
  CubeSize,
  FaceId,
} from "./cube/constants";
import { loadCubieAsset, proceduralCubieTemplate } from "./cube/cubieAsset";
import { CubeView } from "./cube/geometry";
import { MoveEngine, MovePlayer } from "./cube/moves";
import { randomScramble } from "./cube/scramble";
import {
  CubeState,
  FACE_SPECS,
  Move,
  faceMove,
  invertMove,
  moveToString,
} from "./cube/state";
import { LayerDragger } from "./interaction/dragLayer";
import { createOrbit, ensureFits, frameCube } from "./interaction/orbit";
import { Hud } from "./ui/controls";
import { Landing } from "./ui/landing";
import { Sfx } from "./audio/sfx";
import { mintArtifactUrl } from "./assets/registry";
import { loadSettings, saveSettings } from "./ui/settings";
import {
  canSolve,
  describeSolveFailure,
  solveCube,
  unsupportedReason,
} from "./solver";
import { ensureTables, tablesReady } from "./solver/twoByTwo";

type Mode = "idle" | "scrambling" | "solving";

const SCRAMBLE_MS = 110;

interface Session {
  state: CubeState;
  view: CubeView;
  engine: MoveEngine;
  dragger: LayerDragger;
  player: MovePlayer;
}

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) throw new Error("Missing #app");

  const settings = loadSettings();
  applyBackground(settings.background);

  /* ------------------------------------------------------------- renderer */

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  app.append(renderer.domElement);
  // Actual sizing is owned by onResize/ResizeObserver further down.

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUNDS[settings.background]);

  const camera = new THREE.PerspectiveCamera(
    38,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  // Framing happens once the real aspect is known - see onResize below.

  // Flat, neutral lighting: no environment map, no rim light, no bloom.
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(3.2, 6, 4.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-4.5, -2.4, -3.6);
  scene.add(fill);

  /* ---------------------------------------------------------- cubie asset */

  let template: THREE.Object3D;
  let assetWarning = "";
  try {
    const asset = await loadCubieAsset();
    template = asset.template;
  } catch (error) {
    template = proceduralCubieTemplate();
    assetWarning = "Cubie model unavailable - using a basic shape.";
    console.error("Failed to load the cubie model:", error);
  }

  const orbit = createOrbit(camera, renderer.domElement);

  /* --------------------------------------------------------------- state */

  let mode: Mode = "idle";
  /** The landing overlay owns the screen until the visitor presses play. */
  let stage: "landing" | "playing" = "landing";
  let msPerMove = 180;
  let size: CubeSize = settings.size;
  let status = assetWarning || "Drag the cube to turn a layer";
  let history: Move[] = [];
  let suppressHistory = false;
  let session!: Session;

  /**
   * Layer depth armed by a digit key: 1 is the outer face, 2 the slice behind
   * it, and so on. Reset after every turn so a depth is never applied twice by
   * accident.
   */
  let armedDepth = 1;

  const sfx = new Sfx();
  sfx.setMuted(settings.muted);
  sfx.load(mintArtifactUrl("turn-asmr", "audio"));
  // Audio cannot start outside a user gesture, so unlock on the first one.
  const unlock = () => sfx.unlock();
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });

  const refresh = () => {
    hud.update({
      status,
      busy: mode !== "idle",
      canUndo: history.length > 0,
      size,
      canSolve: canSolve(size),
      solveHint: canSolve(size) ? "" : unsupportedReason(size),
      muted: sfx.muted,
      maxDepth: size,
      playback: {
        visible: mode === "solving" && session.player.isLoaded,
        playing: session.player.isPlaying,
        position: session.player.position,
        length: session.player.length,
        current: currentMove(size, session.player.all, session.player.position),
      },
    });
  };

  /** Build a cube of the given size, replacing whatever is mounted. */
  function mountCube(n: CubeSize): void {
    if (session) {
      session.dragger.dispose();
      scene.remove(session.view.group);
      session.view.dispose();
    }

    const state = new CubeState(n);
    const view = new CubeView(state, template);
    scene.add(view.group);

    const engine = new MoveEngine(state, view);
    const dragger = new LayerDragger(
      renderer.domElement,
      camera,
      view,
      engine,
      orbit,
    );
    const player = new MovePlayer(engine);

    engine.onMoveApplied = (applied) => {
      sfx.playTurn();
      if (suppressHistory) {
        suppressHistory = false;
        return;
      }
      // Undo covers the player's own turns, not scripted playback.
      if (mode === "idle") {
        history.push(applied);
        // A drag commits outside any UI event, so the HUD has to be told or
        // the Undo button would stay disabled until something else refreshed.
        refresh();
      }
    };
    player.onChange = () => refresh();

    session = { state, view, engine, dragger, player };
    history = [];
    mode = "idle";
  }

  mountCube(size);

  /* ------------------------------------------------------------------ hud */

  const hud = new Hud(
    app,
    {
      onScramble: () => {
        if (mode !== "idle") return;
        mode = "scrambling";
        session.dragger.enabled = false;
        history = [];
        session.player.load(randomScramble(size), true);
        status = "Scrambling";
        refresh();
      },

      onSolve: () => {
        if (mode !== "idle") return;
        if (!canSolve(size)) {
          status = unsupportedReason(size);
          refresh();
          return;
        }
        if (session.state.isSolved()) {
          status = "Already solved";
          refresh();
          return;
        }
        // The 2x2 table build takes a moment; show it before blocking.
        if (size === 2 && !tablesReady()) {
          status = "Preparing solver";
          refresh();
          // setTimeout rather than requestAnimationFrame: rAF is suspended in
          // a background tab, which would leave the solve hanging forever.
          setTimeout(() => {
            ensureTables();
            runSolve();
          }, 32);
          return;
        }
        runSolve();
      },

      onUndo: () => {
        if (mode !== "idle" || session.engine.isBusy) return;
        const last = history.pop();
        if (!last) return;
        suppressHistory = true;
        session.engine.play(invertMove(last), 160);
        status = "Undo";
        refresh();
      },

      onReset: () => {
        if (mode !== "idle") return;
        session.engine.cancel();
        session.state.reset();
        session.view.syncFromState();
        history = [];
        session.player.clear();
        status = "Solved";
        refresh();
      },

      onPlayToggle: () => {
        session.player.toggle();
        refresh();
      },

      onStepForward: () => {
        session.player.setPlaying(false);
        session.player.stepForward(msPerMove);
        refresh();
      },

      onStepBack: () => {
        session.player.setPlaying(false);
        session.player.stepBack(msPerMove);
        refresh();
      },

      onSpeedChange: (value) => {
        msPerMove = value;
      },

      onBackgroundChange: (value: BackgroundName) => {
        settings.background = value;
        saveSettings(settings);
        applyBackground(value);
        scene.background = new THREE.Color(BACKGROUNDS[value]);
      },

      onMuteToggle: () => {
        settings.muted = !sfx.muted;
        sfx.setMuted(settings.muted);
        saveSettings(settings);
        refresh();
      },

      onSizeChange: (value: CubeSize) => {
        if (mode !== "idle" || value === size) return;
        size = value;
        settings.size = value;
        saveSettings(settings);
        mountCube(value);
        status = `${value}x${value}`;
        refresh();

        // Start the 2x2 tables now rather than on the first Solve, so the
        // one-off build overlaps with the player looking at the cube.
        if (value === 2 && !tablesReady()) {
          setTimeout(() => ensureTables(), 250);
        }
      },
    },
    settings.background,
    settings.size,
  );

  function runSolve(): void {
    try {
      const solution = solveCube(session.state);
      mode = "solving";
      session.dragger.enabled = false;
      history = [];
      session.player.load(solution, true);
      status = `Solving in ${solution.length} moves`;
    } catch (error) {
      status = describeSolveFailure(error);
      console.error(error);
    }
    refresh();
  }

  refresh();

  /* ----------------------------------------------------------- keyboard */

  window.addEventListener("keydown", (event) => {
    if (stage !== "playing") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.code === "Space") {
      event.preventDefault();
      const button = [...app.querySelectorAll("button")].find(
        (b) => b.textContent === "Scramble",
      );
      button?.click();
      return;
    }

    // A digit arms an inner layer for the next face key: 2 R turns the slice
    // one in from the right, which is the usual "2R" big-cube notation.
    if (/^[1-9]$/.test(event.key)) {
      const depth = Number(event.key);
      if (depth > size) return;
      event.preventDefault();
      armedDepth = depth;
      status =
        depth === 1
          ? "Outer layer - press a face key"
          : `Layer ${depth} - press a face key`;
      refresh();
      return;
    }

    if (event.key === "Escape" && armedDepth !== 1) {
      armedDepth = 1;
      status = "Layer reset to outer";
      refresh();
      return;
    }

    const letter = event.key.toUpperCase();
    if (!(letter in FACE_SPECS)) return;
    if (mode !== "idle" || session.engine.isBusy) return;

    event.preventDefault();
    const depth = armedDepth;
    armedDepth = 1;
    const turn = faceMove(size, letter as FaceId, event.shiftKey ? "'" : "", depth - 1);
    session.engine.play(turn, 150);
    status = moveToString(size, turn);
    refresh();
  });

  /* -------------------------------------------------------------- resize */

  // A ResizeObserver rather than a window listener: the renderer is created
  // before the model finishes loading, so a resize during that await would be
  // missed entirely and the canvas would stay at its initial size. The
  // observer fires once on observe, which self-corrects whatever it inherits.
  /**
   * Push the cube to the right of frame while the landing is up, so the copy
   * on the left sits on clean background. setViewOffset shifts the rendered
   * window rather than moving the cube or the orbit target, so the cube is
   * still centred on its own axis and nothing about the scene changes.
   */
  const applyHeroOffset = () => {
    const width = Math.max(1, app.clientWidth || window.innerWidth);
    const height = Math.max(1, app.clientHeight || window.innerHeight);
    if (stage === "landing" && width > 760) {
      camera.setViewOffset(width, height, -width * 0.17, 0, width, height);
    } else {
      camera.clearViewOffset();
    }
  };

  let sizedTo = [0, 0];

  const onResize = () => {
    const width = Math.max(1, app.clientWidth || window.innerWidth);
    const height = Math.max(1, app.clientHeight || window.innerHeight);
    sizedTo = [width, height];
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    applyHeroOffset();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, true);
    // A narrower or shorter window can clip the cube; push out if so.
    ensureFits(camera);
    orbit.update();
  };

  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(app);
  window.addEventListener("resize", onResize);
  onResize();

  // Now that the aspect is real, place the camera.
  frameCube(camera);
  orbit.update();

  /* ------------------------------------------------------------- landing */

  document.body.dataset.stage = "landing";
  // The hero reads better as a puzzle mid-solve than a solved cube.
  session.state.applyMoves(randomScramble(size));
  session.view.syncFromState();
  session.dragger.enabled = false;
  orbit.autoRotate = true;
  orbit.autoRotateSpeed = 0.8;
  // Always dark behind the landing, whatever background the visitor saved.
  scene.background = new THREE.Color(BACKGROUNDS.black);
  applyBackground("black");
  applyHeroOffset();

  new Landing(app, {
    onPlay: (picked) => {
      stage = "playing";
      document.body.dataset.stage = "playing";
      orbit.autoRotate = false;
      applyHeroOffset(); // stage is "playing" now, so this clears the offset
      applyBackground(settings.background);
      scene.background = new THREE.Color(BACKGROUNDS[settings.background]);

      if (picked && picked !== size) {
        size = picked;
        settings.size = picked;
        saveSettings(settings);
        mountCube(picked);
        session.state.applyMoves(randomScramble(picked));
        session.view.syncFromState();
      }

      session.dragger.enabled = true;
      status = "Drag the cube to turn a layer";
      refresh();
    },
  });

  /* ---------------------------------------------------------------- loop */

  /** One frame of simulation. Extracted so it can be driven in tests. */
  function tick(delta: number): void {
    orbit.update();
    session.engine.update(delta);

    if (mode !== "idle") {
      session.player.update(mode === "scrambling" ? SCRAMBLE_MS : msPerMove);

      if (
        session.player.isFinished &&
        !session.engine.isBusy &&
        !session.player.isPlaying
      ) {
        const finished = mode;
        mode = "idle";
        session.dragger.enabled = true;
        status =
          finished === "scrambling"
            ? "Scrambled"
            : session.state.isSolved()
              ? "Solved"
              : "Playback finished";
        if (finished === "scrambling") session.player.clear();
        refresh();
      }
    }
  }

  if (import.meta.env.DEV) {
    // Dev-only handle so the scene can be driven and inspected from the
    // console. Stripped from production builds.
    (window as unknown as Record<string, unknown>).__cube = {
      THREE,
      renderer,
      scene,
      camera,
      orbit,
      tick,
      getSession: () => session,
      getMode: () => mode,
      getStatus: () => status,
      getSize: () => size,
    };
  }

  let previous = performance.now();

  renderer.setAnimationLoop(() => {
    // Self-heal the canvas size. A page opened in a background tab can lay
    // out at zero and never deliver the resize that corrects it, leaving a
    // 1x1 canvas once the tab is finally shown. The loop only runs while the
    // page is visible, so checking here fixes it on the first visible frame.
    if (
      app.clientWidth > 0 &&
      app.clientHeight > 0 &&
      (app.clientWidth !== sizedTo[0] || app.clientHeight !== sizedTo[1])
    ) {
      onResize();
    }

    const now = performance.now();
    const delta = Math.min(now - previous, 64);
    previous = now;

    tick(delta);
    renderer.render(scene, camera);
  });
}

function applyBackground(value: BackgroundName): void {
  document.body.dataset.background = value;
}

/** Just the move about to play. The bar has no room for a whole window. */
function currentMove(n: number, moves: Move[], position: number): string {
  const move = moves[position];
  return move ? moveToString(n, move) : "";
}

main().catch((error) => {
  console.error(error);
  const fatal = document.createElement("div");
  fatal.className = "fatal";
  fatal.textContent =
    "The cube could not be started. Check the console for details.";
  document.body.append(fatal);
});
