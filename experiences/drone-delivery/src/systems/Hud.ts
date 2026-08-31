import type * as THREE from 'three';

export interface HudState {
  routeName: string;
  objective: string;
  elapsed: number;
  delivered: number;
  totalDeliveries: number;
  batteryPct: number;
  hullPct: number;
  windAngle: number;
  windSpeed: number;
  altitude: number;
  packageLabel: string | null;
  packageColor: THREE.Color | null;
}

export class Hud {
  private readonly root = this.get('#hud');
  private readonly routeName = this.get('#route-name');
  private readonly objectiveLine = this.get('#objective-line');
  private readonly timerValue = this.get('#timer-value');
  private readonly deliveryCount = this.get('#delivery-count');
  private readonly batteryFill = this.get('#battery-fill');
  private readonly hullFill = this.get('#hull-fill');
  private readonly windArrow = this.get('#wind-arrow');
  private readonly windSpeed = this.get('#wind-speed');
  private readonly altitudeValue = this.get('#altitude-value');
  private readonly packageChip = this.get('#package-chip');
  private readonly centerMessage = this.get('#center-message');
  private readonly targetIndicator = this.get('#target-indicator');
  private readonly targetArrow = this.get('#target-arrow');
  private readonly targetDistance = this.get('#target-distance');
  private messageTimer = 0;

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  update(state: HudState): void {
    this.routeName.textContent = state.routeName;
    this.objectiveLine.textContent = state.objective;
    const minutes = Math.floor(state.elapsed / 60).toString().padStart(2, '0');
    const seconds = Math.floor(state.elapsed % 60).toString().padStart(2, '0');
    this.timerValue.textContent = `${minutes}:${seconds}`;
    this.deliveryCount.textContent = `${state.delivered}/${state.totalDeliveries}`;

    const battery = Math.max(0, Math.min(100, state.batteryPct));
    this.batteryFill.style.width = `${battery}%`;
    this.batteryFill.classList.toggle('low', battery < 25);
    this.hullFill.style.width = `${Math.max(0, Math.min(100, state.hullPct))}%`;

    this.windArrow.style.transform = `rotate(${state.windAngle}rad)`;
    this.windSpeed.textContent = state.windSpeed.toFixed(1);
    this.altitudeValue.textContent = `${Math.max(0, state.altitude).toFixed(0)}m`;

    if (state.packageLabel && state.packageColor) {
      this.packageChip.textContent = state.packageLabel;
      this.packageChip.style.background = `#${state.packageColor.getHexString()}`;
      this.packageChip.style.color = '#ffffff';
    } else {
      this.packageChip.textContent = '—';
      this.packageChip.style.background = '';
      this.packageChip.style.color = '';
    }
  }

  /**
   * Waypoint indicator. On-target mode pins a bouncing down-arrow over the
   * pad; edge mode clamps the arrow to the screen border, rotated to point at
   * the objective. `angle` is radians in screen space (0 = pointing right).
   */
  updateTargetIndicator(
    state: { x: number; y: number; angle: number; distance: number; onScreen: boolean } | null,
  ): void {
    this.targetIndicator.hidden = state === null;
    if (!state) return;
    this.targetIndicator.style.transform = `translate(calc(${state.x.toFixed(1)}px - 50%), calc(${state.y.toFixed(1)}px - 50%))`;
    this.targetIndicator.classList.toggle('on-target', state.onScreen);
    const degrees = state.onScreen ? 90 : (state.angle * 180) / Math.PI;
    this.targetArrow.style.transform = `rotate(${degrees.toFixed(1)}deg)`;
    this.targetDistance.textContent = `${Math.max(1, Math.round(state.distance))} m`;
  }

  /** Show a transient centre message; duration in seconds (0 = sticky). */
  showMessage(text: string, duration = 2.2): void {
    this.centerMessage.textContent = text;
    this.centerMessage.hidden = false;
    this.messageTimer = duration;
  }

  clearMessage(): void {
    this.centerMessage.hidden = true;
    this.messageTimer = 0;
  }

  tickMessage(delta: number): void {
    if (this.centerMessage.hidden || this.messageTimer <= 0) return;
    this.messageTimer -= delta;
    if (this.messageTimer <= 0) this.centerMessage.hidden = true;
  }

  private get(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
