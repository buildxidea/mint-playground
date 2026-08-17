import type { AppState, LightingPreset } from "../state/AppState";

export interface HudActions {
  toggleMap(): void;
  setLighting(preset: LightingPreset): void;
  standUp(): void;
  resumeWalk(): void;
  frameCabin(): void;
  returnToOverview(): void;
}

/**
 * 16px stroke icons on a shared grid, drawn to the same weight as the labels
 * so nothing in the bar out-shouts anything else.
 */
const ICON = {
  cabin: `<path d="M8 2.2c1.5 0 2.4 1.8 2.4 4v2.2l3.4 2v1.9l-3.4-1v2.3l1.3 1v1L8 15.2 4.3 15.6v-1l1.3-1v-2.3l-3.4 1v-1.9l3.4-2V6.2c0-2.2.9-4 2.4-4Z"/>`,
  seat: `<path d="M4.6 2.6v6.2M4.6 8.8h5.2a1.6 1.6 0 0 1 1.6 1.6v3M4.6 12.4h6.8M3 13.4h10"/>`,
  back: `<path d="M9.8 4.2 6 8l3.8 3.8M6.2 8H13"/>`,
  stand: `<path d="M8 2.4a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6ZM8 5.4v4.2M8 9.6l-2 4M8 9.6l2 4M5.4 7h5.2"/>`,
  walk: `<path d="M9 2.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM9.2 5.4 7.4 8l1.6 1.8.4 3.8M7.4 8 5 9.2M9 9.8l-2.2 3.8"/>`,
  day: `<circle cx="8" cy="8" r="3"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/>`,
  sunset: `<path d="M4 11h8M1.8 11h.9M13.3 11h.9M5.2 8.2a2.8 2.8 0 0 1 5.6 0M8 2.6v1.5M3.6 4.4l1 1M12.4 4.4l-1 1M1.8 13.6h12.4"/>`,
  night: `<path d="M13 9.6A5.2 5.2 0 0 1 6.4 3a5.4 5.4 0 1 0 6.6 6.6Z"/>`,
} as const;

const LIGHTING: Array<{ preset: LightingPreset; label: string; icon: string }> = [
  { preset: "day", label: "Day", icon: ICON.day },
  { preset: "sunset", label: "Sunset", icon: ICON.sunset },
  { preset: "night", label: "Night", icon: ICON.night },
];

function icon(path: string) {
  return `<svg class="hud-icon" viewBox="0 0 16 16" aria-hidden="true">${path}</svg>`;
}

interface ButtonSpec {
  icon: string;
  label: string;
  key?: string;
  tip: string;
  onClick: () => void;
}

/**
 * Flight-deck control bar: one panel, three groups divided by hairlines —
 * where you can go, what the light is doing, and the one action the current
 * mode offers. Above it, a location readout that persists and a control hint
 * that retires itself once it has been read.
 */
export class Hud {
  private locationEl: HTMLDivElement;
  private locationLabel: HTMLSpanElement;
  private locationValue: HTMLSpanElement;
  private hintEl: HTMLDivElement;
  private noticeEl: HTMLDivElement;
  private mapBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private standBtn: HTMLButtonElement;
  private resumeBtn: HTMLButtonElement;
  private actionGroup: HTMLDivElement;
  private actionDivider: HTMLSpanElement;
  private lightBtns = new Map<LightingPreset, HTMLButtonElement>();
  private hintTimer = 0;
  private lastHint = "";

