import type { AtomFinish, BgColor, LabelColor } from "../types";
import {
  ATOM_FINISH_HINTS,
  ATOM_FINISH_LABELS,
} from "../scene/RenderModes";
import { kelvinTo, type TempUnit } from "../data/elementProperties";

export interface SettingsCallbacks {
  onFinish: (finish: AtomFinish) => void;
  onBackground: (bg: BgColor) => void;
  onShadow: (on: boolean) => void;
  onLabelColor: (color: LabelColor) => void;
  onBrightness: (multiplier: number) => void;
  onTemperature: (kelvin: number) => void;
  onTempUnit: (unit: TempUnit) => void;
}

const TEMP_SUFFIX: Record<TempUnit, string> = { K: "K", C: "°C", F: "°F" };

const FINISHES: AtomFinish[] = ["matte", "satin", "glossy", "metallic"];

/** Compact settings overlay: atom finish, shadow, and label colour. */
export class Settings {
  readonly root = document.createElement("div");
  private body!: HTMLDivElement;
  private finishBtns = new Map<AtomFinish, HTMLButtonElement>();
  private bgBtns = new Map<BgColor, HTMLButtonElement>();
  private shadowBtns = new Map<string, HTMLButtonElement>();
  private labelColorBtns = new Map<LabelColor, HTMLButtonElement>();
  private brightnessInput!: HTMLInputElement;
  private brightnessValue!: HTMLSpanElement;
  private tempInput!: HTMLInputElement;
  private tempValue!: HTMLSpanElement;
  private tempUnit: TempUnit = "K";

  constructor(private readonly cb: SettingsCallbacks) {
    this.root.className = "settings-overlay hidden";
    this.build();
  }

  private build(): void {
    const backdrop = document.createElement("div");
    backdrop.className = "settings-backdrop";
    backdrop.onclick = () => this.close();
    this.root.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.className = "settings-panel";

    const head = document.createElement("div");
    head.className = "settings-head";
    head.innerHTML = `<span class="settings-title">Settings</span>`;
    const close = document.createElement("button");
    close.className = "settings-close";
    close.textContent = "×";
    close.onclick = () => this.close();
    head.appendChild(close);
    panel.appendChild(head);

    this.body = document.createElement("div");
    panel.appendChild(this.body);
    this.root.appendChild(panel);

    this.finishBtns = this.group(
      "Atom finish",
      FINISHES.map((f) => ({
        key: f,
        name: ATOM_FINISH_LABELS[f],
        hint: ATOM_FINISH_HINTS[f],
      })),
      (f) => this.cb.onFinish(f),
    );

    this.buildBrightness();
    this.buildTemperature();

    this.bgBtns = this.group<BgColor>(
      "Background",
      [
        { key: "white", name: "White", hint: "White background" },
        { key: "black", name: "Black", hint: "Black background" },
      ],
      (b) => this.cb.onBackground(b),
    );

    this.shadowBtns = this.group(
      "Shadow",
      [
        { key: "on", name: "Shadow", hint: "Soft ground shadow" },
        { key: "off", name: "No shadow", hint: "Flat, no shadow" },
      ],
      (k) => this.cb.onShadow(k === "on"),
    );

    this.labelColorBtns = this.group<LabelColor>(
      "Atom label colour",
      [
        { key: "white", name: "White", hint: "White text" },
        { key: "black", name: "Black", hint: "Black text" },
      ],
      (c) => this.cb.onLabelColor(c),
    );
  }

  private buildBrightness(): void {
    const section = document.createElement("div");
    section.className = "settings-section";

    const head = document.createElement("div");
    head.className = "settings-label slider-label";
    this.brightnessValue = document.createElement("span");
    this.brightnessValue.className = "slider-value";
    head.append(document.createTextNode("Brightness"), this.brightnessValue);
    section.appendChild(head);

    this.brightnessInput = document.createElement("input");
    this.brightnessInput.type = "range";
    this.brightnessInput.className = "slider";
    this.brightnessInput.min = "40";
    this.brightnessInput.max = "180";
    this.brightnessInput.step = "5";
    this.brightnessInput.value = "100";
    this.brightnessInput.oninput = () => {
      const pct = Number(this.brightnessInput.value);
      this.brightnessValue.textContent = `${pct}%`;
      this.cb.onBrightness(pct / 100);
    };
    section.appendChild(this.brightnessInput);

    this.body.appendChild(section);
  }

