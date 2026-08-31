import type { RouteDef } from '../world/routes';
import type { Progress } from '../game/progress';
import type { ScoreResult } from '../game/scoring';

export interface ScreenCallbacks {
  onSelectRoute(routeId: number): void;
  onRetry(): void;
  onNext(): void;
  onMenu(): void;
  onResume(): void;
}

/** Menu, results, help, and loading overlays. Pure DOM, no Three.js. */
export class Screens {
  private readonly menu = this.get('#menu-screen');
  private readonly pause = this.get('#pause-screen');
  private readonly results = this.get('#results-screen');
  private readonly help = this.get('#help-screen');
  private readonly loading = this.get('#loading-screen');
  private readonly loadingStatus = this.get('#loading-status');
  private readonly startRouteLabel = this.get('#start-route-label');
  private readonly resultsTitle = this.get('#results-title');
  private readonly resultsStars = this.get('#results-stars');
  private readonly resultsBreakdown = this.get('#results-breakdown');
  private readonly nextButton = this.get('#next-button') as HTMLButtonElement;

  private startRouteId = 1;

  constructor(private readonly callbacks: ScreenCallbacks) {
    this.get('#retry-button').addEventListener('click', () => callbacks.onRetry());
    this.nextButton.addEventListener('click', () => callbacks.onNext());
    this.get('#menu-button').addEventListener('click', () => callbacks.onMenu());
    this.get('#help-close').addEventListener('click', () => this.toggleHelp(false));
    const start = () => callbacks.onSelectRoute(this.startRouteId);
    this.get('#start-button').addEventListener('click', start);
    this.get('#start-button-2').addEventListener('click', start);

    this.get('#resume-button').addEventListener('click', () => callbacks.onResume());
    this.get('#pause-controls-button').addEventListener('click', () => this.toggleHelp(true));
    this.get('#pause-restart-button').addEventListener('click', () => callbacks.onRetry());
    this.get('#pause-menu-button').addEventListener('click', () => callbacks.onMenu());
  }

  setPaused(paused: boolean): void {
    this.pause.hidden = !paused;
    if (!paused) this.toggleHelp(false);
  }

  /** Programmatic Start — used when the player presses Enter on the landing page. */
  clickStart(): void {
    if (this.menu.hidden) return;
    this.callbacks.onSelectRoute(this.startRouteId);
  }

  setLoading(status: string | null): void {
    this.loading.hidden = status === null;
    if (status !== null) this.loadingStatus.textContent = status;
  }

  /**
   * Landing page: Start continues progression — the first route without stars,
   * or the last route once everything has been starred.
   */
  showMenu(routes: RouteDef[], progress: Progress): void {
    this.results.hidden = true;
    this.menu.hidden = false;
    this.menu.scrollTop = 0;
    const next = routes.find((route) => (progress[route.id] ?? 0) === 0) ?? routes[routes.length - 1];
    this.startRouteId = next.id;
    const earned = Object.values(progress).reduce((a, b) => a + b, 0);
    this.startRouteLabel.textContent =
      earned > 0
        ? `Up next — Route ${next.id}: ${next.name} · ${earned}★ earned`
        : `Route ${next.id}: ${next.name} — ${next.tagline}`;
  }

  hideMenu(): void {
    this.menu.hidden = true;
  }

  showResults(routeName: string, result: ScoreResult | null, hasNext: boolean): void {
    this.results.hidden = false;
    if (result) {
      this.resultsTitle.textContent = `${routeName} complete!`;
      this.resultsStars.textContent = `${'★'.repeat(result.stars)}${'☆'.repeat(3 - result.stars)}`;
      const b = result.breakdown;
      this.resultsBreakdown.innerHTML = `
        <span>Delivery time</span><strong>${b.time.toFixed(0)}/30</strong>
        <span>Package condition</span><strong>${b.condition.toFixed(0)}/30</strong>
        <span>Battery remaining</span><strong>${b.battery.toFixed(0)}/20</strong>
        <span>Landing accuracy</span><strong>${b.accuracy.toFixed(0)}/20</strong>
        <span>Penalties</span><strong>-${b.penalty.toFixed(0)}</strong>
        <span>Total</span><strong>${result.score}/100</strong>
      `;
    } else {
      this.resultsTitle.textContent = `${routeName} failed`;
      this.resultsStars.textContent = '☆☆☆';
      this.resultsBreakdown.innerHTML = '<span>Drone down</span><strong>Try again!</strong>';
    }
    this.nextButton.hidden = !hasNext || !result;
  }

  hideResults(): void {
    this.results.hidden = true;
  }

  toggleHelp(force?: boolean): boolean {
    const show = force ?? this.help.hidden === true;
    this.help.hidden = !show;
    return show;
  }

  private get(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing screen element: ${selector}`);
    return element;
  }
}
