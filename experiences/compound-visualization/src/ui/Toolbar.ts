import type { RenderMode } from "../types";
import { RENDER_MODE_LABELS } from "../scene/RenderModes";

export interface ToolbarCallbacks {
  onRenderMode: (mode: RenderMode) => void;
  onToggleLabels: (on: boolean) => void;
  onToggleMeasure: (on: boolean) => void;
  onToggleAutoRotate: (on: boolean) => void;
  onToggleFullscreen: () => void;
  onSavePng: () => void;
  onResetView: () => void;
  onOpenSettings: () => void;
  onOpenPeriodicTable: () => void;
}

const MODES: RenderMode[] = ["ball-and-stick", "space-filling", "wireframe"];

export class Toolbar {
  readonly root = document.createElement("div");
  private readonly body = document.createElement("div");
  private handle!: HTMLButtonElement;
  private modeButtons = new Map<RenderMode, HTMLButtonElement>();
  private labelsBtn!: HTMLButtonElement;
  private measureBtn!: HTMLButtonElement;

  constructor(private readonly cb: ToolbarCallbacks) {
    this.root.className = "toolbar";
    this.build();
  }

  private build(): void {
    // Collapse handle — hides the controls, leaving just this pill.
    this.handle = document.createElement("button");
    this.handle.className = "toolbar-handle";
    this.handle.title = "Hide menu";
    this.handle.onclick = () => this.toggleCollapsed();
    this.root.appendChild(this.handle);

    this.body.className = "toolbar-body";
    this.root.appendChild(this.body);
    this.updateHandle();

    const seg = document.createElement("div");
    seg.className = "segmented";
    for (const mode of MODES) {
      const b = document.createElement("button");
      b.textContent = RENDER_MODE_LABELS[mode];
      b.className = "seg-btn";
      b.onclick = () => this.cb.onRenderMode(mode);
      seg.appendChild(b);
      this.modeButtons.set(mode, b);
    }
    this.body.appendChild(seg);

    this.labelsBtn = this.toggle("Labels", true, (on) => this.cb.onToggleLabels(on));
    this.measureBtn = this.toggle("Measure", false, (on) => this.cb.onToggleMeasure(on));
    this.toggle("Spin", false, (on) => this.cb.onToggleAutoRotate(on));

    this.body.appendChild(this.iconButton("Reset", () => this.cb.onResetView()));
    this.body.appendChild(this.iconButton("Fullscreen", () => this.cb.onToggleFullscreen()));
    this.body.appendChild(this.iconButton("Save PNG", () => this.cb.onSavePng()));
    this.body.appendChild(this.iconButton("Settings", () => this.cb.onOpenSettings()));
    this.body.appendChild(
      this.iconButton("Periodic table", () => this.cb.onOpenPeriodicTable(), "accent"),
    );
  }

  private toggleCollapsed(): void {
    this.root.classList.toggle("collapsed");
    this.updateHandle();
  }

  private updateHandle(): void {
    const collapsed = this.root.classList.contains("collapsed");
    this.handle.textContent = collapsed ? "▴ Menu" : "▾";
    this.handle.title = collapsed ? "Show menu" : "Hide menu";
  }

  private toggle(
    label: string,
    initial: boolean,
    handler: (on: boolean) => void,
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "tool-btn";
    b.textContent = label;
    b.dataset.on = String(initial);
    b.classList.toggle("active", initial);
    b.onclick = () => {
      const next = b.dataset.on !== "true";
      b.dataset.on = String(next);
      b.classList.toggle("active", next);
      handler(next);
    };
    this.body.appendChild(b);
    return b;
  }

  private iconButton(label: string, handler: () => void, cls = ""): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `tool-btn ${cls}`.trim();
    b.textContent = label;
    b.onclick = handler;
    return b;
  }

  setRenderMode(mode: RenderMode): void {
    for (const [m, b] of this.modeButtons) b.classList.toggle("active", m === mode);
  }

  /** Reflect measure state when it is toggled off elsewhere. */
  setMeasure(on: boolean): void {
    this.measureBtn.dataset.on = String(on);
    this.measureBtn.classList.toggle("active", on);
  }

  setLabels(on: boolean): void {
    this.labelsBtn.dataset.on = String(on);
    this.labelsBtn.classList.toggle("active", on);
  }
}
