import type { ControlMode, RobotId, RoomId } from '../config/catalog';

export type AppPhase =
  | 'intro'
  | 'robot-select'
  | 'sandbox-loading'
  | 'sandbox'
  | 'room-select'
  | 'scenario-config'
  | 'loading'
  | 'live'
  | 'paused'
  | 'results'
  | 'replay';

export type AppState = {
  phase: AppPhase;
  robotId: RobotId;
  roomId: RoomId;
  controlMode: ControlMode;
  seed: number;
};

type Listener = (state: Readonly<AppState>) => void;

const ALLOWED: Readonly<Record<AppPhase, readonly AppPhase[]>> = {
  intro: ['robot-select'],
  'robot-select': ['intro', 'room-select', 'sandbox-loading'],
  'sandbox-loading': ['robot-select', 'sandbox'],
  sandbox: ['robot-select'],
  'room-select': ['robot-select', 'scenario-config'],
  'scenario-config': ['room-select', 'loading'],
  loading: ['scenario-config', 'live'],
  live: ['paused', 'results'],
  paused: ['live', 'scenario-config'],
  results: ['loading', 'robot-select', 'replay'],
  replay: ['results', 'paused'],
};

export class AppStateMachine {
  private state: AppState = {
    phase: 'intro',
    robotId: 'axiom-h1',
    roomId: 'kinetic-hall',
    controlMode: 'manual',
    seed: 5,
  };

  private readonly listeners = new Set<Listener>();

  get snapshot(): Readonly<AppState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  transition(phase: AppPhase, patch: Partial<Omit<AppState, 'phase'>> = {}): void {
    if (!ALLOWED[this.state.phase].includes(phase)) {
      throw new Error(`Invalid app transition: ${this.state.phase} -> ${phase}`);
    }
    this.state = { ...this.state, ...patch, phase };
    this.emit();
  }

  forceForTest(state: Partial<AppState> & Pick<AppState, 'phase'>): void {
    this.state = { ...this.state, ...state };
    this.emit();
  }

  updateSelection(patch: Partial<Omit<AppState, 'phase'>>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
