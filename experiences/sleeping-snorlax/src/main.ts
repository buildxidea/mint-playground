import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createEnvironment, type Environment } from "./scene/environment";
import { loadSnorlax, type Snorlax } from "./scene/snorlax";
import { createSnoreBubble, type SnoreBubble } from "./scene/snoreBubble";
import { createGroundImpact, type GroundImpact } from "./scene/groundImpact";
import { createPokeSystem, type PokeSystem } from "./interaction/poke";
import { DEFAULT_GROWTH, type GrowthSettings } from "./scene/growth";
import { createAudio } from "./audio";
import { createScore } from "./score";
import { createUi } from "./ui";

const GROWTH_STORAGE_KEY = "snorlax-growth-settings";
const MUTE_STORAGE_KEY = "snorlax-muted";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** Remember how the animation should play, but never his size — that resets. */
function loadGrowthSettings(): GrowthSettings {
  try {
    const raw = localStorage.getItem(GROWTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GrowthSettings>;
      return {
        when: parsed.when === "landing" ? "landing" : "sitting",
        feel: parsed.feel === "smooth" || parsed.feel === "pumps" ? parsed.feel : "balloon",
      };
    }
  } catch {
    // Blocked or corrupt storage is not worth failing over.
  }
  return { ...DEFAULT_GROWTH };
}

let growthSettings = loadGrowthSettings();

let startMuted = false;
try {
  startMuted = localStorage.getItem(MUTE_STORAGE_KEY) === "true";
} catch {
  startMuted = false;
}

const audio = createAudio({ muted: startMuted });

const ui = createUi(document.body, {
  growth: growthSettings,
  onGrowthChange: (settings) => {
    growthSettings = settings;
    snorlax?.setGrowthSettings(settings);
    try {
      localStorage.setItem(GROWTH_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Not remembering the choice is not worth failing over.
    }
  },
  muted: startMuted,
  onMuteChange: (muted) => {
    // Clicking the button is itself the gesture browsers want.
    audio.unlock();
    audio.setMuted(muted);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
    } catch {
      // Not remembering the choice is not worth failing over.
    }
  },
});

// Mounts into the top column beneath the poke prompt. Deliberately not
// persisted: a refresh starts a fresh run, like his size.
const score = createScore(ui.topSlot);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
app.append(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 2000);
camera.position.set(0, 6, 22);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.2;
// The camera orbits Snorlax and never leaves him: panning would slide the
// target off him, so it stays off.
controls.enablePan = false;

const environment: Environment = createEnvironment(scene);
const groundY = environment.groundHeightAt(0, 0);

let snorlax: Snorlax | null = null;
let bubble: SnoreBubble | null = null;
let pokeSystem: PokeSystem | null = null;
const groundImpact: GroundImpact = createGroundImpact(scene);
let loadFailed = false;

function fail(message: string, error: unknown) {
  // Latch the first fatal loading error; later progress must not replace it.
  if (loadFailed) return;
  loadFailed = true;
  console.error(message, error);
  ui.setStatus(message, "error");
}

/**
 * Rests him on the highest ground under his footprint. As he grows he covers
 * more terrain, so planting him on a single sampled height would let hills poke
 * through him.
 */
const FOOTPRINT_SAMPLES: [number, number][] = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
];

function replantSnorlax(model: Snorlax) {
  const halfWidth = model.restFootprint.width / 2;
  const halfDepth = model.restFootprint.depth / 2;
  let highest = -Infinity;
  for (const [dx, dz] of FOOTPRINT_SAMPLES) {
    highest = Math.max(highest, environment.groundHeightAt(dx * halfWidth, dz * halfDepth));
  }
  // Nestle him into the grass rather than resting exactly on the ground plane,
  // which reads as hovering over it.
  model.root.position.y = highest - model.restHeight * 0.07;
}

