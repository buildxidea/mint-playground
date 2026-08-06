import {
  GAIN_PRESETS,
  cloneGains,
  type GainPresetId,
  type GainSet,
} from "../sim/config";

/**
 * Live gain tuning.
 *
 * The whole point of the sandbox is that these numbers are editable while
 * flying, so the panel writes straight through to the controller rather than
 * needing an apply step — you slide the rate D term down and feel the aircraft
 * start to ring within the same second.
 *
 * Roll and pitch share one set of controls. They are symmetric on this
 * airframe (identical inertia and arm geometry), so exposing them separately
 * would invite tuning them apart for no reason and double the panel.
 *
 * State is mirrored into the URL hash, so a tune can be shared or reloaded.
 */

export interface Field {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  get(gains: GainSet): number;
  set(gains: GainSet, value: number): void;
}

/**
 * Slider ranges must contain every preset value, with headroom to explore
 * past them. A range that is too small does not error — it silently clamps
 * the handle, so the panel shows a lie and the first touch of the slider
 * yanks the gain down to the cap. `test/controls.test.ts` asserts the
 * containment, because this went unnoticed once: after the airframe was
 * resized, Rate D's preset value (0.0139) sat above its 0.012 maximum.
 */
export const FIELDS: Field[] = [
  {
    key: "rkp",
    label: "Rate P",
    min: 0,
    max: 2.5,
    step: 0.005,
    get: (g) => g.rate.roll.kp,
    set: (g, v) => {
      g.rate.roll.kp = v;
      g.rate.pitch.kp = v;
    },
  },
  {
    key: "rki",
    label: "Rate I",
    min: 0,
    max: 1,
    step: 0.005,
    get: (g) => g.rate.roll.ki,
    set: (g, v) => {
      g.rate.roll.ki = v;
      g.rate.pitch.ki = v;
    },
  },
  {
    key: "rkd",
    label: "Rate D",
    min: 0,
    max: 0.1,
    step: 0.0005,
    get: (g) => g.rate.roll.kd,
    set: (g, v) => {
      g.rate.roll.kd = v;
      g.rate.pitch.kd = v;
    },
  },
  {
    key: "ykp",
    label: "Yaw P",
    min: 0,
    max: 5,
    step: 0.01,
    get: (g) => g.rate.yaw.kp,
    set: (g, v) => {
      g.rate.yaw.kp = v;
    },
  },
  {
    key: "akp",
    label: "Attitude P",
    min: 0,
    max: 40,
    step: 0.5,
    get: (g) => g.attitudeKp,
    set: (g, v) => {
      g.attitudeKp = v;
    },
  },
  {
    key: "vkp",
    label: "Velocity P",
    min: 0,
    max: 6,
    step: 0.05,
    get: (g) => g.horizontalVelocity.kp,
    set: (g, v) => {
      g.horizontalVelocity.kp = v;
    },
  },
  {
    key: "pkp",
    label: "Position P",
    min: 0,
    max: 5,
    step: 0.05,
    get: (g) => g.positionKp,
    set: (g, v) => {
      g.positionKp = v;
    },
  },
  {
    key: "zkp",
    label: "Climb P",
    min: 0,
    max: 8,
    step: 0.05,
    get: (g) => g.verticalVelocity.kp,
    set: (g, v) => {
      g.verticalVelocity.kp = v;
    },
  },
];

/**
 * A named preset, or `custom` once a slider has been moved away from one.
 * Editing gains genuinely leaves the preset behind, so the type says so rather
 * than pretending the tune is still "Stable".
 */
export type TuneId = GainPresetId | "custom";

export function tuneLabel(id: TuneId): string {
  return id === "custom" ? "Custom" : GAIN_PRESETS[id].label;
}

export interface TuningCallbacks {
  onChange: (gains: GainSet) => void;
}

export class TuningPanel {
  private readonly root: HTMLElement;
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly readouts = new Map<string, HTMLElement>();
  private readonly presetButtons = new Map<GainPresetId, HTMLButtonElement>();

