import { Hotspots } from "./hotspots";
import { IndexRail } from "./index-rail";
import { Notes } from "./notes";
import { SpecPanel } from "./spec-panel";
import { Toolbar } from "./toolbar";
import { Topbar } from "./topbar";
import type { AppState } from "../app/state";
import type { HotspotProjection } from "../scene/showcase";

export interface HudRoots {
  topbar: HTMLElement;
  rail: HTMLElement;
  /** Pointer-transparent layer over the canvas. */
  overlay: HTMLElement;
  spec: HTMLElement;
  notes: HTMLElement;
}

export interface HudActions {
  reset(): void;
  inspect(): void;
}

/** Composes the page regions and fans a single refresh out to each of them. */
export class Hud {
  private rail: IndexRail;
  private spec: SpecPanel;
  private toolbar: Toolbar;
  private hotspots: Hotspots;

  constructor(roots: HudRoots, state: AppState, actions: HudActions) {
    new Topbar(roots.topbar);
    new Notes(roots.notes);

    this.rail = new IndexRail(roots.rail, state);
    this.spec = new SpecPanel(roots.spec, state, actions.inspect);

    roots.overlay.innerHTML = "";
    this.hotspots = new Hotspots(roots.overlay);
    this.toolbar = new Toolbar(roots.overlay, state, { reset: actions.reset });
  }

  refresh(): void {
    this.rail.refresh();
    this.spec.refresh();
    this.toolbar.refresh();
  }

  setHotspots(spots: HotspotProjection[]): void {
    this.hotspots.update(spots);
  }
}
