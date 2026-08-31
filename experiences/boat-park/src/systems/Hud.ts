function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export class Hud {
  private readonly root = this.get('#hud');
  private readonly levelEl = this.get('#hud-level');
  private readonly speedEl = this.get('#hud-speed');
  private readonly damageFill = this.get('#hud-damage-fill');
  private readonly timerEl = this.get('#hud-timer');
  private readonly statusEl = this.get('#status-line');
  private readonly banner = this.get('#banner');
  private readonly bannerTitle = this.get('#banner-title');
  private readonly bannerSub = this.get('#banner-sub');
  private readonly bannerStars = this.get('#banner-stars');
  private readonly boostButton = this.get('#boost-button');
  private readonly pickerButton = this.get('#boat-picker-button');
  private readonly compass = this.get('#compass');
  private readonly compassDial = this.get('#compass-dial');
  private readonly compassLabel = this.get('#compass-label');
  private readonly compassDistance = this.get('#compass-distance');
  private readonly gatesEl = this.get('#hud-gates');
  private readonly penaltyEl = this.get('#hud-penalty');

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
    // The accelerate button belongs to the playing HUD, not the menu.
    this.boostButton.classList.toggle('is-visible', visible);
    this.pickerButton.classList.toggle('is-visible', visible);
    this.compass.classList.toggle('is-visible', visible);
    if (!visible) {
      this.boostButton.classList.remove('is-active');
      this.hideBanner();
    }
  }

  setLevel(name: string, index: number, total: number): void {
    this.levelEl.textContent = `${index + 1}/${total} · ${name}`;
  }

  update(speed: number, dockSpeed: number, damage: number, elapsed: number, boosting = false): void {
    const knots = Math.abs(speed) * 1.9438;
    this.speedEl.textContent = boosting ? `${knots.toFixed(1)} kn ▲` : `${knots.toFixed(1)} kn`;
    this.speedEl.classList.toggle('hud-ok', !boosting && Math.abs(speed) <= dockSpeed);
    this.speedEl.classList.toggle('hud-boost', boosting);
    this.boostButton.classList.toggle('is-active', boosting);
    this.damageFill.style.width = `${Math.min(100, damage).toFixed(0)}%`;
    this.damageFill.classList.toggle('hud-danger', damage >= 70);
    this.timerEl.textContent = formatTime(elapsed);
  }

  /**
   * Point the compass at the next objective.
   * `rotationDeg` is clockwise from straight ahead, so 0 means dead ahead.
   */
  setDirection(rotationDeg: number, label: string, distanceMeters: number, isBerth: boolean): void {
    this.compassDial.style.transform = `rotate(${rotationDeg.toFixed(1)}deg)`;
    this.compassLabel.textContent = label;
    this.compassDistance.textContent =
      distanceMeters >= 1000
        ? `${(distanceMeters / 1000).toFixed(1)} km`
        : `${Math.round(distanceMeters)} m`;
    this.compass.classList.toggle('is-berth', isBerth);
  }

  /** Gates cleared out of the total, plus any time penalty accrued. */
  setGates(cleared: number, total: number, penaltySeconds: number): void {
    this.gatesEl.textContent = `${cleared}/${total}`;
    this.penaltyEl.textContent = penaltySeconds > 0 ? `+${penaltySeconds}s` : '';
    this.penaltyEl.classList.toggle('is-visible', penaltySeconds > 0);
  }

  /** Green pulse for a clean gate, red for one barged past. */
  flashGate(cleared: boolean): void {
    this.gatesEl.classList.remove('gate-hit', 'gate-miss');
    void this.gatesEl.offsetWidth;
    this.gatesEl.classList.add(cleared ? 'gate-hit' : 'gate-miss');
  }

  /** Empty text hides the line entirely, so it only speaks when it matters. */
  setStatus(text: string): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('is-visible', text.length > 0);
  }

  flashDamage(): void {
    this.root.classList.remove('hud-hit');
    void this.root.offsetWidth;
    this.root.classList.add('hud-hit');
  }

  showDocked(boatName: string, stars: number, isLast: boolean): void {
    this.banner.hidden = false;
    this.banner.classList.remove('banner-fail');
    this.bannerTitle.textContent = `${boatName} moored`;
    this.bannerStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    this.bannerSub.textContent = isLast
      ? 'Fleet complete. Press R to sail again or Esc for menu.'
      : 'Press N for the next vessel · R to retry · Esc for menu';
  }

  showFailed(reason: string): void {
    this.banner.hidden = false;
    this.banner.classList.add('banner-fail');
    this.bannerTitle.textContent = 'Hull breached';
    this.bannerStars.textContent = '';
    this.bannerSub.textContent = `${reason} Press R to resume at the last gate · Esc for menu`;
  }

  hideBanner(): void {
    this.banner.hidden = true;
  }

  private get(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
