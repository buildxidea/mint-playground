import {
  GROWTH_FEEL_OPTIONS,
  GROWTH_WHEN_OPTIONS,
  type GrowthSettings,
} from "./scene/growth";

export interface Ui {
  setStatus(message: string, state?: "info" | "error"): void;
  clearStatus(): void;
  showHint(): void;
  /** Step the call to action down once it has been acted on. */
  quietHint(): void;
  /** Top-centre column the score mounts into, beneath the prompt. */
  topSlot: HTMLElement;
  /** Drives the little "how bothered is he" meter, 0..1. */
  setAnnoyance(value: number): void;
  /** Shows his current size once he has grown past his starting scale. */
  setGrowth(value: number): void;
}

/** One labelled group of radio choices in the settings panel. */
function radioGroup<T extends string>(
  heading: string,
  name: string,
  options: { id: T; label: string; blurb: string }[],
  current: T,
  onPick: (id: T) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "settings-group";

  const title = document.createElement("div");
  title.className = "settings-heading";
  title.textContent = heading;
  group.append(title);

  for (const option of options) {
    const row = document.createElement("label");
    row.className = "settings-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = option.id;
    input.checked = option.id === current;
    input.addEventListener("change", () => {
      if (input.checked) onPick(option.id);
    });

    const text = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = option.label;
    const blurb = document.createElement("small");
    blurb.textContent = option.blurb;
    text.append(label, blurb);

    row.append(input, text);
    group.append(row);
  }
  return group;
}

export function createUi(
  root: HTMLElement,
  options: {
    growth: GrowthSettings;
    onGrowthChange(settings: GrowthSettings): void;
    muted: boolean;
    onMuteChange(muted: boolean): void;
  },
): Ui {
  const layer = document.createElement("div");
  layer.className = "ui-layer";

  const status = document.createElement("div");
  status.className = "status-pill";
  status.textContent = "Waking up the meadow…";

  const meter = document.createElement("div");
  meter.className = "meter hidden";
  const meterFill = document.createElement("div");
  meterFill.className = "meter-fill";
  meter.append(meterFill);

  const hint = document.createElement("div");
  hint.className = "hint-pill hidden";
  hint.textContent = "Poke Snorlax 💤";

  const size = document.createElement("div");
  size.className = "size-pill hidden";

  // The prompt and the score share one top-centre column, so the prompt always
  // sits directly above the score rather than the two being placed separately
  // and overlapping when the prompt wraps.
  const topLayer = document.createElement("div");
  topLayer.className = "top-layer";
  topLayer.append(hint);

  layer.append(status, meter, size);

  // Settings: how the growth animation plays.
  const current: GrowthSettings = { ...options.growth };
  const settings = document.createElement("div");
  settings.className = "settings";

  const toggle = document.createElement("button");
  toggle.className = "settings-toggle";
  toggle.type = "button";
  toggle.textContent = "⚙";
  toggle.title = "Growth settings";
  toggle.setAttribute("aria-label", "Growth settings");

  const panel = document.createElement("div");
  panel.className = "settings-panel hidden";
  panel.append(
    radioGroup("Grow when", "growth-when", GROWTH_WHEN_OPTIONS, current.when, (id) => {
      current.when = id;
      options.onGrowthChange({ ...current });
    }),
    radioGroup("Inflate feel", "growth-feel", GROWTH_FEEL_OPTIONS, current.feel, (id) => {
      current.feel = id;
      options.onGrowthChange({ ...current });
    }),
  );

  toggle.addEventListener("click", () => panel.classList.toggle("hidden"));

  let muted = options.muted;
  const sound = document.createElement("button");
  sound.className = "settings-toggle";
  sound.type = "button";
  const paintSound = () => {
    sound.textContent = muted ? "🔇" : "🔊";
    const label = muted ? "Unmute sound" : "Mute sound";
    sound.title = label;
    sound.setAttribute("aria-label", label);
  };
  paintSound();
  sound.addEventListener("click", () => {
    muted = !muted;
    paintSound();
    options.onMuteChange(muted);
  });

  const buttons = document.createElement("div");
  buttons.className = "settings-buttons";
  buttons.append(sound, toggle);
  settings.append(panel, buttons);

  root.append(topLayer, layer, settings);

  let meterShown = false;
  let sizeShown = false;

  return {
    topSlot: topLayer,
    setStatus(message, state = "info") {
      status.textContent = message;
      status.dataset.state = state;
      status.classList.remove("hidden");
    },
    clearStatus() {
      status.classList.add("hidden");
    },
    showHint() {
      hint.classList.remove("hidden");
    },
    quietHint() {
      hint.classList.add("subtle");
    },
    setAnnoyance(value) {
      const visible = value > 0.04;
      if (visible !== meterShown) {
        meter.classList.toggle("hidden", !visible);
        meterShown = visible;
      }
      if (!visible) return;
      meterFill.style.width = `${Math.min(100, value * 100)}%`;
      // Calm blue → warm amber → cross as he approaches waking.
      const hue = 205 - value * 175;
      meterFill.style.background = `hsl(${hue}, 70%, 62%)`;
    },
    setGrowth(value) {
      const visible = value > 1.01;
      if (visible !== sizeShown) {
        size.classList.toggle("hidden", !visible);
        sizeShown = visible;
      }
      if (visible) size.textContent = `${value.toFixed(1)}× size`;
    },
  };
}
