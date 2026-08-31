import type { ScoreBreakdown } from './ScoringSystem';
import type { DockingStatus } from './DockingZoneSystem';
import type { TrafficThreat } from './TrafficSystem';
import type { WindSample } from './WindSystem';
import { difficultyLabel, type LevelDef } from '../levels/LevelDef';

export type HudEnvironmentState = {
  wind: WindSample;
  swell: number;
  wake: number;
  trafficCount: number;
  trafficThreat: TrafficThreat | null;
};

export class Hud {
  private readonly levelName = this.el('#level-name');
  private readonly levelSub = this.el('#level-sub');
  private readonly timerValue = this.el('#timer-value');
  private readonly damageValue = this.el('#damage-value');
  private readonly damageMetric = this.el('#damage-meter');
  private readonly statusLine = this.el('#status-line');
  private readonly holdFill = this.el('#hold-fill');
  private readonly holdMeter = this.el('#hold-meter');
  private readonly starsRow = this.el('#stars-row');
  private readonly resultPanel = this.el('#result-panel');
  private readonly resultTitle = this.el('#result-title');
  private readonly resultDetail = this.el('#result-detail');
  private readonly windArrow = this.el('#wind-arrow');
  private readonly windValue = this.el('#wind-value');
  private readonly swellValue = this.el('#swell-value');
  private readonly trafficValue = this.el('#traffic-value');
  private readonly trafficMeter = this.el('#traffic-meter');
  private readonly swellMeter = this.el('#swell-meter');
  private readonly muteBtn = this.el('#mute-button');
  private readonly menu = this.el('#menu-panel');
  private readonly loading = this.el('#loading-panel');
  private readonly levelOptions = this.el('#level-options');
  private readonly failurePanel = this.el('#failure-panel');
  private readonly failureTitle = this.el('#failure-title');
  private readonly failureDetail = this.el('#failure-detail');
  private readonly levelButtons: HTMLButtonElement[] = [];

  setLoading(visible: boolean, message?: string): void {
    this.loading.classList.toggle('hidden', !visible);
    if (message) this.loading.querySelector('p')!.textContent = message;
  }

  showMenu(visible: boolean): void {
    this.menu.classList.toggle('hidden', !visible);
  }

  configureLevelPicker(
    levels: readonly LevelDef[],
    selectedIndex: number,
    onSelect: (index: number) => void,
  ): void {
    this.levelOptions.replaceChildren();
    this.levelButtons.length = 0;
    levels.forEach((level, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'level-option';
      button.dataset.level = String(index);
      button.setAttribute('aria-pressed', index === selectedIndex ? 'true' : 'false');

      const identity = document.createElement('span');
      identity.className = 'level-option-name';
      identity.textContent = `${level.id}. ${level.name}`;
      const difficulty = document.createElement('span');
      difficulty.className = 'level-option-difficulty';
      difficulty.textContent = `${difficultyLabel(level.difficulty.rank)} · ${level.difficulty.rank}/${levels.length}`;
      button.append(identity, difficulty);
      button.addEventListener('click', () => {
        this.setSelectedLevel(index);
        onSelect(index);
      });
      this.levelButtons.push(button);
      this.levelOptions.append(button);
    });
  }

  setSelectedLevel(index: number): void {
    this.levelButtons.forEach((button, buttonIndex) => {
      button.setAttribute('aria-pressed', buttonIndex === index ? 'true' : 'false');
    });
  }

  setLevel(name: string, subtitle: string, index: number, total: number): void {
    this.levelName.textContent = `${index}/${total} · ${name}`;
    this.levelSub.textContent = subtitle;
    this.resultPanel.classList.add('hidden');
    this.failurePanel.classList.add('hidden');
  }

