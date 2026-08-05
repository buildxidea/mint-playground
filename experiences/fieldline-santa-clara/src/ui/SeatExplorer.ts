import type {
  ExplorerRow,
  ExplorerSection,
  ExplorerSeatAnchor,
  SeatExplorerCatalog,
} from "../stadium/seatExplorerCatalog";
import type { OfficialSectionTier } from "../stadium/officialSectionTopology";

export type SeatExplorerSelection = {
  sectionId: string | null;
  rowLabel: string | null;
  seatNumber: number | null;
  positionIndex: number | null;
};

export type SeatExplorerCallbacks = {
  onOverview: () => void;
  onSection: (sectionId: string) => void;
  onRow: (sectionId: string, rowLabel: string) => void;
  onSeat: (
    sectionId: string,
    rowLabel: string,
    positionIndex: number,
    seatNumber: number | null,
  ) => void;
  onEnterSeat: () => void;
};

export type ExplorerLevel = "stadium" | "section" | "row";
type TierFilter = "all" | OfficialSectionTier;

const SVG_NS = "http://www.w3.org/2000/svg";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function tierLabel(tier: TierFilter): string {
  if (tier === "all") return "All";
  if (tier === "lower") return "100";
  if (tier === "club") return "200";
  if (tier === "upper-300") return "300";
  return "400";
}

function pointToSvg([x, z]: [number, number]): string {
  return `${150 + x},${150 + z}`;
}

function sectionCenter(section: ExplorerSection): [number, number] {
  const total = section.polygon.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as [number, number],
    [0, 0] as [number, number],
  );
  return [150 + total[0] / section.polygon.length, 150 + total[1] / section.polygon.length];
}

export class SeatExplorer {
  readonly root = element("aside", "ticket-explorer panel");
  private readonly map = document.createElementNS(SVG_NS, "svg");
  private readonly mapLayer = document.createElementNS(SVG_NS, "g");
  private readonly tierControls = element("div", "explorer-tier-controls");
  private readonly breadcrumbs = element("nav", "explorer-breadcrumbs");
  private readonly results = element("div", "explorer-results");
  private readonly search = document.createElement("input");
  private readonly status = element("output", "explorer-status");
  private readonly primaryAction = element("button", "primary explorer-view-button", "View from selected position");
  private catalog: SeatExplorerCatalog | null = null;
  private selection: SeatExplorerSelection = {
    sectionId: null,
    rowLabel: null,
    seatNumber: null,
    positionIndex: null,
  };
  private level: ExplorerLevel = "stadium";
  private tierFilter: TierFilter = "all";
  private readonly callbacks: SeatExplorerCallbacks;

  constructor(callbacks: SeatExplorerCallbacks) {
    this.callbacks = callbacks;
    this.root.dataset.testid = "ticket-explorer";
    const header = element("div", "explorer-heading");
    header.innerHTML = `<div><div class="panel-kicker">3D SEAT MAP</div><h2>Choose your position</h2></div><span class="explorer-live-dot" aria-label="Interactive object map"></span>`;

    this.search.type = "search";
    this.search.placeholder = "Search all 142 sections";
    this.search.setAttribute("aria-label", "Search stadium sections");
    this.search.dataset.testid = "explorer-search";
    this.search.addEventListener("input", () => this.render());

    for (const tier of ["all", "lower", "club", "upper-300", "upper-400"] as TierFilter[]) {
      const button = element("button", "explorer-tier", tierLabel(tier));
      button.type = "button";
      button.dataset.tier = tier;
      button.setAttribute("aria-pressed", String(tier === this.tierFilter));
      button.addEventListener("click", () => {
        this.tierFilter = tier;
        this.level = "stadium";
        this.render();
      });
      this.tierControls.appendChild(button);
    }

    this.map.setAttribute("viewBox", "0 0 300 300");
    this.map.setAttribute("role", "group");
    this.map.setAttribute("aria-label", "Levi's Stadium section minimap");
    this.map.classList.add("explorer-map");
    const field = document.createElementNS(SVG_NS, "rect");
    field.setAttribute("x", "124");
    field.setAttribute("y", "89");
    field.setAttribute("width", "52");
    field.setAttribute("height", "122");
    field.setAttribute("rx", "5");
    field.setAttribute("class", "explorer-field");
    const midfield = document.createElementNS(SVG_NS, "line");
    midfield.setAttribute("x1", "124");
    midfield.setAttribute("x2", "176");
    midfield.setAttribute("y1", "150");
    midfield.setAttribute("y2", "150");
    midfield.setAttribute("class", "explorer-field-line");
    const north = document.createElementNS(SVG_NS, "text");
    north.setAttribute("x", "150");
    north.setAttribute("y", "16");
    north.setAttribute("text-anchor", "middle");
    north.setAttribute("class", "explorer-north");
    north.textContent = "NORTH ↑";
    this.map.append(this.mapLayer, field, midfield, north);

    this.primaryAction.type = "button";
    this.primaryAction.dataset.testid = "explorer-enter-seat";
    this.primaryAction.hidden = true;
    this.primaryAction.addEventListener("click", () => this.callbacks.onEnterSeat());

    this.root.append(
      header,
      this.search,
      this.tierControls,
      this.breadcrumbs,
      this.map,
      this.status,
      this.results,
      this.primaryAction,
    );
  }

