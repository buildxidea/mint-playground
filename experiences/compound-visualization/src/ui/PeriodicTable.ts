import type { Element, ElementCategory } from "../types";
import { CATEGORY_COLORS, CATEGORY_LABELS, ELEMENTS, stateAt } from "../data/elements";
import {
  PROPERTY_MODES,
  STATE_COLORS,
  STATE_LABELS,
  UNKNOWN_COLOR,
  extentOf,
  kelvinTo,
  normalize,
  rampColor,
  type PropertyMode,
  type TempUnit,
} from "../data/elementProperties";

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

const TEMP_SUFFIX: Record<TempUnit, string> = { K: "K", C: "°C", F: "°F" };

/**
 * Interactive periodic table overlay: category / heat-map / phase colouring,
 * a temperature slider, search, and per-element detail.
 *
 * `render()` is the single writer of every cell's appearance — all controls
 * mutate state and re-render, so colouring, search and molecule highlighting
 * can never fight each other.
 */
export class PeriodicTable {
  readonly root = document.createElement("div");

  private cells = new Map<string, HTMLButtonElement>();
  private detail!: HTMLDivElement;
  private legend!: HTMLDivElement;
  private modeSelect!: HTMLSelectElement;
  private scaleRow!: HTMLDivElement;
  private scaleBtn!: HTMLButtonElement;

  // --- state ---
  private mode: PropertyMode = PROPERTY_MODES[0];
  private temperatureK = 298;
  private unit: TempUnit = "K";
  private useLog = false;
  private query = "";
  private categoryFilter: ElementCategory | null = null;
  private present = new Set<string>();
  private selected: Element | null = null;

  constructor() {
    this.root.className = "pt-overlay hidden";
    this.build();
    this.render();
  }

  // --- construction ---------------------------------------------------------

  private build(): void {
    const backdrop = document.createElement("div");
    backdrop.className = "pt-backdrop";
    backdrop.onclick = () => this.close();
    this.root.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.className = "pt-panel";

    const head = document.createElement("div");
    head.className = "pt-head";
    head.innerHTML = `<span class="pt-title">Periodic Table</span>`;
    const close = document.createElement("button");
    close.className = "pt-close";
    close.textContent = "×";
    close.onclick = () => this.close();
    head.appendChild(close);
    panel.appendChild(head);

    panel.appendChild(this.buildToolbar());
    panel.appendChild(this.buildGrid());

    this.legend = document.createElement("div");
    this.legend.className = "pt-legend";
    panel.appendChild(this.legend);

    this.detail = document.createElement("div");
    this.detail.className = "pt-detail hidden";
    panel.appendChild(this.detail);

    this.root.appendChild(panel);
  }

  private buildToolbar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "pt-toolbar";

    // Property selector
    const select = document.createElement("select");
    select.className = "pt-select";
    for (const m of PROPERTY_MODES) {
      const opt = document.createElement("option");
      opt.value = m.key;
      opt.textContent = m.label;
      select.appendChild(opt);
    }
    select.onchange = () => {
      this.mode = PROPERTY_MODES.find((m) => m.key === select.value) ?? PROPERTY_MODES[0];
      this.useLog = this.mode.log ?? false;
      this.render();
    };
    bar.appendChild(select);

    // Search
    const search = document.createElement("input");
    search.type = "search";
    search.className = "pt-search";
    search.placeholder = "Search element…";
    search.oninput = () => {
      this.query = search.value.trim().toLowerCase();
      this.render();
    };
    bar.appendChild(search);

    // Linear / log toggle (numeric modes only)
    this.scaleRow = document.createElement("div");
    this.scaleRow.className = "pt-control hidden";
    this.scaleBtn = document.createElement("button");
    this.scaleBtn.className = "pt-chip";
    this.scaleBtn.onclick = () => {
      this.useLog = !this.useLog;
      this.render();
    };
    this.scaleRow.appendChild(this.scaleBtn);
    bar.appendChild(this.scaleRow);

