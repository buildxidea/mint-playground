import { ERAS } from "../brand/brand";

/**
 * One scroll timeline drives everything: continuous eraFloat for the WebGL
 * stage, per-chapter layer opacity/blur, active-section state, and the
 * opening/closing aerial reveals.
 *
 * The page is one continuous ramp rather than a series of holds: scroll
 * position maps linearly to plate rotation, and the copy layers crossfade
 * off that same value. Every wheel notch therefore moves everything by the
 * same small amount — no frozen stretches, no lurches. See `measure()`.
 */
export interface TimelineState {
  eraFloat: number;
  handoffT: number;
  activeIndex: number; // -1 hero, 0..5 eras, 6 finale
  heroT: number;
  finaleT: number;
  /** 1 = opening aerial shot, 0 = settled on the first car */
  introT: number;
  /** aerial ring framing amount — the intro and the finale share it */
  revealT: number;
}

export class ScrollTimeline {
  readonly state: TimelineState = {
    eraFloat: 0, handoffT: 0, activeIndex: -1, heroT: 0, finaleT: 0,
    introT: 1, revealT: 1,
  };
  private hero!: HTMLElement;
  private chapters: HTMLElement[] = [];
  private finale!: HTMLElement;
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private listeners = new Set<(s: TimelineState) => void>();

  /**
   * Smoothed read head. A wheel notch moves window.scrollY in one ~100px
   * jump, so anything derived straight from it steps. Everything here reads
   * `y` instead, which chases the real scroll position frame by frame — so
   * the car, the grade, the plate AND the DOM layer fades all glide off one
   * continuous value rather than each snapping on the notch.
   */
  private y = 0;
  private raf = 0;
  private lastT = 0;
  /** chase rate; lower is silkier and laggier. */
  private static readonly LAMBDA = 4.5;

  attach() {
    this.hero = document.getElementById("ch-hero")!;
    this.chapters = ERAS.map((e) => document.getElementById(`ch-${e.key}`)!);
    this.finale = document.getElementById("ch-finale")!;
    this.y = window.scrollY;
    window.addEventListener("scroll", () => this.wake(), { passive: true });
    window.addEventListener("resize", () => this.wake());
    // Safety net for browsers that throttle or suppress scroll events, and
    // for hidden tabs where rAF is paused entirely: snap and measure.
    let lastY = -1;
    setInterval(() => {
      if (window.scrollY !== lastY) {
        lastY = window.scrollY;
        if (document.hidden) this.refresh();
        else this.wake();
      }
    }, 150);
    this.refresh();
  }

