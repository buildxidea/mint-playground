import { CUBE_SIZES, CubeSize } from "../cube/constants";

/**
 * Landing overlay.
 *
 * The hero "art" is the live cube already in the scene, slowly auto-rotating
 * behind the text, so there is no separate render path and no static image to
 * keep in sync. The overlay itself is click-through except for its controls,
 * which lets the visitor spin the cube behind the copy.
 */

export interface LandingCallbacks {
  /** Start playing. A size means the visitor picked a specific cube. */
  onPlay(size?: CubeSize): void;
}

interface CubeCard {
  size: CubeSize;
  name: string;
  tag: string;
  note: string;
}

const CARDS: CubeCard[] = [
  { size: 2, name: "Pocket", tag: "Optimal", note: "Solved in 11 moves or fewer" },
  { size: 3, name: "Classic", tag: "Solvable", note: "Layer-by-layer solver" },
  { size: 4, name: "Double", tag: "Playable", note: "Solver not built yet" },
  { size: 5, name: "Triple", tag: "Playable", note: "Solver not built yet" },
  { size: 6, name: "Deep Cut", tag: "Playable", note: "Solver not built yet" },
];

const FACE_SWATCHES = ["#009b48", "#b90000", "#ffffff", "#ffd500", "#0045ad", "#ff5900"];

const HOW_TO_ROWS: Array<[string, string]> = [
  ["Drag the cube", "Turn whichever layer you grabbed"],
  ["Drag the background", "Orbit the view"],
  ["Scroll / pinch", "Zoom in and out"],
  ["U D L R F B", "Turn the up, down, left, right, front or back face"],
  ["Shift + letter", "Turn that face the other way"],
  ["2…6 then a face", "Turn an inner layer, counting in from that face"],
  ["Space", "Scramble"],
];

export class Landing {
  private readonly root: HTMLDivElement;
  private readonly modal: HTMLDivElement;
  private dismissed = false;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: LandingCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "landing";

    const scrim = document.createElement("div");
    scrim.className = "landing-scrim";

    this.root.append(scrim, this.buildTop(), this.buildHero(), this.buildCards());

    this.modal = this.buildModal();
    this.root.append(this.modal);

    parent.append(this.root);

    window.addEventListener("keydown", this.onKey);
  }

  private buildTop(): HTMLElement {
    const top = document.createElement("header");
    top.className = "landing-top";

    const brand = document.createElement("div");
    brand.className = "brand";
    const mark = document.createElement("span");
    mark.className = "brand-mark";
    for (const color of FACE_SWATCHES.slice(0, 3)) {
      const cell = document.createElement("i");
      cell.style.background = color;
      mark.append(cell);
    }
    const name = document.createElement("span");
    name.textContent = "Rubix";
    brand.append(mark, name);

    const how = document.createElement("button");
    how.type = "button";
    how.className = "btn btn-ghost btn-small";
    how.textContent = "HOW TO PLAY";
    how.addEventListener("click", () => this.openModal());

    top.append(brand, how);
    return top;
  }

  private buildHero(): HTMLElement {
    const hero = document.createElement("div");
    hero.className = "landing-hero";

    const title = document.createElement("h1");
    title.className = "wordmark";
    title.textContent = "rubix";

    const blurb = document.createElement("p");
    blurb.className = "blurb";
    blurb.textContent =
      "Five cubes, 2×2 up to 6×6. Grab any layer and turn it, scramble the " +
      "whole thing, then watch the solver take it apart move by move.";

    const row = document.createElement("div");
    row.className = "cta-row";

    const play = document.createElement("button");
    play.type = "button";
    play.className = "btn btn-primary";
    play.textContent = "PLAY";
    play.addEventListener("click", () => this.play());

    const how = document.createElement("button");
    how.type = "button";
    how.className = "btn btn-ghost";
    how.textContent = "HOW TO PLAY";
    how.addEventListener("click", () => this.openModal());

    row.append(play, how);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.append("or press ", kbd("Enter"), " · turn with ");
    for (const key of ["U", "D", "L", "R", "F", "B"]) hint.append(kbd(key));

    hero.append(title, blurb, row, hint);
    return hero;
  }

  private buildCards(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "landing-cards";

    const label = document.createElement("div");
    label.className = "cards-label";
    label.textContent = "THE CUBES";

    const list = document.createElement("div");
    list.className = "cards";

    for (const card of CARDS) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "card";
      el.setAttribute("aria-label", `Play the ${card.size}x${card.size} cube`);

      const head = document.createElement("div");
      head.className = "card-head";
      const size = document.createElement("span");
      size.className = "card-size";
      size.textContent = `${card.size}×${card.size}`;
      const tag = document.createElement("span");
      tag.className = "card-tag";
      tag.textContent = card.tag.toUpperCase();
      tag.dataset.tag = card.tag.toLowerCase();
      head.append(size, tag);

      const name = document.createElement("div");
      name.className = "card-name";
      name.textContent = card.name;

      const meta = document.createElement("div");
      meta.className = "card-meta";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      // A little grid standing in for the cube's face, sized to the puzzle.
      const cells = Math.min(card.size, 4);
      swatch.style.gridTemplateColumns = `repeat(${cells}, 1fr)`;
      for (let i = 0; i < cells * cells; i++) {
        const cell = document.createElement("i");
        cell.style.background = FACE_SWATCHES[i % FACE_SWATCHES.length];
        swatch.append(cell);
      }
      const note = document.createElement("span");
      note.textContent = card.note;
      meta.append(swatch, note);

      el.append(head, name, meta);
      el.addEventListener("click", () => this.play(card.size));
      list.append(el);
    }

    wrap.append(label, list);
    return wrap;
  }

  private buildModal(): HTMLDivElement {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.hidden = true;

    const sheet = document.createElement("div");
    sheet.className = "sheet";

    const title = document.createElement("h2");
    title.textContent = "How to play";

    const grid = document.createElement("div");
    grid.className = "sheet-rows";
    for (const [key, what] of HOW_TO_ROWS) {
      grid.append(kbd(key), text(what));
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn-primary btn-small";
    close.textContent = "GOT IT";
    close.addEventListener("click", () => this.closeModal());

    sheet.append(title, grid, close);
    modal.append(sheet);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) this.closeModal();
    });
    return modal;
  }

  private openModal(): void {
    this.modal.hidden = false;
  }

  private closeModal(): void {
    this.modal.hidden = true;
  }

  private onKey = (event: KeyboardEvent): void => {
    if (this.dismissed) return;
    if (event.key === "Escape" && !this.modal.hidden) {
      this.closeModal();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      this.play();
    }
  };

  private play(size?: CubeSize): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.root.classList.add("leaving");
    window.removeEventListener("keydown", this.onKey);
    // Let the fade finish before the overlay stops taking up the DOM.
    setTimeout(() => this.root.remove(), 420);
    this.callbacks.onPlay(size);
  }
}

function kbd(label: string): HTMLElement {
  const el = document.createElement("kbd");
  el.textContent = label;
  return el;
}

function text(value: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = value;
  return el;
}

export { CUBE_SIZES };
