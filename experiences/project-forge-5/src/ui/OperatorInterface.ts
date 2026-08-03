import {
  ROBOTS,
  ROOMS,
  getRobot,
  getRoom,
  getScenario,
  type CameraMode,
  type ControlMode,
  type RobotId,
  type RoomId,
} from '../config/catalog';
import type { AppState } from '../app/AppStateMachine';
import type { ScoreBreakdown } from '../scoring/ScoreCalculator';
import type { RobotTaskVerb } from '../tasks/RobotTaskController';
import { getObjectiveGuidance } from '../training/TrainingGuidance';
import { getRobotControlHints } from './RobotControlGuide';

const CAMERA_OPTIONS: readonly Readonly<{ value: CameraMode; label: string }>[] = [
  { value: 'chase', label: 'CHASE' },
  { value: 'follow', label: 'CLOSE FOLLOW' },
  { value: 'first-person', label: 'FIRST PERSON' },
  { value: 'sensor', label: 'SENSOR' },
  { value: 'orbit', label: 'FREE ORBIT' },
  { value: 'carry', label: 'CARRY INSPECT' },
  { value: 'fixed', label: 'FIXED WORLD' },
  { value: 'overhead', label: 'OVERHEAD' },
];

export type OperatorCallbacks = {
  onContinue: () => void;
  onOpenRoster: () => void;
  onOpenSandbox: () => void;
  onExitSandbox: () => void;
  onResetSandbox: () => void;
  onRecenterSandboxView: () => void;
  onResetInspectionView: () => void;
  onCopyDiagnostics: () => void;
  onDownloadDiagnostics: () => void;
  onBack: () => void;
  onRobotSelected: (robotId: RobotId) => void;
  onRoomSelected: (roomId: RoomId) => void;
  onControlMode: (mode: ControlMode) => void;
  onLaunch: () => void;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onRetry: () => void;
  onReplay: () => void;
  onCameraMode: (mode: CameraMode) => void;
  onCameraCycle: () => void;
  onDebugLayer: (layer: string, enabled: boolean) => void;
  onClearEstop: () => void;
};

export type LiveUiSnapshot = {
  objective: string;
  objectiveInstruction: string;
  objectiveIndex: number;
  objectiveCount: number;
  elapsedSeconds: number;
  score: number;
  battery: number;
  speed: number;
  collisions: number;
  mode: ControlMode;
  cameraMode: CameraMode;
  safety: 'NOMINAL' | 'CAUTION' | 'E-STOP';
  fault: string;
  action: Readonly<{
    primaryVerb: RobotTaskVerb;
    primaryLabel: string;
    primaryStatus: string;
    primaryAvailable: boolean;
    secondaryLabel: string;
    secondaryAvailable: boolean;
    posture: string;
    postureAvailable: boolean;
    precisionActive: boolean;
  }>;
};

export type SandboxUiSnapshot = Pick<
  LiveUiSnapshot,
  'battery' | 'speed' | 'collisions' | 'cameraMode' | 'safety' | 'fault' | 'action'
> & {
  elapsedSeconds: number;
  containmentCorrections: number;
  targetLabel: string | null;
  heldLabel: string | null;
  carryMode: string | null;
  objectState: string;
  objectCount: number;
};