  /**
   * Start the chase loop. It runs only while the read head is catching up,
   * then parks itself — no permanent rAF competing with the render loop.
   */
  private wake() {
    if (this.raf) return;
    this.lastT = performance.now();
    const step = (t: number) => {
      const dt = Math.min((t - this.lastT) / 1000, 0.1);
      this.lastT = t;
      const target = window.scrollY;

      if (this.reduced) this.y = target;
      else this.y += (target - this.y) * (1 - Math.exp(-ScrollTimeline.LAMBDA * dt));

      // close enough that another frame would be invisible: land it and stop
      if (Math.abs(target - this.y) < 0.05) {
        this.y = target;
        this.measure();
        this.raf = 0;
        return;
      }
      this.measure();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  onChange(fn: (s: TimelineState) => void) {
    this.listeners.add(fn);
  }

  /**
   * Push current state to every listener, synchronously. `attach()` measures
   * before anything subscribes, so boot must call this once everything is
   * wired — otherwise listeners sit on stale defaults until the first scroll,
   * which left the opening aerial shot unapplied on a fresh load at the top.
   */
  refresh() {
    this.y = window.scrollY;
    this.measure();
  }

  /** scroll so a given era chapter's hold zone is active */
  scrollToEra(index: number) {
    const el = this.chapters[index];
    if (!el) return;
    const y = el.offsetTop + (el.offsetHeight - window.innerHeight) * 0.25;
    window.scrollTo({ top: y, behavior: this.reduced ? "auto" : "smooth" });
  }

  /** local progress of a pinned section: 0 when pin starts, 1 when it ends */
  private progressOf(el: HTMLElement) {
    const span = el.offsetHeight - window.innerHeight;
    if (span <= 0) return 0;
    const p = (this.y - el.offsetTop) / span;
    return Math.min(1, Math.max(0, p));
  }


  /**
   * Scroll position at which chapter `i`'s car is exactly centred — the
   * middle of its pinned span, where its copy is fully legible.
   */
  private anchor(i: number) {
    const el = this.chapters[i];
    return el.offsetTop + (el.offsetHeight - window.innerHeight) * 0.5;
  }

  /**
   * The page maps to three consecutive, gap-free linear ranges, so every
   * pixel of scroll changes something and each wheel notch moves everything
   * by the same small amount:
   *
   *   top → anchor(0)      the opening camera descent      (introT 1 → 0)
   *   anchor(0) → anchor(5) the plate turning              (eraFloat 0 → 5)
   *   anchor(5) → page end  the closing aerial lift        (finaleT 0 → 1)
   *
   * The old model held each car motionless for half its chapter and then
   * swung the whole 60° in the other half — 69% of the page changed nothing
   * at all, and what did move, lurched. Linear means neither.
   */
  private measure() {
    const s = this.state;
    const last = this.chapters.length - 1;
    const a0 = this.anchor(0);
    const aLast = this.anchor(last);
    const pageEnd = document.documentElement.scrollHeight - window.innerHeight;
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

    s.heroT = this.progressOf(this.hero);

    // --- the plate: piecewise-linear between anchors, so eraFloat is exactly
    // i when chapter i is centred, and the rate stays constant throughout ---
    let eraFloat: number;
    if (this.y <= a0) eraFloat = 0;
    else if (this.y >= aLast) eraFloat = last;
    else {
      let i = 0;
      while (i < last && this.y >= this.anchor(i + 1)) i += 1;
      const lo = this.anchor(i);
      const hi = this.anchor(i + 1);
      eraFloat = i + (this.y - lo) / (hi - lo);
    }

    s.introT = this.reduced ? 0 : 1 - clamp01(a0 > 0 ? this.y / a0 : 1);
    s.finaleT = this.reduced
      ? 0
      : clamp01(pageEnd > aLast ? (this.y - aLast) / (pageEnd - aLast) : 0);
    s.revealT = Math.max(s.introT, s.finaleT);

    // --- copy layers crossfade off the same continuous value, so the text
    // responds to every notch too rather than snapping between chapters ---
    this.chapters.forEach((el, i) => {
      const pin = el.querySelector<HTMLElement>(".chapter__pin");
      if (!pin) return;
      const d = Math.abs(eraFloat - i);
      // full while the car is near centre, gone by the time the next one is
      const o = this.reduced ? 1 : clamp01((0.62 - d) / 0.42);
      pin.style.setProperty("--layer-opacity", o.toFixed(3));
      pin.style.setProperty("--layer-blur", this.reduced ? "0px" : `${((1 - o) * 14).toFixed(1)}px`);
      pin.classList.toggle("is-active", o > 0.02);
    });

    const heroPin = this.hero.querySelector<HTMLElement>(".chapter__pin");
    if (heroPin) {
      const o = this.reduced ? 1 : clamp01(s.introT / 0.55);
      heroPin.style.setProperty("--layer-opacity", o.toFixed(3));
      heroPin.style.setProperty("--layer-blur", this.reduced ? "0px" : `${((1 - o) * 10).toFixed(1)}px`);
      heroPin.classList.toggle("is-active", o > 0.02);
    }

    const finalePin = this.finale.querySelector<HTMLElement>(".chapter__pin");
    if (finalePin) {
      const o = this.reduced ? 1 : clamp01((s.finaleT - 0.12) / 0.4);
      finalePin.style.setProperty("--layer-opacity", o.toFixed(3));
      finalePin.style.setProperty("--layer-blur", this.reduced ? "0px" : `${((1 - o) * 10).toFixed(1)}px`);
      finalePin.classList.toggle("is-active", o > 0.02);
    }

    if (this.reduced) eraFloat = Math.round(eraFloat);

    s.eraFloat = eraFloat;
    s.handoffT = 0;
    s.activeIndex =
      s.finaleT > 0.6 ? ERAS.length
      : s.introT > 0.9 ? -1
      : Math.min(last, Math.max(0, Math.round(eraFloat)));
    this.listeners.forEach((fn) => fn(s));
  }

}
