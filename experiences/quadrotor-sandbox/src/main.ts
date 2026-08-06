import "./style.css";
import {
  Quaternion,
  Vector3,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import { loadDroneRig, type DroneRig } from "./assets/drone";
import { loadBomberRig, type BomberRig } from "./assets/bomber";
import { loadHelicopterRig, type HelicopterRig } from "./assets/helicopter";
import { loadJetRig, type JetRig } from "./assets/jet";
import { loadPlaneRig, type PlaneRig } from "./assets/plane";
import { loadRocketRig, type RocketRig } from "./assets/rocket";
import { loadStarshipRig, type StarshipRig } from "./assets/starship";
import { RotorAudio } from "./audio/audio";
import { Engine } from "./core/engine";
import { FixedClock } from "./core/clock";
import { InputController } from "./input/input";
import { Lidar } from "./perception/lidar";
import { OccupancyGrid } from "./perception/occupancy";
import { FlightController } from "./sim/controller";
import { VEHICLE, type GainPresetId } from "./sim/config";
import { BOMBER, JET, stepAirplane, type PlaneConfig } from "./sim/airplane";
import { CrashController, type Support } from "./sim/crash";
import { GRADE_LABELS, LandingDetector } from "./sim/landing";
import {
  ROCKET,
  STARSHIP,
  createRocketState,
  propellantFraction,
  resetRocketState,
  separateBoosters,
  stepRocket,
  thrustToWeight,
  type RocketConfig,
} from "./sim/rocket";
import { makeGroundSampler, surfaceHeightAt } from "./sim/surface";
import { mix } from "./sim/mixer";
import { QUAD_HALF_EXTENTS, createPhysics } from "./sim/physics";
import { applyFlatGround, stepDynamics } from "./sim/quadrotor";
import {
  FLIGHT_MODES,
  SPAWN,
  captureSnapshot,
  createSnapshot,
  createState,
  resetState,
  type DroneState,
} from "./sim/state";
import { Wind } from "./sim/wind";
import { PostStack } from "./fx/post";
import { PropBlur } from "./fx/propblur";
import { MotionTrail } from "./fx/trail";
import { TouchdownMarker } from "./fx/touchdown";
import { createEnginePlumes } from "./fx/launch";
import { ControlsButton } from "./ui/controlsbutton";
import { CraftPicker } from "./ui/craftpicker";
import { HelpCard } from "./ui/help";
import { Hud } from "./ui/hud";
import { MuteButton } from "./ui/mute";
import { RatePlots } from "./ui/plots";
import { TuningPanel, tuneLabel } from "./ui/tuning";
import {
  CAMERA_MODES,
  ChaseCamera,
  ONBOARD_FORWARD,
  ONBOARD_RISE,
  type CameraMode,
  type Pose,
} from "./view/chase";
import { loadBackdrop } from "./world/backdrop";
import { CITY_RUNWAY_SPAWN, buildCity } from "./world/city";
import { GROUND_HALF_EXTENT, buildWorld } from "./world/scene";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;

/** Altitude the aircraft climbs to when armed in position hold, metres. */
const TAKEOFF_ALTITUDE = 1.5;

/** How long the touchdown verdict stays on screen, seconds. */
const GRADE_HOLD = 3;

/** The plane's crash-tumble collision box, metres (half-extents), and mass. */
const PLANE_HALF_EXTENTS: [number, number, number] = [0.95, 0.25, 0.7];
const PLANE_MASS = 2.2;

type VehicleId =
  | "quad"
  | "heli"
  | "plane"
  | "jet"
  | "bomber"
  | "rocket"
  | "starship";

/**
 * Everything that differs between aircraft, in one table.
 *
 * `model` is the only load-bearing distinction: the helicopter deliberately
 * shares the quadrotor's flight model and PID cascade rather than getting its
 * own — it is a different airframe wearing the same controls, which is both
 * what was asked for and one fewer controller to keep tuned. Only the
 * fixed-wing is genuinely a different flight regime.
 */
interface VehicleEntry {
  label: string;
  model: "multirotor" | "fixedWing" | "rocket";
  root: Object3D;
  groundClearance: number;
  halfExtents: [number, number, number];
  mass: number;
  /** Chase/orbit distance multiplier — tuned so each model reads on screen. */
  framing: number;
  /**
   * Onboard camera position in body coordinates, overriding the one derived
   * from the collision box.
   *
   * The derived version takes fractions of the box's half-extents, which
   * assumes a vehicle longer than it is tall whose box is roomier than the
   * hull inside it. Two craft break that and both put the camera inside their
   * own airframe: the rockets, which are taller than they are long, and the
   * flying wing, which is its own bounding box.
   */
  onboardOffset?: Vector3;
  /** Ground spawn. Omitted means the pad at the origin. */
  spawn?: { x: number; z: number };
  /**
   * Airframe for `fixedWing` vehicles. Omitted uses the bush plane's.
   */
  planeConfig?: PlaneConfig;
  /** Vehicle for `rocket` models. Omitted uses the shuttle-style stack's. */
  rocketConfig?: RocketConfig;
  /**
   * Start already flying, at this altitude and forward speed. Used by the jet,
   * whose gear is retracted — it has nothing to sit on, and a Mach-class
   * aircraft starting from a standstill on a 320 m strip is all runway and no
   * flying anyway.
   */
  spawnAirborne?: { altitude: number; speed: number };
  /** Project animated parts (rotors, exhaust) from the canonical state. */
  spin(state: DroneState, dt: number): void;
}

const VEHICLE_ORDER: VehicleId[] = [
  "quad",
  "heli",
  "plane",
  "jet",
  "bomber",
  "rocket",
  "starship",
];

/**
 * One line per craft for the chooser.
 *
 * What it is like to *fly*, not what it looks like — a grid of seven names
 * tells you nothing you did not already know from the labels, and the whole
 * point of showing them together is being able to pick on more than the name.
 */
const CRAFT_BLURBS: Record<VehicleId, string> = {
  quad: "PID cascade, three flight modes, hovers on its own",
  heli: "The quad's controls on a different airframe",
  plane: "Wings and control surfaces — stalls at 7 m/s",
  jet: "Four times the plane's speed, starts airborne",
  bomber: "Wide flying wing, no fin, slow to roll",
  rocket: "Vertical launch, finite fuel, steering needs thrust",
  starship: "Single stage — no boosters, you command all the thrust",
};

async function boot() {
  const engine = new Engine(canvas);
  const world = buildWorld(engine.scene);

  statusEl.textContent = "Loading aircraft…";

  let rig: DroneRig;
  let planeRig: PlaneRig;
  let heliRig: HelicopterRig;
  let jetRig: JetRig;
  let bomberRig: BomberRig;
  let rocketRig: RocketRig;
  let starshipRig: StarshipRig;
  let physics: Awaited<ReturnType<typeof createPhysics>>;
  try {
    // The aircraft are required; the scenery is not, so they are awaited
    // separately — a missing building pack or backdrop must not ground the
    // sandbox (the city degrades to an empty plain until its assets sync).
    const [
      loadedRig,
      loadedPlane,
      loadedHeli,
      loadedJet,
      loadedBomber,
      loadedRocket,
      loadedStarship,
      city,
    ] = await Promise.all([
      loadDroneRig(),
      loadPlaneRig(),
      loadHelicopterRig(),
      loadJetRig(),
      loadBomberRig(),
      loadRocketRig(),
      loadStarshipRig(),
      buildCity(world.yardGroup).catch((error) => {
        console.error("City failed to load", error);
        return { group: null, props: [] };
      }),
      loadBackdrop(engine.scene).catch((error) => {
        console.error("Backdrop failed to load", error);
        return null;
      }),
    ]);
    rig = loadedRig;
    planeRig = loadedPlane;
    heliRig = loadedHeli;
    jetRig = loadedJet;
    bomberRig = loadedBomber;
    rocketRig = loadedRocket;
    starshipRig = loadedStarship;
    if (city.props.length === 0) console.warn("City loaded without buildings.");

    // One shared physics world for both aircraft: every placed building is a
    // static collider, and the vehicle switch swaps the aircraft's collision
    // box in place rather than maintaining a second world (concurrently-built
    // worlds are how the handle cross-wiring bug happened).
    physics = await createPhysics(city.props, 0, {
      groundHalfExtent: GROUND_HALF_EXTENT,
    });
  } catch (error) {
    statusEl.textContent =
      error instanceof Error
        ? `Could not load the aircraft: ${error.message}`
        : "Could not load the aircraft.";
    statusEl.dataset.tone = "error";
    return;
  }
  engine.scene.add(rig.root);
  engine.scene.add(heliRig.root);
  engine.scene.add(planeRig.root);
  engine.scene.add(jetRig.root);
  engine.scene.add(bomberRig.root);
  engine.scene.add(rocketRig.root);
  engine.scene.add(starshipRig.root);

  /**
   * Give one craft's metal something to reflect.
   *
   * Applied per-material rather than through `scene.environment`, which would
   * light the ground, the city and the terrain as well and wash the whole
   * world out. Only the aircraft need it, and only because their metalness
   * maps are honest about being metal.
   */
  const lightMetal = (root: Object3D) => {
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial) continue;
        standard.envMap = engine.environmentMap;
        standard.envMapIntensity = 0.5;
        standard.needsUpdate = true;
      }
    });
  };
  for (const craft of [rig, heliRig, planeRig, jetRig, bomberRig, rocketRig, starshipRig]) {
    lightMetal(craft.root);
  }
  heliRig.root.visible = false;
  planeRig.root.visible = false;
  jetRig.root.visible = false;
  bomberRig.root.visible = false;
  rocketRig.root.visible = false;
  starshipRig.root.visible = false;
  statusEl.textContent = "";

  // --- Simulation state ---------------------------------------------------
  // Sit the aircraft on its skids, using the clearance measured from the parts
  // that actually loaded.
  const restingHeight = rig.groundClearance;
  SPAWN.y = restingHeight;

  // One canonical state, three vehicles: position, velocity, orientation and
  // body rates mean the same thing to every flight model.
  let vehicle: VehicleId = "quad";

  const state = createState();
  const previous = createSnapshot(state);
  const clock = new FixedClock(200, 5);
  const controller = new FlightController("stable");
  const wind = new Wind();
  wind.speed = 0;
  wind.gustiness = 0.25;

  let cameraMode: CameraMode = "chase";

  const crash = new CrashController();
  const landing = new LandingDetector();

  /**
   * Is a surface holding the aircraft up this step, and how fast is it moving
   * across that surface. Reused rather than reallocated at 200 Hz.
   */
  const support: Support = { supported: false, horizontalSpeed: 0 };

  // Terrain for the fixed-wing model. Reads the aircraft's altitude through a
  // getter so the probe always starts above it, wherever it currently is.
  const groundSampler = makeGroundSampler(physics, () => state.position.y);

  // --- Perception ---------------------------------------------------------
  // The sensor overlays are opt-in. Left on, the sweep starts painting glowing
  // point cloud over the scene the instant the page loads, which reads as an
  // intro animation rather than as an instrument.
  const lidar = new Lidar();
  lidar.enabled = false;
  const occupancy = new OccupancyGrid();
  occupancy.enabled = false;
  lidar.onReturn = (point) => occupancy.mark(point);
  engine.scene.add(lidar.points);
  engine.scene.add(occupancy.mesh);

  const propBlurRef = { update: (_: DroneState) => {} };

  const VEHICLES: Record<VehicleId, VehicleEntry> = {
    quad: {
      label: "Quadrotor",
      model: "multirotor",
      root: rig.root,
      groundClearance: rig.groundClearance,
      halfExtents: QUAD_HALF_EXTENTS,
      mass: VEHICLE.mass,
      framing: 0.62,
      spin(s) {
        for (let i = 0; i < rig.propellers.length; i += 1) {
          rig.propellers[i].rotation.y = s.motorAngle[i];
        }
        propBlurRef.update(s);
      },
    },
    heli: {
      label: "Helicopter",
      model: "multirotor",
      root: heliRig.root,
      groundClearance: heliRig.groundClearance,
      halfExtents: heliRig.collisionHalfExtents,
      mass: VEHICLE.mass,
      framing: 1.5,
      spin: (s) => heliRig.update(s),
    },
    plane: {
      label: "Fixed-wing",
      model: "fixedWing",
      root: planeRig.root,
      groundClearance: planeRig.groundClearance,
      halfExtents: PLANE_HALF_EXTENTS,
      mass: PLANE_MASS,
      framing: 1.8,
      spawn: CITY_RUNWAY_SPAWN,
      spin: (s) => planeRig.update(s),
    },
    jet: {
      label: "Supersonic",
      model: "fixedWing",
      root: jetRig.root,
      groundClearance: jetRig.groundClearance,
      halfExtents: jetRig.collisionHalfExtents,
      mass: JET.mass,
      // Four times the plane's speed needs the camera much further back, or
      // the city arrives faster than it can be read.
      framing: 3.4,
      planeConfig: JET,
      spawn: CITY_RUNWAY_SPAWN,
      spawnAirborne: { altitude: 220, speed: 55 },
      spin: (s, dt) => jetRig.update(s, dt),
    },
    bomber: {
      label: "Flying wing",
      model: "fixedWing",
      root: bomberRig.root,
      groundClearance: bomberRig.groundClearance,
      halfExtents: bomberRig.collisionHalfExtents,
      mass: BOMBER.mass,
      // The widest aircraft here by half a metre, so the camera sits further
      // back than the plane's but nowhere near the jet's — it is large, not
      // fast.
      framing: 2.6,
      // The generic onboard offset is a *fraction* of the collision box's
      // half-height, which assumes the box is comfortably taller than the hull
      // inside it — true for every other craft here, where the box also has to
      // contain props, skids or a tail. A flying wing has none of that: it
      // *is* its own bounding box, only 0.19 m thick, so 0.6 of its half-height
      // put the camera 4 cm inside the wing and the view was solid airframe.
      onboardOffset: new Vector3(0, 0.22, -0.05),
      planeConfig: BOMBER,
      spawn: CITY_RUNWAY_SPAWN,
      // No landing gear on the airframe, same as the jet — it has nothing to
      // roll on, so it starts in the air. Slower and lower than the jet, which
      // leaves room to bring it back down and practise the approach.
      spawnAirborne: { altitude: 200, speed: 42 },
      // Nothing on this aircraft moves.
      spin: () => {},
    },
    rocket: {
      label: "Launch stack",
      model: "rocket",
      root: rocketRig.root,
      groundClearance: rocketRig.groundClearance,
      halfExtents: rocketRig.collisionHalfExtents,
      mass: ROCKET.dryMass + ROCKET.coreProp,
      // A 14 m stack next to a 0.24 m quad: the camera has to back a long way
      // off for the whole vehicle to be in shot at all.
      framing: 7,
      // Ahead of the nose looking back down the stack, so the whole vehicle
      // and the exhaust below it are in frame on the way up.
      onboardOffset: new Vector3(0, 2.2, -8.5),
      spawn: CITY_RUNWAY_SPAWN,
      // The plumes are driven from the rocket's own thrust, not from here.
      spin: () => {},
    },
    starship: {
      label: "Starship",
      model: "rocket",
      root: starshipRig.root,
      groundClearance: starshipRig.groundClearance,
      halfExtents: starshipRig.collisionHalfExtents,
      mass: STARSHIP.dryMass + STARSHIP.coreProp,
      framing: 7,
      onboardOffset: new Vector3(0, 2.2, -9),
      rocketConfig: STARSHIP,
      spawn: CITY_RUNWAY_SPAWN,
      spin: () => {},
    },
  };

  const active = () => VEHICLES[vehicle];

  const chase = new ChaseCamera();

  /**
   * Point the camera at a vehicle: chase distance, and where the onboard view
   * sits. The onboard offset comes from the aircraft's own measured collision
   * box, so each one frames itself the same way without a hand-tuned number
   * per aircraft.
   */
  const applyCameraFor = (entry: VehicleEntry) => {
    chase.framing = entry.framing;
    if (entry.onboardOffset) chase.onboardOffset.copy(entry.onboardOffset);
    else
      chase.onboardOffset.set(
        0,
        entry.halfExtents[1] * ONBOARD_RISE,
        -entry.halfExtents[2] * ONBOARD_FORWARD,
      );
  };
  applyCameraFor(VEHICLES.quad);
  chase.reset(state);

  // --- Look and instrumentation -------------------------------------------
  const post = new PostStack(engine.renderer, engine.scene, engine.camera);
  const propBlur = new PropBlur(rig.root, rig.propellerHeight, rig.propellerDiameter);
  propBlurRef.update = (s) => propBlur.update(s);
  const trail = new MotionTrail();
  engine.scene.add(trail.line);
  const touchdownMarker = new TouchdownMarker();
  engine.scene.add(touchdownMarker.group);

  // --- Rocket ---------------------------------------------------------------
  const rocket = createRocketState();
  const corePlumes = createEnginePlumes(rocketRig.root, rocketRig.coreNozzles, 1);
  // Boosters burn far harder than the orbiter's engines, and their plumes say
  // so — this is most of what you see for the first minute of the ascent.
  const boosterPlumes = createEnginePlumes(rocketRig.root, rocketRig.boosterNozzles, 1.7);
  const starshipPlumes = createEnginePlumes(starshipRig.root, starshipRig.nozzles, 1.3);

  /** Which airframe the rocket model is currently flying. */
  const rocketConfig = () => active().rocketConfig ?? ROCKET;

  /**
   * Room below the nozzles before the flame would hit the ground, metres.
   *
   * The body origin sits at the middle of the stack, so standing vertical the
   * exhaust is half a vehicle below it — which on the pad puts the nozzles
   * exactly at ground level and every metre of plume underneath it.
   */
  const exhaustClearance = () =>
    Math.max(0, (lidar.altitudeAgl ?? state.position.y) - active().groundClearance);
  window.addEventListener("resize", () => post.resize());

  // `#overlay` is the bottom-centre HUD strip, and it carries a
  // `translateX(-50%)` to centre itself. A transformed element becomes the
  // containing block for any `position: fixed` descendant, so every panel
  // below — which all position themselves against the viewport — would anchor
  // to that little strip instead of the screen. The HUD itself belongs in
  // `#overlay`; the fixed-position panels go on `body`.
  const hud = new Hud(overlay);
  const help = new HelpCard(document.body);
  new ControlsButton(document.body, () => help.toggle());
  const plots = new RatePlots(document.body);
  const tuning = new TuningPanel(document.body, "stable", {
    onChange: (gains) => controller.applyGains(gains),
  });
  // A tune restored from the URL must reach the controller before the first step.
  controller.applyGains(tuning.current);

  const audio = new RotorAudio();
  // Browsers only allow audio to start from a real gesture; arming is the
  // first thing a pilot does, so it doubles as the unlock.
  const unlockAudio = () => void audio.resume();
  window.addEventListener("pointerdown", unlockAudio, { once: true });

  // One toggle function, so the button and the N key can never disagree about
  // what "muted" means.
  const toggleMute = () => {
    audio.muted = !audio.muted;
    void audio.resume();
    muteButton.render(audio.muted);
  };
  const muteButton = new MuteButton(document.body, toggleMute);

  /** Return the active vehicle to its spawn: pad by default, airstrip for the plane. */
  const resetVehicle = () => {
    resetState(state);
    const entry = active();
    // Identity orientation already faces -Z, down the strip.
    const spawn = entry.spawn ?? { x: SPAWN.x, z: SPAWN.z };
    if (entry.spawnAirborne) {
      state.position.set(spawn.x, entry.spawnAirborne.altitude, spawn.z);
      state.velocity.set(0, 0, -entry.spawnAirborne.speed);
      // Already flying, so it is already armed — there is no runway phase to
      // arm for, and an unarmed aircraft at 220 m is a falling brick.
      state.armed = true;
      input.centreThrottle();
    } else {
      state.position.set(spawn.x, entry.groundClearance, spawn.z);
    }
    resetRocketState(rocket, entry.rocketConfig ?? ROCKET);
    rocketRig.restore();
    boosterPlumes.setNozzles(rocketRig.boosterNozzles);
    if (entry.model === "rocket") {
      // A rocket on the pad is an airframe pitched ninety degrees nose-up.
      // Everything downstream — cameras, ground constraint, crash policy —
      // then works on it without knowing it is a rocket at all.
      state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    }
    // Hand the airframe back from Rapier before re-anchoring everything else.
    crash.reset(state, physics);
    physics.pushKinematic(state);
    controller.reset(state);
    wind.reset();
    chase.reset(state);
    // The map is the pilot's, not the aircraft's — a reset is a new flight,
    // so the survey starts over with it.
    lidar.reset();
    occupancy.reset();
    trail.reset();
    plots.reset();
    landing.reset();
    captureSnapshot(state, previous);
  };

  /**
   * Switch craft: swap the rig, the collision box and the camera framing, then
   * respawn. One path, used by both the `X` tap-cycle and the picker — two
   * copies of this is how one of them ends up forgetting the collider.
   */
  const selectVehicle = (id: VehicleId) => {
    if (id === vehicle) return;
    vehicle = id;
    const entry = active();
    for (const other of VEHICLE_ORDER) VEHICLES[other].root.visible = other === vehicle;
    physics.setAircraftShape(entry.halfExtents, entry.mass);
    applyCameraFor(entry);
    resetVehicle();
  };

  const cycleVehicle = () => {
    const next = (VEHICLE_ORDER.indexOf(vehicle) + 1) % VEHICLE_ORDER.length;
    selectVehicle(VEHICLE_ORDER[next]);
  };

  const picker = new CraftPicker(
    document.body,
    VEHICLE_ORDER.map((id) => ({
      id,
      label: VEHICLES[id].label,
      blurb: CRAFT_BLURBS[id],
    })),
  );
  // One exit path for every way out of the chooser — Enter, click, Esc, X, or
  // a click on the backdrop.
  picker.onClose = () => input.setSuspended(false);
  picker.onPick = (id) => selectVehicle(id as VehicleId);

  /**
   * Tap `X` to cycle, hold it to choose.
   *
   * The tap is what everyone already knows, so it keeps working; the hold is
   * for when counting presses to reach the seventh craft stops being funny.
   */
  const HOLD_TO_CHOOSE_MS = 300;
  let holdTimer: number | null = null;

  const cancelHold = () => {
    if (holdTimer === null) return false;
    clearTimeout(holdTimer);
    holdTimer = null;
    return true;
  };

  window.addEventListener("keyup", (event) => {
    // Released before the hold matured: that was a tap.
    if (event.code === "KeyX" && cancelHold()) cycleVehicle();
  });
  window.addEventListener("blur", () => cancelHold());

  const input = new InputController({
    onArm: () => {
      void audio.resume();
      if (state.crashed) return;
      state.armed = !state.armed;
      if (state.armed && active().model === "multirotor") {
        if (state.mode === "position") {
          // Arming into a hover rather than sitting on the pad: the altitude
          // loop is given somewhere to climb to, so the sandbox demonstrates
          // itself instead of looking inert until the pilot finds the throttle.
          // Touching W or S re-seats the hold, so this is a starting condition,
          // not a mode.
          controller.reset(state, TAKEOFF_ALTITUDE);
          input.centreThrottle();
        } else {
          // Acro and stabilized have no altitude loop to hold a target.
          controller.reset(state);
        }
      }
      if (state.armed && active().model === "rocket") {
        // Ignition. There is no hold-down mechanism to model: the shared
        // ground constraint already keeps the stack on the pad, and a rocket
        // whose thrust has not yet passed its own weight stays there on its
        // own — which is exactly what should happen.
        rocket.ignited = true;
        input.sticks.throttle = 1;
      }
      // The plane arms with the throttle wherever it sits — takeoff is the
      // pilot's job, that's the fun of it.
    },
    onCycleMode: () => {
      // Flight modes belong to the multirotor PID cascade; the plane has
      // exactly one mode, the aerodynamic one.
      if (active().model !== "multirotor") return;
      const next = (FLIGHT_MODES.indexOf(state.mode) + 1) % FLIGHT_MODES.length;
      state.mode = FLIGHT_MODES[next];
      controller.reset(state);
      if (state.mode === "position") input.centreThrottle();
    },
    onReset: resetVehicle,
  });

  // The card is a teaching aid, so it yields to the first sign the pilot is
  // ready. The toggle keys are excluded: they are handled by the switch below,
  // and dismissing here first would make H close and immediately reopen it.
  const HELP_KEYS = new Set(["KeyH", "Slash"]);
  window.addEventListener("pointerdown", (event) => {
    // Everything dismisses the card except the button whose whole job is to
    // toggle it: pointerdown would hide it and the click would immediately
    // re-open it, leaving the button able to open but never close.
    const target = event.target as Element | null;
    if (target?.closest?.(".controls-btn")) return;
    help.hide();
  });
  window.addEventListener("keydown", (event) => {
    if (!HELP_KEYS.has(event.code)) help.hide();
  });

  window.addEventListener("keydown", (event) => {
    // The chooser borrows the arrow keys, so while it is up it takes the
    // keyboard outright rather than sharing it with the flight controls.
    if (picker.visible) {
      switch (event.code) {
        case "ArrowLeft":
          picker.move(-1);
          break;
        case "ArrowRight":
          picker.move(1);
          break;
        case "ArrowUp":
          picker.move(-picker.columns);
          break;
        case "ArrowDown":
          picker.move(picker.columns);
          break;
        case "Enter":
        case "Space":
          picker.commit();
          break;
        case "Escape":
        case "KeyX":
          picker.close();
          break;
        default:
          return;
      }
      event.preventDefault();
      return;
    }

    switch (event.code) {
      case "KeyH":
      case "Slash":
        help.toggle();
        break;
      case "KeyX": {
        if (event.repeat || holdTimer !== null) break;
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          input.setSuspended(true);
          picker.open(vehicle);
        }, HOLD_TO_CHOOSE_MS);
        break;
      }
      case "KeyK":
        corePlumes.enabled = !corePlumes.enabled;
        boosterPlumes.enabled = corePlumes.enabled;
        starshipPlumes.enabled = corePlumes.enabled;
        break;
      case "KeyZ": {
        // Separating early throws away thrust you still had; separating late
        // carries dead weight uphill. Both are the pilot's mistake to make.
        // The single-stage vehicle has nothing to drop, so the key does
        // nothing rather than pretending to.
        if (
          active().model === "rocket" &&
          rocketConfig().boosterCount > 0 &&
          separateBoosters(rocket)
        ) {
          rocketRig.jettison();
          boosterPlumes.setNozzles([]);
        }
        break;
      }
      case "Digit1":
      case "Digit2":
      case "Digit3": {
        const presets: GainPresetId[] = ["stable", "sport", "detuned"];
        tuning.applyPreset(presets[Number(event.code.slice(5)) - 1]);
        controller.reset(state);
        break;
      }
      case "KeyT":
        tuning.toggle();
        break;
      case "KeyP":
        plots.toggle();
        break;
      case "KeyB":
        post.ambientOcclusion = !post.ambientOcclusion;
        break;
      case "KeyU":
        trail.enabled = !trail.enabled;
        if (!trail.enabled) trail.reset();
        break;
      case "KeyN":
        toggleMute();
        break;
      case "KeyC": {
        const next = (CAMERA_MODES.indexOf(cameraMode) + 1) % CAMERA_MODES.length;
        cameraMode = CAMERA_MODES[next];
        chase.mode = cameraMode;
        break;
      }
      case "BracketRight":
        wind.speed = Math.min(18, wind.speed + 1);
        break;
      case "BracketLeft":
        wind.speed = Math.max(0, wind.speed - 1);
        break;
      case "KeyG":
        chase.stabilized = !chase.stabilized;
        break;
      case "KeyL":
        lidar.enabled = !lidar.enabled;
        break;
      case "KeyO":
        occupancy.enabled = !occupancy.enabled;
        break;
      default:
        break;
    }
  });

  // Dev-only introspection handle. Stripped from production builds; useful for
  // checking part fitting and renderer cost without instrumenting the app.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__sandbox = {
      engine,
      rig,
      planeRig,
      heliRig,
      jetRig,
      VEHICLES,
      chase,
      rocket,
      rocketRig,
      landing,
      touchdownMarker,
      surfaceHeightAt: (x: number, y: number, z: number) =>
        surfaceHeightAt(physics, x, y, z),
      state,
      wind,
      controller,
      physics,
      crash,
      input,
      lidar,
      occupancy,
      post,
      tuning,
      plots,
      trail,
      propBlur,
      world,
      get vehicle() {
        return vehicle;
      },
    };
  }

  // --- Frame loop ---------------------------------------------------------
  const renderPosition = new Vector3();
  const renderOrientation = new Quaternion();
  const renderPose: Pose = { position: renderPosition, orientation: renderOrientation };
  const still = new Vector3();

  engine.start((now) => {
    // Input is sampled once per frame; the physics substeps below all see the
    // same stick positions, which is what a real radio link looks like anyway.
    const frameDt = Math.min(clock.dt * 5, 1 / 30);
    input.update(frameDt);

    const alpha = clock.advance(now, (dt) => {
      captureSnapshot(state, previous);
      wind.step(dt);

      let groundImpact: number | null = null;
      // Rebuilt each step rather than allocated, like everything else in here.
      support.supported = false;
      support.horizontalSpeed = 0;
      let sinkAtContact = 0;

      if (!state.crashed) {
        const air = wind.speed > 0 || wind.gustiness > 0 ? wind.velocity() : still;

        const entry = active();
        if (entry.model === "multirotor") {
          const demand = controller.update(state, input.sticks, dt);
          const { thrusts } = mix(demand);
          stepDynamics(state, thrusts, air, dt);

          // Capture the descent and ground track before the constraint zeroes
          // one and damps the other — this is the only moment they exist.
          const descent = -state.velocity.y;
          const track = Math.hypot(state.velocity.x, state.velocity.z);
          // Whatever is directly below: the street, the runway, or the roof of
          // a forty-storey tower. All three hold the aircraft up identically.
          const surface =
            surfaceHeightAt(physics, state.position.x, state.position.y, state.position.z) ?? 0;

          if (applyFlatGround(state, surface + entry.groundClearance)) {
            support.supported = true;
            support.horizontalSpeed = track;
            sinkAtContact = Math.max(0, descent);
            if (descent > 0) groundImpact = descent;
          }
        } else if (entry.model === "rocket") {
          const contact = stepRocket(
            state,
            rocket,
            {
              throttle: input.sticks.throttle,
              pitch: input.sticks.pitch,
              yaw: input.sticks.yaw,
              roll: input.sticks.roll,
            },
            air,
            entry.groundClearance,
            dt,
            { config: entry.rocketConfig, groundHeightAt: groundSampler },
          );
          if (contact.grounded) {
            support.supported = true;
            support.horizontalSpeed = contact.groundSpeed;
            sinkAtContact = contact.sinkSpeed;
            if (contact.sinkSpeed > 0) groundImpact = contact.sinkSpeed;
          }
        } else {
          const contact = stepAirplane(
            state,
            input.sticks,
            air,
            entry.groundClearance,
            dt,
            { config: entry.planeConfig, groundHeightAt: groundSampler },
          );
          if (contact.grounded) {
            support.supported = true;
            support.horizontalSpeed = contact.groundSpeed;
            sinkAtContact = contact.sinkSpeed;
            if (contact.sinkSpeed > 0) groundImpact = contact.sinkSpeed;
          }
        }

        physics.pushKinematic(state);
      }

      physics.step(dt);
      crash.update(state, physics, dt, groundImpact, support);
      // After the crash verdict, so a wreck is never graded as a landing.
      landing.update(state, support.supported, sinkAtContact, dt);
      lidar.update(state, physics, dt);
    });

    // Project the canonical state onto the scene graph, interpolated across
    // the leftover fraction of a step so motion stays smooth above 200 Hz.
    renderPosition.lerpVectors(previous.position, state.position, alpha);
    renderOrientation.slerpQuaternions(previous.orientation, state.orientation, alpha);
    const entry = active();
    entry.root.position.copy(renderPosition);
    entry.root.quaternion.copy(renderOrientation);
    entry.spin(state, frameDt);

    physics.syncPropMeshes();

    // One writer for this element, so the next thing to press is never
    // ambiguous. Highest priority first.
    const multirotor = entry.model === "multirotor";
    // Height above whatever is *below*, not above sea level: on a rooftop the
    // absolute altitude is forty storeys and the aircraft is still parked.
    const agl = lidar.altitudeAgl ?? state.position.y;
    const onGround = agl < entry.groundClearance + (multirotor ? 0.15 : 0.3);

    // A rocket is flown as a sequence rather than as a set of controls, and
    // the moment that decides the flight — booster burnout — is invisible
    // unless something says so. This is that something.
    const rocketHint = () => {
      if (!state.armed || !rocket.ignited) return "Press Enter to ignite";
      if (propellantFraction(rocket, rocketConfig()) <= 0) {
        return "Out of propellant — R to reset";
      }
      if (onGround && thrustToWeight(rocket) < 1) return "Hold W for full throttle";
      if (rocketConfig().boosterCount > 0 && rocket.boostersAttached) {
        return rocket.boosterProp <= 0
          ? "Boosters spent — press Z to drop them"
          : "Boosters burning · ↑↓←→ to steer · Z to stage";
      }
      return propellantFraction(rocket, rocketConfig()) < 0.15
        ? "Propellant low — steering goes with the thrust"
        : "Core burn · ↑↓←→ to steer";
    };

    const verdict =
      landing.last && landing.sinceLast < GRADE_HOLD ? landing.last : null;
    const hint = state.crashed
      ? "Crashed — press R to reset"
      : verdict
        ? `${GRADE_LABELS[verdict.grade]} LANDING — ${verdict.sinkSpeed.toFixed(1)} m/s`
        : entry.model === "rocket"
          ? rocketHint()
          : !state.armed
          ? "Press Enter to arm"
          : onGround
            ? multirotor
              ? "Hold W to climb"
              : "Full throttle (W), then ↑ to lift off"
            : "";
    if (statusEl.textContent !== hint) statusEl.textContent = hint;

    const tone = state.crashed
      ? "error"
      : verdict
        ? verdict.grade === "firm" || verdict.grade === "hard"
          ? "landing-firm"
          : "landing"
        : "";
    if (statusEl.dataset.tone !== tone) statusEl.dataset.tone = tone;

    touchdownMarker.update(state, lidar.altitudeAgl, (x, z) =>
      surfaceHeightAt(physics, x, state.position.y, z),
    );

    // Track the pose the airframe was *drawn* at, not the raw simulation
    // state: the mounted cameras are rigidly attached, so any disagreement
    // between the two shows up directly as judder. `renderPose` aliases the
    // same vectors, already filled in above.
    // A 2 km far plane is ample for aircraft and nowhere near enough for a
    // rocket, which passes it inside a minute and would watch the entire world
    // clip out of existence beneath it. Grow it with altitude instead of
    // setting it huge permanently: depth precision is a ratio, so a fixed
    // 60 km far plane would z-fight the city at ground level, where it is
    // actually being looked at closely.
    const reach = Math.max(2000, state.position.y * 4);
    if (engine.camera.far !== reach) {
      engine.camera.far = reach;
      engine.camera.updateProjectionMatrix();
    }

    chase.update(engine.camera, state, frameDt, renderPose);
    hud.update({
      state,
      rocket:
        entry.model === "rocket"
          ? {
              propellant: propellantFraction(rocket, rocketConfig()),
              twr: thrustToWeight(rocket),
            }
          : null,
      // The quad shows its PID flight mode; the others name themselves.
      modeLabel: vehicle === "quad" ? undefined : entry.label,
      tune: tuneLabel(tuning.currentPreset),
      camera: cameraMode,
      windSpeed: wind.speed,
      gustiness: wind.gustiness,
      usingGamepad: input.gamepadActive,
      altitudeAgl: lidar.altitudeAgl,
      mappedCells: occupancy.cellCount,
      gimbalStabilized: chase.stabilized,
    });

    // Rotor spin and blur are the active vehicle's own business (handled by
    // `entry.spin` above). Audio serves all three — every flight model fills
    // the same rotor arrays, so the RPM-driven loop needs no special case.
    audio.update(state);
    trail.update(state);
    trail.line.visible = trail.enabled;

    // Engine plumes. The level is the rocket's own thrust fraction, so a
    // throttled engine, a spent booster and a dry tank all read correctly
    // without the effect knowing anything about the controls.
    const flying = entry.model === "rocket";
    const config = rocketConfig();
    const thrustLevel = flying
      ? rocket.thrust / (config.coreThrust + config.boosterCount * config.boosterThrust)
      : 0;
    const clearance = flying ? exhaustClearance() : Infinity;
    // Each rocket lights its own nozzles. Driving both sets from one thrust
    // number would have the shuttle stack's engines burning under a starship.
    const stack = flying && entry.rocketConfig === undefined;
    const ship = flying && entry.rocketConfig === STARSHIP;
    corePlumes.update(stack ? thrustLevel : 0, state.time, clearance);
    boosterPlumes.update(
      stack && rocket.boostersAttached ? thrustLevel : 0,
      state.time,
      clearance,
    );
    starshipPlumes.update(ship ? thrustLevel : 0, state.time, clearance);

    // Main view carries the sensor overlays, and goes through the post stack.
    lidar.points.visible = lidar.enabled;
    occupancy.mesh.visible = occupancy.enabled;
    post.render();

    plots.sample(state, controller);
    plots.draw();
  });
}

boot().catch((error) => {
  statusEl.textContent = "Failed to start.";
  statusEl.dataset.tone = "error";
  console.error(error);
});
