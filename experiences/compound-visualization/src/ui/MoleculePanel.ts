import type { Molecule } from "../types";
import { MOLECULES } from "../data/molecules";

export interface MoleculePanelCallbacks {
  onSelect: (mol: Molecule) => void;
  onSearch: (name: string) => void;
  onCollapse: () => void;
}

/** Structural library: PubChem search plus the bundled molecule list. */
export class MoleculePanel {
  readonly root = document.createElement("div");
  private listEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private input!: HTMLInputElement;

  constructor(private readonly cb: MoleculePanelCallbacks) {
    this.root.className = "panel library-panel";
    this.build();
  }

  private build(): void {
    const title = document.createElement("div");
    title.className = "panel-title";
    title.innerHTML = `<span>Structural Library</span>`;
    const collapse = document.createElement("button");
    collapse.className = "icon-btn";
    collapse.title = "Hide library";
    collapse.innerHTML = `<svg viewBox="0 0 24 24"><path d="M17 7L7 17M7 17h10M7 17V7"/></svg>`;
    collapse.onclick = () => this.cb.onCollapse();
    title.appendChild(collapse);
    this.root.appendChild(title);

    const searchWrap = document.createElement("form");
    searchWrap.className = "search";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "Search PubChem…";
    const go = document.createElement("button");
    go.type = "submit";
    go.textContent = "Find";
    searchWrap.append(this.input, go);
    searchWrap.onsubmit = (e) => {
      e.preventDefault();
      const q = this.input.value.trim();
      if (q) this.cb.onSearch(q);
    };
    this.root.appendChild(searchWrap);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "status hidden";
    this.root.appendChild(this.statusEl);

    this.listEl = document.createElement("div");
    this.listEl.className = "molecule-list";
    for (const mol of MOLECULES) {
      const item = document.createElement("button");
      item.className = "molecule-tab";
      item.innerHTML = `<span class="tab-name">${mol.name}</span><span class="tab-formula">${mol.formula} · ${mol.category}</span>`;
      item.onclick = () => this.cb.onSelect(mol);
      this.listEl.appendChild(item);
    }
    this.root.appendChild(this.listEl);
  }

  setStatus(text: string | null, kind: "info" | "error" = "info"): void {
    if (!text) {
      this.statusEl.classList.add("hidden");
      return;
    }
    this.statusEl.textContent = text;
    this.statusEl.classList.remove("hidden");
    this.statusEl.classList.toggle("error", kind === "error");
  }

  update(mol: Molecule): void {
    for (const el of this.listEl.querySelectorAll(".molecule-tab")) {
      const name = el.querySelector(".tab-name")?.textContent;
      el.classList.toggle("active", name === mol.name);
    }
  }
}
