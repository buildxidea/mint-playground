export interface RunStats {
  readonly coverage: number;
  readonly timeMs: number;
  readonly refills: number;
  readonly strokes: number;
  readonly coloursUsed: number;
}

export interface ResultsHandlers {
  readonly onReplay: () => void;
  readonly onRestart: () => void;
  /** 0..1 across the room's world-X extent. */
  readonly onWipe: (fraction: number) => void;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * The payoff screen: stats card, the before/after wipe, and the entry point to
 * the time-lapse replay.
 *
 * The wipe is not a screenshot comparison — it drives a uniform on the wall
 * material, so the "before" side is the live grime with the paint layer masked
 * off. That is why it costs nothing and stays pixel-accurate at any camera angle.
 */
export class Results {
  readonly root: HTMLElement;

  private readonly handle: HTMLElement;
  private readonly card: HTMLElement;
  private readonly statsRow: HTMLElement;
  private readonly buttonRow: HTMLElement;

  private bounds = { left: 0, right: 1 };
  private handleX = 0;
  private dragging = false;
  private introHandle = 0;

  constructor(parent: HTMLElement, private readonly handlers: ResultsHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'overlay results';

    const before = document.createElement('div');
    before.className = 'edge-label before';
    before.textContent = 'BEFORE';
    const after = document.createElement('div');
    after.className = 'edge-label after';
    after.textContent = 'AFTER';

    this.handle = document.createElement('div');
    this.handle.className = 'wipe-handle';
    const knob = document.createElement('div');
    knob.className = 'knob';
    knob.textContent = '↔';
    this.handle.append(knob);

    const banner = document.createElement('div');
    banner.className = 'replay-banner';
    banner.textContent = 'TIME-LAPSE';

    this.card = document.createElement('div');
    this.card.className = 'stats-card';

    const heading = document.createElement('h2');
    heading.className = 'chunky';
    heading.textContent = 'Room Done';

    this.statsRow = document.createElement('div');
    this.statsRow.className = 'stats-row';

    this.buttonRow = document.createElement('div');
    this.buttonRow.className = 'button-row';

    const replayButton = document.createElement('button');
    replayButton.className = 'chunky-button';
    replayButton.type = 'button';
    replayButton.textContent = 'Replay';
    replayButton.addEventListener('click', () => this.handlers.onReplay());

    const restartButton = document.createElement('button');
    restartButton.className = 'chunky-button primary';
    restartButton.type = 'button';
    restartButton.textContent = 'Paint Again';
    restartButton.addEventListener('click', () => this.handlers.onRestart());

    this.buttonRow.append(replayButton, restartButton);
    this.card.append(heading, this.statsRow, this.buttonRow);
    this.root.append(before, after, this.handle, banner, this.card);
    parent.append(this.root);

    this.handle.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('visible', visible);
    if (!visible) this.reset();
  }

  reset(): void {
    cancelAnimationFrame(this.introHandle);
    this.dragging = false;
    this.root.classList.remove('showing-wipe', 'showing-card', 'replaying');
    this.handle.classList.remove('nudge');
  }

  /**
   * Where the wall's left and right edges land on screen, so the handle maps
   * onto wall UV rather than onto the viewport.
   */
  setWipeBounds(left: number, right: number): void {
    this.bounds = { left, right };
  }

  private applyHandle(x: number, emit = true): void {
    const { left, right } = this.bounds;
    const clamped = Math.max(left, Math.min(right, x));
    this.handleX = clamped;
    this.handle.style.left = `${clamped}px`;
    if (emit) {
      const span = right - left;
      // A degenerate span means the wall is edge-on; show all paint, not all grime.
      this.handlers.onWipe(span <= 0 ? 0 : (clamped - left) / span);
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.root.classList.contains('replaying')) return;
    this.dragging = true;
    cancelAnimationFrame(this.introHandle);
    this.handle.classList.remove('nudge');
    this.handle.setPointerCapture(event.pointerId);
    this.applyHandle(event.clientX);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.applyHandle(event.clientX);
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  showCard(stats: RunStats): void {
    this.statsRow.replaceChildren();
    const entries: Array<[string, string]> = [
      ['Coverage', `${Math.floor(stats.coverage * 100)}%`],
      ['Time', formatTime(stats.timeMs)],
      ['Refills', String(stats.refills)],
      ['Strokes', String(stats.strokes)],
      ['Colours', String(stats.coloursUsed)],
    ];
    for (const [label, value] of entries) {
      const stat = document.createElement('div');
      stat.className = 'stat';
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = value;
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = label;
      stat.append(n, k);
      this.statsRow.append(stat);
    }

    this.root.classList.add('showing-card', 'showing-wipe');
    this.playIntroWipe();
  }

  /**
   * Slide the handle in from the fully-painted edge so the grime is revealed
   * rather than just sitting there. This is the moment the whole level is for.
   */
  private playIntroWipe(): void {
    const { left, right } = this.bounds;
    const from = left;
    const to = left + (right - left) * 0.5;
    const duration = 900;
    const start = performance.now();

    this.applyHandle(from);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      this.applyHandle(from + (to - from) * easeOutCubic(t));
      if (t < 1) {
        this.introHandle = requestAnimationFrame(step);
      } else {
        this.handle.classList.add('nudge');
      }
    };
    this.introHandle = requestAnimationFrame(step);
  }

  setReplaying(replaying: boolean): void {
    this.root.classList.toggle('replaying', replaying);
    if (replaying) {
      cancelAnimationFrame(this.introHandle);
      this.handle.classList.remove('nudge');
      // The replay must show the whole wall filling in, so nothing is masked.
      this.handlers.onWipe(0);
    } else {
      this.playIntroWipe();
    }
  }

  get wipeHandleX(): number {
    return this.handleX;
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }
}
