/**
 * The arcade flight simulation.
 *
 * Pure and fixed-step: `step(dt, input)` must always be called with the same
 * dt, so the same seed and the same input source produce a bit-identical run in
 * Node and in the browser. That is what makes the headless autopilot harness
 * meaningful.
 *
 * Convention matches the rest of the game: the ship stays at the origin and the
 * world flows past it. Bodies travel toward +z and recycle when they pass the
 * camera, which keeps float precision bounded and makes pooling trivial.
 */

import { createSeededRandom } from '../../utils/random';
import { scoreFlight } from './scoring';
import type {
  FlightBody,
  LaunchStage,
  FlightConfig,
  FlightInput,
  FlightRunResult,
  FlightRunView,
  FlightStats,
} from './types';

/** Collision radius of the ship itself. */
const SHIP_RADIUS = 0.55;

/**
 * Intangibility window after a hit, in seconds.
 *
 * Without this a single obstacle resting inside the sphere test registers a
 * hit on every one of the 120 steps per second it overlaps, and one clumsy
 * graze scores as a catastrophe.
 */
const INVULNERABLE_SECONDS = 1.1;

/** A body is counted as a graze inside this multiple of the touching distance. */
const GRAZE_FACTOR = 1.7;

/** Bodies further away than this in z are skipped by the collision test. */
const COLLISION_Z_WINDOW = 4;

/**
 * Exponent controlling how strongly obstacles cluster toward the corridor.
 * 1 is a uniform spread; higher pulls more of them into the middle.
 */
const SPREAD_BIAS = 1.25;

/** Map a 0-1 sample to -1..1, weighted toward zero. */
function biasedSpread(sample: number): number {
  const t = sample * 2 - 1;
  return Math.sign(t) * Math.abs(t) ** SPREAD_BIAS;
}

/** Dry mass, and the mass the boosters add while they are still attached. */
/** Opening camera move onto the pad. Framing only; it gates nothing. */
const PRELAUNCH_SECONDS = 3.5;

/**
 * Throttle command applied when the player is holding nothing.
 *
 * TWR crosses 1.0 at about 52% throttle, so at this rate an untouched launch
 * lifts off after a few seconds of spool. Holding W gets there in well under
 * one, which is the intended way to fly it.
 */
const IDLE_SPOOL = 0.28;

/** Altitude that counts as a completed ascent, for the visual climb curve. */
const FULL_ASCENT_ALTITUDE = 2600;

const CORE_MASS = 1;
const BOOSTER_MASS = 1.4;

/** Thrust in the same arbitrary units as mass. */
const CORE_THRUST = 1.9;
const BOOSTER_THRUST = 2.7;

/** How long the boosters burn at full throttle, in seconds. */
const BOOSTER_BURN_SECONDS = 11;

/** Hull damage per impact. Roughly six hits ends an ascent. */
const IMPACT_DAMAGE = 17;

/** Where a body is recycled once it has passed the camera. */
const RECYCLE_Z = 14;

export class FlightRun {
  private readonly rng: () => number;
  private readonly bodies: FlightBody[] = [];

  private shipX = 0;
  private shipY = 0;
  private shipVX = 0;
  private shipVY = 0;

  private elapsed = 0;
  private distance = 0;
  private currentSpeed: number;
  private invulnerableFor = 0;
  private grazeCooldown = new Map<number, number>();

  private stats: FlightStats = {
    hits: 0,
    hitSeverity: 0,
    grazes: 0,
    offCorridorSeconds: 0,
    seconds: 0,
    completed: false,
  };

  private done = false;

  constructor(
    readonly config: FlightConfig,
    seed: number,
  ) {
    // The ascent begins held on the pad awaiting ignition; every other
    // sequence is already under way.
    if (config.id === 'launch') this.stage = 'pad';
    this.rng = createSeededRandom(seed);
    this.currentSpeed = config.speed;

    for (let i = 0; i < config.capacity; i += 1) {
      const body: FlightBody = {
        id: i,
        active: false,
        x: 0,
        y: 0,
        z: 0,
        r: 1,
        spinX: 0,
        spinY: 0,
        spinZ: 0,
        kind: 0,
      };
      this.bodies.push(body);
      // Stagger the initial field across the whole spawn depth so the corridor
      // is already populated on the first frame rather than filling in.
      this.respawn(body, -this.rng() * config.spawnDepth);
    }
  }

