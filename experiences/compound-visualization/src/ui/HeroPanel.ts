import type { Molecule } from "../types";
import { molarMass } from "../data/pubchem";

/** Large title card: molecule name, formula, and headline figures. */
export class HeroPanel {
  readonly root = document.createElement("div");
  private title!: HTMLHeadingElement;
  private formula!: HTMLDivElement;
  private stats!: HTMLDivElement;

  constructor() {
    this.root.className = "panel hero-panel";
    this.build();
  }

  private build(): void {
    this.title = document.createElement("h1");
    this.title.className = "hero-title";

    this.formula = document.createElement("div");
    this.formula.className = "hero-formula";

    this.stats = document.createElement("div");
    this.stats.className = "hero-stats";

    this.root.append(this.title, this.formula, this.stats);
  }

  update(mol: Molecule): void {
    this.title.textContent = mol.name;
    this.formula.textContent = `${mol.formula} · ${mol.category}`;

    const mass = mol.formulaWeight ?? molarMass(mol);
    const massLabel = mol.formulaWeight ? "Molar mass (formula unit)" : "Molar mass";
    const rows: Array<[string, string, string]> = [
      [mass.toFixed(mass < 100 ? 3 : 2), "g/mol", massLabel],
      [String(mol.atoms.length), "", "Atoms"],
      [String(mol.bonds.length), "", "Bonds"],
    ];

    this.stats.innerHTML = rows
      .map(
        ([value, unit, label]) => `
        <div class="stat-group">
          <div class="stat-value">${value}${unit ? ` <span class="stat-unit">${unit}</span>` : ""}</div>
          <div class="stat-label">${label}</div>
        </div>`,
      )
      .join("");
  }
}
