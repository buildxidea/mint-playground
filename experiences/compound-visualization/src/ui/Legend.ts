import type { Molecule } from "../types";
import { getElement } from "../data/elements";

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Composition breakdown: each element in the molecule with its atom count. */
export class Legend {
  readonly root = document.createElement("div");
  private list!: HTMLDivElement;

  constructor(private readonly onCollapse: () => void) {
    this.root.className = "panel legend-panel";
    this.build();
  }

  private build(): void {
    const title = document.createElement("div");
    title.className = "panel-title";
    title.innerHTML = `<span>Composition</span>`;
    const collapse = document.createElement("button");
    collapse.className = "icon-btn";
    collapse.title = "Hide details";
    collapse.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 17H7M17 17V7"/></svg>`;
    collapse.onclick = () => this.onCollapse();
    title.appendChild(collapse);
    this.root.appendChild(title);

    this.list = document.createElement("div");
    this.list.className = "legend-list";
    this.root.appendChild(this.list);
  }

  update(mol: Molecule): void {
    const counts = new Map<string, number>();
    for (const a of mol.atoms) counts.set(a.element, (counts.get(a.element) ?? 0) + 1);

    const symbols = [...counts.keys()].sort(
      (a, b) => getElement(a).number - getElement(b).number,
    );

    this.list.innerHTML = symbols
      .map((sym) => {
        const el = getElement(sym);
        return `
        <div class="legend-item">
          <div class="legend-info">
            <span class="color-dot" style="background:${hex(el.cpkColor)}"></span>
            <span class="legend-name">${el.name} (${el.symbol})</span>
          </div>
          <span class="legend-count">${counts.get(sym)}</span>
        </div>`;
      })
      .join("");
  }
}
