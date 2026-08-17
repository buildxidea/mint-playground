import {
  attachmentForSlot,
  SLOT_LABELS,
  SLOT_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type SlotType,
} from "../data/arsenal";
import { FINISHES, MATCH_FINISH_ID } from "../data/finishes";
import type { AppState, FinishTarget, StatReadout } from "../app/state";

interface StatRow {
  fill: HTMLElement;
  marker: HTMLElement;
  value: HTMLElement;
  delta: HTMLElement;
}

interface SlotGroup {
  wrapper: HTMLElement;
  stock: HTMLButtonElement;
  fitted: HTMLButtonElement;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Right panel: catalogue header, performance bars, and numbered option groups. */
export class SpecPanel {
  private eyebrow: HTMLElement;
  private title: HTMLElement;
  private description: HTMLElement;
  private classValue: HTMLElement;
  private slotValue: HTMLElement;
  private statRows = new Map<string, StatRow>();
  private groups = new Map<SlotType, SlotGroup>();
  private finishChips = new Map<FinishTarget, Map<string, HTMLButtonElement>>();
  private availability: HTMLElement;

  constructor(
    private root: HTMLElement,
    private state: AppState,
    onInspect: () => void,
  ) {
    root.innerHTML = "";

    this.eyebrow = document.createElement("p");
    this.eyebrow.className = "eyebrow";

    this.title = document.createElement("h2");
    this.title.className = "spec-title";

    this.description = document.createElement("p");
    this.description.className = "spec-desc";

    const facts = document.createElement("dl");
    facts.className = "spec-facts";
    facts.innerHTML =
      `<div><dt>Class</dt><dd data-fact="class"></dd></div>` +
      `<div><dt>Fitted slots</dt><dd data-fact="slots"></dd></div>`;
    this.classValue = facts.querySelector<HTMLElement>('[data-fact="class"]')!;
    this.slotValue = facts.querySelector<HTMLElement>('[data-fact="slots"]')!;

    const stats = document.createElement("section");
    stats.className = "spec-block";
    const statsLabel = document.createElement("p");
    statsLabel.className = "eyebrow";
    statsLabel.textContent = "Performance";
    stats.appendChild(statsLabel);
    // Iterate STAT_ORDER so row order matches the readouts it is fed.
    for (const key of STAT_ORDER) {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML =
        `<span class="stat-label"></span>` +
        `<span class="stat-track"><span class="stat-fill"></span><span class="stat-marker"></span></span>` +
        `<span class="stat-value">0</span>` +
        `<span class="stat-delta"></span>`;
      row.querySelector<HTMLElement>(".stat-label")!.textContent = STAT_LABELS[key];
      stats.appendChild(row);
      this.statRows.set(key, {
        fill: row.querySelector<HTMLElement>(".stat-fill")!,
        marker: row.querySelector<HTMLElement>(".stat-marker")!,
        value: row.querySelector<HTMLElement>(".stat-value")!,
        delta: row.querySelector<HTMLElement>(".stat-delta")!,
      });
    }

    const options = document.createElement("section");
    options.className = "spec-block";
    let groupIndex = 0;
    for (const slot of SLOT_ORDER) {
      const attachment = attachmentForSlot(slot);
      if (!attachment) continue;
      groupIndex += 1;

      const wrapper = document.createElement("div");
      wrapper.className = "option-group";

      const label = document.createElement("p");
      label.className = "eyebrow";
      label.textContent = `${pad(groupIndex)} / ${SLOT_LABELS[slot]}`;

      const chips = document.createElement("div");
      chips.className = "chips";

      const stock = document.createElement("button");
      stock.type = "button";
      stock.className = "chip";
      stock.textContent = "Stock";
      stock.addEventListener("click", () => {
        if (this.state.equippedIn(slot)) this.state.toggleSlot(slot, attachment);
      });

      const fitted = document.createElement("button");
      fitted.type = "button";
      fitted.className = "chip";
      fitted.textContent = attachment.name;
      fitted.title = attachment.blurb;
      fitted.addEventListener("click", () => {
        if (!this.state.equippedIn(slot)) this.state.toggleSlot(slot, attachment);
      });

      chips.append(stock, fitted);
      wrapper.append(label, chips);
      options.appendChild(wrapper);
      this.groups.set(slot, { wrapper, stock, fitted });
    }

    // Finish groups continue the numbering after the module bays.
    const finishTargets: [FinishTarget, string][] = [
      ["weapon", "Frame finish"],
      ["attachment", "Module finish"],
    ];
    for (const [target, heading] of finishTargets) {
      groupIndex += 1;

      const wrapper = document.createElement("div");
      wrapper.className = "option-group";

      const label = document.createElement("p");
      label.className = "eyebrow";
      label.textContent = `${pad(groupIndex)} / ${heading}`;

      const chips = document.createElement("div");
      chips.className = "chips";

      const byId = new Map<string, HTMLButtonElement>();

      if (target === "attachment") {
        const match = document.createElement("button");
        match.type = "button";
        match.className = "chip";
        match.textContent = "Match frame";
        match.addEventListener("click", () =>
          this.state.setFinish(target, MATCH_FINISH_ID),
        );
        byId.set(MATCH_FINISH_ID, match);
        chips.appendChild(match);
      }

      for (const finish of FINISHES) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip swatch";
        const dot = document.createElement("span");
        dot.className = "swatch-dot";
        dot.style.background = finish.swatch;
        const name = document.createElement("span");
        name.textContent = finish.name;
        chip.append(dot, name);
        chip.addEventListener("click", () => this.state.setFinish(target, finish.id));
        byId.set(finish.id, chip);
        chips.appendChild(chip);
      }

      wrapper.append(label, chips);
      options.appendChild(wrapper);
      this.finishChips.set(target, byId);
    }