  setCatalog(catalog: SeatExplorerCatalog): void {
    this.catalog = catalog;
    this.render();
  }

  syncSelection(selection: SeatExplorerSelection, level?: ExplorerLevel): void {
    this.selection = selection;
    if (level) this.level = level;
    this.render();
  }

  showStadium(): void {
    this.level = "stadium";
    this.render();
  }

  private selectedSection(): ExplorerSection | null {
    return this.catalog?.sections.find(
      (section) => section.sectionId === this.selection.sectionId,
    ) ?? null;
  }

  private selectedRow(): ExplorerRow | null {
    return this.selectedSection()?.rows.find(
      (row) => row.rowLabel === this.selection.rowLabel,
    ) ?? null;
  }

  private selectedSeat(): ExplorerSeatAnchor | null {
    const positionIndex = this.selection.positionIndex;
    if (positionIndex == null) return null;
    return this.selectedRow()?.seats.find((seat) => seat.positionIndex === positionIndex) ?? null;
  }

  private filteredSections(): ExplorerSection[] {
    if (!this.catalog) return [];
    const query = this.search.value.trim().toLowerCase();
    return this.catalog.sections.filter((section) => {
      if (this.tierFilter !== "all" && section.tier !== this.tierFilter) return false;
      if (!query) return true;
      return `${section.sectionId} ${section.displayName} ${section.numericSection}`
        .toLowerCase()
        .includes(query);
    });
  }

  private render(): void {
    this.renderTierControls();
    this.renderBreadcrumbs();
    this.renderMap();
    this.renderResults();
  }