  /**
   * One step of the launch sequence.
   *
   * Thrust-to-weight is the whole mechanic: below 1.0 the clamps hold and
   * nothing happens, so the player has to throttle up before anything moves.
   * Staging sheds the booster mass, which makes the vehicle leap.
   */
  private stepLaunch(dt: number, input: FlightInput): void {
    // Runs alongside the player, not in front: Space works on frame one.
    this.prelaunch = Math.min(1, this.prelaunch + dt / PRELAUNCH_SECONDS);

    if (this.stage === 'pad') {
      if (input.ignitePressed) this.stage = 'ignition';
      return;
    }

    // The engines spool up on their own after ignition, so pressing the launch
    // key always eventually leaves the pad. Holding W is several times faster
    // and remains the right way to fly it — but pressing Space and watching
    // nothing happen can no longer occur.
    const command = input.throttleDown ? -0.55 : input.throttleUp ? 1 : IDLE_SPOOL;
    this.throttle = Math.max(0, Math.min(1, this.throttle + command * dt * 0.75));

    const hasBoosters = this.stage === 'ignition' || this.stage === 'boost';
    const mass = CORE_MASS + (hasBoosters ? BOOSTER_MASS * this.boosterFuel : 0);
    const thrust = this.throttle * (CORE_THRUST + (hasBoosters ? BOOSTER_THRUST : 0));
    this.twr = thrust / mass;

    if (hasBoosters && this.stage !== 'ignition') {
      this.boosterFuel = Math.max(0, this.boosterFuel - (this.throttle * dt) / BOOSTER_BURN_SECONDS);
    }

    if (this.stage === 'ignition') {
      // The clamps hold until the stack can actually lift itself.
      if (this.twr > 1) this.stage = 'boost';
      return;
    }

    if (this.stage === 'boost') {
      // Sluggish at first so the complex stays in frame and shrinks beneath you.
      const climbRate = 34 + Math.min(1, this.altitude / 700) * 230;
      this.altitude += Math.max(0, this.twr - 1) * dt * climbRate;
      // Staging is the player's call, but a burnt-out booster is dead weight.
      if (input.stagePressed && this.altitude > 120) {
        this.stage = 'staged';
        this.boosterFuel = 0;
      }
      return;
    }

    if (this.stage === 'staged') {
      this.altitude += Math.max(0, this.twr - 1) * dt * 240;
      if (this.altitude > 900) this.stage = 'flying';
    }
  }

  private respawn(body: FlightBody, z: number): void {
    const c = this.config;
    body.active = true;
    body.z = z;
    body.r = c.radius[0] + this.rng() * (c.radius[1] - c.radius[0]);
    // Scatter across the full frame, but bias the distribution toward the
    // middle. A uniform spread fills the screen at the cost of emptying the
    // corridor, which makes flying well and flying badly score the same; this
    // keeps the threat where the player is while still filling the edges.
    const spread = c.spreadFactor ?? 1;
    body.x = biasedSpread(this.rng()) * (c.corridorX * spread + body.r * 0.6);
    body.y = biasedSpread(this.rng()) * (c.corridorY * spread + body.r * 0.4);
    body.spinX = (this.rng() - 0.5) * 1.4;
    body.spinY = (this.rng() - 0.5) * 1.6;
    body.spinZ = (this.rng() - 0.5) * 1.2;
    body.kind = Math.floor(this.rng() * 6);
    this.grazeCooldown.delete(body.id);
  }

