/**
 * Runs one flight sequence.
 *
 * Owns the pure model, the scene, and the input source, and steps them at a
 * fixed rate. The fixed step is not optional: a variable-step model would drift
 * between the browser and the headless harness and between a 60 Hz and a 144 Hz
 * display, which would make every determinism guarantee meaningless.
 */

import * as THREE from 'three';
import { FlightRun } from './model/FlightRun';
import { FlightScene } from './FlightScene';
import { createAutopilot } from './model/autopilot';
import { sequenceConfig } from './model/sequences';
import { createSeededRandom } from '../utils/random';
import type { InputController } from '../core/InputController';
import type { FlightInputSource, FlightRunResult, FlightSequenceId } from './model/types';

/** Simulation rate. Everything steps at this, whatever the display does. */
const FIXED_STEP = 1 / 120;

/** Cap on substeps per frame, so a stalled tab cannot spiral. */
const MAX_SUBSTEPS = 8;

export interface FlightRequest {
  sequence: FlightSequenceId;
  seed: number;
  /** Loaded props for this sequence's family. May be empty. */
  props: THREE.Object3D[];
  /** Called once when the sequence resolves. */
  onComplete: (result: FlightRunResult) => void;
}

export class FlightController {
  readonly scene: FlightScene;

  private run: FlightRun;
  private accumulator = 0;
  private settled = false;
  private lastBoost = false;
  private hitsSeen = 0;

  /** Set to drive the sequence without a player, for tests and bots. */
  private scripted: FlightInputSource | null = null;

  constructor(
    private readonly request: FlightRequest,
    private readonly input: InputController,
    rng: () => number,
    private readonly reducedMotion: () => boolean,
    padProps: THREE.Object3D[] = [],
  ) {
    const config = sequenceConfig(request.sequence);
    this.scene = new FlightScene(rng);
    this.run = new FlightRun(config, request.seed);
    this.scene.begin(config, request.props, padProps);
  }

  /**
   * Install the launch complex after the fact.
   *
   * The desert pack streams in parallel with the sequence starting, so the
   * ascent never blocks on it — the pad simply appears a beat later rather
   * than the player waiting on a loading screen.
   */
  setPadProps(props: THREE.Object3D[]): void {
    this.scene.rebuildPad(props);
  }

  /** Swap in the obstacle models once their family has streamed in. */
  setObstacleProps(props: THREE.Object3D[]): void {
    this.scene.rebuildObstacles(props);
  }

  /**
   * Step the simulation without rendering.
   *
   * Test-only: a corridor is up to a minute long and runs well under real time
   * without a GPU, which made browser coverage of a whole sequence take
   * minutes. The scripted pilot flies it; nothing here bypasses a rule.
   */
  fastForward(seconds: number): void {
    const steps = Math.min(120 * 200, Math.round(seconds / FIXED_STEP));
    for (let i = 0; i < steps && !this.run.finished; i += 1) {
      const axes = this.scripted
        ? { ...this.scripted.sample(FIXED_STEP, this.run.view), abortRequested: false }
        : { x: 0, y: 0, boost: false, brake: false, abortRequested: false };
      this.run.step(FIXED_STEP, axes);
    }
    if (this.run.finished) this.settle();
  }

  setShipModel(model: THREE.Object3D): void {
    this.scene.setShipModel(model);
  }

  /**
   * Replace the player with a scripted pilot.
   *
   * `skill` is 0-1; null restores player control. This is the seam that lets
   * Playwright and the bots drive a sequence without being able to fly.
   */
  setAutopilot(skill: number | null): void {
    if (skill === null) {
      this.scripted = null;
      return;
    }
    this.scripted = createAutopilot(
      { skill },
      createSeededRandom(this.request.seed ^ 0x9e37),
      sequenceConfig(this.request.sequence),
    );
  }

  get view() {
    return this.run.view;
  }

  get sequence(): FlightSequenceId {
    return this.request.sequence;
  }

  /** Abandon the run. Resolves at the abort penalty rather than the dice. */
  abort(): void {
    if (this.settled) return;
    this.run.abort();
    this.settle();
  }

  update(delta: number, _elapsed: number): void {
    if (this.settled) return;

    // Clamp before accumulating: a long frame should drop simulation time
    // rather than trying to catch up all at once and teleporting the ship.
    this.accumulator += Math.min(delta, MAX_SUBSTEPS * FIXED_STEP);

    let boosting = this.lastBoost;
    let steps = 0;

    while (this.accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS && !this.run.finished) {
      steps += 1;
      this.accumulator -= FIXED_STEP;

      const axes = this.scripted
        ? { ...this.scripted.sample(FIXED_STEP, this.run.view), abortRequested: false }
        : this.input.sample(FIXED_STEP);

      if (axes.abortRequested) {
        this.abort();
        return;
      }

      boosting = axes.boost;
      this.run.step(FIXED_STEP, axes);
    }

    this.lastBoost = boosting;

    // Kick the camera once per new collision, not once per overlapping frame.
    const view = this.run.view;
    if (view.hits > this.hitsSeen) {
      this.scene.chase.impulse(0.6 * (view.hits - this.hitsSeen));
      this.hitsSeen = view.hits;
    }

    this.scene.update(delta, view, boosting, this.reducedMotion());

    if (this.run.finished) this.settle();
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.request.onComplete(this.run.result());
  }

  get finished(): boolean {
    return this.settled;
  }

  resize(aspect: number): void {
    this.scene.resize(aspect);
  }

  dispose(): void {
    this.scene.dispose();
  }
}