    // The temperature itself is controlled from the Settings panel; this table
    // just reads it via setTemperature() / setTempUnit().
    this.modeSelect = select;
    return bar;
  }

  private buildGrid(): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "pt-grid";

    for (const el of ELEMENTS) {
      const cell = document.createElement("button");
      cell.className = "pt-cell";
      cell.innerHTML =
        `<span class="pt-num">${el.number}</span>` +
        `<span class="pt-sym">${el.symbol}</span>` +
        `<span class="pt-mass"></span>`;
      const { col, row } = placement(el);
      cell.style.gridColumn = String(col);
      cell.style.gridRow = String(row);
      cell.onclick = () => {
        this.selected = el;
        this.showDetail(el);
      };
      grid.appendChild(cell);
      this.cells.set(el.symbol, cell);
    }

    grid.appendChild(strip("57–71", 3, 6));
    grid.appendChild(strip("89–103", 3, 7));
    return grid;
  }

  // --- rendering ------------------------------------------------------------

  /** Sole owner of every cell's colour and dim/highlight state. */
  private render(): void {
    const numeric = !!this.mode.value;
    const extent = numeric ? extentOf(this.mode) : null;

    this.scaleRow.classList.toggle("hidden", !numeric);
    this.scaleBtn.textContent = this.useLog ? "Log" : "Linear";

    for (const el of ELEMENTS) {
      const cell = this.cells.get(el.symbol);
      if (!cell) continue;

      cell.style.background = this.colorFor(el, extent);

      // Secondary line: the value in the current mode (mass by default).
      const sub = cell.querySelector(".pt-mass") as HTMLElement | null;
      if (sub) sub.textContent = this.subLabel(el);

      const matches = this.matches(el);
      const present = this.present.has(el.symbol);
      // An active search or category filter owns the dimming outright;
      // otherwise fall back to dimming elements absent from the molecule.
      const filtering = !!this.query || !!this.categoryFilter;
      const dim = filtering
        ? !matches
        : this.present.size > 0 && !present;
      cell.classList.toggle("dim", dim);
      cell.classList.toggle("present", present && matches);
    }

    this.renderLegend(extent);
  }

  private colorFor(
    el: Element,
    extent: { min: number; max: number } | null,
  ): string {
    if (this.mode.key === "category") return CATEGORY_COLORS[el.category];
    if (this.mode.key === "state") {
      return STATE_COLORS[stateAt(el, this.temperatureK)];
    }
    const v = this.mode.value?.(el);
    if (v == null || !extent) return UNKNOWN_COLOR;
    const t = normalize(v, extent.min, extent.max, this.useLog);
    return t == null ? UNKNOWN_COLOR : rampColor(t);
  }

  private subLabel(el: Element): string {
    if (this.mode.key === "category") {
      return el.mass.toFixed(el.mass < 100 ? 1 : 0);
    }
    if (this.mode.key === "state") {
      const s = stateAt(el, this.temperatureK);
      return s === "unknown" ? "—" : STATE_LABELS[s].slice(0, 3).toLowerCase();
    }
    const v = this.mode.value?.(el);
    if (v == null) return "—";
    return this.mode.format ? this.mode.format(v) : String(v);
  }

  private matches(el: Element): boolean {
    if (this.categoryFilter && el.category !== this.categoryFilter) return false;
    if (!this.query) return true;
    return (
      el.name.toLowerCase().includes(this.query) ||
      el.symbol.toLowerCase() === this.query ||
      el.symbol.toLowerCase().startsWith(this.query) ||
      String(el.number) === this.query
    );
  }

  private renderLegend(extent: { min: number; max: number } | null): void {
    this.legend.innerHTML = "";

    if (this.mode.key === "category") {
      for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
        if (cat === "unknown") continue;
        const item = document.createElement("button");
        const key = cat as ElementCategory;
        item.className = "pt-legend-item";
        item.classList.toggle("active", this.categoryFilter === key);
        item.innerHTML = `<span class="pt-legend-swatch" style="background:${CATEGORY_COLORS[key]}"></span>${label}`;
        item.onclick = () => {
          this.categoryFilter = this.categoryFilter === key ? null : key;
          this.render();
        };
        this.legend.appendChild(item);
      }
      return;
    }

    if (this.mode.key === "state") {
      const at = document.createElement("span");
      at.className = "pt-legend-temp";
      at.textContent = `At ${this.formatTemp(this.temperatureK)} — set in Settings`;
      this.legend.appendChild(at);
      for (const s of ["solid", "liquid", "gas", "unknown"] as const) {
        const item = document.createElement("span");
        item.className = "pt-legend-item";
        item.innerHTML = `<span class="pt-legend-swatch" style="background:${STATE_COLORS[s]}"></span>${STATE_LABELS[s]}`;
        this.legend.appendChild(item);
      }
      return;
    }

    if (!extent) return;
    const fmt = this.mode.format ?? ((v: number) => String(v));
    const unit = this.mode.unit ? ` ${this.mode.unit}` : "";
    const bar = document.createElement("div");
    bar.className = "pt-gradient";
    const stops = Array.from({ length: 11 }, (_, i) => rampColor(i / 10)).join(", ");
    bar.innerHTML = `
      <span class="pt-gradient-min">${fmt(extent.min)}${unit}</span>
      <span class="pt-gradient-bar" style="background:linear-gradient(to right, ${stops})"></span>
      <span class="pt-gradient-max">${fmt(extent.max)}${unit}</span>`;
    this.legend.appendChild(bar);

    const unknown = document.createElement("span");
    unknown.className = "pt-legend-item";
    unknown.innerHTML = `<span class="pt-legend-swatch" style="background:${UNKNOWN_COLOR}"></span>Unknown`;
    this.legend.appendChild(unknown);
  }

  private formatTemp(k: number): string {
    const v = kelvinTo[this.unit](k);
    return `${v.toFixed(this.unit === "K" ? 0 : 1)} ${TEMP_SUFFIX[this.unit]}`;
  }

  // --- detail ---------------------------------------------------------------

  private showDetail(el: Element): void {
    const t = (k?: number) => (k == null ? "—" : this.formatTemp(k));
    const rows: Array<[string, string]> = [
      ["Atomic number", String(el.number)],
      ["Atomic mass", `${el.mass} u`],
      ["Category", CATEGORY_LABELS[el.category]],
      ["Configuration", el.configuration ?? "—"],
      ["Electronegativity", el.electronegativity != null ? String(el.electronegativity) : "—"],
      ["Oxidation states", el.oxidationStates ?? "—"],
      ["Melting point", t(el.meltingPoint)],
      ["Boiling point", t(el.boilingPoint)],
      ["Density", el.density != null ? `${el.density} g/cm³` : "—"],
      ["Covalent radius", `${el.covalentRadius} Å`],
      ["Van der Waals radius", `${el.vdwRadius} Å`],
      ["State (STP)", el.state],
      [
        `State at ${this.formatTemp(this.temperatureK)}`,
        STATE_LABELS[stateAt(el, this.temperatureK)],
      ],
      ["Group / period", `${el.group || "f-block"} / ${el.period}`],
      [
        "Discovered",
        el.discovered == null
          ? "—"
          : el.discovered < 0
            ? `${Math.abs(el.discovered)} BCE`
            : String(el.discovered),
      ],
    ];
    this.detail.innerHTML = `
      <div class="pt-detail-head">
        <span class="pt-detail-sym" style="background:${hex(el.cpkColor)}">${el.symbol}</span>
        <div><div class="pt-detail-name">${el.name}</div>
        <div class="pt-detail-sub">${CATEGORY_LABELS[el.category]}</div></div>
      </div>
      <div class="pt-detail-body">${rows
        .map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`)
        .join("")}</div>`;
    this.detail.classList.remove("hidden");
  }

  // --- public API -----------------------------------------------------------

  /** Highlight elements present in the current molecule. */
  setPresent(symbols: Set<string>): void {
    this.present = symbols;
    this.render();
  }

  /**
   * Set the temperature used for phase colouring (driven by the Settings
   * panel). Switches the table into "State at temperature" so the change is
   * visible straight away.
   */
  setTemperature(kelvin: number): void {
    this.temperatureK = kelvin;
    const state = PROPERTY_MODES.find((m) => m.key === "state");
    if (state && this.mode.key !== "state") {
      this.mode = state;
      this.useLog = false;
      this.modeSelect.value = "state";
    }
    this.render();
    if (this.selected) this.showDetail(this.selected);
  }

  setTempUnit(unit: TempUnit): void {
    this.unit = unit;
    this.render();
    if (this.selected) this.showDetail(this.selected);
  }

  open(): void {
    this.root.classList.remove("hidden");
  }
  close(): void {
    this.root.classList.add("hidden");
  }
  toggle(): void {
    this.root.classList.toggle("hidden");
    if (this.selected) this.showDetail(this.selected);
  }
}

function placement(el: Element): { col: number; row: number } {
  if (el.number >= 57 && el.number <= 71) {
    return { col: 3 + (el.number - 57), row: 9 };
  }
  if (el.number >= 89 && el.number <= 103) {
    return { col: 3 + (el.number - 89), row: 10 };
  }
  return { col: el.group, row: el.period };
}

function strip(text: string, col: number, row: number): HTMLElement {
  const marker = document.createElement("div");
  marker.className = "pt-cell pt-marker";
  marker.style.gridColumn = String(col);
  marker.style.gridRow = String(row);
  marker.textContent = text;
  return marker;
}