  /** Advance one fixed step. */
  step(dt: number, input: FlightInput): void {
    if (this.done) return;

    const c = this.config;

    // --- launch sequence --------------------------------------------------
    // Only the ascent runs this. Everything else is already flying.
    if (this.stage !== 'flying') {
      this.stepLaunch(dt, input);
    }

    // The corridor clock starts at ignition, so waiting on the pad is free.
    if (this.stage !== 'pad') this.elapsed += dt;
    const cinematic = this.stage === 'pad' || this.stage === 'ignition';
    this.cinematic = cinematic;
    // Zero until the engines are lit; the roar keys off this.
    this.liftoff = this.stage === 'pad' ? 0 : this.stage === 'ignition' ? this.throttle : 1;

    if (cinematic) {
      // No lateral control until the vehicle is off the pad.
      input = { ...input, x: 0, y: 0 };
    }

    // Once the launch stages are done the vehicle is simply climbing, so
    // altitude keeps growing from speed. Keeping one monotonic measure is what
    // lets every visual key off how high it actually is rather than a clock.
    if (this.stage === 'flying' && c.id === 'launch') {
      this.altitude += this.currentSpeed * dt * 1.6;
    }

    // --- speed -----------------------------------------------------------
    // Thrust builds from rest over the lead-in rather than starting at cruise.
    const cruise = c.speed + (input.boost ? c.boostSpeed : 0) - (input.brake ? c.speed * 0.3 : 0);
    const target =
      this.stage === 'pad'
        ? 0
        : this.stage === 'ignition'
          ? cruise * 0.1
          : this.stage === 'boost'
            ? cruise * (0.35 + 0.65 * this.throttle)
            : cruise;
    this.currentSpeed += (target - this.currentSpeed) * (1 - Math.exp(-3 * dt));
    this.distance += this.currentSpeed * dt;

    // --- steering --------------------------------------------------------
    // Acceleration toward the input with drag, so the ship carries momentum
    // rather than snapping. Drag is exponential so it is frame-rate stable.
    // Gimballed engines: you can only steer as hard as you are thrusting.
    const authority =
      this.stage === 'boost' || this.stage === 'staged'
        ? c.agility * (0.35 + 0.65 * this.throttle)
        : c.agility;
    this.shipVX += input.x * authority * dt;
    this.shipVY += input.y * authority * dt;
    const drag = Math.exp(-4.5 * dt);
    this.shipVX *= drag;
    this.shipVY *= drag;
    this.shipX += this.shipVX * dt;
    this.shipY += this.shipVY * dt;

    // --- soft corridor ---------------------------------------------------
    // A spring rather than a clamp: drifting out costs performance and pushes
    // back, but never yanks control away from the player.
    let offCorridor = false;
    this.driftX = 0;
    this.driftY = 0;
    if (Math.abs(this.shipX) > c.corridorX) {
      offCorridor = true;
      this.driftX = Math.sign(this.shipX);
      const overshoot = Math.abs(this.shipX) - c.corridorX;
      this.shipVX -= Math.sign(this.shipX) * overshoot * 16 * dt;
    }
    if (Math.abs(this.shipY) > c.corridorY) {
      offCorridor = true;
      this.driftY = Math.sign(this.shipY);
      const overshoot = Math.abs(this.shipY) - c.corridorY;
      this.shipVY -= Math.sign(this.shipY) * overshoot * 16 * dt;
    }
    if (offCorridor) this.stats.offCorridorSeconds += dt;
    this.offCorridor = offCorridor;

    // --- field -----------------------------------------------------------
    if (this.invulnerableFor > 0) this.invulnerableFor -= dt;

    // Nothing is in the way until the player has the controls. The field is
    // then seeded once, spread across the spawn depth, so the first obstacle
    // arrives a beat after handover rather than all of them at once.
    // Progress through the corridor, used to hold the field back while the
    // opening cloud deck plays.
    const progressNow = Math.min(1, this.elapsed / c.durationSeconds);
    const stillClear =
      progressNow < (c.clearUntil ?? 0) || (this.stage !== 'flying' && this.stage !== 'staged');

    if (cinematic || stillClear) {
      for (const body of this.bodies) body.active = false;
    } else if (!this.fieldSeeded) {
      this.fieldSeeded = true;
      this.hazardWarnUntil = this.elapsed + 4.5;
      this.bodies.forEach((body, index) => {
        this.respawn(body, -c.spawnDepth * (0.25 + (0.75 * index) / this.bodies.length));
      });
    }

    for (const body of this.bodies) {
      if (!body.active) continue;
      body.z += this.currentSpeed * dt;
      if (body.z > RECYCLE_Z) {
        this.respawn(body, -c.spawnDepth + (body.z - RECYCLE_Z));
        continue;
      }
      this.testBody(body, dt);
    }

    // --- completion ------------------------------------------------------
    if (this.elapsed >= c.durationSeconds) {
      this.done = true;
      this.stats.completed = true;
      this.stats.seconds = this.elapsed;
    }
  }

