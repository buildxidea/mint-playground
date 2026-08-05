import { EVENT_CONFIGS, type EventConfigId } from "../app/eventConfigs";
import {
  REFERENCE_CAMERA_IDS,
  type ReferenceCameraId,
} from "../calibration/referenceCameras";
import {
  SEAT_PERSPECTIVES,
  type SeatPerspectiveId,
  type SeatedLookMode,
} from "../camera/seatOccupantRig";
import {
  effectiveFreshness,
  formatAge,
  type Freshness,
  type LiveVenueState,
} from "../live/contracts";
import type { DataQualityReport } from "../stadium/loadVenueData";
import { STATUS_LABELS } from "../stadium/provenance";
import type { ShadeReport } from "../stadium/shadeEngine";
import type { FocusTarget, HeightPreset, SightlineMetrics } from "../stadium/sightlineEngine";
import type { ModeledGeometryManifest, VerifiedMvpData } from "../stadium/schema";
import type { SeatExplorerCatalog } from "../stadium/seatExplorerCatalog";
import type { StadiumViewInventory } from "../stadium/viewInventory";
import type { PurchaseActionState } from "../tickets/purchaseAction";
import { SeatExplorer, type ExplorerLevel } from "./SeatExplorer";

export type SelectionState = {
  sectionId: string | null;
  rowLabel: string | null;
  seatNumber: number | null;
  positionIndex?: number | null;
};

export type HudCallbacks = {
  onSelectSection: (sectionId: string) => void;
  onSelectRow: (rowLabel: string) => void;
  onSelectSeat: (seatNumber: number | null) => void;
  onExploreOverview: () => void;
  onExploreSection: (sectionId: string) => void;
  onExploreRow: (sectionId: string, rowLabel: string) => void;
  onExploreSeat: (
    sectionId: string,
    rowLabel: string,
    positionIndex: number,
    seatNumber: number | null,
  ) => void;
  onEnterSeated: () => void;
  onOverview: () => void;
  onFocus: (focus: FocusTarget) => void;
  onHeight: (preset: HeightPreset) => void;
  onEventConfig: (id: EventConfigId) => void;
  onLiveEvent: (id: string | null) => void;
  onEventDate: (date: string) => void;
  onKickoffTime: (time: string) => void;
  onTimeScrub: (minutesFromKickoff: number) => void;
  onCrowd: (percentile: number) => void;
  onToggleTier: (tier: string, visible: boolean) => void;
  onToggleTower: (visible: boolean) => void;
  onToggleValidation: (visible: boolean) => void;
  onToggleHeatmap: (visible: boolean) => void;
  onAddCompare: () => void;
  onRemoveCompare: (index: number) => void;
  onResetLook: () => void;
  onResetPose: () => void;
  onInspectSeat: () => void;
  onLookMode: (mode: SeatedLookMode) => void;
  onViewPerspective: (id: SeatPerspectiveId) => void;
  onLean: (lateralM: number, forwardM: number, verticalM: number) => void;
  onOpenView: (viewId: string, perspective: SeatPerspectiveId) => void;
  onNavigateView: (delta: -1 | 1, perspective: SeatPerspectiveId) => void;
  onTourView: (id: ReferenceCameraId) => void;
  onPointerLock: () => void;
  onToggleAudio: (enabled: boolean) => void;
  onWeightChange: (key: string, value: number) => void;
};

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

