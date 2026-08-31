import * as THREE from "three";
import { Axis } from "./constants";
import { CubeView } from "./geometry";
import { CubeState, Move, Turns, invertMove } from "./state";

const QUARTER = Math.PI / 2;
const AXIS_NAME: Record<Axis, "x" | "y" | "z"> = { 0: "x", 1: "y", 2: "z" };

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface ActiveTurn {
  move: Move;
  from: number;
  to: number;
  elapsed: number;
  duration: number;
  /** Manual drags commit no move when the turn is cancelled back to zero. */
  commit: boolean;
}

/**
 * Owns every layer rotation, whether it comes from a drag, the scramble
 * button, or solution playback. Only one turn can be in flight at a time.
 */
export class MoveEngine {
  private readonly pivot = new THREE.Group();
  private active: ActiveTurn | null = null;
  private manual: { axis: Axis; layer: number } | null = null;
  private manualAngle = 0;

  /** Fires after a move has been committed to the logical state. */
  onMoveApplied: ((move: Move) => void) | null = null;
  /** Fires when the engine goes from busy to idle. */
  onIdle: (() => void) | null = null;

  constructor(
    private readonly state: CubeState,
    private readonly view: CubeView,
  ) {
    this.view.group.add(this.pivot);
  }

  get isBusy(): boolean {
    return this.active !== null || this.manual !== null;
  }

  get isDragging(): boolean {
    return this.manual !== null;
  }

  /** Animate a single move. Ignored if a turn is already running. */
  play(move: Move, durationMs: number): boolean {
    if (this.isBusy) return false;
    this.attach(move.axis, move.layer);
    this.active = {
      move,
      from: 0,
      to: move.turns * QUARTER,
      elapsed: 0,
      duration: Math.max(1, durationMs),
      commit: true,
    };
    return true;
  }

  /* ------------------------------------------------------------ dragging */

  beginManual(axis: Axis, layer: number): void {
    if (this.isBusy) return;
    this.attach(axis, layer);
    this.manual = { axis, layer };
    this.manualAngle = 0;
  }

  setManualAngle(radians: number): void {
    if (!this.manual) return;
    this.manualAngle = radians;
    this.pivot.rotation[AXIS_NAME[this.manual.axis]] = radians;
  }

  /**
   * Release a drag: snap to the nearest quarter turn, or back to zero if the
   * drag never passed the halfway point.
   */
  endManual(snapMs = 170): void {
    if (!this.manual) return;
    const { axis, layer } = this.manual;
    const angle = this.manualAngle;
    this.manual = null;

    let steps = Math.round(angle / QUARTER);
    if (steps > 2) steps = 2;
    if (steps < -2) steps = -2;

    if (steps === 0) {
      this.active = {
        move: { axis, layer, turns: 1 },
        from: angle,
        to: 0,
        elapsed: 0,
        duration: snapMs,
        commit: false,
      };
      return;
    }

    const turns: Turns = steps === 2 || steps === -2 ? 2 : (steps as Turns);
    this.active = {
      move: { axis, layer, turns },
      from: angle,
      to: steps * QUARTER,
      elapsed: 0,
      duration: snapMs,
      commit: true,
    };
  }

  /* -------------------------------------------------------------- update */

  update(deltaMs: number): void {
    const turn = this.active;
    if (!turn) return;

    turn.elapsed += deltaMs;
    const t = Math.min(1, turn.elapsed / turn.duration);
    const eased = easeOutCubic(t);
    const angle = turn.from + (turn.to - turn.from) * eased;
    this.pivot.rotation[AXIS_NAME[turn.move.axis]] = angle;

    if (t < 1) return;

    this.active = null;
    if (turn.commit) {
      this.state.applyMove(turn.move);
    }
    this.detach();
    if (turn.commit) {
      this.onMoveApplied?.(turn.move);
    }
    if (!this.isBusy) this.onIdle?.();
  }

  /* -------------------------------------------------------------- pivot */

  private attach(axis: Axis, layer: number): void {
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.updateMatrix();
    // The pivot sits at the cube's origin with no rotation, so re-parenting
    // does not change any child's world transform.
    for (const object of this.view.layerObjects(axis, layer)) {
      this.pivot.add(object);
    }
  }

  private detach(): void {
    for (let i = this.pivot.children.length - 1; i >= 0; i--) {
      this.view.group.add(this.pivot.children[i]);
    }
    this.pivot.rotation.set(0, 0, 0);
    // Re-quantise: exact transforms straight from the integer state, so no
    // float error can survive from one move to the next.
    this.view.syncFromState();
  }

  /** Abandon any in-flight turn and restore the cube to its logical state. */
  cancel(): void {
    this.active = null;
    this.manual = null;
    this.manualAngle = 0;
    this.detach();
  }
}

/**
 * Steps through a fixed list of moves - a scramble or a solution - with play,
 * pause, and single stepping in both directions.
 */
export class MovePlayer {
  private moves: Move[] = [];
  private index = 0;
  private playing = false;

  onChange: (() => void) | null = null;

  constructor(private readonly engine: MoveEngine) {}

  load(moves: Move[], autoplay = false): void {
    this.moves = moves;
    this.index = 0;
    this.playing = autoplay && moves.length > 0;
    this.onChange?.();
  }

  clear(): void {
    this.moves = [];
    this.index = 0;
    this.playing = false;
    this.onChange?.();
  }

  get length(): number {
    return this.moves.length;
  }

  get position(): number {
    return this.index;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isLoaded(): boolean {
    return this.moves.length > 0;
  }

  get isFinished(): boolean {
    return this.moves.length > 0 && this.index >= this.moves.length;
  }

  get upcoming(): Move[] {
    return this.moves.slice(this.index);
  }

  get all(): Move[] {
    return this.moves;
  }

  setPlaying(value: boolean): void {
    if (value && this.isFinished) return;
    this.playing = value;
    this.onChange?.();
  }

  toggle(): void {
    this.setPlaying(!this.playing);
  }

  stepForward(durationMs: number): boolean {
    if (this.index >= this.moves.length) return false;
    if (!this.engine.play(this.moves[this.index], durationMs)) return false;
    this.index++;
    this.onChange?.();
    return true;
  }

  stepBack(durationMs: number): boolean {
    if (this.index <= 0) return false;
    const previous = this.moves[this.index - 1];
    if (!this.engine.play(invertMove(previous), durationMs)) return false;
    this.index--;
    this.onChange?.();
    return true;
  }

  /** Advance playback when the engine is free. */
  update(durationMs: number): void {
    if (!this.playing || this.engine.isBusy) return;
    if (!this.stepForward(durationMs)) {
      this.playing = false;
      this.onChange?.();
    }
  }
}