  private offCorridor = false;
  // --- launch sequence -----------------------------------------------------
  // Mirrors the reference rocket sim: ignition, a throttle you hold, gimbal
  // authority proportional to thrust, and a staging event that sheds mass.
  private stage: LaunchStage = 'flying';
  private throttle = 0;
  private prelaunch = 0;
  private hazardWarnUntil = -1;
  private altitude = 0;
  /** Propellant fraction remaining in the boosters. */
  private boosterFuel = 1;
  private health = 100;
  private driftX = 0;
  private driftY = 0;
  private cinematic = false;
  private liftoff = 0;
  private twr = 0;
  /** True once the corridor has been seeded at the end of the lead-in. */
  private fieldSeeded = false;

  private testBody(body: FlightBody, dt: number): void {
    // Only bodies near the ship's z-plane can touch it; this keeps the test at
    // a handful of comparisons per step without needing a spatial structure.
    if (Math.abs(body.z) > COLLISION_Z_WINDOW) return;

    const dx = body.x - this.shipX;
    const dy = body.y - this.shipY;
    const dz = body.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    const touching = body.r + SHIP_RADIUS;

    if (distanceSq <= touching * touching) {
      if (this.invulnerableFor > 0) return;
      this.invulnerableFor = INVULNERABLE_SECONDS;
      this.stats.hits += 1;
      // Hull health is the player-facing version of hit severity: the same
      // event, expressed as a bar they can watch rather than a number they
      // have to infer.
      this.health = Math.max(0, this.health - IMPACT_DAMAGE);
      // Only the ascent ends on a destroyed hull, because only the ascent is
      // retryable at no cost. In a hazard corridor a wrecked hull is already
      // punished through performance, and cutting the run short there would
      // mean a bad flight scored better than a terrible one.
      if (this.health <= 0 && this.config.id === 'launch') {
        this.done = true;
        this.stats.completed = false;
        this.stats.seconds = this.elapsed;
        this.stats.destroyed = true;
      }
      // Severity scales with how fast and how big — clipping a boulder at boost
      // should cost more than brushing a bolt while braking.
      this.stats.hitSeverity += (this.currentSpeed / this.config.speed) * body.r * 2.2;

      // Knock the ship off line so a hit is felt, not just counted.
      const push = 1 / Math.max(0.3, Math.sqrt(distanceSq));
      this.shipVX -= dx * push * 6;
      this.shipVY -= dy * push * 6;
      return;
    }

    // Graze: rewards threading gaps instead of flying the empty edges.
    const grazeRange = touching * GRAZE_FACTOR;
    if (distanceSq <= grazeRange * grazeRange) {
      const until = this.grazeCooldown.get(body.id) ?? 0;
      if (this.elapsed >= until) {
        this.stats.grazes += 1;
        this.grazeCooldown.set(body.id, this.elapsed + 1.2);
      }
    }
    void dt;
  }

  /** Abandon the run early. Scores whatever was achieved, marked incomplete. */
  abort(): void {
    if (this.done) return;
    this.done = true;
    this.stats.completed = false;
    this.stats.seconds = this.elapsed;
  }

  get finished(): boolean {
    return this.done;
  }

  get view(): FlightRunView {
    return {
      shipX: this.shipX,
      shipY: this.shipY,
      shipVX: this.shipVX,
      shipVY: this.shipVY,
      progress: Math.min(1, this.elapsed / this.config.durationSeconds),
      seconds: this.elapsed,
      speed: this.currentSpeed,
      bodies: this.bodies,
      hits: this.stats.hits,
      invulnerable: this.invulnerableFor > 0,
      offCorridor: this.offCorridor,
      driftX: this.driftX,
      driftY: this.driftY,
      cinematic: this.cinematic,
      liftoff: this.liftoff,
      stage: this.stage,
      throttle: this.throttle,
      twr: this.twr,
      altitude: this.altitude,
      health: this.health,
      climb: Math.min(1, this.altitude / FULL_ASCENT_ALTITUDE),
      prelaunch: this.prelaunch,
      hazardWarning: this.elapsed < this.hazardWarnUntil,
      finished: this.done,
    };
  }

  result(): FlightRunResult {
    return scoreFlight({ ...this.stats, seconds: this.elapsed }, this.config);
  }
}
