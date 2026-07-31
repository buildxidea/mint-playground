/**
 * Overlay layout: a left and right column of glass panels over the canvas.
 * Either column collapses to a slim edge tab so the model can be seen alone.
 */
export class Shell {
  readonly root = document.createElement("div");
  readonly leftCol = document.createElement("div");
  readonly rightCol = document.createElement("div");
  private readonly leftTab: HTMLButtonElement;
  private readonly rightTab: HTMLButtonElement;

  constructor() {
    this.root.className = "overlay-ui";
    this.leftCol.className = "left-col";
    this.rightCol.className = "right-col";

    this.leftTab = this.makeTab("Library", "left");
    this.rightTab = this.makeTab("Details", "right");

    this.root.append(this.leftTab, this.leftCol, this.rightCol, this.rightTab);
  }

  private makeTab(label: string, side: "left" | "right"): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `edge-tab edge-tab-${side}`;
    b.innerHTML = `<span class="edge-chevron">${side === "left" ? "›" : "‹"}</span><span class="edge-label">${label}</span>`;
    b.title = `Show ${label.toLowerCase()}`;
    b.onclick = () => this.setCollapsed(side, false);
    return b;
  }

  setCollapsed(side: "left" | "right", collapsed: boolean): void {
    const col = side === "left" ? this.leftCol : this.rightCol;
    const tab = side === "left" ? this.leftTab : this.rightTab;
    col.classList.toggle("collapsed", collapsed);
    tab.classList.toggle("visible", collapsed);
  }
}
