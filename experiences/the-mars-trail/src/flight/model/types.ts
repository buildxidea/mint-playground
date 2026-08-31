/**
 * THE MARS TRAIL — flight model types.
 *
 * `src/flight/model` is pure TypeScript with no Three.js and no DOM, exactly
 * like `src/sim`. That is what lets a whole flight be replayed headlessly at a
 * fixed timestep and asserted on, and it is what keeps the renderer a dumb
 * observer rather than a second owner of gameplay state.
 */

export type FlightSequenceId = 'launch' | 'kessler' | 'asteroid-fringe' | 'mars-descent';

/** Normalised player intent for a single step. */
/**
 * Where the launch has got to. Only the ascent uses these; every other
 * sequence starts already flying.
 */
export type LaunchStage =
  /** Standing on the pad, waiting to be ignited. Where every ascent opens. */
  | 'pad'
  | 'ignition'
  | 'boost'
  | 'staged'
  | 'flying';

export interface FlightInput {
  /** Lateral steering, -1 (left) to 1 (right). */
  x: number;
  /** Vertical steering, -1 (down) to 1 (up). */
  y: number;
  boost: boolean;
  brake: boolean;
  throttleUp?: boolean;
  throttleDown?: boolean;
  ignitePressed?: boolean;
  stagePressed?: boolean;
}

export const NEUTRAL_INPUT: FlightInput = { x: 0, y: 0, boost: false, brake: false };

/**
 * One obstacle. Plain numbers so the whole field can be stepped, serialised,
 * and compared without touching a scene graph.
 */
export interface FlightBody {
  id: number;
  active: boolean;
  x: number;
  y: number;
  z: number;
  /** Collision radius, also used to scale the rendered clone. */
  r: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  /** Index into the sequence's asset family, so the renderer knows what to draw. */
  kind: number;
}

export interface FlightConfig {
  id: FlightSequenceId;
  title: string;
  /** Shown on the pre-flight card. */
  brief: string;
  /** Where this happens. Shown above the title; omitted in open space. */
  place?: string;
  /** Scene palette key, reused from src/scene/palettes.ts. */
  sceneKey: string;
  /** Which loaded prop family the obstacles are drawn from. */
  family: 'debris' | 'asteroid' | 'launch' | 'mars-surface';
  /** How long the corridor lasts, in seconds. Includes the lead-in. */
  durationSeconds: number;
  /**
   * Opening seconds during which the player has no control and no obstacles
   * spawn: the scripted liftoff. Zero for sequences that start mid-flight.
   */
  leadInSeconds?: number;
  /** Forward speed in world units per second. */
  speed: number;
  /** Extra speed available on boost. */
  boostSpeed: number;
  /** How far ahead bodies spawn. */
  spawnDepth: number;
  /** Fixed pool size. Never allocates mid-run. */
  capacity: number;
  /** Obstacle radius range. */
  radius: [number, number];
  /** Soft corridor half-extents. Where steering is pushed back. */
  corridorX: number;
  corridorY: number;
  /**
   * How far obstacles are scattered, as a multiple of the corridor.
   *
   * Spawning only inside the corridor leaves everything clustered in the middle
   * of the frame with bare sky either side. Scattering wider fills the screen;
   * the ones beyond the corridor are effectively scenery you can still clip.
   */
  spreadFactor?: number;
  /**
   * Progress, 0-1, before which no obstacle spawns. The ascent uses this to
   * open with a cloud deck and only bring the debris in once you are above it.
   */
  clearUntil?: number;
  /** How much accumulated hit severity equals a total loss of performance. */
  hitBudget: number;
  /** Lateral acceleration. Higher is twitchier. */
  agility: number;
}

/** Read-only view the renderer and the autopilot both consume. */
export interface FlightRunView {
  shipX: number;
  shipY: number;
  shipVX: number;
  shipVY: number;
  /** 0-1 through the corridor. */
  progress: number;
  seconds: number;
  speed: number;
  bodies: readonly FlightBody[];
  hits: number;
  /** True while the ship is intangible after a hit. */
  invulnerable: boolean;
  /** True while outside the soft corridor bounds. */
  offCorridor: boolean;
  /** -1 / 0 / 1 for which side of the lane the ship has drifted off. */
  driftX: number;
  driftY: number;
  /** True during the scripted opening, before control hands over. */
  cinematic: boolean;
  /** Launch sequence state. 'flying' for every non-launch sequence. */
  stage: LaunchStage;
  /** 0-1 commanded engine throttle. */
  throttle: number;
  /** Thrust-to-weight. Below 1 the vehicle stays on the pad. */
  twr: number;
  /** Metres climbed. Monotonic across the whole ascent. */
  altitude: number;
  /** 0-1 of the ascent, from altitude. Launch visuals key off this, not time. */
  climb: number;
  /** 0-100 hull health. Reaching zero ends the ascent. */
  health: number;
  /** 0-1 through the opening camera move. Framing only; gates nothing. */
  prelaunch: number;
  /** True for a few seconds once the obstacle field arrives. */
  hazardWarning: boolean;
  /** 0-1 through the scripted opening. 1 once the player has control. */
  liftoff: number;
  finished: boolean;
}

export interface FlightStats {
  /** True when the hull was destroyed outright, as opposed to abandoned. */
  destroyed?: boolean;
  hits: number;
  hitSeverity: number;
  /** Near-misses. Rewards flying tight rather than hugging the corridor edge. */
  grazes: number;
  offCorridorSeconds: number;
  seconds: number;
  completed: boolean;
}

export interface FlightRunResult {
  /** True when the hull was destroyed. The ascent uses this to send you back. */
  destroyed: boolean;
  sequence: FlightSequenceId;
  completed: boolean;
  /**
   * The single 0-1 scalar the simulation consumes. This is the entire seam
   * between real-time flying and the turn-based rules.
   */
  performance: number;
  hits: number;
  grazes: number;
  offCorridorSeconds: number;
  seconds: number;
}

/** Anything that can drive a flight: the player, or a scripted autopilot. */
export interface FlightInputSource {
  sample(delta: number, view: FlightRunView): FlightInput;
}
