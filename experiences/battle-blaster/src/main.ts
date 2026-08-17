import { AppState } from "./app/state";
import { audio } from "./audio/audio-manager";
import { PLATFORM_MODEL_URL } from "./data/arsenal";
import { resolveModuleFinishId } from "./data/finishes";
import { Showcase } from "./scene/showcase";
import { Hud } from "./ui/hud";

const required = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const canvas = required<HTMLCanvasElement>("#stage");
const stageCell = required(".stage-cell");
const statusEl = required("#status");

const state = new AppState();
const showcase = new Showcase(canvas);
const hud = new Hud(
  {
    topbar: required("#topbar"),
    rail: required("#rail"),
    overlay: required("#hud"),
    spec: required("#spec"),
    notes: required("#notes"),
  },
  state,
  {
    reset: () => showcase.resetView(),
    inspect: () => showcase.inspect(),
  },
);

let statusTimer: number | undefined;
showcase.onStatus = (status) => {
  window.clearTimeout(statusTimer);
  if (status.kind === "ready") {
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = status.message;
  statusEl.classList.toggle("error", status.kind === "error");
  if (status.kind === "error") {
    statusTimer = window.setTimeout(() => (statusEl.hidden = true), 6000);
  }
};

const vignette = document.createElement("div");
vignette.className = "vignette";
stageCell.appendChild(vignette);
let vignetteTimer: number | undefined;
showcase.onSwap = () => {
  window.clearTimeout(vignetteTimer);
  vignette.classList.add("pulse");
  vignetteTimer = window.setTimeout(() => vignette.classList.remove("pulse"), 500);
};

let fireTimer: number | undefined;
showcase.onFire = () => {
  window.clearTimeout(fireTimer);
  stageCell.classList.add("fired");
  fireTimer = window.setTimeout(() => stageCell.classList.remove("fired"), 140);
};

showcase.onHotspots = (spots) => hud.setHotspots(spots);

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const target = e.target as HTMLElement | null;
  if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
  if (e.key === "f" || e.key === "F") showcase.inspect();
});

const applyFinishes = () => {
  const frame = state.finishId("weapon");
  showcase.setFinishes(frame, resolveModuleFinishId(frame, state.finishId("attachment")));
};

state.on("weaponChanged", () => {
  hud.refresh();
  // Finishes are per weapon, so adopt the incoming frame's look before it loads.
  applyFinishes();
  void showcase.showWeapon(state.currentWeapon, state.equippedAttachments());
});

state.on("finishChanged", () => {
  hud.refresh();
  applyFinishes();
});

state.on("loadoutChanged", () => {
  hud.refresh();
  const slot = state.lastChangedSlot;
  if (!slot) return;
  const equipped = state.equippedIn(slot);
  if (equipped) {
    void showcase.mountAttachment(state.currentWeapon, equipped);
  } else {
    showcase.unmountAttachment(slot);
  }
});

state.on("viewChanged", () => {
  hud.refresh();
  showcase.setLift(state.isOn("lift"));
  showcase.setExploded(state.isOn("explode"));
});

// On narrow layouts the stage must not swallow the page scroll.
const narrow = window.matchMedia("(max-width: 1180px)");
const applyLayout = () => showcase.setCompact(narrow.matches);
applyLayout();
narrow.addEventListener("change", applyLayout);

applyFinishes();
void showcase.loadPedestal(PLATFORM_MODEL_URL);
void showcase.showWeapon(state.currentWeapon, state.equippedAttachments());

import.meta.hot?.dispose(() => {
  showcase.dispose();
  audio.dispose();
});

// Dev-only handle so the anchor overlay and seat data are reachable from the
// console (`showcase.showHotspots = true`). Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).showcase = showcase;
}
