import { DEFAULT_CRASH_LIMITS } from "../sim/crash";
import { GRADE_SINK } from "../sim/landing";
import { MODE_LABELS, type DroneState } from "../sim/state";
import { CAMERA_LABELS, type CameraMode } from "../view/chase";

export interface HudModel {
  state: DroneState;
  /**
   * Override for the mode cell. The quad shows its flight mode; other
   * vehicles name themselves here instead.
   */
  modeLabel?: string;
  /** Display name of the active tune, which may be a preset or "Custom". */
  tune: string;
  camera: CameraMode;
  windSpeed: number;
  gustiness: number;
  usingGamepad: boolean;
  /** Height above whatever is directly below, metres, or null out of range. */
  altitudeAgl: number | null;
  /** Cells the occupancy grid has mapped so far. */
  mappedCells: number;
  gimbalStabilized: boolean;
  /**
   * Rocket-only readout: propellant remaining, 0..1, and thrust-to-weight.
   * Null for every other craft, and the cell hides itself rather than sitting
   * there reading "—" for five of the six vehicles.
   */
  rocket?: { propellant: number; twr: number } | null;
}

/**
 * Colour band for the descent readout.
 *
 * The thresholds are the landing grades themselves, so the number a pilot
 * watches on approach and the verdict they get on touchdown are the same
 * scale — amber means "this would be a firm one", red means "this would break
 * the aircraft". A separately-invented set of warning levels would have the
 * instrument disagreeing with the outcome.
 */
function sinkTone(sink: number): string {
  if (sink > DEFAULT_CRASH_LIMITS.hardLandingSpeed) return "danger";
  if (sink > GRADE_SINK.good) return "warn";
  return "";
}

/**
 * Compact flight readout.
 *
 * Kept to what a pilot actually needs mid-flight — attitude is read from the
 * aircraft itself, so the panel carries only what the model cannot show:
 * armed state, mode, altitude, speed and the current tune.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly fields = new Map<string, HTMLElement>();
  private readonly cells = new Map<string, HTMLElement>();

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    container.appendChild(this.root);

    this.addField("status", "");
    this.addField("mode", "Mode");
    this.addField("alt", "Alt");
    this.addField("agl", "AGL");
    this.addField("speed", "Speed");
    this.addField("vs", "V/S");
    this.addField("throttle", "Thr");
    this.addField("rocket", "Prop");
    this.addField("tune", "Tune");
    this.addField("wind", "Wind");
    this.addField("map", "Mapped");
    this.addField("view", "View");
  }

  private addField(key: string, label: string) {
    const cell = document.createElement("div");
    cell.className = "hud-cell";

    if (label) {
      const tag = document.createElement("span");
      tag.className = "hud-label";
      tag.textContent = label;
      cell.appendChild(tag);
    }

    const value = document.createElement("span");
    value.className = "hud-value";
    cell.appendChild(value);

    this.root.appendChild(cell);
    this.fields.set(key, value);
    this.cells.set(key, cell);
  }

  private set(key: string, text: string) {
    const el = this.fields.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }

  update(model: HudModel) {
    const { state } = model;

    const status = state.crashed
      ? "CRASHED"
      : state.armed
        ? "ARMED"
        : "DISARMED";
    this.set("status", status);
    this.root.dataset.status = status.toLowerCase();

    this.set("mode", model.modeLabel ?? MODE_LABELS[state.mode]);
    this.set("alt", `${state.position.y.toFixed(1)} m`);
    // Altitude is height above the origin plane; AGL is height above whatever
    // is actually underneath, which diverges the moment you fly over scenery.
    this.set(
      "agl",
      model.altitudeAgl === null ? "—" : `${model.altitudeAgl.toFixed(1)} m`,
    );
    this.set("speed", `${state.velocity.length().toFixed(1)} m/s`);

    // Signed, and shown as descent-positive is *not* what a pilot reads — a
    // vertical speed indicator reads negative when going down, so this keeps
    // the sign of the velocity and lets the colour carry the warning.
    const climb = state.velocity.y;
    this.set("vs", `${climb >= 0 ? "+" : ""}${climb.toFixed(1)} m/s`);
    const vs = this.fields.get("vs");
    if (vs) vs.dataset.tone = sinkTone(-climb);

    const throttle = Array.from(state.motorThrust).reduce((a, b) => a + b, 0);
    this.set("throttle", `${throttle.toFixed(1)} N`);

    // Propellant is the rocket's defining instrument: it is the only vehicle
    // here whose mass, thrust-to-weight and control authority all change as it
    // flies, and this one cell is where all three come from.
    const rocketCell = this.cells.get("rocket");
    if (rocketCell) rocketCell.hidden = !model.rocket;
    if (model.rocket) {
      this.set(
        "rocket",
        `${Math.round(model.rocket.propellant * 100)}% · ${model.rocket.twr.toFixed(1)} g`,
      );
      const value = this.fields.get("rocket");
      if (value) {
        value.dataset.tone =
          model.rocket.propellant <= 0 ? "danger" : model.rocket.propellant < 0.15 ? "warn" : "";
      }
    }

    this.set("tune", model.tune);
    this.set(
      "wind",
      model.windSpeed > 0.05
        ? `${model.windSpeed.toFixed(0)} m/s`
        : "calm",
    );
    this.set("map", `${model.mappedCells}`);
    // The horizon mode only means anything in the onboard view — showing
    // "Chase · raw" implies the chase camera has a setting it does not have.
    const horizon =
      model.camera === "onboard" ? (model.gimbalStabilized ? " · level" : " · raw") : "";
    this.set(
      "view",
      `${CAMERA_LABELS[model.camera]}${horizon}${model.usingGamepad ? " · pad" : ""}`,
    );
  }
}