  constructor(root: HTMLElement, private state: AppState, actions: HudActions) {
    const wrap = document.createElement("div");
    wrap.id = "hud";
    root.appendChild(wrap);

    this.noticeEl = document.createElement("div");
    this.noticeEl.id = "hud-notice";
    wrap.appendChild(this.noticeEl);

    this.locationEl = document.createElement("div");
    this.locationEl.id = "hud-location";
    this.locationLabel = document.createElement("span");
    this.locationLabel.className = "hud-loc-label";
    this.locationValue = document.createElement("span");
    this.locationValue.className = "hud-loc-value";
    this.locationEl.append(this.locationLabel, this.locationValue);
    wrap.appendChild(this.locationEl);

    this.hintEl = document.createElement("div");
    this.hintEl.id = "hud-hint";
    wrap.appendChild(this.hintEl);

    const bar = document.createElement("div");
    bar.id = "hud-bar";
    wrap.appendChild(bar);

    const group = (cls = "") => {
      const g = document.createElement("div");
      g.className = `hud-group ${cls}`.trim();
      bar.appendChild(g);
      return g;
    };
    const divider = () => {
      const d = document.createElement("span");
      d.className = "hud-divider";
      bar.appendChild(d);
      return d;
    };

    const button = (parent: HTMLElement, spec: ButtonSpec) => {
      const b = document.createElement("button");
      b.className = "hud-btn";
      b.innerHTML =
        icon(spec.icon) +
        `<span class="hud-label">${spec.label}</span>` +
        (spec.key ? `<kbd class="hud-key">${spec.key}</kbd>` : "") +
        `<span class="hud-tip">${spec.tip}</span>`;
      b.addEventListener("click", spec.onClick);
      parent.appendChild(b);
      return b;
    };

    // Group 1: getting around.
    const navGroup = group();
    this.backBtn = button(navGroup, {
      icon: ICON.back,
      label: "Back",
      key: "Esc",
      tip: "Return to the cabin overview",
      onClick: () => {
        if (this.state.mode === "inspect") actions.frameCabin();
        else actions.returnToOverview();
      },
    });
    this.mapBtn = button(navGroup, {
      icon: ICON.cabin,
      label: "Seat map",
      key: "M",
      tip: "Show the cabin plan and jump to any seat",
      onClick: actions.toggleMap,
    });

    divider();

    // Group 2: lighting, all three states visible.
    const lightGroup = group("hud-segmented");
    for (const { preset, label, icon: path } of LIGHTING) {
      const b = button(lightGroup, {
        icon: path,
        label,
        tip: `Light the cabin for ${label.toLowerCase()}`,
        onClick: () => actions.setLighting(preset),
      });
      this.lightBtns.set(preset, b);
    }

    const actionDivider = divider();

    // Group 3: whatever this mode offers, if anything.
    this.actionGroup = group();
    this.standBtn = button(this.actionGroup, {
      icon: ICON.stand,
      label: "Stand up",
      key: "E",
      tip: "Leave the seat and walk the cabin",
      onClick: actions.standUp,
    });
    this.resumeBtn = button(this.actionGroup, {
      icon: ICON.walk,
      label: "Resume",
      tip: "Recapture the pointer and keep walking",
      onClick: actions.resumeWalk,
    });
    this.actionDivider = actionDivider;

    this.update();
  }

  update() {
    const s = this.state;

    for (const [preset, b] of this.lightBtns) {
      b.classList.toggle("is-active", s.preset === preset);
      b.setAttribute("aria-pressed", String(s.preset === preset));
    }

    const framed = s.mode === "inspect" && s.targetId !== "CABIN";
    const away = s.mode === "seated" || s.mode === "walk";
    this.backBtn.hidden = !(framed || away);
    this.mapBtn.classList.toggle("is-active", s.mapOpen);

    const canStand =
      s.mode === "seated" && !!s.locationId && s.locationId !== "LAV";
    this.standBtn.hidden = !canStand;
    this.resumeBtn.hidden = !(s.mode === "walk" && s.walkPaused);
    // Fold the group away entirely rather than leaving a stray divider.
    const hasAction = canStand || (s.mode === "walk" && s.walkPaused);
    this.actionGroup.hidden = !hasAction;
    this.actionDivider.hidden = !hasAction;

    // "Seat 12A" splits so the identifier can carry its own treatment.
    const seat = /^Seat (.+)$/.exec(s.location);
    this.locationLabel.textContent = seat ? "Seat" : s.location;
    this.locationValue.textContent = seat ? seat[1] : "";
    this.locationValue.hidden = !seat;
    this.locationEl.hidden = !s.location;

    this.noticeEl.textContent = s.status;
    this.noticeEl.hidden = !s.status;

    // Hints retire a few seconds after they appear, and come back whenever the
    // text changes — which is exactly when the mode has changed under you.
    if (s.hint !== this.lastHint) {
      this.lastHint = s.hint;
      this.hintEl.textContent = s.hint;
      this.hintEl.hidden = !s.hint;
      this.hintEl.classList.remove("is-faded");
      window.clearTimeout(this.hintTimer);
      if (s.hint) {
        this.hintTimer = window.setTimeout(() => {
          this.hintEl.classList.add("is-faded");
        }, 4500);
      }
    }
  }
}