  update(
    elapsed: number,
    damage: number,
    damageBudget: number,
    docking: DockingStatus,
    environment: HudEnvironmentState,
    paused: boolean,
  ): void {
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
    this.timerValue.textContent = `${minutes}:${seconds}`;
    this.damageValue.textContent = `${damage.toFixed(1)} / ${damageBudget.toFixed(1)}`;
    const damageRatio = damage / Math.max(damageBudget, 0.01);
    this.damageMetric.classList.toggle('warning', damageRatio >= 0.7 && damageRatio < 1);
    this.damageMetric.classList.toggle('critical', damageRatio >= 1);

    const angle = Math.atan2(environment.wind.direction.x, environment.wind.direction.z);
    this.windArrow.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;
    this.windArrow.style.opacity = environment.wind.strength < 0.02 ? '0.25' : '1';
    this.windArrow.title = `Live wind ${environment.wind.strength.toFixed(2)}`;
    this.windValue.textContent = windLabel(environment.wind.strength);
    this.swellValue.textContent = swellLabel(environment.swell);

    const threat = environment.trafficThreat;
    const trafficAlert = Boolean(threat?.closing && threat.distance < 8);
    this.trafficMeter.classList.toggle('alert', trafficAlert);
    this.swellMeter.classList.toggle('alert', environment.wake > 0.3);
    this.trafficValue.textContent =
      environment.trafficCount === 0
        ? 'Clear'
        : trafficAlert
          ? `${Math.max(1, Math.round(threat!.distance))}m`
          : `${environment.trafficCount} active`;

    this.holdMeter.classList.toggle('active', docking.inside || docking.holdProgress > 0);
    this.holdFill.style.transform = `scaleX(${docking.holdProgress})`;

    if (paused) {
      this.statusLine.textContent = 'Paused';
    } else if (docking.complete) {
      this.statusLine.textContent = 'Docked!';
    } else if (docking.inside && !docking.slowEnough) {
      this.statusLine.textContent = 'Too fast — ease off';
    } else if (docking.inside && !docking.aligned) {
      this.statusLine.textContent = 'Straighten up';
    } else if (docking.inside) {
      this.statusLine.textContent =
        environment.swell > 0.45 ? 'Hold against the swell…' : 'Hold steady…';
    } else if (environment.wake > 0.3) {
      this.statusLine.textContent = 'Crossing wake — counter the roll';
    } else if (trafficAlert) {
      this.statusLine.textContent = 'Traffic crossing — choose your gap';
    } else if (environment.swell > 0.55) {
      this.statusLine.textContent = 'Rough water — counter the waves into the slip';
    } else {
      this.statusLine.textContent = 'Aim for the glowing green slip';
    }
  }

  setShowcaseHint(active: boolean): void {
    if (active) {
      this.resultDetail.dataset.showcase = '1';
    } else {
      delete this.resultDetail.dataset.showcase;
    }
  }

  setStatus(message: string): void {
    this.statusLine.textContent = message;
  }

  showFailure(levelName: string, damage: number, damageBudget: number): void {
    this.failurePanel.classList.remove('hidden');
    this.failureTitle.textContent = 'Boat Sunk';
    this.failureDetail.textContent = `${levelName} · Hull damage ${damage.toFixed(1)} / ${damageBudget.toFixed(1)}`;
  }

  hideFailure(): void {
    this.failurePanel.classList.add('hidden');
  }

  showResult(score: ScoreBreakdown, levelName: string, hasNext: boolean): void {
    this.resultPanel.classList.remove('hidden');
    this.resultTitle.textContent = levelName;
    this.starsRow.textContent = '★'.repeat(score.stars) + '☆'.repeat(3 - score.stars);
    if (this.resultDetail.dataset.showcase === '1') {
      this.resultDetail.textContent = `Showcase · Time ${score.timeSeconds.toFixed(1)}s · Next berth shortly · Esc to exit`;
      return;
    }
    this.resultDetail.textContent = hasNext
      ? `Time ${score.timeSeconds.toFixed(1)}s · Damage ${score.damage.toFixed(1)} · Tap Next or press Enter`
      : `Harbor complete · Time ${score.timeSeconds.toFixed(1)}s · Damage ${score.damage.toFixed(1)} · Press R to replay`;
  }

  setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? 'Sound off' : 'Sound on';
  }

  private el(selector: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Missing HUD node: ${selector}`);
    return node;
  }
}

function windLabel(strength: number): string {
  if (strength < 0.025) return 'Calm';
  if (strength < 0.11) return 'Breeze';
  if (strength < 0.2) return 'Gusty';
  return 'Strong';
}

function swellLabel(strength: number): string {
  if (strength < 0.1) return 'Light';
  if (strength < 0.28) return 'Rolling';
  if (strength < 0.5) return 'Choppy';
  return 'Heavy';
}