  /**
   * Temperature used by the periodic table's phase colouring: every element is
   * shown as solid, liquid or gas at this temperature.
   */
  private buildTemperature(): void {
    const section = document.createElement("div");
    section.className = "settings-section";

    const head = document.createElement("div");
    head.className = "settings-label slider-label";
    this.tempValue = document.createElement("span");
    this.tempValue.className = "slider-value";
    head.append(document.createTextNode("Temperature"), this.tempValue);
    section.appendChild(head);

    const row = document.createElement("div");
    row.className = "settings-slider-row";

    this.tempInput = document.createElement("input");
    this.tempInput.type = "range";
    this.tempInput.className = "slider";
    this.tempInput.min = "0";
    this.tempInput.max = "6000";
    this.tempInput.step = "1";
    this.tempInput.value = "298";
    this.tempInput.oninput = () => {
      this.updateTempReadout();
      this.cb.onTemperature(Number(this.tempInput.value));
    };

    const unitBtn = document.createElement("button");
    unitBtn.className = "pt-chip";
    unitBtn.textContent = "K";
    unitBtn.onclick = () => {
      const order: TempUnit[] = ["K", "C", "F"];
      this.tempUnit = order[(order.indexOf(this.tempUnit) + 1) % order.length];
      unitBtn.textContent = TEMP_SUFFIX[this.tempUnit];
      this.updateTempReadout();
      this.cb.onTempUnit(this.tempUnit);
    };

    row.append(this.tempInput, unitBtn);
    section.appendChild(row);

    const hint = document.createElement("div");
    hint.className = "settings-hint";
    hint.textContent =
      "Colours the periodic table by each element's phase at this temperature.";
    section.appendChild(hint);

    this.body.appendChild(section);
    this.updateTempReadout();
  }

  private updateTempReadout(): void {
    const k = Number(this.tempInput.value);
    const v = kelvinTo[this.tempUnit](k);
    this.tempValue.textContent = `${v.toFixed(this.tempUnit === "K" ? 0 : 1)} ${TEMP_SUFFIX[this.tempUnit]}`;
  }

  private group<T extends string>(
    label: string,
    options: Array<{ key: T; name: string; hint: string }>,
    onSelect: (key: T) => void,
  ): Map<T, HTMLButtonElement> {
    const section = document.createElement("div");
    section.className = "settings-section";
    section.innerHTML = `<div class="settings-label">${label}</div>`;
    const grid = document.createElement("div");
    grid.className = "finish-grid";
    const map = new Map<T, HTMLButtonElement>();
    for (const o of options) {
      const b = document.createElement("button");
      b.className = "finish-btn";
      b.innerHTML = `<span class="finish-name">${o.name}</span><span class="finish-hint">${o.hint}</span>`;
      b.onclick = () => onSelect(o.key);
      grid.appendChild(b);
      map.set(o.key, b);
    }
    section.appendChild(grid);
    this.body.appendChild(section);
    return map;
  }

  setFinish(finish: AtomFinish): void {
    for (const [f, b] of this.finishBtns) b.classList.toggle("active", f === finish);
  }

  setBackground(bg: BgColor): void {
    for (const [c, b] of this.bgBtns) b.classList.toggle("active", c === bg);
  }

  setBrightness(multiplier: number): void {
    const pct = Math.round(multiplier * 100);
    this.brightnessInput.value = String(pct);
    this.brightnessValue.textContent = `${pct}%`;
  }

  setShadow(on: boolean): void {
    for (const [k, b] of this.shadowBtns) b.classList.toggle("active", k === (on ? "on" : "off"));
  }

  setLabelColor(color: LabelColor): void {
    for (const [c, b] of this.labelColorBtns) b.classList.toggle("active", c === color);
  }

  open(): void {
    this.root.classList.remove("hidden");
  }
  close(): void {
    this.root.classList.add("hidden");
  }
  toggle(): void {
    this.root.classList.toggle("hidden");
  }
}
