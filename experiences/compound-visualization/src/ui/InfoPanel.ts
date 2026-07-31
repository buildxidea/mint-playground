import type { Element, Molecule } from "../types";
import { CATEGORY_LABELS } from "../data/elements";

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function rows(pairs: Array<[string, string]>): string {
  return pairs
    .map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`)
    .join("");
}

/**
 * Inspection card in the right column. Shows a hint until an atom or bond is
 * picked, then the selection's chemistry.
 */
export class InfoPanel {
  readonly root = document.createElement("div");
  private body!: HTMLDivElement;
  private titleEl!: HTMLSpanElement;

  constructor() {
    this.root.className = "panel details-panel";
    this.build();
  }

  private build(): void {
    const title = document.createElement("div");
    title.className = "panel-title";
    this.titleEl = document.createElement("span");
    this.titleEl.textContent = "Selection";
    title.appendChild(this.titleEl);
    this.root.appendChild(title);

    this.body = document.createElement("div");
    this.body.className = "details-body";
    this.root.appendChild(this.body);
  }

  /** Idle state: describe the molecule and how to inspect it. */
  showDefault(mol: Molecule): void {
    this.titleEl.textContent = "Selection";
    this.body.innerHTML = `<p class="details-text">
      Click any atom to read its element properties, or a bond for its order and
      length. Enable <strong>Measure</strong> to pick two atoms for a distance or
      three for an angle. Drag to rotate ${mol.name}; scroll to zoom.
    </p>`;
  }

  showAtom(el: Element): void {
    this.titleEl.textContent = "Atom";
    this.body.innerHTML = `
      <div class="details-head">
        <span class="details-sym" style="background:${hex(el.cpkColor)}">${el.symbol}</span>
        <div>
          <div class="details-name">${el.name}</div>
          <div class="details-sub">${CATEGORY_LABELS[el.category]}</div>
        </div>
      </div>
      ${rows([
        ["Atomic number", String(el.number)],
        ["Atomic mass", `${el.mass} u`],
        [
          "Electronegativity",
          el.electronegativity != null ? String(el.electronegativity) : "—",
        ],
        ["Covalent radius", `${el.covalentRadius} Å`],
        ["Van der Waals radius", `${el.vdwRadius} Å`],
        ["State (STP)", el.state],
        ["Group / period", `${el.group || "f-block"} / ${el.period}`],
      ])}`;
  }

  showBond(symA: string, symB: string, order: number, length: number): void {
    this.titleEl.textContent = "Bond";
    const names = ["", "Single", "Double", "Triple"];
    this.body.innerHTML = rows([
      ["Atoms", `${symA} — ${symB}`],
      ["Bond order", names[order] ?? String(order)],
      ["Bond length", `${length.toFixed(3)} Å`],
    ]);
  }
}