export class OperatorInterface {
  private score: ScoreBreakdown | null = null;
  private lastLiveSnapshot: LiveUiSnapshot | null = null;
  private lastSandboxSnapshot: SandboxUiSnapshot | null = null;
  private launchError: string | null = null;
  private readonly onClick = (event: MouseEvent) => this.handleClick(event);
  private readonly onChange = (event: Event) => this.handleChange(event);

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: OperatorCallbacks,
  ) {
    root.addEventListener('click', this.onClick);
    root.addEventListener('change', this.onChange);
  }

  render(state: Readonly<AppState>, score: ScoreBreakdown | null = this.score): void {
    this.score = score;
    const content = this.renderPhase(state, score);
    this.root.innerHTML = `
      <div class="ui-frame phase-${state.phase}">
        <div class="frame-corner frame-corner-tl"></div>
        <div class="frame-corner frame-corner-tr"></div>
        <div class="frame-corner frame-corner-bl"></div>
        <div class="frame-corner frame-corner-br"></div>
        ${content}
        <div class="build-stamp" aria-label="Build status">
          <span class="status-dot"></span>
          PRODUCTION QUALIFICATION / FAIL-CLOSED
        </div>
      </div>
    `;
    if ((state.phase === 'live' || state.phase === 'paused') && this.lastLiveSnapshot) {
      this.updateLive(this.lastLiveSnapshot);
    }
    if (state.phase === 'sandbox' && this.lastSandboxSnapshot) {
      this.updateSandbox(this.lastSandboxSnapshot);
    }
  }

  updateLive(snapshot: LiveUiSnapshot): void {
    this.lastLiveSnapshot = snapshot;
    this.setText('[data-live="objective"]', snapshot.objective);
    this.setText('[data-live="objective-instruction"]', snapshot.objectiveInstruction);
    this.setText(
      '[data-live="objective-index"]',
      `${String(snapshot.objectiveIndex).padStart(2, '0')} / ${String(snapshot.objectiveCount).padStart(2, '0')}`,
    );
    this.setText('[data-live="time"]', this.formatTime(snapshot.elapsedSeconds));
    this.setText('[data-live="score"]', String(Math.round(snapshot.score)).padStart(3, '0'));
    this.setText('[data-live="battery"]', `${snapshot.battery.toFixed(0)}%`);
    this.setText('[data-live="speed"]', `${snapshot.speed.toFixed(1)} m/s`);
    this.setText('[data-live="collisions"]', String(snapshot.collisions));
    this.setText('[data-live="mode"]', snapshot.mode.toUpperCase());
    this.setText('[data-live="camera"]', snapshot.cameraMode.toUpperCase());
    this.setValue('[data-camera-mode]', snapshot.cameraMode);
    this.setText('[data-live="safety"]', snapshot.safety);
    this.setText('[data-live="fault"]', snapshot.fault);
    this.root
      .querySelectorAll<HTMLElement>('[data-live="primary-action"]')
      .forEach((element) => (element.textContent = snapshot.action.primaryLabel));
    this.setText('[data-live="primary-status"]', snapshot.action.primaryStatus);
    this.root
      .querySelectorAll<HTMLElement>('[data-live="secondary-action"]')
      .forEach((element) => (element.textContent = snapshot.action.secondaryLabel));
    this.setText('[data-live="posture"]', snapshot.action.posture);
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-command="primary"]')
      .forEach((button) => (button.disabled = !snapshot.action.primaryAvailable));
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-command="secondary"]')
      .forEach((button) => (button.disabled = !snapshot.action.secondaryAvailable));
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-command="primary"]')
      .forEach((button) => (button.disabled = !snapshot.action.primaryAvailable));
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-command="secondary"]')
      .forEach((button) => (button.disabled = !snapshot.action.secondaryAvailable));
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-command="posture"]')
      .forEach((button) => (button.disabled = !snapshot.action.postureAvailable));
    this.root.querySelectorAll<HTMLElement>('[data-command="precision"]').forEach((element) => {
      if (snapshot.action.precisionActive) element.dataset.active = 'true';
      else delete element.dataset.active;
    });
    this.setStyle('[data-battery-fill]', '--value', `${snapshot.battery}%`);
    const safety = this.root.querySelector<HTMLElement>('[data-live="safety"]');
    if (safety) safety.dataset.state = snapshot.safety.toLowerCase();
  }

  updateSandbox(snapshot: SandboxUiSnapshot): void {
    this.lastSandboxSnapshot = snapshot;
    this.setText('[data-live="time"]', this.formatTime(snapshot.elapsedSeconds));
    this.setText('[data-live="battery"]', `${snapshot.battery.toFixed(0)}%`);
    this.setText('[data-live="speed"]', `${snapshot.speed.toFixed(1)} m/s`);
    this.setText('[data-live="collisions"]', String(snapshot.collisions));
    this.setText('[data-live="camera"]', snapshot.cameraMode.toUpperCase());
    this.setValue('[data-camera-mode]', snapshot.cameraMode);
    this.setText('[data-live="safety"]', snapshot.safety);
    this.setText('[data-live="fault"]', snapshot.fault);
    this.setText('[data-sandbox="corrections"]', String(snapshot.containmentCorrections));
    this.setText('[data-freeplay="target"]', snapshot.targetLabel ?? 'NONE');
    this.setText('[data-freeplay="held"]', snapshot.heldLabel ?? 'EMPTY');
    this.setText('[data-freeplay="carry-mode"]', snapshot.carryMode ?? 'READY');
    this.setText('[data-freeplay="state"]', snapshot.objectState);
    this.setText('[data-freeplay="count"]', String(snapshot.objectCount));
    this.root
      .querySelectorAll<HTMLElement>('[data-live="primary-action"]')
      .forEach((element) => (element.textContent = snapshot.action.primaryLabel));
    this.setText('[data-live="primary-status"]', snapshot.action.primaryStatus);
    this.root
      .querySelectorAll<HTMLElement>('[data-live="secondary-action"]')
      .forEach((element) => (element.textContent = snapshot.action.secondaryLabel));
    this.setText('[data-live="posture"]', snapshot.action.posture);
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-command="posture"]')
      .forEach((button) => (button.disabled = !snapshot.action.postureAvailable));
    this.setStyle('[data-battery-fill]', '--value', `${snapshot.battery}%`);
  }

  showLoadingProgress(progress: number, message: string): void {
    this.setText('[data-loading-message]', message);
    this.setStyle('[data-loading-fill]', '--value', `${Math.round(progress * 100)}%`);
    this.setText('[data-loading-value]', `${Math.round(progress * 100)}%`);
  }

  setScore(score: ScoreBreakdown): void {
    this.score = score;
  }

  setLaunchError(message: string | null): void {
    this.launchError = message;
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('change', this.onChange);
    this.root.replaceChildren();
  }

  private renderPhase(state: Readonly<AppState>, score: ScoreBreakdown | null): string {
    switch (state.phase) {
      case 'intro':
        return this.renderIntro();
      case 'robot-select':
        return this.renderRobotSelect(state.robotId);
      case 'sandbox-loading':
        return this.renderSandboxLoading(state);
      case 'sandbox':
        return this.renderSandbox(state);
      case 'room-select':
        return this.renderRoomSelect(state.roomId);
      case 'scenario-config':
        return this.renderScenarioConfig(state);
      case 'loading':
        return this.renderLoading(state);
      case 'live':
        return this.renderLive(state);
      case 'paused':
        return this.renderPause(state);
      case 'results':
        return this.renderResults(state, score);
      case 'replay':
        return this.renderReplay(state);
    }
  }

  private renderIntro(): string {
    return `
      <section class="intro-panel">
        <div class="forge-mark" aria-hidden="true">
          <span>F</span><i>5</i>
        </div>
        <p class="eyebrow">AUTONOMOUS SYSTEMS QUALIFICATION DIVISION</p>
        <h1>PROJECT<br /><span>FORGE-5</span></h1>
        <p class="intro-subtitle">Advanced Multi-Robot Training and Evaluation Center</p>
        <div class="intro-rule"><span></span><b>FACILITY SYSTEM 05</b><span></span></div>
        <button class="primary-action" type="button" data-action="continue">
          <span>ENTER FACILITY</span><kbd>↵</kbd>
        </button>
      </section>
    `;
  }

  private renderRobotSelect(selectedId: RobotId): string {
    const selected = getRobot(selectedId);
    return `
      ${this.topRail('PLATFORM ROSTER', 'SELECT ROBOT')}
      <section class="selection-layout">
        <aside class="selection-index" aria-label="Robot roster">
          ${ROBOTS.map(
            (robot, index) => `
              <button
                type="button"
                class="index-entry ${robot.id === selectedId ? 'is-selected' : ''}"
                data-action="select-robot"
                data-robot="${robot.id}"
                style="--accent:${robot.accent}"
              >
                <span>${String(index + 1).padStart(2, '0')}</span>
                <b>${robot.name}</b>
                <em>${robot.designation}</em>
              </button>
            `,
          ).join('')}
        </aside>
        <div class="selection-hero" style="--accent:${selected.accent}">
          <div class="hero-reticle"><span></span><i></i><b></b></div>
          <p>ACTIVE INSPECTION SUBJECT</p>
          <div class="inspection-view-controls">
            <span id="inspection-view-help">DRAG TO ORBIT · SCROLL / PINCH TO ZOOM</span>
            <button type="button" data-action="reset-inspection-view">RESET VIEW</button>
          </div>
          <h2>${selected.name} <small>${selected.designation}</small></h2>
          <strong>${selected.role}</strong>
          <div class="hero-scale">VALIDATED MINT ASSEMBLY · 1:1 METRIC ENVELOPE</div>
        </div>
        <aside class="spec-rail">
          <div class="spec-section">
            <span>LOCOMOTION</span><b>${selected.locomotion}</b>
          </div>
          <div class="spec-section">
            <span>MANIPULATION</span><b>${selected.manipulators}</b>
          </div>
          <div class="spec-grid">
            <div><span>ENVELOPE</span><b>${selected.dimensions}</b></div>
            <div><span>MASS</span><b>${selected.massClass}</b></div>
            <div><span>ENDURANCE</span><b>${selected.battery}</b></div>
          </div>
          <div class="tag-list">
            ${selected.sensors.map((sensor) => `<span>${sensor}</span>`).join('')}
          </div>
          <div class="capability-columns">
            <div><span>STRENGTHS</span>${selected.strengths.map((item) => `<b>+ ${item}</b>`).join('')}</div>
            <div><span>CONSTRAINTS</span>${selected.constraints.map((item) => `<b>− ${item}</b>`).join('')}</div>
          </div>
          <button class="primary-action compact" type="button" data-action="robot-confirm">
            <span>ASSIGN PLATFORM</span><kbd>→</kbd>
          </button>
          <button class="secondary-action sandbox-launch" type="button" data-action="open-sandbox">
            OPEN OUTDOOR WORLD
          </button>
          ${
            this.launchError
              ? `<div class="launch-error" role="alert"><i>!</i><p><b>OUTDOOR WORLD LOAD BLOCKED</b>${this.escapeHtml(this.launchError)}</p></div>`
              : ''
          }
        </aside>
      </section>
      ${this.backButton()}
    `;
  }

  private renderRoomSelect(selectedId: RoomId): string {
    return `
      ${this.topRail('TRAINING ENVIRONMENTS', 'SELECT ROOM')}
      <section class="room-selection">
        <div class="room-list">
          ${ROOMS.map(
            (room, index) => `
              <button
                type="button"
                class="room-entry ${room.id === selectedId ? 'is-selected' : ''}"
                data-action="select-room"
                data-room="${room.id}"
              >
                <span class="room-number">0${index + 1}</span>
                <div>
                  <small>${room.code}</small>
                  <h2>${room.name}</h2>
                  <p>${room.purpose}</p>
                </div>
                <i>↗</i>
              </button>
            `,
          ).join('')}
        </div>
        <aside class="room-brief">
          <p class="eyebrow">ENVIRONMENT PROFILE</p>
          <h3>${getRoom(selectedId).code}</h3>
          <p>${getRoom(selectedId).atmosphere}</p>
          <div class="layer-stack">
            <span>01 / VISUAL WORLD <b>PENDING</b></span>
            <span>02 / STATIC PHYSICS <b>ONLINE</b></span>
            <span>03 / NAVIGATION <b>ONLINE</b></span>
            <span>04 / SEMANTICS <b>PENDING</b></span>
            <span>05 / DYNAMIC ASSETS <b>PROXY</b></span>
            <span>06 / TRAINING LOGIC <b>ONLINE</b></span>
          </div>
          <button class="primary-action compact" type="button" data-action="room-confirm">
            <span>CONFIGURE SCENARIO</span><kbd>→</kbd>
          </button>
        </aside>
      </section>
      ${this.backButton()}
    `;
  }

  private renderScenarioConfig(state: Readonly<AppState>): string {
    const robot = getRobot(state.robotId);
    const room = getRoom(state.roomId);
    const scenario = getScenario(state.robotId, state.roomId);
    return `
      ${this.topRail('MISSION CONFIGURATION', `${robot.name} / ${room.code}`)}
      <section class="config-layout">
        <div class="scenario-copy">
          <p class="eyebrow">${scenario.id.toUpperCase()}</p>
          <h2>${scenario.name}</h2>
          <p>${scenario.summary}</p>
          <ol class="objective-sequence">
            ${scenario.objectives
              .map((objective, index) => {
                const guidance = getObjectiveGuidance(scenario, index + 1);
                return `<li><span>${String(index + 1).padStart(2, '0')}</span><div><b>${objective}</b><small>${this.escapeHtml(guidance.instruction)}</small></div></li>`;
              })
              .join('')}
          </ol>
        </div>
        <aside class="config-controls">
          <label>
            <span>CONTROL AUTHORITY</span>
            <select data-control-mode>
              ${(['manual', 'assisted', 'autonomous'] as const)
                .map(
                  (mode) =>
                    `<option value="${mode}" ${state.controlMode === mode ? 'selected' : ''}>${mode.toUpperCase()}</option>`,
                )
                .join('')}
            </select>
          </label>
          <div class="config-readout"><span>DETERMINISTIC SEED</span><b>${String(state.seed).padStart(6, '0')}</b></div>
          <div class="config-readout"><span>TIME LIMIT</span><b>${this.formatTime(scenario.timeLimitSeconds)}</b></div>
          <div class="config-readout"><span>SAFETY PROFILE</span><b>TRAINING / TIER 2</b></div>
          <div class="safety-note"><i>!</i><p>This browser simulation evaluates training behavior only. It is not a real-world safety certification.</p></div>
          ${
            this.launchError
              ? `<div class="launch-error" role="alert"><i>!</i><p><b>PRODUCTION GATE BLOCKED</b>${this.escapeHtml(this.launchError)}</p></div>`
              : ''
          }
          <button class="primary-action" type="button" data-action="launch">
            <span>INITIALIZE EPISODE</span><kbd>↗</kbd>
          </button>
        </aside>
      </section>
      ${this.backButton()}
    `;
  }

  private renderLoading(state: Readonly<AppState>): string {
    return `
      <section class="loading-panel">
        <div class="calibration-ring"><i></i><b></b><span></span></div>
        <p class="eyebrow">${getRoom(state.roomId).code} / ${getRobot(state.robotId).designation}</p>
        <h2>Calibrating training stack</h2>
        <p data-loading-message>Initializing fixed-step simulation…</p>
        <div class="loading-track"><i data-loading-fill style="--value:4%"></i></div>
        <b data-loading-value>04%</b>
        <div class="loading-checks">
          <span>PHYSICS</span><span>NAVIGATION</span><span>SEMANTICS</span><span>TELEMETRY</span>
        </div>
      </section>
    `;
  }

  private renderSandboxLoading(state: Readonly<AppState>): string {
    return `
      <section class="loading-panel">
        <div class="calibration-ring"><i></i><b></b><span></span></div>
        <p class="eyebrow">OUTDOOR FREEPLAY WORLD / ${getRobot(state.robotId).designation}</p>
        <h2>Streaming Robot Adventure Valley</h2>
        <p data-loading-message>Loading terrain and collision World…</p>
        <div class="loading-track"><i data-loading-fill style="--value:12%"></i></div>
        <b data-loading-value>12%</b>
        <div class="loading-checks">
          <span>RAD WORLD</span><span>COLLIDER</span><span>OBJECTS</span><span>CONTROLS</span>
        </div>
      </section>
    `;
  }

  private renderSandbox(state: Readonly<AppState>): string {
    const robot = getRobot(state.robotId);
    const controls = getRobotControlHints(state.robotId);
    const primaryVerb = 'PICK UP';
    return `
      <section class="live-hud sandbox-hud" style="--accent:${robot.accent}">
        <div class="hud-top-left">
          <div class="platform-id">
            <span>${robot.designation}</span>
            <div><b>${robot.name}</b><small>ROBOT ADVENTURE VALLEY</small></div>
          </div>
        </div>
        <div class="hud-top-center">
          <span>SANDBOX TIME</span>
          <b data-live="time">00:00.0</b>
          <i>OPEN-WORLD FREEPLAY</i>
        </div>
        <div class="hud-top-right sandbox-actions">
          <button class="secondary-action" type="button" data-action="recenter-sandbox-view">RESET VIEW</button>
          <button class="secondary-action" type="button" data-action="reset-sandbox">RESET</button>
          <button class="secondary-action" type="button" data-action="exit-sandbox">EXIT</button>
        </div>
        <aside class="sandbox-roster" aria-label="Switch test robot">
          ${ROBOTS.map(
            (entry) => `
              <button type="button" class="${entry.id === state.robotId ? 'is-selected' : ''}" data-action="select-robot" data-robot="${entry.id}">
                <b>${entry.name}</b><span>${entry.designation}</span>
              </button>
            `,
          ).join('')}
        </aside>
        <aside class="sandbox-task-panel">
          <p class="eyebrow">OBJECT INTERACTION</p>
          <div class="freeplay-object-readout">
            <span>TARGET <b data-freeplay="target">NONE</b></span>
            <span>HELD <b data-freeplay="held">EMPTY</b></span>
            <span>MODE <b data-freeplay="carry-mode">READY</b></span>
            <span>STATE <b data-freeplay="state">READY</b></span>
            <span>OBJECTS <b data-freeplay="count">6</b></span>
          </div>
          <div class="sandbox-diagnostics">
            <b>RECOVERIES <span data-sandbox="corrections">0</span></b>
            <button type="button" data-action="copy-diagnostics">COPY LOG</button>
            <button type="button" data-action="download-diagnostics">DOWNLOAD JSON</button>
          </div>
        </aside>
        <div class="hud-bottom-left">
          <div class="battery-arc">
            <span>BATTERY</span><b data-live="battery">100%</b>
            <i data-battery-fill style="--value:100%"></i>
          </div>
          <div class="drive-metrics">
            <span><b data-live="speed">0.0 m/s</b>VELOCITY</span>
            <span><b data-live="collisions">0</b>CONTACTS</span>
          </div>
        </div>
        <div class="hud-bottom-center">
          <div class="reticle"><i></i><b></b><span></span></div>
          <div class="action-command-bar" role="group" aria-label="${robot.name} sandbox actions">
            <button class="command-button command-primary" type="button" data-command="primary" data-touch-input="interact">
              <kbd>E</kbd><span data-live="primary-action">${primaryVerb}</span>
            </button>
            <button class="command-button" type="button" data-command="secondary" data-touch-input="secondary-action">
              <kbd>Q</kbd><span data-live="secondary-action">THROW</span>
            </button>
            ${
              state.robotId === 'axiom-h1'
                ? `<button class="command-button" type="button" data-command="posture" data-touch-input="posture"><kbd>Z</kbd><span data-live="posture">STANDING</span></button>`
                : ''
            }
            <button class="command-button command-hold" type="button" data-command="precision" data-touch-input="precision">
              <kbd>ALT</kbd><span>PRECISION</span>
            </button>
            <small data-live="primary-status">READY</small>
          </div>
          <div class="control-guide">
            ${controls.map((control) => `<span class="control-hint"><kbd>${control.keys}</kbd><b>${control.label}</b></span>`).join('')}
            <span class="control-hint"><kbd>WASD</kbd><b>MOVE WITH VIEW</b></span>
            <span class="control-hint"><kbd>SPACE</kbd><b>${state.robotId === 'kestrel-d5' ? 'ASCEND' : 'JUMP'}</b></span>
            <span class="control-hint"><kbd>LEFT DRAG</kbd><b>LOOK / ORBIT</b></span>
            <span class="control-hint"><kbd>RIGHT DRAG</kbd><b>PAN VIEW</b></span>
            <span class="control-hint"><kbd>WHEEL</kbd><b>ZOOM VIEW</b></span>
            <span class="control-hint"><kbd>C</kbd><b>NEXT VIEW</b></span>
          </div>
        </div>
        <div class="hud-bottom-right">
          <label class="camera-select">
            <span>VIEW</span>
            <select data-camera-mode aria-label="Sandbox camera view">
              ${CAMERA_OPTIONS.map(
                (option) =>
                  `<option value="${option.value}" ${option.value === 'orbit' ? 'selected' : ''}>${option.label}</option>`,
              ).join('')}
            </select>
          </label>
          <button class="camera-cycle" type="button" data-action="camera-cycle">NEXT VIEW / C</button>
          <details class="diagnostics-panel">
            <summary>DEBUG LAYERS</summary>
            ${['colliders', 'navigation', 'semantics', 'triggers'].map((layer) => `<label><input type="checkbox" data-debug-layer="${layer}" /> ${layer.toUpperCase()}</label>`).join('')}
          </details>
        </div>
        <div class="mobile-controls" aria-label="Touch sandbox controls">
          <div class="touch-move-pad" role="group" aria-label="Move robot">
            <button class="touch-control touch-forward" type="button" data-touch-input="forward" aria-label="Move forward">▲</button>
            <button class="touch-control touch-strafe-left" type="button" data-touch-input="strafe-left" aria-label="Strafe left">◀</button>
            <button class="touch-control touch-backward" type="button" data-touch-input="backward" aria-label="Move backward">▼</button>
            <button class="touch-control touch-strafe-right" type="button" data-touch-input="strafe-right" aria-label="Strafe right">▶</button>
          </div>
          <div class="touch-action-pad ${state.robotId === 'kestrel-d5' ? 'is-drone' : ''}" role="group" aria-label="Sandbox actions">
            <button class="touch-control touch-turn" type="button" data-touch-input="turn-left" aria-label="Turn left">↶</button>
            <button class="touch-control touch-turn" type="button" data-touch-input="turn-right" aria-label="Turn right">↷</button>
            ${
              state.robotId === 'kestrel-d5'
                ? `
                  <button class="touch-control touch-altitude" type="button" data-touch-input="ascend" aria-label="Ascend">↑</button>
                  <button class="touch-control touch-altitude" type="button" data-touch-input="descend" aria-label="Descend">↓</button>
                `
                : ''
            }
            ${
              state.robotId !== 'kestrel-d5'
                ? '<button class="touch-control touch-altitude" type="button" data-touch-input="jump" aria-label="Jump">JUMP</button>'
                : ''
            }
            <button class="touch-control touch-interact" type="button" data-touch-input="interact">PICK / PLACE</button>
            <button class="touch-control touch-secondary" type="button" data-touch-input="secondary-action">THROW</button>
            <button class="touch-control touch-estop" type="button" data-touch-input="emergency-stop">E-STOP</button>
          </div>
        </div>
        <div class="safety-strip">
          <span data-live="safety" data-state="nominal">NOMINAL</span>
          <b data-live="fault">OUTDOOR FREEPLAY READY</b>
          <button type="button" data-action="clear-estop">CLEAR E-STOP</button>
        </div>
      </section>
    `;
  }

  private renderLive(state: Readonly<AppState>): string {
    const robot = getRobot(state.robotId);
    const scenario = getScenario(state.robotId, state.roomId);
    const initialGuidance = getObjectiveGuidance(scenario, 1);
    const controlHints = getRobotControlHints(state.robotId);
    return `
      <section class="live-hud" style="--accent:${robot.accent}">
        <div class="hud-top-left">
          <div class="platform-id">
            <span>${robot.designation}</span>
            <div><b>${robot.name}</b><small>${getRoom(state.roomId).code}</small></div>
          </div>
          <div class="objective-cluster">
            <span data-live="objective-index">01 / ${String(scenario.objectives.length).padStart(2, '0')}</span>
            <b data-live="objective">${scenario.objectives[0]}</b>
            <small data-live="objective-instruction">${this.escapeHtml(initialGuidance.instruction)}</small>
          </div>
        </div>
        <div class="hud-top-center">
          <span>MISSION TIME</span>
          <b data-live="time">00:00.0</b>
          <i>${scenario.name}</i>
        </div>
        <div class="hud-top-right">
          <button class="icon-button" type="button" data-action="pause" aria-label="Pause">Ⅱ</button>
          <div class="score-cluster"><span>EVALUATION</span><b data-live="score">000</b></div>
        </div>
        <div class="hud-bottom-left">
          <div class="battery-arc">
            <span>BATTERY</span><b data-live="battery">100%</b>
            <i data-battery-fill style="--value:100%"></i>
          </div>
          <div class="drive-metrics">
            <span><b data-live="speed">0.0 m/s</b>VELOCITY</span>
            <span><b data-live="collisions">0</b>CONTACTS</span>
          </div>
        </div>
        <div class="hud-bottom-center">
          <div class="reticle"><i></i><b></b><span></span></div>
          <div class="action-command-bar" role="group" aria-label="${robot.name} task actions">
            <button class="command-button command-primary" type="button" data-command="primary" data-touch-input="interact">
              <kbd>E</kbd><span data-live="primary-action">${initialGuidance.taskVerb?.toUpperCase() ?? 'USE'}</span>
            </button>
            <button class="command-button" type="button" data-command="secondary" data-touch-input="secondary-action" disabled>
              <kbd>Q</kbd><span data-live="secondary-action">RELEASE / CANCEL</span>
            </button>
            ${
              state.robotId === 'axiom-h1'
                ? `<button class="command-button" type="button" data-command="posture" data-touch-input="posture"><kbd>Z</kbd><span data-live="posture">CROUCHED</span></button>`
                : ''
            }
            <button class="command-button command-hold" type="button" data-command="precision" data-touch-input="precision">
              <kbd>ALT</kbd><span>PRECISION</span>
            </button>
            <small data-live="primary-status">MOVE TO TASK MARKER</small>
          </div>
          <div class="control-guide" aria-label="${robot.name} keyboard controls">
            ${controlHints
              .map(
                (control) =>
                  `<span class="control-hint"><kbd>${control.keys}</kbd><b>${control.label}</b></span>`,
              )
              .join('')}
          </div>
        </div>
        <div class="hud-bottom-right">
          <div class="mode-readout"><span>CONTROL</span><b data-live="mode">${state.controlMode.toUpperCase()}</b></div>
          <label class="camera-select">
            <span>VIEW</span>
            <select data-camera-mode aria-label="Camera view">
              ${CAMERA_OPTIONS.map(
                (option) =>
                  `<option value="${option.value}" ${option.value === 'chase' ? 'selected' : ''}>${option.label}</option>`,
              ).join('')}
            </select>
          </label>
          <button class="camera-cycle" type="button" data-action="camera-cycle">NEXT VIEW / C</button>
        </div>
        <div class="mobile-controls" aria-label="Touch robot controls">
          <div class="touch-move-pad" role="group" aria-label="Move robot">
            <button class="touch-control touch-forward" type="button" data-touch-input="forward" aria-label="Move forward">▲</button>
            <button class="touch-control touch-strafe-left" type="button" data-touch-input="strafe-left" aria-label="Strafe left">◀</button>
            <button class="touch-control touch-backward" type="button" data-touch-input="backward" aria-label="Move backward">▼</button>
            <button class="touch-control touch-strafe-right" type="button" data-touch-input="strafe-right" aria-label="Strafe right">▶</button>
          </div>
          <div class="touch-action-pad ${state.robotId === 'kestrel-d5' ? 'is-drone' : ''}" role="group" aria-label="Turn and actions">
            <button class="touch-control touch-turn" type="button" data-touch-input="turn-left" aria-label="Turn left"><span aria-hidden="true">↶</span><small>TURN</small></button>
            <button class="touch-control touch-turn" type="button" data-touch-input="turn-right" aria-label="Turn right"><span aria-hidden="true">↷</span><small>TURN</small></button>
            ${
              state.robotId === 'kestrel-d5'
                ? `
                  <button class="touch-control touch-altitude" type="button" data-touch-input="ascend" aria-label="Ascend"><span aria-hidden="true">↑</span><small>UP</small></button>
                  <button class="touch-control touch-altitude" type="button" data-touch-input="descend" aria-label="Descend"><span aria-hidden="true">↓</span><small>DOWN</small></button>
                `
                : ''
            }
            <button class="touch-control touch-interact" type="button" data-command="primary" data-touch-input="interact"><span data-live="primary-action">USE</span></button>
            <button class="touch-control touch-secondary" type="button" data-command="secondary" data-touch-input="secondary-action" disabled><span data-live="secondary-action">CANCEL</span></button>
            ${
              state.robotId === 'axiom-h1'
                ? `<button class="touch-control touch-posture" type="button" data-command="posture" data-touch-input="posture"><span>POSTURE</span></button>`
                : ''
            }
            <button class="touch-control touch-precision" type="button" data-command="precision" data-touch-input="precision"><span>PRECISE</span></button>
            <button class="touch-control touch-estop" type="button" data-touch-input="emergency-stop" aria-label="Emergency stop">E-STOP</button>
          </div>
        </div>
        <div class="safety-strip">
          <span data-live="safety" data-state="nominal">NOMINAL</span>
          <b data-live="fault"></b>
          <button type="button" data-action="clear-estop">CLEAR E-STOP</button>
        </div>
      </section>
    `;
  }

  private renderPause(state: Readonly<AppState>): string {
    return `
      ${this.renderLive(state)}
      <section class="modal-backdrop">
        <div class="pause-panel">
          <p class="eyebrow">SIMULATION SUSPENDED</p>
          <h2>Operator pause</h2>
          <div class="pause-actions">
            <button class="primary-action compact" type="button" data-action="resume"><span>RESUME</span><kbd>ESC</kbd></button>
            <button class="secondary-action" type="button" data-action="abort">ABORT EPISODE</button>
          </div>
          <details class="diagnostics-panel">
            <summary>DEVELOPER LAYERS</summary>
            ${['colliders', 'navigation', 'semantics', 'triggers'].map((layer) => `<label><input type="checkbox" data-debug-layer="${layer}" /> ${layer.toUpperCase()}</label>`).join('')}
          </details>
        </div>
      </section>
    `;
  }

  private renderResults(state: Readonly<AppState>, score: ScoreBreakdown | null): string {
    const result = score ?? {
      completion: 0,
      time: 0,
      pathEfficiency: 0,
      energy: 0,
      safety: 0,
      taskAccuracy: 0,
      total: 0,
      rank: 'Qualification Failed' as const,
    };
    const rows = [
      ['COMPLETION', result.completion, 35],
      ['TIME', result.time, 15],
      ['PATH EFFICIENCY', result.pathEfficiency, 15],
      ['ENERGY', result.energy, 12],
      ['SAFETY', result.safety, 15],
      ['TASK ACCURACY', result.taskAccuracy, 8],
    ];
    return `
      ${this.topRail('EVALUATION REPORT', getScenario(state.robotId, state.roomId).id.toUpperCase())}
      <section class="results-layout">
        <div class="rank-emblem ${result.total < 50 ? 'is-failed' : ''}">
          <span>QUALIFICATION RANK</span>
          <b>${result.rank}</b>
          <strong>${String(result.total).padStart(3, '0')}</strong>
          <i>/ 100</i>
        </div>
        <div class="score-breakdown">
          ${rows
            .map(
              ([label, value, max]) => `
                <div class="score-row">
                  <span>${label}</span>
                  <i style="--value:${(Number(value) / Number(max)) * 100}%"></i>
                  <b>${String(value).padStart(2, '0')} / ${max}</b>
                </div>
              `,
            )
            .join('')}
        </div>
        <aside class="results-actions">
          <button class="primary-action compact" type="button" data-action="retry"><span>RETRY EPISODE</span><kbd>R</kbd></button>
          <button class="secondary-action" type="button" data-action="replay">REVIEW REPLAY</button>
          <button class="secondary-action" type="button" data-action="abort">CHANGE CONFIGURATION</button>
        </aside>
      </section>
    `;
  }

  private renderReplay(state: Readonly<AppState>): string {
    return `
      ${this.topRail('REPLAY REVIEW', getScenario(state.robotId, state.roomId).id.toUpperCase())}
      <section class="replay-hud">
        <div class="replay-timeline"><i style="--value:0%"></i><span>00:00.0</span><b>KEYFRAME REPLAY</b></div>
        <p>Replay is reconstructed from tick-stamped actions with periodic authoritative keyframes.</p>
        <button class="secondary-action" type="button" data-action="back">RETURN TO RESULTS</button>
      </section>
    `;
  }

  private topRail(section: string, status: string): string {
    return `
      <header class="top-rail">
        <div class="mini-mark">F<span>5</span></div>
        <b>${section}</b>
        <span class="rail-status"><i></i>${status}</span>
      </header>
    `;
  }

  private backButton(): string {
    return `<button class="back-action" type="button" data-action="back">← BACK</button>`;
  }

  private handleClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'continue') this.callbacks.onContinue();
    else if (action === 'back') this.callbacks.onBack();
    else if (action === 'select-robot' && target.dataset.robot)
      this.callbacks.onRobotSelected(target.dataset.robot as RobotId);
    else if (action === 'robot-confirm') this.callbacks.onOpenRoster();
    else if (action === 'open-sandbox') this.callbacks.onOpenSandbox();
    else if (action === 'exit-sandbox') this.callbacks.onExitSandbox();
    else if (action === 'reset-sandbox') this.callbacks.onResetSandbox();
    else if (action === 'recenter-sandbox-view') this.callbacks.onRecenterSandboxView();
    else if (action === 'reset-inspection-view') this.callbacks.onResetInspectionView();
    else if (action === 'copy-diagnostics') this.callbacks.onCopyDiagnostics();
    else if (action === 'download-diagnostics') this.callbacks.onDownloadDiagnostics();
    else if (action === 'select-room' && target.dataset.room)
      this.callbacks.onRoomSelected(target.dataset.room as RoomId);
    else if (action === 'room-confirm') this.callbacks.onOpenRoster();
    else if (action === 'launch') this.callbacks.onLaunch();
    else if (action === 'pause') this.callbacks.onPause();
    else if (action === 'resume') this.callbacks.onResume();
    else if (action === 'abort') this.callbacks.onAbort();
    else if (action === 'retry') this.callbacks.onRetry();
    else if (action === 'replay') this.callbacks.onReplay();
    else if (action === 'clear-estop') this.callbacks.onClearEstop();
    else if (action === 'camera-cycle') this.callbacks.onCameraCycle();
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.matches('[data-control-mode]')) {
      this.callbacks.onControlMode(target.value as ControlMode);
    } else if (target.matches('[data-camera-mode]')) {
      this.callbacks.onCameraMode(target.value as CameraMode);
    } else if (target instanceof HTMLInputElement && target.matches('[data-debug-layer]')) {
      this.callbacks.onDebugLayer(target.dataset.debugLayer ?? '', target.checked);
    }
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  private setStyle(selector: string, property: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    element?.style.setProperty(property, value);
  }

  private setValue(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (element) element.value = value;
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const remaining = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${minutes}:${remaining}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
