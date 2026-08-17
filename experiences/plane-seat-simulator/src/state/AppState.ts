import type { LocationId } from "../data/layout-types";

export type Mode = "inspect" | "seated" | "walk" | "transition";
export type LightingPreset = "day" | "sunset" | "night";

type Listener = () => void;

/** Authoritative UI/interaction state. Three.js objects only project it. */
export class AppState {
  mode: Mode = "inspect";
  /** Current seat/lavatory id; null while walking or before first pick. */
  locationId: LocationId | null = null;
  /** Target framed by the overview camera; "CABIN" is the whole-cabin view. */
  targetId = "CABIN";
  preset: LightingPreset = "day";
  /** Open from the start: the landing page shows the map to pick from. */
  mapOpen = true;
  /** True while the title card is up, which the map reads to retitle itself. */
  menuOpen = true;
  /** Walk mode paused because pointer lock was lost. */
  walkPaused = false;
  /**
   * Three separate lines, because they behave differently: where you are
   * persists, how to control it fades once you have read it, and a notice
   * stays until whatever caused it is resolved.
   */
  location = "";
  hint = "";
  status = "";

  private listeners = new Set<Listener>();

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  patch(values: Partial<Pick<AppState, "mode" | "locationId" | "targetId" | "preset" | "mapOpen" | "menuOpen" | "walkPaused" | "location" | "hint" | "status">>) {
    Object.assign(this, values);
    this.listeners.forEach((fn) => fn());
  }
}