async function addSnorlax() {
  ui.setStatus("Snorlax is settling in…");
  try {
    const loaded = await loadSnorlax();
    // Sculpted facing +Z, but lying down tips that away from the camera — the
    // default view was of the soles of his feet, with his face on the far side.
    // Turning him puts his face, belly and arms toward the viewer.
    loaded.root.rotation.y = Math.PI;
    loaded.root.position.set(0, groundY, 0);
    replantSnorlax(loaded);
    scene.add(loaded.root);

    snorlax = loaded;
    loaded.setGrowthSettings(growthSettings);
    bubble = createSnoreBubble(loaded.bubbleAnchor, { size: loaded.sitHeight * 0.16 });
    loaded.onWake = () => {
      if (bubble?.pop()) audio.playPop();
    };
    loaded.onImpact = () => {
      groundImpact.burst(new THREE.Vector3(0, groundY + 0.05, 0), loaded.restFootprint.width * 0.75);
      // The bigger he is, the slower and deeper he lands.
      audio.playThud(1 / Math.pow(loaded.growth, 0.3));
    };
    pokeSystem = createPokeSystem({
      dom: renderer.domElement,
      camera,
      scene,
      snorlax: loaded,
      bubble,
      onPoke: (worldPoint) => {
        const gained = score.registerPoke();
        // Project the hit back to the screen so the "+N" appears exactly where
        // you touched him, wherever on his body that was.
        const projected = worldPoint.clone().project(camera);
        score.showGain(
          (projected.x * 0.5 + 0.5) * window.innerWidth,
          (-projected.y * 0.5 + 0.5) * window.innerHeight,
          gained,
        );
        // He has been poked, so the prompt has served its purpose.
        ui.quietHint();
      },
    });

    // Frame him: he is a big creature, so back off proportionally to his size.
    controls.target.set(0, groundY + loaded.sitHeight * 0.2, 0);
    camera.position.set(0, groundY + loaded.sitHeight * 0.5, loaded.sitHeight * 2.0);
    controls.minDistance = loaded.sitHeight * 0.75;
    controls.maxDistance = loaded.sitHeight * 4.5;

    ui.clearStatus();
    ui.showHint();
  } catch (error) {
    fail("Snorlax could not be woken up — the model failed to load.", error);
  }
}

void addSnorlax();

renderer.domElement.addEventListener("pointerdown", () => {
  controls.autoRotate = false;
  // Browsers will not start audio until the viewer interacts with the page.
  audio.unlock();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// As he inflates, ease the camera outward so he stays framed. Scaling the
// existing offset rather than re-framing keeps whatever orbit angle and zoom
// the viewer has chosen.
let lastGrowth = 1;
const cameraOffset = new THREE.Vector3();

function followGrowth(model: Snorlax) {
  const growth = model.growth;
  if (Math.abs(growth - lastGrowth) < 1e-4) return;
  const ratio = growth / lastGrowth;
  lastGrowth = growth;

  cameraOffset.copy(camera.position).sub(controls.target).multiplyScalar(ratio);
  controls.target.set(0, groundY + model.sitHeight * 0.2, 0);
  camera.position.copy(controls.target).add(cameraOffset);
  controls.minDistance *= ratio;
  controls.maxDistance *= ratio;
  replantSnorlax(model);
}

/**
 * He snores on some breaths, not every one — a snore on every exhale turns into
 * a metronome. Only while actually asleep, and deeper the bigger he is.
 */
let previousBreath = 0;
function maybeSnore(model: Snorlax) {
  const phase = model.breathPhase;
  const exhaled = previousBreath < 0.5 && phase >= 0.5;
  previousBreath = phase;
  if (!exhaled || model.isWaking) return;
  if (Math.random() < 0.45) audio.playSnore(1 / Math.pow(model.growth, 0.25));
}

const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);

  environment.update(dt);
  if (snorlax) {
    snorlax.update(dt);
    followGrowth(snorlax);
    maybeSnore(snorlax);
    bubble?.update(dt, snorlax.breathPhase, snorlax.annoyance);
    ui.setAnnoyance(snorlax.annoyance);
    ui.setGrowth(snorlax.growth);
  }
  pokeSystem?.update(dt);
  score.update(dt);
  groundImpact.update(dt);
  controls.update();
  renderer.render(scene, camera);
});
