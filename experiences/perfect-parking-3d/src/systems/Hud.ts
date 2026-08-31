export type HudPlayState = {
  challengeName: string;
  challengeIndex: number;
  challengeCount: number;
  timer: number;
  align: number;
  insideBay: boolean;
  collisions: number;
  lineViolations: number;
  starsPreview: number;
  status: string;
  countdown: string | null;
};

export class Hud {
  private readonly overlay = this.el('#overlay');
  private readonly overlayTitle = this.el('#overlay-title');
  private readonly overlayBody = this.el('#overlay-body');
  private readonly overlayActions = this.el('#overlay-actions');
  private readonly playHud = this.el('#play-hud');
  private readonly challengeLabel = this.el('#challenge-label');
  private readonly timerValue = this.el('#timer-value');
  private readonly alignFill = this.el('#align-fill');
  private readonly alignValue = this.el('#align-value');
  private readonly collisionValue = this.el('#collision-value');
  private readonly starsValue = this.el('#stars-value');
  private readonly statusLine = this.el('#status-line');
  private readonly countdownOverlay = this.el('#countdown-overlay');
  private readonly countdownValue = this.el('#countdown-value');
  private readonly loading = this.el('#loading');
  private readonly loadingText = this.el('#loading-text');

  setLoading(visible: boolean, text = 'Loading…'): void {
    this.loading.hidden = !visible;
    this.loadingText.textContent = text;
  }

  showOverlay(
    title: string,
    body: string,
    actions: Array<{ id: string; label: string; primary?: boolean }>,
  ): void {
    this.overlay.hidden = false;
    this.playHud.hidden = true;
    this.overlayTitle.textContent = title;
    this.overlayBody.innerHTML = body;
    this.overlayActions.innerHTML = '';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.action = action.id;
      btn.textContent = action.label;
      btn.className = action.primary ? 'btn primary' : 'btn';
      this.overlayActions.appendChild(btn);
    }
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
    this.playHud.hidden = false;
  }

  onAction(handler: (action: string) => void): void {
    this.overlayActions.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      const action = target?.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action) handler(action);
    });
  }

  updatePlay(state: HudPlayState): void {
    this.challengeLabel.textContent = `${state.challengeIndex}/${state.challengeCount} · ${state.challengeName}`;
    this.timerValue.textContent = formatTime(state.timer);
    const pct = Math.round(state.align * 100);
    this.alignFill.style.width = `${pct}%`;
    this.alignValue.textContent = `${pct}%`;
    this.alignFill.classList.toggle('is-fit', state.insideBay);
    this.alignValue.classList.toggle('is-fit', state.insideBay);
    this.collisionValue.textContent = String(state.collisions + state.lineViolations);
    this.starsValue.textContent = '★'.repeat(state.starsPreview) + '☆'.repeat(3 - state.starsPreview);
    this.statusLine.textContent = state.status;
    this.updateCountdown(state.countdown);
  }

  private updateCountdown(value: string | null): void {
    this.countdownOverlay.hidden = value === null;
    if (value === null || this.countdownValue.textContent === value) return;
    this.countdownValue.textContent = value;
    this.countdownValue.classList.remove('is-ticking');
    // Restart the short tick animation for each new number without moving HUD layout.
    void this.countdownValue.offsetWidth;
    this.countdownValue.classList.add('is-ticking');
  }

  private el(selector: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  }
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