    this.availability = document.createElement("p");
    this.availability.className = "spec-avail";

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "cta";
    cta.textContent = "Inspect / F";
    cta.addEventListener("click", onInspect);

    root.append(
      this.eyebrow,
      this.title,
      this.description,
      facts,
      stats,
      options,
      this.availability,
      cta,
    );
    this.refresh();
  }

  refresh(): void {
    const weapon = this.state.currentWeapon;
    this.eyebrow.textContent = `${weapon.sku} / ${weapon.edition}`;
    this.title.textContent = weapon.name;
    this.description.textContent = weapon.description;
    this.classValue.textContent = weapon.className;

    // Compare mode reveals the base-value ghost tick on every changed stat.
    this.root.classList.toggle("compare", this.state.isOn("compare"));

    let supported = 0;
    let fitted = 0;
    for (const [slot, group] of this.groups) {
      const isSupported = this.state.slotSupported(slot);
      const isFitted = this.state.equippedIn(slot) !== null;
      if (isSupported) supported += 1;
      if (isFitted) fitted += 1;

      group.wrapper.classList.toggle("unsupported", !isSupported);
      group.stock.disabled = !isSupported;
      group.fitted.disabled = !isSupported;
      group.stock.setAttribute("aria-pressed", String(isSupported && !isFitted));
      group.fitted.setAttribute("aria-pressed", String(isFitted));
    }

    for (const [target, byId] of this.finishChips) {
      const active = this.state.finishId(target);
      for (const [id, chip] of byId) {
        chip.setAttribute("aria-pressed", String(id === active));
      }
    }

    this.slotValue.textContent = `${fitted} of ${supported}`;
    this.availability.textContent = supported
      ? `${supported} of ${this.groups.size} module bays available on this frame.`
      : "No module bays on this frame.";

    this.updateStats(this.state.effectiveStats());
  }

  private updateStats(readouts: StatReadout[]): void {
    for (const readout of readouts) {
      const row = this.statRows.get(readout.key);
      if (!row) continue;
      row.fill.style.width = `${readout.effective}%`;
      row.fill.classList.toggle("buffed", readout.delta > 0);
      row.fill.classList.toggle("nerfed", readout.delta < 0);
      row.marker.style.left = `${readout.base}%`;
      row.marker.classList.toggle("visible", readout.delta !== 0);
      row.value.textContent = String(readout.effective);
      row.delta.textContent =
        readout.delta === 0
          ? ""
          : readout.delta > 0
            ? `+${readout.delta}`
            : String(readout.delta);
      row.delta.classList.toggle("up", readout.delta > 0);
      row.delta.classList.toggle("down", readout.delta < 0);
    }
  }
}
