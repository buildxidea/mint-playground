/**
 * Craft chooser.
 *
 * Cycling through seven aircraft one `X` at a time works, but it makes picking
 * the one you want a matter of counting — and the further down the list a craft
 * sits the worse it gets. Holding `X` opens this instead: everything on screen
 * at once, pick with the mouse or the arrow keys.
 *
 * It latches open rather than closing on release. A hold-to-show wheel that
 * commits on release cannot be used with the mouse, and using the mouse was
 * half the point.
 */

export interface CraftOption {
  id: string;
  label: string;
  /** One line on what flying it is like — this is what makes the grid useful. */
  blurb: string;
}

export class CraftPicker {
  visible = false;
  /** Called with the chosen id when the pilot commits. */
  onPick?: (id: string) => void;
  /**
   * Called whenever the chooser closes, however it closed.
   *
   * Every exit has to run through one place. Piloting is suspended while this
   * is up, and the backdrop-click path used to close without telling anyone —
   * which left the aircraft permanently unflyable for anyone who dismissed the
   * chooser by clicking beside it.
   */
  onClose?: () => void;

  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly cards: HTMLElement[] = [];
  private options: CraftOption[] = [];
  private index = 0;

  constructor(container: HTMLElement, options: CraftOption[]) {
    this.root = document.createElement("div");
    this.root.className = "picker";
    this.root.hidden = true;

    const card = document.createElement("div");
    card.className = "picker-card";

    const title = document.createElement("h2");
    title.textContent = "Choose a craft";
    card.appendChild(title);

    this.grid = document.createElement("div");
    this.grid.className = "picker-grid";
    card.appendChild(this.grid);

    const hint = document.createElement("p");
    hint.className = "picker-hint";
    hint.textContent = "← → ↑ ↓ to move · Enter to fly it · Esc to cancel";
    card.appendChild(hint);

    this.root.appendChild(card);
    container.appendChild(this.root);

    // Clicking the backdrop is a cancel, the same as Esc. Without this the
    // only way out of a modal opened by accident is to find the right key.
    this.root.addEventListener("pointerdown", (event) => {
      if (event.target === this.root) this.close();
    });

    this.setOptions(options);
  }

  setOptions(options: CraftOption[]) {
    this.options = options;
    this.grid.replaceChildren();
    this.cards.length = 0;

    options.forEach((option, i) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "picker-cell";

      const name = document.createElement("span");
      name.className = "picker-name";
      name.textContent = option.label;
      cell.appendChild(name);

      const blurb = document.createElement("span");
      blurb.className = "picker-blurb";
      blurb.textContent = option.blurb;
      cell.appendChild(blurb);

      // Hover moves the highlight so the mouse and the keyboard drive the same
      // piece of state — otherwise the two disagree about what is selected.
      cell.addEventListener("pointerenter", () => this.select(i));
      cell.addEventListener("click", () => {
        this.select(i);
        this.commit();
      });

      this.grid.appendChild(cell);
      this.cards.push(cell);
    });
  }

  /** Show the chooser, starting on whatever is currently being flown. */
  open(current: string) {
    const at = this.options.findIndex((option) => option.id === current);
    this.index = at === -1 ? 0 : at;
    this.visible = true;
    this.root.hidden = false;
    this.paint();
  }

  close() {
    if (!this.visible) return;
    this.visible = false;
    this.root.hidden = true;
    this.onClose?.();
  }

  /** Move the highlight, wrapping at both ends. */
  move(delta: number) {
    if (!this.options.length) return;
    const count = this.options.length;
    this.select((this.index + delta + count) % count);
  }

  /** Number of cells per row, for making ↑/↓ move by a row. */
  get columns(): number {
    if (this.cards.length < 2) return 1;
    const top = this.cards[0].offsetTop;
    let n = 0;
    for (const cell of this.cards) {
      if (cell.offsetTop !== top) break;
      n += 1;
    }
    return Math.max(1, n);
  }

  commit() {
    const chosen = this.options[this.index];
    this.close();
    if (chosen) this.onPick?.(chosen.id);
  }

  private select(index: number) {
    this.index = index;
    this.paint();
  }

  private paint() {
    this.cards.forEach((cell, i) => {
      cell.classList.toggle("is-selected", i === this.index);
    });
    this.cards[this.index]?.focus({ preventScroll: true });
  }

  dispose() {
    this.root.remove();
  }
}