function titleCase(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metricRow(label: string, value: string, status: string, note?: string): string {
  return `<div class="metric-row" title="${status}${note ? ` — ${note}` : ""}">
    <span>${label}<small>${status}</small></span><strong>${value}</strong>
  </div>`;
}

function shadeSegments(shade: ShadeReport | null): string {
  if (!shade) return "";
  return `<div class="shade-track" aria-label="Modeled shade timeline">${shade.timeline
    .map((sample) => `<i class="${!sample.sunAboveHorizon ? "night" : sample.inDirectSun ? "sun" : "shade"}" title="${sample.timeIso}${sample.occluder ? ` — ${sample.occluder}` : ""}"></i>`)
    .join("")}</div>`;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly selectionPanel: HTMLElement;
  private readonly metricsPanel: HTMLElement;
  private readonly metricsBody = element("div", "metrics-body");
  private readonly provenancePanel: HTMLElement;
  private readonly comparePanel: HTMLElement;
  private readonly analysisStatus: HTMLElement;
  private readonly trustLiveStatus: HTMLElement;
  private readonly weatherStatus: HTMLOutputElement;
  private readonly timeReadout: HTMLOutputElement;
  private readonly sectionSelect = document.createElement("select");
  private readonly rowSelect = document.createElement("select");
  private readonly seatSelect = document.createElement("select");
  private readonly eventDateInput = document.createElement("input");
  private readonly kickoffInput = document.createElement("input");
  private readonly timeInput = document.createElement("input");
  private readonly liveEventSelect = document.createElement("select");
  private readonly eventConfigSelect = document.createElement("select");
  private readonly perspectiveSelect = document.createElement("select");
  private readonly lookModeSelect = document.createElement("select");
  private readonly viewSearchInput = document.createElement("input");
  private readonly viewKindFilter = document.createElement("select");
  private readonly viewList = element("div", "view-gallery-list");
  private readonly viewResultCount = element("output", "view-result-count", "0 views");
  private readonly purchaseLink = document.createElement("a");
  private readonly purchaseEvent = element("strong", "purchase-event", "No official event selected");
  private readonly purchaseSelection = element("span", "purchase-selection", "Selected view loading…");
  private readonly purchaseNote = element("p", "purchase-note");
  private viewInventory: StadiumViewInventory | null = null;
  private data: VerifiedMvpData | null = null;
  private readonly callbacks: HudCallbacks;
  private readonly seatExplorer: SeatExplorer;

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    this.root = element("div", "hud");
    parent.appendChild(this.root);
    this.seatExplorer = new SeatExplorer({
      onOverview: callbacks.onExploreOverview,
      onSection: callbacks.onExploreSection,
      onRow: callbacks.onExploreRow,
      onSeat: callbacks.onExploreSeat,
      onEnterSeat: callbacks.onEnterSeated,
    });

    const brand = element("div", "brand");
    brand.innerHTML = `<div class="brand-mark" aria-hidden="true"></div><div><h1>Fieldline</h1><p>Santa Clara · modeled view intelligence</p></div>`;
    this.root.appendChild(brand);

    const trust = element("div", "trust-strip");
    trust.innerHTML = `<span class="status-dot static"></span><span>Identifiers · supplied source pack</span><span>·</span>`;
    this.trustLiveStatus = element("span", "live-trust unknown", "Live feeds connecting…");
    trust.appendChild(this.trustLiveStatus);
    this.root.appendChild(trust);

    this.selectionPanel = element("aside", "panel selection");
    this.selectionPanel.dataset.testid = "selection-panel";
    this.metricsPanel = element("aside", "panel metrics");
    this.metricsPanel.dataset.testid = "metrics-panel";
    this.provenancePanel = element("aside", "panel provenance");
    this.comparePanel = element("section", "panel compare");
    this.analysisStatus = element("div", "analysis-status", "Analysis ready");
    this.weatherStatus = element("output", "weather-status", "Weather connecting…");
    this.timeReadout = element("output", "time-readout", "Kickoff");

    this.root.append(
      this.seatExplorer.root,
      this.selectionPanel,
      this.metricsPanel,
      this.provenancePanel,
      this.comparePanel,
    );

    this.buildSelectionPanel();
    this.buildPurchaseAction();
    this.buildToolbar();
    const metricsToggle = element("button", "metrics-collapse", "Hide info");
    metricsToggle.type = "button";
    metricsToggle.dataset.testid = "metrics-collapse";
    metricsToggle.setAttribute("aria-expanded", "true");
    metricsToggle.addEventListener("click", () => {
      const collapsed = this.metricsPanel.classList.toggle("collapsed");
      metricsToggle.textContent = collapsed ? "Show info" : "Hide info";
      metricsToggle.setAttribute("aria-expanded", String(!collapsed));
      try {
        localStorage.setItem("fieldline.metricsCollapsed", String(collapsed));
      } catch {
        // Storage can be disabled without affecting the interaction.
      }
    });
    let initiallyCollapsed = false;
    try {
      const storedCollapse = localStorage.getItem("fieldline.metricsCollapsed");
      initiallyCollapsed = storedCollapse == null
        ? window.matchMedia("(max-width: 780px)").matches
        : storedCollapse === "true";
    } catch {
      initiallyCollapsed = window.matchMedia("(max-width: 780px)").matches;
    }
    this.metricsPanel.classList.toggle("collapsed", initiallyCollapsed);
    metricsToggle.textContent = initiallyCollapsed ? "Show info" : "Hide info";
    metricsToggle.setAttribute("aria-expanded", String(!initiallyCollapsed));
    this.metricsBody.innerHTML = `<div class="panel-kicker">VIEW ANALYSIS</div><h2>Choose a source-pack row</h2><p class="disclaimer">Physical placement and view metrics are modeled.</p>`;
    this.metricsPanel.append(metricsToggle, this.metricsBody);
    this.provenancePanel.innerHTML = `<p class="disclaimer">Loading provenance…</p>`;
  }

  private field(label: string, control: HTMLElement, className = ""): HTMLLabelElement {
    const wrapper = element("label", `field ${className}`.trim()) as HTMLLabelElement;
    const caption = element("span", undefined, label);
    wrapper.append(caption, control);
    return wrapper;
  }

  private buildSelectionPanel(): void {
    const heading = element("div", "panel-heading");
    heading.innerHTML = `<div><div class="panel-kicker">SEAT EXPLORER</div><h2>Find your view</h2></div><span class="verified-chip">SOURCE-PACK IDS · MODELED XYZ</span>`;
    this.selectionPanel.appendChild(heading);

    const selectors = element("div", "selector-grid");
    this.sectionSelect.dataset.testid = "section-select";
    this.rowSelect.dataset.testid = "row-select";
    this.seatSelect.dataset.testid = "seat-select";
    selectors.append(
      this.field("Section", this.sectionSelect),
      this.field("Row", this.rowSelect),
      this.field("Seat", this.seatSelect),
    );
    const manualSelector = document.createElement("details");
    manualSelector.className = "manual-selector";
    const manualSummary = document.createElement("summary");
    manualSummary.textContent = "List selector · sourced identifiers";
    manualSelector.append(manualSummary, selectors);
    this.selectionPanel.appendChild(manualSelector);

    this.sectionSelect.addEventListener("change", () => {
      this.refreshRows();
      this.callbacks.onSelectSection(this.sectionSelect.value);
    });
    this.rowSelect.addEventListener("change", () => {
      this.refreshSeats();
      this.callbacks.onSelectRow(this.rowSelect.value);
    });
    this.seatSelect.addEventListener("change", () => {
      this.callbacks.onSelectSeat(this.seatSelect.value ? Number(this.seatSelect.value) : null);
    });

    const actions = element("div", "primary-actions");
    const seated = element("button", "primary", "Enter seated view");
    seated.dataset.testid = "enter-seated";
    seated.addEventListener("click", () => this.callbacks.onEnterSeated());
    const overview = element("button", "icon-button", "Overview");
    overview.dataset.testid = "overview";
    overview.addEventListener("click", () => this.callbacks.onOverview());
    actions.append(seated, overview);
    this.selectionPanel.appendChild(actions);

    const secondary = element("div", "secondary-actions");
    const reset = element("button", undefined, "Reset orientation");
    reset.addEventListener("click", () => this.callbacks.onResetLook());
    const compare = element("button", undefined, "Add to compare");
    compare.dataset.testid = "add-compare";
    compare.addEventListener("click", () => this.callbacks.onAddCompare());
    secondary.append(reset, compare);
    this.selectionPanel.appendChild(secondary);

    const focus = document.createElement("select");
    focus.dataset.testid = "focus-select";
    for (const target of [
      "midfield",
      "near-goal",
      "far-goal",
      "home-sideline",
      "away-sideline",
      "north-board",
      "south-board",
    ] as FocusTarget[]) {
      focus.add(new Option(titleCase(target), target));
    }
    focus.addEventListener("change", () => this.callbacks.onFocus(focus.value as FocusTarget));

    const height = document.createElement("select");
    height.dataset.testid = "height-select";
    for (const preset of ["child", "average", "tall"] as HeightPreset[]) {
      height.add(new Option(`${titleCase(preset)} · modeled`, preset, false, preset === "average"));
    }
    height.addEventListener("change", () => this.callbacks.onHeight(height.value as HeightPreset));
    const viewSettings = element("div", "view-settings");
    viewSettings.append(this.field("Focus", focus), this.field("Eye height", height));
    this.selectionPanel.appendChild(viewSettings);

    this.perspectiveSelect.dataset.testid = "perspective-select";
    for (const perspective of SEAT_PERSPECTIVES) {
      this.perspectiveSelect.add(new Option(perspective.label, perspective.id));
    }
    this.perspectiveSelect.value = "midfield";
    this.perspectiveSelect.addEventListener("change", () => {
      this.callbacks.onViewPerspective(this.perspectiveSelect.value as SeatPerspectiveId);
    });
    this.lookModeSelect.dataset.testid = "look-mode-select";
    this.lookModeSelect.add(new Option("Natural look · ±110°", "natural"));
    this.lookModeSelect.add(new Option("360° free look", "free"));
    this.lookModeSelect.addEventListener("change", () => {
      this.callbacks.onLookMode(this.lookModeSelect.value as SeatedLookMode);
    });
    const seatedSettings = element("div", "seated-settings");
    seatedSettings.append(
      this.field("Perspective", this.perspectiveSelect),
      this.field("Look range", this.lookModeSelect),
    );

    const leanControls = element("div", "lean-controls");
    leanControls.setAttribute("aria-label", "Seated lean controls");
    const leanActions: Array<[
      string,
      string,
      [number, number, number],
    ]> = [
      ["←", "Lean left", [-0.05, 0, 0]],
      ["→", "Lean right", [0.05, 0, 0]],
      ["↑", "Lean forward", [0, 0.045, 0]],
      ["↓", "Lean back", [0, -0.045, 0]],
      ["+", "Raise eye", [0, 0, 0.04]],
      ["−", "Lower eye", [0, 0, -0.04]],
    ];
    for (const [text, label, delta] of leanActions) {
      const button = element("button", "lean-button", text);
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => this.callbacks.onLean(...delta));
      leanControls.appendChild(button);
    }
    const resetPose = element("button", "seat-reset", "Reset seat pose");
    resetPose.dataset.testid = "reset-seat-pose";
    resetPose.addEventListener("click", () => {
      this.perspectiveSelect.value = "authentic-forward";
      this.lookModeSelect.value = "natural";
      this.callbacks.onResetPose();
    });
    const inspectSeat = element("button", "inspect-seat", "Inspect chair");
    inspectSeat.dataset.testid = "inspect-seat";
    inspectSeat.addEventListener("click", () => this.callbacks.onInspectSeat());
    const pointerLock = element("button", "pointer-lock", "Mouse free-look");
    pointerLock.addEventListener("click", () => this.callbacks.onPointerLock());
    const seatActions = element("div", "seat-mode-actions");
    seatActions.append(resetPose, inspectSeat, pointerLock);
    const seatedControls = element("div", "seated-control-panel");
    seatedControls.dataset.testid = "seated-controls";
    seatedControls.append(seatedSettings, leanControls, seatActions);
    this.selectionPanel.appendChild(seatedControls);

    const gallery = document.createElement("details");
    gallery.className = "view-gallery";
    gallery.dataset.testid = "view-gallery";
    const gallerySummary = document.createElement("summary");
    gallerySummary.innerHTML = `<span>More views</span><b>4,624 perspectives</b>`;
    gallery.appendChild(gallerySummary);
    this.viewSearchInput.type = "search";
    this.viewSearchInput.placeholder = "Search section, row, or seat";
    this.viewSearchInput.setAttribute("aria-label", "Search supported stadium views");
    this.viewSearchInput.dataset.testid = "view-search";
    this.viewKindFilter.add(new Option("All supported anchors", "all"));
    this.viewKindFilter.add(new Option("Exact seats", "exact-seat"));
    this.viewKindFilter.add(new Option("Row centers", "row-center"));
    this.viewKindFilter.add(new Option("ADA row centers", "ada-row-center"));
    this.viewKindFilter.dataset.testid = "view-kind-filter";
    this.viewSearchInput.addEventListener("input", () => this.renderViewGallery());
    this.viewKindFilter.addEventListener("change", () => this.renderViewGallery());
    const galleryFilters = element("div", "view-gallery-filters");
    galleryFilters.append(this.viewSearchInput, this.viewKindFilter);
    const galleryNav = element("div", "view-gallery-nav");
    const previous = element("button", undefined, "Previous");
    previous.dataset.testid = "previous-view";
    previous.addEventListener("click", () => this.callbacks.onNavigateView(
      -1,
      this.perspectiveSelect.value as SeatPerspectiveId,
    ));
    const next = element("button", undefined, "Next");
    next.dataset.testid = "next-view";
    next.addEventListener("click", () => this.callbacks.onNavigateView(
      1,
      this.perspectiveSelect.value as SeatPerspectiveId,
    ));
    galleryNav.append(previous, this.viewResultCount, next);

    const tourSelect = document.createElement("select");
    tourSelect.dataset.testid = "tour-view-select";
    tourSelect.add(new Option("Choose an architectural tour view", ""));
    for (const id of REFERENCE_CAMERA_IDS) {
      tourSelect.add(new Option(titleCase(id), id));
    }
    tourSelect.addEventListener("change", () => {
      if (tourSelect.value) this.callbacks.onTourView(tourSelect.value as ReferenceCameraId);
    });
    gallery.append(galleryFilters, galleryNav, this.viewList, this.field("Stadium tour", tourSelect));
    this.selectionPanel.appendChild(gallery);

  }

  private buildPurchaseAction(): void {
    const panel = element("section", "purchase-action");
    panel.dataset.testid = "purchase-action";
    const kicker = element("span", "purchase-kicker", "SELECTED EVENT + VIEW");
    const context = element("div", "purchase-context");
    context.append(this.purchaseEvent, this.purchaseSelection);
    this.purchaseLink.className = "purchase-link";
    this.purchaseLink.dataset.testid = "buy-selected-seat";
    this.purchaseLink.target = "_blank";
    this.purchaseLink.rel = "noopener noreferrer";
    this.purchaseLink.setAttribute("aria-disabled", "true");
    this.purchaseLink.tabIndex = -1;
    this.purchaseNote.textContent = "Select an official event to open its ticket destination.";
    panel.append(kicker, context, this.purchaseLink, this.purchaseNote);
    this.seatExplorer.root.appendChild(panel);
  }

  private buildToolbar(): void {
    const toolbar = element("div", "toolbar");
    toolbar.dataset.testid = "event-toolbar";

    const liveEventSelect = this.liveEventSelect;
    liveEventSelect.dataset.testid = "live-event-select";
    liveEventSelect.disabled = true;
    liveEventSelect.add(new Option("Connecting to official events…", ""));
    liveEventSelect.addEventListener("change", () => {
      this.callbacks.onLiveEvent(liveEventSelect.value || null);
    });

    const eventSelect = this.eventConfigSelect;
    eventSelect.dataset.testid = "event-select";
    Object.values(EVENT_CONFIGS).forEach((config) => {
      eventSelect.add(new Option(config.label, config.id));
    });
    eventSelect.addEventListener("change", () => {
      this.callbacks.onEventConfig(eventSelect.value as EventConfigId);
    });

    const date = this.eventDateInput;
    date.type = "date";
    date.value = "2026-09-13";
    date.dataset.testid = "event-date";
    date.addEventListener("change", () => this.callbacks.onEventDate(date.value));
    const kickoff = this.kickoffInput;
    kickoff.type = "time";
    kickoff.value = "13:25";
    kickoff.dataset.testid = "kickoff-time";
    kickoff.addEventListener("change", () => this.callbacks.onKickoffTime(kickoff.value));

    const time = this.timeInput;
    time.type = "range";
    time.min = "-120";
    time.max = "270";
    time.value = "0";
    time.dataset.testid = "time-scrubber";
    time.addEventListener("input", () => {
      const minutes = Number(time.value);
      this.timeReadout.value = minutes === 0 ? "Kickoff" : `${minutes > 0 ? "+" : ""}${minutes} min`;
      this.callbacks.onTimeScrub(minutes);
    });

    const crowd = document.createElement("select");
    crowd.dataset.testid = "crowd-select";
    crowd.add(new Option("Crowd · 50th", "50"));
    crowd.add(new Option("Crowd · 75th", "75"));
    crowd.add(new Option("Crowd · 95th", "95"));
    crowd.addEventListener("change", () => this.callbacks.onCrowd(Number(crowd.value)));

    const tools = element("details", "tools-menu");
    tools.innerHTML = `<summary>Layers</summary>`;
    const toolsBody = element("div", "tools-body");
    for (const tier of ["lower", "club", "upper-300", "upper-400"]) {
      toolsBody.appendChild(this.toggle(titleCase(tier), true, (visible) => this.callbacks.onToggleTier(tier, visible)));
    }
    toolsBody.append(
      this.toggle("Suite tower", true, (visible) => this.callbacks.onToggleTower(visible)),
      this.toggle("Validation", false, (visible) => this.callbacks.onToggleValidation(visible)),
      this.toggle("Field heatmap", false, (visible) => this.callbacks.onToggleHeatmap(visible)),
      this.toggle("Ambient audio", false, (visible) => this.callbacks.onToggleAudio(visible)),
    );
    tools.appendChild(toolsBody);

    const timeGroup = element("div", "time-control");
    timeGroup.append(this.timeReadout, time);
    toolbar.append(
      this.field("Official event", liveEventSelect, "live-event-field"),
      this.field("View", eventSelect, "event-field"),
      this.field("Date", date, "date-field"),
      this.field("Start · modeled", kickoff, "time-field"),
      timeGroup,
      crowd,
      tools,
      this.weatherStatus,
      this.analysisStatus,
    );
    this.root.appendChild(toolbar);
  }

  private toggle(label: string, initial: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
    const wrapper = element("label", "toggle-row", label) as HTMLLabelElement;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = initial;
    input.addEventListener("change", () => onChange(input.checked));
    wrapper.appendChild(input);
    return wrapper;
  }

  setData(
    data: VerifiedMvpData,
    report: DataQualityReport,
    geometry: ModeledGeometryManifest,
  ): void {
    this.data = data;
    this.sectionSelect.innerHTML = "";
    data.sections.forEach((section) => {
      this.sectionSelect.add(new Option(section.displayName, section.sectionId));
    });
    this.refreshRows();
    this.provenancePanel.innerHTML = `
      <details>
        <summary><span class="status-dot"></span> Truth & provenance <b>${report.sourcePackSeatCount} source-pack seats</b></summary>
        <div class="provenance-body">
          ${metricRow("Venue name", STATUS_LABELS[data.stadium.displayName.status], data.stadium.displayName.status, data.stadium.displayName.note)}
          ${metricRow("Row identifiers", "11 sections", "provided-source", "Supplied canonical JSON cross-checked against the supplied rows CSV")}
          ${metricRow("P234 identifiers", `${report.sourcePackSeatCount} unique`, "provided-source", "Rows 1–13, seats 1–20; independent public document trail pending")}
          ${metricRow("Publicly corroborated seat IDs", String(report.independentlyPublicVerifiedSeatCount), "unknown-do-not-infer", "No authoritative external row/seat document is attached")}
          ${metricRow("As-built seat placements", String(report.placementVerifiedSeatCount), "unknown-do-not-infer", "All XYZ transforms remain modeled")}
          ${metricRow("Physical geometry", `Version ${geometry.geometryVersion}`, "modeled", geometry.geometryVersionHash)}
          ${metricRow("Calibration", "Human approval pending", "modeled", "Relative preview only")}
          <p class="source-list"><b>Source ledger</b><br>${data.sources.map((source) => `${source.id} · ${source.independentlyCorroborated ? "independently corroborated" : "source-pack only"}`).join("<br>")}</p>
          <p class="disclaimer">Positions, distances, obstruction, shade, and visibility are modeled—not architectural or as-built measurements.</p>
        </div>
      </details>`;
  }

  setViewInventory(inventory: StadiumViewInventory): void {
    this.viewInventory = inventory;
    const count = inventory.coverage.derivedSeatPerspectives.toLocaleString();
    const summaryCount = this.selectionPanel.querySelector<HTMLElement>(".view-gallery summary b");
    if (summaryCount) summaryCount.textContent = `${count} perspectives`;
    this.renderViewGallery();
  }

  setExplorerCatalog(catalog: SeatExplorerCatalog): void {
    this.seatExplorer.setCatalog(catalog);
  }

  showExplorerStadium(): void {
    this.seatExplorer.showStadium();
  }

  syncSeatViewControls(perspective: SeatPerspectiveId, lookMode: SeatedLookMode): void {
    this.perspectiveSelect.value = perspective;
    this.lookModeSelect.value = lookMode;
  }

  private renderViewGallery(): void {
    this.viewList.replaceChildren();
    if (!this.viewInventory) {
      this.viewResultCount.value = "Loading views…";
      return;
    }
    const query = this.viewSearchInput.value.trim().toLowerCase();
    const kind = this.viewKindFilter.value;
    const filtered = this.viewInventory.views.filter((view) => {
      if (kind !== "all" && view.kind !== kind) return false;
      if (!query) return true;
      const searchable = `${view.sectionId} ${view.rowLabel} ${view.seatNumber ?? "row center"} ${view.kind}`
        .toLowerCase();
      return searchable.includes(query);
    });
    this.viewResultCount.value = `${filtered.length} ${filtered.length === 1 ? "view" : "views"}`;
    const visible = filtered.slice(0, 80);
    const totalRows = Math.ceil(this.viewInventory.views.length / 20);
    for (const view of visible) {
      const inventoryIndex = this.viewInventory.views.indexOf(view);
      const button = element("button", "view-gallery-item");
      button.type = "button";
      button.dataset.viewId = view.id;
      button.title = view.placementStatus;
      const thumbnail = element("span", "view-gallery-thumb");
      const column = inventoryIndex % 20;
      const row = Math.floor(inventoryIndex / 20);
      thumbnail.style.backgroundSize = `${20 * 64}px ${totalRows * 40}px`;
      thumbnail.style.backgroundPosition = `${-column * 64}px ${-row * 40}px`;
      const copy = element("span", "view-gallery-copy");
      const title = view.seatNumber == null
        ? `Section ${view.sectionId} · Row ${view.rowLabel}`
        : `Section ${view.sectionId} · Row ${view.rowLabel} · Seat ${view.seatNumber}`;
      const status = view.kind === "exact-seat"
        ? "Exact supplied identifier · modeled XYZ"
        : view.kind === "ada-row-center"
          ? "ADA row center · individual position unavailable"
          : "Source-pack row · representative modeled seat";
      copy.append(element("strong", undefined, title), element("small", undefined, status));
      button.append(thumbnail, copy);
      button.addEventListener("click", () => this.callbacks.onOpenView(
        view.id,
        this.perspectiveSelect.value as SeatPerspectiveId,
      ));
      this.viewList.appendChild(button);
    }
    if (filtered.length > visible.length) {
      this.viewList.appendChild(element(
        "p",
        "view-gallery-more",
        `Showing the first ${visible.length}; refine the search to reach the remaining ${filtered.length - visible.length}.`,
      ));
    }
  }

  private refreshRows(): void {
    if (!this.data) return;
    const section = this.data.sections.find((item) => item.sectionId === this.sectionSelect.value);
    this.rowSelect.innerHTML = "";
    for (const row of section?.rows ?? []) {
      const suffix = [row.isAda ? "ADA" : "", row.covered ? "covered" : "", row.isEntrance ? "entrance" : ""]
        .filter(Boolean)
        .join(" · ");
      this.rowSelect.add(new Option(suffix ? `${row.rowLabel} · ${suffix}` : row.rowLabel, row.rowLabel));
    }
    this.refreshSeats();
  }

  private refreshSeats(): void {
    if (!this.data) return;
    const section = this.data.sections.find((item) => item.sectionId === this.sectionSelect.value);
    this.seatSelect.innerHTML = "";
    if (!section?.seatCountVerified) {
      this.seatSelect.add(new Option("Row center · seat count unknown", ""));
      this.seatSelect.disabled = true;
      return;
    }
    this.seatSelect.disabled = false;
    this.seatSelect.add(new Option("Row center", ""));
    for (let seat = 1; seat <= 20; seat += 1) {
      this.seatSelect.add(new Option(`Seat ${seat}`, String(seat)));
    }
  }

  syncSelection(selection: SelectionState, explorerLevel?: ExplorerLevel): void {
    this.seatExplorer.syncSelection({
      sectionId: selection.sectionId,
      rowLabel: selection.rowLabel,
      seatNumber: selection.seatNumber,
      positionIndex: selection.positionIndex ?? selection.seatNumber,
    }, explorerLevel);
    if (selection.sectionId) this.sectionSelect.value = selection.sectionId;
    this.refreshRows();
    if (selection.rowLabel) this.rowSelect.value = selection.rowLabel;
    this.refreshSeats();
    if (selection.seatNumber != null) this.seatSelect.value = String(selection.seatNumber);
  }

  syncEventTime(date: string, kickoff: string, minutesFromKickoff: number): void {
    this.eventDateInput.value = date;
    this.kickoffInput.value = kickoff;
    this.timeInput.value = String(minutesFromKickoff);
    this.timeReadout.value = minutesFromKickoff === 0
      ? "Kickoff"
      : `${minutesFromKickoff > 0 ? "+" : ""}${minutesFromKickoff} min`;
  }

  syncEventSource(eventId: string | null, eventConfig: EventConfigId, officialTime: boolean): void {
    this.liveEventSelect.value = eventId ?? "";
    this.eventConfigSelect.value = eventConfig;
    const label = this.kickoffInput.closest("label")?.querySelector(":scope > span");
    if (label) label.textContent = officialTime ? "Start · official" : "Start · modeled";
  }

  syncPurchaseAction(state: PurchaseActionState): void {
    this.purchaseEvent.textContent = state.eventTitle;
    this.purchaseSelection.textContent = state.selectionLabel;
    this.purchaseNote.textContent = state.note;
    this.purchaseLink.textContent = state.label;
    this.purchaseLink.setAttribute("aria-label", state.accessibleLabel);
    this.purchaseLink.setAttribute("aria-disabled", String(!state.enabled));
    this.purchaseLink.classList.toggle("disabled", !state.enabled);
    this.purchaseLink.tabIndex = state.enabled ? 0 : -1;
    if (state.enabled && state.href) this.purchaseLink.href = state.href;
    else this.purchaseLink.removeAttribute("href");
  }

  renderLiveState(state: LiveVenueState): void {
    if (state.phase === "static") {
      this.setLiveTrust("static", "Portable demo · static inputs");
      this.liveEventSelect.innerHTML = "";
      this.liveEventSelect.add(new Option("Static demo event inputs", ""));
      this.liveEventSelect.disabled = true;
      this.weatherStatus.value = "Weather · use modeled shade controls";
      this.weatherStatus.className = "weather-status static";
      return;
    }

    if (state.phase === "loading" && !state.snapshot) {
      this.setLiveTrust("unknown", "Live feeds connecting…");
      this.weatherStatus.value = "Weather connecting…";
      return;
    }

    if (!state.snapshot) {
      this.setLiveTrust("unknown", "Live feeds unavailable");
      this.liveEventSelect.innerHTML = "";
      this.liveEventSelect.add(new Option("Official events unavailable", ""));
      this.liveEventSelect.disabled = true;
      this.weatherStatus.value = "Weather unavailable";
      this.weatherStatus.className = "weather-status unknown";
      this.weatherStatus.title = state.error ?? "Live service unavailable";
      return;
    }

    const snapshot = state.snapshot;
    const eventsFreshness = effectiveFreshness(snapshot.events.freshness, snapshot.events.expiresAt);
    const events = snapshot.events.value ?? [];
    const selectedId = this.liveEventSelect.value;
    this.liveEventSelect.innerHTML = "";
    if (!events.length) {
      this.liveEventSelect.add(new Option("No official upcoming events returned", ""));
      this.liveEventSelect.disabled = true;
    } else {
      this.liveEventSelect.add(new Option("Select an official event", ""));
      for (const event of events) {
        const date = new Date(`${event.localDate}T12:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const time = event.localTime ? ` · ${event.localTime}` : " · time TBA";
        this.liveEventSelect.add(new Option(`${date}${time} · ${event.title}`, event.id));
      }
      this.liveEventSelect.disabled = false;
      this.liveEventSelect.value = events.some((event) => event.id === selectedId)
        ? selectedId
        : "";
    }
    const eventsAge = formatAge(snapshot.events.fetchedAt);
    const eventLabel = eventsFreshness === "fresh" ? "Live events" : "Stale events";
    this.setLiveTrust(eventsFreshness, `${eventLabel} · updated ${eventsAge}`);
    this.liveEventSelect.title = `${snapshot.events.sourceId} · fetched ${eventsAge}${snapshot.events.staleReason ? ` · ${snapshot.events.staleReason}` : ""}`;

    const weatherFreshness = effectiveFreshness(snapshot.weather.freshness, snapshot.weather.expiresAt);
    const weather = snapshot.weather.value;
    const observationAge = formatAge(weather?.observedAt ?? snapshot.weather.fetchedAt);
    const fahrenheit = weather?.temperatureC == null
      ? null
      : Math.round(weather.temperatureC * (9 / 5) + 32);
    const condition = weather?.summary ?? weather?.hourly[0]?.summary ?? "conditions unavailable";
    this.weatherStatus.value = fahrenheit == null
      ? `Weather · ${condition} · ${observationAge}`
      : `Weather · ${fahrenheit}°F · ${condition} · ${observationAge}`;
    this.weatherStatus.className = `weather-status ${weatherFreshness}`;
    this.weatherStatus.title = `${snapshot.weather.sourceId} · observation ${observationAge}${snapshot.weather.staleReason ? ` · ${snapshot.weather.staleReason}` : ""}`;
  }

  private setLiveTrust(freshness: Freshness, text: string): void {
    this.trustLiveStatus.className = `live-trust ${freshness}`;
    this.trustLiveStatus.textContent = text;
  }

  setAnalysisBusy(busy: boolean): void {
    this.analysisStatus.textContent = busy ? "Calculating modeled rays…" : "Analysis ready";
    this.analysisStatus.classList.toggle("busy", busy);
  }

  renderMetrics(
    selection: SelectionState,
    metrics: SightlineMetrics | null,
    shade: ShadeReport | null,
    seatCountVerified: boolean,
    viewTruthLabel?: string,
  ): void {
    const title = [
      selection.sectionId ? `Section ${selection.sectionId}` : null,
      selection.rowLabel ? `Row ${selection.rowLabel}` : null,
      selection.seatNumber != null
        ? `Seat ${selection.seatNumber}`
        : selection.positionIndex != null
          ? `Modeled position ${selection.positionIndex}`
          : null,
    ].filter(Boolean).join(" · ");

    if (!metrics) {
      this.metricsBody.innerHTML = `<div class="panel-kicker">VIEW ANALYSIS</div><h2>${title || "Seat summary"}</h2><p class="disclaimer">Analysis unavailable for this selection.</p>`;
      return;
    }

    const obstructions = metrics.obstructions.value ?? [];
    const visible = metrics.visibleFieldPercent.value ?? 0;
    this.metricsBody.innerHTML = `
      <div class="metrics-heading"><div><div class="panel-kicker">MODELED VIEW ANALYSIS</div><h2>${title}</h2></div><span class="confidence-chip">CALIBRATION PENDING</span></div>
      <p class="notice">${viewTruthLabel ?? (seatCountVerified
        ? "Exact supplied identifier · modeled XYZ. Seat spacing, aisle offsets, and camera remain modeled."
        : "Source-pack row · representative modeled seat. Individual seat count and physical position are unknown.")}</p>
      <div class="hero-metrics">
        <div><strong>${visible.toFixed(0)}%</strong><span>visible field</span><small>${metrics.sampleCount} deterministic rays</small></div>
        <div><strong>${metrics.distanceToMidfieldM.value?.toFixed(1)}<em>m</em></strong><span>to midfield</span><small>modeled XYZ</small></div>
      </div>
      <div class="metric-list">
        ${metricRow("Nearest sideline", `${metrics.distanceToNearestSidelineM.value?.toFixed(1)} m`, "modeled", metrics.distanceToNearestSidelineM.note)}
        ${metricRow("Near / far goal", `${metrics.distanceToNearGoalM.value?.toFixed(0)} / ${metrics.distanceToFarGoalM.value?.toFixed(0)} m`, "modeled")}
        ${metricRow("Downward angle", `${metrics.downwardAngleToMidfieldDeg.value?.toFixed(1)}°`, "modeled")}
        ${metricRow("Board elevation", `${metrics.northBoardAngleDeg.value?.toFixed(1)}° / ${metrics.southBoardAngleDeg.value?.toFixed(1)}°`, "modeled")}
        ${metricRow("Obstruction flags", obstructions.length ? obstructions.join(" · ") : "None on target rays", "modeled")}
        ${metricRow("C-value clearance", `${metrics.cValueClearanceM.value?.toFixed(2)} m`, "modeled")}
        ${metricRow("Aisle proximity", "Not calibrated", "unknown-do-not-infer")}
      </div>
      <div class="shade-summary">
        <div><span>SHADE STUDY</span><strong>${shade?.kickoff.sunAboveHorizon ? (shade.kickoff.inDirectSun ? "Direct sun at kickoff" : `Modeled shade${shade.kickoff.occluder ? ` · ${shade.kickoff.occluder}` : ""}`) : "Sun below horizon"}</strong></div>
        <span>${shade?.directSunMinutes.value ?? 0} modeled sun min</span>
      </div>
      ${shadeSegments(shade)}
      <p class="disclaimer">Modeled geometry; calibration is pending human approval. Never guaranteed shaded.</p>`;
  }

  renderCompare(
    cards: Array<{
      label: string;
      metrics: SightlineMetrics;
      shade: ShadeReport | null;
      explanation: string;
      calibrationConfidence: number;
    }>,
    weights: Record<string, number>,
  ): void {
    if (!cards.length) {
      this.comparePanel.classList.remove("open");
      this.comparePanel.innerHTML = "";
      return;
    }
    this.comparePanel.classList.add("open");
    const close = `<button class="compare-close" aria-label="Close comparison">×</button>`;
    this.comparePanel.innerHTML = `${close}<div class="compare-header"><div><div class="panel-kicker">SYNCHRONIZED COMPARISON</div><h2>${cards.length} modeled views</h2></div><span>Same event · focus · FOV · sun</span></div>
      <div class="compare-grid">${cards.map((card, index) => `
        <article class="compare-card">
          <button class="remove-compare" data-index="${index}" aria-label="Remove ${card.label}">Remove</button>
          <h3>${card.label}</h3>
          <div class="compare-number"><strong>${card.metrics.visibleFieldPercent.value?.toFixed(0)}%</strong><span>visible field</span></div>
          ${metricRow("Midfield", `${card.metrics.distanceToMidfieldM.value?.toFixed(1)} m`, "modeled")}
          ${metricRow("Board elevation", `${card.metrics.northBoardAngleDeg.value?.toFixed(1)}° / ${card.metrics.southBoardAngleDeg.value?.toFixed(1)}°`, "modeled")}
          ${metricRow("Obstructions", (card.metrics.obstructions.value ?? []).join(" · ") || "None flagged", "modeled")}
          ${metricRow("Direct sun", `${card.shade?.directSunMinutes.value ?? 0} min`, "modeled")}
          ${metricRow("Calibration", `${Math.round(card.calibrationConfidence * 100)}% · pending`, "modeled")}
          ${shadeSegments(card.shade)}
          <p>${card.explanation}</p>
        </article>`).join("")}</div>
      <details class="weight-controls"><summary>Recommendation weights</summary><div>${Object.entries(weights).map(([key, value]) => `
        <label><span>${titleCase(key)}</span><input type="range" min="0" max="100" value="${value}" data-weight="${key}"></label>`).join("")}</div></details>
      <p class="disclaimer">Weights explain preferences; Fieldline does not produce an opaque “best seat” score.</p>`;
    this.comparePanel.querySelector(".compare-close")?.addEventListener("click", () => {
      this.comparePanel.classList.remove("open");
    });
    this.comparePanel.querySelectorAll<HTMLButtonElement>(".remove-compare").forEach((button) => {
      button.addEventListener("click", () => this.callbacks.onRemoveCompare(Number(button.dataset.index)));
    });
    this.comparePanel.querySelectorAll<HTMLInputElement>("[data-weight]").forEach((input) => {
      input.addEventListener("input", () => {
        this.callbacks.onWeightChange(String(input.dataset.weight), Number(input.value));
      });
    });
  }
}