  private gains: GainSet;
  private preset: TuneId;

  constructor(
    container: HTMLElement,
    initialPreset: GainPresetId,
    private readonly callbacks: TuningCallbacks,
  ) {
    this.preset = initialPreset;
    this.gains = cloneGains(initialPreset);

    this.root = document.createElement("div");
    this.root.className = "tuning";
    this.root.hidden = true;

    const presets = document.createElement("div");
    presets.className = "tuning-presets";
    for (const id of Object.keys(GAIN_PRESETS) as GainPresetId[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = GAIN_PRESETS[id].label;
      button.addEventListener("click", () => this.applyPreset(id));
      presets.appendChild(button);
      this.presetButtons.set(id, button);
    }
    this.root.appendChild(presets);

    for (const field of FIELDS) {
      const row = document.createElement("label");
      row.className = "tuning-row";

      const label = document.createElement("span");
      label.className = "tuning-label";
      label.textContent = field.label;

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      input.addEventListener("input", () => {
        field.set(this.gains, Number(input.value));
        this.preset = "custom";
        this.refreshReadouts();
        this.markPresetButtons();
        this.callbacks.onChange(this.gains);
        this.writeHash();
      });

      const readout = document.createElement("span");
      readout.className = "tuning-value";

      row.append(label, input, readout);
      this.root.appendChild(row);

      this.inputs.set(field.key, input);
      this.readouts.set(field.key, readout);
    }

    container.appendChild(this.root);

    const fromHash = readHash();
    if (fromHash) {
      this.gains = fromHash.gains;
      this.preset = fromHash.preset;
      this.callbacks.onChange(this.gains);
    }
    this.syncInputs();
  }

  get visible() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
  }

  /** Current gains, live — the controller holds the same object. */
  get current() {
    return this.gains;
  }

  get currentPreset() {
    return this.preset;
  }

  applyPreset(id: GainPresetId) {
    this.preset = id;
    this.gains = cloneGains(id);
    this.syncInputs();
    this.callbacks.onChange(this.gains);
    this.writeHash();
  }

  private syncInputs() {
    for (const field of FIELDS) {
      const input = this.inputs.get(field.key);
      if (input) input.value = String(field.get(this.gains));
    }
    this.refreshReadouts();
    this.markPresetButtons();
  }

  private refreshReadouts() {
    for (const field of FIELDS) {
      const readout = this.readouts.get(field.key);
      if (!readout) continue;
      const value = field.get(this.gains);
      readout.textContent = value < 0.02 ? value.toFixed(4) : value.toFixed(2);
    }
  }

  private markPresetButtons() {
    for (const [id, button] of this.presetButtons) {
      button.classList.toggle("is-active", id === this.preset);
    }
  }

  private writeHash() {
    const params = new URLSearchParams();
    params.set("p", this.preset);
    for (const field of FIELDS) {
      params.set(field.key, String(round(field.get(this.gains))));
    }
    // replaceState rather than assigning location.hash: a slider drag would
    // otherwise push a history entry per pixel of travel.
    history.replaceState(null, "", `#${params.toString()}`);
  }
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}

/** Restore a tune from the URL hash, or null when there is nothing to restore. */
export function readHash(): { preset: TuneId; gains: GainSet } | null {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const requested = (params.get("p") ?? "stable") as TuneId;
  const preset: TuneId =
    requested === "custom" || GAIN_PRESETS[requested as GainPresetId]
      ? requested
      : "stable";
  const base =
    preset === "custom" ? cloneGains("stable") : cloneGains(preset);

  let touched = false;
  for (const field of FIELDS) {
    const value = params.get(field.key);
    if (value === null) continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    field.set(base, Math.min(field.max, Math.max(field.min, parsed)));
    touched = true;
  }

  return touched || params.has("p") ? { preset, gains: base } : null;
}
