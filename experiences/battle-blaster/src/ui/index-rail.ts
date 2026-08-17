import { WEAPONS } from "../data/arsenal";
import type { AppState } from "../app/state";

const pad = (n: number) => String(n + 1).padStart(2, "0");

/** Left rail: display heading over a numbered index of the arsenal. */
export class IndexRail {
  private rows = new Map<string, HTMLButtonElement>();
  private meta: HTMLElement;

  constructor(root: HTMLElement, private state: AppState) {
    root.innerHTML = "";

    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Arsenal index / 2026";

    const heading = document.createElement("h1");
    heading.className = "display";
    heading.textContent = "Five casters. One arsenal.";

    const list = document.createElement("div");
    list.className = "index-list";
    WEAPONS.forEach((weapon, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "index-row";
      row.innerHTML =
        `<span class="num">${pad(index)}</span>` +
        `<span class="index-name"></span>` +
        `<span class="arrow" aria-hidden="true">&#8627;</span>`;
      row.querySelector<HTMLElement>(".index-name")!.textContent = weapon.name;
      row.addEventListener("click", () => this.state.selectWeapon(weapon.id));
      this.rows.set(weapon.id, row);
      list.appendChild(row);
    });

    this.meta = document.createElement("p");
    this.meta.className = "rail-meta";

    root.append(eyebrow, heading, list, this.meta);
    this.refresh();
  }

  refresh(): void {
    const weapon = this.state.currentWeapon;
    for (const [id, row] of this.rows) {
      const active = id === weapon.id;
      row.classList.toggle("active", active);
      row.setAttribute("aria-current", active ? "true" : "false");
    }
    this.meta.textContent = weapon.meta;
  }
}
