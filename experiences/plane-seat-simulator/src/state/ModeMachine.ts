import type { CameraRig } from "../camera/CameraRig";
import type { LookControls } from "../input/LookControls";
import type { OrbitControls } from "../input/OrbitControls";
import type { WalkControls } from "../input/WalkControls";
import {
  LAVATORY,
  locationPose,
  seatById,
  standPose,
} from "../data/cabin-layout";
import { CABIN_TARGET, inspectTarget } from "../data/inspect-targets";
import type { LocationId } from "../data/layout-types";
import type { AppState, LightingPreset } from "../state/AppState";

const TWEEN_S = 1.2;
const FRAME_S = 0.7;

const HINT_SEATED = "Drag to look around";
const HINT_WALK = "WASD to walk · E to sit · Esc to pause";
const HINT_LAV = "Drag to look around";
const HINT_CABIN = "Drag to rotate · scroll to zoom · click anything to frame it";
const HINT_FRAMED = "Drag to rotate · scroll to zoom · Esc to zoom out";

/** Coordinates transitions between the overview, seated POV, and walk mode. */
export class ModeMachine {
  onPresetChange: ((preset: LightingPreset) => void) | null = null;

  constructor(
    private state: AppState,
    private rig: CameraRig,
    private look: LookControls,
    private walk: WalkControls,
    private orbit: OrbitControls,
  ) {
    walk.onLockLost = () => {
      if (this.state.mode === "walk") {
        this.state.patch({
          walkPaused: true,
          status: "Pointer released — resume walking to recapture it",
        });
      }
    };
    walk.onLockGained = () => {
      if (this.state.mode === "walk") {
        this.state.patch({ walkPaused: false, hint: HINT_WALK, status: "" });
      }
    };
    this.syncControls();
    this.state.onChange(() => this.syncControls());
  }

  private syncControls() {
    this.look.enabled = this.state.mode === "seated";
    this.walk.enabled = this.state.mode === "walk";
    this.orbit.enabled = this.state.mode === "inspect" && !this.state.mapOpen;
  }

  /** Location chip and control hint for a framed overview target. */
  private overviewStatus(id: string) {
    const target = inspectTarget(id);
    if (!target || target.kind === "cabin") {
      return { location: "Cabin overview", hint: HINT_CABIN };
    }
    return { location: target.label, hint: HINT_FRAMED };
  }

  /** Opens the overview on the whole cabin, without a fly-in. */
  startOverview() {
    this.orbit.adopt(CABIN_TARGET);
    this.orbit.apply();
    this.state.patch({
      mode: "inspect",
      targetId: CABIN_TARGET.id,
      locationId: null,
      ...this.overviewStatus(CABIN_TARGET.id),
    });
  }

  /** Re-states the overview hint after something else wrote to the status. */
  refreshOverviewStatus() {
    if (this.state.mode !== "inspect") return;
    this.state.patch(this.overviewStatus(this.state.targetId));
  }

  /**
   * Frames a target in the overview. Called for a click in the 3D view, so it
   * also covers swapping from one target straight to another.
   */
  frame(id: string) {
    const target = inspectTarget(id);
    if (!target || this.state.mode === "transition") return;
    if (this.state.mode !== "inspect") return;
    if (this.state.targetId === id) return;

    const pose = this.orbit.poseFor(target);
    this.state.patch({ mode: "transition", hint: "" });
    this.rig.flyTo(pose, FRAME_S, () => {
      this.orbit.adopt(target);
      this.state.patch({
        mode: "inspect",
        targetId: id,
        ...this.overviewStatus(id),
      });
    });
  }

  /** Backs the overview out to the whole cabin. */
  frameCabin() {
    this.frame(CABIN_TARGET.id);
  }

  /** Leaves seated or walk mode and returns to the overview. */
  returnToOverview() {
    if (this.state.mode === "transition" || this.state.mode === "inspect") return;
    this.walk.exitLock();
    const target = inspectTarget(this.state.targetId) ?? CABIN_TARGET;
    const pose = this.orbit.poseFor(target);
    this.state.patch({ mode: "transition", mapOpen: false, hint: "" });
    this.rig.flyTo(pose, TWEEN_S, () => {
      this.orbit.adopt(target);
      this.state.patch({
        mode: "inspect",
        locationId: null,
        walkPaused: false,
        ...this.overviewStatus(target.id),
      });
    });
  }

  /** Teleport to a seat or the lavatory from the map or any POV mode. */
  goToLocation(id: LocationId) {
    const pose = locationPose(id);
    if (!pose || this.state.mode === "transition") return;
    this.walk.exitLock();
    this.state.patch({ mode: "transition", mapOpen: false, hint: "" });
    this.rig.flyTo(pose, TWEEN_S, () => {
      this.state.patch({
        mode: "seated",
        locationId: id,
        walkPaused: false,
        location: id === LAVATORY.id ? "Lavatory" : `Seat ${id}`,
        hint: id === LAVATORY.id ? HINT_LAV : HINT_SEATED,
      });
    });
  }

  /** Stand up from the current seat into walk mode. Must run in a click. */
  standUp() {
    const id = this.state.locationId;
    if (this.state.mode !== "seated" || !id || !seatById(id)) return;
    const pose = standPose(id);
    // Request the lock inside the user gesture; tween while (or after) locking.
    this.walk.requestLock();
    this.state.patch({ mode: "transition", hint: "" });
    this.rig.flyTo(pose, 0.8, () => {
      this.state.patch({
        mode: "walk",
        locationId: null,
        walkPaused: !this.walk.isLocked,
        location: "Walking the cabin",
        hint: HINT_WALK,
        status: this.walk.isLocked
          ? ""
          : "Pointer released — resume walking to recapture it",
      });
    });
  }

  /** Sit down in a seat reached while walking. */
  sitAt(id: LocationId) {
    if (this.state.mode !== "walk" || !seatById(id)) return;
    this.walk.exitLock();
    this.goToLocation(id);
  }

  resumeWalk() {
    if (this.state.mode === "walk") this.walk.requestLock();
  }

  toggleMap() {
    this.setMap(!this.state.mapOpen);
  }

  openMap() {
    this.setMap(true);
  }

  private setMap(open: boolean) {
    if (open === this.state.mapOpen) return;
    if (open && this.state.mode === "walk") this.walk.exitLock();
    this.state.patch({ mapOpen: open });
  }

  /** Jump straight to a lighting preset; the control shows all three. */
  setLighting(preset: LightingPreset) {
    if (preset === this.state.preset) return;
    this.state.patch({ preset });
    this.onPresetChange?.(preset);
  }
}