  private renderTierControls(): void {
    this.tierControls.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      const active = button.dataset.tier === this.tierFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  private renderBreadcrumbs(): void {
    this.breadcrumbs.replaceChildren();
    const stadium = element("button", undefined, "Stadium");
    stadium.type = "button";
    stadium.addEventListener("click", () => {
      this.level = "stadium";
      this.callbacks.onOverview();
      this.render();
    });
    this.breadcrumbs.appendChild(stadium);
    const section = this.selectedSection();
    if (section && this.level !== "stadium") {
      this.breadcrumbs.appendChild(element("span", undefined, "/"));
      const sectionButton = element("button", undefined, section.displayName);
      sectionButton.type = "button";
      sectionButton.addEventListener("click", () => {
        this.level = "section";
        this.callbacks.onSection(section.sectionId);
        this.render();
      });
      this.breadcrumbs.appendChild(sectionButton);
    }
    const row = this.selectedRow();
    if (row && this.level === "row") {
      this.breadcrumbs.appendChild(element("span", undefined, "/"));
      this.breadcrumbs.appendChild(element("strong", undefined, row.displayLabel));
    }
  }

  private renderMap(): void {
    this.mapLayer.replaceChildren();
    const visibleIds = new Set(this.filteredSections().map((section) => section.sectionId));
    for (const section of this.catalog?.sections ?? []) {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", [
        "explorer-section",
        `tier-${section.tier}`,
        section.sectionId === this.selection.sectionId ? "selected" : "",
        visibleIds.has(section.sectionId) ? "" : "filtered",
      ].filter(Boolean).join(" "));
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", visibleIds.has(section.sectionId) ? "0" : "-1");
      group.setAttribute("aria-label", `${section.displayName}, ${section.rows.length} rows`);
      group.dataset.sectionId = section.sectionId;
      const polygon = document.createElementNS(SVG_NS, "polygon");
      polygon.setAttribute("points", section.polygon.map(pointToSvg).join(" "));
      const [labelX, labelY] = sectionCenter(section);
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(labelX));
      label.setAttribute("y", String(labelY + 1.5));
      label.setAttribute("text-anchor", "middle");
      label.textContent = String(section.numericSection);
      const activate = () => {
        if (!visibleIds.has(section.sectionId)) return;
        this.level = "section";
        this.callbacks.onSection(section.sectionId);
      };
      group.addEventListener("click", activate);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
      group.append(polygon, label);
      this.mapLayer.appendChild(group);
    }
  }

  private renderResults(): void {
    this.results.replaceChildren();
    this.primaryAction.hidden = true;
    if (!this.catalog) {
      this.status.value = "Loading complete seat catalog…";
      return;
    }
    if (this.level === "stadium") {
      const sections = this.filteredSections();
      this.status.value = `${sections.length} of ${this.catalog.coverage.officialSections} official sections visible`;
      const list = element("div", "explorer-section-list");
      for (const section of sections) {
        const button = element("button", "explorer-section-card");
        button.type = "button";
        button.dataset.sectionId = section.sectionId;
        button.innerHTML = `<strong>${section.displayName}</strong><small>${section.rows.length} rows · ${section.tier.replace("upper-", "")}</small>`;
        button.addEventListener("click", () => {
          this.level = "section";
          this.callbacks.onSection(section.sectionId);
        });
        list.appendChild(button);
      }
      this.results.appendChild(list);
      return;
    }

    const section = this.selectedSection();
    if (!section) {
      this.level = "stadium";
      this.renderResults();
      return;
    }
    if (this.level === "section") {
      this.status.value = `${section.displayName} · all ${section.rows.length} rows`;
      const grid = element("div", "explorer-row-grid");
      for (const row of section.rows) {
        const button = element("button", "explorer-row-button");
        button.type = "button";
        button.dataset.rowLabel = row.rowLabel;
        button.classList.toggle("selected", row.rowLabel === this.selection.rowLabel);
        button.innerHTML = `<strong>${row.displayLabel}</strong><small>${row.isAda ? "ADA platform" : `${row.seats.length} chair positions`}</small>`;
        button.addEventListener("click", () => {
          this.level = "row";
          this.callbacks.onRow(section.sectionId, row.rowLabel);
        });
        grid.appendChild(button);
      }
      this.results.appendChild(grid);
      return;
    }

    const row = this.selectedRow();
    if (!row) {
      this.level = "section";
      this.renderResults();
      return;
    }
    this.status.value = row.isAda
      ? `${row.displayLabel} · individual accessible positions are not inferred`
      : `${row.displayLabel} · every generated chair is selectable`;
    if (row.isAda) {
      this.results.appendChild(element(
        "p",
        "explorer-empty",
        "This sourced ADA row opens at platform center. No regular chair or companion identifier is fabricated.",
      ));
      this.primaryAction.hidden = false;
      this.primaryAction.textContent = "View from ADA row center";
      return;
    }
    const seatGrid = element("div", "explorer-seat-grid");
    for (const seat of row.seats) {
      const button = element("button", "explorer-seat-button");
      button.type = "button";
      button.dataset.positionIndex = String(seat.positionIndex);
      button.dataset.anchorId = seat.id;
      button.classList.toggle("selected", seat.positionIndex === this.selection.positionIndex);
      button.setAttribute("aria-pressed", String(seat.positionIndex === this.selection.positionIndex));
      button.innerHTML = `<span>${seat.seatNumber ?? seat.positionIndex}</span><small>${seat.seatNumber == null ? "MODELED" : "SEAT"}</small>`;
      button.title = seat.seatNumber == null
        ? `Modeled chair position ${seat.positionIndex}; exact seat number unavailable`
        : `Supplied seat ${seat.seatNumber}; physical placement modeled`;
      button.addEventListener("click", () => {
        this.callbacks.onSeat(
          section.sectionId,
          row.rowLabel,
          seat.positionIndex,
          seat.seatNumber,
        );
      });
      seatGrid.appendChild(button);
    }
    this.results.appendChild(seatGrid);
    const selectedSeat = this.selectedSeat();
    this.primaryAction.hidden = selectedSeat == null;
    this.primaryAction.textContent = selectedSeat?.seatNumber == null
      ? "View from modeled chair"
      : `View from Seat ${selectedSeat.seatNumber}`;
  }
}
